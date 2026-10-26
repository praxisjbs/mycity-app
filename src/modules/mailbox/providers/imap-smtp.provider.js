"use strict";
/**
 * The one mail provider in M1: IMAP in (imapflow, mailparser), SMTP out (nodemailer).
 * Custom domain only, signed in with the address and its password (mailbox.md §1).
 * Business code never calls this directly; mailbox.service does.
 *
 * Every operation opens its own connection and closes it, so a sync holds one IMAP
 * connection at a time against the host's limit of 30 per IP address (mailbox.md §6).
 *
 * Lessons this file keeps from the field (mailbox.md §11):
 *  - The SMTP envelope sender is the bare address, never a "Name <address>" form:
 *    relays that verify the sender refuse the display-name form.
 *  - Bcc travels in the envelope only, never as a header.
 *  - Attachments go in the MIME, built once and reused for the send and for the copy
 *    appended to Sent.
 *  - The copy goes to the folder the server marks \Sent, falling back to its usual names.
 *  - Read state comes from the server's \Seen flag, or a first sync of Sent and Archive
 *    would leave thousands of messages unread.
 *  - `keepCidLinks` keeps inline images as cid: links rather than inlining them as data.
 *  - Every IMAP connection listens for "error": imapflow raises a server that hangs up or goes
 *    silent as an event as well as failing the command waiting on it, and an event nobody
 *    hears is thrown, which ends the process (mailbox.md §6).
 */
const crypto = require("node:crypto");
const { logger } = require("../../../config/logger");

const SENT_FALLBACKS = ["Sent", "INBOX.Sent", "Sent Items", "Sent Mail"];
const PARSE = { keepCidLinks: true };
const MAX_FETCH = 500;
/**
 * How long a short-lived connection waits on a server that has stopped answering. A command
 * answers in well under a second and a fetch with data arriving never trips it; IDLE keeps
 * the library's 5 minutes, since the server's own keepalive comes every 2 (mailbox.md §6).
 */
const SOCKET_TIMEOUT_MS = 2 * 60 * 1000;

/** "Name <a@b>" → "a@b". */
function bareAddress(value) {
  const m = String(value || "").match(/<([^>]+)>/);
  return (m ? m[1] : String(value || "")).trim();
}

/** Addresses out of a mailparser address object. */
function addressesOf(field) {
  if (!field) return [];
  const list = Array.isArray(field) ? field : [field];
  return list
    .flatMap((x) => (x.value || []).map((v) => v.address))
    .filter(Boolean);
}

/** One parsed message, in the shape mailbox.service ingests. */
function normalise(parsed, item = {}) {
  const references = parsed.references ? [].concat(parsed.references) : [];
  const fromValue =
    (parsed.from && parsed.from.value && parsed.from.value[0]) || {};
  return {
    uid: item.uid ?? null,
    messageId: parsed.messageId || null,
    inReplyTo: parsed.inReplyTo || null,
    references,
    from: fromValue.address || null,
    fromName: (fromValue.name || "").trim() || null,
    to: addressesOf(parsed.to),
    cc: addressesOf(parsed.cc),
    subject: parsed.subject || "",
    html: parsed.html || null,
    text: parsed.text || null,
    date: parsed.date || item.internalDate || new Date(),
    seen: Boolean(
      item.flags &&
      (item.flags.has
        ? item.flags.has("\\Seen")
        : item.flags.includes("\\Seen")),
    ),
    attachments: (parsed.attachments || [])
      .filter((a) => a.content && a.content.length)
      .map((a) => ({
        filename: a.filename || "attachment",
        contentType: a.contentType || "application/octet-stream",
        size: a.size || a.content.length,
        content: a.content,
        contentId: a.cid || null,
        inline: Boolean(a.related) || a.contentDisposition === "inline",
      })),
  };
}

class ImapSmtpProvider {
  /**
   * @param {{email: string, username: string, password: string, incoming_host: string,
   *          incoming_port: number, outgoing_host: string, outgoing_port: number, tls: boolean,
   *          from_name?: string}} conn
   * @param {{socketTimeout?: number}} [opts]  ms a short-lived connection waits on a silent server
   */
  constructor(conn, { socketTimeout = SOCKET_TIMEOUT_MS } = {}) {
    this.conn = conn;
    this.socketTimeout = socketTimeout;
  }

