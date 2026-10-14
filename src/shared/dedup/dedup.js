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
  /** Company names: as `name`, without legal suffixes. */
  company: (v) => {
    const n = norm.name(v);
    if (!n) return null;
    const words = n.split(" ").filter((w) => !COMPANY_SUFFIXES.has(w));
    return words.length ? words.join(" ") : n;
  },
};

const TITLES = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "engr", "chief", "alhaji", "alhaja", "pastor", "barr", "hon"]);
const COMPANY_SUFFIXES = new Set(["ltd", "limited", "plc", "llc", "inc", "nig", "nigeria", "co", "company", "enterprises", "ventures"]);

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
    if (a === null || a === undefined || a === "" || b === null || b === undefined || b === "") continue;
    if (a === b) {
      total += s.weight;
      reasons.push(s.label);
    } else if (s.similar) {
      const o = overlap(a, b);
      if (o >= SIMILAR_FROM) {
        total += Math.round(s.weight * o);
        reasons.push(`${s.label} (similar)`);
      }
    }
  }
  return { score: Math.min(100, total), reasons };
}

/**
 * Rank candidates, best first, dropping those under `min`.
 * @param {object} input
 * @param {Array<object>} candidates  each with `id` and the signal keys
 * @param {Array<{key: string, weight: number, label: string, normalize?: Function, similar?: boolean}>} signals
 * @param {{min?: number, cap?: number, idKey?: string}} [opts]
 */
function rank(input, candidates, signals, { min = 55, cap = 10, idKey = "id" } = {}) {
  return (candidates || [])
    .map((c) => ({ id: c[idKey], ...score(input, c, signals) }))
    .filter((r) => r.score >= min)
    .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)))
    .slice(0, cap);
}

module.exports = { norm, overlap, score, rank, SIMILAR_FROM };
