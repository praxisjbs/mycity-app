"use strict";
/**
 * Tasks, as Home reads them: the overdue tasks behind the Overdue Tasks and My Overdue
 * Tasks cards, and a person's tasks due in a span for Your Week.
 *
 * OWNED BY the `tasks` module, M2 Productivity & Performance, AJ (migration 2000).
 *
 * Home reads these tables before the module that owns them is built, so this file is the
 * one place Home names them. The M2 pull request that builds `tasks` MUST, in the same PR,
 * move or replace these queries with its own reads, keep `tables` true to every column the
 * queries name, and clear `owes` as it pays each item (docs/guides/home.md §4.1,
 * docs/DATABASE_SCHEMA.md M2 Owes). A unit test holds `tables` to the migrated schema and
 * the queries to `tables`; the schema gate holds the SQL to the migrations.
 *
 * A task is someone's when they are its primary assignee: scope runs on
 * t.primary_assignee_id, so an unassigned task is seen only with `all` scope. Overdue is
 * as of an instant: due before it, not done, not cancelled, not completed, not archived.
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../../shared/http/paged");
const { scopeClause } = require("../../../shared/rbac/scope");
const { PERSON } = require("../kpi-catalog/shared");

/** The forward tables and the columns these queries read. */
const TABLES = Object.freeze({
  task: ["task_id", "title", "status", "priority", "due_at", "completed_at", "archived_at", "primary_assignee_id"],
});

/** What M2 still owes these queries. */
const OWES = Object.freeze([
  "Move these reads into src/modules/tasks (a read the tasks module owns) with TB's review; " +
    "the cancelled status, whose a task is (its primary assignee, as the board's team scope) " +
    "and the overdue index are paid (AJ, 19/10/2026; docs/guides/workspace.md §6).",
]);

/** Open and past its due time at `$1`. */
const OVERDUE = `t.archived_at IS NULL AND t.completed_at IS NULL AND t.status NOT IN ('done', 'cancelled')
  AND t.due_at < $1::timestamptz`;

/**
 * How many tasks are overdue at `now`, within the scope.
 * @param {{query: Function}} client
 * @param {{now: Date}} at
 * @param {{scope: string, scope_ids: string[]|null}} scope
 * @returns {Promise<number>}
 */
async function overdueCount(client, { now }, scope) {
  const params = [now];
  const s = scopeClause(scope, { column: "t.primary_assignee_id" }, params);
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM task t WHERE ${OVERDUE} ${s.and}`, params);
  return rows[0].n;
}

/** One page of the tasks overdue at `now`, longest overdue first, each with its assignee. */
function overduePage(client, { now }, scope, query) {
  const params = [now, query.q || null];
  const s = scopeClause(scope, { column: "t.primary_assignee_id" }, params);
  return pageQuery(
    client,
    `SELECT t.task_id, t.title, t.status, t.priority, t.due_at, ${PERSON("e", "d")} AS assignee, ${TOTAL_COL}
       FROM task t
       LEFT JOIN employee e ON e.employee_id = t.primary_assignee_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE ${OVERDUE}
        AND ($2::text IS NULL OR search_fold(t.title) LIKE '%' || search_fold($2) || '%')
        ${s.and}
      ORDER BY ${orderBy(query, { due_at: "t.due_at" }, "t.task_id")}`,
    params,
    query,
  );
}

/**
 * One page of a person's open tasks due from `from` up to `to` (exclusive), soonest
 * first: the tasks on Your Week.
 * @param {{query: Function}} client
 * @param {{employee_id: string, from: Date, to: Date}} span
 * @param {{page?: number}} query
 */
function dueBetween(client, { employee_id: employeeId, from, to }, query) {
  return pageQuery(
    client,
    `SELECT t.task_id, t.title, t.due_at, ${TOTAL_COL}
       FROM task t
      WHERE t.primary_assignee_id = $1 AND t.archived_at IS NULL AND t.completed_at IS NULL
        AND t.status NOT IN ('done', 'cancelled') AND t.due_at >= $2::timestamptz AND t.due_at < $3::timestamptz
      ORDER BY t.due_at, t.task_id`,
    [employeeId, from, to],
    query,
  );
}

/**
 * How many open tasks each of these people leads: Open Tasks on Home's roster, for one page of
 * it. Only the ids the caller may count are passed (dashboard.team.js).
 * @param {{query: Function}} client
 * @param {string[]} employeeIds  at most a page of 25
 * @returns {Promise<Map<string, number>>}
 */
async function openCounts(client, employeeIds) {
  if (!employeeIds.length) return new Map();
  const { rows } = await client.query(
    `SELECT t.primary_assignee_id AS employee_id, count(*)::int AS open
       FROM task t
      WHERE t.primary_assignee_id = ANY($1::uuid[]) AND t.archived_at IS NULL
        AND t.status NOT IN ('done', 'cancelled')
      GROUP BY t.primary_assignee_id`,
    [employeeIds],
  );
  return new Map(rows.map((r) => [r.employee_id, r.open]));
}

module.exports = {
  module: "tasks",
  milestone: "M2",
  owner: "AJ",
  tables: TABLES,
  owes: OWES,
  overdueCount,
  overduePage,
  dueBetween,
  openCounts,
};
