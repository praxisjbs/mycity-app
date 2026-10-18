"use strict";
/**
 * Attendance: the SQL. Writes only the attendance tables (attendance_event,
 * attendance_day, attendance_exception); reads employee, worksite, leave and the
 * working week for what a day means. Never emits (BACKEND_GUIDE §2).
 *
 * attendance_event is append-only (a trigger refuses UPDATE and DELETE): a decision on
 * an exception is written on the exception, and a correction is a new event.
 *
 * Leave counts when it is granted: approved, or submitted with its approval already
 * approved (the leave module copies the outcome after commit; leave.repo.js STATUS
 * reads it the same way).
 */
const { pageQuery, orderBy, completeQuery, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

/** Granted leave covering `dateExpr` for the employee in `employeeCol`. */
const GRANTED_LEAVE = (employeeCol, dateExpr) => `EXISTS (
  SELECT 1 FROM leave_request lr
    LEFT JOIN workflow_instance wi ON wi.workflow_instance_id = lr.workflow_instance_id
   WHERE lr.employee_id = ${employeeCol} AND lr.starts_on <= ${dateExpr} AND lr.ends_on >= ${dateExpr}
     AND (lr.status = 'approved' OR (lr.status = 'submitted' AND wi.state IN ('approved', 'timeout_approved'))))`;

/** Is `dateExpr` worked: the working week (Monday to Friday when it is empty) and no public holiday. */
const WORKING_DAY = (dateExpr) => `(
  CASE WHEN EXISTS (SELECT 1 FROM working_week)
       THEN COALESCE((SELECT ww.is_working_day FROM working_week ww
                       WHERE ww.weekday = extract(isodow FROM ${dateExpr})::int), false)
       ELSE extract(isodow FROM ${dateExpr}) <= 5 END
  AND NOT EXISTS (SELECT 1 FROM public_holiday h WHERE h.holiday_date = ${dateExpr}))`;

const PERSON = (alias = "e", dept = "d") => `json_build_object(
  'employee_id', ${alias}.employee_id,
  'display_name', btrim(${alias}.first_name || ' ' || ${alias}.last_name),
  'job_title', ${alias}.job_title,
  'department', ${dept}.name)`;

const nameOf = (alias) =>
  `CASE WHEN ${alias}.employee_id IS NULL THEN NULL ELSE btrim(${alias}.first_name || ' ' || ${alias}.last_name) END`;

/* ------------------------------------------------------------------ *
 * The punch
 * ------------------------------------------------------------------ */

/** Punches for one person are decided one after the other. */
async function lockEmployee(client, employeeId) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('attendance:' || $1::text, 0))", [employeeId]);
}

/** The person a punch is for, with their worksite's zone when it is in use. */
function person(db, employeeId) {
  return one(
    db,
    `SELECT e.employee_id, ${PERSON()} AS ref, e.status, e.work_pattern, e.worksite_id,
            CASE WHEN w.active THEN w.timezone END AS timezone
       FROM employee e
       LEFT JOIN department d ON d.department_id = e.department_id
       LEFT JOIN worksite w ON w.worksite_id = e.worksite_id
      WHERE e.employee_id = $1`,
    [employeeId],
  );
}

const POLICY = `p.attendance_policy_id, p.name, p.grace_minutes, p.latest_clock_out_minutes,
  p.geofence_mode, p.device_mode, p.max_accuracy_m`;

/** The person's own policy and worksite for a date, when People set one (effective-dated). */
function assignedPolicy(db, employeeId, date) {
  return one(
    db,
    `SELECT ${POLICY}, ea.worksite_id AS override_worksite_id
       FROM employee_attendance_policy ea
       JOIN attendance_policy p ON p.attendance_policy_id = ea.attendance_policy_id AND p.active
      WHERE ea.employee_id = $1 AND ea.effective_from <= $2::date
        AND (ea.effective_to IS NULL OR ea.effective_to > $2::date)
      ORDER BY ea.effective_from DESC
      LIMIT 1`,
    [employeeId, date],
  );
}

