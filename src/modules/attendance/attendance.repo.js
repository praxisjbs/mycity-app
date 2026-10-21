"use strict";
/**
 * Attendance: the SQL. Writes only the attendance tables (attendance_event,
 * attendance_day, attendance_exception, attendance_home, attendance_location_request, the
 * field assignment tables attendance_field_assignment, _site and _member,
 * attendance_work_schedule, attendance_clock_reminder, attendance_rule_breach,
 * attendance_pay_item and attendance_overtime_approval); reads employee, worksite, leave,
 * approvals and the working week for what a day means. Never emits (BACKEND_GUIDE §2), and never
 * reads policy_version: the company hours a day needs come in as a parameter the service read
 * through policies.rulesFor (docs/guides/attendance.md §6.9).
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
const { personJson } = require("../../shared/db/person");
const lagos = require("../../shared/time/lagos");
const approvers = require("../../shared/workflow/approvers");
const { REGISTER_SITE } = require("./attendance.sites.repo");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

/** Granted leave covering `dateExpr` for the employee in `employeeCol`. */
const GRANTED_LEAVE = (employeeCol, dateExpr) => `EXISTS (
  SELECT 1 FROM leave_request lr
    LEFT JOIN workflow_instance wi ON wi.workflow_instance_id = lr.workflow_instance_id
   WHERE lr.employee_id = ${employeeCol} AND lr.starts_on <= ${dateExpr} AND lr.ends_on >= ${dateExpr}
     AND (lr.status = 'approved' OR (lr.status = 'submitted' AND wi.state IN ('approved', 'timeout_approved'))))`;

/**
 * Do the company hours work `dateExpr`'s weekday: the Attendance policy's hours when `hoursExpr`
 * (a jsonb expression the service passes as a parameter: the seven HoursDay of the version in force
 * on the date, or null) holds them, else the working week. Holidays aside (EXPECTED_ON adds them).
 */
const COMPANY_WORKS = (dateExpr, hoursExpr) => `(CASE
  WHEN jsonb_typeof(${hoursExpr}) = 'array'
    THEN COALESCE(((${hoursExpr}) -> (extract(isodow FROM ${dateExpr})::int - 1) ->> 'working')::boolean, false)
  WHEN EXISTS (SELECT 1 FROM working_week)
    THEN COALESCE((SELECT ww.is_working_day FROM working_week ww
                    WHERE ww.weekday = extract(isodow FROM ${dateExpr})::int), false)
  ELSE extract(isodow FROM ${dateExpr}) <= 5 END)`;

/** The work schedule in force for `employeeCol` on `dateExpr` (the latest started by then), as `ws`. */
const SCHEDULE_IN_FORCE = (employeeCol, dateExpr) => `attendance_work_schedule ws
   WHERE ws.employee_id = ${employeeCol}
     AND ws.effective_from = (SELECT max(wm.effective_from) FROM attendance_work_schedule wm
                               WHERE wm.employee_id = ${employeeCol} AND wm.effective_from <= ${dateExpr})`;

/** The schedule's day for `dateExpr` (its jsonb element). */
const SCHEDULE_DAY = (dateExpr) => `(ws.days -> (extract(isodow FROM ${dateExpr})::int - 1))`;

/**
 * Is `dateExpr` worked by the employee in `employeeCol` (guide §6.4, §6.13): by the work schedule in
 * force then (a working day with its own times, or with none on a weekday the company hours work),
 * else by the company hours; never on a public holiday. The one rule the register, the roster and
 * the day agree on, written once for SQL (rules.shiftFor is the same in JavaScript).
 */
const WORKS_ON = (employeeCol, dateExpr, hoursExpr) => `(
  NOT EXISTS (SELECT 1 FROM public_holiday h WHERE h.holiday_date = ${dateExpr})
  AND COALESCE((
    SELECT CASE WHEN NOT COALESCE((${SCHEDULE_DAY(dateExpr)} ->> 'working')::boolean, false) THEN false
                WHEN ${SCHEDULE_DAY(dateExpr)} ->> 'starts_at' IS NOT NULL THEN true
                ELSE ${COMPANY_WORKS(dateExpr, hoursExpr)} END
      FROM ${SCHEDULE_IN_FORCE(employeeCol, dateExpr)}), ${COMPANY_WORKS(dateExpr, hoursExpr)}))`;

/** Does the employee in `employeeCol` hold an active login: nobody else is expected to clock in (§6.4). */
const HAS_LOGIN = (employeeCol) =>
  `EXISTS (SELECT 1 FROM app_user lu WHERE lu.employee_id = ${employeeCol} AND lu.status = 'active')`;

/** Is the employee expected on `dateExpr`: their day is worked and they have a login to clock in with. */
const EXPECTED_ON = (employeeCol, dateExpr, hoursExpr) =>
  `(${WORKS_ON(employeeCol, dateExpr, hoursExpr)} AND ${HAS_LOGIN(employeeCol)})`;

/**
 * Is `dateExpr` worked remotely by the employee (guide §6.9, §6.13): a Remote day of the schedule in
 * force then; with no schedule working that day, a remote work pattern. No LIMIT: lists built on it
 * go through pageQuery.
 */
const PLACE_REMOTE = (employeeCol, patternCol, dateExpr) => `COALESCE((
  SELECT (${SCHEDULE_DAY(dateExpr)} ->> 'place') = 'remote'
    FROM ${SCHEDULE_IN_FORCE(employeeCol, dateExpr)}
     AND COALESCE((${SCHEDULE_DAY(dateExpr)} ->> 'working')::boolean, false)), ${patternCol} = 'remote')`;

/** A person as the contract's PersonRef, with their photo (shared/db/person.js). */
const PERSON = (alias = "e", dept = "d") => personJson(alias, dept);

/** A work location request's place, named as the register and a punch show it (§6.11). */
const REQUEST_PLACE = (col) =>
  `CASE ${col} WHEN 'temporary_home' THEN 'Temporary Home' WHEN 'remote_day' THEN 'Remote Day'
     WHEN 'client_visit' THEN 'Client Visit' END`;

/** The place a punch was judged against, named, when it was not a worksite (§6.10 to §6.12). */
const PUNCH_PLACE = `COALESCE(w.name, CASE ev.validation #>> '{geofence,place}' WHEN 'home' THEN 'Home'
  WHEN 'field' THEN ev.validation #>> '{geofence,worksite_name}'
  WHEN 'temporary_site' THEN ev.validation #>> '{geofence,worksite_name}'
  ELSE ${REQUEST_PLACE("ev.validation #>> '{geofence,place}'")} END)`;

/**
 * A punch the day does not count: an exception on it was decided rejected, or it is an automatic
 * clock-out whose exception People corrected, their clock-out standing in its place (§6.8, §6.14).
 */
const EXCLUDED = (ev) => `EXISTS (SELECT 1 FROM attendance_exception x
   WHERE x.attendance_event_id = ${ev}.attendance_event_id
     AND (x.outcome = 'rejected' OR (${ev}.source = 'system' AND x.outcome = 'corrected')))`;

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
    `SELECT e.employee_id, ${PERSON()} AS ref, e.status, e.work_pattern, e.worksite_id, e.line_manager_id,
            e.gross_monthly::text AS gross_monthly, ${HAS_LOGIN("e.employee_id")} AS has_login,
            CASE WHEN w.active THEN w.timezone END AS timezone
       FROM employee e
       LEFT JOIN department d ON d.department_id = e.department_id
       LEFT JOIN worksite w ON w.worksite_id = e.worksite_id
      WHERE e.employee_id = $1`,
    [employeeId],
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
 * A leave request's person and dates, and whether it is granted (approved, or submitted with its
 * approval already approved, as GRANTED_LEAVE reads it), or null.
 */
function leaveRequestDays(db, leaveRequestId) {
  return one(
    db,
    `SELECT lr.employee_id, lr.starts_on::text AS starts_on, lr.ends_on::text AS ends_on,
            (lr.status = 'approved' OR (lr.status = 'submitted' AND wi.state IN ('approved', 'timeout_approved'))) AS granted
       FROM leave_request lr
       LEFT JOIN workflow_instance wi ON wi.workflow_instance_id = lr.workflow_instance_id
      WHERE lr.leave_request_id = $1`,
    [leaveRequestId],
  );
}

/** A person's closed days from `from` to `to`, oldest first: those leave granted later re-projects. */
async function closedDaysBetween(db, employeeId, from, to) {
  // pagination:complete each day of one person's leave is recalculated, and a leave is a bounded span
  const { rows } = await completeQuery(
    db,
    `SELECT ad.attendance_date::text AS attendance_date
       FROM attendance_day ad
      WHERE ad.employee_id = $1 AND ad.attendance_date BETWEEN $2::date AND $3::date AND ad.closed_at IS NOT NULL
      ORDER BY ad.attendance_date`,
    [employeeId, from, to],
    { label: "a leave's closed days", ceiling: 400 },
  );
  return rows.map((r) => r.attendance_date);
}

/**
 * A work date's active events (accepted or under review), oldest first; `excluded` when
 * the day does not count it (EXCLUDED); `policy_version_id` the version each was judged by
 * (a punch from before policies names it as `attendance_policy_id`, the same id since 1405). Rejected attempts are left out: they change
 * neither the guard nor the day. The unique indexes allow one active event of each type a
 * day, and one automatic clock-out beside it, so this is a handful, never a list a person
 * pages through.
 */
