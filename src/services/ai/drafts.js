"use strict";
/**
 * What every Write With AI shares (docs/guides/mailbox.md §6, queries.md §9): whether the AI may
 * answer now, and the "ready to use" guard a draft is held to before anyone sees it.
 *
 *   await drafts.availability(db, "queries")
 *   // → { available: true, reason: null }, or { available: false, reason: "off" | "limit" }
 *   drafts.placeholdersIn(text, s.known, { allowed: (gap) => isLetterName(gap) })
 *   // → what keeps the text from being used as it is, worded for the model's corrective retry
 *
 * The guard refuses a gap left for someone to fill (square, curly or angle brackets, "Your Name",
 * "insert ... here", XXX, a blank line, a date pattern) and a redaction token the shield never
 * handed out. A caller whose text may hold braces of its own (a letter's {{ names }}) passes
 * `allowed`, and only those pass.
 */
const { AppError } = require("../../shared/errors");
const governance = require("./governance");
const redact = require("./redact");

/** A gap left for someone to fill, and how the model is told about it. */
const GAPS = [
  [/\[[^\]\n]{1,60}\](?!\()/g, "a gap in square brackets"],
  [/\{\{?[^}\n]{1,60}\}?\}/g, "a gap in curly braces"],
  [/<\s*[A-Za-z][A-Za-z _-]{0,40}\s*>/g, "a gap in angle brackets"],
  [/^\s*(?:your|sender'?s?|recipient'?s?)\s+(?:full\s+)?name\s*$/gim, "a name left to fill in"],
  [/\binsert\b[^.\n]{0,40}\bhere\b/gi, "an instruction to insert something"],
  [/\bX{3,}\b/g, "XXX left to fill in"],
  [/_{3,}/g, "a blank line left to fill in"],
  [/\b(?:DD|MM)\/(?:MM|DD)\/(?:YYYY|YY)\b/g, "a date pattern left to fill in"],
];

/**
 * Every problem that keeps a text from being used as it is: a placeholder (the first of each
 * kind), or a token the shield never handed out.
 * @param {string} text
 * @param {(token: string) => boolean} [known]  whether a KEPT token stands for something
 * @param {{allowed?: (gap: string) => boolean}} [opts]  a gap the caller's text may hold
 * @returns {string[]}
 */
function placeholdersIn(text, known = () => false, { allowed = () => false } = {}) {
  const s = String(text || "");
  const out = [];
  for (const [re, what] of GAPS) {
    const m = [...s.matchAll(re)].find((x) => !allowed(x[0]));
    if (m) out.push(`has "${m[0].trim().slice(0, 40)}", ${what}: write it without the gap`);
  }
  for (const m of s.matchAll(redact.TOKEN))
    if (!known(m[0])) out.push(`has "${m[0]}", which stands for nothing you were given: leave it out`);
  return out;
}

/** Each text an answer carries, with its path. */
function textsOf(v) {
  const out = [];
  for (const [key, value] of Object.entries(v || {})) {
    if (typeof value === "string" && key !== "kind") out.push([[key], value]);
    else if (Array.isArray(value)) value.forEach((x, i) => typeof x === "string" && out.push([[key, i], x]));
  }
  return out;
}

/**
 * A draft's answer schema held to "ready to use" with this call's tokens: llm.service sends an
 * answer that fails it back once with the problems listed.
 * @param {import("zod").ZodTypeAny} schema
 * @param {{known: (token: string) => boolean}} s  the shield the input went through
 * @param {{allowed?: (gap: string) => boolean}} [opts]
 */
function readyToUse(schema, s, opts = {}) {
  return schema.superRefine((v, ctx) => {
    for (const [path, text] of textsOf(v))
      for (const p of placeholdersIn(text, s.known, opts)) ctx.addIssue({ code: "custom", path, message: p });
  });
}

/** The refusals that mean "not now" rather than a fault: the screen says so and carries on. */
const OFF_CODES = Object.freeze({ AI_DISABLED: "off", AI_MODULE_DISABLED: "off", AI_CAP_REACHED: "limit" });

/** Why AI cannot answer, from a refusal, or null when the error is a real fault. */
const offReason = (err) => (err instanceof AppError && OFF_CODES[err.code]) || null;

/**
 * Whether a Write With AI may answer for `module` now, without calling a model: switched on, not
 * switched off for the module, inside this month's budget, and a provider set up.
 * @returns {Promise<{available: boolean, reason: "off"|"limit"|null}>}
 */
async function availability(db, module) {
  try {
    await governance.check(db, { module });
  } catch (err) {
    const reason = offReason(err);
    if (reason) return { available: false, reason };
    throw err;
  }
  const h = await governance.health(db);
  if (h.status !== "up" || h.vendor === "stub") return { available: false, reason: "off" };
  return { available: true, reason: null };
}

module.exports = { GAPS, placeholdersIn, textsOf, readyToUse, offReason, availability };
