"use strict";
/**
 * Mailbox's SQL (migrations 1000 and 1120): the caller's account and its encrypted
 * secret, folders, threads, messages, attachments and drafts. Every read starts from the
 * account, and the account from the caller's user id, so a person reaches only their own
 * mail (mailbox.md §6). Lists page at 25 through shared/http/paged.js.
 *
 * Address arrays are citext[]: node-postgres has no parser for an extension's array
 * type and hands back the literal "{a,b}", so every read casts them to text[].
 */
const { pageQuery, TOTAL_COL } = require("../../shared/http/paged");

const one = async (db, sql, params) =>
  (await db.query(sql, params)).rows[0] || null;

/* ------------------------------------------------------------------ *
 * Account and secret
 * ------------------------------------------------------------------ */

function accountOf(db, userId) {
  return one(db, "SELECT * FROM mail_account WHERE user_id = $1", [userId]);
}

function accountById(db, id) {
  return one(db, "SELECT * FROM mail_account WHERE mail_account_id = $1", [id]);
}

/** Every account the worker syncs: connected, or failing but not yet given up on. */
async function syncable(db) {
  const { rows } = await db.query(
    `SELECT mail_account_id FROM mail_account WHERE status = 'connected' ORDER BY last_synced_at NULLS FIRST
      LIMIT 30 -- pagination:batch the host's plan holds 30 mailboxes; one sync pass covers them all`,
  );
  return rows.map((r) => r.mail_account_id);
}

async function saveSecret(db, { key, ciphertext, by }) {
  const row = await one(
    db,
    `INSERT INTO integration_secret (provider, key, ciphertext, created_by)
     VALUES ('mailbox', $1, $2, $3)
     ON CONFLICT (provider, key) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, active = true, rotated_at = now()
     RETURNING integration_secret_id`,
    [key, ciphertext, by ?? null],
  );
  return row.integration_secret_id;
}

function secretOf(db, secretId) {
  return one(
    db,
    "SELECT ciphertext FROM integration_secret WHERE integration_secret_id = $1 AND active",
    [secretId],
  );
}

function retireSecret(db, secretId) {
  return db.query(
    "UPDATE integration_secret SET active = false, ciphertext = '', rotated_at = now() WHERE integration_secret_id = $1",
    [secretId],
  );
}

function upsertAccount(db, a) {
  return one(
    db,
    `INSERT INTO mail_account (mail_account_id, user_id, email, incoming_protocol, incoming_host, incoming_port,
                               outgoing_host, outgoing_port, username, integration_secret_id, tls, status)
     VALUES ($1, $2, $3, 'imap', $4, $5, $6, $7, $8, $9, $10, 'connected')
     ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, incoming_host = EXCLUDED.incoming_host,
            incoming_port = EXCLUDED.incoming_port, outgoing_host = EXCLUDED.outgoing_host,
            outgoing_port = EXCLUDED.outgoing_port, username = EXCLUDED.username,
            integration_secret_id = EXCLUDED.integration_secret_id, tls = EXCLUDED.tls,
            status = 'connected', last_error_code = NULL, consecutive_failures = 0
     RETURNING *`,
    [
      a.mail_account_id,
      a.user_id,
      a.email,
      a.incoming_host,
      a.incoming_port,
      a.outgoing_host,
      a.outgoing_port,
      a.username,
      a.integration_secret_id,
      a.tls,
    ],
  );
}

function setStatus(db, id, { status, code = null }) {
  return db.query(
    `UPDATE mail_account SET status = $2, last_error_code = $3,
            consecutive_failures = CASE WHEN $2 = 'connected' AND $3::text IS NULL THEN 0 ELSE consecutive_failures END
      WHERE mail_account_id = $1`,
    [id, status, code],
  );
}

function syncSucceeded(db, id) {
  return db.query(
    "UPDATE mail_account SET last_synced_at = now(), consecutive_failures = 0, last_error_code = NULL WHERE mail_account_id = $1 AND status = 'connected'",
    [id],
  );
}

