"use strict";
/**
 * The week (docs/guides/performance.md §6.18; docs/guides/workspace.md §3, §6): read off the board,
 * so MyCity's weekly tracker retires.
 *
 *   week()       My Week: done Monday to Sunday (Lagos), open tasks due the next week, open tasks
 *                marked blocked, each its first 25 with a total; Support Needed and an accepted
 *                summary. The reader's own, or for a manager someone's in their `workspace` scope.
 *   save()       the reader's own Support Needed line and a summary they accepted (weekly_summary).
 *   teamWeeks()  Team This Week: one row per person in the reader's scope but themselves.
 *   tidy()       Tidy With AI: the week's lists and the line made into a short summary, only when
 *                pressed (action `week-summary`, Default, personal data). Nothing is saved: the
 *                person keeps it (save() with its run) or discards it.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause, assertInScope } = require("../../shared/rbac/scope");
const { personJson } = require("../../shared/db/person");
const lagos = require("../../shared/time/lagos");
const ai = require("../../services/ai/llm.service");
const tasks = require("../tasks/tasks.service");
const tasksRepo = require("../tasks/tasks.repo");
const { EVENTS } = require("./workspace.events");

/** When AI is off, capped or not answering, Tidy says so and the line stays as it is (§6.17, §6.18). */
const AI_OFF = new Set(["AI_DISABLED", "AI_MODULE_DISABLED", "AI_CAP_REACHED", "AI_UNAVAILABLE", "AI_VENDOR_CONFIG"]);

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;
const iso = (v) => (v instanceof Date ? v.toISOString() : v ? new Date(v).toISOString() : null);

/** This week's Monday in Lagos. */
const thisMonday = (now = new Date()) => {
  const today = lagos.today(now);
  return lagos.addDays(today, 1 - lagos.weekday(today));
};

/** The week from its Monday: [from, to) for done, [to, next) for planned. */
function windowOf(monday) {
  return {
    from: lagos.instant(monday),
    to: lagos.instant(lagos.addDays(monday, 7)),
    next: lagos.instant(lagos.addDays(monday, 14)),
  };
}

/** The three lists of a person's week, each its first page. */
async function listsOf(db, employeeId, monday) {
  const w = windowOf(monday);
  const [done, planned, blocked] = await Promise.all([
    tasksRepo.weekList(db, { employeeId, kind: "done", from: w.from, to: w.to }),
    tasksRepo.weekList(db, { employeeId, kind: "planned", from: w.to, to: w.next }),
    tasksRepo.weekList(db, { employeeId, kind: "blocked", from: w.from, to: w.to }),
  ]);
  const first = (p) => ({ data: p.data.map((r) => tasks.toTask(r)), total: p.page.total });
  return { done: first(done), planned: first(planned), blocked: first(blocked) };
}

async function summaryRow(db, employeeId, monday) {
  return one(
    db,
    `SELECT support_needed, summary_text, updated_at FROM weekly_summary
      WHERE employee_id = $1 AND week_starts_on = $2`,
    [employeeId, monday],
  );
}

async function personOf(db, employeeId) {
  const r = await one(
    db,
    `SELECT ${personJson("e", "d")} AS person FROM employee e
       LEFT JOIN department d ON d.department_id = e.department_id WHERE e.employee_id = $1`,
    [employeeId],
  );
  if (!r) throw new AppError("NOT_FOUND", "Not found", 404);
  return r.person;
}

/** A person's week as the contract's WeekView. */
async function viewOf(db, employeeId, monday) {
  const [employee, lists, s] = await Promise.all([
    personOf(db, employeeId),
    listsOf(db, employeeId, monday),
    summaryRow(db, employeeId, monday),
  ]);
  return {
    employee,
    week_starts_on: monday,
    ...lists,
    support_needed: s ? s.support_needed : null,
    summary_text: s ? s.summary_text : null,
    updated_at: s ? iso(s.updated_at) : null,
  };
}

/**
 * GET /workspace/week
 * @param {{employee_id: string}} actor
 * @param {object} scope   scopeOf(req) under `workspace` view
 * @param {{week_starts_on?: string, employee_id?: string}} query
 */
async function week(actor, scope, query) {
  if (!actor.employee_id) throw new AppError("FORBIDDEN", "Only an employee has a week", 403);
  const employeeId = query.employee_id || actor.employee_id;
  if (employeeId !== actor.employee_id) assertInScope(scope, employeeId);
  return viewOf(pool, employeeId, query.week_starts_on || thisMonday());
}

/** A summary accepted must be the reader's own week-summary run. */
async function checkRun(db, runId, actor) {
  if (!runId) return;
  const r = await one(db, "SELECT purpose, actor_user_id FROM ai_run WHERE run_id = $1", [runId]);
  if (!r || r.purpose !== "week-summary" || r.actor_user_id !== actor.user_id)
    throw new AppError("VALIDATION_FAILED", "Not your summary", 422, { ai_run_id: ["Not your summary"] });
}

