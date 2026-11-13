"use strict";
/**
 * Documents in the chat (docs/guides/praxis-ai.md §1.10 decisions 41 to 48, §6.18): which kinds a
 * person may attach, and the one reading of an attached file before the model is asked.
 *
 *   kinds(actor)                      GET /ai/attachment-kinds: the tiles this person is offered
 *   read(actor, attachment)           the kind's reader on the person's own staged upload, once
 *   kept(md)                          what an answer's metadata keeps of it, for the replay
 *   shownOf(md)                       the file as the question's bubble and the pane show it: its terms
 *                                     for the Record tab when its kind draws them (a contract, PR 2)
 *
 * The kinds live in the modules' manifests (`files`), beside their reads: Expenses reads an invoice,
 * Disbursements a payment receipt. A kind is offered only to someone who may make what it becomes
 * (its grant, and its capability on top), so a tile is never a card the press would refuse. The
 * file must be the person's own staged upload (the upload engine's `staged_upload`), never a record's
 * file nor somebody else's; the card the person presses claims it. The reader runs outside any
 * transaction, on its own action and job, and writes nothing; what it read goes to the chat's model
 * as data, never the file.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { AppError } = require("../../shared/errors");
const registry = require("../../shared/ai/registry");
const vault = require("../../shared/documents/vault");
const drafts = require("../../services/ai/drafts");
const { logger } = require("../../config/logger");
const documents = require("../documents/documents.service");

/** The order the modal shows the tiles in (decision 41). */
const ORDER = Object.freeze(["invoice", "payment_receipt", "contract"]);

/** One sentence for a reading that gave nothing to act on (§6.18 step 5). */
const SAID = Object.freeze({
  unreadable: "This file cannot be read. Try a clearer copy.",
  off: "Reading documents is off.",
  limit: "This month's AI budget is spent.",
});

const forbidden = () => new AppError("ATTACHMENT_FORBIDDEN", "You cannot attach that kind of document", 403, { attachment: ["Not open to you"] });
const notStaged = () => new AppError("NOT_FOUND", "Upload the file again", 404, { attachment: ["Upload it again"] });

/** A reader's terms for the Record tab (AiAttachmentRecord), or null when it drew none or drew them wrong. */
function recordOf(record) {
  if (!record) return null;
  const parsed = c.assistant.AiAttachmentRecord.safeParse(record);
  if (parsed.success) return parsed.data;
  logger.warn({ issues: parsed.error.issues.slice(0, 3) }, "Praxis AI: a document's terms did not parse; the pane shows none");
  return null;
}

/** The kinds this person may attach, in the modal's order. */
async function allowed(actor) {
  const offered = await registry.filesFor(actor);
  return offered.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

/**
 * GET /ai/attachment-kinds: each kind's tile and question, and whether a document can be read now
 * (AI on, Praxis AI on, a provider set up, the month's cap not reached).
 * @param {object} actor  req.user
 */
async function kinds(actor) {
  const [list, now] = await Promise.all([allowed(actor), drafts.availability(pool, "praxis_ai")]);
  return { kinds: list.map((f) => ({ kind: f.kind, label: f.label, question: f.question })), available: list.length > 0 && now.available };
}

/**
 * Read an attached document once, for this question (§6.18 steps 1 to 3, 5).
 * @param {object} actor  req.user
 * @param {{document_id: string, kind: string}} attachment  AiAttachment
 * @returns {Promise<{kind: string, module: string, label: string, question: string, actions: string[], document: object,
 *   outcome: "read"|"unreadable"|"off"|"limit", reading: object|null, card: object|null, notes: string[], record: object|null, said: string|null}>}
 */
async function read(actor, attachment) {
  const offered = await allowed(actor);
  const f = offered.find((k) => k.kind === attachment.kind);
  if (!f) throw forbidden();
  const doc = await vault.get(pool, attachment.document_id);
  // Only the person's own staged upload: never a record's file, nor somebody else's (the card claims it).
  if (!doc || doc.doc_type !== vault.STAGED_DOC_TYPE || !doc.is_current || doc.uploaded_by !== actor.user_id) throw notStaged();
  let got;
  try {
    got = (await f.read(actor, doc, pool)) || {};
  } catch (err) {
    logger.warn({ err, kind: f.kind }, "Praxis AI: a document's reader failed; the answer says it cannot be read");
    got = { outcome: "unreadable" };
  }
  const outcome = ["read", "unreadable", "off", "limit"].includes(got.outcome) ? got.outcome : "unreadable";
  return {
    kind: f.kind,
    module: f.module,
    label: f.label,
    question: f.question,
    actions: [...f.actions],
    document: documents.refOf(doc),
    outcome,
    reading: outcome === "read" && got.reading && typeof got.reading === "object" ? got.reading : null,
    card: outcome === "read" && got.card && got.card.action && f.actions.includes(got.card.action) ? got.card : null,
    notes: outcome === "read" && Array.isArray(got.notes) ? got.notes.filter((n) => typeof n === "string" && n.trim()).slice(0, 3) : [],
    record: outcome === "read" ? recordOf(got.record) : null,
    said: outcome === "read" ? null : SAID[outcome],
  };
}

/**
 * What an answer keeps of its attachment in `ai_message.metadata.attachment`, so the bubble shows the
 * file and a later question sees the reading and draws the card with the file's figures (§6.18 step 6).
 */
function kept(file) {
  if (!file) return null;
  return { document: file.document, kind: file.kind, module: file.module, outcome: file.outcome, reading: file.reading, card: file.card, record: file.record || null };
}

/** The newest attachment of a conversation's replayed turns, as kept, or null. */
function latestOf(history) {
  for (let i = (history || []).length - 1; i >= 0; i -= 1) if (history[i] && history[i].attachment) return history[i].attachment;
  return null;
}

/** The file a question carried, as its bubble and the pane show it (AiAnswer.attachment), from its answer's metadata. */
const shownOf = (md) =>
  md && md.attachment && md.attachment.document ? { document: md.attachment.document, kind: md.attachment.kind, record: md.attachment.record || null } : null;

module.exports = { kinds, read, kept, latestOf, shownOf, ORDER, SAID };