/** The organisation's policy: the oldest active one. */
function defaultPolicy(db) {
  return one(
    db,
    `SELECT ${POLICY}, NULL::uuid AS override_worksite_id
       FROM attendance_policy p WHERE p.active
      ORDER BY p.created_at, p.attendance_policy_id
      LIMIT 1`,
    [],
  );
}

/** Granted leave covering a date, or null. */
function grantedLeave(db, employeeId, date) {
  return one(
    db,
    `SELECT lr.starts_on, lr.ends_on, t.name AS leave_type_name
       FROM leave_request lr
       JOIN leave_type t ON t.leave_type_id = lr.leave_type_id
       LEFT JOIN workflow_instance wi ON wi.workflow_instance_id = lr.workflow_instance_id
      WHERE lr.employee_id = $1 AND lr.starts_on <= $2::date AND lr.ends_on >= $2::date
        AND (lr.status = 'approved' OR (lr.status = 'submitted' AND wi.state IN ('approved', 'timeout_approved')))
      ORDER BY lr.starts_on
      LIMIT 1`,
    [employeeId, date],
  );
}

/**
 * A work date's active events (accepted or under review), oldest first; `excluded` when
 * an exception on the event was decided rejected. Rejected attempts are left out: they
 * change neither the guard nor the day. The unique index allows one active event of each
 * type a day, so this is a handful, never a list a person pages through.
 */
async function eventsOn(db, employeeId, date) {
  // pagination:complete the guard and the day's figures need every active event of the day
  const { rows } = await completeQuery(
    db,
    `SELECT ev.attendance_event_id, ev.event_type, ev.validation_state, ev.occurred_at, ev.source,
            EXISTS (SELECT 1 FROM attendance_exception x
                     WHERE x.attendance_event_id = ev.attendance_event_id AND x.outcome = 'rejected') AS excluded
       FROM attendance_event ev
      WHERE ev.employee_id = $1 AND ev.work_date = $2::date AND ev.validation_state IN ('accepted', 'review')
      ORDER BY ev.occurred_at, ev.attendance_event_id`,
    [employeeId, date],
    { label: "a day's punches", ceiling: 50 },
  );
  return rows;
}

const EVENT_RESULT = `ev.attendance_event_id, ev.employee_id, ev.event_type, ev.validation_state, ev.occurred_at,
  ev.device_at, ev.work_date, ev.distance_m::float8 AS distance_m, ev.validation, w.name AS worksite_name`;

/** The punch an idempotency key already made, or null. */
function eventByKey(db, employeeId, key) {
  return one(
    db,
    `SELECT ${EVENT_RESULT}
       FROM attendance_event ev LEFT JOIN worksite w ON w.worksite_id = ev.worksite_id
      WHERE ev.employee_id = $1 AND ev.idempotency_key = $2`,
    [employeeId, key],
  );
}

async function insertEvent(client, e) {
  const row = await one(
    client,
    `INSERT INTO attendance_event
       (employee_id, event_type, occurred_at, work_date, device_at, worksite_id, known_device_id,
        attendance_device_id, attendance_policy_id, latitude, longitude, accuracy_m, distance_m, source,
        validation_state, validation, request_id, idempotency_key, note, recorded_by, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17, $18, $19, $20, $21)
     RETURNING attendance_event_id`,
    [
      e.employee_id,
      e.event_type,
      e.occurred_at,
      e.work_date,
      e.device_at || null,
      e.worksite_id || null,
      e.known_device_id || null,
      e.attendance_device_id || null,
      e.attendance_policy_id || null,
      e.latitude ?? null,
      e.longitude ?? null,
      e.accuracy_m ?? null,
      e.distance_m ?? null,
      e.source,
      e.validation_state,
      JSON.stringify(e.validation || {}),
      e.request_id || null,
      e.idempotency_key || null,
      e.note || null,
      e.recorded_by || null,
      e.reason || null,
    ],
  );
  return one(
    client,
    `SELECT ${EVENT_RESULT} FROM attendance_event ev LEFT JOIN worksite w ON w.worksite_id = ev.worksite_id
      WHERE ev.attendance_event_id = $1`,
    [row.attendance_event_id],
  );
}

