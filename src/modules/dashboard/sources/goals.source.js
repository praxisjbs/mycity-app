"use strict";
/**
 * Goals, key results and scorecards, as Home reads them: the organisation's goals over a period
 * and how far along each is (Goals This Quarter), the company's and each function's score (the
 * CEO's Org KPI), the quarter's key results on track (Goals On Track), a person's own scorecard
 * lines and their scores (My Goals This Quarter, My Scorecard), and each person's score to date
 * (the Team roster).
 *
 * OWNED BY the `goals` and `targets` modules, M2 Productivity & Performance, TB
 * (migrations 2000, 2100).
 *
 * Home reads these tables through this file, the one place Home names them. The M2 pull request
 * that changes what these queries read MUST, in the same PR, update them here, keep `tables` true
 * to every column they name, and say in `owes` anything left owed (docs/guides/home.md §4.1,
 * docs/DATABASE_SCHEMA.md M2 Owes). A unit test holds `tables` to the migrated schema and the
 * queries to `tables`.
 *
 * The arithmetic is Performance's (docs/guides/performance.md §6.8, §6.9, §6.21), and the
 * objective's score is the goals module's own CTE (goals.cascade.js objectiveScores), so Home,
 * Goals and Analytics show the same number:
 *
 *   the quarter            the performance quarter `today` falls in
 *   objective score        each key result at its latest month (confirmed, else proposed), the
 *                          mean to two places
 *   goal progress          the mean of the company objectives serving the goal, as a percentage
 *   Org KPI                the company's objectives' mean, and each function's, as a percentage
 *   Goals On Track         key results whose latest month is On Track or Done, of all the quarter's
 *   a line's score         from its closed monthly reviews' final scores: a Results line its
 *                          latest month's, a KPI or Accountability line the mean of its months
 *   My Scorecard           the reader's lines at or above the quarter's Meets band, of their scored lines
 *   score to date          the scorecard's, written when a review closes
 */
const { scoring } = require("@mycity/contract");
const { completeQuery, pageQuery, TOTAL_COL } = require("../../../shared/http/paged");
const { personJson } = require("../../../shared/db/person");
const { scopeClause } = require("../../../shared/rbac/scope");
const { objectiveScores } = require("../../goals/goals.cascade");
const visibility = require("../../goals/goals.visibility");

/** The forward tables and the columns these queries read. */
const TABLES = Object.freeze({
  organisational_goal: ["organisational_goal_id", "level", "title", "status", "starts_on", "ends_on"],
  employee_target: ["employee_target_id", "employee_id", "title", "due_on", "scorecard_id", "section", "position", "weight"],
  scorecard: ["scorecard_id", "status", "performance_period_id", "employee_id", "score_to_date"],
  performance_period: ["performance_period_id", "starts_on", "ends_on", "rules"],
  okr_objective: ["okr_objective_id", "performance_period_id", "department_id", "organisational_goal_id"],
  okr_key_result: ["okr_key_result_id", "okr_objective_id", "code", "statement", "accountable_employee_id"],
  okr_key_result_month: [
    "okr_key_result_month_id",
    "okr_key_result_id",
    "month",
    "status",
    "proposed_score",
    "confirmed_score",
  ],
  performance_review: ["performance_review_id", "performance_cycle_id", "review_kind", "status"],
  performance_review_item: ["performance_review_id", "employee_target_id", "score"],
  performance_cycle: ["performance_cycle_id", "month"],
});

/**
 * What M2 still owes these queries: nothing. Paid in Performance PR 2 (the cascade, a target's
 * statuses, the indexes of migration 2100) and PR 5 (progress, scores, Goals On Track, My Scorecard).
 */
const OWES = Object.freeze([]);

/** The quarter a date ($1, a YYYY-MM-DD) falls in, as the ids objectiveScores() reads. */
const QUARTER_OF_TODAY =
  "SELECT pq.performance_period_id FROM performance_period pq WHERE pq.starts_on <= $1::date AND pq.ends_on >= $1::date";

/** The quarters overlapping a period from $1 to $2. */
const QUARTERS_OVERLAPPING =
  "SELECT pq.performance_period_id FROM performance_period pq WHERE pq.starts_on <= $2::date AND pq.ends_on >= $1::date";

/** The latest month of the key result `k`: the join that gives it as `km`. */
const LATEST_MONTH = `LEFT JOIN okr_key_result_month km ON km.okr_key_result_id = k.okr_key_result_id
       AND km.month = (SELECT max(kx.month) FROM okr_key_result_month kx WHERE kx.okr_key_result_id = k.okr_key_result_id)`;

