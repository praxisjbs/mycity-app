"use strict";
/**
 * Dictate an answer (A18; docs/guides/performance.md §3 step 11, §6 Dictation).
 *
 *   1. The recording is stored in the vault against the review (at most 3 minutes, 10 MB:
 *      the `voice_note` upload cap), readable by whoever may read the review.
 *   2. It is transcribed, word for word (services/ai/transcription.js). The transcript is
 *      never changed by the system.
 *   3. One model call tidies it (prompt `review-cleanup`): wording, grammar and filler, never a
 *      fact, figure, name, judgement or tone. When tidying is off or fails, the transcript is
 *      still returned and `tidied` is null.
 *   4. The audio, the transcript and the run that tidied it are kept against the answer, and
 *      the answer's text is left alone: the person chooses Use Tidied, Use As Spoken or keeps
 *      typing, and the save that names the dictation keeps it.
 *
 * Steps 2 and 3 call out, so they run between two transactions, never inside one.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const vault = require("../../shared/documents/vault");
const transcription = require("../../services/ai/transcription");
const ai = require("../../services/ai/llm.service");
const { logger } = require("../../config/logger");
const repo = require("./reviews.repo");
const { EVENTS, DICTATION_DOC_TYPE } = require("./reviews.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** The titles of the KPIs a review covers, for the tidy step's spelling. */
async function kpiTitles(client, reviewId) {
  return (await repo.items(client, reviewId)).map((i) => i.title);
}

/**
 * @param {string} reviewId
 * @param {object} actor  the reviewer
 * @param {{buffer: Buffer, originalname: string}|null} file  readUpload(req)
 * @param {{performance_cycle_question_id: string, duration_s: number}} body
 * @returns {Promise<{dictation_id: string, transcript: string, tidied: string|null}>}
 */
async function dictate(reviewId, actor, file, body) {
  if (!file) throw new AppError("VALIDATION_FAILED", "Record your answer", 422, { file: ["Required"] });
  const service = require("./reviews.service");

  const { doc, question, titles } = await tx(async (client) => {
    const review = await service.forReviewer(client, reviewId, actor);
    const q = (await repo.answers(client, review)).find(
      (a) => a.performance_cycle_question_id === body.performance_cycle_question_id,
    );
    if (!q) throw new AppError("VALIDATION_FAILED", "Not a question of this cycle", 422, { performance_cycle_question_id: ["Not in this cycle"] });
    const stored = await vault.store(client, {
      file,
      purpose: "voice_note",
      doc_type: DICTATION_DOC_TYPE,
      entity: { type: "review", id: reviewId },
      subject_employee_id: review.employee_id,
      sensitivity: "personal",
      title: "Dictated answer",
      actor,
    });
    return { doc: stored, question: q.prompt, titles: await kpiTitles(client, reviewId) };
  });

  let heard;
  try {
    heard = await transcription.transcribe({
      document_id: doc.document_id,
      module: "performance",
      actor,
      purpose: "review-dictation",
    });
  } catch (err) {
    if (err instanceof AppError && err.status < 500 && err.code !== "AI_NOT_AVAILABLE") throw err;
    throw new AppError("DICTATION_FAILED", "Could not hear that, try again", 503);
  }
  const transcript = String(heard.text || "").trim();
  if (!transcript) throw new AppError("DICTATION_EMPTY", "Could not hear that, try again", 422);

  let tidied = null;
  let runId = heard.run_id;
  try {
    const out = await ai.complete({
      purpose: "review-cleanup",
      module: "performance",
      actor,
      input: { question, transcript, kpis: titles },
      temperature: 0,
    });
    tidied = String(out.text || "").trim() || null;
    runId = out.run_id;
  } catch (err) {
    logger.warn({ err, review: reviewId }, "dictation: tidying unavailable, the transcript stands");
  }

  await tx(async (client) => {
    await repo.keepDictation(client, reviewId, body.performance_cycle_question_id, {
      documentId: doc.document_id,
      transcript,
      aiRunId: runId,
    });
    await emit(client, {
      key: EVENTS.REVIEW_DICTATED,
      entity: { type: "review", id: reviewId },
      actor,
      payload: {
        performance_review_id: reviewId,
        performance_cycle_question_id: body.performance_cycle_question_id,
        document_id: doc.document_id,
        ai_run_id: runId,
        tidied: tidied !== null,
      },
    });
  });
  return { dictation_id: doc.document_id, transcript, tidied };
}

module.exports = { dictate };
