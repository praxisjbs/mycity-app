"use strict";
/**
 * Up and down the cascade (docs/guides/performance.md §3 step 7, §6 Roll-up).
 *
 *   progressOf()   each goal's attainment, rolled up from its approved children: a
 *                  departmental target is the weighted mean of its KPIs; a monthly goal the
 *                  mean of its targets; annual and organisational goals the mean of their
 *                  children whose period has begun.
 *   traceOf()      a goal's ancestors, parent first, to its organisational goal.
 */
const lagos = require("../../shared/time/lagos");
const score = require("../kpis/kpis.score");
const repo = require("./goals.repo");

/**
 * @param {{query: Function}} client
 * @param {Array<{organisational_goal_id: string, starts_on: string, ends_on: string}>} goals
 * @param {{today?: string, cal: object}} opts
 * @returns {Promise<Map<string, {attainment: number|null, progress_status: string|null}>>}
 */
async function progressOf(client, goals, { today = lagos.today(), cal }) {
  const rows = await repo.subtree(
    client,
    goals.map((g) => g.organisational_goal_id),
    score.ATTAINMENT_SQL("t"),
    score.COUNTED,
  );
  const kids = new Map();
  for (const r of rows) {
    if (!r.parent_goal_id) continue;
    if (!kids.has(r.parent_goal_id)) kids.set(r.parent_goal_id, []);
    kids.get(r.parent_goal_id).push(r);
  }
  const memo = new Map();
  const roll = (node) => {
    if (memo.has(node.organisational_goal_id)) return memo.get(node.organisational_goal_id);
    let value;
    if (node.level === "department") value = node.own_attainment;
    else {
      const begun = (kids.get(node.organisational_goal_id) || []).filter((c) => c.starts_on <= today);
      const values = begun.map(roll).filter((v) => v !== null);
      value = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    }
    memo.set(node.organisational_goal_id, value);
    return value;
  };
  const byId = new Map(rows.map((r) => [r.organisational_goal_id, r]));
  const out = new Map();
  for (const g of goals) {
    const node = byId.get(g.organisational_goal_id) || { ...g, level: g.level, own_attainment: null };
    const attainment = roll(node);
    const share = score.elapsed(g.starts_on, g.ends_on, today, cal);
    out.set(g.organisational_goal_id, {
      attainment: attainment === null ? null : Math.round(attainment * 10000) / 10000,
      progress_status: score.statusOf(attainment, share),
    });
  }
  return out;
}

/** The goal's ancestors, parent first. */
function traceOf(client, id) {
  return repo.ancestors(client, id);
}

module.exports = { progressOf, traceOf };
