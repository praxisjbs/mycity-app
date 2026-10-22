"use strict";
/**
 * Dictation and Tidy With AI on a check-in and a review (docs/guides/performance.md §6.17; A18, P19).
 *
 *   Dictate   the recording (up to 3 minutes and 10 MB, purpose voice_note) is kept in the vault on
 *             the review, then transcribed through `review-dictation` (Transcription). A check-in's
 *             Action keeps its transcript and recording on the item; any other text gets the words
 *             back and the person saves them with the rest
 *   Tidy      one `review-cleanup` call (Default; personal data, so DeepSeek is passed over), run only
 *             when pressed, given the line's goal, target and the text. It fixes wording and
 *             structures into Done, Behind and Next; it never adds, removes or changes a fact,
 *             figure, name, judgement or tone. The answer is a suggestion: nothing is saved here,
 *             and a tidy that brings in a figure the text did not hold is refused
 *
 * AI off, a module switch or a cap reached: Tidy answers `available: false` and the original stays;
 * nothing blocks a submit. Both run outside any transaction, on the person's request.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const vault = require("../../shared/documents/vault");
const ai = require("../../services/ai/llm.service");
const transcription = require("../../services/ai/transcription");
const sequence = require("./reviews.sequence");
const repo = require("./reviews.repo");
const { EVENTS } = require("./reviews.events");

/** The longest recording a dictation takes (§6.17); the upload's own cap is 10 MB. */
const MAX_SECONDS = 180;

/** Refusals that mean "Tidy is off", not a failure. */
const OFF = new Set(["AI_DISABLED", "AI_MODULE_DISABLED", "AI_CAP_REACHED", "AI_UNAVAILABLE", "AI_VENDOR_CONFIG"]);

const invalid = (field, message) => new AppError("VALIDATION_FAILED", "Check the recording", 422, { [field]: [message] });

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** The text a field of a review belongs to, and who may write it now. */
const WRITER = {
  action_text: (roles, r) => roles.employee && r.status === "check_in",
  self_reason: (roles, r) => roles.employee && r.status === "check_in",
  comment: (roles, r) => roles.reviewer && sequence.WITH_REVIEWER.includes(r.status),
  dotted_input: (roles, r) => roles.dotted && sequence.WITH_REVIEWER.includes(r.status),
};

/**
 * Keep a recording on its review and transcribe it.
 * @param {object} actor
 * @param {object} r      the review (reviews.repo row)
 * @param {object} roles  sequence.rolesOf()
 * @param {{field: string, performance_review_item_id?: string|null}} body  DictationRequest
 * @param {{buffer: Buffer, originalname: string}} file
 * @returns {Promise<{transcript: string, document_id: string, ai_run_id: string|null}>}
 */
async function dictate(actor, r, roles, body, file) {
  const may = WRITER[body.field];
  if (!may || !may(roles, r)) throw new AppError("PERMISSION_DENIED", "You cannot write that text now", 403);
  const items = await repo.items(pool, r.performance_review_id);
  const item = body.performance_review_item_id ? items.find((i) => i.performance_review_item_id === body.performance_review_item_id) : null;
  if (body.performance_review_item_id && !item) throw invalid("performance_review_item_id", "Not this review's");
  if (!item && body.field !== "dotted_input") throw invalid("performance_review_item_id", "Pick the line");
  const doc = await tx(async (client) => {
    const stored = await vault.store(client, {
      file,
      purpose: "voice_note",
      doc_type: "review_dictation",
      entity: { type: "performance_review", id: r.performance_review_id },
      subject_employee_id: r.employee_id,
      sensitivity: "personal",
      actor,
    });
    if (stored.duration_ms && stored.duration_ms > MAX_SECONDS * 1000) throw invalid("file", "Three minutes at most");
    await emit(client, {
      key: EVENTS.REVIEW_DICTATED,
      entity: { type: "performance_review", id: r.performance_review_id },
      actor,
      payload: { performance_review_id: r.performance_review_id, field: body.field, document_id: stored.document_id },
    });
    return stored;
  });
  const t = await transcription.transcribe({
    document_id: doc.document_id,
    module: "performance",
    actor,
    purpose: "review-dictation",
  });
  if (body.field === "action_text" && item && !t.draft)
    await tx(async (client) => {
      await repo.lock(client, r.performance_review_id);
      const now = await repo.get(client, r.performance_review_id);
      if (now.status !== "check_in") return;
      await repo.updateItem(client, item.performance_review_item_id, { action_transcript: t.text, action_document_id: doc.document_id });
    });
  return { transcript: t.text, document_id: doc.document_id, ai_run_id: t.run_id || null };
}

