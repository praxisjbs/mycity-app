"use strict";
/**
 * The Line Manager cell of a staff sheet, read once (docs/guides/foundation.md §6.1).
 *
 * A sheet names the manager above someone in whatever way the person filling it in
 * thought clearest. MyCity's own sheet uses four of them:
 *
 *   "Bode Oluwasanmi"                                  a person, by name
 *   "Chinyere - Head PR & Marketing"                   a person, by name and post
 *   "Program Manager", "CEO"                           a post, whoever holds it
 *   "Head Sales & Revenue, with dotted line to         a post nobody holds, and the
 *    Head PR & Marketing"                              second manager beside it
 *
 * Everything here is pure: `parse()` says what to look for and `matchesTitle()` says
 * whether one piece of text names a job title. Finding the person or the seat is the
 * module's job (organisation.service.resolveManager), because only it may read.
 *
 * A cell that matches nothing is an error on that row, never a guess (§11).
 */

/** Words that carry no meaning when a post is matched by its words. */
const NOISE = new Set(["and", "of", "the", "for", "to", "a", "an"]);

/**
 * Posts written short. Only abbreviations that mean the same in any company: MyCity's
 * own titles are never listed here, so this file carries no company data.
 */
const ABBREVIATIONS = Object.freeze({
  ceo: "chief executive officer",
  cto: "chief technology officer",
  coo: "chief operating officer",
  cfo: "chief financial officer",
  cio: "chief information officer",
  md: "managing director",
  hr: "human resources",
  pm: "program manager",
});

/** Lower case, accents and punctuation out, spacing collapsed. */
function fold(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The meaningful words of a piece of text, with short forms written out. */
function words(text) {
  const folded = fold(text);
  const expanded = ABBREVIATIONS[folded] || folded;
  return expanded.split(" ").filter((w) => w && !NOISE.has(w));
}

/** Edit distance, stopped once it passes `max` (so a long pair costs nothing). */
function distance(a, b, max = 1) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const change = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + change);
      best = Math.min(best, row[j]);
    }
    if (best > max) return max + 1;
    previous = row;
  }
  return previous[b.length];
}

/** The same word, allowing one wrong letter once a word is long enough to spare it. */
function sameWord(a, b) {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5) return false;
  return distance(a, b, 1) <= 1;
}

/**
 * Does `cell` name the post `title`?
 *
 * Every word the cell uses must appear in the title, forgiving one wrong letter in a
 * word of five letters or more, so the sheet's "Head PR & Marketing" reaches the post
 * "Head PR, Marketing & Brand Strategy", and a slip like "Markerting" on either side
 * costs nothing. A one-word cell must match the title exactly, word for word: "Head"
 * alone names nothing. The title may say more than the cell does; the cell may never
 * say more.
 */
function matchesTitle(cell, title) {
  const asked = words(cell);
  const has = words(title);
  if (asked.length === 0 || has.length === 0) return false;
  if (asked.length === 1) return has.length === 1 && sameWord(asked[0], has[0]);
  const left = [...has];
  for (const word of asked) {
    const at = left.findIndex((w) => sameWord(word, w));
    if (at === -1) return false;
    left.splice(at, 1);
  }
  return true;
}

/** "with dotted line to", in the spellings a person writes. */
const DOTTED = /[,;]?\s*(?:with|and)?\s*(?:a\s+)?dotted\s+line(?:\s+(?:to|is))?\s*[:-]?\s*/i;

/** "Chinyere - Head PR & Marketing": a name and the post beside it. */
const NAME_AND_TITLE = /^(.+?)\s+(?:[-–—·|/]|,)\s+(.+)$/;

/**
 * One side of the cell: what to look for, in the order to look.
 * @param {string} text
 * @returns {{text: string, name: string|null, title: string|null}}
 */
function target(text) {
  const trimmed = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!trimmed) return { text: "", name: null, title: null };
  const split = NAME_AND_TITLE.exec(trimmed);
  if (split) {
    const [, first, second] = split;
    return { text: trimmed, name: first.trim(), title: second.trim() };
  }
  return { text: trimmed, name: trimmed, title: trimmed };
}

/**
 * Read a Line Manager cell.
 * @param {string} cell
 * @returns {{primary: {text: string, name: string|null, title: string|null}|null,
 *            dotted: {text: string, name: string|null, title: string|null}|null}}
 */
function parse(cell) {
  const trimmed = String(cell ?? "").replace(/\s+/g, " ").trim();
  if (!trimmed) return { primary: null, dotted: null };
  const at = trimmed.search(DOTTED);
  if (at === -1) return { primary: target(trimmed), dotted: null };
  const before = trimmed.slice(0, at);
  const after = trimmed.slice(at).replace(DOTTED, "");
  return {
    primary: before.trim() ? target(before) : null,
    dotted: after.trim() ? target(after) : null,
  };
}

/** A name the sheet uses for a post nobody holds. */
const VACANT_NAMES = new Set(["vacant", "open", "open role", "tbc", "to be confirmed", "none"]);

/** Is this the name of a vacant post rather than a person? */
const isVacantName = (name) => VACANT_NAMES.has(fold(name));

module.exports = {
  ABBREVIATIONS,
  fold,
  words,
  distance,
  sameWord,
  matchesTitle,
  parse,
  target,
  isVacantName,
  VACANT_NAMES,
};
