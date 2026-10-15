/**
 * The word limits a shared component can check for itself while a screen is
 * being built (FRONTEND_GUIDE §5.3). The gates (scripts/check/lib/copy.js) are
 * the rule; this only warns in development, at the moment a screen passes the
 * copy, so a builder sees it before the gate does. Words are counted as the
 * gate counts them: tokens that contain a letter, so numbers, dates and money
 * are free. Only plain strings are counted; a node built at run time is left
 * to the crawl.
 */

/** The limits the Help, Feedback and Navigation components check (copy.js LIMITS mirrors these). */
export const WORD_LIMITS = {
  /** Button, tab, filter chip, segment. */
  button: 3,
  /** A sheet or popover title. */
  title: 4,
  toast: 8,
  help: 35,
  details: 60,
} as const;

/** Words in a plain string: tokens that contain a letter. Anything that is not a string counts 0. */
export function countWords(text: unknown): number {
  if (typeof text !== "string") return 0;
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => /\p{L}/u.test(t)).length;
}

/** In development, warn when a plain string passes its limit. Silent in a release build. */
export function warnOverLimit(what: string, text: unknown, limit: number): void {
  if (!import.meta.env.DEV) return;
  const n = countWords(text);
  if (n > limit) console.warn(`${what} "${String(text)}" is ${n} words (limit ${limit}, FRONTEND_GUIDE §5.3).`);
}
