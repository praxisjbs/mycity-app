"use strict";
/**
 * A record a person names by its words, among a few of their own (docs/guides/praxis-ai.md §6.11,
 * `resolve`, decision 32): a leave type, a late reason, a step of a task. Matched as a person says
 * it, never guessed: the whole words first (any case, punctuation left out), then the one record
 * whose words begin with what was said or begin it, then the one whose words hold it whole; null
 * when none matches or several do, so the card marks the field and the person picks.
 *
 *   oneNamed(types, "Annual Leave", (t) => [t.name, t.code], { drop: ["leave"] })   // the type named Annual
 *   oneNamed(steps, "banners", (s) => [s.title])                                     // "Order banners"
 *
 * choiceWords() is a record's words as an answer to tap, at most 60 characters, which oneNamed matches.
 */

/** Words as a person says them: lower case, the dropped words and punctuation left out ("Annual Leave" → "annual"). */
function plainWords(s, drop = []) {
  let out = String(s === null || s === undefined ? "" : s).toLowerCase();
  for (const w of drop) out = out.replace(new RegExp(`\\b${w}\\b`, "g"), " ");
  return out.replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The one item the words name, or null.
 * @template T
 * @param {T[]} items
 * @param {string} said
 * @param {(item: T) => Array<string|null|undefined>} namesOf  what the item is called: its name, its code
 * @param {{drop?: string[]}} [opts]  words a person may add or leave out ("leave" of a leave type)
 * @returns {T|null}
 */
function oneNamed(items, said, namesOf, { drop = [] } = {}) {
  const want = plainWords(said, drop);
  if (!want) return null;
  const words = (item) => (namesOf(item) || []).map((n) => plainWords(n, drop)).filter(Boolean);
  for (const fits of [
    (w) => w === want,
    (w) => w.startsWith(want) || want.startsWith(`${w} `),
    (w) => ` ${w} `.includes(` ${want} `),
  ]) {
    const found = (items || []).filter((i) => words(i).some(fits));
    if (found.length === 1) return found[0];
    if (found.length > 1) return null;
  }
  return null;
}

/**
 * The one item the words name across a few lists tried in turn (a search for the words, then the
 * first page as it stands): the first list where exactly one matches wins; null when none does.
 * @template T
 * @param {Array<() => Promise<T[]>|T[]>} lists
 * @param {string} said
 * @param {(item: T) => Array<string|null|undefined>} namesOf
 * @param {{drop?: string[]}} [opts]
 * @returns {Promise<T|null>}
 */
async function oneNamedIn(lists, said, namesOf, opts) {
  for (const list of lists) {
    const found = oneNamed((await list()) || [], said, namesOf, opts);
    if (found) return found;
  }
  return null;
}

/** The answers' own limit on a tap (AiAnswer.choices; answer.withOptions keeps nothing longer). */
const CHOICE_MAX = 60;

/**
 * A record's words as an answer to tap (decision 34): whole when they fit, else cut at a word and
 * marked "…", which oneNamed reads as the words its record begins with.
 * @param {string} words
 * @returns {string}
 */
function choiceWords(words) {
  const s = String(words === null || words === undefined ? "" : words).replace(/\s+/g, " ").trim();
  if (s.length <= CHOICE_MAX) return s;
  const cut = s.slice(0, CHOICE_MAX - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > CHOICE_MAX / 2 ? cut.slice(0, at) : cut).replace(/[\s,.;:·-]+$/, "")}…`;
}

module.exports = { oneNamed, oneNamedIn, plainWords, choiceWords };