const DAY = `ad.attendance_day_id, ad.employee_id, ad.attendance_date, ad.status, ad.first_clock_in_at,
  ad.last_clock_out_at, ad.worked_minutes, ad.late_minutes, ad.overtime_minutes, ad.closed_at`;

function getDay(db, employeeId, date) {
  return one(db, `SELECT ${DAY} FROM attendance_day ad WHERE ad.employee_id = $1 AND ad.attendance_date = $2::date`, [
    employeeId,
    date,
  ]);
}

/** Write a day's figures; `closed` stamps it closed (once). */
function upsertDay(client, employeeId, date, p, { closed = false } = {}) {
  return one(
    client,
    `INSERT INTO attendance_day
       (employee_id, attendance_date, status, first_clock_in_at, last_clock_out_at, worked_minutes,
        late_minutes, overtime_minutes, closed_at)
     VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, CASE WHEN $9::boolean THEN now() END)
     ON CONFLICT (employee_id, attendance_date) DO UPDATE SET
       status = EXCLUDED.status,
       first_clock_in_at = EXCLUDED.first_clock_in_at,
       last_clock_out_at = EXCLUDED.last_clock_out_at,
       worked_minutes = EXCLUDED.worked_minutes,
       late_minutes = EXCLUDED.late_minutes,
       overtime_minutes = EXCLUDED.overtime_minutes,
       closed_at = COALESCE(attendance_day.closed_at, EXCLUDED.closed_at)
     RETURNING attendance_day_id, attendance_date, status, closed_at`,
    [
      employeeId,
      date,
      p.status,
      p.first_clock_in_at,
      p.last_clock_out_at,
      p.worked_minutes,
      p.late_minutes,
      p.overtime_minutes,
      closed,
    ],
  );
}

/** Open an exception, once: null when the same one is already there. */
function insertException(client, x) {
  const target = x.attendance_event_id
    ? "(attendance_event_id, exception_type) WHERE attendance_event_id IS NOT NULL"
    : "(attendance_day_id, exception_type) WHERE attendance_event_id IS NULL";
  return one(
    client,
    `INSERT INTO attendance_exception (attendance_day_id, attendance_event_id, exception_type, severity, evidence)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT ${target} DO NOTHING
     RETURNING attendance_exception_id, exception_type`,
    [x.attendance_day_id, x.attendance_event_id || null, x.exception_type, x.severity, JSON.stringify(x.evidence || {})],
  );
}

async function openExceptionCount(db, dayId) {
  if (!dayId) return 0;
  const r = await one(
    db,
    "SELECT count(*)::int AS n FROM attendance_exception WHERE attendance_day_id = $1 AND status = 'open'",
    [dayId],
  );
  return r ? r.n : 0;
}

/* ------------------------------------------------------------------ *
 * Days and punches, read
 * ------------------------------------------------------------------ */

const DAY_ROW = `ad.attendance_day_id, ad.attendance_date, ad.status, ad.first_clock_in_at, ad.last_clock_out_at,
  ad.worked_minutes, ad.late_minutes, ad.overtime_minutes, ad.closed_at,
  (SELECT count(*)::int FROM attendance_exception x
    WHERE x.attendance_day_id = ad.attendance_day_id AND x.status = 'open') AS open_exceptions`;

