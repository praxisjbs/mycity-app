"use strict";
/**
 * Codes and the roll-up (docs/guides/performance.md §6.1, §6.8).
 *
 *   codes     company objectives CO-O<n>, their key results CO-KR<n>.<m>; a function's
 *             <code>-O<n> and <code>-KR<n>.<m>, where <code> is the department's (G1). The next
 *             free number is given when a draft is saved; imported rows keep theirs.
 *   roll-up   an objective's score is the mean of its key results' scores for the month; a
 *             function's the mean of its objectives'; the company's the mean of the company
 *             objectives'. Blank when nothing is scored. A key result's score is its confirmed
 *             score, else its proposed one. objectiveScores() is the same roll-up in SQL, for
 *             Analytics and Home (goals.analytics.js, dashboard/sources/goals.source.js).
 */
const { scoring } = require("@mycity/contract");

/** The next free objective code in a quarter: BM-O3 after BM-O1 and BM-O2. */
function nextObjectiveCode(prefix, used) {
  const taken = new Set(used.map((c) => Number(new RegExp(`^${prefix}-O(\\d+)$`, "i").exec(c)?.[1] || 0)));
  let n = 1;
  while (taken.has(n)) n += 1;
  return `${prefix}-O${n}`;
}

/** The next key result code under an objective: BM-O2 holds BM-KR2.1, BM-KR2.2 ... */
function nextKeyResultCode(objectiveCode, used) {
  const m = /^(.+)-O(\d+)$/i.exec(objectiveCode);
  const base = m ? `${m[1]}-KR${m[2]}` : `${objectiveCode}-KR`;
  const taken = new Set(used.map((c) => Number(new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(\\d+)$`, "i").exec(c)?.[1] || 0)));
  let n = 1;
  while (taken.has(n)) n += 1;
  return `${base}.${n}`;
}

/** The score a month counts with: confirmed, else proposed. */
const monthScore = (m) => (m ? scoring.num(m.confirmed_score ?? m.proposed_score) : null);

/** An objective's score: the mean of its key results' latest scores. */
const objectiveScore = (keyResults) => scoring.meanScore(keyResults.map((kr) => monthScore(kr.latest)));

/**
 * The quarter's objectives with the score Goals shows for each, in SQL: each key result at its
 * latest month, confirmed else proposed, and the objective the mean of them to two places, as
 * objectiveScore() works it out. The body of a CTE the caller names objective_score
 * (`WITH objective_score AS (${objectiveScores("$1")})`): okr_objective_id, department_id,
 * organisational_goal_id, score, over the quarters `periods` names: a placeholder ("$1") or a
 * subquery of their ids.
 */
const objectiveScores = (periods) => `
    SELECT o.okr_objective_id, o.department_id, o.organisational_goal_id,
           round(avg(COALESCE(km.confirmed_score, km.proposed_score)), 2) AS score
      FROM okr_objective o
      JOIN okr_key_result k ON k.okr_objective_id = o.okr_objective_id
      LEFT JOIN okr_key_result_month km ON km.okr_key_result_id = k.okr_key_result_id
       AND km.month = (SELECT max(kx.month) FROM okr_key_result_month kx WHERE kx.okr_key_result_id = k.okr_key_result_id)
     WHERE o.performance_period_id IN (${periods})
     GROUP BY o.okr_objective_id, o.department_id, o.organisational_goal_id`;

module.exports = { nextObjectiveCode, nextKeyResultCode, monthScore, objectiveScore, objectiveScores };