/**
 * A scorecard line `t`'s scores from its closed monthly reviews: `latest` (its latest month's
 * final score) and `mean` (the mean of its months'). A lateral subquery, joined as `ls`.
 */
const LINE_SCORES = `LEFT JOIN LATERAL (
         SELECT (array_agg(ri.score ORDER BY rc.month DESC))[1] AS latest, avg(ri.score) AS mean
           FROM performance_review_item ri
           JOIN performance_review rv ON rv.performance_review_id = ri.performance_review_id
           JOIN performance_cycle rc ON rc.performance_cycle_id = rv.performance_cycle_id
          WHERE ri.employee_target_id = t.employee_target_id AND rv.review_kind = 'monthly'
            AND rv.status = 'closed' AND ri.score IS NOT NULL
       ) ls ON true`;

/** A line's score: a Results line's latest month, a KPI or Accountability line's mean (§6.9). */
const LINE_SCORE = "CASE WHEN t.section = 'results' THEN ls.latest ELSE ls.mean END";

/** The statuses a key result's latest month may hold, and none yet: the chips over Goals On Track. */
const KR_GROUPS = Object.freeze(["on_track", "done", "at_risk", "off_track", "missed", "not_started", "awaiting_report"]);

/** The chips over My Scorecard. */
const LINE_GROUPS = Object.freeze(["on_track", "behind", "not_scored"]);

/** The quarter's Meets band, from its rules, else the code's default (scoring.js DEFAULT_RULES). */
const MEETS = "COALESCE((pq.rules -> 'bands' ->> 'meets')::numeric, $3)";

/**
 * One page of the organisation's own goals live in the period `from` to `to` (dates, both
 * included), soonest ending first, closed ones too, each with its progress: the mean score of the
 * company objectives serving it in the quarters of the period, as a whole percentage (null when
 * none is scored).
 * @param {{query: Function}} client
 * @param {{from: string, to: string}} period  YYYY-MM-DD
 * @param {{page?: number}} query
 * @param {object} [reach]  what the reader may read of the tree (goals.visibility.js, §6.23): the goals the
 *   whole plan reads, else those shared with them
 */
function organisationGoals(client, { from, to }, query, reach = visibility.EVERYTHING) {
  const params = [from, to];
  const readable = visibility.goalReadable(reach, "g", params);
  return pageQuery(
    client,
    `WITH objective_score AS (${objectiveScores(QUARTERS_OVERLAPPING)})
     SELECT g.organisational_goal_id, g.title, g.status, g.starts_on, g.ends_on,
            (SELECT round(avg(os.score) * 100)::int FROM objective_score os
              WHERE os.organisational_goal_id = g.organisational_goal_id AND os.department_id IS NULL) AS progress,
            ${TOTAL_COL}
       FROM organisational_goal g
      WHERE g.level = 'organisation' AND g.status IN ('active', 'closed')
        AND g.starts_on <= $2::date AND g.ends_on >= $1::date
        AND ${readable}
      ORDER BY g.ends_on, g.organisational_goal_id`,
    params,
    query,
  );
}

/**
 * One page of a person's targets due in the period `from` to `to` (dates, both included),
 * soonest due first: the lines of their scorecard once it binds (a draft is not yet theirs to
 * meet), and any target outside a scorecard; each with its score from closed reviews as a whole
 * percentage (null until one closes).
 * @param {{query: Function}} client
 * @param {{employee_id: string, from: string, to: string}} period
 * @param {{page?: number}} query
 */
function targetsOf(client, { employee_id: employeeId, from, to }, query) {
  return pageQuery(
    client,
    `SELECT t.employee_target_id, t.title, t.due_on, round(${LINE_SCORE} * 100)::int AS progress, ${TOTAL_COL}
       FROM employee_target t
       LEFT JOIN scorecard s ON s.scorecard_id = t.scorecard_id
       ${LINE_SCORES}
      WHERE t.employee_id = $1 AND t.due_on >= $2::date AND t.due_on <= $3::date
        AND (t.scorecard_id IS NULL OR s.status IN ('binding', 'agreed', 'closed'))
      ORDER BY t.due_on, t.employee_target_id`,
    [employeeId, from, to],
    query,
  );
}

/**
 * The Org KPI: the company's score (`department_id` null) and each function's, as whole
 * percentages, over the quarter `today` falls in. Functions with no objectives are not listed.
 * @param {{query: Function}} client
 * @param {{today: string}} at
 * @param {object} [reach]  the company's score is the whole plan's alone; a function's, those the reader reads
 * @returns {Promise<Array<{department_id: string|null, percent: number|null}>>}
 */
