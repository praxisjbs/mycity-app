"use strict";
/**
 * Write With AI for vacancies (docs/guides/recruitment.md §3 steps 2 and 3, §9; job Default, chosen
 * by GE 04/11/2026). Nothing here is kept: the screen shows the draft and the person presses Use
 * Draft, then saves with their own press (A23).
 *
 *   status()                 GET  /recruitment/vacancies/assist
 *   draft(user, body)        POST /recruitment/vacancies/assist             prompt jd-draft
 *   followUps(user, body)    POST /recruitment/vacancies/assist/follow-ups  prompt vacancy-follow-ups
 *   suggest(user, row)       POST /recruitment/vacancies/:id/assist/questions   prompt screening-questions
 *
 * The draft follows MyCity's job description shape (guide §6.1): the role overview, its key
 * responsibilities as numbered sections and how it is measured go in the description; required
 * experience and qualifications in requirements; what we are looking for in nice_to_have.
 *
 * New Vacancy's interview (guide §3 step 2) never ends in an error: its follow-ups are none when the
 * AI is off or fails (the interview ends at its eighth question), and its draft is written plainly
 * from the person's own answers (plainDraft) when the AI cannot write it.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const ai = require("../../services/ai/llm.service");
const drafts = require("../../services/ai/drafts");
const redact = require("../../services/ai/redact");
const { logger } = require("../../config/logger");

const MODULE = "recruitment";

const status = () => drafts.availability(pool, MODULE);

const offDraft = (reason) => ({ available: false, reason, description: null, requirements: null, nice_to_have: null, ai_run_id: null });
const offQuestions = (reason) => ({ available: false, reason, questions: [], ai_run_id: null });
const offFollowUps = (reason) => ({ available: false, reason, questions: [], ai_run_id: null });

/** A restored text held to the form's limit: a name put back can be longer than its placeholder. */
const fit = (text, max) => (text && text.length > max ? text.slice(0, max).trimEnd() : text);

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

/** The role as the model reads it: the department named, not its id. */
const roleOf = (body, department) => ({
  title: body.title,
  department,
  employment_type: body.employment_type || null,
  work_pattern: body.work_pattern || null,
  min_experience_years: body.min_experience_years ?? null,
});

/** The interview's answers as the model reads them: only what was answered. */
const answersOf = (interview) =>
  Object.fromEntries(
    Object.entries(interview || {}).filter(([k, v]) => (k === "follow_ups" ? v.length > 0 : v !== undefined && v !== null && v !== "")),
  );

/**
 * POST /recruitment/vacancies/assist: a description, must have and nice to have. From the interview
 * (`body.interview`), never an error: when the AI cannot write it, the plain draft from the answers.
 */
async function draft(user, body, department = null, company = null) {
  const fromInterview = body.interview !== undefined;
  let r;
  try {
    r = await run(
      {
        company,
        role: roleOf(body, department),
        notes: body.instruction ?? null,
        interview: fromInterview ? answersOf(body.interview) : null,
        so_far: { description: body.description, requirements: body.requirements, nice_to_have: body.nice_to_have },
      },
      c.vacancies.JdDraftOutput,
      (input, output) =>
        ai.complete({ purpose: "jd-draft", module: MODULE, actor: user, input, output, egress: "external", temperature: 0.4 }),
    );
  } catch (err) {
    if (!fromInterview) throw err;
    logger.warn({ err }, "vacancy draft: the AI failed; drafted from the interview's answers");
    r = { off: "off" };
  }
  if (r.off) return fromInterview ? { ...plainDraft(body, department), available: false, reason: r.off, ai_run_id: null } : offDraft(r.off);
  return {
    available: true,
    reason: null,
    description: fit(r.restore(r.output.description), 8000),
    requirements: fit(r.restore(r.output.requirements), 4000),
    nice_to_have: r.output.nice_to_have ? fit(r.restore(r.output.nice_to_have), 4000) : null,
    ai_run_id: r.run_id,
  };
}

/** Words for a code, as the screen says them. */
const PATTERN = { on_site: "on site", hybrid: "hybrid", remote: "remote" };