/** A failed sync: three in a row of anything but a refused password is still connected. */
function syncFailed(db, id, code) {
  return one(
    db,
    `UPDATE mail_account SET consecutive_failures = consecutive_failures + 1, last_error_code = $2,
            status = CASE WHEN $2 = 'MAIL_AUTH_FAILED' THEN 'needs_reconnect' ELSE status END
      WHERE mail_account_id = $1 RETURNING status, consecutive_failures`,
    [id, code],
  );
}

/* ------------------------------------------------------------------ *
 * Folders
 * ------------------------------------------------------------------ */

async function upsertFolders(db, accountId, rows) {
  for (const f of rows) {
    await db.query(
      `INSERT INTO mail_folder (mail_account_id, remote_key, name, special_use, kind)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (mail_account_id, remote_key) DO UPDATE SET name = EXCLUDED.name, special_use = EXCLUDED.special_use,
              kind = CASE WHEN EXISTS (SELECT 1 FROM mail_folder o WHERE o.mail_account_id = $1 AND o.kind = EXCLUDED.kind
                                         AND o.remote_key <> EXCLUDED.remote_key) THEN mail_folder.kind ELSE EXCLUDED.kind END`,
      [accountId, f.remote_key, f.name, f.special_use, f.kind],
    );
  }
}

async function folders(db, accountId) {
  const { rows } = await db.query(
    "SELECT * FROM mail_folder WHERE mail_account_id = $1 AND kind IS NOT NULL ORDER BY kind",
    [accountId],
  );
  return rows;
}

function folderOfKind(db, accountId, kind) {
  return one(
    db,
    "SELECT * FROM mail_folder WHERE mail_account_id = $1 AND kind = $2",
    [accountId, kind],
  );
}

function setCursor(db, folderId, { uidValidity, lastUid, error = null }) {
  return db.query(
    `UPDATE mail_folder SET uidvalidity = COALESCE($2, uidvalidity), last_uid = COALESCE($3, last_uid),
            last_sync_at = CASE WHEN $4::text IS NULL THEN now() ELSE last_sync_at END, last_error = $4
      WHERE mail_folder_id = $1`,
    [folderId, uidValidity ?? null, lastUid ?? null, error],
  );
}

/* ------------------------------------------------------------------ *
 * Threads and messages
 * ------------------------------------------------------------------ */

function messageByInternetId(db, accountId, internetId) {
  return one(
    db,
    "SELECT mail_message_id, mail_thread_id, mail_folder_id FROM mail_message WHERE mail_account_id = $1 AND internet_message_id = $2",
    [accountId, internetId],
  );
}

/** Find or make the thread for a key, folding the new message's facts in. */
function upsertThread(db, t) {
  return one(
    db,
    `INSERT INTO mail_thread (mail_account_id, thread_key, subject, participant_addresses, last_message_at, has_attachment)
     VALUES ($1, $2, $3, $4::citext[], $5, $6)
     ON CONFLICT (mail_account_id, thread_key) WHERE thread_key IS NOT NULL DO UPDATE
       SET participant_addresses = ARRAY(SELECT DISTINCT p FROM unnest(mail_thread.participant_addresses || EXCLUDED.participant_addresses) AS p ORDER BY p),
           last_message_at = GREATEST(mail_thread.last_message_at, EXCLUDED.last_message_at),
           has_attachment = mail_thread.has_attachment OR EXCLUDED.has_attachment
     RETURNING mail_thread_id`,
    [
      t.mail_account_id,
      t.thread_key,
      t.subject || "(no subject)",
      t.participants,
      t.last_message_at,
      t.has_attachment,
    ],
  );
}