/** A page of one person's days between two dates, newest first unless sorted. */
function listDays(db, employeeId, from, to, query) {
  return pageQuery(
    db,
    `SELECT ${DAY_ROW}, ${TOTAL_COL}
       FROM attendance_day ad
      WHERE ad.employee_id = $1 AND ad.attendance_date BETWEEN $2::date AND $3::date
      ORDER BY ${orderBy(query, { newest: "ad.attendance_date DESC", attendance_date: "ad.attendance_date" }, "ad.attendance_day_id")}`,
    [employeeId, from, to],
    query,
  );
}

/** One person's figures between two dates. */
function daysSummary(db, employeeId, from, to) {
  return one(
    db,
    `SELECT count(*) FILTER (WHERE ad.status IN ('present', 'late'))::int AS days_present,
            count(*) FILTER (WHERE ad.status = 'late')::int AS late_days,
            count(*) FILTER (WHERE ad.status = 'absent')::int AS absent_days,
            count(*) FILTER (WHERE ad.status = 'leave')::int AS leave_days,
            COALESCE(sum(ad.worked_minutes), 0)::int AS worked_minutes,
            COALESCE(sum(ad.late_minutes), 0)::int AS late_minutes,
            (SELECT count(*)::int FROM attendance_exception x
               JOIN attendance_day xd ON xd.attendance_day_id = x.attendance_day_id
              WHERE xd.employee_id = $1 AND x.status = 'open'
                AND xd.attendance_date BETWEEN $2::date AND $3::date) AS open_exceptions
       FROM attendance_day ad
      WHERE ad.employee_id = $1 AND ad.attendance_date BETWEEN $2::date AND $3::date`,
    [employeeId, from, to],
  );
}

/**
 * A page of one person's punches on a date, with their evidence. `coordinates` false
 * leaves the latitude and longitude out (the person's own screens, team scope).
 */
function listEvents(db, employeeId, date, query, { coordinates }) {
  return pageQuery(
    db,
    `SELECT ev.attendance_event_id, ev.event_type, ev.work_date, ev.occurred_at, ev.device_at,
            CASE WHEN ev.device_at IS NULL THEN NULL
                 ELSE round(extract(epoch FROM (ev.occurred_at - ev.device_at)))::int END AS skew_seconds,
            ev.validation_state, ev.source,
            CASE WHEN $3::boolean THEN ev.latitude::float8 END AS latitude,
            CASE WHEN $3::boolean THEN ev.longitude::float8 END AS longitude,
            ev.accuracy_m::float8 AS accuracy_m, ev.distance_m::float8 AS distance_m,
            w.name AS worksite_name,
            COALESCE(ev.validation #>> '{geofence,verdict}', 'not_applied') AS geofence,
            ev.validation #>> '{geofence,reason}' AS location_reason,
            adv.label AS device_label,
            COALESCE(ev.validation #>> '{device,state}', 'none') AS device_state,
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(ev.validation -> 'reasons', '[]'::jsonb))) AS reasons,
            ev.note,
            EXISTS (SELECT 1 FROM attendance_exception x
                     WHERE x.attendance_event_id = ev.attendance_event_id AND x.outcome = 'rejected') AS excluded,
            ${nameOf("re")} AS recorded_by_name,
            ev.reason,
            ${TOTAL_COL}
       FROM attendance_event ev
       LEFT JOIN worksite w ON w.worksite_id = ev.worksite_id
       LEFT JOIN attendance_device adv ON adv.attendance_device_id = ev.attendance_device_id
       LEFT JOIN app_user ru ON ru.user_id = ev.recorded_by
       LEFT JOIN employee re ON re.employee_id = ru.employee_id
      WHERE ev.employee_id = $1 AND ev.work_date = $2::date
      ORDER BY ev.occurred_at, ev.attendance_event_id`,
    [employeeId, date, Boolean(coordinates)],
    query,
  );
}

/* ------------------------------------------------------------------ *
 * Exceptions
 * ------------------------------------------------------------------ */