/** PUT /workspace/week: the reader's own line and accepted summary; what the body leaves out stays. */
async function save(actor, body) {
  if (!actor.employee_id) throw new AppError("FORBIDDEN", "Only an employee has a week", 403);
  const client = await pool.connect();
  try {
    await atomically(client, async () => {
      await checkRun(client, body.ai_run_id, actor);
      const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
      const blank = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
      await client.query(
        `INSERT INTO weekly_summary (employee_id, week_starts_on, support_needed, summary_text, ai_run_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (employee_id, week_starts_on) DO UPDATE SET
           support_needed = CASE WHEN $6 THEN EXCLUDED.support_needed ELSE weekly_summary.support_needed END,
           summary_text = CASE WHEN $7 THEN EXCLUDED.summary_text ELSE weekly_summary.summary_text END,
           ai_run_id = CASE WHEN $7 THEN EXCLUDED.ai_run_id ELSE weekly_summary.ai_run_id END`,
        [
          actor.employee_id,
          body.week_starts_on,
          blank(body.support_needed),
          blank(body.summary_text),
          has("summary_text") ? body.ai_run_id || null : null,
          has("support_needed"),
          has("summary_text"),
        ],
      );
      await emit(client, {
        key: EVENTS.WEEK_SUMMARY_SAVED,
        entity: { type: "employee", id: actor.employee_id },
        actor,
        payload: { employee_id: actor.employee_id, week_starts_on: body.week_starts_on, ai_run_id: body.ai_run_id || null },
      });
    });
  } finally {
    client.release();
  }
  return viewOf(pool, actor.employee_id, body.week_starts_on);
}

/** GET /workspace/team-weeks: this week (or the one named) for each person in scope but the reader. */
async function teamWeeks(actor, scope, query) {
  const monday = query.week_starts_on || thisMonday();
  const w = windowOf(monday);
  const params = [w.from, w.to, w.next, monday, actor.employee_id || null, query.q || null];
  const s = scopeClause(scope, { column: "e.employee_id" }, params);
  const OPEN = "t.status NOT IN ('done', 'cancelled') AND t.archived_at IS NULL";
  return pageQuery(
    pool,
    `SELECT ${personJson("e", "d")} AS employee,
            (SELECT count(*)::int FROM task t WHERE t.primary_assignee_id = e.employee_id AND t.status = 'done'
               AND t.archived_at IS NULL AND t.completed_at >= $1 AND t.completed_at < $2) AS done,
            (SELECT count(*)::int FROM task t WHERE t.primary_assignee_id = e.employee_id AND ${OPEN}
               AND t.due_at >= $2 AND t.due_at < $3) AS planned,
            (SELECT count(*)::int FROM task t WHERE t.primary_assignee_id = e.employee_id AND ${OPEN}
               AND t.blocked_reason IS NOT NULL) AS blocked,
            ws.support_needed, ${TOTAL_COL}
       FROM employee e
       LEFT JOIN department d ON d.department_id = e.department_id
       LEFT JOIN weekly_summary ws ON ws.employee_id = e.employee_id AND ws.week_starts_on = $4
      WHERE e.status = 'active' AND e.employee_id IS DISTINCT FROM $5
        AND ($6::text IS NULL OR search_fold(e.first_name || ' ' || e.last_name) LIKE '%' || search_fold($6) || '%')
        ${s.and}
      ORDER BY ${orderBy(query, { employee: "e.first_name, e.last_name" }, "e.employee_id")}`,
    params,
    query,
  );
}

/**
 * POST /workspace/week/tidy: one `week-summary` run over the reader's week and their line.
 * @returns {Promise<{available: boolean, original: string, tidied: string|null, ai_run_id: string|null}>}
 */
async function tidy(actor, body) {
  if (body.kind !== "week") throw new AppError("VALIDATION_FAILED", "Only the week is tidied here", 422, { kind: ["Must be week"] });
  if (!actor.employee_id) throw new AppError("FORBIDDEN", "Only an employee has a week", 403);
  const lists = await listsOf(pool, actor.employee_id, thisMonday());
  const titles = (l) => l.data.map((t) => t.title);
  const off = { available: false, original: body.text, tidied: null, ai_run_id: null };
  try {
    const run = await ai.complete({
      purpose: "week-summary",
      module: "workspace",
      actor,
      input: {
        done_this_week: titles(lists.done),
        planned_next_week: titles(lists.planned),
        blocked: lists.blocked.data.map((t) => ({ task: t.title, reason: t.blocked_reason })),
        support_needed: body.text,
      },
      temperature: 0.2,
    });
    const text = String(run.text || "").replace(/^```(?:markdown|text)?\s*|\s*```\s*$/g, "").trim();
    if (!text) return off;
    return { available: true, original: body.text, tidied: text, ai_run_id: run.run_id || null };
  } catch (err) {
    if (err instanceof AppError && AI_OFF.has(err.code)) return off;
    throw err;
  }
}

module.exports = { week, save, teamWeeks, tidy, thisMonday };
