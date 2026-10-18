"use strict";
/**
 * Mailbox (docs/guides/mailbox.md): each person's own company mailbox.
 *
 * - Connect: the address and its password, both directions tested before anything is
 *   saved; the password is kept encrypted in integration_secret, never on the account.
 * - Sync (worker): the server's folders mapped to the canonical six, new mail fetched
 *   above each folder's last UID, threaded, its HTML sanitised and its files quarantined
 *   and scanned through the vault. Read state comes from the server.
 * - Read, move, empty: local first, then the server, best effort; the local change wins.
 * - Send: the composer saves a draft as the person types; Send puts it on the queue
 *   (now, or at a time) and the worker delivers it through SMTP with its files, appends
 *   a copy to Sent and records it.
 *
 * Nobody reaches another person's mailbox: every call starts from the caller's account.
 */
const crypto = require("node:crypto");
const { pool } = require("../../config/db");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const vault = require("../../shared/documents/vault");
const storage = require("../../services/storage/storage.service");
const encryption = require("../../services/secrets/encryption.service");
const repo = require("./mailbox.repo");
const { EVENTS } = require("./mailbox.events");
const { ImapSmtpProvider } = require("./providers/imap-smtp.provider");
const autodiscover = require("./autodiscover");
const { mapFolders } = require("./folders");
const {
  threadKeyFor,
  baseSubject,
  snippetOf,
  normaliseId,
} = require("./threading");
const { mapSmtpError, mapImapError, retryPlan } = require("./smtp-errors");
const { cleanHtml, textToHtml } = require("./visible");
const { outgoingHtml, textOf } = require("./compose");

/** Folders synced from the server. Drafts live in the app (mailbox.md §3 step 4). */
const SYNCED = ["inbox", "sent", "archive", "spam", "trash"];
/** Attachments larger than this are listed by the server but not fetched (mailbox.md §6). */
const MAX_ATTACHMENT = 25 * 1024 * 1024;
/** New mail older than this is filed without a notification (a first sync is not news). */
const FRESH_MS = 60 * 60 * 1000;

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const iso = (v) => (v ? new Date(v).toISOString() : null);
const noMailbox = () =>
  new AppError("NO_MAILBOX", "Connect your mailbox first", 409);

/** Tests replace the provider with a fake that speaks the same methods. */
let makeProvider = (conn) => new ImapSmtpProvider(conn);
function useProvider(factory) {
  makeProvider = factory || ((conn) => new ImapSmtpProvider(conn));
}

function serverSettings() {
  return {
    MAIL_IMAP_HOST: config.MAILBOX_IMAP_HOST,
    MAIL_SMTP_HOST: config.MAILBOX_SMTP_HOST,
    MAIL_IMAP_PORT: config.MAILBOX_IMAP_PORT,
    MAIL_SMTP_PORT: config.MAILBOX_SMTP_PORT,
  };
}

async function providerFor(db, acct, displayName = null) {
  const secret = await repo.secretOf(db, acct.integration_secret_id);
  if (!secret || !secret.ciphertext)
    throw new AppError("MAIL_AUTH_FAILED", "Reconnect your mailbox", 409);
  return makeProvider({
    email: String(acct.email),
    username: acct.username,
    password: encryption.decrypt(secret.ciphertext),
    incoming_host: acct.incoming_host,
    incoming_port: acct.incoming_port,
    outgoing_host: acct.outgoing_host,
    outgoing_port: acct.outgoing_port,
    tls: acct.tls,
    from_name: displayName,
  });
}

function connectionView(acct) {
  if (!acct)
    return {
      mail_account_id: null,
      email: null,
      status: "disconnected",
      last_synced_at: null,
      last_error_code: null,
    };
  return {
    mail_account_id: acct.mail_account_id,
    email: String(acct.email),
    status: acct.status,
    last_synced_at: iso(acct.last_synced_at),
    last_error_code: acct.last_error_code ?? null,
  };
}

async function account(user, db = pool) {
  const a = await repo.accountOf(db, user.user_id);
  if (!a || a.status === "disconnected") throw noMailbox();
  return a;
}

/* ------------------------------------------------------------------ *
 * Connection
 * ------------------------------------------------------------------ */

