"use strict";
/**
 * Tidy With AI (docs/guides/policies.md §6.6): a pasted or typed policy given back with headings,
 * numbered clauses and lists, and its words untouched. A suggestion only: nothing is saved here,
 * and People keep it or not on the screen (A18's pattern; A23: the AI writes no record).
 *
 * The model is asked for Markdown, the one renderer's grammar. Its answer is then held to the
 * promise: the words, in order, ignoring case, punctuation and list markers, must be the words
 * that were sent. An answer that changed, added or dropped a word is refused, never shown.
 */
const { AppError } = require("../../shared/errors");
const md = require("../../shared/documents/markdown");
const ai = require("../../services/ai/llm.service");

/**
 * A list marker or clause number at the start of a line ("- ", "1. ", "2) ", "3.1 "): layout, so a
 * numbered clause may become a numbered list item. A bare number ("5 days") stays a word.
 */
const MARKER = /^\s*(\d+(\.\d+)*[.)]|\d+(\.\d+)+|[-*\u2022])\s+/gm;

/** The words of a text, in order, without marks, list markers or punctuation. */
function wordsOf(markdown) {
  return md
    .markdownToText(String(markdown || "").replace(/\u200b/g, "").replace(MARKER, "").replace(/\u2217/g, "*"))
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Contact details a policy names on purpose (an email, a phone number, a link): kept out of the model. */
const KEPT_OUT = /(https?:\/\/[^\s)\]]+|[\w.+-]+@[\w-]+\.[\w.-]+|\+?\d[\d\s().-]{7,}\d)/g;

/** The text with each contact detail swapped for a placeholder word, and the way back. */
function shield(text) {
  const kept = [];
  const out = String(text).replace(KEPT_OUT, (m) => {
    kept.push(m);
    return `KEPT${String(kept.length).padStart(3, "0")}`;
  });
  const restore = (t) => String(t).replace(/KEPT(\d{3})/g, (m, n) => kept[Number(n) - 1] || m);
  return { out, restore };
}

/** Whether `after` says exactly the words of `before`. */
function sameWords(before, after) {
  const a = wordsOf(before);
  const b = wordsOf(after);
  return a.length === b.length && a.every((w, i) => w === b[i]);
}

/**
 * POST /policies/tidy
 * @param {object} user
 * @param {{body_html: string}} body
 * @returns {Promise<{body_html: string}>}
 */
async function suggest(user, body) {
  const before = md.htmlToMarkdown(body.body_html);
  if (!before.trim()) throw new AppError("POLICY_EMPTY", "Write or paste the policy first", 422, { body_html: ["Write the policy"] });
  const { out, restore } = shield(before);
  const run = await ai.complete({
    purpose: "policy-tidy",
    module: "knowledge",
    actor: user,
    input: { policy_markdown: out },
    egress: "external",
    temperature: 0,
  });
  const after = restore(String(run.text || "").replace(/^```(?:markdown)?\s*|\s*```\s*$/g, "").trim());
  if (!after || !sameWords(before, after))
    throw new AppError("AI_CHANGED_WORDS", "The tidy changed some words. Try again or tidy it by hand.", 502);
  return { body_html: md.markdownToHtml(md.htmlToMarkdown(md.markdownToHtml(after))) };
}

module.exports = { suggest, sameWords, wordsOf, shield };
