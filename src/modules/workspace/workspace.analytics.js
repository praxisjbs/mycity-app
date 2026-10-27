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
 *   overdue_by_reason    open overdue tasks by the late reason given, with its words (none recorded counts too)
 *   blocked              tasks held by an open blockage, oldest hold first (the first page)
 *
 * The period is this week (Monday to today), the last 30 or 90 days, the calendar year, or the
 * reader's own From and To (`custom`, at most 366 days, ending today at the latest), in Lagos.
 * Analytics' Export reads the same figures for its file through Home's reports engine
 * (reports.sources.js `workspace_analytics`), with every page of the workload and the blocked
 * work: workloadPage() and blockedPage() are those lists, 25 a page.
 */
const { pool } = require("../../config/db");
const { AppError } = require("../../shared/errors");
const { pageQuery, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");
const { personJson } = require("../../shared/db/person");
const lagos = require("../../shared/time/lagos");
const tasks = require("../tasks/tasks.service");

const OPEN = "t.status NOT IN ('done', 'cancelled')";

/**
 * The days a period covers: a preset ends today; a custom period is the reader's own days.
 * @param {"week"|"30d"|"90d"|"year"|"custom"} period
 * @param {string} today  YYYY-MM-DD, Lagos
 * @param {{from?: string, to?: string}} [days]  a custom period's
 */
function periodOf(period, today, days = {}) {
  if (period === "custom") return { from: days.from, to: days.to };
  if (period === "week") return { from: lagos.addDays(today, 1 - lagos.weekday(today)), to: today };
  if (period === "year") return { from: `${today.slice(0, 4)}-01-01`, to: today };
  return { from: lagos.addDays(today, period === "90d" ? -89 : -29), to: today };
}

/** A custom period ends today at the latest: the contract cannot know the day, so it is said here. */
function assertPeriod(query, today) {
  if (query.period === "custom" && query.to > today)
    throw new AppError("VALIDATION_FAILED", "Check the highlighted fields", 422, { to: ["Not after today"] });
}

/**
 * The WHERE fragment for whose tasks count. Mine is the work the reader does: tasks they lead or
 * share. A task they set for someone else counts under My Team, with their reporting line's. The
 * caller's id is pushed only when the fragment names it: Postgres refuses a parameter the SQL
 * never reads.
 */
function whose(listScope, scope, params) {
  const me = () => {
    params.push(scope.employee_id || null);
    return `$${params.length}::uuid`;
  };
  const doing = (id) =>
    `(t.primary_assignee_id = ${id} OR EXISTS (SELECT 1 FROM task_assignee ta WHERE ta.task_id = t.task_id AND ta.employee_id = ${id}))`;
  if (listScope !== "team") return `AND ${doing(me())}`;
  const s = scopeClause(scope, { column: "t.primary_assignee_id" }, params);
  if (!s.and) return "";
  const id = me();
  return `AND (${s.and.slice(4)} OR ${doing(id)} OR t.set_by_employee_id = ${id})`;
}

/**
 * What every figure is read over: the period's days and instants, whose tasks, and the FROM
 * clause they share. `$1` and `$2` bound the period, `$3` is now.
 */
function frameOf(query, scope, now) {
  const today = lagos.today(now);
  assertPeriod(query, today);
  const { from, to } = periodOf(query.period, today, query);
  const params = [lagos.instant(from), lagos.instant(lagos.addDays(to, 1)), now];
  const who = whose(query.scope, scope, params);
  // Every query names all three instants, typed, so the ones that do not use them still parse.
  const base = `FROM task t WHERE t.archived_at IS NULL AND $1::timestamptz < $2::timestamptz
    AND $3::timestamptz IS NOT NULL ${who}`;
  return { from, to, params, who, base };
}

/** Open tasks per lead, the busiest first: one page of 25. */
function loadQuery(frame, page) {
  return pageQuery(
    pool,
    `SELECT ${personJson("e", "d")} AS employee, x.open, ${TOTAL_COL}
       FROM (SELECT t.primary_assignee_id, count(*)::int AS open ${frame.base} AND ${OPEN}
              GROUP BY t.primary_assignee_id) x
       JOIN employee e ON e.employee_id = x.primary_assignee_id
       LEFT JOIN department d ON d.department_id = e.department_id
      ORDER BY x.open DESC, e.employee_id`,
    frame.params,
    { page },
  );
}

/** Tasks held by an open blockage, the oldest hold first: one page of 25. */
function heldQuery(frame, scope, page) {
  // The list also says whether the reader shares each task, so its link opens for them.
  const params = [...frame.params, scope.employee_id || null];
  const reader = `$${params.length}::uuid`;
  return pageQuery(
    pool,
    `SELECT x.*, ${TOTAL_COL} FROM (
       SELECT t.task_id, t.number::text AS number, t.title, t.status, t.primary_assignee_id,
              t.set_by_employee_id, ${personJson("e", "d")} AS assignee,
              EXISTS (SELECT 1 FROM task_assignee ra WHERE ra.task_id = t.task_id AND ra.employee_id = ${reader}) AS reader_shares,
              b.task_blockage_id, b.note, b.raised_at,
              round((extract(epoch FROM $3::timestamptz - b.raised_at) / 86400.0)::numeric, 1)::float AS blocked_days
         FROM task t
         JOIN task_blockage b ON b.task_id = t.task_id AND b.resolved_at IS NULL
         LEFT JOIN employee e ON e.employee_id = t.primary_assignee_id
         LEFT JOIN department d ON d.department_id = e.department_id
        WHERE t.archived_at IS NULL AND ${OPEN} AND $1::timestamptz < $2::timestamptz ${frame.who}) x
      ORDER BY x.raised_at, x.task_blockage_id`,
    params,
    { page },
  );
}

const loadRow = (r) => ({ employee: r.employee, open: r.open });

function heldRow(r, scope) {
  return {
    task: tasks.toRef(r, scope),
    // The assignee is for the file, which names whose task it is; the screen reads it from the task.
    assignee: r.assignee,
    note: r.note,
    raised_at: r.raised_at instanceof Date ? r.raised_at.toISOString() : r.raised_at,
    blocked_days: Number(r.blocked_days) || 0,
  };
}

/** Workload by Person, one page of 25, for the Export's file. */
async function workloadPage(query, scope, page, now = new Date()) {
  const p = await loadQuery(frameOf(query, scope, now), page);
  return { ...p, data: p.data.map(loadRow) };
}

/** Blocked Work, one page of 25, for the Export's file: each row also names the task's lead. */
async function blockedPage(query, scope, page, now = new Date()) {
  const p = await heldQuery(frameOf(query, scope, now), scope, page);
  return { ...p, data: p.data.map((r) => heldRow(r, scope)) };
}

async function analytics(query, scope, now = new Date()) {
  const frame = frameOf(query, scope, now);
  const { from, to, params, base } = frame;

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
    loadQuery(frame, 1),
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
      `SELECT x.reason, lr.label, x.count
         FROM (SELECT t.late_reason AS reason, count(*)::int AS count
                 ${base} AND ${OPEN} AND t.due_at < $3
                GROUP BY 1) x
         LEFT JOIN task_late_reason lr ON lr.code = x.reason
        ORDER BY x.reason IS NULL, lr.display_order, lr.label, x.reason`,
      params,
    ),
    heldQuery(frame, scope, 1),
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
    workload: load.data.map(loadRow),
    by_priority: order.map((p) => ({
      priority: p,
      open: (prio.rows.find((r) => r.priority === p) || { open: 0 }).open,
    })),
    overdue_aging: ["1_3", "4_7", "8_14", "15_plus"].map((band) => ({
      band,
      count: (aging.rows.find((r) => r.band === band) || { count: 0 }).count,
    })),
    // Each reason with overdue tasks, in the list's order, then those with none given.
    overdue_by_reason: reasons.rows.map((r) => ({ reason: r.reason, label: r.label ?? null, count: r.count })),
    blocked: {
      data: held.data.map((r) => {
        const { assignee: _assignee, ...row } = heldRow(r, scope);
        return row;
      }),
      total: held.page.total,
    },
  };
}

module.exports = { analytics, workloadPage, blockedPage, periodOf, assertPeriod };