async function getConnection(user) {
  return connectionView(await repo.accountOf(pool, user.user_id));
}

/** Test both directions with the password, then save it encrypted. Nothing is saved on a failure. */
async function connect(body, user) {
  const settings = autodiscover.settingsFor(body.email, serverSettings());
  if (config.MAILBOX_TLS === false) settings.tls = false;
  const provider = makeProvider({
    ...settings,
    email: body.email,
    password: body.password,
  });
  try {
    await provider.verify();
  } catch (err) {
    throw err.leg === "smtp" ? mapSmtpError(err) : mapImapError(err);
  }
  const saved = await tx(async (client) => {
    const existing = await repo.accountOf(client, user.user_id);
    const id = existing ? existing.mail_account_id : crypto.randomUUID();
    const secretId = await repo.saveSecret(client, {
      key: `mail_conn:${id}`,
      ciphertext: encryption.encrypt(body.password),
      by: user.user_id,
    });
    const row = await repo.upsertAccount(client, {
      ...settings,
      mail_account_id: id,
      user_id: user.user_id,
      email: body.email,
      integration_secret_id: secretId,
    });
    await emit(client, {
      key: EVENTS.MAIL_ACCOUNT_CONNECTED,
      entity: { type: "mail_account", id },
      actor: user,
      payload: { mail_account_id: id, user_id: user.user_id },
    });
    return row;
  });
  return connectionView(saved);
}

async function disconnect(user) {
  return tx(async (client) => {
    const a = await repo.accountOf(client, user.user_id);
    if (!a) return connectionView(null);
    await repo.retireSecret(client, a.integration_secret_id);
    await repo.setStatus(client, a.mail_account_id, { status: "disconnected" });
    await emit(client, {
      key: EVENTS.MAIL_ACCOUNT_DISCONNECTED,
      entity: { type: "mail_account", id: a.mail_account_id },
      actor: user,
      payload: { mail_account_id: a.mail_account_id },
    });
    return connectionView({ ...a, status: "disconnected" });
  });
}

/** Refresh: ask the worker for a sync now. */
async function requestSync(user) {
  const a = await account(user);
  await tx((client) =>
    emit(client, {
      key: EVENTS.MAIL_ACCOUNT_SYNC_REQUESTED,
      entity: { type: "mail_account", id: a.mail_account_id },
      actor: user,
      payload: { mail_account_id: a.mail_account_id },
    }),
  );
  return connectionView(a);
}

/* ------------------------------------------------------------------ *
 * Sync (worker)
 * ------------------------------------------------------------------ */