async function eventsOn(db, employeeId, date) {
  // pagination:complete the guard and the day's figures need every active event of the day
  const { rows } = await completeQuery(
    db,
    `SELECT ev.attendance_event_id, ev.event_type, ev.validation_state, ev.occurred_at, ev.source,
            COALESCE(ev.policy_version_id, ev.attendance_policy_id) AS policy_version_id,
            ${EXCLUDED("ev")} AS excluded
       FROM attendance_event ev
      WHERE ev.employee_id = $1 AND ev.work_date = $2::date AND ev.validation_state IN ('accepted', 'review')
      ORDER BY ev.occurred_at, ev.attendance_event_id`,
    [employeeId, date],
    { label: "a day's punches", ceiling: 50 },
  );
  return rows;
}

const EVENT_RESULT = `ev.attendance_event_id, ev.employee_id, ev.event_type, ev.validation_state, ev.occurred_at,
  ev.device_at, ev.work_date, ev.distance_m::float8 AS distance_m, ev.validation,
  ${PUNCH_PLACE} AS worksite_name`;

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

/**
 * Record a punch. Its slot is how many punches of its type that day a decision had already excluded
 * (1380): the unique index holds one active punch a slot, so a punch People rejected frees its place
 * for the next, and two written at once still collide (§6.2).
 */
