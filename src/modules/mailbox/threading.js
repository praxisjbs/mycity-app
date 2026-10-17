"use strict";
/**
 * Threading by Message-ID, In-Reply-To and References (mailbox.md §4). A thread's key is
 * the first id in References (the conversation's root), else In-Reply-To, else the
 * message's own id. The subject is never the key: two unrelated mails called "Invoice"
 * stay apart.
 */

/** An id in angle brackets, or null. */
function normaliseId(id) {
  if (!id) return null;
  const bare = String(id).trim().replace(/^</, "").replace(/>$/, "").trim();
  return bare ? `<${bare}>` : null;
}

function normaliseReferences(refs) {
  if (!refs) return [];
  const list = Array.isArray(refs) ? refs : String(refs).split(/\s+/);
  const out = [];
  for (const r of list) {
    const n = normaliseId(r);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

function threadKeyFor(message = {}) {
  const references = normaliseReferences(message.references);
  if (references.length) return references[0];
  const inReplyTo = normaliseId(message.inReplyTo);
  if (inReplyTo) return inReplyTo;
  return normaliseId(message.messageId) || null;
}

/** Re:, Fwd: and their cousins, at most ten deep (a bounded loop, never a backtracking regex). */
const REPLY_PREFIX = /^\s*(?:re|aw|sv|vs|fw|fwd|tr)(?:\s*\[\d+\])?\s*:/i;
function baseSubject(subject) {
  let out = String(subject || "");
  for (let i = 0; i < 10; i += 1) {
    const next = out.replace(REPLY_PREFIX, "");
    if (next === out) break;
    out = next;
  }
  return out.trim();
}

/** The first characters of a message's text, on one line, for a list row. */
function snippetOf(text, max = 160) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, max);
}

module.exports = { normaliseId, normaliseReferences, threadKeyFor, baseSubject, snippetOf };
