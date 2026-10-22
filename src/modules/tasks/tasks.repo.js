"use strict";
/**
 * Tasks: the SQL. Reads tasks with the people and the KPI they name, and writes only
 * the tasks module's own rows (task, task_assignee, task_comment, task_activity).
 * Never emits (BACKEND_GUIDE §2).
 *
 * Whose a task is. Its primary assignee owns it for scope: a manager with `team`
 * scope sees the tasks of everyone under them (scopeClause on primary_assignee_id).
 * Under `mine` a person sees what they are assigned, what they set for someone else,
 * and what they share as a co-assignee (docs/guides/workspace.md §6).
 *
 * Open means not done, not cancelled and not archived.
 *
 * A commitment's state (docs/guides/performance.md §6.11) is worked out here, in SQL, on every
 * read: COMMITMENT_STATE is the one expression, which the commitments list shares.
 */
const { pageQuery, completeQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");
const { personJson } = require("../../shared/db/person");

/**
 * A commitment's state from its own columns, Africa/Lagos: rescoped; awaiting approval (no
 * original date yet); delivered on time (done before the end of its original date's day); late;
 * missed (open when its month has ended); due. Null for a task that is not a commitment, or is
 * cancelled. `t` names the task row.
 * @param {string} t
 */
const COMMITMENT_STATE = (t) => `CASE
    WHEN NOT ${t}.is_commitment OR ${t}.status = 'cancelled' THEN NULL
    WHEN ${t}.rescoped_at IS NOT NULL THEN 'rescoped'
    WHEN ${t}.original_due_at IS NULL THEN 'awaiting_approval'
    WHEN ${t}.status = 'done'
         AND ${t}.completed_at < ((((${t}.original_due_at AT TIME ZONE 'Africa/Lagos')::date + 1)::timestamp) AT TIME ZONE 'Africa/Lagos')
      THEN 'on_time'
    WHEN ${t}.status = 'done' THEN 'late'
    WHEN now() >= ((((${t}.commitment_month + interval '1 month')::date)::timestamp) AT TIME ZONE 'Africa/Lagos') THEN 'missed'
    ELSE 'due'
  END`;

/** Every task with what the board and the panel show. */
const ROWS = `
  SELECT t.task_id, t.number::text AS number, t.title, t.description, t.status, t.priority,
         t.cadence, t.due_at, t.started_at, t.completed_at, t.cancelled_at, t.cancel_reason,
         t.blocked_reason, t.blocked_at, t.employee_target_id, t.entity_type, t.entity_id,
         t.recurrence, t.sort_order, t.created_at, t.updated_at, t.archived_at,
         t.primary_assignee_id, t.set_by_employee_id, t.created_by,
         t.is_commitment, t.acceptance_criteria, t.commitment_month, t.original_due_at, t.rescoped_at,
         t.rescope_reason, t.commitment_set_id, cs.status AS set_status, t.late_reason,
         ${COMMITMENT_STATE("t")} AS commitment_state,
         ${personJson("ae", "ad")} AS assignee,
         ${personJson("se", "sd")} AS set_by,
         et.title AS target_title,
         kr.code AS kr_code, kr.statement AS kr_statement,
         (SELECT count(*)::int FROM task_comment c
           WHERE c.task_id = t.task_id AND c.deleted_at IS NULL) AS comment_count,
         (SELECT count(*)::int FROM task_step st WHERE st.task_id = t.task_id) AS steps_total,
         (SELECT count(*)::int FROM task_step st
           WHERE st.task_id = t.task_id AND st.done_at IS NOT NULL) AS steps_done,
         EXISTS (SELECT 1 FROM task_dependency dp JOIN task pre ON pre.task_id = dp.depends_on_task_id
                  WHERE dp.task_id = t.task_id AND dp.overridden_at IS NULL AND pre.status <> 'done') AS waiting,
         search_fold(t.title || ' ' || COALESCE(t.number::text, '') || ' ' ||
                     COALESCE(ae.first_name || ' ' || ae.last_name, '')) AS haystack
    FROM task t
    LEFT JOIN employee ae ON ae.employee_id = t.primary_assignee_id
    LEFT JOIN department ad ON ad.department_id = ae.department_id
    LEFT JOIN employee se ON se.employee_id = t.set_by_employee_id
    LEFT JOIN department sd ON sd.department_id = se.department_id
    LEFT JOIN employee_target et ON et.employee_target_id = t.employee_target_id
    LEFT JOIN okr_key_result kr ON t.entity_type = 'key_result' AND kr.okr_key_result_id = t.entity_id
    LEFT JOIN commitment_set cs ON cs.commitment_set_id = t.commitment_set_id`;

const OPEN = `v.status NOT IN ('done', 'cancelled') AND v.archived_at IS NULL`;

/** The keys the service turns into Task, and nothing the filters only needed. */
const OUT = `v.task_id, v.number, v.title, v.description, v.status, v.priority, v.cadence,
  v.due_at, v.started_at, v.completed_at, v.cancelled_at, v.cancel_reason, v.blocked_reason,
  v.blocked_at, v.employee_target_id, v.entity_type, v.entity_id, v.recurrence, v.sort_order,
  v.created_at, v.updated_at, v.primary_assignee_id, v.set_by_employee_id, v.created_by,
  v.assignee, v.set_by, v.target_title, v.kr_code, v.kr_statement, v.comment_count, v.is_commitment,
  v.acceptance_criteria, v.commitment_month, v.original_due_at, v.rescoped_at, v.rescope_reason,
  v.commitment_set_id, v.set_status, v.commitment_state, v.late_reason,
  v.steps_total, v.steps_done, v.waiting`;

/** The SQL for each field TaskListQuery allow-lists. The first is the default order. */
const SORTS = {
  sort_order: "v.sort_order",
  due_at: "v.due_at",
  priority: `CASE v.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END`,
  created_at: "v.created_at",
};

/**
 * Who may see a row: under `mine` the caller's own, set or shared tasks; under `team`
 * the reader's workspace scope on the assignee, plus their own set and shared ones.
 * @returns {string} an AND clause
 */
function audience(listScope, scope, params) {
  params.push(scope.employee_id || null);
  const me = `$${params.length}::uuid`;
  const mine = `(v.primary_assignee_id = ${me} OR v.set_by_employee_id = ${me}
     OR EXISTS (SELECT 1 FROM task_assignee ta WHERE ta.task_id = v.task_id AND ta.employee_id = ${me}))`;
  if (listScope !== "team") return `AND ${mine}`;
  const s = scopeClause(scope, { column: "v.primary_assignee_id" }, params);
  if (!s.and) return "";
  return `AND (${s.and.slice(4)} OR ${mine})`;
}

/**
 * One page of tasks.
 * @param {{query: Function}} db
 * @param {object} query   TaskListQuery
 * @param {{scope: string, scope_ids: string[]|null, employee_id: string}} scope
 * @param {{now: Date, today: {from: Date, to: Date}, week: {from: Date, to: Date}}} at
 */
function list(db, query, scope, at) {
  const params = [
    query.status || null,
    query.assignee_id || null,
    query.cadence || null,
    query.priority || null,
    query.employee_target_id || null,
    query.q || null,
    query.due || null,
    at.now,
    at.today.from,
    at.today.to,
    at.week.from,
    at.week.to,
    query.is_commitment === undefined ? null : query.is_commitment === "true",
    query.commitment_month || null,
  ];
  const who = audience(query.scope, scope, params);
  return pageQuery(
    db,
    `SELECT ${OUT}, ${TOTAL_COL}
       FROM (${ROWS}) v
      WHERE v.archived_at IS NULL
        AND (($1::text IS NULL AND v.status <> 'cancelled') OR v.status = $1)
        AND ($2::uuid IS NULL OR v.primary_assignee_id = $2)
        AND ($3::text IS NULL OR v.cadence = $3)
        AND ($4::text IS NULL OR v.priority = $4)
        AND ($5::uuid IS NULL OR v.employee_target_id = $5)
        AND ($6::text IS NULL OR v.haystack LIKE '%' || search_fold($6) || '%')
        AND ($7::text IS NULL
             OR ($7 = 'overdue' AND ${OPEN} AND v.due_at < $8)
             OR ($7 = 'today' AND v.due_at >= $9 AND v.due_at < $10)
             OR ($7 = 'week' AND v.due_at >= $11 AND v.due_at < $12))
        AND ($13::boolean IS NULL OR v.is_commitment = $13)
        AND ($14::date IS NULL OR v.commitment_month = $14)
        ${who}
      ORDER BY ${orderBy(query, SORTS, "v.task_id")}`,
    params,
    query,
  );
}

/** The four figures above the board, for `mine` or `team`, and what was done in the last 30 days. */
async function summary(db, listScope, scope, at) {
  const params = [at.now, at.week.from, at.week.to, at.last30.from];
  const who = audience(listScope, scope, params);
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE ${OPEN})::int AS open,
            count(*) FILTER (WHERE ${OPEN} AND v.due_at >= $2 AND v.due_at < $3)::int AS due_this_week,
            count(*) FILTER (WHERE ${OPEN} AND v.due_at < $1)::int AS overdue,
            count(*) FILTER (WHERE v.status = 'done' AND v.completed_at >= $2 AND v.completed_at < $3)::int AS done_this_week,
            count(*) FILTER (WHERE v.status = 'done' AND v.completed_at >= $4::timestamptz)::int AS done_30d
       FROM (${ROWS}) v
      WHERE v.archived_at IS NULL ${who}`,
    params,
  );
  return rows[0];
}

/** One task, or null. */
async function get(db, id) {
  const { rows } = await db.query(`SELECT ${OUT} FROM (${ROWS}) v WHERE v.task_id = $1`, [id]);
  return rows[0] || null;
}

/** Is the employee a co-assignee of the task? */
async function sharedWith(db, taskId, employeeId) {
  if (!employeeId) return false;
  const { rows } = await db.query(
    "SELECT 1 FROM task_assignee WHERE task_id = $1 AND employee_id = $2",
    [taskId, employeeId],
  );
  return rows.length > 0;
}

/** Lock a task's row for a change. */
async function lock(client, id) {
  const { rows } = await client.query(
    "SELECT task_id, status, sort_order FROM task WHERE task_id = $1 FOR UPDATE",
    [id],
  );
  return rows[0] || null;
}

const WRITABLE = [
  "number",
  "title",
  "description",
  "status",
  "priority",
  "cadence",
  "created_by",
  "set_by_employee_id",
  "primary_assignee_id",
  "due_at",
  "started_at",
  "completed_at",
  "cancelled_at",
  "cancel_reason",
  "blocked_reason",
  "blocked_at",
  "employee_target_id",
  "entity_type",
  "entity_id",
  "recurrence",
  "sort_order",
  "late_reason",
  "is_commitment",
  "acceptance_criteria",
  "commitment_month",
  "original_due_at",
  "commitment_set_id",
  "rescoped_at",
  "rescope_reason",
];

/** Insert a task; returns its id. */
async function insert(client, row) {
  const keys = WRITABLE.filter((k) => row[k] !== undefined);
  const vals = keys.map((k) => (k === "recurrence" && row[k] ? JSON.stringify(row[k]) : row[k]));
  const { rows } = await client.query(
    `INSERT INTO task (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})
     RETURNING task_id`,
    vals,
  );
  return rows[0].task_id;
}

/** Change the given columns of a task. */
async function update(client, id, changes) {
  const keys = WRITABLE.filter((k) => changes[k] !== undefined);
  if (!keys.length) return;
  const vals = keys.map((k) =>
    k === "recurrence" && changes[k] ? JSON.stringify(changes[k]) : changes[k],
  );
  await client.query(
    `UPDATE task SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE task_id = $1`,
    [id, ...vals],
  );
}

/**
 * The sort_order a card takes in a column: between the card it goes above and the one
 * before that, or after the last card when it goes to the foot. Null `between` means
 * the gap is too small and the column needs renumbering first.
 */
async function slotIn(client, { assigneeId, status, beforeId, movingId }) {
  if (beforeId) {
    const { rows } = await client.query(
      `SELECT b.sort_order AS before_order, b.status AS before_status,
              (SELECT max(p.sort_order) FROM task p
                WHERE p.primary_assignee_id IS NOT DISTINCT FROM b.primary_assignee_id
                  AND p.status = b.status AND p.archived_at IS NULL
                  AND p.task_id <> $2
                  AND (p.sort_order, p.task_id) < (b.sort_order, b.task_id)) AS prev_order
         FROM task b WHERE b.task_id = $1`,
      [beforeId, movingId],
    );
    if (!rows[0] || rows[0].before_status !== status) return null;
    const before = Number(rows[0].before_order);
    const prev = rows[0].prev_order === null ? before - 1 : Number(rows[0].prev_order);
    if (before - prev < 0.000002) return { between: null };
    return { between: Math.round(((prev + before) / 2) * 1e6) / 1e6 };
  }
  const { rows } = await client.query(
    `SELECT COALESCE(max(sort_order), 0) + 1 AS next FROM task
      WHERE primary_assignee_id IS NOT DISTINCT FROM $1 AND status = $2 AND archived_at IS NULL
        AND task_id <> $3`,
    [assigneeId, status, movingId],
  );
  return { between: Number(rows[0].next) };
}

/** Renumber one person's column 1, 2, 3 … in its current order, when its gaps run out. */
async function renumber(client, assigneeId, status) {
  await client.query(
    `UPDATE task t SET sort_order = r.n
       FROM (SELECT task_id, row_number() OVER (ORDER BY sort_order, task_id) AS n
               FROM task WHERE primary_assignee_id IS NOT DISTINCT FROM $1 AND status = $2
                 AND archived_at IS NULL) r
      WHERE t.task_id = r.task_id`,
    [assigneeId, status],
  );
}

/** The foot of a person's column, for a new task. */
async function nextOrder(client, assigneeId, status) {
  const { rows } = await client.query(
    `SELECT COALESCE(max(sort_order), 0) + 1 AS next FROM task
      WHERE primary_assignee_id IS NOT DISTINCT FROM $1 AND status = $2 AND archived_at IS NULL`,
    [assigneeId, status],
  );
  return Number(rows[0].next);
}

/* ------------------------------------------------------------------ *
 * History and comments
 * ------------------------------------------------------------------ */

async function addActivity(client, a) {
  await client.query(
    `INSERT INTO task_activity (task_id, actor_user_id, kind, from_status, to_status, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [a.task_id, a.actor_user_id || null, a.kind, a.from_status || null, a.to_status || null, a.detail || null],
  );
}

