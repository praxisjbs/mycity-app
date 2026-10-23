"use strict";
/**
 * Analytics: how work is moving, for the reader or their reporting line
 * (docs/guides/workspace.md §6). Every figure is over tasks the reader may see on the
 * board with the same `mine` or `team` choice; cancelled tasks count only as Cancelled.
 *
 *   completion_rate      done in the period ÷ (done in the period + open and due in it), %
 *   overdue              open now and past due
 *   avg_completion_days  mean of completed_at − created_at over tasks done in the period
 *   completed_per_week   done per week (Monday to Sunday, Lagos), oldest first
 *   workload             open tasks per assignee, the busiest 25 (the first page)
 *   by_priority          open tasks per priority
 *   open                 open tasks now
 *   cycle_days           mean of completed_at − started_at over tasks done in the period
 *   overdue_aging        open overdue tasks by how many days late: 1–3, 4–7, 8–14, 15 and more
 *   overdue_by_reason    open overdue tasks by the late reason given (none recorded counts too)
 *   blocked              tasks held by an open blockage, oldest hold first (the first page)
 */
const { pool } = require("../../config/db");
const { pageQuery, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");
const { personJson } = require("../../shared/db/person");
const lagos = require("../../shared/time/lagos");
const tasks = require("../tasks/tasks.service");

const OPEN = "t.status NOT IN ('done', 'cancelled')";

/** The days a period covers, ending today. */
function periodOf(period, today) {
  if (period === "year") return { from: `${today.slice(0, 4)}-01-01`, to: today };
  return { from: lagos.addDays(today, period === "90d" ? -89 : -29), to: today };
}

/**
 * The WHERE fragment for whose tasks count, as on the board. The caller's id is pushed only
 * when the fragment names it: Postgres refuses a parameter the SQL never reads.
 */
function whose(listScope, scope, params) {
  const mine = () => {
    params.push(scope.employee_id || null);
    const me = `$${params.length}::uuid`;
    return `(t.primary_assignee_id = ${me} OR t.set_by_employee_id = ${me})`;
  };
  if (listScope !== "team") return `AND ${mine()}`;
  const s = scopeClause(scope, { column: "t.primary_assignee_id" }, params);
  return s.and ? `AND (${s.and.slice(4)} OR ${mine()})` : "";
}

async function analytics(query, scope, now = new Date()) {
  const today = lagos.today(now);
  const { from, to } = periodOf(query.period, today);
  const start = lagos.instant(from);
  const end = lagos.instant(lagos.addDays(to, 1));
  const params = [start, end, now];
  const who = whose(query.scope, scope, params);
  // Every query names all three instants, typed, so the ones that do not use them still parse.
  const base = `FROM task t WHERE t.archived_at IS NULL AND $1::timestamptz < $2::timestamptz
    AND $3::timestamptz IS NOT NULL ${who}`;

  const [figures, weeks, load, prio, aging, reasons, held] = await Promise.all([
    pool.query(
      `SELECT count(*) FILTER (WHERE t.status = 'done' AND t.completed_at >= $1 AND t.completed_at < $2)::int AS done,
              count(*) FILTER (WHERE ${OPEN} AND t.due_at >= $1 AND t.due_at < $2)::int AS open_due,
              count(*) FILTER (WHERE ${OPEN} AND t.due_at < $3)::int AS overdue,
              count(*) FILTER (WHERE t.status = 'cancelled' AND t.cancelled_at >= $1 AND t.cancelled_at < $2)::int AS cancelled,
              avg(date_part('epoch', t.completed_at - t.created_at) / 86400.0)
                FILTER (WHERE t.status = 'done' AND t.completed_at >= $1 AND t.completed_at < $2) AS avg_days,
              count(*) FILTER (WHERE ${OPEN})::int AS open_now,
              avg(date_part('epoch', t.completed_at - t.started_at) / 86400.0)
                FILTER (WHERE t.status = 'done' AND t.started_at IS NOT NULL
                          AND t.completed_at >= $1 AND t.completed_at < $2) AS cycle_days
         ${base}`,
      params,
    ),
    pool.query(
      `SELECT to_char(date_trunc('week', t.completed_at AT TIME ZONE 'Africa/Lagos'), 'YYYY-MM-DD') AS week_start,
              count(*)::int AS count
         ${base} AND t.status = 'done' AND t.completed_at >= $1 AND t.completed_at < $2
        GROUP BY 1 ORDER BY 1`,
      params,
    ),
    pageQuery(
      pool,
      `SELECT ${personJson("e", "d")} AS employee, x.open, ${TOTAL_COL}
         FROM (SELECT t.primary_assignee_id, count(*)::int AS open ${base} AND ${OPEN}
                GROUP BY t.primary_assignee_id) x
         JOIN employee e ON e.employee_id = x.primary_assignee_id
         LEFT JOIN department d ON d.department_id = e.department_id
        ORDER BY x.open DESC, e.employee_id`,
      params,
      { page: 1 },
    ),
    pool.query(
      `SELECT t.priority, count(*)::int AS open ${base} AND ${OPEN} GROUP BY t.priority`,
      params,
    ),
    pool.query(
      `SELECT CASE WHEN $3::timestamptz - t.due_at < interval '4 days' THEN '1_3'
                   WHEN $3::timestamptz - t.due_at < interval '8 days' THEN '4_7'
                   WHEN $3::timestamptz - t.due_at < interval '15 days' THEN '8_14'
                   ELSE '15_plus' END AS band,
              count(*)::int AS count
         ${base} AND ${OPEN} AND t.due_at < $3
        GROUP BY 1`,
      params,
    ),
    pool.query(
      `SELECT t.late_reason AS reason, count(*)::int AS count
         ${base} AND ${OPEN} AND t.due_at < $3
        GROUP BY 1`,
      params,
    ),
    pageQuery(
      pool,
      `SELECT x.*, ${TOTAL_COL} FROM (
         SELECT t.task_id, t.number::text AS number, t.title, t.status, t.primary_assignee_id,
                t.set_by_employee_id, ${personJson("e", "d")} AS assignee,
                b.task_blockage_id, b.note, b.raised_at,
                round((extract(epoch FROM $3::timestamptz - b.raised_at) / 86400.0)::numeric, 1)::float AS blocked_days
           FROM task t
           JOIN task_blockage b ON b.task_id = t.task_id AND b.resolved_at IS NULL
           LEFT JOIN employee e ON e.employee_id = t.primary_assignee_id
           LEFT JOIN department d ON d.department_id = e.department_id
          WHERE t.archived_at IS NULL AND ${OPEN} AND $1::timestamptz < $2::timestamptz ${who}) x
        ORDER BY x.raised_at, x.task_blockage_id`,
      params,
      { page: 1 },
    ),
  ]);

  const f = figures.rows[0];
  const denominator = f.done + f.open_due;
  const order = ["urgent", "high", "normal", "low"];
  return {
    from,
    to,
    completion_rate: denominator ? Math.round((f.done / denominator) * 1000) / 10 : null,
    overdue: f.overdue,
    avg_completion_days: f.avg_days === null ? null : Math.round(Number(f.avg_days) * 10) / 10,
    done: f.done,
    cancelled: f.cancelled,
    completed_per_week: weeks.rows,
    open: f.open_now,
    cycle_days: f.cycle_days === null ? null : Math.round(Number(f.cycle_days) * 10) / 10,
    workload: load.data.map((r) => ({ employee: r.employee, open: r.open })),
    by_priority: order.map((p) => ({
      priority: p,
      open: (prio.rows.find((r) => r.priority === p) || { open: 0 }).open,
    })),
    overdue_aging: ["1_3", "4_7", "8_14", "15_plus"].map((band) => ({
      band,
      count: (aging.rows.find((r) => r.band === band) || { count: 0 }).count,
    })),
    overdue_by_reason: ["waiting_on_others", "underestimated", "deprioritised", "other", null]
      .map((reason) => ({ reason, count: (reasons.rows.find((r) => r.reason === reason) || { count: 0 }).count }))
      .filter((r) => r.count > 0),
    blocked: {
      data: held.data.map((r) => ({
        task: tasks.toRef(r, scope),
        note: r.note,
        raised_at: r.raised_at instanceof Date ? r.raised_at.toISOString() : r.raised_at,
        blocked_days: Number(r.blocked_days) || 0,
      })),
      total: held.page.total,
    },
  };
}

module.exports = { analytics, periodOf };