  /**
   * An IMAP client, not yet connected. Without `socketTimeout` it keeps the library's own wait,
   * which is what IDLE uses (loops/mail-idle.js).
   * @param {{socketTimeout?: number}} [opts]
   */
  imap({ socketTimeout } = {}) {
    const { ImapFlow } = require("imapflow");
    const c = this.conn;
    const client = new ImapFlow({
      host: c.incoming_host,
      port: c.incoming_port || 993,
      secure: c.tls !== false,
      auth: { user: c.username || c.email, pass: c.password },
      logger: false,
      tls: c.tls === false ? undefined : { servername: c.incoming_host },
      ...(socketTimeout ? { socketTimeout } : {}),
    });
    // The caller's await carries the failure; this only keeps the event from ending the process.
    client.on("error", (err) =>
      logger.warn({ err: err.message, code: err.code, host: c.incoming_host }, "mail server connection error"),
    );
    return client;
  }

  smtp() {
    const nodemailer = require("nodemailer");
    const c = this.conn;
    return nodemailer.createTransport({
      host: c.outgoing_host,
      port: c.outgoing_port || 465,
      secure: c.tls !== false && Number(c.outgoing_port || 465) === 465,
      ignoreTLS: c.tls === false,
      auth: { user: c.username || c.email, pass: c.password },
      tls: c.tls === false ? undefined : { servername: c.outgoing_host },
    });
  }

