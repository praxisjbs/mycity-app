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
 */
const { pool } = require("../../config/db");
const { pageQuery, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");
const { personJson } = require("../../shared/db/person");
const lagos = require("../../shared/time/lagos");

const OPEN = "t.status NOT IN ('done', 'cancelled')";

/** The days a period covers, ending today. */
function periodOf(period, today) {
  if (period === "year") return { from: `${today.slice(0, 4)}-01-01`, to: today };
  return { from: lagos.addDays(today, period === "90d" ? -89 : -29), to: today };
}

/** The WHERE fragment for whose tasks count, as on the board. */
function whose(listScope, scope, params) {
  params.push(scope.employee_id || null);
  const me = `$${params.length}::uuid`;
  const mine = `(t.primary_assignee_id = ${me} OR t.set_by_employee_id = ${me})`;
  if (listScope !== "team") return `AND ${mine}`;
  const s = scopeClause(scope, { column: "t.primary_assignee_id" }, params);
  return s.and ? `AND (${s.and.slice(4)} OR ${mine})` : "";
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

  const [figures, weeks, load, prio] = await Promise.all([
    pool.query(
      `SELECT count(*) FILTER (WHERE t.status = 'done' AND t.completed_at >= $1 AND t.completed_at < $2)::int AS done,
              count(*) FILTER (WHERE ${OPEN} AND t.due_at >= $1 AND t.due_at < $2)::int AS open_due,
              count(*) FILTER (WHERE ${OPEN} AND t.due_at < $3)::int AS overdue,
              count(*) FILTER (WHERE t.status = 'cancelled' AND t.cancelled_at >= $1 AND t.cancelled_at < $2)::int AS cancelled,
              avg(date_part('epoch', t.completed_at - t.created_at) / 86400.0)
                FILTER (WHERE t.status = 'done' AND t.completed_at >= $1 AND t.completed_at < $2) AS avg_days
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
    workload: load.data.map((r) => ({ employee: r.employee, open: r.open })),
    by_priority: order.map((p) => ({
      priority: p,
      open: (prio.rows.find((r) => r.priority === p) || { open: 0 }).open,
    })),
  };
}

module.exports = { analytics, periodOf };