const EXCEPTIONS = `
  SELECT x.attendance_exception_id, x.attendance_day_id, x.attendance_event_id,
         ${PERSON()} AS employee, ad.employee_id, ad.attendance_date AS work_date,
         x.exception_type, x.severity, x.status, x.outcome, x.evidence, x.employee_note,
         x.employee_noted_at, x.resolution, x.reviewed_at, ${nameOf("re")} AS reviewed_by_name,
         x.created_at,
         search_fold(e.first_name || ' ' || e.last_name || ' ' || COALESCE(e.preferred_name, '')) AS haystack
    FROM attendance_exception x
    JOIN attendance_day ad ON ad.attendance_day_id = x.attendance_day_id
    JOIN employee e ON e.employee_id = ad.employee_id
    LEFT JOIN department d ON d.department_id = e.department_id
    LEFT JOIN app_user ru ON ru.user_id = x.reviewed_by
    LEFT JOIN employee re ON re.employee_id = ru.employee_id`;

const EXCEPTION_OUT = `v.attendance_exception_id, v.attendance_day_id, v.attendance_event_id, v.employee,
  v.employee_id, v.work_date, v.exception_type, v.severity, v.status, v.outcome, v.evidence, v.employee_note,
  v.employee_noted_at, v.resolution, v.reviewed_at, v.reviewed_by_name, v.created_at`;

/** Exceptions: the open ones first, then the newest, unless sorted. */
const EXCEPTION_SORTS = {
  queue: "(v.status = 'open') DESC, v.created_at DESC",
  created_at: "v.created_at",
};

/** A page of exceptions, filtered, within a scope. */
function listExceptions(db, query, scope) {
  const params = [
    query.status || null,
    query.exception_type || null,
    query.date || null,
    query.employee_id || null,
    query.q || null,
  ];
  const s = scopeClause(scope, { column: "v.employee_id" }, params);
  return pageQuery(
    db,
    `SELECT ${EXCEPTION_OUT}, ${TOTAL_COL}
       FROM (${EXCEPTIONS}) v
      WHERE ($1::text IS NULL OR v.status = $1)
        AND ($2::text IS NULL OR v.exception_type = $2)
        AND ($3::date IS NULL OR v.work_date = $3::date)
        AND ($4::uuid IS NULL OR v.employee_id = $4)
        AND ($5::text IS NULL OR v.haystack LIKE '%' || search_fold($5) || '%')
        ${s.and}
      ORDER BY ${orderBy(query, EXCEPTION_SORTS, "v.attendance_exception_id")}`,
    params,
    query,
  );
}

const getException = (db, id) =>
  one(db, `SELECT ${EXCEPTION_OUT} FROM (${EXCEPTIONS}) v WHERE v.attendance_exception_id = $1`, [id]);

/** Decide an open exception. Null when it was already decided. */
function resolveException(client, id, { outcome, resolution, by }) {
  return one(
    client,
    `UPDATE attendance_exception
        SET status = 'resolved', outcome = $2, resolution = $3, reviewed_by = $4, reviewed_at = now()
      WHERE attendance_exception_id = $1 AND status = 'open'
      RETURNING attendance_exception_id`,
    [id, outcome, resolution, by],
  );
}

/** The person explains an open exception of theirs. Null when it is not open. */
function explainException(client, id, note) {
  return one(
    client,
    `UPDATE attendance_exception SET employee_note = $2, employee_noted_at = now()
      WHERE attendance_exception_id = $1 AND status = 'open'
      RETURNING attendance_exception_id`,
    [id, note],
  );
}

/* ------------------------------------------------------------------ *
 * The register
 * ------------------------------------------------------------------ */

/**
 * Everyone on the date `$1`: the employees at work then (and anyone with a day that
 * date), their day if they have one, and what having none means. `$1` is the date.
 */