const ACTIVITY = `
  SELECT a.task_activity_id, a.task_id, t.title AS task_title,
         ${personJson("e", "d")} AS actor,
         a.kind, a.from_status, a.to_status, a.detail, a.created_at
    FROM task_activity a
    JOIN task t ON t.task_id = a.task_id
    LEFT JOIN app_user u ON u.user_id = a.actor_user_id
    LEFT JOIN employee e ON e.employee_id = u.employee_id
    LEFT JOIN department d ON d.department_id = e.department_id`;

/** One page of a task's history, oldest first by default. */
function activity(db, taskId, query) {
  return pageQuery(
    db,
    `SELECT v.*, ${TOTAL_COL} FROM (${ACTIVITY} WHERE a.task_id = $1) v
      ORDER BY ${orderBy(query, { created_at: "v.created_at" }, "v.task_activity_id")}`,
    [taskId],
    query,
  );
}

/**
 * Since You Were Away: what other people did to the reader's tasks after `since`, newest
 * first, at most one page.
 */
function activitySince(db, employeeId, userId, since) {
  return pageQuery(
    db,
    `SELECT v.task_id, v.task_title, v.actor, v.kind, v.to_status, v.created_at, ${TOTAL_COL}
       FROM (${ACTIVITY}
              WHERE (t.primary_assignee_id = $1 OR t.set_by_employee_id = $1)
                AND a.created_at > $3
                AND a.actor_user_id IS DISTINCT FROM $2) v
      ORDER BY v.created_at DESC, v.task_activity_id`,
    [employeeId, userId, since],
    { page: 1 },
  );
}