/** File one message from the server; null when it was already here. */
async function ingest(client, a, folder, m) {
  const internetId =
    normaliseId(m.messageId) ||
    `<uid.${m.uid}.${folder.uidvalidity || 0}.${folder.mail_folder_id}@mycity.local>`;
  const remoteId = `${folder.mail_folder_id}:${m.uid}`;
  const seen = await repo.messageByInternetId(
    client,
    a.mail_account_id,
    internetId,
  );
  if (seen) {
    if (seen.mail_folder_id !== folder.mail_folder_id) {
      await repo.moveMessageRow(
        client,
        seen.mail_message_id,
        folder.mail_folder_id,
        remoteId,
      );
      await repo.refreshThread(client, seen.mail_thread_id);
    }
    return null;
  }
  const outbound =
    folder.kind === "sent" ||
    String(m.from || "").toLowerCase() === String(a.email).toLowerCase();
  const participants = [m.from, ...(m.to || []), ...(m.cc || [])]
    .filter(Boolean)
    .map((x) => String(x).toLowerCase());
  const at = m.date ? new Date(m.date) : new Date();
  const files = (m.attachments || []).filter((x) => x.size <= MAX_ATTACHMENT);
  const t = await repo.upsertThread(client, {
    mail_account_id: a.mail_account_id,
    thread_key: threadKeyFor({ ...m, messageId: internetId }),
    subject: baseSubject(m.subject),
    participants: [...new Set(participants)],
    last_message_at: at,
    has_attachment: files.some((x) => !x.inline),
  });
  const html =
    folder.kind === "spam" ? null : cleanHtml(m.html) || textToHtml(m.text);
  const row = await repo.insertMessage(client, {
    mail_thread_id: t.mail_thread_id,
    mail_account_id: a.mail_account_id,
    mail_folder_id: folder.mail_folder_id,
    remote_id: remoteId,
    internet_message_id: internetId,
    from_address: m.from || String(a.email),
    from_name: m.fromName,
    to_addresses: m.to || [],
    cc_addresses: m.cc || [],
    subject: m.subject || "",
    body_text: m.text || null,
    body_html: html,
    snippet: snippetOf(m.text || String(m.html || "").replace(/<[^>]+>/g, " ")),
    direction: outbound ? "outgoing" : "incoming",
    sent_at: at,
    received_at: at,
    read_at: m.seen || outbound ? new Date() : null,
    in_reply_to: normaliseId(m.inReplyTo),
    references_header: (m.references || []).map(normaliseId).filter(Boolean),
    has_attachment: files.some((x) => !x.inline),
  });
  if (!row) return null;
  for (const f of files) {
    try {
      const doc = await vault.store(client, {
        file: { buffer: f.content, originalname: f.filename },
        purpose: "attachment",
        doc_type: "mail_attachment",
        entity: { type: "mail_message", id: row.mail_message_id },
        stranger: true,
        actor: null,
      });
      await repo.insertAttachment(client, {
        messageId: row.mail_message_id,
        documentId: doc.document_id,
        contentId: f.contentId,
        inline: f.inline,
      });
    } catch (err) {
      // A type the mime policy refuses stays on the server; the message is filed without it.
      logger.info(
        { err: err.message, code: err.code, file: f.filename },
        "mail attachment not kept",
      );
    }
  }
  await repo.refreshThread(client, t.mail_thread_id);
  const fresh = Date.now() - at.getTime() < FRESH_MS;
  if (!outbound && folder.kind === "inbox" && !m.seen && fresh) {
    await emit(client, {
      key: EVENTS.MAIL_MESSAGE_RECEIVED,
      entity: { type: "mail_thread", id: t.mail_thread_id },
      actor: null,
      payload: {
        mail_thread_id: t.mail_thread_id,
        user_id: a.user_id,
        from: m.fromName || m.from,
        subject: m.subject || "(no subject)",
      },
    });
  }
  return row.mail_message_id;
}

/**
 * One sync of one mailbox: folders, then new mail in each synced folder. A refused
 * password marks the mailbox for reconnecting and stops; any other failure is counted.
 */
async function sync(accountId) {
  const a = await repo.accountById(pool, accountId);
  if (!a || a.status !== "connected") return { skipped: true };
  let provider;
  let filed = 0;
  try {
    provider = await providerFor(pool, a);
    await tx(async (client) =>
      repo.upsertFolders(
        client,
        a.mail_account_id,
        mapFolders(await provider.listFolders()),
      ),
    );
    const folders = (await repo.folders(pool, a.mail_account_id)).filter((f) =>
      SYNCED.includes(f.kind),
    );
    for (const folder of folders) {
      let lastUid = Number(folder.last_uid || 0);
      for (let pass = 0; pass < 20; pass += 1) {
        const got = await provider.fetchSince(folder.remote_key, { lastUid });
        if (
          folder.uidvalidity !== null &&
          folder.uidvalidity !== undefined &&
          Number(folder.uidvalidity) !== got.uidValidity &&
          lastUid > 0
        ) {
          // The server renumbered the folder: read it again from the start; known messages are skipped.
          folder.uidvalidity = got.uidValidity;
          lastUid = 0;
          continue;
        }
        folder.uidvalidity = got.uidValidity;
        for (const m of got.messages) {
          if (await tx((client) => ingest(client, a, folder, m))) filed += 1;
        }
        lastUid = got.lastUid;
        await repo.setCursor(pool, folder.mail_folder_id, {
          uidValidity: got.uidValidity,
          lastUid,
        });
        if (!got.more) break;
      }
    }
    await repo.syncSucceeded(pool, a.mail_account_id);
    return { mail_account_id: a.mail_account_id, filed };
  } catch (err) {
    const mapped = mapImapError(err);
    const after = await repo.syncFailed(pool, a.mail_account_id, mapped.code);
    if (after && after.status === "needs_reconnect") {
      await tx((client) =>
        emit(client, {
          key: EVENTS.MAIL_ACCOUNT_NEEDS_RECONNECT,
          entity: { type: "mail_account", id: a.mail_account_id },
          actor: null,
          payload: { mail_account_id: a.mail_account_id, user_id: a.user_id },
          dedup_key: `mailbox:reconnect:${a.mail_account_id}:${new Date().toISOString().slice(0, 13)}`,
        }),
      );
    }
    logger.warn(
      { err: err.message, mail_account_id: a.mail_account_id },
      "mail sync failed",
    );
    return { mail_account_id: a.mail_account_id, filed, error: mapped.code };
  }
}

