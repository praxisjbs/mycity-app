"use strict";
/**
 * Attendance: the SQL. Writes only the attendance tables (attendance_event,
 * attendance_day, attendance_exception, attendance_home, attendance_location_request, the
 * field assignment tables attendance_field_assignment, _site and _member,
 * attendance_schedule and attendance_clock_reminder); reads
 * employee, worksite, leave, approvals and the working week for what a day means. Never emits
 * (BACKEND_GUIDE §2).
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

/** Is `dateExpr` worked: the working week (Monday to Friday when it is empty) and no public holiday. */
const WORKING_DAY = (dateExpr) => `(
  CASE WHEN EXISTS (SELECT 1 FROM working_week)
       THEN COALESCE((SELECT ww.is_working_day FROM working_week ww
                       WHERE ww.weekday = extract(isodow FROM ${dateExpr})::int), false)
       ELSE extract(isodow FROM ${dateExpr}) <= 5 END
  AND NOT EXISTS (SELECT 1 FROM public_holiday h WHERE h.holiday_date = ${dateExpr}))`;

/**
 * Is `dateExpr` a home day of a hybrid employee (§6.13): their pattern is hybrid and the schedule in
 * force that date (the latest first day by then, unique per person) leaves its weekday out. No
 * schedule is an office day. No LIMIT: lists built on it go through pageQuery.
 */
const HOME_DAY = (employeeCol, patternCol, dateExpr) => `(${patternCol} = 'hybrid' AND COALESCE((
  SELECT NOT (extract(isodow FROM ${dateExpr})::smallint = ANY (hs.office_days))
    FROM attendance_schedule hs
   WHERE hs.employee_id = ${employeeCol}
     AND hs.effective_from = (SELECT max(hm.effective_from) FROM attendance_schedule hm
                               WHERE hm.employee_id = ${employeeCol} AND hm.effective_from <= ${dateExpr})), false))`;

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
    `SELECT e.employee_id, ${PERSON()} AS ref, e.status, e.work_pattern, e.worksite_id,
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
 * A work date's active events (accepted or under review), oldest first; `excluded` when
 * the day does not count it (EXCLUDED). Rejected attempts are left out: they change
 * neither the guard nor the day. The unique indexes allow one active event of each type a
 * day, and one automatic clock-out beside it, so this is a handful, never a list a person
 * pages through.
 */
async function eventsOn(db, employeeId, date) {
  // pagination:complete the guard and the day's figures need every active event of the day
  const { rows } = await completeQuery(
    db,
    `SELECT ev.attendance_event_id, ev.event_type, ev.validation_state, ev.occurred_at, ev.source,
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

