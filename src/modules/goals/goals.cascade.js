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
 *             score, else its proposed one.
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

module.exports = { nextObjectiveCode, nextKeyResultCode, monthScore, objectiveScore };