async function addComment(client, { task_id, author_user_id, body }) {
  const { rows } = await client.query(
    `INSERT INTO task_comment (task_id, author_user_id, body) VALUES ($1, $2, $3)
     RETURNING task_comment_id`,
    [task_id, author_user_id, body],
  );
  return rows[0].task_comment_id;
}

const COMMENTS = `
  SELECT c.task_comment_id, c.task_id, ${personJson("e", "d")} AS author, c.body, c.created_at
    FROM task_comment c
    LEFT JOIN app_user u ON u.user_id = c.author_user_id
    LEFT JOIN employee e ON e.employee_id = u.employee_id
    LEFT JOIN department d ON d.department_id = e.department_id
   WHERE c.deleted_at IS NULL`;

async function comment(db, id) {
  const { rows } = await db.query(`${COMMENTS} AND c.task_comment_id = $1`, [id]);
  return rows[0] || null;
}

function comments(db, taskId, query) {
  return pageQuery(
    db,
    `SELECT v.*, ${TOTAL_COL} FROM (${COMMENTS} AND c.task_id = $1) v
      ORDER BY ${orderBy(query, { created_at: "v.created_at" }, "v.task_comment_id")}`,
    [taskId],
    query,
  );
}

/* ------------------------------------------------------------------ *
 * What other modules ask of tasks
 * ------------------------------------------------------------------ */