function insertMessage(db, m) {
  return one(
    db,
    `INSERT INTO mail_message (mail_thread_id, mail_account_id, mail_folder_id, remote_id, internet_message_id,
                               from_address, from_name, to_addresses, cc_addresses, subject, body_text, body_html,
                               snippet, direction, sent_at, received_at, read_at, in_reply_to, references_header, has_attachment)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::citext[], $9::citext[], $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
     ON CONFLICT (mail_account_id, internet_message_id) WHERE internet_message_id IS NOT NULL DO NOTHING
     RETURNING mail_message_id`,
    [
      m.mail_thread_id,
      m.mail_account_id,
      m.mail_folder_id,
      m.remote_id,
      m.internet_message_id,
      m.from_address,
      m.from_name,
      m.to_addresses,
      m.cc_addresses,
      m.subject,
      m.body_text,
      m.body_html,
      m.snippet,
      m.direction,
      m.sent_at,
      m.received_at,
      m.read_at,
      m.in_reply_to,
      m.references_header,
      m.has_attachment,
    ],
  );
}

/** A message seen again in another folder: the server moved it. */
function moveMessageRow(db, messageId, folderId, remoteId) {
  return db.query(
    "UPDATE mail_message SET mail_folder_id = $2, remote_id = $3 WHERE mail_message_id = $1",
    [messageId, folderId, remoteId],
  );
}

/** Counts a thread carries, from its messages. */
function refreshThread(db, threadId) {
  return db.query(
    `UPDATE mail_thread t SET
        message_count = s.n, unread_count = s.unread, has_attachment = s.att, last_message_at = COALESCE(s.last, t.last_message_at)
       FROM (SELECT count(*)::int AS n, count(*) FILTER (WHERE read_at IS NULL)::int AS unread,
                    bool_or(has_attachment) AS att, max(received_at) AS last
               FROM mail_message WHERE mail_thread_id = $1) s
      WHERE t.mail_thread_id = $1`,
    [threadId],
  );
}

function insertAttachment(db, { messageId, documentId, contentId, inline }) {
  return db.query(
    `INSERT INTO mail_attachment (mail_message_id, document_id, content_id, inline) VALUES ($1, $2, $3, $4)
     ON CONFLICT (mail_message_id, document_id) DO NOTHING`,
    [messageId, documentId, contentId ?? null, Boolean(inline)],
  );
}

/** The folder a thread is in: where its newest message is. */
const THREAD_FOLDER = `(SELECT f.kind FROM mail_message mm JOIN mail_folder f ON f.mail_folder_id = mm.mail_folder_id
                         WHERE mm.mail_thread_id = t.mail_thread_id ORDER BY mm.received_at DESC, mm.mail_message_id DESC LIMIT 1)`;

/** A folder's threads, newest first; a thread is listed in the folder of each of its messages. */
function listThreads(db, accountId, query) {
  return pageQuery(
    db,
    `SELECT t.mail_thread_id, t.subject, t.last_message_at, t.has_attachment, t.message_count,
            agg.snippet, agg.from_address, agg.from_name, string_to_array(agg.to_list, ',') AS to_addresses,
            agg.direction, agg.unread, ${TOTAL_COL}
       FROM mail_thread t
       JOIN mail_folder f ON f.mail_account_id = t.mail_account_id AND f.kind = $2
       JOIN LATERAL (
         SELECT (array_agg(m.snippet ORDER BY m.received_at DESC))[1] AS snippet,
                (array_agg(m.from_address::text ORDER BY m.received_at DESC))[1] AS from_address,
                (array_agg(m.from_name ORDER BY m.received_at DESC))[1] AS from_name,
                (array_agg(array_to_string(m.to_addresses::text[], ',') ORDER BY m.received_at DESC))[1] AS to_list,
                (array_agg(m.direction ORDER BY m.received_at DESC))[1] AS direction,
                bool_or(m.read_at IS NULL) AS unread,
                count(*) AS here
           FROM mail_message m WHERE m.mail_thread_id = t.mail_thread_id AND m.mail_folder_id = f.mail_folder_id) agg ON agg.here > 0
      WHERE t.mail_account_id = $1
        AND ($3::text IS NULL OR search_fold(t.subject || ' ' || array_to_string(t.participant_addresses::text[], ' ')) LIKE '%' || search_fold($3) || '%')
        AND (NOT $4::boolean OR agg.unread)
      ORDER BY t.last_message_at DESC, t.mail_thread_id`,
    [
      accountId,
      query.folder || "inbox",
      query.q ?? null,
      Boolean(query.unread),
    ],
    query,
  );
}

