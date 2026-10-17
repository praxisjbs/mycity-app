"use strict";
/**
 * ⌘K for Mailbox: the caller's own conversations, by subject, the addresses on them and
 * the senders' names. `owner` pins every query to the caller's own mailbox, so a grant
 * that reaches everyone (the CEO, People) still finds nobody else's mail (mailbox.md §6).
 * A result opens the conversation in Mailbox, whichever folder it is in.
 */
const { recordProvider } = require("../../shared/search/provider");

const SENDERS = `(SELECT string_agg(DISTINCT m.from_name, ' ') FROM mail_message m WHERE m.mail_thread_id = t.mail_thread_id)`;

module.exports = recordProvider({
  type: "mail_thread",
  module: "mailbox",
  label: "Mail",
  words: ["mail", "email"],
  from: "mail_thread t JOIN mail_account a ON a.mail_account_id = t.mail_account_id",
  key: "t.mail_thread_id",
  columns: ["t.subject", "t.participant_addresses", SENDERS],
  select: "t.mail_thread_id AS id, t.subject AS title, array_to_string(t.participant_addresses::text[], ', ') AS sub",
  where: "a.status <> 'disconnected'",
  owner: { column: "a.user_id" },
  order: "t.last_message_at DESC",
});
