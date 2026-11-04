"use strict";
/**
 * Write With AI for vacancies (docs/guides/recruitment.md §3 steps 2 and 3, §9; job Default, chosen
 * by GE 04/11/2026). Nothing here is kept: the screen shows the draft and the person presses Use
 * Draft, then saves with their own press (A23).
 *
 *   status()                 GET  /recruitment/vacancies/assist
 *   draft(user, body)        POST /recruitment/vacancies/assist             prompt jd-draft
 *   suggest(user, row)       POST /recruitment/vacancies/:id/assist/questions   prompt screening-questions
 *
 * The draft follows MyCity's job description shape (guide §6.1): the role overview, its key
 * responsibilities as numbered sections and how it is measured go in the description; required
 * experience and qualifications in requirements; what we are looking for in nice_to_have.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const ai = require("../../services/ai/llm.service");
const drafts = require("../../services/ai/drafts");
const redact = require("../../services/ai/redact");

const MODULE = "recruitment";

const status = () => drafts.availability(pool, MODULE);

const offDraft = (reason) => ({ available: false, reason, description: null, requirements: null, nice_to_have: null, ai_run_id: null });
const offQuestions = (reason) => ({ available: false, reason, questions: [], ai_run_id: null });

/**
 * Run one prompt, or say why it did not run (off, or the month's limit). `call` makes the request
 * with its action named as a literal (scripts/check/ai-actions.js), given the shielded input and
 * the output schema held to "no gap left to fill".
 */
async function run(input, output, call) {
  const now = await status();
  if (!now.available) return { off: now.reason };
  const s = redact.shield(input);
  try {
    const r = await call(s.value, drafts.readyToUse(output, s));
    if (!r.output) return { off: "off" };
    return { output: r.output, run_id: r.run_id, restore: s.restore };
  } catch (err) {
    const reason = drafts.offReason(err);
    if (reason) return { off: reason };
    throw err;
  }
}

/** POST /recruitment/vacancies/assist: a description, must have and nice to have. */
async function draft(user, body, department = null) {
  const r = await run(
    {
      role: {
        title: body.title,
        department,
        employment_type: body.employment_type || null,
        work_pattern: body.work_pattern || null,
        min_experience_years: body.min_experience_years ?? null,
      },
      notes: body.instruction,
      so_far: { description: body.description, requirements: body.requirements, nice_to_have: body.nice_to_have },
    },
    c.vacancies.JdDraftOutput,
    (input, output) =>
      ai.complete({ purpose: "jd-draft", module: MODULE, actor: user, input, output, egress: "external", temperature: 0.4 }),
  );
  if (r.off) return offDraft(r.off);
  return {
    available: true,
    reason: null,
    description: r.restore(r.output.description),
    requirements: r.restore(r.output.requirements),
    nice_to_have: r.output.nice_to_have ? r.restore(r.output.nice_to_have) : null,
    ai_run_id: r.run_id,
  };
}

/** POST /recruitment/vacancies/:id/assist/questions: Apply questions and interview traits to consider. */
async function suggest(user, row, traits) {
  const r = await run(
    {
      role: { title: row.title, department: row.department, description: row.description, requirements: row.requirements },
      traits_already: traits,
    },
    c.vacancies.QuestionsDraftOutput,
    (input, output) =>
      ai.complete({ purpose: "screening-questions", module: MODULE, actor: user, input, output, egress: "external", temperature: 0.4 }),
  );
  if (r.off) return offQuestions(r.off);
  return {
    available: true,
    reason: null,
    questions: [
      ...r.output.application.map((q) => ({
        purpose: "application",
        question_type: "text",
        prompt: r.restore(q.prompt),
        options: null,
      })),
      ...r.output.interview.map((q) => ({
        purpose: "interview",
        question_type: "rating",
        prompt: r.restore(q.prompt),
        options: null,
      })),
    ],
    ai_run_id: r.run_id,
  };
}

module.exports = { status, draft, suggest, MODULE };
