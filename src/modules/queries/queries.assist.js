"use strict";
/**
 * Write With AI on Raise a Query (docs/guides/queries.md §9, prompt `query-draft`): a Subject and
 * What Happened drafted from the raiser's own words, in the company's tone, run only when they
 * press it. Nothing is kept: the form takes the draft when the person presses Use Draft, and
 * raising the query is their own press (A23).
 *
 *   status()   GET /queries/assist: whether it may answer now (off, or this month's budget spent)
 *   draft()    POST /queries/assist
 *
 * What the model is given: the employee's first name, job title and department, the raiser's name
 * and job title, today in Lagos, the policy cited and the line quoted, the form's Subject and What
 * Happened so far, and what happened in the raiser's words. Contact details and identifying
 * numbers leave as tokens (redact.shield) and are put back in the answer. An answer with a gap
 * left to fill goes back once with the problem named (services/ai/drafts.js), then fails the press.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { AppError } = require("../../shared/errors");
const lagos = require("../../shared/time/lagos");
const { formatLongDate } = require("../../shared/time/day-first");
const ai = require("../../services/ai/llm.service");
const drafts = require("../../services/ai/drafts");
const redact = require("../../services/ai/redact");
const repo = require("./queries.repo");

const MODULE = "queries";

const off = (reason) => ({ available: false, reason, subject: null, details: null, ai_run_id: null });

/** Whether Write With AI may answer for Queries now. */
const status = () => drafts.availability(pool, MODULE);

/** POST /queries/assist (QueryDraftRequest): a draft, or why there is none. */
async function draft(user, body) {
  const now = await status();
  if (!now.available) return off(now.reason);
  const person = await repo.employeeOf(pool, body.employee_id);
  if (!person || person.status !== "active")
    throw new AppError("EMPLOYEE_NOT_ACTIVE", "Pick someone who works here now", 422, { employee_id: ["Not active"] });
  const me = user.employee_id ? await repo.employeeOf(pool, user.employee_id) : null;
  const cited = body.policy_id ? await require("../policies/policies.service").citation(pool, body.policy_id) : null;

  const s = redact.shield({
    today: formatLongDate(lagos.today()),
    raiser: me ? { name: me.display_name, job_title: me.job_title } : { name: "Operations & People", job_title: null },
    employee: { first_name: person.called, job_title: person.job_title, department: person.department },
    policy: cited ? { title: cited.title, number: cited.number, clause: body.policy_clause || null } : null,
    subject: body.subject || null,
    details: body.details || null,
    instruction: body.instruction,
  });
  let run;
  try {
    run = await ai.complete({
      purpose: "query-draft",
      module: MODULE,
      actor: user,
      input: s.value,
      output: drafts.readyToUse(c.queries.QueryDraftOutput, s),
      egress: "external",
      temperature: 0.4,
    });
  } catch (err) {
    const reason = drafts.offReason(err);
    if (reason) return off(reason);
    throw err;
  }
  // The stub cannot write a real draft: with no provider set up, Write With AI is off.
  if (!run.output) return off("off");
  return {
    available: true,
    reason: null,
    subject: s.restore(run.output.subject).trim(),
    details: s.restore(run.output.details).trim(),
    ai_run_id: run.run_id,
  };
}

module.exports = { status, draft };