const REGISTER = `
  SELECT e.employee_id, ${PERSON()} AS employee, e.work_pattern, e.department_id,
         $1::date AS date,
         CASE WHEN ad.status IS NOT NULL THEN ad.status
              WHEN ${GRANTED_LEAVE("e.employee_id", "$1::date")} THEN 'leave'
              WHEN NOT ${WORKING_DAY("$1::date")} THEN 'off'
              ELSE 'not_in' END AS status,
         ${WORKING_DAY("$1::date")} AS working_day,
         ad.attendance_day_id, ad.first_clock_in_at AS clock_in_at, ad.last_clock_out_at AS clock_out_at,
         COALESCE(ad.worked_minutes, 0) AS worked_minutes, COALESCE(ad.late_minutes, 0) AS late_minutes,
         COALESCE(ad.overtime_minutes, 0) AS overtime_minutes, ad.closed_at,
         CASE WHEN e.work_pattern = 'remote' THEN 'Remote' WHEN w.active THEN w.name END AS expected_location,
         CASE WHEN w.active THEN w.radius_m END AS expected_radius_m,
         last.validation #>> '{geofence,verdict}' AS location_verdict,
         last.device_label,
         last.validation #>> '{device,state}' AS device_state,
         (SELECT count(*)::int FROM attendance_exception x
           WHERE x.attendance_day_id = ad.attendance_day_id AND x.status = 'open') AS open_exceptions,
         e.last_name, e.first_name,
         search_fold(e.first_name || ' ' || e.last_name || ' ' || COALESCE(e.preferred_name, '') || ' '
                     || COALESCE(w.name, '')) AS haystack
    FROM employee e
    LEFT JOIN department d ON d.department_id = e.department_id
    LEFT JOIN worksite w ON w.worksite_id = e.worksite_id
    LEFT JOIN attendance_day ad ON ad.employee_id = e.employee_id AND ad.attendance_date = $1::date
    LEFT JOIN (
      SELECT DISTINCT ON (ev.employee_id) ev.employee_id, ev.validation, adv.label AS device_label
        FROM attendance_event ev
        LEFT JOIN attendance_device adv ON adv.attendance_device_id = ev.attendance_device_id
       WHERE ev.work_date = $1::date
       ORDER BY ev.employee_id, ev.occurred_at DESC, ev.attendance_event_id DESC
    ) last ON last.employee_id = e.employee_id
   WHERE ad.attendance_day_id IS NOT NULL
      OR (e.status = 'active' AND (e.start_date IS NULL OR e.start_date <= $1::date)
          AND (e.left_on IS NULL OR e.left_on > $1::date))`;

const REGISTER_OUT = `v.employee, v.work_pattern, v.date, v.status, v.attendance_day_id, v.clock_in_at,
  v.clock_out_at, v.worked_minutes, v.late_minutes, v.expected_location, v.location_verdict, v.device_label,
  v.device_state, v.open_exceptions`;

const REGISTER_SORTS = {
  display_name: "v.last_name, v.first_name",
  clock_in_at: "v.clock_in_at",
  status: "v.status",
};

function register(db, date, query, scope) {
  const params = [date, query.status || null, query.department_id || null, query.q || null];
  const s = scopeClause(scope, { column: "v.employee_id" }, params);
  return pageQuery(
    db,
    `SELECT ${REGISTER_OUT}, ${TOTAL_COL}
       FROM (${REGISTER}) v
      WHERE ($2::text IS NULL OR v.status = $2)
        AND ($3::uuid IS NULL OR v.department_id = $3)
        AND ($4::text IS NULL OR v.haystack LIKE '%' || search_fold($4) || '%')
        ${s.and}
      ORDER BY ${orderBy(query, REGISTER_SORTS, "v.employee_id")}`,
    params,
    query,
  );
}