function thread(db, accountId, threadId) {
  return one(
    db,
    `SELECT t.mail_thread_id, t.subject, ${THREAD_FOLDER} AS folder
       FROM mail_thread t WHERE t.mail_thread_id = $2 AND t.mail_account_id = $1`,
    [accountId, threadId],
  );
}

/** A thread's messages, oldest first, with their files and folders. */
async function messages(db, threadId) {
  const { rows } = await db.query(
    `SELECT m.mail_message_id, m.from_address::text AS from_address, m.from_name, m.to_addresses::text[] AS to_addresses,
            m.cc_addresses::text[] AS cc_addresses, COALESCE(m.received_at, m.sent_at, m.created_at) AS sent_at, m.body_html,
            m.body_text, m.internet_message_id, m.references_header, m.subject, m.read_at, f.kind AS folder, f.remote_key,
            COALESCE((SELECT json_agg(json_build_object('mail_attachment_id', a.mail_attachment_id, 'document_id', d.document_id,
                       'file_name', COALESCE(d.original_name, d.title, 'attachment'), 'size_bytes', d.bytes, 'mime_type', d.mime)
                       ORDER BY a.created_at)
                        FROM mail_attachment a JOIN document d ON d.document_id = a.document_id
                       WHERE a.mail_message_id = m.mail_message_id AND NOT a.inline), '[]') AS attachments
       FROM mail_message m LEFT JOIN mail_folder f ON f.mail_folder_id = m.mail_folder_id
      WHERE m.mail_thread_id = $1
      ORDER BY COALESCE(m.received_at, m.sent_at, m.created_at), m.mail_message_id
      LIMIT 200 -- pagination:batch one conversation is read whole, capped well above any real thread`,
    [threadId],
  );
  return rows;
}

/** Mark a thread read; returns the messages that were unread, for the server. */
async function markThreadRead(db, threadId) {
  const { rows } = await db.query(
    `UPDATE mail_message m SET read_at = now() FROM mail_folder f
      WHERE m.mail_thread_id = $1 AND m.read_at IS NULL AND f.mail_folder_id = m.mail_folder_id
      RETURNING m.internet_message_id, f.remote_key`,
    [threadId],
  );
  return rows;
}

/** Move every message of a thread to one folder; returns where each was, for the server. */
async function moveThread(db, threadId, folderId) {
  const { rows } = await db.query(
    `WITH before AS (SELECT m.mail_message_id, m.internet_message_id, f.remote_key AS from_key
                       FROM mail_message m JOIN mail_folder f ON f.mail_folder_id = m.mail_folder_id
                      WHERE m.mail_thread_id = $1 AND m.mail_folder_id <> $2)
     UPDATE mail_message m SET mail_folder_id = $2 FROM before b
      WHERE m.mail_message_id = b.mail_message_id
      RETURNING b.internet_message_id, b.from_key`,
    [threadId, folderId],
  );
  return rows;
}

/** Remove a folder's messages for good, and threads left empty; returns them, for the server. */
async function emptyFolder(db, folderId) {
  const { rows } = await db.query(
    "DELETE FROM mail_message WHERE mail_folder_id = $1 RETURNING internet_message_id, mail_thread_id",
    [folderId],
  );
  const threads = [...new Set(rows.map((r) => r.mail_thread_id))];
  if (threads.length) {
    await db.query(
      "DELETE FROM mail_thread t WHERE t.mail_thread_id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM mail_message m WHERE m.mail_thread_id = t.mail_thread_id)",
      [threads],
    );
    for (const id of threads) await refreshThread(db, id);
  }
  return rows.map((r) => r.internet_message_id).filter(Boolean);
}

