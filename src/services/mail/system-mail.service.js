"use strict";
/**
 * System mail: the messages the system sends by itself (invites, password resets,
 * "your payslip is ready", interview invitations). Not the Mailbox module (M1), which
 * is each person's own work email.
 *
 *   await systemMail.send({
 *     to: { name: "Ada Obi", email: "ada@mycityapp.io" },
 *     template: "payslip-ready",                         // templates/email/payslip-ready.html
 *     data: { period: "2026-10-01" },                     // checked against its declared variables
 *     attachments: [{ document_id: payslip.document_id }, ics.attachment(invite)],
 *   });
 *
 * Only ever called from an outbox handler or a job, after the change that caused it has
 * committed (README §6.4); a request never waits on SMTP, and a rolled-back save never
 * sends anything.
 *
 * Transport:
 *  - SMTP_HOST set: real delivery over SMTP, STARTTLS required on 587 (TLS from the first
 *    byte with SMTP_SECURE on 465). Staging sends real mail too (A4), marked: the subject
 *    starts "[STAGING]" and the message carries a red banner, so nobody mistakes a test
 *    offer letter for a real one.
 *    Before handing a message to the relay, each recipient domain is checked
 *    (deliverability/route-check.js): a relay that hosts the domain's website but not its
 *    mail would keep the message in a local mailbox and report success, so that send
 *    fails with MAIL_ROUTE_TRAPPED instead.
 *  - SMTP_HOST empty (development, test): nothing leaves the machine. Messages are kept in
 *    memory (captured()) for tests and logged at debug.
 *
 * Paced: at most MAIL_SEND_PER_HOUR recipients in any 60 minutes (services/mail/pace.js), the
 * mailbox's hourly limit. Over it, send() throws MailPacedError (code MAIL_PACED) before
 * anything goes out, and the job that called it postpones itself until a slot frees.
 *
 * Rendering is the same engine as documents (shared/documents/render.js): escaped values,
 * house formats, the subject a template too, inside templates/email/layout.html. A plain
 * text part is derived from the HTML for clients that want one.
 */
const nodemailer = require("nodemailer");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const { pool: defaultPool } = require("../../config/db");
const { render } = require("../../shared/documents/render");
const { markdownToHtml } = require("../../shared/documents/markdown");
const templates = require("../../shared/templates/template-store");
const variables = require("../../shared/templates/variables");
const storage = require("../storage/storage.service");
const routeCheck = require("./deliverability/route-check");
const pace = require("./pace");

const EMAIL_RE = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/;
const MAX_RECIPIENTS = 50;
const CAPTURE_LIMIT = 200;

let transport = null;
const captured = [];

function getTransport() {
  if (transport) return transport;
  if (config.SMTP_HOST) {
    transport = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      requireTLS: !config.SMTP_SECURE,
      auth: config.SMTP_USER
        ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
        : undefined,
      pool: true,
      maxConnections: 3,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 60_000,
    });
  } else {
    transport = nodemailer.createTransport({ jsonTransport: true });
  }
  return transport;
}

