"use strict";
/**
 * Leave: the SQL. Reads the requests, the types and a person's year; writes only the
 * leave module's own rows (leave_request, leave_type). Never emits (BACKEND_GUIDE §2).
 *
 * A request's status as a person reads it is worked out with its approval. The
 * approval flow decides (shared/workflow/engine.js) and the leave module copies the
 * outcome onto the request after commit (leave.events.js), so between the decision and
 * that copy a request still says `submitted` while its approval says `approved`. Every
 * read uses STATUS below, which takes the approval's outcome when the copy has not
 * landed yet, so no screen shows a decided request as waiting.
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");
const { personJson } = require("../../shared/db/person");

const STATUS = `CASE
  WHEN lr.status = 'submitted' AND wi.state IN ('approved', 'timeout_approved') THEN 'approved'
  WHEN lr.status = 'submitted' AND wi.state IN ('rejected', 'timeout_rejected') THEN 'rejected'
  WHEN lr.status = 'submitted' AND wi.state = 'cancelled' THEN 'cancelled'
  ELSE lr.status
END`;

/**
 * The stage a pending request waits at, by the name the flow gives it. Stage keys are
 * unique in a flow, so the aggregate reads one name; it is an aggregate rather than a
 * LIMIT because these rows are paged (shared/http/paged.js owns LIMIT).
 */
const WAITING_ON = `CASE WHEN wi.state = 'pending' THEN (
  SELECT min(s ->> 'name') FROM workflow_definition wd, jsonb_array_elements(wd.stages) s
   WHERE wd.workflow_definition_id = wi.workflow_definition_id AND s ->> 'key' = wi.current_stage
) END`;

/** Every request with what a screen needs, and the columns the filters and scope read. */
const ROWS = `
  SELECT lr.leave_request_id,
         ${personJson("e", "d")} AS employee,
         lr.employee_id, e.department_id,
         lr.leave_type_id, t.name AS leave_type_name,
         lr.starts_on, lr.ends_on, lr.amount::int AS days, lr.reason,
         ${STATUS} AS status,
         lr.workflow_instance_id, ${WAITING_ON} AS waiting_on,
         (lr.recorded_by IS NOT NULL) AS recorded,
         lr.submitted_at,
         COALESCE(lr.decided_at, CASE WHEN wi.state <> 'pending' THEN wi.completed_at END) AS decided_at,
         lr.created_at,
         search_fold(e.first_name || ' ' || e.last_name || ' ' || t.name) AS haystack
    FROM leave_request lr
    JOIN employee e ON e.employee_id = lr.employee_id
    LEFT JOIN department d ON d.department_id = e.department_id
    JOIN leave_type t ON t.leave_type_id = lr.leave_type_id
    LEFT JOIN workflow_instance wi ON wi.workflow_instance_id = lr.workflow_instance_id`;

/** The keys of LeaveRequest, and nothing the filters only needed. */
const OUT = `v.leave_request_id, v.employee, v.leave_type_id, v.leave_type_name, v.starts_on,
  v.ends_on, v.days, v.reason, v.status, v.workflow_instance_id, v.waiting_on, v.recorded,
  v.submitted_at, v.decided_at, v.created_at`;

const SORTS = {
  starts_on: "v.starts_on",
  submitted_at: "v.submitted_at",
  created_at: "v.created_at",
};

/** Requests still in play: waiting, or granted. */
const LIVE = `v.status IN ('submitted', 'approved')`;

/**
 * One page of requests.
 * @param {{query: Function}} db
 * @param {{status?: string, leave_type_id?: string, employee_id?: string, from?: string,
 *          to?: string, year?: number, q?: string, page?: number, sort?: object,
 *          statuses?: string[]}} query   statuses: the leave calendar's several, never from a request
 * @param {{scope: string, scope_ids: string[]|null}} scope
 */