function registerSummary(db, date, scope) {
  const params = [date];
  const s = scopeClause(scope, { column: "v.employee_id" }, params);
  return one(
    db,
    `SELECT count(*) FILTER (WHERE v.working_day AND v.status <> 'leave')::int AS expected,
            count(*) FILTER (WHERE v.status = 'present')::int AS present,
            count(*) FILTER (WHERE v.status = 'late')::int AS late,
            count(*) FILTER (WHERE v.status = 'absent')::int AS absent,
            count(*) FILTER (WHERE v.status = 'leave')::int AS on_leave,
            count(*) FILTER (WHERE v.status = 'not_in')::int AS not_in,
            COALESCE(sum(v.open_exceptions), 0)::int AS open_exceptions
       FROM (${REGISTER}) v
      ${s.where}`,
    params,
  );
}

/** One person on the register for a date, with the day's extras. */
const registerRow = (db, date, employeeId) =>
  one(
    db,
    `SELECT ${REGISTER_OUT}, v.overtime_minutes, v.closed_at, v.expected_radius_m, v.employee_id
       FROM (${REGISTER}) v WHERE v.employee_id = $2`,
    [date, employeeId],
  );

/** A day's id or an exception's, to the person and the day it is about. */
const recordRef = (db, id) =>
  one(
    db,
    `SELECT ad.attendance_day_id, NULL::uuid AS attendance_exception_id, ad.employee_id, ad.attendance_date AS date
       FROM attendance_day ad WHERE ad.attendance_day_id = $1
     UNION ALL
     SELECT ad.attendance_day_id, x.attendance_exception_id, ad.employee_id, ad.attendance_date AS date
       FROM attendance_exception x JOIN attendance_day ad ON ad.attendance_day_id = x.attendance_day_id
      WHERE x.attendance_exception_id = $1
     LIMIT 1`,
    [id],
  );

/* ------------------------------------------------------------------ *
 * The day-close job
 * ------------------------------------------------------------------ */

/** The first work date anyone punched: absences are never counted from before it. */
async function attendanceStart(db) {
  const r = await one(db, "SELECT min(work_date)::text AS d FROM attendance_event", []);
  return r ? r.d : null;
}

/** Every day not yet closed, from `since` to before `before`. */
async function unclosedDays(db, since, before) {
  // pagination:complete the day-close closes every open day of the window, not a page of them
  const { rows } = await completeQuery(
    db,
    `SELECT ad.employee_id, ad.attendance_date::text AS attendance_date
       FROM attendance_day ad
      WHERE ad.closed_at IS NULL AND ad.attendance_date >= $1::date AND ad.attendance_date < $2::date
      ORDER BY ad.attendance_date, ad.employee_id`,
    [since, before],
    { label: "open attendance days" },
  );
  return rows;
}

/** The people at work on a date who have no day for it. */
async function withoutDay(db, date) {
  // pagination:complete the day-close must see every person at work that day
  const { rows } = await completeQuery(
    db,
    `SELECT e.employee_id
       FROM employee e
      WHERE e.status = 'active' AND (e.start_date IS NULL OR e.start_date <= $1::date)
        AND (e.left_on IS NULL OR e.left_on > $1::date)
        AND NOT EXISTS (SELECT 1 FROM attendance_day ad
                         WHERE ad.employee_id = e.employee_id AND ad.attendance_date = $1::date)
      ORDER BY e.employee_id`,
    [date],
    { label: "people with no attendance day" },
  );
  return rows;
}

module.exports = {
  WORKING_DAY,
  lockEmployee,
  person,
  assignedPolicy,
  defaultPolicy,
  grantedLeave,
  eventsOn,
  eventByKey,
  insertEvent,
  getDay,
  upsertDay,
  insertException,
  openExceptionCount,
  listDays,
  daysSummary,
  listEvents,
  listExceptions,
  getException,
  resolveException,
  explainException,
  register,
  registerSummary,
  registerRow,
  recordRef,
  attendanceStart,
  unclosedDays,
  withoutDay,
};