async function syncAll() {
  const ids = await repo.syncable(pool);
  const out = [];
  for (const id of ids) out.push(await sync(id));
  return {
    mailboxes: ids.length,
    filed: out.reduce((s, r) => s + (r.filed || 0), 0),
  };
}

/* ------------------------------------------------------------------ *
 * Reading and moving
 * ------------------------------------------------------------------ */

function partyOf(row, folder) {
  if (folder === "sent" || row.direction === "outgoing") {
    const to = (row.to_addresses || [])[0];
    return to ? { name: null, address: to } : null;
  }
  return row.from_address
    ? { name: row.from_name || null, address: row.from_address }
    : null;
}

async function listThreads(user, query) {
  const a = await account(user);
  if (query.folder === "drafts") {
    const page = await repo.listDrafts(pool, user.user_id, query);
    return {
      ...page,
      data: page.data.map((d) => ({
        mail_thread_id: d.mail_draft_id,
        folder: "drafts",
        subject: d.subject || "(no subject)",
        party:
          d.to_addresses && d.to_addresses[0]
            ? { name: null, address: d.to_addresses[0] }
            : null,
        snippet: snippetOf(textOf(d.body_html)),
        last_message_at: iso(d.updated_at),
        unread: false,
        has_attachment: d.has_attachment,
        message_count: 0,
        mail_draft_id: d.mail_draft_id,
        scheduled: d.mail_send_queue_id
          ? {
              mail_send_queue_id: d.mail_send_queue_id,
              release_at: iso(d.release_at),
            }
          : null,
      })),
    };
  }
  const page = await repo.listThreads(pool, a.mail_account_id, query);
  return {
    ...page,
    data: page.data.map((t) => ({
      mail_thread_id: t.mail_thread_id,
      folder: query.folder || "inbox",
      subject: t.subject || "(no subject)",
      party: partyOf(t, query.folder),
      snippet: t.snippet || "",
      last_message_at: iso(t.last_message_at),
      unread: t.unread,
      has_attachment: t.has_attachment,
      message_count: t.message_count,
      mail_draft_id: null,
      scheduled: null,
    })),
  };
}

async function getThread(threadId, user) {
  const a = await account(user);
  const t = await repo.thread(pool, a.mail_account_id, threadId);
  if (!t) throw new AppError("NOT_FOUND", "There is no such message", 404);
  const rows = await repo.messages(pool, threadId);
  return {
    mail_thread_id: t.mail_thread_id,
    folder: t.folder || "inbox",
    subject: t.subject || "(no subject)",
    messages: rows.map((m) => ({
      mail_message_id: m.mail_message_id,
      from: { name: m.from_name || null, address: m.from_address },
      to: m.to_addresses || [],
      cc: m.cc_addresses || [],
      sent_at: iso(m.sent_at),
      body_html:
        m.folder === "spam"
          ? null
          : m.body_html || textToHtml(m.body_text) || "",
      attachments: (m.attachments || []).map((x) => ({
        ...x,
        size_bytes: Number(x.size_bytes),
      })),
    })),
  };
}

/** Local first, then the server, best effort and after the answer (the local change wins). */
function later(work, what) {
  setImmediate(() =>
    Promise.resolve()
      .then(work)
      .catch((err) =>
        logger.warn(
          { err: err.message },
          `mailbox: ${what} not mirrored to the server`,
        ),
      ),
  );
}