function list(db, query, scope) {
  const params = [
    query.status || null,
    query.leave_type_id || null,
    query.employee_id || null,
    query.from || null,
    query.to || null,
    query.year || null,
    query.q || null,
    query.statuses || null,
  ];
  const s = scopeClause(scope, { column: "v.employee_id" }, params);
  return pageQuery(
    db,
    `SELECT ${OUT}, ${TOTAL_COL}
       FROM (${ROWS}) v
      WHERE ($1::text IS NULL OR v.status = $1)
        AND ($2::uuid IS NULL OR v.leave_type_id = $2)
        AND ($3::uuid IS NULL OR v.employee_id = $3)
        AND ($4::date IS NULL OR v.ends_on >= $4)
        AND ($5::date IS NULL OR v.starts_on <= $5)
        AND ($6::int IS NULL OR date_part('year', v.starts_on)::int = $6)
        AND ($7::text IS NULL OR v.haystack LIKE '%' || search_fold($7) || '%')
        AND ($8::text[] IS NULL OR v.status = ANY($8::text[]))
        ${s.and}
      ORDER BY ${orderBy(query, SORTS, "v.leave_request_id")}`,
    params,
    query,
  );
}

/** One request, or null. `employee_id` comes along for the ownership and scope checks. */
async function get(db, id) {
  const { rows } = await db.query(
    `SELECT ${OUT}, v.employee_id, v.department_id FROM (${ROWS}) v WHERE v.leave_request_id = $1`,
    [id],
  );
  return rows[0] || null;
}

/** The public shape of a row get() returned. */
function publicRow(row) {
  if (!row) return row;
  const { employee_id: _e, department_id: _d, ...out } = row;
  return out;
}

/**
 * The other requests in play in the same department over the same days: who else is away.
 * @param {{query: Function}} db
 * @param {{leave_request_id: string, employee_id: string, department_id: string, starts_on: string, ends_on: string}} of
 */
function clashes(db, of, query, scope) {
  const params = [of.department_id, of.employee_id, of.starts_on, of.ends_on];
  const s = scopeClause(scope, { column: "v.employee_id" }, params);
  return pageQuery(
    db,
    `SELECT ${OUT}, ${TOTAL_COL}
       FROM (${ROWS}) v
      WHERE v.department_id = $1 AND v.employee_id <> $2
        AND v.starts_on <= $4::date AND v.ends_on >= $3::date
        AND ${LIVE}
        ${s.and}
      ORDER BY ${orderBy(query, { starts_on: "v.starts_on" }, "v.leave_request_id")}`,
    params,
    query,
  );
}

