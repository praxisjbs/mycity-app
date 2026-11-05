"use strict";
/**
 * Score With AI and Screen With AI (docs/guides/recruitment.md §6.4; action cv-screen, job Deep
 * Reasoning, chosen by GE 04/11/2026). Runs in the worker from the outbox
 * (application.score_requested), one application at a time; never from a request.
 *
 * The model reads the CV's text (a PDF read through PDF.js; a Word file, a scan or a CV not yet
 * cleared by the virus check is read as null, and the prompt says so in the summary), the cover
 * letter, the answers, the role and its must-meet conditions, with contact details shielded. It
 * answers a score from 0 to 100 and a summary; both are kept with the run. The score moves nobody.
 *
 * With AI off, or the month's budget spent, nothing is kept and the card keeps its estimate.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const vault = require("../../shared/documents/vault");
const ai = require("../../services/ai/llm.service");
const drafts = require("../../services/ai/drafts");
const redact = require("../../services/ai/redact");
const pdfText = require("../../services/media/pdf-text");
const vacancies = require("../vacancies/vacancies.repo");
const repo = require("./candidates.repo");
const { EVENTS } = require("./candidates.events");

const MODULE = "recruitment";

/** The CV's text when it is a clean PDF; null otherwise (the prompt says what null means). */
async function cvText(documentId) {
  if (!documentId) return null;
  const doc = await vault.get(pool, documentId);
  if (!doc || doc.scan_status !== "clean" || doc.mime !== "application/pdf") return null;
  return pdfText.read(doc.storage_key);
}

/** What the model is given (prompts/cv-screen.md): data only, never instructions. */
async function inputFor(a, conditions) {
  const v = await vacancies.get(pool, a.vacancy_id);
  const questions = await repo.applyQuestions(pool, a.vacancy_id);
  const { about_company: company } = await vacancies.settings(pool);
  return {
    company,
    role: {
      title: v.title,
      department: v.department,
      description: v.description,
      requirements: v.requirements,
      nice_to_have: v.nice_to_have || "",
      min_experience_years: v.min_experience_years,
    },
    conditions: conditions || v.screening_conditions || [],
    candidate: {
      years_experience: a.years_experience,
      cover_letter: a.cover_letter || "",
      // In the form's order: a jsonb object keeps no order of its own.
      answers: questions
        .filter((q) => (a.answers || {})[q.vacancy_question_id] !== undefined)
        .map((q) => ({ question: q.prompt, answer: a.answers[q.vacancy_question_id] })),
    },
    cv_text: await cvText(a.cv_document_id),
  };
}

/**
 * Read one application and keep its score. Answers what happened: scored, off (AI off or the
 * budget spent), or skipped (the application is gone or no longer active).
 * @param {string} applicationId
 * @param {string[]|null} conditions  as Screen With AI kept them; null reads the vacancy's
 * @param {string|null} actorId  who pressed
 */
async function scoreOne(applicationId, conditions, actorId) {
  const a = await repo.get(pool, applicationId);
  if (!a || a.status !== "active") return "skipped";
  const now = await drafts.availability(pool, MODULE);
  if (!now.available) return "off";
  const s = redact.shield(await inputFor(a, conditions));
  let run;
  try {
    run = await ai.complete({
      purpose: "cv-screen",
      module: MODULE,
      actor: actorId,
      input: s.value,
      output: c.candidates.CvScreenOutput,
      egress: "external",
      temperature: 0.1,
    });
  } catch (err) {
    if (drafts.offReason(err)) return "off";
    throw err;
  }
  if (!run || !run.output) return "off";
  const summary = s.restore(run.output.summary).slice(0, 2000);
  const client = await pool.connect();
  try {
    await atomically(client, async () => {
      await repo.setScreening(client, applicationId, { score: run.output.score, summary, run_id: run.run_id });
      await emit(client, {
        key: EVENTS.APPLICATION_SCORED,
        entity: { type: "application", id: applicationId },
        actor: actorId,
        payload: { application_id: applicationId, number: a.number, score: run.output.score },
      });
    });
  } finally {
    client.release();
  }
  return "scored";
}

module.exports = { scoreOne, inputFor };
