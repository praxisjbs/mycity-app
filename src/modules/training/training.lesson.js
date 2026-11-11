"use strict";
/**
 * Draft Lesson (docs/guides/knowledge.md §6.5; action `training-lesson-draft`, the Default job,
 * personal data, never DeepSeek, chosen by TB on 11/11/2026): a lesson written from a pasted text
 * or a PDF's text, as headings, short paragraphs and a Key Points list, at most 1,200 words, keeping
 * the source's facts. A suggestion only: nothing is saved here, and the builder presses Use Lesson
 * or not on the screen (A23 as amended: the AI writes no record).
 *
 * Contact details, links and digit runs are shielded before the text leaves and put back after.
 * With AI off, the budget spent or no model answering, it is 503 AI_UNAVAILABLE and nothing changes.
 */
const { pool } = require("../../config/db");
const { AppError } = require("../../shared/errors");
const vault = require("../../shared/documents/vault");
const ai = require("../../services/ai/llm.service");
const drafts = require("../../services/ai/drafts");
const redact = require("../../services/ai/redact");
const pdfText = require("../../services/media/pdf-text");

/** The longest lesson the editor holds (ItemCreate's lesson_markdown). */
const MAX_CHARS = 20_000;
/** A source shorter than this gives nothing to write a lesson from. */
const MIN_SOURCE = 40;
/** Contact details and links a source names: kept out of the model and put back after. */
const KEPT_OUT = /(https?:\/\/[^\s)\]]+|[\w.+-]+@[\w-]+\.[\w.-]+|\+?\d[\d\s().-]{7,}\d)/g;

const unavailable = () => new AppError("AI_UNAVAILABLE", "Draft Lesson is unavailable right now", 503);

/**
 * The text of a PDF the person may open (an upload staged for the item, or one already in the
 * vault). A scanned PDF has no text: "No text in this file", and nothing is sent.
 */
async function textOfDocument(user, documentId) {
  const doc = await vault.getReadable(pool, user, documentId).catch(() => null);
  if (!doc || doc.scan_status === "infected" || doc.scan_status === "pending")
    throw new AppError("VALIDATION_FAILED", "Upload the file again", 422, { document_id: ["Upload it again"] });
  if (doc.mime !== "application/pdf")
    throw new AppError("VALIDATION_FAILED", "Pick a PDF", 422, { document_id: ["Pick a PDF"] });
  const text = await pdfText.read(doc.storage_key);
  if (!text) throw new AppError("NO_TEXT", "No text in this file", 422, { document_id: ["No text in this file"] });
  return text;
}

/** The model's Markdown, without a code fence around it. */
const unfence = (s) => String(s || "").replace(/^```(?:markdown|md)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

/**
 * POST /training/lesson-with-ai
 * @param {object} user
 * @param {{title: string, text?: string, document_id?: string}} body  LessonWithAi
 * @returns {Promise<{lesson_markdown: string}>}
 */
async function suggest(user, body) {
  const source = body.text ? String(body.text).trim() : await textOfDocument(user, body.document_id);
  if (source.length < MIN_SOURCE)
    throw new AppError("VALIDATION_FAILED", "Paste more of the text", 422, { text: ["Paste more text"] });
  const s = redact.shield({ title: body.title.trim(), source_text: source }, { also: [KEPT_OUT] });
  let run;
  try {
    run = await ai.complete({
      purpose: "training-lesson-draft",
      module: "knowledge",
      actor: user,
      input: s.value,
      egress: "external",
      temperature: 0.2,
    });
  } catch (err) {
    if (drafts.offReason(err) || (err instanceof AppError && /^AI_/.test(err.code))) throw unavailable();
    throw err;
  }
  const lesson = s.restore(unfence(run && run.text)).slice(0, MAX_CHARS).trim();
  if (lesson.length < 20) throw unavailable();
  return { lesson_markdown: lesson };
}

module.exports = { suggest, unfence };
