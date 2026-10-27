"use strict";
/**
 * Write With AI on the letter editor (docs/guides/queries.md §9, prompt `letter-draft`, job Deep
 * Reasoning): a letter template's wording drafted from its name, purpose, the wording so far and
 * what the person asks for, run only when they press it. Nothing is kept: the editor takes the
 * draft when the person presses Use Draft, and saving is their own press (A23).
 *
 *   status()   GET /letter-templates/assist
 *   draft()    POST /letter-templates/assist
 *
 * The letter may hold its own names ({{ employee.first_name }}, {{ money fine_amount }}); the
 * guard lets through exactly those ConsequenceLetterVars declares, written plainly or through a
 * house format, and refuses every other gap.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const md = require("../../shared/documents/markdown");
const ai = require("../../services/ai/llm.service");
const drafts = require("../../services/ai/drafts");
const redact = require("../../services/ai/redact");
const { VARIABLE_NAMES } = require("./templates.service");

const MODULE = "queries";

/** What each name a letter may use holds, for the model. */
const NAMES = Object.freeze({
  employee: "employee.display_name, employee.first_name, employee.job_title, employee.department",
  query_number: "the query's number, QRY-0001",
  subject: "what the query is about",
  details: "what happened, as the query says it",
  reason: "why the sanction was decided",
  step_name: "the sanction's rung: Warning, Question, Suspension and so on",
  raised_on: "the day the query was raised (a date)",
  response_due: "when the response is due (a date and time)",
  effective_on: "the day the sanction takes effect (a date)",
  ends_on: "the last day of a suspension (a date)",
  days: "how many days a suspension lasts",
  fine_amount: "the fine, in naira (an amount)",
  policy: "policy.title, policy.number, policy.version, policy.clause: the policy the query cites",
  signer: "who signs; the letterhead prints it, so never write it",
});

/** The parts of a name that holds several (ConsequenceLetterVars); the signer is the letterhead's. */
const PARTS = Object.freeze({
  employee: ["display_name", "first_name", "job_title", "department"],
  policy: ["title", "number", "version", "clause"],
  signer: [],
});

/** The house formats a letter may write a value with (shared/documents/render.js). */
const FORMATS = new Set(["date", "longdate", "datetime", "month", "money", "number"]);

/** Whether `{{ ... }}` is one of the letter's own names, plainly, formatted or in a condition. */
function letterName(gap) {
  const inner = String(gap).replace(/^\{\{?\s*|\s*\}?\}$/g, "");
  if (inner === "else" || inner === "/if") return true;
  const condition = /^#if\s+/.test(inner);
  const words = inner.replace(/^#if\s+/, "").split(/\s+/);
  const path = words.length === 2 && FORMATS.has(words[0]) ? words[1] : words.length === 1 ? words[0] : null;
  if (!path || !/^[a-z_]+(\.[a-z_]+)?$/.test(path)) return false;
  const [root, part] = path.split(".");
  if (!VARIABLE_NAMES.includes(root)) return false;
  // A condition may ask whether a whole record is there ({{#if policy}}); the signer is never written.
  if (PARTS[root] && !part) return condition && root !== "signer";
  return PARTS[root] ? PARTS[root].includes(part) : !part;
}

const off = (reason) => ({ available: false, reason, body_html: null, ai_run_id: null });

const status = () => drafts.availability(pool, MODULE);

/** POST /letter-templates/assist (LetterDraftRequest): a draft for the editor, or why there is none. */
async function draft(user, body) {
  const now = await status();
  if (!now.available) return off(now.reason);
  const s = redact.shield({
    letter: { name: body.name, purpose: body.purpose },
    wording: body.body_html ? md.htmlToMarkdown(body.body_html) : "",
    instruction: body.instruction,
    names: NAMES,
    formats: [...FORMATS],
    conditionals: "{{#if name}} ... {{else}} ... {{/if}}",
  });
  let run;
  try {
    run = await ai.complete({
      purpose: "letter-draft",
      module: MODULE,
      actor: user,
      input: s.value,
      output: drafts.readyToUse(c.templates.LetterDraftOutput, s, { allowed: letterName }),
      egress: "external",
      temperature: 0.3,
    });
  } catch (err) {
    const reason = drafts.offReason(err);
    if (reason) return off(reason);
    throw err;
  }
  if (!run.output) return off("off");
  return { available: true, reason: null, body_html: md.markdownToHtml(s.restore(run.output.body_markdown)), ai_run_id: run.run_id };
}

module.exports = { status, draft, letterName };