async function insertEvent(client, e) {
  const row = await one(
    client,
    `INSERT INTO attendance_event
       (employee_id, event_type, occurred_at, work_date, device_at, worksite_id, known_device_id,
        attendance_device_id, policy_version_id, latitude, longitude, accuracy_m, distance_m, source,
        validation_state, validation, request_id, idempotency_key, note, recorded_by, reason, slot)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17, $18, $19, $20, $21,
             (SELECT count(*)::smallint FROM attendance_event ev
               WHERE ev.employee_id = $1 AND ev.work_date = $4::date AND ev.event_type = $2
                 AND ev.validation_state IN ('accepted', 'review') AND ev.source <> 'system' AND ${EXCLUDED("ev")}))
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
      e.policy_version_id || null,
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
  ad.last_clock_out_at, ad.worked_minutes, ad.late_minutes, ad.early_minutes, ad.overtime_minutes, ad.closed_at,
  ad.policy_version_id, ad.attendance_work_schedule_id, ad.shift_working, ad.shift_starts_at::text AS shift_starts_at,
  ad.shift_ends_at::text AS shift_ends_at, ad.judged_at`;

function getDay(db, employeeId, date) {
  return one(db, `SELECT ${DAY} FROM attendance_day ad WHERE ad.employee_id = $1 AND ad.attendance_date = $2::date`, [
    employeeId,
    date,
  ]);
}

/**
 * Write a day's figures; `closed` stamps it closed (once). `judged` records what judged the day (the
 * version, the schedule and the shift, guide §6.4) the first time it is given: a day judged once
 * keeps its judgement.
 */
function upsertDay(client, employeeId, date, p, { closed = false, judged = null } = {}) {
  return one(
    client,
    `INSERT INTO attendance_day
       (employee_id, attendance_date, status, first_clock_in_at, last_clock_out_at, worked_minutes,
        late_minutes, early_minutes, overtime_minutes, closed_at, policy_version_id, attendance_work_schedule_id,
        shift_working, shift_starts_at, shift_ends_at, judged_at)
     VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $10::boolean THEN now() END,
             $11, $12, $13, $14::time, $15::time, CASE WHEN $16::boolean THEN now() END)
     ON CONFLICT (employee_id, attendance_date) DO UPDATE SET
       status = EXCLUDED.status,
       first_clock_in_at = EXCLUDED.first_clock_in_at,
       last_clock_out_at = EXCLUDED.last_clock_out_at,
       worked_minutes = EXCLUDED.worked_minutes,
       late_minutes = EXCLUDED.late_minutes,
       early_minutes = EXCLUDED.early_minutes,
       overtime_minutes = EXCLUDED.overtime_minutes,
       closed_at = COALESCE(attendance_day.closed_at, EXCLUDED.closed_at),
       policy_version_id = CASE WHEN attendance_day.judged_at IS NULL THEN EXCLUDED.policy_version_id ELSE attendance_day.policy_version_id END,
       attendance_work_schedule_id = CASE WHEN attendance_day.judged_at IS NULL THEN EXCLUDED.attendance_work_schedule_id ELSE attendance_day.attendance_work_schedule_id END,
       shift_working = CASE WHEN attendance_day.judged_at IS NULL THEN EXCLUDED.shift_working ELSE attendance_day.shift_working END,
       shift_starts_at = CASE WHEN attendance_day.judged_at IS NULL THEN EXCLUDED.shift_starts_at ELSE attendance_day.shift_starts_at END,
       shift_ends_at = CASE WHEN attendance_day.judged_at IS NULL THEN EXCLUDED.shift_ends_at ELSE attendance_day.shift_ends_at END,
       judged_at = COALESCE(attendance_day.judged_at, EXCLUDED.judged_at)
     RETURNING ${DAY.replace(/ad\./g, "")}`,
    [
      employeeId,
      date,
      p.status,
      p.first_clock_in_at,
      p.last_clock_out_at,
      p.worked_minutes,
      p.late_minutes,
      p.early_minutes || 0,
      p.overtime_minutes,
      closed,
      judged ? judged.policy_version_id : null,
      judged ? judged.attendance_work_schedule_id : null,
      judged ? judged.shift_working : null,
      judged ? judged.shift_starts_at : null,
      judged ? judged.shift_ends_at : null,
      Boolean(judged),
    ],
  );
}

/**
 * Open an exception, once: null when the same one is already there. One per punch and type, one per
 * check-in and type (§6.12), else one per day and type (a missing clock-out).
 */
function insertException(client, x) {
  const target = x.attendance_event_id
    ? "(attendance_event_id, exception_type) WHERE attendance_event_id IS NOT NULL"
    : x.attendance_check_in_id
      ? "(attendance_check_in_id, exception_type) WHERE attendance_check_in_id IS NOT NULL"
      : "(attendance_day_id, exception_type) WHERE attendance_event_id IS NULL AND attendance_check_in_id IS NULL";
  return one(
    client,
    `INSERT INTO attendance_exception
       (attendance_day_id, attendance_event_id, attendance_check_in_id, exception_type, severity, evidence)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT ${target} DO NOTHING
     RETURNING attendance_exception_id, exception_type`,
    [
      x.attendance_day_id,
      x.attendance_event_id || null,
      x.attendance_check_in_id || null,
      x.exception_type,
      x.severity,
      JSON.stringify(x.evidence || {}),
    ],
  );
}

/**
 * A day's open exceptions that wait on People about the day: a refused punch's exception (§6.7) is
 * People's to see, but the punch never counted, so it leaves the person's clock as it is.
 */
async function openExceptionCount(db, dayId) {
  if (!dayId) return 0;
  const r = await one(
    db,
    `SELECT count(*)::int AS n
       FROM attendance_exception x
       LEFT JOIN attendance_event ev ON ev.attendance_event_id = x.attendance_event_id
      WHERE x.attendance_day_id = $1 AND x.status = 'open' AND ev.validation_state IS DISTINCT FROM 'rejected'`,
    [dayId],
  );
  return r ? r.n : 0;
}

/* ------------------------------------------------------------------ *
 * Days and punches, read
 * ------------------------------------------------------------------ */

/**
 * Whether the day's counted clock-out is the system's: its last clock-out is an automatic one
 * the day still counts (§6.14).
 */
const CLOCK_OUT_AUTOMATIC = (dayAlias) => `EXISTS (SELECT 1 FROM attendance_event ao
   WHERE ao.employee_id = ${dayAlias}.employee_id AND ao.work_date = ${dayAlias}.attendance_date
     AND ao.source = 'system' AND ao.event_type = 'clock_out' AND ao.validation_state = 'accepted'
     AND ao.occurred_at = ${dayAlias}.last_clock_out_at AND NOT ${EXCLUDED("ao")})`;

const DAY_ROW = `ad.attendance_day_id, ad.attendance_date, ad.status, ad.first_clock_in_at, ad.last_clock_out_at,
  ${CLOCK_OUT_AUTOMATIC("ad")} AS clock_out_automatic,
  ad.worked_minutes, ad.late_minutes, ad.early_minutes, ad.overtime_minutes, ad.closed_at,
  (SELECT count(*)::int FROM attendance_exception x
    WHERE x.attendance_day_id = ad.attendance_day_id AND x.status = 'open') AS open_exceptions`;

/**
 * A page of one person's days between two dates, newest first unless sorted. `query.status`
 * keeps one figure's days; `present` takes late days too, as the Days Present figure does.
 */
function listDays(db, employeeId, from, to, query) {
  const statuses = !query.status ? null : query.status === "present" ? ["present", "late"] : [query.status];
  return pageQuery(
    db,
    `SELECT ${DAY_ROW}, ${TOTAL_COL}
       FROM attendance_day ad
      WHERE ad.employee_id = $1 AND ad.attendance_date BETWEEN $2::date AND $3::date
        AND ($4::text[] IS NULL OR ad.status = ANY($4::text[]))
      ORDER BY ${orderBy(query, { newest: "ad.attendance_date DESC", attendance_date: "ad.attendance_date" }, "ad.attendance_day_id")}`,
    [employeeId, from, to, statuses],
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
            ${PUNCH_PLACE} AS worksite_name,
            COALESCE(ev.validation #>> '{geofence,verdict}', 'not_applied') AS geofence,
            ev.validation #>> '{geofence,reason}' AS location_reason,
            adv.label AS device_label,
            COALESCE(ev.validation #>> '{device,state}', 'none') AS device_state,
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(ev.validation -> 'reasons', '[]'::jsonb))) AS reasons,
            ev.note,
            ${EXCLUDED("ev")} AS excluded,
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
  SELECT x.attendance_exception_id, x.attendance_day_id, x.attendance_event_id, x.attendance_check_in_id,
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

const EXCEPTION_OUT = `v.attendance_exception_id, v.attendance_day_id, v.attendance_event_id, v.attendance_check_in_id, v.employee,
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
 * date), their day if they have one, and what having none means, each by their own day (EXPECTED_ON:
 * their schedule, else the company hours `hours`, a jsonb parameter, else the working week). `$1` is
 * the date.
 */
const REGISTER = (hours) => `
  SELECT e.employee_id, ${PERSON()} AS employee, e.work_pattern, e.department_id,
         $1::date AS date,
         CASE WHEN ad.status IS NOT NULL THEN ad.status
              WHEN ${GRANTED_LEAVE("e.employee_id", "$1::date")} THEN 'leave'
              WHEN NOT ${EXPECTED_ON("e.employee_id", "$1::date", hours)} THEN 'off'
              ELSE 'not_in' END AS status,
         ${EXPECTED_ON("e.employee_id", "$1::date", hours)} AS working_day,
         ad.attendance_day_id, ad.first_clock_in_at AS clock_in_at, ad.last_clock_out_at AS clock_out_at,
         COALESCE(ad.worked_minutes, 0) AS worked_minutes, COALESCE(ad.late_minutes, 0) AS late_minutes,
         COALESCE(ad.early_minutes, 0) AS early_minutes,
         COALESCE(ad.overtime_minutes, 0) AS overtime_minutes, ad.closed_at,
         COALESCE(${REGISTER_SITE("e.employee_id", "$1::date")},
         CASE WHEN fa.sites IS NOT NULL THEN fa.sites
              WHEN lr.request_type IS NOT NULL THEN ${REQUEST_PLACE("lr.request_type")}
              WHEN ${PLACE_REMOTE("e.employee_id", "e.work_pattern", "$1::date")}
              THEN CASE WHEN EXISTS (SELECT 1 FROM attendance_home ah
                                      WHERE ah.employee_id = e.employee_id AND ah.status = 'approved')
                        THEN 'Home' ELSE 'Remote' END
              WHEN w.active THEN w.name END) AS expected_location,
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
    LEFT JOIN LATERAL (
      -- At most one active field assignment covers a person's day (attendance.assignments.js): its
      -- sites' names, read unpaged with min().
      SELECT min((SELECT string_agg(fs.name, ' or ' ORDER BY fs.position) FROM attendance_field_site fs
                   WHERE fs.field_assignment_id = fx.field_assignment_id)) AS sites
        FROM attendance_field_member fm
        JOIN attendance_field_assignment fx ON fx.field_assignment_id = fm.field_assignment_id
       WHERE fm.employee_id = e.employee_id AND fm.removed_at IS NULL AND fx.status = 'active'
         AND fx.starts_on <= $1::date AND fx.ends_on >= $1::date
    ) fa ON true
    LEFT JOIN LATERAL (
      -- At most one approved request covers a day (attendance.requests.js); min() reads it unpaged.
      SELECT min(x.request_type) AS request_type FROM attendance_location_request x
       WHERE x.employee_id = e.employee_id AND x.status = 'approved'
         AND x.starts_on <= $1::date AND x.ends_on >= $1::date
    ) lr ON true
    LEFT JOIN (
      -- The person's own latest punch: an automatic clock-out has no location or device to show.
      SELECT DISTINCT ON (ev.employee_id) ev.employee_id, ev.validation, adv.label AS device_label
        FROM attendance_event ev
        LEFT JOIN attendance_device adv ON adv.attendance_device_id = ev.attendance_device_id
       WHERE ev.work_date = $1::date AND ev.source <> 'system'
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

/** The company hours for the register's date, as the jsonb parameter REGISTER reads (null: the working week). */
const hoursParam = (hours) => (Array.isArray(hours) ? JSON.stringify(hours) : null);

function register(db, date, query, scope, { hours = null } = {}) {
  const params = [date, query.status || null, query.department_id || null, query.q || null, hoursParam(hours)];
  const s = scopeClause(scope, { column: "v.employee_id" }, params);
  return pageQuery(
    db,
    `SELECT ${REGISTER_OUT}, ${TOTAL_COL}
       FROM (${REGISTER("$5::jsonb")}) v
      WHERE ($2::text IS NULL OR v.status = $2)
        AND ($3::uuid IS NULL OR v.department_id = $3)
        AND ($4::text IS NULL OR v.haystack LIKE '%' || search_fold($4) || '%')
        ${s.and}
      ORDER BY ${orderBy(query, REGISTER_SORTS, "v.employee_id")}`,
    params,
    query,
  );
}

function registerSummary(db, date, scope, { hours = null } = {}) {
  const params = [date, hoursParam(hours)];
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
       FROM (${REGISTER("$2::jsonb")}) v
      ${s.where}`,
    params,
  );
}

/** One person on the register for a date, with the day's extras. */
const registerRow = (db, date, employeeId, { hours = null } = {}) =>
  one(
    db,
    `SELECT ${REGISTER_OUT}, v.early_minutes, v.overtime_minutes, v.closed_at, v.expected_radius_m, v.employee_id
       FROM (${REGISTER("$3::jsonb")}) v WHERE v.employee_id = $2`,
    [date, employeeId, hoursParam(hours)],
  );

/**
 * A day's id, an exception's, a pay item's, a rule breach's (its last day) or an overtime
 * approval's, to the person and the day it is about: what a link to any of them opens.
 */
const recordRef = (db, id) =>
  one(
    db,
    `SELECT ad.attendance_day_id, NULL::uuid AS attendance_exception_id, ad.employee_id, ad.attendance_date AS date
       FROM attendance_day ad WHERE ad.attendance_day_id = $1
     UNION ALL
     SELECT ad.attendance_day_id, x.attendance_exception_id, ad.employee_id, ad.attendance_date AS date
       FROM attendance_exception x JOIN attendance_day ad ON ad.attendance_day_id = x.attendance_day_id
      WHERE x.attendance_exception_id = $1
     UNION ALL
     SELECT ad.attendance_day_id, NULL::uuid, ad.employee_id, ad.attendance_date
       FROM attendance_pay_item pi
       JOIN attendance_day ad ON ad.employee_id = pi.employee_id AND ad.attendance_date = pi.work_date
      WHERE pi.attendance_pay_item_id = $1
     UNION ALL
     SELECT ad.attendance_day_id, NULL::uuid, ad.employee_id, ad.attendance_date
       FROM attendance_rule_breach b
       JOIN attendance_day ad ON ad.employee_id = b.employee_id AND ad.attendance_date = b.last_day
      WHERE b.attendance_rule_breach_id = $1
     UNION ALL
     SELECT ad.attendance_day_id, NULL::uuid, ad.employee_id, ad.attendance_date
       FROM attendance_overtime_approval oa
       JOIN attendance_day ad ON ad.employee_id = oa.employee_id AND ad.attendance_date = oa.work_date
      WHERE oa.attendance_overtime_approval_id = $1
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

/**
 * The people at work on a date whose own day it is worked, with a login, who have no day for it
 * (EXPECTED_ON: their schedule, else the company hours `hours` in force that date, a jsonb
 * parameter): the day-close closes each (someone with no login is never expected, §6.4).
 */
async function withoutDay(db, date, { hours = null } = {}) {
  // pagination:complete the day-close must see every person expected that day
  const { rows } = await completeQuery(
    db,
    `SELECT e.employee_id
       FROM employee e
      WHERE e.status = 'active' AND (e.start_date IS NULL OR e.start_date <= $1::date)
        AND (e.left_on IS NULL OR e.left_on > $1::date)
        AND ${EXPECTED_ON("e.employee_id", "$1::date", "$2::jsonb")}
        AND NOT EXISTS (SELECT 1 FROM attendance_day ad
                         WHERE ad.employee_id = e.employee_id AND ad.attendance_date = $1::date)
      ORDER BY e.employee_id`,
    [date, hoursParam(hours)],
    { label: "people with no attendance day" },
  );
  return rows;
}

/* ------------------------------------------------------------------ *
 * The clock watch (attendance.clock-watch.js, §6.14)
 * ------------------------------------------------------------------ */

/**
 * The people a clock-in reminder may be due to on a date: at work (active, started, not left),
 * expected that day by their own schedule with a login to tell (EXPECTED_ON, the company hours
 * `hours` in force a jsonb parameter), not on granted leave, with no clock-in that counts and no
 * reminder yet; with their active logins, whose presence decides whether the push or the app's
 * prompt reaches them. The watch checks each one's own start.
 */
async function dueForReminder(db, date, { hours = null } = {}) {
  // pagination:complete the watch reminds everyone who is due, not a page of them
  const { rows } = await completeQuery(
    db,
    `SELECT e.employee_id,
            ARRAY(SELECT u.user_id FROM app_user u
                   WHERE u.employee_id = e.employee_id AND u.status = 'active' ORDER BY u.user_id) AS user_ids
       FROM employee e
      WHERE e.status = 'active' AND (e.start_date IS NULL OR e.start_date <= $1::date)
        AND (e.left_on IS NULL OR e.left_on > $1::date)
        AND ${EXPECTED_ON("e.employee_id", "$1::date", "$2::jsonb")}
        AND NOT ${GRANTED_LEAVE("e.employee_id", "$1::date")}
        AND NOT EXISTS (SELECT 1 FROM attendance_event ev
                         WHERE ev.employee_id = e.employee_id AND ev.work_date = $1::date
                           AND ev.event_type = 'clock_in' AND ev.validation_state IN ('accepted', 'review')
                           AND NOT ${EXCLUDED("ev")})
        AND NOT EXISTS (SELECT 1 FROM attendance_clock_reminder r
                         WHERE r.employee_id = e.employee_id AND r.work_date = $1::date AND r.kind = 'clock_in_due')
      ORDER BY e.employee_id`,
    [date, hoursParam(hours)],
    { label: "people due a clock-in reminder" },
  );
  return rows;
}

/**
 * Whether the session is the first the person signed in with on `date` (Lagos): the earliest
 * user_session issued that day is theirs. A session kept alive since yesterday, or a second
 * device that day, is not. One indexed read of identity's sessions (§6.14, the sign-in prompt).
 * @param {{user_id: string, session_id?: string}} user  req.user (auth sets session_id)
 */
async function firstSessionOn(db, user, date) {
  if (!user.session_id) return false;
  const row = await one(
    db,
    `SELECT s.session_id
       FROM user_session s
      WHERE s.user_id = $1 AND s.issued_at >= $2::timestamptz AND s.issued_at < $3::timestamptz
      ORDER BY s.issued_at, s.session_id
      LIMIT 1`,
    [user.user_id, lagos.startOfDay(date), lagos.endOfDayExclusive(date)],
  );
  return Boolean(row) && row.session_id === user.session_id;
}

/**
 * Record a reminder as sent, once: null when it already was. The reminder to clock in is slot 0;
 * each reminder to clock out has its slot (1, 2, 3 ...) and its time (§6.14).
 */
function recordReminder(client, employeeId, date, kind, { slot = 0, dueAt = null } = {}) {
  return one(
    client,
    `INSERT INTO attendance_clock_reminder (employee_id, work_date, kind, slot, due_at)
     VALUES ($1, $2::date, $3, $4, $5)
     ON CONFLICT (employee_id, work_date, kind, slot) DO NOTHING
     RETURNING attendance_clock_reminder_id, employee_id, work_date::text AS work_date, kind, slot`,
    [employeeId, date, kind, slot, dueAt],
  );
}

/** The reminders of a kind sent to a person for a date, oldest first (a handful a day). */
async function remindersOn(db, employeeId, date, kind) {
  // pagination:complete one person's reminders of one day: one to clock in, a few to clock out
  const { rows } = await completeQuery(
    db,
    `SELECT attendance_clock_reminder_id, slot FROM attendance_clock_reminder
      WHERE employee_id = $1 AND work_date = $2::date AND kind = $3
      ORDER BY slot`,
    [employeeId, date, kind],
    { label: "a day's reminders", ceiling: 50 },
  );
  return rows;
}

/** The reminder sent to a person for a date, or null (the reminder to clock in). */
async function reminderOn(db, employeeId, date, kind) {
  return (await remindersOn(db, employeeId, date, kind))[0] || null;
}

/**
 * Shifts still open on work dates from `from` to `to`: a clock-in that counts, no clock-out that
 * counts (one People rejected leaves the shift open, §6.2), and a day not closed; with the person's active logins, whose presence decides whether a reminder to
 * clock out is a push or the app's closing prompt.
 */
async function openShifts(db, from, to) {
  // pagination:complete the watch closes every open shift it may, not a page of them
  const { rows } = await completeQuery(
    db,
    `SELECT ev.employee_id, ev.work_date::text AS work_date, ev.occurred_at AS clock_in_at,
            ARRAY(SELECT u.user_id FROM app_user u
                   WHERE u.employee_id = ev.employee_id AND u.status = 'active' ORDER BY u.user_id) AS user_ids
       FROM attendance_event ev
       JOIN employee e ON e.employee_id = ev.employee_id AND e.status = 'active'
       LEFT JOIN attendance_day ad ON ad.employee_id = ev.employee_id AND ad.attendance_date = ev.work_date
      WHERE ev.event_type = 'clock_in' AND ev.validation_state IN ('accepted', 'review')
        AND ev.work_date BETWEEN $1::date AND $2::date
        AND ad.closed_at IS NULL
        AND NOT ${EXCLUDED("ev")}
        AND NOT EXISTS (SELECT 1 FROM attendance_event o
                         WHERE o.employee_id = ev.employee_id AND o.work_date = ev.work_date
                           AND o.event_type = 'clock_out' AND o.validation_state IN ('accepted', 'review')
                           AND NOT ${EXCLUDED("o")})
      ORDER BY ev.work_date, ev.employee_id`,
    [from, to],
    { label: "open shifts" },
  );
  return rows;
}

/** One punch, with whether the day counts it, for the person's explanation of an automatic one. */
function eventFor(db, eventId) {
  return one(
    db,
    `SELECT ev.attendance_event_id, ev.employee_id, ev.event_type, ev.source, ev.validation_state,
            ev.work_date::text AS work_date, ev.occurred_at, ${EXCLUDED("ev")} AS excluded,
            ev.validation #>> '{time,timezone}' AS timezone, ad.attendance_day_id
       FROM attendance_event ev
       LEFT JOIN attendance_day ad ON ad.employee_id = ev.employee_id AND ad.attendance_date = ev.work_date
      WHERE ev.attendance_event_id = $1`,
    [eventId],
  );
}

/** Whether a punch already has an exception of a type (open or decided). */
async function hasException(db, eventId, type) {
  const r = await one(
    db,
    "SELECT 1 AS ok FROM attendance_exception WHERE attendance_event_id = $1 AND exception_type = $2",
    [eventId, type],
  );
  return Boolean(r);
}


/* ------------------------------------------------------------------ *
 * Home locations (attendance.home.js)
 * ------------------------------------------------------------------ */

const HOME = `h.attendance_home_id, h.employee_id, h.status, h.address, h.latitude::float8 AS latitude,
  h.longitude::float8 AS longitude, h.accuracy_m::float8 AS accuracy_m, h.requested_at, h.decided_at,
  h.decision_reason`;

/** The person's approved home, the fence a remote punch is judged against, or null. */
function approvedHome(db, employeeId) {
  return one(db, `SELECT ${HOME} FROM attendance_home h WHERE h.employee_id = $1 AND h.status = 'approved'`, [
    employeeId,
  ]);
}

/**
 * The person's homes as My Attendance shows them: the approved one, the one waiting, and the
 * newest request when People rejected it (until the person sends another).
 */
async function homesOf(db, employeeId) {
  // One after the other: `db` may be a transaction's client, which runs one query at a time.
  const approved = await approvedHome(db, employeeId);
  const pending = await one(db, `SELECT ${HOME} FROM attendance_home h WHERE h.employee_id = $1 AND h.status = 'pending'`, [
    employeeId,
  ]);
  const newest = await one(
    db,
    `SELECT ${HOME} FROM attendance_home h WHERE h.employee_id = $1
      ORDER BY h.requested_at DESC, h.attendance_home_id DESC LIMIT 1`,
    [employeeId],
  );
  return { approved, pending, rejected: newest && newest.status === "rejected" ? newest : null };
}

/** A request still waiting stops waiting: the newer one replaces it. */
function supersedePending(client, employeeId) {
  return client.query(
    "UPDATE attendance_home SET status = 'superseded' WHERE employee_id = $1 AND status = 'pending'",
    [employeeId],
  );
}

function insertHome(client, h) {
  return one(
    client,
    `INSERT INTO attendance_home (employee_id, address, latitude, longitude, accuracy_m, requested_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${HOME.replace(/h\./g, "")}`,
    [h.employee_id, h.address, h.latitude, h.longitude, h.accuracy_m, h.requested_by],
  );
}

/** One home location with its owner, locked for a decision when `forUpdate`. */
function getHome(db, id, { forUpdate = false } = {}) {
  return one(
    db,
    `SELECT ${HOME} FROM attendance_home h WHERE h.attendance_home_id = $1${forUpdate ? " FOR UPDATE" : ""}`,
    [id],
  );
}

/** Approve: the home in force before it is superseded, then this one is approved. */
async function approveHome(client, id, employeeId, by) {
  await client.query(
    "UPDATE attendance_home SET status = 'superseded' WHERE employee_id = $1 AND status = 'approved'",
    [employeeId],
  );
  return one(
    client,
    `UPDATE attendance_home SET status = 'approved', decided_by = $2, decided_at = now()
      WHERE attendance_home_id = $1 AND status = 'pending' RETURNING attendance_home_id`,
    [id, by],
  );
}

function rejectHome(client, id, by, reason) {
  return one(
    client,
    `UPDATE attendance_home SET status = 'rejected', decided_by = $2, decided_at = now(), decision_reason = $3
      WHERE attendance_home_id = $1 AND status = 'pending' RETURNING attendance_home_id`,
    [id, by, reason],
  );
}

const HOME_SORTS = {
  waiting: "(h.status = 'pending') DESC, h.requested_at DESC",
  requested_at: "h.requested_at",
};

/**
 * Home locations as People read them. `$1` says whether the address and the point travel
 * (scope all); the request's point and the approved home's come along for the distance and
 * are dropped by the service.
 */
const HOME_ROWS = (extra = "") => `SELECT h.attendance_home_id, ${PERSON()} AS employee, h.status,
            CASE WHEN $1::boolean THEN h.address END AS home_address,
            CASE WHEN $1::boolean THEN h.latitude::float8 END AS home_latitude,
            CASE WHEN $1::boolean THEN h.longitude::float8 END AS home_longitude,
            h.accuracy_m::float8 AS accuracy_m, h.requested_at, h.decided_at,
            ${nameOf("de")} AS decided_by_name, h.decision_reason,
            h.latitude::float8 AS point_latitude, h.longitude::float8 AS point_longitude,
            ap.latitude::float8 AS approved_latitude, ap.longitude::float8 AS approved_longitude${extra}
       FROM attendance_home h
       JOIN employee e ON e.employee_id = h.employee_id
       LEFT JOIN department d ON d.department_id = e.department_id
       LEFT JOIN app_user du ON du.user_id = h.decided_by
       LEFT JOIN employee de ON de.employee_id = du.employee_id
       LEFT JOIN attendance_home ap
         ON ap.employee_id = h.employee_id AND ap.status = 'approved' AND ap.attendance_home_id <> h.attendance_home_id`;

/** A page of home locations within the reader's scope, waiting first. */
function listHomes(db, query, scope, { place }) {
  const params = [Boolean(place), query.status || null, query.employee_id || null, query.q || null];
  const s = scopeClause(scope, { column: "h.employee_id" }, params);
  return pageQuery(
    db,
    `${HOME_ROWS(`, ${TOTAL_COL}`)}
      WHERE ($2::text IS NULL OR h.status = $2)
        AND ($3::uuid IS NULL OR h.employee_id = $3)
        AND ($4::text IS NULL OR search_fold(e.first_name || ' ' || e.last_name || ' ' || COALESCE(e.preferred_name, ''))
                                  LIKE '%' || search_fold($4) || '%')
        ${s.and}
      ORDER BY ${orderBy(query, HOME_SORTS, "h.attendance_home_id")}`,
    params,
    query,
  );
}

/** One home location as People read it (the caller checked the scope). */
function homeRow(db, id, { place }) {
  return one(db, `${HOME_ROWS()} WHERE h.attendance_home_id = $2`, [Boolean(place), id]);
}

/* ------------------------------------------------------------------ *
 * Work location requests (attendance.requests.js)
 * ------------------------------------------------------------------ */

const REQUEST = `r.location_request_id, r.number, r.employee_id, r.request_type, r.starts_on, r.ends_on,
  r.address, r.latitude::float8 AS latitude, r.longitude::float8 AS longitude, r.accuracy_m::float8 AS accuracy_m,
  r.site_latitude::float8 AS site_latitude, r.site_longitude::float8 AS site_longitude, r.site_radius_m,
  r.reason, r.status, r.workflow_instance_id`;

/** The approved request covering a person's work date, if any (two never overlap, §6.11). */
function approvedRequestOn(db, employeeId, date) {
  return one(
    db,
    `SELECT ${REQUEST} FROM attendance_location_request r
      WHERE r.employee_id = $1 AND r.status = 'approved' AND r.starts_on <= $2::date AND r.ends_on >= $2::date
      ORDER BY r.starts_on LIMIT 1`,
    [employeeId, date],
  );
}

/** One request's own columns, without the person or the approval. */
function getRequest(db, id) {
  return one(db, `SELECT ${REQUEST} FROM attendance_location_request r WHERE r.location_request_id = $1`, [id]);
}

/** Copy an approval's outcome onto a request still waiting; null when it was not waiting. */
function settleRequest(client, id, status) {
  return one(
    client,
    `UPDATE attendance_location_request
        SET status = $2,
            decided_at = CASE WHEN $2 = 'cancelled' THEN decided_at ELSE now() END,
            cancelled_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE cancelled_at END
      WHERE location_request_id = $1 AND status = 'submitted'
      RETURNING location_request_id, employee_id, number`,
    [id, status],
  );
}

/** The person cancels a request still waiting or approved; null when it was neither. */
function cancelRequest(client, id, reason) {
  return one(
    client,
    `UPDATE attendance_location_request SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2
      WHERE location_request_id = $1 AND status IN ('submitted', 'approved')
      RETURNING location_request_id`,
    [id, reason || null],
  );
}

const REQUEST_SORTS = {
  waiting: "(r.status = 'submitted') DESC, r.requested_at DESC",
  starts_on: "r.starts_on",
  requested_at: "r.requested_at",
};

/**
 * Requests as the screens read them. `$1` says whether a temporary home's point travels; `reader`
 * (People's lists) works out whether the stage each one waits at names the reader, else none does.
 */
async function requestRows(db, { place, reader }, params) {
  params.push(Boolean(place));
  const placeParam = `$${params.length}`;
  let canDecide = "false";
  if (reader && reader.approves) {
    const roleCodes = await approvers.roleCodesOf(db, reader.user.role_ids || []);
    canDecide = `(wi.state = 'pending' AND ${approvers.waitingOnClause("wi", reader.user, roleCodes, params)})`;
  }
  return `SELECT r.location_request_id, r.number, ${PERSON()} AS employee, r.request_type, r.starts_on, r.ends_on,
            (r.ends_on - r.starts_on + 1)::int AS days, r.address,
            CASE WHEN ${placeParam}::boolean THEN r.latitude::float8 END AS home_latitude,
            CASE WHEN ${placeParam}::boolean THEN r.longitude::float8 END AS home_longitude,
            r.accuracy_m::float8 AS accuracy_m, r.site_latitude::float8 AS site_latitude,
            r.site_longitude::float8 AS site_longitude, r.site_radius_m,
            r.reason, r.status, r.workflow_instance_id,
            CASE WHEN wi.state = 'pending' THEN (
              SELECT min(st ->> 'name') FROM workflow_definition wd, jsonb_array_elements(wd.stages) st
               WHERE wd.workflow_definition_id = wi.workflow_definition_id AND st ->> 'key' = wi.current_stage
            ) END AS waiting_on,
            ${canDecide} AS can_decide,
            r.requested_at, r.decided_at, r.cancelled_at, r.cancel_reason`;
}

const REQUEST_FROM = `
       FROM attendance_location_request r
       JOIN employee e ON e.employee_id = r.employee_id
       LEFT JOIN department d ON d.department_id = e.department_id
       LEFT JOIN workflow_instance wi ON wi.workflow_instance_id = r.workflow_instance_id`;

/** A page of requests within the reader's scope, waiting first (the person's own: newest first). */
async function listRequests(db, query, scope, { place, reader, mine = false }) {
  const params = [query.status || null, query.request_type || null, query.employee_id || null, query.q || null];
  const select = await requestRows(db, { place, reader }, params);
  const s = scopeClause(scope, { column: "r.employee_id" }, params);
  const sorts = mine
    ? { requested_at: "r.requested_at DESC", starts_on: REQUEST_SORTS.starts_on }
    : REQUEST_SORTS;
  return pageQuery(
    db,
    `${select}, ${TOTAL_COL}
     ${REQUEST_FROM}
      WHERE ($1::text IS NULL OR r.status = $1)
        AND ($2::text IS NULL OR r.request_type = $2)
        AND ($3::uuid IS NULL OR r.employee_id = $3)
        AND ($4::text IS NULL OR search_fold(r.number || ' ' || e.first_name || ' ' || e.last_name || ' '
                                             || COALESCE(e.preferred_name, '')) LIKE '%' || search_fold($4) || '%')
        ${s.and}
      ORDER BY ${orderBy(query, sorts, "r.location_request_id")}`,
    params,
    query,
  );
}

/** One request as a screen reads it (the caller checked the scope). */
async function requestRow(db, id, { place, reader }) {
  const params = [id];
  const select = await requestRows(db, { place, reader }, params);
  return one(db, `${select} ${REQUEST_FROM} WHERE r.location_request_id = $1`, params);
}

/* ------------------------------------------------------------------ *
 * Field assignments (attendance.assignments.js)
 * ------------------------------------------------------------------ */

/** An assignment's sites as JSON, in position order. */
const SITES = (alias) => `COALESCE((
  SELECT json_agg(json_build_object('field_site_id', fs.field_site_id, 'position', fs.position, 'name', fs.name,
           'address', fs.address, 'latitude', fs.latitude::float8, 'longitude', fs.longitude::float8,
           'radius_m', fs.radius_m) ORDER BY fs.position)
    FROM attendance_field_site fs WHERE fs.field_assignment_id = ${alias}.field_assignment_id), '[]'::json)`;

/** The active assignment a person is still on for a work date, with its sites (one a day, §6.12). */
function fieldAssignmentOn(db, employeeId, date) {
  return one(
    db,
    `SELECT a.field_assignment_id, a.number, a.name, ${SITES("a")} AS sites
       FROM attendance_field_assignment a
       JOIN attendance_field_member m ON m.field_assignment_id = a.field_assignment_id
      WHERE m.employee_id = $1 AND m.removed_at IS NULL AND a.status = 'active'
        AND a.starts_on <= $2::date AND a.ends_on >= $2::date
      ORDER BY a.starts_on LIMIT 1`,
    [employeeId, date],
  );
}

/** An assignment's own columns and who is still on it (sorted); locked when `forUpdate`. */
function getAssignment(db, id, { forUpdate = false } = {}) {
  return one(
    db,
    `SELECT a.field_assignment_id, a.number, a.name, a.starts_on, a.ends_on, a.status,
            ARRAY(SELECT m.employee_id FROM attendance_field_member m
                   WHERE m.field_assignment_id = a.field_assignment_id AND m.removed_at IS NULL
                   ORDER BY m.employee_id) AS active_ids,
            ARRAY(SELECT m.employee_id FROM attendance_field_member m
                   WHERE m.field_assignment_id = a.field_assignment_id ORDER BY m.employee_id) AS member_ids
       FROM attendance_field_assignment a WHERE a.field_assignment_id = $1${forUpdate ? " FOR UPDATE OF a" : ""}`,
    [id],
  );
}

/** Cancel an active assignment; null when it was not active. */
function cancelAssignment(client, id, userId, reason) {
  return one(
    client,
    `UPDATE attendance_field_assignment
        SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3
      WHERE field_assignment_id = $1 AND status = 'active'
      RETURNING field_assignment_id`,
    [id, userId, reason],
  );
}

/** Take one person off; null when they were not on it. */
function removeMember(client, id, employeeId, userId, reason) {
  return one(
    client,
    `UPDATE attendance_field_member SET removed_at = now(), removed_by = $3, removed_reason = $4
      WHERE field_assignment_id = $1 AND employee_id = $2 AND removed_at IS NULL
      RETURNING employee_id`,
    [id, employeeId, userId, reason],
  );
}

/** Where an assignment stands on the date `today` (a param), as the contract's FieldAssignmentState. */
const STATE = (today) => `CASE WHEN a.status = 'cancelled' THEN 'cancelled'
  WHEN a.starts_on > ${today}::date THEN 'upcoming'
  WHEN a.ends_on < ${today}::date THEN 'done' ELSE 'in_progress' END`;

/**
 * Assignments as the screens read them. `changer` is the reader's `people` approve scope (null when
 * they hold none): they may change an assignment that is active, not over, and has everyone still
 * on it within that scope.
 */
function assignmentSelect(params, { today, changer }) {
  params.push(today);
  const t = `$${params.length}`;
  let canChange = "false";
  if (changer) {
    const open = `(a.status = 'active' AND a.ends_on >= ${t}::date)`;
    if (changer.scope === "all") canChange = open;
    else {
      params.push(changer.scope_ids || []);
      canChange = `(${open} AND NOT EXISTS (
        SELECT 1 FROM attendance_field_member mc
         WHERE mc.field_assignment_id = a.field_assignment_id AND mc.removed_at IS NULL
           AND NOT (mc.employee_id = ANY($${params.length}::uuid[]))))`;
    }
  }
  return {
    today: t,
    sql: `SELECT a.field_assignment_id, a.number, a.name, a.client, a.note, a.starts_on, a.ends_on,
            (a.ends_on - a.starts_on + 1)::int AS days, a.status, ${STATE(t)} AS state,
            ${SITES("a")} AS sites,
            COALESCE((
              SELECT json_agg(json_build_object('employee', ${PERSON("me", "md")}, 'added_at', m.added_at,
                       'removed_at', m.removed_at, 'removed_reason', m.removed_reason)
                       ORDER BY m.removed_at NULLS FIRST, me.last_name, me.first_name)
                FROM attendance_field_member m
                JOIN employee me ON me.employee_id = m.employee_id
                LEFT JOIN department md ON md.department_id = me.department_id
               WHERE m.field_assignment_id = a.field_assignment_id), '[]'::json) AS members,
            (SELECT count(*)::int FROM attendance_field_member mp
              WHERE mp.field_assignment_id = a.field_assignment_id AND mp.removed_at IS NULL) AS people,
            (SELECT btrim(ue.first_name || ' ' || ue.last_name) FROM app_user u
               JOIN employee ue ON ue.employee_id = u.employee_id WHERE u.user_id = a.assigned_by) AS assigned_by_name,
            a.assigned_at, a.cancelled_at, a.cancel_reason, ${canChange} AS can_change`,
  };
}

const ASSIGNMENT_SORTS = {
  current: `CASE ${STATE("$__today")} WHEN 'in_progress' THEN 0 WHEN 'upcoming' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,
            CASE WHEN a.ends_on < $__today::date THEN NULL ELSE a.starts_on END, a.ends_on DESC`,
  starts_on: "a.starts_on",
};

/**
 * A page of assignments: with anyone in `scope` on them (People's), or the person's own (`mine`,
 * every one they are or were on). In progress and upcoming first.
 */
function listAssignments(db, query, scope, { today, changer, mine = null }) {
  const params = [query.state || null, query.employee_id || null, query.q || null];
  const { sql, today: t } = assignmentSelect(params, { today, changer });
  let who;
  if (mine) {
    params.push(mine);
    who = `AND EXISTS (SELECT 1 FROM attendance_field_member mv
                        WHERE mv.field_assignment_id = a.field_assignment_id AND mv.employee_id = $${params.length})`;
  } else {
    const s = scopeClause(scope, { column: "mv.employee_id" }, params);
    who = `AND EXISTS (SELECT 1 FROM attendance_field_member mv
                        WHERE mv.field_assignment_id = a.field_assignment_id ${s.and})`;
  }
  const sorts = Object.fromEntries(Object.entries(ASSIGNMENT_SORTS).map(([k, v]) => [k, v.split("$__today").join(t)]));
  return pageQuery(
    db,
    `${sql}, ${TOTAL_COL}
       FROM attendance_field_assignment a
      WHERE ($1::text IS NULL OR ${STATE(t)} = $1)
        AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM attendance_field_member mf
                                          WHERE mf.field_assignment_id = a.field_assignment_id AND mf.employee_id = $2))
        AND ($3::text IS NULL OR search_fold(a.number || ' ' || a.name || ' ' || a.client || ' ' || COALESCE((
              SELECT string_agg(mq.first_name || ' ' || mq.last_name || ' ' || COALESCE(mq.preferred_name, ''), ' ')
                FROM attendance_field_member mm JOIN employee mq ON mq.employee_id = mm.employee_id
               WHERE mm.field_assignment_id = a.field_assignment_id), '')) LIKE '%' || search_fold($3) || '%')
        ${who}
      ORDER BY ${orderBy(query, sorts, "a.field_assignment_id")}`,
    params,
    query,
  );
}

/** One assignment as a screen reads it (the caller checked who may see it). */
function assignmentRow(db, id, { today, changer }) {
  const params = [id];
  const { sql } = assignmentSelect(params, { today, changer });
  return one(db, `${sql} FROM attendance_field_assignment a WHERE a.field_assignment_id = $1`, params);
}

/* ------------------------------------------------------------------ *
 * Work schedules (attendance.schedule.js, §6.13)
 * ------------------------------------------------------------------ */

const SCHEDULE = `s.attendance_work_schedule_id, s.employee_id, s.days, s.effective_from::text AS effective_from,
  s.reason, s.set_at,
  (SELECT btrim(se.first_name || ' ' || se.last_name) FROM app_user su
     JOIN employee se ON se.employee_id = su.employee_id WHERE su.user_id = s.set_by) AS set_by_name`;

/** The schedule in force for a person on a date: the latest that started by then, or null. */
function workScheduleOn(db, employeeId, date) {
  return one(
    db,
    `SELECT ${SCHEDULE} FROM attendance_work_schedule s
      WHERE s.employee_id = $1 AND s.effective_from <= $2::date
      ORDER BY s.effective_from DESC LIMIT 1`,
    [employeeId, date],
  );
}

/** The next schedule waiting to start after a date, or null. */
function workScheduleAfter(db, employeeId, date) {
  return one(
    db,
    `SELECT ${SCHEDULE} FROM attendance_work_schedule s
      WHERE s.employee_id = $1 AND s.effective_from > $2::date
      ORDER BY s.effective_from LIMIT 1`,
    [employeeId, date],
  );
}

/** A schedule by its id, or null (the one a day was judged by). */
function workSchedule(db, id) {
  return one(db, `SELECT ${SCHEDULE} FROM attendance_work_schedule s WHERE s.attendance_work_schedule_id = $1`, [id]);
}

/**
 * The schedules that can be in force on some day from `from` to `to`: the one in force on `from`
 * and those starting after it by `to`, oldest first. A month holds a handful at most.
 */
async function workSchedulesBetween(db, employeeId, from, to) {
  // pagination:complete one person's schedules over at most a month, read whole to work out each day
  const { rows } = await completeQuery(
    db,
    `SELECT ${SCHEDULE} FROM attendance_work_schedule s
      WHERE s.employee_id = $1
        AND (s.effective_from > $2::date AND s.effective_from <= $3::date
             OR s.effective_from = (SELECT max(m.effective_from) FROM attendance_work_schedule m
                                     WHERE m.employee_id = $1 AND m.effective_from <= $2::date))
      ORDER BY s.effective_from`,
    [employeeId, from, to],
    { label: "a person's schedules in a month", ceiling: 40 },
  );
  return rows;
}

/** Set a schedule from its first day; one from the same first day is replaced. */
function upsertWorkSchedule(client, x) {
  return one(
    client,
    `INSERT INTO attendance_work_schedule (employee_id, days, effective_from, reason, set_by)
     VALUES ($1, $2::jsonb, $3, $4, $5)
     ON CONFLICT (employee_id, effective_from)
       DO UPDATE SET days = EXCLUDED.days, reason = EXCLUDED.reason, set_by = EXCLUDED.set_by, set_at = now()
     RETURNING attendance_work_schedule_id`,
    [x.employee_id, JSON.stringify(x.days), x.effective_from, x.reason, x.set_by],
  );
}

/* ------------------------------------------------------------------ *
 * What the consequence rules count (attendance.rules-engine.js, §6.16)
 * ------------------------------------------------------------------ */

/** One person's dated events of a rule between two dates, read whole: a period is at most a month. */
async function ruleEvents(db, label, sql, params) {
  // pagination:complete one person's late, early, absent, forgotten or flagged days in one period
  const { rows } = await completeQuery(db, sql, params, { label, ceiling: 500 });
  return rows.map((r) => ({ date: r.date, value: Number(r.value) || 0 }));
}

/** The days recorded late, with their late minutes. */
const lateDays = (db, employeeId, from, to) =>
  ruleEvents(
    db,
    "a person's late days",
    `SELECT ad.attendance_date::text AS date, ad.late_minutes AS value FROM attendance_day ad
      WHERE ad.employee_id = $1 AND ad.status = 'late' AND ad.attendance_date BETWEEN $2::date AND $3::date
      ORDER BY ad.attendance_date`,
    [employeeId, from, to],
  );

/** The days with early minutes, and those minutes. */
const earlyDays = (db, employeeId, from, to) =>
  ruleEvents(
    db,
    "a person's early days",
    `SELECT ad.attendance_date::text AS date, ad.early_minutes AS value FROM attendance_day ad
      WHERE ad.employee_id = $1 AND ad.early_minutes > 0 AND ad.status IN ('present', 'late')
        AND ad.attendance_date BETWEEN $2::date AND $3::date
      ORDER BY ad.attendance_date`,
    [employeeId, from, to],
  );

/** The days closed absent. */
const absentDays = (db, employeeId, from, to) =>
  ruleEvents(
    db,
    "a person's absent days",
    `SELECT ad.attendance_date::text AS date, 0 AS value FROM attendance_day ad
      WHERE ad.employee_id = $1 AND ad.status = 'absent' AND ad.attendance_date BETWEEN $2::date AND $3::date
      ORDER BY ad.attendance_date`,
    [employeeId, from, to],
  );

/** The days with a system clock-out that counts, or the day-close's missing clock-out: once a day. */
const forgottenDays = (db, employeeId, from, to) =>
  ruleEvents(
    db,
    "a person's forgotten clock-outs",
    `SELECT ad.attendance_date::text AS date, 0 AS value FROM attendance_day ad
      WHERE ad.employee_id = $1 AND ad.attendance_date BETWEEN $2::date AND $3::date
        AND (${CLOCK_OUT_AUTOMATIC("ad")}
             OR EXISTS (SELECT 1 FROM attendance_exception mx
                         WHERE mx.attendance_day_id = ad.attendance_day_id AND mx.attendance_event_id IS NULL
                           AND mx.exception_type = 'missing_clock_out'))
      ORDER BY ad.attendance_date`,
    [employeeId, from, to],
  );

/**
 * The outside exceptions that count as Location Flags (§6.16, gap m), each dated by its day: one on a
 * punch refused at the clock counts while open or accepted (Accept keeps the refusal); every other
 * one while open or rejected. Read from attendance_exception, so a refused punch's exception (PR 2)
 * and a check-in's (PR 4, no event) count with no change here.
 */
const locationFlags = (db, employeeId, from, to) =>
  ruleEvents(
    db,
    "a person's location flags",
    `SELECT ad.attendance_date::text AS date, 0 AS value
       FROM attendance_exception x
       JOIN attendance_day ad ON ad.attendance_day_id = x.attendance_day_id
       LEFT JOIN attendance_event ev ON ev.attendance_event_id = x.attendance_event_id
      WHERE ad.employee_id = $1 AND ad.attendance_date BETWEEN $2::date AND $3::date
        AND x.exception_type IN ('outside_worksite', 'outside_home')
        AND CASE WHEN ev.validation_state = 'rejected' THEN x.status = 'open' OR x.outcome = 'accepted'
                 ELSE x.status = 'open' OR x.outcome = 'rejected' END
      ORDER BY ad.attendance_date, x.created_at`,
    [employeeId, from, to],
  );

const BREACH = `b.attendance_rule_breach_id, b.employee_id, b.rule, b.policy_version_id, b.period,
  b.period_start::text AS period_start, b.period_end::text AS period_end, b.count, b.minutes, b.reached,
  ARRAY(SELECT d::text FROM unnest(b.days) AS d ORDER BY d) AS days, b.last_day::text AS last_day,
  b.alert, b.raise_query, b.breached_at, b.home_alert_id`;

/** The person's latest breach of a rule whose last day falls on or after `from`, or null. */
function latestBreach(db, employeeId, rule, from) {
  return one(
    db,
    `SELECT ${BREACH} FROM attendance_rule_breach b
      WHERE b.employee_id = $1 AND b.rule = $2 AND b.last_day >= $3::date
      ORDER BY b.last_day DESC LIMIT 1`,
    [employeeId, rule, from],
  );
}

/** Record a breach, once: null when the same one (person, rule, last day) is already there. */
function insertBreach(client, b) {
  return one(
    client,
    `INSERT INTO attendance_rule_breach
       (employee_id, rule, policy_version_id, period, period_start, period_end, count, minutes, reached,
        days, last_day, alert, raise_query)
     VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10::date[], $11::date, $12, $13)
     ON CONFLICT (employee_id, rule, last_day) DO NOTHING
     RETURNING attendance_rule_breach_id`,
    [
      b.employee_id,
      b.rule,
      b.policy_version_id,
      b.period,
      b.period_start,
      b.period_end,
      b.count,
      b.minutes,
      b.reached,
      b.days,
      b.last_day,
      b.alert,
      b.raise_query,
    ],
  );
}

const getBreach = (db, id) => one(db, `SELECT ${BREACH} FROM attendance_rule_breach b WHERE b.attendance_rule_breach_id = $1`, [id]);

/** Keep the Home alert a breach raised (after commit, attendance.raise_breach_alert). */
function setBreachAlert(client, id, alertId) {
  return client.query(
    "UPDATE attendance_rule_breach SET home_alert_id = $2 WHERE attendance_rule_breach_id = $1 AND home_alert_id IS NULL",
    [id, alertId],
  );
}

/* ------------------------------------------------------------------ *
 * Pending deductions and overtime (attendance.pay.js, §6.17)
 * ------------------------------------------------------------------ */

const PAY_ITEM = `pi.attendance_pay_item_id, pi.employee_id, pi.attendance_day_id, pi.work_date::text AS work_date, pi.kind,
  pi.minutes, pi.rest_day, pi.method, pi.amount::text AS amount, pi.policy_version_id, pi.status, pi.decided_by,
  pi.decided_at, pi.reason, pi.confirmed_minutes, pi.payroll_run_id, pi.created_at`;

/** A person's pay items for a date, by kind (at most four). */
async function payItemsOn(db, employeeId, date) {
  // pagination:complete at most one item of each of the four kinds for a person's day
  const { rows } = await completeQuery(
    db,
    `SELECT ${PAY_ITEM} FROM attendance_pay_item pi WHERE pi.employee_id = $1 AND pi.work_date = $2::date
      ORDER BY pi.kind`,
    [employeeId, date],
    { label: "a day's pay items", ceiling: 4 },
  );
  return rows;
}

/** One pay item, locked for a decision when `forUpdate`, or null. */
function getPayItem(db, id, { forUpdate = false } = {}) {
  return one(
    db,
    `SELECT ${PAY_ITEM} FROM attendance_pay_item pi WHERE pi.attendance_pay_item_id = $1${forUpdate ? " FOR UPDATE" : ""}`,
    [id],
  );
}

function insertPayItem(client, x) {
  return one(
    client,
    `INSERT INTO attendance_pay_item
       (employee_id, attendance_day_id, work_date, kind, minutes, rest_day, method, amount, policy_version_id,
        status, decided_at, reason, confirmed_minutes)
     VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8::numeric, $9, $10, CASE WHEN $10 <> 'pending' THEN now() END, $11, $12)
     ON CONFLICT (employee_id, work_date, kind) DO NOTHING
     RETURNING ${PAY_ITEM.replace(/pi\./g, "")}`,
    [
      x.employee_id,
      x.attendance_day_id,
      x.work_date,
      x.kind,
      x.minutes,
      Boolean(x.rest_day),
      x.method,
      x.amount,
      x.policy_version_id,
      x.status,
      x.reason || null,
      x.confirmed_minutes ?? null,
    ],
  );
}

/**
 * Change an item the system keeps (pending, or decided by the system): its figures follow the day,
 * and its status and reason as the method or the day say. Never one a person decided or payroll took.
 */
function updatePayItem(client, id, x) {
  return one(
    client,
    `UPDATE attendance_pay_item
        SET minutes = $2, rest_day = $3, method = $4, amount = $5::numeric, policy_version_id = $6, status = $7,
            reason = $8, confirmed_minutes = $9, attendance_day_id = COALESCE($10, attendance_day_id),
            decided_at = CASE WHEN $7 = 'pending' THEN NULL ELSE now() END
      WHERE attendance_pay_item_id = $1 AND decided_by IS NULL AND status <> 'in_run'
      RETURNING ${PAY_ITEM.replace(/pi\./g, "")}`,
    [
      id,
      x.minutes,
      Boolean(x.rest_day),
      x.method,
      x.amount,
      x.policy_version_id,
      x.status,
      x.reason || null,
      x.confirmed_minutes ?? null,
      x.attendance_day_id || null,
    ],
  );
}

/** A person's decision on a pending item: waived, confirmed (all or fewer minutes) or cut. */
function decidePayItem(client, id, { status, reason, confirmedMinutes = null, by }) {
  return one(
    client,
    `UPDATE attendance_pay_item
        SET status = $2, reason = $3, confirmed_minutes = $4, decided_by = $5, decided_at = now()
      WHERE attendance_pay_item_id = $1 AND status = 'pending'
      RETURNING ${PAY_ITEM.replace(/pi\./g, "")}`,
    [id, status, reason || null, confirmedMinutes, by],
  );
}

/** Confirmed overtime minutes in a month, other than one item's: what the monthly cap has left. */
async function confirmedOvertime(db, employeeId, from, to, exceptId = null) {
  const r = await one(
    db,
    `SELECT COALESCE(sum(COALESCE(pi.confirmed_minutes, pi.minutes)), 0)::int AS minutes
       FROM attendance_pay_item pi
      WHERE pi.employee_id = $1 AND pi.kind = 'overtime' AND pi.status IN ('confirmed', 'in_run')
        AND pi.work_date BETWEEN $2::date AND $3::date
        AND ($4::uuid IS NULL OR pi.attendance_pay_item_id <> $4::uuid)`,
    [employeeId, from, to, exceptId],
  );
  return r ? r.minutes : 0;
}

/** Pending first, then the newest day, unless sorted. */
const PAY_ITEM_SORTS = {
  queue: "(v.status = 'pending') DESC, v.work_date DESC",
  work_date: "v.work_date",
  minutes: "v.minutes",
};

/**
 * A page of pay items, filtered, within a scope. `reader` decides `can_decide`: their employee id
 * (never their own), whether their `people` approve reaches everyone, and the people it reaches.
 */
function listPayItems(db, query, scope, { reader, from = null, to = null } = {}) {
  const params = [
    query.group || null,
    query.kind || null,
    query.status || null,
    from,
    to,
    query.employee_id || null,
    query.q || null,
    reader.employee_id || null,
    reader.approve_all === true,
    reader.approve_ids || [],
  ];
  const s = scopeClause(scope, { column: "pi.employee_id" }, params);
  return pageQuery(
    db,
    `SELECT v.*, ${TOTAL_COL} FROM (
       SELECT ${PAY_ITEM}, ${PERSON()} AS employee, (e.gross_monthly IS NOT NULL) AS salary_set,
              ${nameOf("de")} AS decided_by_name,
              CASE WHEN pi.status <> 'pending' OR pi.employee_id = $8::uuid THEN false
                   WHEN pi.kind = 'overtime' THEN $9::boolean OR pi.employee_id = ANY($10::uuid[])
                   ELSE $9::boolean END AS can_decide,
              e.last_name, e.first_name
         FROM attendance_pay_item pi
         JOIN employee e ON e.employee_id = pi.employee_id
         LEFT JOIN department d ON d.department_id = e.department_id
         LEFT JOIN app_user du ON du.user_id = pi.decided_by
         LEFT JOIN employee de ON de.employee_id = du.employee_id
        WHERE ($1::text IS NULL OR ($1 = 'overtime') = (pi.kind = 'overtime'))
          AND ($2::text IS NULL OR pi.kind = $2)
          AND ($3::text IS NULL OR pi.status = $3)
          AND ($4::date IS NULL OR pi.work_date >= $4::date)
          AND ($5::date IS NULL OR pi.work_date <= $5::date)
          AND ($6::uuid IS NULL OR pi.employee_id = $6::uuid)
          AND ($7::text IS NULL OR search_fold(e.first_name || ' ' || e.last_name || ' ' || COALESCE(e.preferred_name, ''))
                                   LIKE '%' || search_fold($7) || '%')
          ${s.and}
     ) v
     ORDER BY ${orderBy(query, PAY_ITEM_SORTS, "v.attendance_pay_item_id")}`,
    params,
    query,
  );
}

/** Pay items by id with what the screens show (a waive's answer), in the order given. */
async function payItemsByIds(db, ids) {
  // pagination:complete the at most 25 items one waive names
  const { rows } = await completeQuery(
    db,
    `SELECT ${PAY_ITEM}, ${PERSON()} AS employee, (e.gross_monthly IS NOT NULL) AS salary_set,
            ${nameOf("de")} AS decided_by_name, false AS can_decide
       FROM attendance_pay_item pi
       JOIN employee e ON e.employee_id = pi.employee_id
       LEFT JOIN department d ON d.department_id = e.department_id
       LEFT JOIN app_user du ON du.user_id = pi.decided_by
       LEFT JOIN employee de ON de.employee_id = du.employee_id
      WHERE pi.attendance_pay_item_id = ANY($1::uuid[])
      ORDER BY array_position($1::uuid[], pi.attendance_pay_item_id)`,
    [ids],
    { label: "a waive's pay items", ceiling: 25 },
  );
  return rows;
}

/** The pay items a waive names, locked, in a stable order. */
async function lockPayItems(client, ids) {
  // pagination:complete the at most 25 items one waive names
  const { rows } = await completeQuery(
    client,
    `SELECT ${PAY_ITEM} FROM attendance_pay_item pi WHERE pi.attendance_pay_item_id = ANY($1::uuid[])
      ORDER BY pi.attendance_pay_item_id FOR UPDATE`,
    [ids],
    { label: "a waive's pay items", ceiling: 25 },
  );
  return rows;
}

/* ------------------------------------------------------------------ *
 * Overtime approved beforehand (§6.17, Pre-Approved)
 * ------------------------------------------------------------------ */

const APPROVAL = `oa.attendance_overtime_approval_id, oa.employee_id, oa.work_date::text AS work_date, oa.minutes,
  oa.reason, oa.approved_at, ${nameOf("ae")} AS approved_by_name`;
const APPROVAL_FROM = `attendance_overtime_approval oa
  LEFT JOIN app_user au ON au.user_id = oa.approved_by
  LEFT JOIN employee ae ON ae.employee_id = au.employee_id`;

/** The overtime approved for a person's day, or null. */
function overtimeApprovalOn(db, employeeId, date) {
  return one(db, `SELECT ${APPROVAL} FROM ${APPROVAL_FROM} WHERE oa.employee_id = $1 AND oa.work_date = $2::date`, [
    employeeId,
    date,
  ]);
}

/** Approve overtime for a day; the same person and day again replaces it. */
function upsertOvertimeApproval(client, x) {
  return one(
    client,
    `INSERT INTO attendance_overtime_approval (employee_id, work_date, minutes, approved_by, reason)
     VALUES ($1, $2::date, $3, $4, $5)
     ON CONFLICT (employee_id, work_date)
       DO UPDATE SET minutes = EXCLUDED.minutes, approved_by = EXCLUDED.approved_by, reason = EXCLUDED.reason,
                     approved_at = now()
     RETURNING attendance_overtime_approval_id`,
    [x.employee_id, x.work_date, x.minutes, x.approved_by, x.reason],
  );
}

/** Where each attendance address field keeps its readable line (shared/places/owners.js). */
const ADDRESS_LINE = {
  "attendance_home.address": "UPDATE attendance_home SET address = $2 WHERE attendance_home_id = $1",
  "attendance_location_request.address": "UPDATE attendance_location_request SET address = $2 WHERE location_request_id = $1",
  "attendance_field_site.address": "UPDATE attendance_field_site SET address = $2 WHERE field_site_id = $1",
};

/** Rewrite one record's address line (a place named by the places-name job, F27). */
function renameAddress(client, owner, key, line) {
  return client.query(ADDRESS_LINE[owner], [key, line]);
}

module.exports = {
  ADDRESS_LINE,
  renameAddress,
  COMPANY_WORKS,
  WORKS_ON,
  EXPECTED_ON,
  EXCLUDED,
  HAS_LOGIN,
  PLACE_REMOTE,
  lockEmployee,
  person,
  grantedLeave,
  leaveRequestDays,
  closedDaysBetween,
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
  dueForReminder,
  firstSessionOn,
  recordReminder,
  remindersOn,
  reminderOn,
  openShifts,
  eventFor,
  hasException,
  approvedHome,
  homesOf,
  supersedePending,
  insertHome,
  getHome,
  approveHome,
  rejectHome,
  listHomes,
  homeRow,
  approvedRequestOn,
  getRequest,
  settleRequest,
  cancelRequest,
  listRequests,
  requestRow,
  fieldAssignmentOn,
  getAssignment,
  cancelAssignment,
  removeMember,
  listAssignments,
  assignmentRow,
  workScheduleOn,
  workScheduleAfter,
  workSchedule,
  workSchedulesBetween,
  upsertWorkSchedule,
  lateDays,
  earlyDays,
  absentDays,
  forgottenDays,
  locationFlags,
  latestBreach,
  insertBreach,
  getBreach,
  setBreachAlert,
  payItemsOn,
  getPayItem,
  insertPayItem,
  updatePayItem,
  decidePayItem,
  confirmedOvertime,
  listPayItems,
  payItemsByIds,
  lockPayItems,
  overtimeApprovalOn,
  upsertOvertimeApproval,
};