async function markRead(threadId, user) {
  const a = await account(user);
  if (!(await repo.thread(pool, a.mail_account_id, threadId)))
    throw new AppError("NOT_FOUND", "There is no such message", 404);
  const changed = await tx(async (client) => {
    const rows = await repo.markThreadRead(client, threadId);
    await repo.refreshThread(client, threadId);
    return rows;
  });
  if (changed.length) {
    later(async () => {
      const p = await providerFor(pool, a);
      for (const m of changed)
        await p.markSeen(m.remote_key, m.internet_message_id);
    }, "read");
  }
}

async function move(threadId, to, user) {
  const a = await account(user);
  if (!(await repo.thread(pool, a.mail_account_id, threadId)))
    throw new AppError("NOT_FOUND", "There is no such message", 404);
  const dest = await repo.folderOfKind(pool, a.mail_account_id, to);
  if (!dest)
    throw new AppError(
      "NO_SUCH_FOLDER",
      "Your mail server has no folder for that",
      422,
    );
  const moved = await tx(async (client) => {
    const rows = await repo.moveThread(client, threadId, dest.mail_folder_id);
    await repo.refreshThread(client, threadId);
    await emit(client, {
      key: EVENTS.MAIL_THREAD_MOVED,
      entity: { type: "mail_thread", id: threadId },
      actor: user,
      payload: { mail_thread_id: threadId, to },
    });
    return rows;
  });
  later(async () => {
    const p = await providerFor(pool, a);
    for (const m of moved)
      await p.move(m.from_key, dest.remote_key, m.internet_message_id);
  }, "move");
  const rows = await listThreads(user, { folder: to, page: 1 });
  return rows.data.find((r) => r.mail_thread_id === threadId) || null;
}

async function emptyFolder(kind, user) {
  const a = await account(user);
  const folder = await repo.folderOfKind(pool, a.mail_account_id, kind);
  if (!folder) return { removed: 0 };
  const ids = await tx(async (client) => {
    const gone = await repo.emptyFolder(client, folder.mail_folder_id);
    await emit(client, {
      key: EVENTS.MAIL_FOLDER_EMPTIED,
      entity: { type: "mail_account", id: a.mail_account_id },
      actor: user,
      payload: {
        mail_account_id: a.mail_account_id,
        folder: kind,
        removed: gone.length,
      },
    });
    return gone;
  });
  later(
    async () => (await providerFor(pool, a)).remove(folder.remote_key, ids),
    "empty",
  );
  return { removed: ids.length };
}

/* ------------------------------------------------------------------ *
 * Drafts, attachments and sending
 * ------------------------------------------------------------------ */

function draftView(d) {
  return {
    mail_draft_id: d.mail_draft_id,
    to_addresses: d.to_addresses || [],
    cc_addresses: d.cc_addresses || [],
    bcc_addresses: d.bcc_addresses || [],
    subject: d.subject || "",
    body_html: d.body_html || "",
    attachments: (d.attachments || []).map((x) => ({
      ...x,
      size_bytes: Number(x.size_bytes),
    })),
    in_reply_to: d.in_reply_to ?? null,
    updated_at: iso(d.updated_at),
  };
}

async function getDraft(id, user) {
  const d = await repo.draft(pool, user.user_id, id);
  if (!d) throw new AppError("NOT_FOUND", "There is no such draft", 404);
  return draftView(d);
}

async function saveDraft(id, body, user) {
  const a = await account(user);
  const saved = await repo.saveDraft(pool, {
    id,
    userId: user.user_id,
    accountId: a.mail_account_id,
    d: body,
  });
  if (!saved) throw new AppError("NOT_FOUND", "There is no such draft", 404);
  return getDraft(id, user);
}

async function deleteDraft(id, user) {
  await repo.deleteDraft(pool, user.user_id, id);
}

/** A file for the composer, held in the vault against the caller's mailbox. */
async function storeAttachment(upload, user) {
  const a = await account(user);
  return tx(async (client) => {
    const doc = await vault.store(client, {
      file: upload,
      purpose: "attachment",
      doc_type: "mail_attachment",
      entity: { type: "mail_account", id: a.mail_account_id },
      actor: user,
    });
    return {
      document_id: doc.document_id,
      file_name: doc.original_name || "attachment",
      size_bytes: Number(doc.bytes),
      mime_type: doc.mime,
    };
  });
}