/** A scorecard line, with whose scorecard it is on and where that scorecard stands, or null. */
async function targetOf(db, targetId) {
  const { rows } = await db.query(
    `SELECT et.employee_target_id, COALESCE(s.employee_id, et.employee_id) AS employee_id, et.title,
            s.status AS scorecard_status
       FROM employee_target et LEFT JOIN scorecard s ON s.scorecard_id = et.scorecard_id
      WHERE et.employee_target_id = $1`,
    [targetId],
  );
  return rows[0] || null;
}

/** A key result a task may point at, or null. */
async function keyResultOf(db, id) {
  const { rows } = await db.query(
    "SELECT okr_key_result_id, code, statement FROM okr_key_result WHERE okr_key_result_id = $1",
    [id],
  );
  return rows[0] || null;
}

/**
 * Counts Towards (docs/guides/performance.md §6.18): the lines of the assignee's binding or agreed
 * scorecard in the quarter holding `month`, then the key results they are accountable or
 * co-accountable for in a binding plan of that quarter. One page.
 * @param {{query: Function}} db
 * @param {{assigneeId: string, month: string}} who   month: the first day of a month
 * @param {object} query  CountsTowardsQuery
 */
function countsTowards(db, { assigneeId, month }, query) {
  return pageQuery(
    db,
    `SELECT v.kind, v.employee_target_id, v.okr_key_result_id, v.title, v.sub, ${TOTAL_COL}
       FROM (
         SELECT 'line' AS kind, et.employee_target_id, NULL::uuid AS okr_key_result_id, et.title,
                p.name || ' · ' || initcap(et.section) AS sub, 0 AS grp,
                CASE et.section WHEN 'results' THEN 0 WHEN 'kpis' THEN 1 ELSE 2 END AS sec, et.position AS pos
           FROM employee_target et
           JOIN scorecard s ON s.scorecard_id = et.scorecard_id
           JOIN performance_period p ON p.performance_period_id = s.performance_period_id
          WHERE s.employee_id = $1 AND s.status IN ('binding', 'agreed')
            AND $2::date BETWEEN p.starts_on AND p.ends_on
         UNION ALL
         SELECT 'key_result', NULL::uuid, kr.okr_key_result_id, kr.code || ' ' || kr.statement,
                p.name, 1, 0, kr.position
           FROM okr_key_result kr
           JOIN okr_objective o ON o.okr_objective_id = kr.okr_objective_id
           JOIN performance_period p ON p.performance_period_id = o.performance_period_id
           JOIN performance_plan pl ON pl.performance_plan_id = o.performance_plan_id
          WHERE (kr.accountable_employee_id = $1 OR kr.co_accountable_employee_id = $1)
            AND pl.status = 'binding' AND $2::date BETWEEN p.starts_on AND p.ends_on
       ) v
      WHERE ($3::text IS NULL OR search_fold(v.title) LIKE '%' || search_fold($3) || '%')
      ORDER BY v.grp, v.sec, v.pos, v.title, COALESCE(v.employee_target_id, v.okr_key_result_id)`,
    [assigneeId, month, query.q || null],
    query,
  );
}

