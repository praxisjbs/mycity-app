"use strict";
/**
 * The weighted scorecard (docs/guides/recruitment.md §6.5, A10), worked out on read and never
 * stored, so a change of weights reranks everyone at once. The part scores come from the repo
 * (candidates.repo.js PART_SCORES), which ranks the board by the same total in SQL:
 *
 *   screening      the shown screening score (the estimate counts, flagged Provisional)
 *   psychometric, technical, case_study   the latest scored sitting of that type; a practical
 *                  assessment counts as technical
 *   interview      the mean of the closed rounds' interview_score
 *
 * Only the parts switched on count. Total = Σ(weight × score) ÷ Σ(weight of the parts on that
 * have a score), to one decimal; null when none has a score.
 */
const { round1 } = require("./candidates.screening");

const num = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * @param {Array<{code: string, name: string, active: boolean, weight: number}>} parts  the vacancy's five
 * @param {Record<string, number|string|null>} scores  by part code
 * @param {boolean} provisional  the screening score is the estimate
 */
function scorecard(parts, scores, provisional) {
  const rows = parts.map((p) => ({
    code: p.code,
    name: p.name,
    active: p.active,
    weight: p.weight,
    score: num(scores[p.code]) === null ? null : round1(num(scores[p.code])),
    provisional: p.code === "screening" && provisional && num(scores.screening) !== null,
  }));
  const counted = rows.filter((r) => r.active && r.score !== null);
  const weights = counted.reduce((n, r) => n + r.weight, 0);
  return {
    parts: rows,
    weighted_total: weights ? round1(counted.reduce((n, r) => n + r.weight * r.score, 0) / weights) : null,
    parts_scored: counted.length,
    parts_active: Math.max(1, rows.filter((r) => r.active).length),
  };
}

module.exports = { scorecard };