function addressList(value) {
  const list = (Array.isArray(value) ? value : [value])
    .filter(Boolean)
    .map((a) => (typeof a === "string" ? { email: a } : a));
  for (const a of list) {
    if (!EMAIL_RE.test(String(a.email || "").trim()))
      throw new Error(`system mail: "${a.email}" is not an email address`);
  }
  if (list.length > MAX_RECIPIENTS)
    throw new Error(
      `system mail: at most ${MAX_RECIPIENTS} recipients per message`,
    );
  return list.map((a) =>
    a.name
      ? {
          name: String(a.name).replace(/[\r\n"]/g, ""),
          address: a.email.trim(),
        }
      : a.email.trim(),
  );
}

/** Plain text from the rendered HTML: links kept as "text (url)", tags dropped. */
function textOf(html) {
  return String(html)
    .replace(/<(style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Render a template to { subject, html, text } without sending (preview in Settings, tests).
 * @param {{query: Function}} db
 * @param {string} key
 * @param {object} data
 * @param {{recipient?: object, org?: object}} [ctx]
 */
async function renderEmail(
  db,
  key,
  data,
  { recipient = null, org = null } = {},
) {
  const checked = variables.parseData("email", key, data);
  const t = await templates.current(db, "email", key);
  const staging = config.APP_ENV === "staging";
  const profile =
    org || (await require("../../shared/documents/generate").orgProfile(db));
  const values = {
    ...checked,
    org: profile,
    recipient,
    staging,
    today: require("../../shared/time/lagos").today(),
  };
  const subject = render(t.subject || t.title || "MyCity App", values)
    .replace(/\s+/g, " ")
    .trim();
  const inner = render(t.body, values);
  const body = t.format === "markdown" ? markdownToHtml(inner) : inner;
  const html = render(
    templates.layout("email").body,
    { ...values, subject },
    { body },
  );
  return {
    subject: staging ? `[STAGING] ${subject}` : subject,
    html,
    text: textOf(html),
    template_version: t.version,
  };
}

async function attachmentsOf(db, list) {
  const out = [];
  for (const a of list || []) {
    if (a.document_id) {
      const { rows } = await db.query(
        "SELECT storage_key, mime, original_name, render_status, scan_status FROM document WHERE document_id = $1",
        [a.document_id],
      );
      const d = rows[0];
      if (!d)
        throw new Error(
          `system mail: document ${a.document_id} does not exist`,
        );
      if (
        d.render_status === "pending" ||
        d.scan_status === "pending" ||
        d.scan_status === "infected"
      ) {
        throw new Error(
          `system mail: document ${a.document_id} is not ready to attach`,
        );
      }
      out.push({
        filename: a.filename || d.original_name,
        content: await storage.get(d.storage_key),
        contentType: d.mime,
      });
    } else if (a.filename && a.content !== undefined) {
      out.push({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      });
    } else {
      throw new Error(
        "system mail: an attachment is { document_id } or { filename, content }",
      );
    }
  }
  return out;
}

/**
 * Send one message.
 * @param {{to: object|object[], cc?: object|object[], template: string, data?: object,
 *          recipient?: object, attachments?: object[], reply_to?: string, db?: object}} msg
 *   recipient  what {{ recipient.* }} reads (first_name for "Dear Ada"); defaults to the first `to`
 * @returns {Promise<{message_id: string, accepted: string[], rejected: string[]}>}
 */
async function send(msg) {
  const db = msg.db || defaultPool;
  const to = addressList(msg.to);
  if (to.length === 0) throw new Error("system mail: no recipient");
  const cc = msg.cc ? addressList(msg.cc) : undefined;
  const first = Array.isArray(msg.to) ? msg.to[0] : msg.to;
  const recipient =
    msg.recipient || (typeof first === "object" ? first : { email: first });
  // A relay that hosts a recipient's domain but not its mail would accept the message and
  // keep it in a local mailbox: fail loudly instead (code MAIL_ROUTE_TRAPPED).
  if (config.SMTP_HOST)
    await routeCheck.assertRoutable({
      smtpHost: config.SMTP_HOST,
      to: [...to, ...(cc || [])].map((a) =>
        typeof a === "string" ? a : a.address,
      ),
    });
  const rendered = await renderEmail(db, msg.template, msg.data || {}, {
    recipient,
  });
  if (config.SMTP_HOST) {
    const slot = await pace.reserve(to.length + (cc ? cc.length : 0));
    if (!slot.ok) throw new pace.MailPacedError(slot.wait_ms);
  }
  const info = await getTransport().sendMail({
    from: config.MAIL_FROM,
    replyTo: msg.reply_to || config.MAIL_REPLY_TO || undefined,
    to,
    cc,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    attachments: await attachmentsOf(db, msg.attachments),
    headers: {
      "X-MyCity-Template": `${msg.template}@${rendered.template_version}`,
      "Auto-Submitted": "auto-generated",
    },
  });
  if (!config.SMTP_HOST) {
    captured.push({
      template: msg.template,
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    if (captured.length > CAPTURE_LIMIT) captured.shift();
    logger.debug(
      { template: msg.template, to },
      "system mail captured (no SMTP_HOST)",
    );
  }
  return {
    message_id: info.messageId,
    accepted: (info.accepted || []).map(String),
    rejected: (info.rejected || []).map(String),
  };
}

/** Messages kept instead of sent (no SMTP_HOST). Tests only. */
function capturedMail() {
  return captured.slice();
}

function __reset() {
  captured.length = 0;
  transport = null;
}

/** Readiness: the SMTP server answers and accepts our login. */
async function health() {
  if (!config.SMTP_HOST) return { status: "up", mode: "captured" };
  try {
    await getTransport().verify();
    const out = { status: "up", mode: "smtp" };
    if (config.MAIL_SEND_PER_HOUR) {
      out.sent_last_hour = await pace.usage();
      out.per_hour = config.MAIL_SEND_PER_HOUR;
    }
    return out;
  } catch (err) {
    return {
      status: "degraded",
      error: String(err.code || err.message).slice(0, 120),
    };
  }
}

module.exports = { send, renderEmail, textOf, capturedMail, health, __reset };