async function orgScores(client, { today }, reach = visibility.EVERYTHING) {
  const params = [today];
  const readable = visibility.departmentReadable(reach, "os.department_id", params);
  // pagination:complete the company and the functions with objectives this quarter, a handful
  const { rows } = await completeQuery(
    client,
    `WITH objective_score AS (${objectiveScores(QUARTER_OF_TODAY)})
     SELECT os.department_id, round(avg(os.score) * 100)::int AS percent
       FROM objective_score os
      WHERE ${readable}
      GROUP BY os.department_id
      ORDER BY os.department_id NULLS FIRST`,
    params,
    { label: "the Org KPI's scores", ceiling: 100 },
  );
  return rows;
}

/**
 * Goals On Track: the quarter's key results (the company's and every function's) whose latest
 * month reads On Track or Done, out of all of them, with each status counted for the chips.
 * @param {{query: Function}} client
 * @param {{today: string}} at
 */
async function keyResultsOnTrack(client, { today }, reach = visibility.EVERYTHING) {
  const params = [today];
  const readable = visibility.keyResultReadable(reach, "k", "o", params);
  const { rows } = await client.query(
    `SELECT count(*) FILTER (WHERE km.status IN ('on_track', 'done'))::int AS value,
            count(*)::int AS denominator,
            count(*) FILTER (WHERE km.status = 'on_track')::int AS on_track,
            count(*) FILTER (WHERE km.status = 'done')::int AS done,
            count(*) FILTER (WHERE km.status = 'at_risk')::int AS at_risk,
            count(*) FILTER (WHERE km.status = 'off_track')::int AS off_track,
            count(*) FILTER (WHERE km.status = 'missed')::int AS missed,
            count(*) FILTER (WHERE km.status = 'not_started')::int AS not_started,
            count(*) FILTER (WHERE km.okr_key_result_month_id IS NULL)::int AS awaiting_report
       FROM okr_objective o
       JOIN okr_key_result k ON k.okr_objective_id = o.okr_objective_id
       ${LATEST_MONTH}
      WHERE o.performance_period_id IN (${QUARTER_OF_TODAY}) AND ${readable}`,
    params,
  );
  const r = rows[0] || {};
  return {
    value: r.value,
    denominator: r.denominator,
    groups: Object.fromEntries(KR_GROUPS.map((g) => [g, r[g] || 0])),
  };
}

/**
 * One page of the quarter's key results with their latest status and score and who is accountable,
 * by code; `group` keeps one status (`awaiting_report`: no month yet).
 * @param {{query: Function}} client
 * @param {{today: string, group?: string|null}} at
 * @param {{page?: number, q?: string}} query
 * @param {object} [reach]  the key results the reader may read (§6.23)
 */
function keyResultsPage(client, { today, group = null }, query, reach = visibility.EVERYTHING) {
  const params = [today, group || null, query.q || null];
  const readable = visibility.keyResultReadable(reach, "k", "o", params);
  return pageQuery(
    client,
    `SELECT k.okr_key_result_id, k.code::text AS code, k.statement, km.status,
            trim_scale(COALESCE(km.confirmed_score, km.proposed_score))::text AS score,
            ${personJson("ae", "ad")} AS accountable, ${TOTAL_COL}
       FROM okr_objective o
       JOIN okr_key_result k ON k.okr_objective_id = o.okr_objective_id
       ${LATEST_MONTH}
       LEFT JOIN employee ae ON ae.employee_id = k.accountable_employee_id
       LEFT JOIN department ad ON ad.department_id = ae.department_id
      WHERE o.performance_period_id IN (${QUARTER_OF_TODAY})
        AND ($2::text IS NULL OR km.status = $2 OR ($2 = 'awaiting_report' AND km.okr_key_result_month_id IS NULL))
        AND ($3::text IS NULL OR search_fold(k.code::text || ' ' || k.statement) LIKE '%' || search_fold($3) || '%')
        AND ${readable}
      ORDER BY k.code, k.okr_key_result_id`,
    params,
    query,
  );
}

/**
 * A person's lines on their scorecard for the quarter `today` falls in, once it binds, each with
 * its score and the quarter's Meets band: the body of a CTE named scored_line.
 */