function messageOf(db, accountId, messageId) {
  return one(
    db,
    `SELECT m.*, m.to_addresses::text[] AS to_addresses, m.cc_addresses::text[] AS cc_addresses, m.from_address::text AS from_address
       FROM mail_message m WHERE m.mail_message_id = $2 AND m.mail_account_id = $1`,
    [accountId, messageId],
  );
}

/* ------------------------------------------------------------------ *
 * Drafts and the send queue
 * ------------------------------------------------------------------ */

const DRAFT = `d.mail_draft_id, d.to_addresses, d.cc_addresses, d.bcc_addresses, d.subject, d.body_html, d.document_ids,
               d.in_reply_to, d.updated_at,
               COALESCE((SELECT json_agg(json_build_object('document_id', doc.document_id,
                          'file_name', COALESCE(doc.original_name, doc.title, 'attachment'), 'size_bytes', doc.bytes, 'mime_type', doc.mime)
                          ORDER BY doc.created_at)
                           FROM document doc WHERE doc.document_id = ANY(d.document_ids)), '[]') AS attachments`;

function draft(db, userId, draftId) {
  return one(
    db,
    `SELECT ${DRAFT} FROM mail_draft d WHERE d.mail_draft_id = $2 AND d.user_id = $1`,
    [userId, draftId],
  );
}

function saveDraft(db, { id, userId, accountId, d }) {
  return one(
    db,
    `INSERT INTO mail_draft (mail_draft_id, user_id, mail_account_id, to_addresses, cc_addresses, bcc_addresses, subject, body_html, document_ids, in_reply_to)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (mail_draft_id) DO UPDATE SET to_addresses = EXCLUDED.to_addresses, cc_addresses = EXCLUDED.cc_addresses,
            bcc_addresses = EXCLUDED.bcc_addresses, subject = EXCLUDED.subject, body_html = EXCLUDED.body_html,
            document_ids = EXCLUDED.document_ids, in_reply_to = EXCLUDED.in_reply_to
      WHERE mail_draft.user_id = $2
     RETURNING mail_draft_id`,
    [
      id,
      userId,
      accountId,
      d.to_addresses,
      d.cc_addresses,
      d.bcc_addresses,
      d.subject,
      d.body_html,
      d.document_ids,
      d.in_reply_to,
    ],
  );
}

function deleteDraft(db, userId, draftId) {
  return db.query(
    "DELETE FROM mail_draft WHERE mail_draft_id = $2 AND user_id = $1",
    [userId, draftId],
  );
}

/** Drafts as rows of the Drafts folder, newest first, with a schedule when one waits on the queue. */
function listDrafts(db, userId, query) {
  return pageQuery(
    db,
    `SELECT d.mail_draft_id, d.subject, d.to_addresses, d.body_html, d.updated_at,
            cardinality(d.document_ids) > 0 AS has_attachment,
            q.mail_send_queue_id, q.release_at, ${TOTAL_COL}
       FROM mail_draft d
       LEFT JOIN mail_send_queue q ON q.mail_draft_id = d.mail_draft_id AND q.status = 'queued'
      WHERE d.user_id = $1
        AND ($2::text IS NULL OR search_fold(d.subject || ' ' || array_to_string(d.to_addresses, ' ')) LIKE '%' || search_fold($2) || '%')
      ORDER BY d.updated_at DESC, d.mail_draft_id`,
    [userId, query.q ?? null],
    query,
  );
}

function enqueue(db, q) {
  return one(
    db,
    `INSERT INTO mail_send_queue (user_id, mail_account_id, mail_draft_id, payload, release_at, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET updated_at = now()
     RETURNING mail_send_queue_id, status, release_at`,
    [
      q.user_id,
      q.mail_account_id,
      q.mail_draft_id,
      q.payload,
      q.release_at,
      q.idempotency_key ?? null,
    ],
  );
}

