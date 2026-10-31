"use strict";
/**
 * What the M3 query rules count from Workspace tasks (docs/guides/queries.md §6.3). Tasks answer
 * from their own records; the rule evaluator (src/modules/query_rules) never reads these tables.
 *
 *   offences(db, { source, employee_id, from, to })
 *     → [{ date, minutes, label }]   one entry per overdue task, on its due day, oldest first
 *   dueYesterday(db, today)
 *     → [employee_id]                who had a task due yesterday still open or done late
 *
 *   overdue_task   a task whose due day (Africa/Lagos) passed before it was done: still open
 *                  after it, or done on a later day. It counts against its primary assignee; a
 *                  cancelled or archived task never counts, nor a due day not yet over.
 */
const { completeQuery } = require("../../shared/http/paged");

const SOURCES = Object.freeze(["overdue_task"]);

const DUE_DAY = `(t.due_at AT TIME ZONE 'Africa/Lagos')::date`;
const OVERDUE = `t.due_at IS NOT NULL AND t.archived_at IS NULL AND t.status <> 'cancelled'
  AND ${DUE_DAY} < $TODAY::date
  AND (t.completed_at IS NULL OR (t.completed_at AT TIME ZONE 'Africa/Lagos')::date > ${DUE_DAY})`;

/**
 * @param {{query: Function}} db
 * @param {{source: string, employee_id: string, from: string, to: string, today?: string}} q  dates as YYYY-MM-DD, inclusive
 * @returns {Promise<Array<{date: string, minutes: number, label: string}>>}
 */
async function offences(db, { source, employee_id: employeeId, from, to, today }) {
  if (!SOURCES.includes(source)) throw new Error(`tasks.auto-query: "${source}" is not a task offence`);
  // pagination:complete one person's overdue tasks in a rule's window (at most 366 days), counted, never listed
  const { rows } = await completeQuery(
    db,
    `SELECT ${DUE_DAY}::text AS date, t.number::text AS number, t.title
       FROM task t
      WHERE t.primary_assignee_id = $1 AND ${DUE_DAY} BETWEEN $2::date AND $3::date
        AND ${OVERDUE.replace("$TODAY", "$4")}
      ORDER BY t.due_at, t.task_id`,
    [employeeId, from, to, today || require("../../shared/time/lagos").today()],
    { label: "overdue tasks", ceiling: 2000 },
  );
  return rows.map((r) => ({ date: r.date, minutes: 0, label: r.number ? `Task ${r.number} overdue: ${r.title}` : `Task overdue: ${r.title}` }));
}

/**
 * The people with a task due yesterday that is still open or was done late: the daily sweep's
 * list (jobs/schedulers/query-rule-sweep.js).
 * @param {{query: Function}} db
 * @param {string} today  YYYY-MM-DD, Africa/Lagos
 * @returns {Promise<string[]>}
 */
async function dueYesterday(db, today) {
  // pagination:complete one day's overdue assignees, each queued for evaluation, never listed
  const { rows } = await completeQuery(
    db,
    `SELECT DISTINCT t.primary_assignee_id AS employee_id
       FROM task t
      WHERE t.primary_assignee_id IS NOT NULL AND ${DUE_DAY} = $1::date - 1
        AND ${OVERDUE.replace("$TODAY", "$1")}
      ORDER BY 1`,
    [today],
    { label: "overdue task assignees", ceiling: 5000 },
  );
  return rows.map((r) => r.employee_id);
}

module.exports = { SOURCES, offences, dueYesterday };
