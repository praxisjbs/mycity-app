"use strict";
/**
 * What a linked thread shows on its lead's or partner's tabs (docs/guides/partnerships.md §6.15): the
 * excerpt rule. The record's readers see a message's subject, who it was from and to, when, and the
 * first 300 characters of its text; never its body or its attachments. The whole conversation opens
 * only for its mailbox's owner, in Mailbox (interactions.repo names the thread to them alone).
 */
const { textOf } = require("../compose");

/** How much of a message's text the record's readers see. */
const EXCERPT_CHARS = 300;

/** A message's text, folded to one line and cut at EXCERPT_CHARS on a word where one is near. */
function excerptOf(m) {
  const text = String(m.body_text || (m.body_html ? textOf(m.body_html) : "") || m.snippet || "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= EXCERPT_CHARS) return text || null;
  const cut = text.slice(0, EXCERPT_CHARS);
  const space = cut.lastIndexOf(" ");
  return `${space > EXCERPT_CHARS - 40 ? cut.slice(0, space) : cut}…`;
}

/** A sender as a reader sees them: the name, else the address. */
const fromOf = (m) => (String(m.from_name || "").trim() || String(m.from_address || "").trim() || "Unknown sender").slice(0, 200);

/** Who it went to: the To and Cc addresses, lower case, each once. */
const toOf = (m) => [...new Set([...(m.to_addresses || []), ...(m.cc_addresses || [])].map((x) => String(x).toLowerCase()))].slice(0, 100);

/**
 * The interaction a linked message becomes: its subject, the excerpt as the summary, from and to.
 * @param {object} m  a mail_message row
 */
function interactionOf(m) {
  return {
    subject: String(m.subject || "").trim().slice(0, 200) || "(no subject)",
    summary: excerptOf(m),
    mail_from: fromOf(m),
    mail_to: toOf(m),
    occurred_at: m.sent_at || m.received_at || m.created_at,
  };
}

module.exports = { EXCERPT_CHARS, excerptOf, fromOf, toOf, interactionOf };
