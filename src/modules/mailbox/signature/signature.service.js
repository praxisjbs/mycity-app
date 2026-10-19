"use strict";
/**
 * Email signatures (mailbox.md §3 steps 7 to 10): one design for everyone, built from records,
 * never designed by hand.
 *
 * - The Signature tab: the caller's signature drawn both ways, and their numbers and switches.
 *   The mobile is the employee record's own and is changed through the organisation service,
 *   the path ESS Edit Profile takes, so there is one number and not two.
 * - Configure (`mailbox.signature`): the company's links and switches.
 * - The composer's preview and the send-time bake both ask signatureFor(), the one rule for
 *   whether a message carries the full signature or the slim line.
 */
const { pool } = require("../../../config/db");
const { atomically } = require("../../../shared/db/tx");
const { emit } = require("../../../shared/events/emit");
const { AppError } = require("../../../shared/errors");
const { readProfile } = require("../../../shared/organisation/profile");
const organisation = require("../../organisation/organisation.service");
const { EVENTS } = require("../mailbox.events");
const repo = require("./signature.repo");
const { resolve, CONFIG_DEFAULTS } = require("./signature.resolve");
const { full, slim } = require("./signature.html");
const images = require("./signature.images");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const iso = (v) => (v ? new Date(v).toISOString() : null);
const noRecord = () => new AppError("NO_EMPLOYEE_RECORD", "This login has no employee record yet", 409);

/** The part of an address after the @, lower-cased. */
const domainOf = (address) => {
  const s = String(address || "").trim().toLowerCase();
  const at = s.lastIndexOf("@");
  return at > 0 ? s.slice(at + 1) : "";
};

/**
 * Which signature a message carries (mailbox.md §3 step 8): the slim line on a reply, and on
 * mail whose every recipient (To, Cc and Bcc) is at the sender's own domain; the full
 * signature on anything else, a new message or a forward.
 * @param {{in_reply_to?: string|null, to_addresses?: string[], cc_addresses?: string[], bcc_addresses?: string[]}} message
 * @param {string|null} from  the address it is sent from
 * @returns {"full"|"slim"}
 */
function signatureFor(message, from) {
  if (message.in_reply_to) return "slim";
  const everyone = [
    ...(message.to_addresses || []),
    ...(message.cc_addresses || []),
    ...(message.bcc_addresses || []),
  ];
  const own = domainOf(from);
  if (own && everyone.length > 0 && everyone.every((a) => domainOf(a) === own)) return "slim";
  return "full";
}

/** Everything a signature is built from, read in one place. */
async function sourcesOf(db, userId) {
  const person = await repo.personOf(db, userId);
  if (!person) throw noRecord();
  const own = await repo.mineOf(db, userId);
  const mailbox = await repo.mailboxOf(db, userId);
  const org = await readProfile(db);
  const company = await repo.configOf(db);
  const brand = { white_logo: Boolean(org.logo_white_document_id), icon: Boolean(org.icon_document_id) };
  return {
    person,
    mine: own,
    mailbox,
    org,
    config: company,
    model: resolve({ person, mine: own, mailbox, org, config: company, brand }),
  };
}

/** The full signature and its pictures, drawn; the band says what was actually drawn on it. */
async function drawFull(db, src) {
  const pics = await images.picturesFor(db, src.model, src.org);
  return { model: { ...src.model, band: pics.band.kind }, pics };
}

/* ------------------------------------------------------------------ *
 * The Signature tab
 * ------------------------------------------------------------------ */

function view(src, drawnFull, drawnSlim) {
  const own = src.mine || {};
  const cfg = { ...CONFIG_DEFAULTS, ...(src.config || {}) };
  return {
    name: src.model.name,
    job_title: src.model.job_title,
    department: src.model.department,
    email: src.model.email,
    mobile: src.person.phone || null,
    office_line: own.office_line ?? null,
    show_mobile: own.show_mobile ?? true,
    show_whatsapp: own.show_whatsapp ?? true,
    whatsapp_allowed: cfg.show_whatsapp,
    full_html: drawnFull.html,
    slim_html: drawnSlim.html,
  };
}