/**
 * How many tasks pointing at a line were done in a window (a line measured in tasks, §6.18):
 * the one count, read where the line's month is worked out.
 */
async function doneTowards(db, lineId, from, to) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM task
      WHERE employee_target_id = $1 AND status = 'done' AND archived_at IS NULL
        AND completed_at >= $2 AND completed_at < $3`,
    [lineId, from, to],
  );
  return rows[0].n;
}

/** The Recovery task set for a commitment (§6.11), or null. */
async function recoveryOf(db, taskId) {
  const { rows } = await db.query(
    `SELECT t.task_id, t.number::text AS number, ${personJson("e", "d")} AS assignee, t.due_at
       FROM task t
       LEFT JOIN employee e ON e.employee_id = t.primary_assignee_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE t.entity_type = 'task' AND t.entity_id = $1 AND t.status <> 'cancelled'
      ORDER BY t.created_at, t.task_id
      LIMIT 1`,
    [taskId],
  );
  return rows[0] || null;
}

/**
 * One person's week (§6.18), each list its first page: `done` completed in the window, `planned`
 * open and due in the window, `blocked` open and marked blocked.
 * @param {{query: Function}} db
 * @param {{employeeId: string, kind: "done"|"planned"|"blocked", from: Date, to: Date}} w
 */
function weekList(db, { employeeId, kind, from, to }) {
  const order = { done: "v.completed_at DESC", planned: "v.due_at", blocked: "v.blocked_at DESC" }[kind];
  return pageQuery(
    db,
    `SELECT ${OUT}, ${TOTAL_COL}
       FROM (${ROWS}) v
      WHERE v.primary_assignee_id = $1 AND v.archived_at IS NULL
        AND (($2 = 'done' AND v.status = 'done' AND v.completed_at >= $3 AND v.completed_at < $4)
          OR ($2 = 'planned' AND ${OPEN} AND v.due_at >= $3 AND v.due_at < $4)
          OR ($2 = 'blocked' AND ${OPEN} AND v.blocked_reason IS NOT NULL))
      ORDER BY ${order}, v.task_id`,
    [employeeId, kind, from, to],
    { page: 1 },
  );
}

/** Is the employee on the staff now (not suspended, not left)? */
async function employeeActive(db, employeeId) {
  const { rows } = await db.query(
    "SELECT status FROM employee WHERE employee_id = $1",
    [employeeId],
  );
  return rows[0] ? rows[0].status === "active" : false;
}

/**
 * Repeating tasks whose next occurrence is due (done, or past their due day) and not
 * yet made: one batch. Making the next occurrence takes a task out of this set.
 */
async function dueToRepeat(db, now, batch) {
  const { rows } = await db.query(
    `SELECT task_id FROM task t
      WHERE t.recurrence IS NOT NULL AND t.archived_at IS NULL AND t.status <> 'cancelled'
        AND (t.status = 'done' OR t.due_at < $1)
        AND NOT EXISTS (SELECT 1 FROM task n WHERE n.parent_task_id = t.task_id AND n.recurrence IS NOT NULL)
      ORDER BY t.task_id
      LIMIT $2 -- pagination:batch one tick of the recurrence job`,
    [now, batch],
  );
  return rows.map((r) => r.task_id);
}

/** Open tasks due in a window, for the reminders: one batch after the cursor. */
async function dueBetween(db, from, to, after, batch) {
  const { rows } = await db.query(
    `SELECT task_id, number::text AS number, title, primary_assignee_id, due_at FROM task
      WHERE status NOT IN ('done', 'cancelled') AND archived_at IS NULL
        AND primary_assignee_id IS NOT NULL AND due_at >= $1 AND due_at < $2
        AND ($3::timestamptz IS NULL OR (due_at, task_id) > ($3::timestamptz, $4::uuid))
      ORDER BY due_at, task_id
      LIMIT $5 -- pagination:batch one tick of the reminder job`,
    [from, to, after ? after.due_at : null, after ? after.task_id : null, batch],
  );
  return rows;
}

/**
 * Put a person's commitments for a month that are not yet approved into their set (§6.11):
 * every one not rescoped, cancelled or archived. Returns the ids put in.
 */
async function linkCommitments(client, { employeeId, month, setId }) {
  const { rows } = await client.query(
    `UPDATE task SET commitment_set_id = $3
      WHERE primary_assignee_id = $1 AND is_commitment AND commitment_month = $2
        AND original_due_at IS NULL AND rescoped_at IS NULL AND status <> 'cancelled' AND archived_at IS NULL
      RETURNING task_id`,
    [employeeId, month, setId],
  );
  return rows.map((r) => r.task_id);
}

/** A set approved: each commitment in it not yet approved takes its due date as its original. Returns the ids. */
async function fixOriginalDates(client, setId) {
  const { rows } = await client.query(
    `UPDATE task SET original_due_at = due_at
      WHERE commitment_set_id = $1 AND is_commitment AND original_due_at IS NULL AND status <> 'cancelled'
      RETURNING task_id`,
    [setId],
  );
  return rows.map((r) => r.task_id);
}

/** The tasks still open that carry out one record (a key result's initiatives). */
async function openForRecord(db, entityType, entityId) {
  // pagination:complete every open task of one record, each cancelled with it
  const { rows } = await completeQuery(
    db,
    `SELECT task_id, status FROM task
      WHERE entity_type = $1 AND entity_id = $2 AND status NOT IN ('done', 'cancelled')
      ORDER BY task_id`,
    [entityType, entityId],
    { label: "a record's open tasks", ceiling: 500 },
  );
  return rows;
}


/* ------------------------------------------------------------------ *
 * Steps, waiting on, watchers and holds (docs/guides/workspace.md §6)
 * ------------------------------------------------------------------ */

/** Most steps, prerequisites and watchers a task holds; the panel shows them whole. */
const PLAN_MAX = 25;

const STEPS = `
  SELECT s.task_step_id, s.task_id, s.title, to_char(s.due_on, 'YYYY-MM-DD') AS due_on, s.done_at,
         ${personJson("e", "d")} AS done_by, s.sort_order, s.created_at
    FROM task_step s
    LEFT JOIN app_user u ON u.user_id = s.done_by
    LEFT JOIN employee e ON e.employee_id = u.employee_id
    LEFT JOIN department d ON d.department_id = e.department_id`;

/** A task's steps in their order. */
async function steps(db, taskId) {
  // pagination:complete a task's own steps, at most PLAN_MAX (the service refuses more)
  const { rows } = await completeQuery(
    db,
    `${STEPS} WHERE s.task_id = $1 ORDER BY s.sort_order, s.created_at, s.task_step_id`,
    [taskId],
    { label: "a task's steps", ceiling: PLAN_MAX },
  );
  return rows;
}

async function step(db, taskId, stepId) {
  const { rows } = await db.query(`${STEPS} WHERE s.task_id = $1 AND s.task_step_id = $2`, [taskId, stepId]);
  return rows[0] || null;
}

async function stepCount(db, taskId) {
  const { rows } = await db.query("SELECT count(*)::int AS n, COALESCE(max(sort_order), 0) AS last FROM task_step WHERE task_id = $1", [taskId]);
  return { n: rows[0].n, last: Number(rows[0].last) };
}

async function insertStep(client, row) {
  const { rows } = await client.query(
    `INSERT INTO task_step (task_id, title, due_on, sort_order, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING task_step_id`,
    [row.task_id, row.title, row.due_on || null, row.sort_order, row.created_by],
  );
  return rows[0].task_step_id;
}

/** Change a step: title, due_on, done_at and done_by as given. */
async function updateStep(client, stepId, changes) {
  const keys = ["title", "due_on", "done_at", "done_by"].filter((k) => changes[k] !== undefined);
  if (!keys.length) return;
  await client.query(
    `UPDATE task_step SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE task_step_id = $1`,
    [stepId, ...keys.map((k) => changes[k])],
  );
}

async function deleteStep(client, stepId) {
  await client.query("DELETE FROM task_step WHERE task_step_id = $1", [stepId]);
}

/** The other end of an edge, with what the reader needs to decide whether they may open it. */
const EDGES = (side, other) => `
  SELECT dp.task_dependency_id, dp.overridden_at, dp.override_reason,
         o.task_id, o.number::text AS number, o.title, o.status,
         o.primary_assignee_id, o.set_by_employee_id,
         ${personJson("oe", "od")} AS assignee
    FROM task_dependency dp
    JOIN task o ON o.task_id = dp.${other}
    LEFT JOIN employee oe ON oe.employee_id = o.primary_assignee_id
    LEFT JOIN department od ON od.department_id = oe.department_id
   WHERE dp.${side} = $1`;

/** What a task waits on. */
async function waitingOn(db, taskId) {
  // pagination:complete one task's prerequisites, at most PLAN_MAX (the service refuses more)
  const { rows } = await completeQuery(
    db,
    `${EDGES("task_id", "depends_on_task_id")} ORDER BY dp.created_at, dp.task_dependency_id`,
    [taskId],
    { label: "a task's prerequisites", ceiling: PLAN_MAX },
  );
  return rows;
}

/** What waits on a task. */
async function holdingUp(db, taskId) {
  // pagination:complete the tasks waiting on one task, at most PLAN_MAX (the service refuses more)
  const { rows } = await completeQuery(
    db,
    `${EDGES("depends_on_task_id", "task_id")} ORDER BY dp.created_at, dp.task_dependency_id`,
    [taskId],
    { label: "the tasks waiting on a task", ceiling: PLAN_MAX },
  );
  return rows;
}

async function edgeCounts(db, taskId, dependsOnId) {
  const { rows } = await db.query(
    `SELECT (SELECT count(*)::int FROM task_dependency WHERE task_id = $1) AS waits,
            (SELECT count(*)::int FROM task_dependency WHERE depends_on_task_id = $2) AS held`,
    [taskId, dependsOnId],
  );
  return rows[0];
}

/** Would "taskId waits on dependsOnId" close a loop? Walks what dependsOnId waits on, 50 deep at most. */
async function wouldCycle(db, taskId, dependsOnId) {
  const { rows } = await db.query(
    `WITH RECURSIVE walk AS (
       SELECT $2::uuid AS id, 0 AS depth
       UNION
       SELECT dp.depends_on_task_id, w.depth + 1
         FROM task_dependency dp JOIN walk w ON dp.task_id = w.id
        WHERE w.depth < 50
     )
     SELECT 1 FROM walk WHERE id = $1 LIMIT 1`,
    [taskId, dependsOnId],
  );
  return rows.length > 0;
}

async function insertDependency(client, { task_id, depends_on_task_id, created_by }) {
  const { rows } = await client.query(
    `INSERT INTO task_dependency (task_id, depends_on_task_id, created_by) VALUES ($1, $2, $3)
     ON CONFLICT (task_id, depends_on_task_id) DO NOTHING RETURNING task_dependency_id`,
    [task_id, depends_on_task_id, created_by],
  );
  return rows[0] ? rows[0].task_dependency_id : null;
}

async function dependency(db, taskId, dependencyId) {
  const { rows } = await db.query(
    `SELECT dp.*, o.number::text AS other_number, o.status AS other_status
       FROM task_dependency dp JOIN task o ON o.task_id = dp.depends_on_task_id
      WHERE dp.task_id = $1 AND dp.task_dependency_id = $2`,
    [taskId, dependencyId],
  );
  return rows[0] || null;
}

async function deleteDependency(client, dependencyId) {
  await client.query("DELETE FROM task_dependency WHERE task_dependency_id = $1", [dependencyId]);
}

async function overrideDependency(client, dependencyId, { by, reason }) {
  await client.query(
    `UPDATE task_dependency SET overridden_at = now(), overridden_by = $2, override_reason = $3
      WHERE task_dependency_id = $1`,
    [dependencyId, by, reason || null],
  );
}

/** The first prerequisite still holding a task up, or null. */
async function firstUnsatisfied(db, taskId) {
  const { rows } = await db.query(
    `SELECT o.number::text AS number, o.title FROM task_dependency dp
       JOIN task o ON o.task_id = dp.depends_on_task_id
      WHERE dp.task_id = $1 AND dp.overridden_at IS NULL AND o.status <> 'done'
      ORDER BY dp.created_at, dp.task_dependency_id LIMIT 1`,
    [taskId],
  );
  return rows[0] || null;
}

/** The open tasks that wait on this one, with their assignees: told when it is done. */
async function waitingAssignees(db, taskId) {
  // pagination:complete the tasks waiting on one task, at most PLAN_MAX
  const { rows } = await completeQuery(
    db,
    `SELECT t.primary_assignee_id FROM task_dependency dp JOIN task t ON t.task_id = dp.task_id
      WHERE dp.depends_on_task_id = $1 AND t.status NOT IN ('done', 'cancelled')
      ORDER BY dp.task_dependency_id`,
    [taskId],
    { label: "the tasks waiting on a task", ceiling: PLAN_MAX },
  );
  return rows.map((r) => r.primary_assignee_id);
}

/** A task's watchers as people. */
async function watchers(db, taskId) {
  // pagination:complete one task's watchers, at most PLAN_MAX (the service refuses more)
  const { rows } = await completeQuery(
    db,
    `SELECT ${personJson("e", "d")} AS person
       FROM task_watcher w
       JOIN employee e ON e.employee_id = w.employee_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE w.task_id = $1
      ORDER BY w.created_at, w.task_watcher_id`,
    [taskId],
    { label: "a task's watchers", ceiling: PLAN_MAX },
  );
  return rows.map((r) => r.person);
}

async function watcherIds(db, taskId) {
  // pagination:complete one task's watchers, at most PLAN_MAX
  const { rows } = await completeQuery(
    db,
    "SELECT employee_id FROM task_watcher WHERE task_id = $1 ORDER BY task_watcher_id",
    [taskId],
    { label: "a task's watchers", ceiling: PLAN_MAX },
  );
  return rows.map((r) => r.employee_id);
}

async function addWatcher(client, { task_id, employee_id, created_by }) {
  const { rows } = await client.query(
    `INSERT INTO task_watcher (task_id, employee_id, created_by) VALUES ($1, $2, $3)
     ON CONFLICT (task_id, employee_id) DO NOTHING RETURNING task_watcher_id`,
    [task_id, employee_id, created_by],
  );
  return rows.length > 0;
}

async function removeWatcher(client, taskId, employeeId) {
  const { rowCount } = await client.query("DELETE FROM task_watcher WHERE task_id = $1 AND employee_id = $2", [taskId, employeeId]);
  return rowCount > 0;
}

const HOLDS = `
  SELECT b.task_blockage_id, b.note, to_char(b.estimated_resolve_on, 'YYYY-MM-DD') AS estimated_resolve_on,
         ${personJson("re", "rd")} AS raised_by, b.raised_at, b.resolved_at,
         ${personJson("xe", "xd")} AS resolved_by, b.resolve_note, b.due_shift_days,
         round((extract(epoch FROM COALESCE(b.resolved_at, now()) - b.raised_at) / 86400.0)::numeric, 1)::float AS blocked_days
    FROM task_blockage b
    LEFT JOIN app_user ru ON ru.user_id = b.raised_by
    LEFT JOIN employee re ON re.employee_id = ru.employee_id
    LEFT JOIN department rd ON rd.department_id = re.department_id
    LEFT JOIN app_user xu ON xu.user_id = b.resolved_by
    LEFT JOIN employee xe ON xe.employee_id = xu.employee_id
    LEFT JOIN department xd ON xd.department_id = xe.department_id`;

/** The task's open hold, or null. */
async function openBlockage(db, taskId) {
  const { rows } = await db.query(`${HOLDS} WHERE b.task_id = $1 AND b.resolved_at IS NULL`, [taskId]);
  return rows[0] || null;
}

/** One page of a task's holds, newest first by default. */
function blockages(db, taskId, query) {
  return pageQuery(
    db,
    `SELECT v.*, ${TOTAL_COL} FROM (${HOLDS} WHERE b.task_id = $1) v
      ORDER BY ${orderBy(query, { raised_at: "v.raised_at" }, "v.task_blockage_id")}`,
    [taskId],
    { ...query, sort: query.sort || { field: "raised_at", dir: "desc" } },
  );
}

async function insertBlockage(client, { task_id, note, estimated_resolve_on, raised_by }) {
  const { rows } = await client.query(
    `INSERT INTO task_blockage (task_id, note, estimated_resolve_on, raised_by) VALUES ($1, $2, $3, $4)
     RETURNING task_blockage_id, raised_at`,
    [task_id, note, estimated_resolve_on || null, raised_by],
  );
  return rows[0];
}

/** Close the open hold; returns it as it was (raised_at), or null when none was open. */
async function resolveBlockage(client, taskId, { by, note, shiftDays }) {
  const { rows } = await client.query(
    `UPDATE task_blockage SET resolved_at = now(), resolved_by = $2, resolve_note = $3, due_shift_days = $4
      WHERE task_id = $1 AND resolved_at IS NULL
      RETURNING task_blockage_id, raised_at`,
    [taskId, by, note || null, shiftDays],
  );
  return rows[0] || null;
}

module.exports = {
  PLAN_MAX,
  steps,
  step,
  stepCount,
  insertStep,
  updateStep,
  deleteStep,
  waitingOn,
  holdingUp,
  edgeCounts,
  wouldCycle,
  insertDependency,
  dependency,
  deleteDependency,
  overrideDependency,
  firstUnsatisfied,
  waitingAssignees,
  watchers,
  watcherIds,
  addWatcher,
  removeWatcher,
  openBlockage,
  blockages,
  insertBlockage,
  resolveBlockage,
  SORTS,
  COMMITMENT_STATE,
  openForRecord,
  keyResultOf,
  countsTowards,
  doneTowards,
  recoveryOf,
  weekList,
  linkCommitments,
  fixOriginalDates,
  list,
  summary,
  get,
  sharedWith,
  lock,
  insert,
  update,
  slotIn,
  renumber,
  nextOrder,
  addActivity,
  activity,
  activitySince,
  addComment,
  comment,
  comments,
  targetOf,
  employeeActive,
  dueToRepeat,
  dueBetween,
};
