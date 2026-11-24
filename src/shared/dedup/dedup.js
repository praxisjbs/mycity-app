"use strict";
/**
 * "Is this the same person or company as one we already have?" Scored, advisory,
 * never blocking: a likely duplicate is shown with its reasons and a person
 * decides (merge, link, or carry on). Used by the staff import (M0), people
 * records (M1), candidates (M4) and partners and leads (M7).
 *
 * A module describes what makes two of its records the same, as signals:
 *
 *   const signals = [
 *     { key: "work_email",  weight: 60, normalize: dedup.norm.email, label: "Same work email" },
 *     { key: "phone",       weight: 30, normalize: dedup.norm.phone, label: "Same phone number" },
 *     { key: "full_name",   weight: 40, normalize: dedup.norm.name,  label: "Same name", similar: true },
 *     { key: "nin",         weight: 70, normalize: dedup.norm.digits, label: "Same NIN" },
 *   ];
 *
 * finds candidates itself (its own SQL, usually trigram similarity on the name
 * plus exact matches on email and phone, at most 25 rows), and asks this file to
 * rank them:
 *
 *   dedup.rank(input, candidates, signals, { min: 55 })
 *   → [{ id, score: 90, reasons: ["Same work email", "Same name"] }, ...]
 *
 * Scores add up per signal and cap at 100. A `similar` signal scores in
 * proportion to word overlap when the values are not identical (60% or more of
 * the words shared), so "Adaeze N. Okafor" still meets "Adaeze Okafor".
 *
 * A candidate may carry the likeness its SQL already measured for a signal
 * (`likeness: { name: 0.71 }`, pg_trgm's similarity): the better of that and
 * the word overlap is the one scored, so "Kora Strt Kitchens" meets "Kora Street
 * Kitchens" though no whole word but two is shared. A signal with
 * `similarWeight` scores that flat for a similar value (60% or more alike),
 * where a similar name alone should be a match.
 */

/* ---------------- normalisers ---------------- */

const norm = {
  /** Lower case, trimmed. */
  email: (v) => (v ? String(v).trim().toLowerCase() : null),
  /** Digits only. */
  digits: (v) => {
    const d = String(v || "").replace(/\D/g, "");
    return d || null;
  },
  /** Nigerian numbers to their 10 national digits, so 0803..., +234803... and 234803... meet. */
  phone: (v) => {
    const d = String(v || "").replace(/\D/g, "");
    if (!d) return null;
    if (d.startsWith("234") && d.length === 13) return d.slice(3);
    if (d.startsWith("0") && d.length === 11) return d.slice(1);
    return d;
  },
  /** Lower case, accents removed, punctuation and titles dropped, words sorted. */
  name: (v) => {
    if (!v) return null;
    const words = String(v)
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w && !TITLES.has(w));
    return words.length ? words.sort().join(" ") : null;
  },
  /**
   * Company names: as `name`, with common abbreviations written out, plurals made singular, and
   * legal suffixes and joining words dropped, so "Kora St Kitchens Ltd" and "kora street kitchen" meet.
   */
  company: (v) => {
    const n = norm.name(v);
    if (!n) return null;
    const words = n
      .split(" ")
      .map((w) => singular(ABBREVIATIONS[w] || w))
      .filter((w) => !COMPANY_SUFFIXES.has(w) && !JOINING_WORDS.has(w));
    return words.length ? words.sort().join(" ") : n;
  },
};

/** One word's singular: "kitchens" is "kitchen", "agencies" is "agency"; "glass" and "bus" stay. */
function singular(w) {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) return w.slice(0, -1);
  return w;
}

/** Abbreviations in company names, written out (before plurals are made singular). */
const ABBREVIATIONS = Object.freeze({
  st: "street",
  rd: "road",
  ave: "avenue",
  intl: "international",
  int: "international",
  natl: "national",
  mgt: "management",
  mgmt: "management",
  svc: "service",
  svcs: "service",
  tech: "technology",
  assoc: "association",
  bros: "brother",
  ctr: "centre",
  center: "centre",
});
/** Words that join a name and tell two companies apart from nothing: "&" is dropped as punctuation. */
const JOINING_WORDS = new Set(["and", "the"]);

const TITLES = new Set([
  "mr",
  "mrs",
  "ms",
  "miss",
  "dr",
  "prof",
  "engr",
  "chief",
  "alhaji",
  "alhaja",
  "pastor",
  "barr",
  "hon",
]);
// Compared after plurals are made singular, so "enterprises" is "enterprise" here.
const COMPANY_SUFFIXES = new Set([
  "ltd",
  "limited",
  "plc",
  "llc",
  "inc",
  "nig",
  "nigeria",
  "co",
  "company",
  "enterprise",
  "venture",
]);

/** Share of words in common: |a ∩ b| / |a ∪ b|. */
function overlap(a, b) {
  const x = new Set(String(a).split(" "));
  const y = new Set(String(b).split(" "));
  let common = 0;
  for (const w of x) if (y.has(w)) common += 1;
  return common / (x.size + y.size - common);
}

const SIMILAR_FROM = 0.6;

/**
 * Score one candidate against the input.
 * @returns {{score: number, reasons: string[]}}
 */
function score(input, candidate, signals) {
  let total = 0;
  const reasons = [];
  for (const s of signals) {
    const n = s.normalize || ((v) => v);
    const a = n(input[s.key]);
    const b = n(candidate[s.key]);
    if (
      a === null ||
      a === undefined ||
      a === "" ||
      b === null ||
      b === undefined ||
      b === ""
    )
      continue;
    if (a === b) {
      total += s.weight;
      reasons.push(s.label);
    } else if (s.similar) {
      const measured = Number((candidate.likeness || {})[s.key]) || 0;
      const o = Math.max(overlap(a, b), measured);
      if (o >= SIMILAR_FROM) {
        total += s.similarWeight === undefined ? Math.round(s.weight * o) : s.similarWeight;
        reasons.push(`${s.label} (similar)`);
      }
    }
  }
  return { score: Math.min(100, total), reasons };
}

/**
 * Rank candidates, best first, dropping those under `min`.
 * @param {object} input
 * @param {Array<object>} candidates  each with `id` and the signal keys, and `likeness` ({key: 0 to 1}) when measured
 * @param {Array<{key: string, weight: number, label: string, normalize?: Function, similar?: boolean, similarWeight?: number}>} signals
 * @param {{min?: number, cap?: number, idKey?: string}} [opts]
 */
function rank(
  input,
  candidates,
  signals,
  { min = 55, cap = 10, idKey = "id" } = {},
) {
  return (candidates || [])
    .map((c) => ({ id: c[idKey], ...score(input, c, signals) }))
    .filter((r) => r.score >= min)
    .sort(
      (a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)),
    )
    .slice(0, cap);
}

module.exports = { norm, overlap, score, rank, SIMILAR_FROM };