/** An answer's lines or sentences as list items. */
const bulletsOf = (text) =>
  String(text || "")
    .split(/\n|;|(?<=\.)\s+/)
    .map((s) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((s) => s.length > 3)
    .slice(0, 12);

/**
 * The draft written from the interview's own answers, when the AI cannot write it (off, over its
 * limit, or failed): it says less than a model would and nothing the person did not say. No About
 * MyCityApp: the careers page prints Careers Settings' own above every role.
 */
function plainDraft(body, department = null) {
  const a = body.interview || {};
  const n = Number(a.positions) || 1;
  const pattern = body.work_pattern ? PATTERN[body.work_pattern] : null;
  const where = body.work_pattern === "remote" ? ", working remotely" : a.area ? `, based in ${a.area}` : "";
  const overview = [
    `MyCityApp is hiring ${n > 1 ? `${n} people` : "one person"} as ${body.title}${department ? `, in the ${department} team` : ""}${where}.`,
    pattern && body.work_pattern !== "remote" ? `The role is ${pattern}${a.work_pattern_note ? ` (${a.work_pattern_note})` : ""}.` : null,
    a.working_days ? `Working days are ${a.working_days}.` : null,
    a.reports_to ? `It reports to the ${a.reports_to}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const musts = bulletsOf(a.must_haves);
  const answered = (a.follow_ups || []).filter((f) => f.answer);
  const description = [
    overview,
    musts.length ? `## Key Responsibilities\n\n${musts.map((m) => `- ${m}`).join("\n")}` : null,
    answered.length ? `## About the Role\n\n${answered.map((f) => `- ${f.answer}`).join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  const requirements = [
    (body.min_experience_years ?? null) !== null ? `- ${body.min_experience_years}+ years of relevant experience.` : null,
    ...musts.map((m) => `- ${m}`),
  ].filter(Boolean);
  const extras = bulletsOf(a.extras);
  return {
    description: fit(description, 8000),
    requirements: requirements.length ? fit(requirements.join("\n"), 4000) : null,
    nice_to_have: extras.length ? fit(extras.map((e) => `- ${e}`).join("\n"), 4000) : null,
  };
}

/** Words a follow-up must never ask about beyond the protected traits: a person's health. */
const HEALTH = /\b(health|healthy|medical|illness\w*|ill|sick\w*|diagnos\w*|allerg\w*|medication|fit to work|physically fit)\b/i;

/**
 * Whether a question the AI wrote asks about the work, never the person (guide §9): one naming a
 * protected trait (the list Screen With AI's conditions are refused on: sex, age, ethnicity, origin,
 * religion, family, disability, nationality, appearance) or a person's health is dropped.
 */
function fairQuestion(text) {
  const { traitsNamed } = require("./vacancies.service");
  return traitsNamed(text).length === 0 && !HEALTH.test(String(text).replace(/\bhealth (and|&) safety\b/gi, ""));
}

/**
 * POST /recruitment/vacancies/assist/follow-ups: two questions about this role from the interview's
 * answers so far. None, never an error, when the AI is off or fails; an unfair one is dropped.
 */
async function followUps(user, body, department = null, company = null) {
  try {
    const r = await run(
      { company, role: roleOf(body, department), answers: answersOf(body.interview) },
      c.vacancies.FollowUpsOutput,
      (input, output) =>
        ai.complete({ purpose: "vacancy-follow-ups", module: MODULE, actor: user, input, output, egress: "external", temperature: 0.5 }),
    );
    if (r.off) return offFollowUps(r.off);
    const questions = r.output.questions
      .map((q) => ({ question: fit(r.restore(q.question), 300), hint: q.hint ? fit(r.restore(q.hint), 200) : null }))
      .filter((q) => fairQuestion(q.question))
      .slice(0, 2);
    return { available: true, reason: null, questions, ai_run_id: r.run_id };
  } catch (err) {
    logger.warn({ err }, "vacancy follow-ups: the AI failed; the interview goes on without them");
    return offFollowUps("off");
  }
}

/** POST /recruitment/vacancies/:id/assist/questions: Apply questions and interview traits to consider. */
async function suggest(user, row, traits, company = null) {
  const r = await run(
    {
      company,
      role: { title: row.title, department: row.department, description: row.description, requirements: row.requirements },
      traits_already: traits,
      traits_left: Math.max(0, 20 - traits.length),
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
        question_type: q.question_type,
        prompt: fit(r.restore(q.prompt), 500),
        options: null,
      })),
      ...r.output.interview.slice(0, Math.max(0, 20 - traits.length)).map((q) => ({
        purpose: "interview",
        question_type: "rating",
        prompt: fit(r.restore(q.prompt), 500),
        options: null,
      })),
    ],
    ai_run_id: r.run_id,
  };
}

module.exports = { status, draft, followUps, suggest, plainDraft, fairQuestion, MODULE };