function cancelQueued(db, userId, queueId) {
  return one(
    db,
    `UPDATE mail_send_queue SET status = 'cancelled' WHERE mail_send_queue_id = $2 AND user_id = $1 AND status = 'queued'
     RETURNING mail_send_queue_id, status, release_at`,
    [userId, queueId],
  );
}

/** Claim what is due, one worker at a time per row. */
async function claimDue(db) {
  const { rows } = await db.query(
    `UPDATE mail_send_queue q SET status = 'sending', attempts = q.attempts + 1
      WHERE q.mail_send_queue_id IN (SELECT mail_send_queue_id FROM mail_send_queue
                                      WHERE status = 'queued' AND release_at <= now()
                                      ORDER BY release_at FOR UPDATE SKIP LOCKED
                                      LIMIT 20 -- pagination:batch the sender works through what is due in batches
                                     )
      RETURNING q.*`,
  );
  return rows;
}

function claimOne(db, queueId) {
  return one(
    db,
    `UPDATE mail_send_queue SET status = 'sending', attempts = attempts + 1
      WHERE mail_send_queue_id = $1 AND status = 'queued' AND release_at <= now() RETURNING *`,
    [queueId],
  );
}

/** Rows stuck in sending for ten minutes (a worker died) go back on the queue. */
function requeueStalled(db) {
  return db.query(
    "UPDATE mail_send_queue SET status = 'queued' WHERE status = 'sending' AND updated_at < now() - interval '10 minutes' AND attempts < 3",
  );
}

function markSent(db, queueId, messageId) {
  return db.query(
    "UPDATE mail_send_queue SET status = 'sent', sent_at = now(), sent_message_id = $2, error_code = NULL, last_error = NULL WHERE mail_send_queue_id = $1",
    [queueId, messageId],
  );
}

function markFailed(db, queueId, { code, message, retryAt }) {
  return db.query(
    `UPDATE mail_send_queue SET status = CASE WHEN $4::timestamptz IS NULL THEN 'failed' ELSE 'queued' END,
            release_at = COALESCE($4, release_at), error_code = $2, last_error = $3
      WHERE mail_send_queue_id = $1`,
    [queueId, code, String(message || "").slice(0, 500), retryAt ?? null],
  );
}

/** Recipients the account sent to in the last hour, for the host's hourly limit. */
async function sentLastHour(db, accountId) {
  const row = await one(
    db,
    `SELECT COALESCE(sum(cardinality(ARRAY(SELECT jsonb_array_elements_text(payload->'to_addresses')))
                       + cardinality(ARRAY(SELECT jsonb_array_elements_text(payload->'cc_addresses')))
                       + cardinality(ARRAY(SELECT jsonb_array_elements_text(payload->'bcc_addresses')))), 0)::int AS n
       FROM mail_send_queue WHERE mail_account_id = $1 AND status = 'sent' AND sent_at > now() - interval '1 hour'`,
    [accountId],
  );
  return row.n;
}

module.exports = {
  accountOf,
  accountById,
  syncable,
  saveSecret,
  secretOf,
  retireSecret,
  upsertAccount,
  setStatus,
  syncSucceeded,
  syncFailed,
  upsertFolders,
  folders,
  folderOfKind,
  setCursor,
  messageByInternetId,
  upsertThread,
  insertMessage,
  moveMessageRow,
  refreshThread,
  insertAttachment,
  listThreads,
  thread,
  messages,
  markThreadRead,
  moveThread,
  emptyFolder,
  messageOf,
  draft,
  saveDraft,
  deleteDraft,
  listDrafts,
  enqueue,
  cancelQueued,
  claimDue,
  claimOne,
  requeueStalled,
  markSent,
  markFailed,
  sentLastHour,
};
