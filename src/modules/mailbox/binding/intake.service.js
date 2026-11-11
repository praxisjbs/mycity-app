"use strict";
/**
 * A linked thread's mail becomes its record's history (docs/guides/partnerships.md §6.15): every
 * message, sent or received, is an `email` interaction on the lead or partner (and its deal), logged
 * once (dedup on the message), owned by the mailbox's owner, as the excerpt rule shows it
 * (context-tabs.js). Link to Partner logs what the thread already holds; each message stored after,
 * as the mailbox syncs or sends, is logged in the transaction that stores it. Unlink stops it and
 * keeps what was logged. Spam is never logged.
 *
 * Writes go through the interactions service (one write path, BACKEND_GUIDE §2).
 */
const interactions = require("../../interactions/interactions.service");
const { interactionOf } = require("./context-tabs");

/** The thread's live link with its mailbox owner's employee, or null. */
async function linkOf(client, threadId) {
  const { rows } = await client.query(
    `SELECT pmt.partner_id, pmt.lead_id, pmt.deal_id, pmt.mail_thread_id, au.employee_id AS owner_id
       FROM partner_mail_thread pmt
       JOIN mail_thread mt ON mt.mail_thread_id = pmt.mail_thread_id
       JOIN mail_account ma ON ma.mail_account_id = mt.mail_account_id
       JOIN app_user au ON au.user_id = ma.user_id
      WHERE pmt.mail_thread_id = $1 AND pmt.unbound_at IS NULL`,
    [threadId],
  );
  return rows[0] || null;
}

/** The thread's messages not yet logged, oldest first, Spam left out. */
async function unlogged(client, threadId, messageId = null) {
  // pagination:complete one conversation's messages, logged once each when it is linked; a thread is one exchange
  const { completeQuery } = require("../../../shared/http/paged");
  const { rows } = await completeQuery(
    client,
    `SELECT m.mail_message_id, m.subject, m.from_address, m.from_name, m.to_addresses::text[] AS to_addresses,
            m.cc_addresses::text[] AS cc_addresses, m.body_text, m.body_html, m.snippet, m.sent_at, m.received_at, m.created_at
       FROM mail_message m
       LEFT JOIN mail_folder f ON f.mail_folder_id = m.mail_folder_id
      WHERE m.mail_thread_id = $1 AND ($2::uuid IS NULL OR m.mail_message_id = $2)
        AND f.kind IS DISTINCT FROM 'spam'
        AND NOT EXISTS (SELECT 1 FROM partner_interaction pi WHERE pi.mail_message_id = m.mail_message_id)
      ORDER BY COALESCE(m.sent_at, m.received_at, m.created_at), m.mail_message_id`,
    [threadId, messageId],
    { label: "a linked conversation's messages", ceiling: 1000 },
  );
  return rows;
}

/** Log the given messages on the link's record. Returns how many were logged. */
async function logIn(client, link, messages) {
  let n = 0;
  for (const m of messages) {
    const id = await interactions.logMailIn(client, {
      partner_id: link.partner_id,
      lead_id: link.lead_id,
      deal_id: link.deal_id,
      owner_id: link.owner_id,
      mail_message_id: m.mail_message_id,
      mail_thread_id: link.mail_thread_id,
      ...interactionOf(m),
    });
    if (id) n += 1;
  }
  return n;
}

/** Link to Partner: every message the thread holds, logged in the link's transaction. */
async function logThreadIn(client, threadId) {
  const link = await linkOf(client, threadId);
  if (!link) return 0;
  return logIn(client, link, await unlogged(client, threadId));
}

/**
 * A message the mailbox just stored (synced or sent), in the transaction that stored it: logged when
 * its thread is linked, else nothing. One indexed read for an unlinked thread.
 */
async function afterStoredIn(client, { mail_thread_id: threadId, mail_message_id: messageId }) {
  if (!threadId || !messageId) return 0;
  const link = await linkOf(client, threadId);
  if (!link) return 0;
  return logIn(client, link, await unlogged(client, threadId, messageId));
}

module.exports = { linkOf, logThreadIn, afterStoredIn };