/** The figures above People · Leave, within the caller's scope. */
async function summary(db, today, scope) {
  const params = [today];
  const s = scopeClause(scope, { column: "v.employee_id" }, params);
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE v.status = 'submitted')::int AS pending,
            count(*) FILTER (WHERE v.status = 'approved' AND v.starts_on <= $1::date AND v.ends_on >= $1::date)::int AS on_leave_today,
            count(*) FILTER (WHERE v.status = 'approved' AND v.starts_on > $1::date AND v.starts_on <= $1::date + 14)::int AS starting_soon,
            count(*) FILTER (WHERE v.status = 'approved' AND date_part('year', v.starts_on) = date_part('year', $1::date))::int AS approved_this_year
       FROM (${ROWS}) v
      ${s.where}`,
    params,
  );
  return rows[0];
}

/**
 * The requests in play for one person over some days, other than `exceptId`. Used to
 * refuse a request that overlaps one already made.
 */
async function overlapping(db, employeeId, startsOn, endsOn, exceptId = null) {
  const { rows } = await db.query(
    `SELECT v.leave_request_id, v.starts_on, v.ends_on, v.status
       FROM (${ROWS}) v
      WHERE v.employee_id = $1 AND v.starts_on <= $3::date AND v.ends_on >= $2::date
        AND ${LIVE}
        AND ($4::uuid IS NULL OR v.leave_request_id <> $4)
      ORDER BY v.starts_on, v.leave_request_id
      LIMIT 1`,
    [employeeId, startsOn, endsOn, exceptId],
  );
  return rows[0] || null;
}

/**
 * One person's year, per leave type: the allowance and the days used. A retired type
 * still shows while the year has days on it.
 *   entitled  People's figure for this person and year (leave_balance), else the type's
 *             days_per_year, else null (no allowance)
 */
async function balances(db, employeeId, year, today) {
  const { rows } = await db.query(
    `SELECT t.leave_type_id, t.code::text AS code, t.name,
            COALESCE(b.entitled, (t.policy ->> 'days_per_year')::numeric)::float8 AS entitled,
            COALESCE(sum(v.days) FILTER (WHERE v.status = 'approved' AND v.starts_on <= $3::date), 0)::int AS taken,
            COALESCE(sum(v.days) FILTER (WHERE v.status = 'approved' AND v.starts_on > $3::date), 0)::int AS booked,
            COALESCE(sum(v.days) FILTER (WHERE v.status = 'submitted'), 0)::int AS pending
       FROM leave_type t
       LEFT JOIN (
         SELECT leave_type_id, sum(opening + accrued + adjusted) AS entitled
           FROM leave_balance
          WHERE employee_id = $1 AND period_start >= make_date($2, 1, 1) AND period_end <= make_date($2, 12, 31)
          GROUP BY leave_type_id
       ) b ON b.leave_type_id = t.leave_type_id
       LEFT JOIN (${ROWS}) v
         ON v.leave_type_id = t.leave_type_id AND v.employee_id = $1
        AND date_part('year', v.starts_on)::int = $2
      GROUP BY t.leave_type_id, t.code, t.name, t.policy, t.active, b.entitled
     HAVING t.active OR count(v.leave_request_id) > 0
      ORDER BY t.name, t.leave_type_id`,
    [employeeId, year, today],
  );
  return rows.map((r) => {
    const entitled = r.entitled === null ? null : Number(r.entitled);
    return {
      leave_type_id: r.leave_type_id,
      code: r.code,
      name: r.name,
      entitled,
      taken: r.taken,
      booked: r.booked,
      pending: r.pending,
      remaining: entitled === null ? null : entitled - r.taken - r.booked - r.pending,
    };
  });
}

/**
 * People's allowance for one person, type and year. `days` null removes it, so the
 * type's days a year apply again. Returns the row before, for the audit.
 */
async function setAllowance(client, { employee_id: employeeId, leave_type_id: typeId, year, days }) {
  const { rows: before } = await client.query(
    `SELECT opening::float8 AS days FROM leave_balance
      WHERE employee_id = $1 AND leave_type_id = $2
        AND period_start = make_date($3, 1, 1) AND period_end = make_date($3, 12, 31)`,
    [employeeId, typeId, year],
  );
  if (days === null) {
    await client.query(
      `DELETE FROM leave_balance
        WHERE employee_id = $1 AND leave_type_id = $2
          AND period_start = make_date($3, 1, 1) AND period_end = make_date($3, 12, 31)`,
      [employeeId, typeId, year],
    );
  } else {
    await client.query(
      `INSERT INTO leave_balance (employee_id, leave_type_id, period_start, period_end, opening, accrued, used, adjusted)
       VALUES ($1, $2, make_date($3, 1, 1), make_date($3, 12, 31), $4, 0, 0, 0)
       ON CONFLICT (employee_id, leave_type_id, period_start, period_end)
       DO UPDATE SET opening = EXCLUDED.opening, accrued = 0, adjusted = 0`,
      [employeeId, typeId, year, days],
    );
  }
  return before[0] ? before[0].days : null;
}

/** Serialise writes for one person, so two requests sent at once cannot both pass the checks. */
async function lockEmployee(client, employeeId) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('leave:' || $1::text, 0))", [
    employeeId,
  ]);
}

/** The person a request is for: active, with a name for messages. */
async function employeeOf(db, employeeId) {
  const { rows } = await db.query(
    `SELECT employee_id, btrim(first_name || ' ' || last_name) AS display_name, status
       FROM employee WHERE employee_id = $1`,
    [employeeId],
  );
  return rows[0] || null;
}

async function insertRequest(client, r) {
  const { rows } = await client.query(
    `INSERT INTO leave_request
       (employee_id, leave_type_id, starts_on, ends_on, amount, reason, status,
        submitted_at, decided_at, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8, $9)
     RETURNING leave_request_id, employee_id, leave_type_id, starts_on, ends_on, amount, reason, status, recorded_by`,
    [
      r.employee_id,
      r.leave_type_id,
      r.starts_on,
      r.ends_on,
      r.amount,
      r.reason || null,
      r.status,
      r.status === "approved" ? new Date() : null,
      r.recorded_by || null,
    ],
  );
  return rows[0];
}

async function setWorkflow(client, id, instanceId) {
  await client.query(
    "UPDATE leave_request SET workflow_instance_id = $2 WHERE leave_request_id = $1",
    [id, instanceId],
  );
}

/**
 * Copy an approval's outcome onto a request that is still waiting. Returns the row it
 * changed, or null when it was already settled (the copy runs at least once).
 */
async function settle(client, id, status) {
  const { rows } = await client.query(
    `UPDATE leave_request
        SET status = $2, decided_at = now(),
            cancelled_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE cancelled_at END
      WHERE leave_request_id = $1 AND status = 'submitted'
      RETURNING leave_request_id, employee_id, status`,
    [id, status],
  );
  return rows[0] || null;
}

/** Cancel a request that is waiting or granted. Null when it was not. */
async function cancel(client, id) {
  const { rows } = await client.query(
    `UPDATE leave_request SET status = 'cancelled', cancelled_at = now()
      WHERE leave_request_id = $1 AND status IN ('submitted', 'approved')
      RETURNING leave_request_id, employee_id, status`,
    [id],
  );
  return rows[0] || null;
}

/* ---------------- leave types ---------------- */

const TYPE_COLS = `t.leave_type_id, t.code::text AS code, t.name,
  CASE WHEN jsonb_typeof(t.policy -> 'days_per_year') = 'number' THEN (t.policy ->> 'days_per_year')::int END AS days_per_year,
  t.active`;

function listTypes(db, query) {
  const params = [query.active === undefined ? null : query.active, query.q || null];
  return pageQuery(
    db,
    `SELECT ${TYPE_COLS}, ${TOTAL_COL}
       FROM leave_type t
      WHERE ($1::boolean IS NULL OR t.active = $1)
        AND ($2::text IS NULL OR search_fold(t.name) LIKE '%' || search_fold($2) || '%')
      ORDER BY ${orderBy(query, { name: "t.name" }, "t.leave_type_id")}`,
    params,
    query,
  );
}

async function getType(db, id) {
  const { rows } = await db.query(`SELECT ${TYPE_COLS} FROM leave_type t WHERE t.leave_type_id = $1`, [id]);
  return rows[0] || null;
}

async function typeByCode(db, code) {
  const { rows } = await db.query(`SELECT ${TYPE_COLS} FROM leave_type t WHERE t.code = $1`, [code]);
  return rows[0] || null;
}

/** Whether any request or balance names this type: then it is retired, never deleted. */
async function typeInUse(db, id) {
  const { rows } = await db.query(
    `SELECT EXISTS (SELECT 1 FROM leave_request WHERE leave_type_id = $1)
         OR EXISTS (SELECT 1 FROM leave_balance WHERE leave_type_id = $1) AS used`,
    [id],
  );
  return rows[0].used;
}

/** Delete a type nothing names. Returns whether a row went. */
async function deleteType(client, id) {
  const { rowCount } = await client.query(
    `DELETE FROM leave_type t WHERE t.leave_type_id = $1
        AND NOT EXISTS (SELECT 1 FROM leave_request r WHERE r.leave_type_id = t.leave_type_id)
        AND NOT EXISTS (SELECT 1 FROM leave_balance b WHERE b.leave_type_id = t.leave_type_id)`,
    [id],
  );
  return rowCount > 0;
}

async function countActiveTypes(db) {
  const { rows } = await db.query("SELECT count(*)::int AS n FROM leave_type WHERE active");
  return rows[0].n;
}

async function insertType(client, { code, name, days_per_year: days }) {
  const { rows } = await client.query(
    `INSERT INTO leave_type (code, name, unit, policy)
     VALUES ($1, $2, 'days', jsonb_build_object('days_per_year', $3::int))
     RETURNING leave_type_id`,
    [code, name, days],
  );
  return getType(client, rows[0].leave_type_id);
}

async function updateType(client, id, patch) {
  const hasDays = Object.prototype.hasOwnProperty.call(patch, "days_per_year");
  await client.query(
    `UPDATE leave_type
        SET name = COALESCE($2, name),
            active = COALESCE($3, active),
            policy = CASE WHEN $4::boolean THEN policy || jsonb_build_object('days_per_year', $5::int) ELSE policy END
      WHERE leave_type_id = $1`,
    [
      id,
      patch.name === undefined ? null : patch.name,
      patch.active === undefined ? null : patch.active,
      hasDays,
      hasDays ? patch.days_per_year : null,
    ],
  );
  return getType(client, id);
}

module.exports = {
  list,
  get,
  publicRow,
  clashes,
  summary,
  overlapping,
  balances,
  lockEmployee,
  setAllowance,
  employeeOf,
  insertRequest,
  setWorkflow,
  settle,
  cancel,
  listTypes,
  getType,
  typeByCode,
  countActiveTypes,
  typeInUse,
  deleteType,
  insertType,
  updateType,
};