/** Put a message on the send queue: now, or at `release_at` (in the future). */
async function send(body, user, idempotencyKey) {
  const a = await account(user);
  if (a.status !== "connected")
    throw new AppError("MAIL_AUTH_FAILED", "Reconnect your mailbox", 409);
  const release = body.release_at ? new Date(body.release_at) : new Date();
  if (body.release_at && release.getTime() <= Date.now()) {
    throw new AppError("RELEASE_PASSED", "That time has already passed", 422, {
      release_at: ["Time already passed"],
    });
  }
  if (body.release_at && release.getTime() > Date.now() + 90 * 86400000) {
    throw new AppError("RELEASE_TOO_FAR", "Schedule within 90 days", 422, {
      release_at: ["Within 90 days"],
    });
  }
  const queued = await tx(async (client) => {
    await repo.saveDraft(client, {
      id: body.mail_draft_id,
      userId: user.user_id,
      accountId: a.mail_account_id,
      d: body,
    });
    const row = await repo.enqueue(client, {
      user_id: user.user_id,
      mail_account_id: a.mail_account_id,
      mail_draft_id: body.mail_draft_id,
      payload: { ...body, release_at: undefined },
      release_at: release,
      idempotency_key: idempotencyKey
        ? `${user.user_id}:${idempotencyKey}`
        : null,
    });
    await emit(client, {
      key: EVENTS.MAIL_MESSAGE_QUEUED,
      entity: { type: "mail_account", id: a.mail_account_id },
      actor: user,
      payload: {
        mail_send_queue_id: row.mail_send_queue_id,
        release_at: iso(row.release_at),
      },
    });
    return row;
  });
  return {
    mail_send_queue_id: queued.mail_send_queue_id,
    status: queued.status,
    release_at: iso(queued.release_at),
  };
}

async function cancel(queueId, user) {
  const row = await repo.cancelQueued(pool, user.user_id, queueId);
  if (!row) throw new AppError("ALREADY_SENT", "It has already gone", 409);
  return {
    mail_send_queue_id: row.mail_send_queue_id,
    status: row.status,
    release_at: iso(row.release_at),
  };
}

/** Recipients one account may send to in an hour, from the host's plan (mailbox.md §6). */
const PER_HOUR = () => Number(config.MAILBOX_SEND_PER_HOUR) || 50;

