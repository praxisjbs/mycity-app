"use strict";
/**
 * Tidy With AI on the agreement template editor (docs/guides/partnerships.md §6.8, prompt `template-tidy`,
 * job Default, chosen by JP on 06/11/2026): the text of a Word agreement MyCity already uses, pasted,
 * given back with headings, numbered clauses and its financials grid as a table, and a field proposed for
 * every value that belongs to a partner or a deal. A suggestion only, run when the person presses it:
 * nothing is saved here, and the editor keeps the draft or not (A23: the AI writes no record).
 *
 * The model is asked for Markdown, the one renderer's grammar, with each value written as its `{{ field }}`.
 * Its answer is then held to the promise: the words outside the values it replaced, in order, ignoring case,
 * punctuation and list markers, must be the words that were sent. An answer that changed, added or dropped
 * a word is refused, never shown. Every field it names must be a record field or an ask it declares.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { AppError } = require("../../shared/errors");
const md = require("../../shared/documents/markdown");
const ai = require("../../services/ai/llm.service");
const drafts = require("../../services/ai/drafts");
const redact = require("../../services/ai/redact");
const wording = require("../templates/templates.agreements");

const MODULE = "partnerships";

/** The house formats a value may be written with (shared/documents/render.js). */
const FORMATS = new Set(["date", "longdate", "datetime", "month", "money", "number"]);

/** What each record field holds, for the model. */
const FIELD_NOTES = Object.freeze(
  Object.fromEntries(wording.RECORD_FIELDS.map((f) => [f.field, `${f.label} (${f.type}${f.source === "signing" ? ", filled when it is signed" : ""})`])),
);

const TAG = /\{\{\s*(?:(\w+)\s+)?([a-zA-Z_][\w]*(?:\.[\w]+)*)\s*\}\}/g;

/** A list marker or clause number at the start of a line: layout, so a numbered clause may become a list item. */
const MARKER = /^\s*(\d+(\.\d+)*[.)]|\d+(\.\d+)+|[-*•])\s+/gm;

/** The words of a text, in order, without marks, list markers, table rules or punctuation. */
function wordsOf(markdown) {
  return md
    .markdownToText(String(markdown || "").replace(/\u200b/g, "").replace(MARKER, "").replace(/\u2217/g, "*").replace(/^\s*\|?[\s:|-]+\|\s*$/gm, ""))
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Contact details a pasted agreement carries on purpose (an email, a phone number, a link): kept out of the model. */
const KEPT_OUT = /(https?:\/\/[^\s)\]]+|[\w.+-]+@[\w-]+\.[\w.-]+|\+?\d[\d\s().-]{7,}\d)/g;

const escapeRegExp = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The text without the words of each value a field replaced; the value's own spacing and line breaks may differ. */
function withoutValues(text, replaced) {
  let rest = String(text);
  for (const found of [...replaced].sort((a, b) => b.length - a.length)) {
    const pieces = String(found).trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
    if (pieces.length) rest = rest.replace(new RegExp(pieces.join("\\s+"), "g"), " ");
  }
  return rest;
}

/** Whether `after` says the words of `before`, apart from the values it replaced by a field. */
function sameWords(before, after, replaced) {
  const a = wordsOf(withoutValues(before, replaced));
  const b = wordsOf(String(after).replace(TAG, " "));
  return a.length === b.length && a.every((w, i) => w === b[i]);
}

/** The first problem with the fields an answer names, worded for the model's corrective retry, or null. */
function fieldProblems(output) {
  const out = [];
  const record = new Set(wording.RECORD_FIELDS.map((f) => f.field));
  const asks = new Map(output.fields.filter((f) => f.source === "ask").map((f) => [f.field, f]));
  for (const m of output.body_markdown.matchAll(TAG)) {
    const [, helper, path] = m;
    if (helper && !FORMATS.has(helper)) out.push(`"${m[0]}" uses ${helper}, which is not a format: use ${[...FORMATS].join(", ")}`);
    else if (!record.has(path) && !(path.startsWith("ask.") && asks.has(path)))
      out.push(`"${m[0]}" names ${path}, which is neither a field you were given nor an ask listed in fields with source "ask"`);
  }
  for (const f of output.fields)
    if (f.source === "ask" && (!/^ask\.[a-z][a-z0-9_]{0,39}$/.test(f.field) || !f.ask_type))
      out.push(`the ask ${f.field} needs a key like ask.opening_hours and an ask_type`);
  return out.slice(0, 3);
}

/** A shield token the answer carries that the input never held: the model made it up. */
const tokenProblems = (text, known) =>
  [...String(text).matchAll(redact.TOKEN)].filter((m) => !known(m[0])).slice(0, 1).map((m) => `has "${m[0]}", which stands for nothing you were given: leave it out`);

const off = (reason) => ({ available: false, reason, body_html: null, fields: [], ai_run_id: null });

/**
 * POST /templates/tidy (TemplateTidy): a draft for the editor, or why there is none (AI off, or the
 * month's limit reached). Nothing is kept.
 * @param {object} user
 * @param {{text: string, kind?: string}} body
 */
async function tidy(user, body) {
  const now = await drafts.availability(pool, MODULE);
  if (!now.available) return off(now.reason);
  const s = redact.shield(
    { agreement_text: body.text, kind: body.kind || null, fields: FIELD_NOTES, formats: [...FORMATS] },
    { also: [KEPT_OUT] },
  );
  let run;
  try {
    run = await ai.complete({
      purpose: "template-tidy",
      module: MODULE,
      actor: user,
      input: s.value,
      output: c.partner_pipeline.TemplateTidyOutput.superRefine((v, ctx) => {
        for (const message of [...fieldProblems(v), ...tokenProblems(v.body_markdown, s.known)])
          ctx.addIssue({ code: "custom", path: ["body_markdown"], message });
      }),
      egress: "external",
      temperature: 0,
    });
  } catch (err) {
    const reason = drafts.offReason(err);
    if (reason) return off(reason);
    throw err;
  }
  if (!run.output) return off("off");
  const after = s.restore(run.output.body_markdown);
  const fields = run.output.fields
    .map((f) => ({ ...f, found: s.restore(f.found) }))
    .filter((f) => after.includes(`${f.field}`));
  if (!sameWords(body.text, after, fields.map((f) => f.found)))
    throw new AppError("AI_CHANGED_WORDS", "The tidy changed some words. Try again or tidy it by hand.", 502);
  const asks = fields.filter((f) => f.source === "ask").map((f) => ({ key: f.field.slice(4), label: f.label, type: f.ask_type }));
  return {
    available: true,
    reason: null,
    body_html: wording.editorHtml(after, wording.catalogOf([], asks)),
    fields,
    ai_run_id: run.run_id || null,
  };
}

module.exports = { tidy, sameWords, wordsOf, fieldProblems };