async function insertEvent(client, e) {
  const row = await one(
    client,
    `INSERT INTO attendance_event
       (employee_id, event_type, occurred_at, work_date, device_at, worksite_id, known_device_id,
        attendance_device_id, policy_version_id, latitude, longitude, accuracy_m, distance_m, source,
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
  ad.worked_minutes, ad.late_minutes, ad.overtime_minutes, ad.closed_at,
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
         COALESCE(${REGISTER_SITE("e.employee_id", "$1::date")},
         CASE WHEN fa.sites IS NOT NULL THEN fa.sites
              WHEN lr.request_type IS NOT NULL THEN ${REQUEST_PLACE("lr.request_type")}
              WHEN e.work_pattern = 'remote' OR ${HOME_DAY("e.employee_id", "e.work_pattern", "$1::date")}
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

/* ------------------------------------------------------------------ *
 * The clock watch (attendance.clock-watch.js, §6.14)
 * ------------------------------------------------------------------ */

/**
 * The people a clock-in reminder is due to on a date: at work (active, started, not left), with a
 * login to tell, not on granted leave, with no clock-in that counts and no reminder yet; with
 * their active logins, whose presence decides whether the push or the app's prompt reaches them.
 */
async function dueForReminder(db, date) {
  // pagination:complete the watch reminds everyone who is due, not a page of them
  const { rows } = await completeQuery(
    db,
    `SELECT e.employee_id,
            ARRAY(SELECT u.user_id FROM app_user u
                   WHERE u.employee_id = e.employee_id AND u.status = 'active' ORDER BY u.user_id) AS user_ids
       FROM employee e
      WHERE e.status = 'active' AND (e.start_date IS NULL OR e.start_date <= $1::date)
        AND (e.left_on IS NULL OR e.left_on > $1::date)
        AND EXISTS (SELECT 1 FROM app_user u WHERE u.employee_id = e.employee_id AND u.status = 'active')
        AND NOT ${GRANTED_LEAVE("e.employee_id", "$1::date")}
        AND NOT EXISTS (SELECT 1 FROM attendance_event ev
                         WHERE ev.employee_id = e.employee_id AND ev.work_date = $1::date
                           AND ev.event_type = 'clock_in' AND ev.validation_state IN ('accepted', 'review')
                           AND NOT ${EXCLUDED("ev")})
        AND NOT EXISTS (SELECT 1 FROM attendance_clock_reminder r
                         WHERE r.employee_id = e.employee_id AND r.work_date = $1::date AND r.kind = 'clock_in_due')
      ORDER BY e.employee_id`,
    [date],
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

/** Record a reminder as sent, once: null when it already was. */
function recordReminder(client, employeeId, date, kind) {
  return one(
    client,
    `INSERT INTO attendance_clock_reminder (employee_id, work_date, kind) VALUES ($1, $2::date, $3)
     ON CONFLICT (employee_id, work_date, kind) DO NOTHING
     RETURNING attendance_clock_reminder_id, employee_id, work_date::text AS work_date, kind`,
    [employeeId, date, kind],
  );
}

/** The reminder sent to a person for a date, or null. */
function reminderOn(db, employeeId, date, kind) {
  return one(
    db,
    `SELECT attendance_clock_reminder_id FROM attendance_clock_reminder
      WHERE employee_id = $1 AND work_date = $2::date AND kind = $3`,
    [employeeId, date, kind],
  );
}

/**
 * Shifts still open on work dates from `from` to `to`: a clock-in that counts, no clock-out, and
 * a day not closed; with the person's active logins, whose presence decides the automatic
 * clock-out.
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
                           AND o.event_type = 'clock_out' AND o.validation_state IN ('accepted', 'review'))
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
 * Hybrid staff's weekly schedule (attendance.schedule.js)
 * ------------------------------------------------------------------ */

const SCHEDULE = `s.attendance_schedule_id, s.employee_id, s.office_days::int[] AS office_days, s.effective_from,
  s.reason, s.set_at,
  (SELECT btrim(se.first_name || ' ' || se.last_name) FROM app_user su
     JOIN employee se ON se.employee_id = su.employee_id WHERE su.user_id = s.set_by) AS set_by_name`;

/** The schedule in force for a person on a date: the latest that started by then, or null. */
function scheduleOn(db, employeeId, date) {
  return one(
    db,
    `SELECT ${SCHEDULE} FROM attendance_schedule s
      WHERE s.employee_id = $1 AND s.effective_from <= $2::date
      ORDER BY s.effective_from DESC LIMIT 1`,
    [employeeId, date],
  );
}

/** The next schedule waiting to start after a date, or null. */
function scheduleAfter(db, employeeId, date) {
  return one(
    db,
    `SELECT ${SCHEDULE} FROM attendance_schedule s
      WHERE s.employee_id = $1 AND s.effective_from > $2::date
      ORDER BY s.effective_from LIMIT 1`,
    [employeeId, date],
  );
}

/** The schedule a person set from exactly this first day, or null (for the audit's before). */
function scheduleFrom(db, employeeId, from) {
  return one(
    db,
    `SELECT ${SCHEDULE} FROM attendance_schedule s WHERE s.employee_id = $1 AND s.effective_from = $2::date`,
    [employeeId, from],
  );
}

/** Set a schedule from its first day; one from the same first day is replaced. */
function upsertSchedule(client, x) {
  return one(
    client,
    `INSERT INTO attendance_schedule (employee_id, office_days, effective_from, reason, set_by)
     VALUES ($1, $2::smallint[], $3, $4, $5)
     ON CONFLICT (employee_id, effective_from)
       DO UPDATE SET office_days = EXCLUDED.office_days, reason = EXCLUDED.reason, set_by = EXCLUDED.set_by, set_at = now()
     RETURNING attendance_schedule_id`,
    [x.employee_id, x.office_days, x.effective_from, x.reason, x.set_by],
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
  WORKING_DAY,
  HOME_DAY,
  lockEmployee,
  person,
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
  dueForReminder,
  firstSessionOn,
  recordReminder,
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
  scheduleOn,
  scheduleAfter,
  scheduleFrom,
  upsertSchedule,
};