/** Deliver one queued message (worker). */
async function deliver(q) {
  const a = await repo.accountById(pool, q.mail_account_id);
  const p = q.payload || {};
  try {
    if (!a || a.status !== "connected")
      throw new AppError("MAIL_AUTH_FAILED", "Reconnect your mailbox", 422);
    const count =
      (p.to_addresses || []).length +
      (p.cc_addresses || []).length +
      (p.bcc_addresses || []).length;
    if (
      (await repo.sentLastHour(pool, a.mail_account_id)) + count >
      PER_HOUR()
    ) {
      await repo.markFailed(pool, q.mail_send_queue_id, {
        code: "HOURLY_LIMIT",
        message: "the host's hourly limit",
        retryAt: new Date(Date.now() + 10 * 60 * 1000),
      });
      return { mail_send_queue_id: q.mail_send_queue_id, postponed: true };
    }
    const parent = p.in_reply_to
      ? await repo.messageOf(pool, a.mail_account_id, p.in_reply_to)
      : null;
    const references = parent
      ? [
          ...(parent.references_header || []),
          parent.internet_message_id,
        ].filter(Boolean)
      : [];
    const files = [];
    for (const id of p.document_ids || []) {
      const doc = await vault.get(pool, id);
      if (doc && doc.scan_status !== "infected") {
        files.push({
          filename: doc.original_name || "attachment",
          contentType: doc.mime,
          content: await storage.get(doc.storage_key),
          document_id: doc.document_id,
        });
      }
    }
    const html = outgoingHtml(p.body_html);
    const provider = await providerFor(pool, a, null);
    const sent = await provider.send({
      to: p.to_addresses,
      cc: p.cc_addresses,
      bcc: p.bcc_addresses,
      subject: p.subject || "",
      html,
      text: textOf(html),
      inReplyTo: parent ? parent.internet_message_id : null,
      references,
      attachments: files,
    });
    await tx(async (client) => {
      const sentFolder = await repo.folderOfKind(
        client,
        a.mail_account_id,
        "sent",
      );
      const t = await repo.upsertThread(client, {
        mail_account_id: a.mail_account_id,
        thread_key: threadKeyFor({
          messageId: sent.messageId,
          inReplyTo: parent && parent.internet_message_id,
          references,
        }),
        subject: baseSubject(p.subject),
        participants: [
          String(a.email),
          ...p.to_addresses,
          ...(p.cc_addresses || []),
        ].map((x) => String(x).toLowerCase()),
        last_message_at: new Date(),
        has_attachment: files.length > 0,
      });
      const row = await repo.insertMessage(client, {
        mail_thread_id: t.mail_thread_id,
        mail_account_id: a.mail_account_id,
        mail_folder_id: sentFolder ? sentFolder.mail_folder_id : null,
        remote_id: null,
        internet_message_id: sent.messageId,
        from_address: String(a.email),
        from_name: null,
        to_addresses: p.to_addresses,
        cc_addresses: p.cc_addresses || [],
        subject: p.subject || "",
        body_text: textOf(html),
        body_html: html,
        snippet: snippetOf(textOf(html)),
        direction: "outgoing",
        sent_at: new Date(),
        received_at: new Date(),
        read_at: new Date(),
        in_reply_to: parent ? parent.internet_message_id : null,
        references_header: references,
        has_attachment: files.length > 0,
      });
      if (row)
        for (const f of files)
          await repo.insertAttachment(client, {
            messageId: row.mail_message_id,
            documentId: f.document_id,
          });
      await repo.refreshThread(client, t.mail_thread_id);
      await repo.markSent(
        client,
        q.mail_send_queue_id,
        row ? row.mail_message_id : null,
      );
      if (q.mail_draft_id)
        await repo.deleteDraft(client, q.user_id, q.mail_draft_id);
      await emit(client, {
        key: EVENTS.MAIL_MESSAGE_SENT,
        entity: { type: "mail_thread", id: t.mail_thread_id },
        actor: null,
        payload: {
          mail_thread_id: t.mail_thread_id,
          mail_send_queue_id: q.mail_send_queue_id,
          user_id: q.user_id,
        },
      });
    });
    return { mail_send_queue_id: q.mail_send_queue_id, sent: true };
  } catch (err) {
    const mapped = mapSmtpError(err);
    const plan = retryPlan(mapped, q.attempts);
    await repo.markFailed(pool, q.mail_send_queue_id, {
      code: mapped.code,
      message: mapped.message,
      retryAt: plan.retryAt,
    });
    if (!plan.retryAt) {
      if (mapped.code === "MAIL_AUTH_FAILED" && a)
        await repo.setStatus(pool, a.mail_account_id, {
          status: "needs_reconnect",
          code: mapped.code,
        });
      await tx((client) =>
        emit(client, {
          key: EVENTS.MAIL_SEND_FAILED,
          entity: { type: "mail_account", id: q.mail_account_id },
          actor: null,
          payload: {
            mail_send_queue_id: q.mail_send_queue_id,
            user_id: q.user_id,
            subject: p.subject || "(no subject)",
            reason: mapped.message,
          },
        }),
      );
    }
    return {
      mail_send_queue_id: q.mail_send_queue_id,
      sent: false,
      code: mapped.code,
    };
  }
}

/** Send what is due: one row by id (the delayed job), or everything due (the safety net). */
async function flush(queueId = null) {
  if (queueId) {
    const q = await repo.claimOne(pool, queueId);
    return q ? [await deliver(q)] : [];
  }
  await repo.requeueStalled(pool);
  const out = [];
  for (const q of await repo.claimDue(pool)) out.push(await deliver(q));
  return out;
}

module.exports = {
  useProvider,
  connectionView,
  getConnection,
  connect,
  disconnect,
  requestSync,
  ingest,
  sync,
  syncAll,
  listThreads,
  getThread,
  markRead,
  move,
  emptyFolder,
  getDraft,
  saveDraft,
  deleteDraft,
  storeAttachment,
  send,
  cancel,
  deliver,
  flush,
  PER_HOUR,
};