const SCORED_LINES = `
    SELECT t.employee_target_id, t.title, t.section, t.position, t.weight, ${LINE_SCORE} AS score, ${MEETS} AS meets
      FROM scorecard s
      JOIN performance_period pq ON pq.performance_period_id = s.performance_period_id
      JOIN employee_target t ON t.scorecard_id = s.scorecard_id
      ${LINE_SCORES}
     WHERE s.employee_id = $1 AND s.status IN ('binding', 'agreed', 'closed')
       AND pq.starts_on <= $2::date AND pq.ends_on >= $2::date`;

/**
 * My Scorecard: the reader's lines at or above the quarter's Meets band, out of their scored lines,
 * with the lines behind and those not yet scored counted for the chips.
 * @param {{query: Function}} client
 * @param {{employee_id: string, today: string}} at
 */
async function scorecardFigure(client, { employee_id: employeeId, today }) {
  const { rows } = await client.query(
    `WITH scored_line AS (${SCORED_LINES})
     SELECT count(*) FILTER (WHERE sl.score >= sl.meets)::int AS value,
            count(*) FILTER (WHERE sl.score IS NOT NULL)::int AS denominator,
            count(*) FILTER (WHERE sl.score < sl.meets)::int AS behind,
            count(*) FILTER (WHERE sl.score IS NULL)::int AS not_scored
       FROM scored_line sl`,
    [employeeId, today, scoring.DEFAULT_RULES.bands.meets],
  );
  const r = rows[0] || {};
  return {
    value: r.value,
    denominator: r.denominator,
    groups: { on_track: r.value || 0, behind: r.behind || 0, not_scored: r.not_scored || 0 },
  };
}

/**
 * One page of the reader's scorecard lines with their scores, by section and position; `group`
 * keeps those at or above Meets (on_track), below it (behind) or not yet scored (not_scored).
 * @param {{query: Function}} client
 * @param {{employee_id: string, today: string, group?: string|null}} at
 * @param {{page?: number}} query
 */
function scorecardLinesPage(client, { employee_id: employeeId, today, group = null }, query) {
  return pageQuery(
    client,
    `WITH scored_line AS (${SCORED_LINES})
     SELECT sl.employee_target_id, sl.title, sl.section, trim_scale(sl.weight)::text AS weight,
            trim_scale(round(sl.score, 4))::text AS score, (sl.score >= sl.meets) AS on_track, ${TOTAL_COL}
       FROM scored_line sl
      WHERE ($4::text IS NULL
             OR ($4 = 'on_track' AND sl.score >= sl.meets)
             OR ($4 = 'behind' AND sl.score < sl.meets)
             OR ($4 = 'not_scored' AND sl.score IS NULL))
      ORDER BY CASE sl.section WHEN 'results' THEN 1 WHEN 'kpis' THEN 2 ELSE 3 END, sl.position, sl.employee_target_id`,
    [employeeId, today, scoring.DEFAULT_RULES.bands.meets, group || null],
    query,
  );
}

/**
 * Each person's score to date as a whole percentage, on their scorecard for the quarter `today`
 * falls in, for the people asked (a page of the Team roster) within `scope` (the reader's
 * `performance` view): those outside it, or with no score yet, are left out.
 * @param {{query: Function}} client
 * @param {{today: string, employee_ids: string[]}} at
 * @param {{scope: string, scope_ids: string[]|null}} scope
 * @returns {Promise<Array<{employee_id: string, percent: number}>>}
 */
async function scoresOf(client, { today, employee_ids: employeeIds }, scope) {
  const params = [employeeIds, today];
  const s = scopeClause(scope, { column: "s.employee_id" }, params);
  // pagination:complete one row for each person on a page of the roster, 25 at most
  const { rows } = await completeQuery(
    client,
    `SELECT s.employee_id, round(s.score_to_date * 100)::int AS percent
       FROM scorecard s
       JOIN performance_period pq ON pq.performance_period_id = s.performance_period_id
      WHERE s.employee_id = ANY($1::uuid[]) AND s.score_to_date IS NOT NULL
        AND s.status IN ('binding', 'agreed', 'closed')
        AND pq.starts_on <= $2::date AND pq.ends_on >= $2::date ${s.and}
      ORDER BY s.employee_id`,
    params,
    { label: "a roster page's scores", ceiling: 25 },
  );
  return rows;
}

module.exports = {
  module: "goals",
  milestone: "M2",
  owner: "TB",
  tables: TABLES,
  owes: OWES,
  KR_GROUPS,
  LINE_GROUPS,
  organisationGoals,
  targetsOf,
  orgScores,
  keyResultsOnTrack,
  keyResultsPage,
  scorecardFigure,
  scorecardLinesPage,
  scoresOf,
};