  async withImap(fn) {
    const client = this.imap({ socketTimeout: this.socketTimeout });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      try {
        await client.logout();
      } catch {
        /* closing a connection that already dropped */
      }
    }
  }

  /** Both directions, before a password is saved. Throws the raw error for the caller to classify. */
  async verify() {
    await this.withImap(async () => undefined).catch((err) => {
      err.leg = "imap";
      throw err;
    });
    await this.smtp()
      .verify()
      .catch((err) => {
        err.leg = "smtp";
        throw err;
      });
    return true;
  }

  async listFolders() {
    return this.withImap(async (imap) => {
      const list = await imap.list();
      return (list || []).map((f) => ({
        path: f.path,
        delimiter: f.delimiter,
        flags: f.flags ? [...f.flags].map((x) => String(x)) : [],
        specialUse: f.specialUse || null,
      }));
    });
  }

  /**
   * Messages above `lastUid` in one folder, oldest first, at most MAX_FETCH a call; the
   * caller stores the new cursor and calls again while `more` is true.
   */
  async fetchSince(path, { lastUid = 0 } = {}) {
    const { simpleParser } = require("mailparser");
    return this.withImap(async (imap) => {
      const lock = await imap.getMailboxLock(path);
      try {
        const uidValidity = Number(imap.mailbox.uidValidity);
        const messages = [];
        let maxUid = lastUid;
        let more = false;
        for await (const item of imap.fetch(
          `${lastUid + 1}:*`,
          { uid: true, source: true, flags: true, internalDate: true },
          { uid: true },
        )) {
          if (item.uid <= lastUid) continue; // "n:*" answers with the last message when none is newer
          if (messages.length >= MAX_FETCH) {
            more = true;
            break;
          }
          messages.push(
            normalise(await simpleParser(item.source, PARSE), item),
          );
          if (item.uid > maxUid) maxUid = item.uid;
        }
        return { uidValidity, lastUid: maxUid, messages, more };
      } finally {
        lock.release();
      }
    });
  }

  /** Mark read on the server: the message by its Message-ID in the folder it is in. */
  async markSeen(path, messageId) {
    if (!messageId) return false;
    return this.withImap(async (imap) => {
      const lock = await imap.getMailboxLock(path);
      try {
        const uids = await imap.search(
          { header: { "message-id": messageId } },
          { uid: true },
        );
        if (uids && uids.length)
          await imap.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
        return Boolean(uids && uids.length);
      } finally {
        lock.release();
      }
    });
  }

  /** One message by its Message-ID in a folder, read whole; null when the server has none. */
  async fetchOne(path, messageId) {
    if (!messageId) return null;
    const { simpleParser } = require("mailparser");
    return this.withImap(async (imap) => {
      const lock = await imap.getMailboxLock(path);
      try {
        const uids = await imap.search({ header: { "message-id": messageId } }, { uid: true });
        if (!uids || !uids.length) return null;
        const item = await imap.fetchOne(String(uids[0]), { uid: true, source: true, flags: true, internalDate: true }, { uid: true });
        return item && item.source ? normalise(await simpleParser(item.source, PARSE), item) : null;
      } finally {
        lock.release();
      }
    });
  }

  /** Move a message between folders on the server. */
  async move(fromPath, toPath, messageId) {
    if (!messageId) return false;
    return this.withImap(async (imap) => {
      const lock = await imap.getMailboxLock(fromPath);
      try {
        const uids = await imap.search(
          { header: { "message-id": messageId } },
          { uid: true },
        );
        if (!uids || !uids.length) return false;
        await imap.messageMove(uids, toPath, { uid: true });
        return true;
      } finally {
        lock.release();
      }
    });
  }

  /** Delete for good: flagged \Deleted and expunged. */
  async remove(path, messageIds) {
    const ids = (messageIds || []).filter(Boolean);
    if (!ids.length) return 0;
    return this.withImap(async (imap) => {
      const lock = await imap.getMailboxLock(path);
      try {
        let n = 0;
        for (const id of ids) {
          const uids = await imap.search(
            { header: { "message-id": id } },
            { uid: true },
          );
          if (uids && uids.length) {
            await imap.messageDelete(uids, { uid: true });
            n += uids.length;
          }
        }
        return n;
      } finally {
        lock.release();
      }
    });
  }

  /**
   * Send one message through SMTP. Once this returns the server has it: the caller marks it
   * sent before anything else (mailbox.md §3 step 5), then calls copyToSent.
   * @returns {Promise<{messageId: string, raw: Buffer}>}
   */
  async send(msg) {
    const c = this.conn;
    const nodemailer = require("nodemailer");
    const domain = String(c.email).split("@").pop();
    const messageId = msg.messageId || `<${crypto.randomUUID()}@${domain}>`;
    const mail = {
      from: c.from_name ? { name: c.from_name, address: c.email } : c.email,
      to: msg.to,
      cc: msg.cc && msg.cc.length ? msg.cc : undefined,
      subject: msg.subject || "",
      html: msg.html || "",
      text: msg.text || undefined,
      messageId,
      inReplyTo: msg.inReplyTo || undefined,
      references:
        msg.references && msg.references.length
          ? msg.references.join(" ")
          : undefined,
      // A part with a content id is drawn inside the HTML (a signature's logo), not listed as a file.
      attachments: (msg.attachments || []).map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
        ...(a.cid ? { cid: a.cid, contentDisposition: "inline" } : {}),
      })),
    };
    const raw = await new Promise((resolve, reject) => {
      nodemailer
        .createTransport({
          streamTransport: true,
          buffer: true,
          newline: "\r\n",
        })
        .sendMail(mail, (err, info) =>
          err ? reject(err) : resolve(info.message),
        );
    });
    const envelope = {
      from: bareAddress(c.email),
      to: [...msg.to, ...(msg.cc || []), ...(msg.bcc || [])].map(bareAddress),
    };
    await this.smtp().sendMail({ envelope, raw });
    return { messageId, raw };
  }

  /**
   * A sent message's copy appended to the server's Sent folder. Best effort: the message has
   * gone whatever this does, so it never throws.
   * @param {Buffer} raw  the MIME send() returned
   * @param {string|null} [path]  the folder; else the one the server marks \Sent
   * @returns {Promise<string|null>} the folder it went to
   */
  async copyToSent(raw, path = null) {
    try {
      return await this.withImap(async (imap) => {
        const target = path || (await this.sentFolder(imap));
        if (!target) return null;
        await imap.append(target, raw, ["\\Seen"]);
        return target;
      });
    } catch {
      /* the message is sent; a missing copy in Sent is filled by the next sync's own copy */
      return null;
    }
  }

  async sentFolder(imap) {
    const list = await imap.list();
    const flagged = (list || []).find(
      (f) => String(f.specialUse || "").toLowerCase() === "\\sent",
    );
    if (flagged) return flagged.path;
    for (const name of SENT_FALLBACKS)
      if ((list || []).some((f) => f.path === name)) return name;
    return null;
  }
}

module.exports = {
  ImapSmtpProvider,
  normalise,
  bareAddress,
  addressesOf,
  MAX_FETCH,
};