/** POST /performance/reviews/:id/items/:item_id/dictation: the reviewer's comment, the dotted manager's input. */
async function dictateReview(actor, scope, id, body, file) {
  const { r, roles } = await require("./reviews.service").loadFor(pool, id, actor, scope);
  return dictate(actor, r, roles, body, file);
}

/** POST /ess/performance/check-in/dictation: the caller's own check-in's action or reason. */
async function dictateCheckIn(actor, body, file) {
  const r = await require("./reviews.service").myOpen(pool, actor);
  return dictate(actor, r, { employee: true, named: true }, body, file);
}

/** The figures in a text: a tidy may not bring in one the text did not hold. */
const figures = (text) => new Set((String(text).match(/\d+(?:[.,]\d+)*/g) || []).map((f) => f.replace(/,/g, "")));

/** What a line aimed for, in words, for the tidy's context. */
const targetOf = (i) =>
  i.line ? [i.line.target_text, i.line.target_value ? `${i.line.target_value}${i.line.unit ? ` ${i.line.unit}` : ""}` : null].filter(Boolean).join(" ") : null;

/**
 * POST /performance/tidy: one tidy of a check-in's or a review's text, for the person writing it.
 * @param {object} actor
 * @param {{kind: "check_in"|"review"|"week", performance_review_item_id?: string|null, text: string}} body
 */
async function tidy(actor, scope, body) {
  if (body.kind === "week") throw new AppError("VALIDATION_FAILED", "Tidy a week from My Workspace", 422, { kind: ["Not a review's"] });
  if (!body.performance_review_item_id) throw new AppError("VALIDATION_FAILED", "Pick the line", 422, { performance_review_item_id: ["Pick the line"] });
  const { rows } = await pool.query("SELECT performance_review_id FROM performance_review_item WHERE performance_review_item_id = $1", [
    body.performance_review_item_id,
  ]);
  if (!rows[0]) throw sequence.notFound();
  const review = require("./reviews.service");
  const { r, roles } = await review.loadFor(pool, rows[0].performance_review_id, actor, scope);
  const writes = body.kind === "check_in" ? WRITER.action_text(roles, r) : WRITER.comment(roles, r) || WRITER.dotted_input(roles, r);
  if (!writes) throw new AppError("PERMISSION_DENIED", "You cannot write that text now", 403);
  const item = (await repo.items(pool, r.performance_review_id)).find((i) => i.performance_review_item_id === body.performance_review_item_id);
  let run;
  try {
    run = await ai.complete({
      purpose: "review-cleanup",
      module: "performance",
      actor,
      input: {
        goal: item.line ? item.line.title : item.criterion,
        target: targetOf(item),
        text: body.text,
      },
      egress: "external",
      temperature: 0,
    });
  } catch (err) {
    if (err instanceof AppError && OFF.has(err.code)) return { available: false, original: body.text, tidied: null, ai_run_id: null };
    throw err;
  }
  const tidied = String(run.text || "").replace(/^```(?:\w+)?\s*|\s*```\s*$/g, "").trim();
  const held = figures(body.text);
  if (!tidied || [...figures(tidied)].some((f) => !held.has(f)))
    throw new AppError("AI_CHANGED_FIGURES", "The tidy changed a figure. Try again or keep yours.", 502);
  return { available: true, original: body.text, tidied, ai_run_id: run.run_id || null };
}

module.exports = { MAX_SECONDS, dictate, dictateReview, dictateCheckIn, tidy, figures };
