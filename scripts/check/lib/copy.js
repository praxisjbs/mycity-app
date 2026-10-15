"use strict";
/**
 * The copy rules the screen gates share (FRONTEND_GUIDE §5): the word limits,
 * how a word is counted, what Title Case means here, what makes a card title
 * an explainer, and which button labels are refused.
 *
 * One table, read by five-second.js (gate 8), two-shells.js (gate 11) and
 * forms.js (gate 12). FRONTEND_GUIDE §5.3 mirrors LIMITS; change a number
 * here and in the guide in the same PR.
 */

/** Word limits per element (FRONTEND_GUIDE §5.3). */
const LIMITS = Object.freeze({
  pageTitle: 3,
  pageSubtitle: 8,
  title: 4, // card, section, modal and KPI titles
  kpiCaption: 5,
  button: 3, // buttons, tabs, filter chips
  fieldLabel: 4,
  placeholder: 3,
  fieldError: 4,
  toast: 8,
  emptyText: 8,
  chartCaption: 8,
  help: 35,
  details: 60,
  sentence: 20,
  phoneFirstScreen: 40,
});

/** Words that may stay lower case inside a Title Case phrase. */
const MINOR = new Set(
  "a an and as at but by for from in into nor of on onto or per the to vs via with".split(" "),
);

/** A card title that explains the system instead of naming a thing (tier 3, §5.1). */
const EXPLAINER_START = /^(how|why|what|when|where|about)\b/i;
const EXPLAINER_VERB = /\b(is|are|isn't|aren't)\b/i;

/** Button labels that say nothing about the action (§5.4). */
const BANNED_BUTTONS = new Set(["submit", "ok", "okay", "yes", "no", "click here"]);

const clean = (text) => String(text === null || text === undefined ? "" : text).replace(/\s+/g, " ").trim();

/** Tokens that contain a letter. Numbers, dates, money and symbols are free. */
function words(text) {
  return clean(text)
    .split(" ")
    .filter((t) => /\p{L}/u.test(t));
}

const wordCount = (text) => words(text).length;

/** Sentences, split on . ! ? followed by a space or the end. */
function sentences(text) {
  return clean(text)
    .split(/(?<=[.!?])\s+/)
    .filter((s) => /\p{L}/u.test(s));
}

/** The longest sentence's word count (0 for no text). */
const longestSentence = (text) => sentences(text).reduce((max, s) => Math.max(max, wordCount(s)), 0);

/**
 * Title Case, as FRONTEND_GUIDE §5.4 defines it: the first word and every word
 * that is not a small word starts with a capital; each part of a hyphenated
 * word too. Tokens that are not plain words are skipped: anything with a digit,
 * a dot, an @ or a slash (dates, domains, file types), acronyms, and mixed-case
 * brand words (iOS).
 * Returns the first offending word, or null when the phrase is fine.
 */
function titleCaseViolation(text) {
  const tokens = clean(text).split(" ");
  let first = true;
  for (const raw of tokens) {
    const token = raw.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, "");
    if (!token) continue;
    const isFirst = first;
    first = false;
    if (/[\d.@/]/.test(token) || !/\p{L}/u.test(token)) continue;
    if (/^\p{Ll}/u.test(token) && /\p{Lu}/u.test(token.slice(1))) continue; // iOS, eNaira
    if (token === token.toUpperCase()) continue; // PDF, CEO, KPI
    if (!isFirst && MINOR.has(token.toLowerCase())) continue;
    const parts = token.split("-").filter(Boolean);
    for (const part of parts) {
      if (/^\p{Ll}/u.test(part) && !(part !== parts[0] && MINOR.has(part))) return raw;
    }
  }
  return null;
}

/** Why a title is an explainer, or null. */
function explainerTitle(text) {
  const t = clean(text);
  if (EXPLAINER_START.test(t)) return `starts with "${t.split(" ")[0]}"`;
  if (EXPLAINER_VERB.test(t)) return `is a sentence ("${EXPLAINER_VERB.exec(t)[0]}")`;
  return null;
}

const bannedButton = (text) => BANNED_BUTTONS.has(clean(text).toLowerCase());

/** Spaced or joined em dash, en dash or double hyphen in copy (gate 17). */
const DASH = /[—–]|(^|\s)--(\s|$)/;
/** A value that is only the empty-value marker, which the shared components draw (§5.4, §6). */
const EMPTY_MARKER = /^\s*[—–-]\s*$/;
const hasDash = (text) => !EMPTY_MARKER.test(String(text)) && DASH.test(String(text));

module.exports = {
  LIMITS,
  MINOR,
  words,
  wordCount,
  sentences,
  longestSentence,
  titleCaseViolation,
  explainerTitle,
  bannedButton,
  hasDash,
  clean,
};