/** GET /mailbox/signature: the caller's signature both ways, pictures inline as data: URLs. */
async function mine(user) {
  const src = await sourcesOf(pool, user.user_id);
  const { model, pics } = await drawFull(pool, src);
  return view(src, full(model, images.asData(pics)), slim(src.model));
}

/** PATCH /mailbox/signature: only the fields sent; the mobile goes to the employee record. */
async function saveMine(body, user) {
  const person = await repo.personOf(pool, user.user_id);
  if (!person) throw noRecord();
  const own = {
    office_line: body.office_line,
    show_mobile: body.show_mobile,
    show_whatsapp: body.show_whatsapp,
  };
  await tx(async (client) => {
    if (body.mobile !== undefined && body.mobile !== person.phone)
      await organisation.updateEmployee(client, person.employee_id, { phone: body.mobile }, user);
    if (Object.values(own).some((v) => v !== undefined)) {
      const before = await repo.mineOf(client, user.user_id);
      const after = await repo.saveMine(client, user.user_id, own);
      await emit(client, {
        key: EVENTS.MAIL_SIGNATURE_CHANGED,
        entity: { type: "mail_signature", id: after.mail_signature_id },
        actor: user,
        before: before || undefined,
        after,
        payload: { user_id: user.user_id },
      });
    }
  });
  return mine(user);
}

/** POST /mailbox/signature/preview: what a message with these recipients would carry. */
async function preview(body, user) {
  const src = await sourcesOf(pool, user.user_id);
  const variant = signatureFor(body, src.mailbox || src.person.work_email);
  if (variant === "slim") return { variant, html: slim(src.model).html };
  const { model, pics } = await drawFull(pool, src);
  return { variant, html: full(model, images.asData(pics)).html };
}

/* ------------------------------------------------------------------ *
 * Configure (mailbox.signature)
 * ------------------------------------------------------------------ */

function configView(row) {
  const cfg = { ...CONFIG_DEFAULTS, ...(row || {}) };
  return {
    app_store_url: cfg.app_store_url,
    google_play_url: cfg.google_play_url,
    instagram_url: cfg.instagram_url,
    tiktok_url: cfg.tiktok_url,
    linkedin_url: cfg.linkedin_url,
    x_url: cfg.x_url,
    facebook_url: cfg.facebook_url,
    youtube_url: cfg.youtube_url,
    confidentiality_note: cfg.confidentiality_note,
    show_whatsapp: cfg.show_whatsapp,
    show_app_links: cfg.show_app_links,
    show_social_links: cfg.show_social_links,
    show_legal: cfg.show_legal,
    updated_at: iso(row && row.updated_at),
  };
}

async function config() {
  return configView(await repo.configOf(pool));
}

/** PUT /mailbox/signature/config: the wizard saves all of it at once. */
async function saveConfig(body, user) {
  const row = await tx(async (client) => {
    const before = await repo.configOf(client);
    const after = await repo.saveConfig(client, body, user.user_id);
    await emit(client, {
      key: EVENTS.MAIL_SIGNATURE_CONFIG_CHANGED,
      entity: { type: "mail_signature_config", id: after.mail_signature_config_id },
      actor: user,
      before: before || undefined,
      after,
    });
    return after;
  });
  return configView(row);
}

/* ------------------------------------------------------------------ *
 * Sending
 * ------------------------------------------------------------------ */

/**
 * The signature a queued message carries (mailbox.md §3 step 9), drawn when it is queued and
 * kept in its payload, so a later change to a record never rewrites mail already on its way.
 * The full signature's pictures are stored once in the vault and named by content id.
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {string} userId
 * @param {object} message  MailSend: the recipients and in_reply_to
 * @param {string} from     the mailbox's address
 * @returns {Promise<{variant: "full"|"slim", html: string, text: string, parts: {content_id: string, document_id: string}[]}>}
 */
async function bake(client, userId, message, from) {
  const src = await sourcesOf(client, userId);
  const variant = signatureFor(message, from);
  if (variant === "slim") return { variant, ...slim(src.model), parts: [] };
  const { model, pics } = await drawFull(client, src);
  const inline = await images.asParts(client, pics, domainOf(from) || "mycityapp.io");
  return { variant, ...full(model, inline.pics), parts: inline.parts };
}

module.exports = { signatureFor, domainOf, mine, saveMine, preview, config, saveConfig, bake };
