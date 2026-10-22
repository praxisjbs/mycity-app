"use strict";
/**
 * Goals and targets, as Home reads them: the organisation's goals over a period (Goals
 * This Quarter on the CEO's Overview) and a person's own targets due in one (My Goals This
 * Quarter on the Staff Overview).
 *
 * OWNED BY the `goals` and `targets` modules, M2 Productivity & Performance, AJ
 * (migration 2000).
 *
 * Home reads these tables before the modules that own them are built, so this file is the
 * one place Home names them. The M2 pull request that builds goals and targets MUST, in the
 * same PR, move or replace these queries with its own reads, keep `tables` true to every
 * column they name, and clear `owes` as it pays each item (docs/guides/home.md §4.1,
 * docs/DATABASE_SCHEMA.md M2 Owes). A unit test holds `tables` to the migrated schema and
 * the queries to `tables`.
 *
 * What these queries do NOT give yet is how far along a goal is (Performance PR 5), so the
 * Goals On Track and My Targets cards stay hidden in the catalogue with no query, and a goal's
 * progress is null on screen until it is added here.
 */
const { pageQuery, TOTAL_COL } = require("../../../shared/http/paged");

/** The forward tables and the columns these queries read. */
const TABLES = Object.freeze({
  organisational_goal: ["organisational_goal_id", "level", "title", "status", "starts_on", "ends_on"],
  employee_target: ["employee_target_id", "employee_id", "title", "due_on", "scorecard_id"],
  scorecard: ["scorecard_id", "status"],
});

/**
 * What M2 still owes these queries. Paid in Performance PR 2: the cascade (organisational goals
 * stay at level `organisation`; the rest of A16's cascade is objectives and key results, which
 * Home does not read), a target's statuses (a line counts once its scorecard binds), and the
 * indexes (migration 2100).
 */
const OWES = Object.freeze([
  "Progress: how far along a goal or target is, and when it is on track; Goals On Track and My Targets wait for it " +
    "(Performance PR 5, docs/guides/performance.md §6.21).",
]);

/**
 * One page of the organisation's own goals live in the period `from` to `to` (dates,
 * both included), soonest ending first, closed ones too.
 * @param {{query: Function}} client
 * @param {{from: string, to: string}} period  YYYY-MM-DD
 * @param {{page?: number}} query
 */
function organisationGoals(client, { from, to }, query) {
  return pageQuery(
    client,
    `SELECT g.organisational_goal_id, g.title, g.status, g.starts_on, g.ends_on, ${TOTAL_COL}
       FROM organisational_goal g
      WHERE g.level = 'organisation' AND g.status IN ('active', 'closed')
        AND g.starts_on <= $2::date AND g.ends_on >= $1::date
      ORDER BY g.ends_on, g.organisational_goal_id`,
    [from, to],
    query,
  );
}

/**
 * One page of a person's targets due in the period `from` to `to` (dates, both included),
 * soonest due first: the lines of their scorecard once it binds (a draft is not yet theirs to
 * meet), and any target outside a scorecard.
 * @param {{query: Function}} client
 * @param {{employee_id: string, from: string, to: string}} period
 * @param {{page?: number}} query
 */
function targetsOf(client, { employee_id: employeeId, from, to }, query) {
  return pageQuery(
    client,
    `SELECT t.employee_target_id, t.title, t.due_on, ${TOTAL_COL}
       FROM employee_target t
       LEFT JOIN scorecard s ON s.scorecard_id = t.scorecard_id
      WHERE t.employee_id = $1 AND t.due_on >= $2::date AND t.due_on <= $3::date
        AND (t.scorecard_id IS NULL OR s.status IN ('binding', 'agreed', 'closed'))
      ORDER BY t.due_on, t.employee_target_id`,
    [employeeId, from, to],
    query,
  );
}

module.exports = {
  module: "goals",
  milestone: "M2",
  owner: "AJ",
  tables: TABLES,
  owes: OWES,
  organisationGoals,
  targetsOf,
};
