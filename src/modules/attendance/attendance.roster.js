"use strict";
/**
 * The attendance roster: a day's register in the shape Home reads it. Who is on the day,
 * who came in, how, and who did not.
 *
 * Home's screens read attendance only through this file (the Clocked In Today card and the
 * list behind it, the Team tab and its month, a person's own month), and the reader's own shift
 * through attendance.schedule.js dayOn (the day strip, Your Week). Home's alerts no longer read
 * attendance: they are the Attendance policy's breaches, raised by the attendance module
 * (attendance.md §6.9, §6.16). This file writes nothing, emits nothing and
 * decides nothing: every fact is the attendance module's own (docs/guides/attendance.md §6),
 * read the way People · Attendance and My Attendance read it, so a figure on Home is the
 * figure on those screens.
 *
 *   summary(client, { date }, scope)                     the counts for one day
 *   page(client, { date, status, ... }, scope, query)    one page of 25 people for one day
 *   month(client, { from, to, ... }, scope, query)       one page of 25 people, each with their totals
 *   personal(client, { employee_id, from, to })          one person's days and their totals
 *
 * Where each fact comes from:
 *
 *   the day's record   attendance_day, as reconcile.recomputeDay() writes it on every punch,
 *                      decision and day-close (rules.projectDay with lateness.minutesLate):
 *                      its status, first clock-in, last clock-out and late minutes. Which
 *                      punches count, the work date, the shift, the grace and lateness are
 *                      decided there, once, and never again here
 *   a day with none    granted leave, else nothing on a day that is not worked for that person,
 *                      else not in: the register's own order (attendance.repo.js REGISTER)
 *   who is on the day  anyone with a record that day, and everyone active, started and not
 *                      yet left: the register's people
 *   leave              granted as attendance.repo.js and the leave module read it
 *   working days       each person's own (attendance.md §6.13): by the work schedule in force on the
 *                      date, else the company hours in force then (the service reads them through
 *                      policies.rulesFor and passes them to the SQL), else the working week; never a
 *                      public holiday, and nobody without an active login (repo.EXPECTED_ON). The
 *                      "yesterday" of the open-shift flag is the organisation's last working day
 *   the clock-in       the day's one active clock-in, for the worksite it was judged against
 *   a person's totals  repo.daysSummary(), the figures My Attendance shows; month() counts
 *                      every person's days the same way, in one query
 *
 * The register's statuses become Home's (packages/contract HomeRosterStatus), one each:
 *
 *   leave     on_leave
 *   late      late
 *   present   field on a day an approved temporary site they are still on covers, a Temporary
 *             Home aside (attendance.md §6.11, PR 4), or a field assignment made before PR 4
 *             (§6.12); else remote on a Remote day of the work schedule in force then (§6.13), or,
 *             with no schedule working that day, for a remote work pattern, or on an approved
 *             Temporary Home or a remote day approved before PR 4 (§6.11); else on_site
 *   absent    absent: a working day the day-close closed with no clock-in
 *   not_in    not_in: a working day not closed, no clock-in yet
 *   off       none: a day that is not worked, with nothing recorded
 *
 * Beside the status, `no_clock_out_yesterday` flags a person whose last working day has a
 * clock-in and no clock-out on its record: the open shift the day-close turns into a missing
 * clock-out (clock-guard isOpen over the day's counted punches). A person is `flagged` on a
 * day when they are late or carry that flag, once however many of the two they carry.
 *
 * The mapping is written twice: statusOf() for one person's days in JavaScript (personal()),
 * and STATUS in SQL so a list can filter, count and page by it (summary(), page()).
 * tests/integration/attendance-roster.test.js holds the two to the same answer, and both to
 * the register's own (repo.register, repo.registerSummary, repo.daysSummary).
 */
const { AppError } = require("../../shared/errors");
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");
const { photoUrlSql } = require("../../shared/db/person");
const lagos = require("../../shared/time/lagos");
const workingWeek = require("../../shared/time/working-week");
const calendar = require("./attendance.calendar");
const rules = require("./attendance.rules");
const repo = require("./attendance.repo");

/** Home's statuses (packages/contract HomeRosterStatus), in display order. */
const STATUSES = Object.freeze(["on_leave", "late", "on_site", "remote", "field", "absent", "not_in"]);

/** The longest stretch personal() and month() read: a calendar month, or the last 30 days. */
const MAX_DAYS = 31;

/** What a day the attendance module recorded counts as on My Attendance (repo.daysSummary). */
const OUTCOME = Object.freeze({ present: "on_time", late: "late", absent: "absent", leave: "on_leave" });

/* ------------------------------------------------------------------ *
 * The rule, for one person on one day
 * ------------------------------------------------------------------ */

/**
 * A day as the attendance module reads it: whether it is worked and its hours
 * (rules.shiftFor over the working week; the grace is each person's, so none here).
 *
 * @param {string} date  YYYY-MM-DD
 * @param {import("../../shared/time/working-week").Calendar} cal
 */
function dayOf(date, cal) {
  lagos.assertDate(date);
  const shift = rules.shiftFor(date, cal, rules.DEFAULT_POLICY);
  return { date, working_day: shift.working_day, starts_at: shift.starts_at, ends_at: shift.ends_at };
}

/**
 * The day "yesterday" means on the roster: the last working day before `date`, so on a
 * Monday it is Saturday, and after a public holiday it is the day before the holiday.
 */
function yesterdayOf(date, cal) {
  return dayOf(workingWeek.addWorkingDays(date, -1, cal), cal);
}

/**
 * One person's status on one day, as the register gives it, in Home's words; null on a
 * day that is not worked with nothing recorded.
 *
 * @param {{day_status: string|null, on_leave: boolean, working_day: boolean, work_pattern: string,
 *          remote_day?: boolean, field_day?: boolean}} f
 *   day_status  attendance_day.status for the day, null when there is no record or it has none
 *   on_leave    granted leave covers the day
 *   working_day the day is worked for the person, and they are expected (repo.EXPECTED_ON)
 *   remote_day  a Remote day of their schedule, or with no schedule working it a remote pattern
 *               (repo.PLACE_REMOTE), or an approved Temporary Home or remote day covers it
 *   field_day   an approved temporary site (not a home) or a field assignment the person is still
 *               on covers the day
 */
function statusOf(f) {
  switch (f.day_status) {
    case "leave":
      return "on_leave";
    case "late":
      return "late";
    case "present":
      if (f.field_day) return "field";
      return f.remote_day ? "remote" : "on_site";
    case "absent":
      return "absent";
    default:
      break;
  }
  if (f.on_leave) return "on_leave";
  return f.working_day ? "not_in" : null;
}

/** What a recorded day counts as on My Attendance (on_time, late, absent, on_leave), or null. */
const outcomeOf = (dayStatus) => OUTCOME[dayStatus] || null;

/**
 * My Attendance's figures (repo.daysSummary) as the roster's totals. A day counts once the
 * attendance module has recorded it: a clock-in on the day, or the day-close's absence or
 * leave. Leave is counted apart, so `expected` is always on_time + late + absent.
 *
 * @param {{days_present: number, late_days: number, absent_days: number, leave_days: number}} s
 */
function totalsOf(s) {
  return {
    expected: s.days_present + s.absent_days,
    on_time: s.days_present - s.late_days,
    late: s.late_days,
    absent: s.absent_days,
    on_leave: s.leave_days,
  };
}

const NO_TOTALS = Object.freeze({ expected: 0, on_time: 0, late: 0, absent: 0, on_leave: 0 });

/* ------------------------------------------------------------------ *
 * The same rule in SQL, and the facts it reads
 * ------------------------------------------------------------------ */

/**
 * Whether granted leave covers `day` for `employee` (SQL expressions): approved on the
 * request, or still `submitted` there while its approval has already granted it, as
 * attendance.repo.js GRANTED_LEAVE and leave.repo.js read it.
 */
const grantedLeave = (employee, day) => `EXISTS (
  SELECT 1
    FROM leave_request lr
    LEFT JOIN workflow_instance wi ON wi.workflow_instance_id = lr.workflow_instance_id
   WHERE lr.employee_id = ${employee} AND lr.starts_on <= ${day} AND lr.ends_on >= ${day}
     AND (lr.status = 'approved'
          OR (lr.status = 'submitted' AND wi.state IN ('approved', 'timeout_approved'))))`;

/**
 * Whether an approved temporary site `employee` is still on covers `day` (attendance.md §6.11)
 * (SQL): `home` true keeps a Temporary Home, false every other purpose.
 */
const siteDay = (employee, day, home) => `EXISTS (
  SELECT 1 FROM attendance_temporary_site_member tm
    JOIN attendance_temporary_site ts ON ts.temporary_site_id = tm.temporary_site_id
   WHERE tm.employee_id = ${employee} AND tm.removed_at IS NULL AND ts.status = 'approved'
     AND ts.purpose ${home ? "=" : "<>"} 'temporary_home'
     AND ts.starts_on <= ${day} AND ts.ends_on >= ${day})`;

/**
 * Whether `day` is worked remotely by `employee` (SQL): an approved Temporary Home covers it
 * (PR 4), or an approved remote day made before PR 4 (attendance.md §6.11), or it is a Remote day of
 * the work schedule in force then, or with no schedule working that day a remote work pattern
 * (§6.13, repo.PLACE_REMOTE over the employee `e`).
 */
const remoteDay = (employee, day) => `(${siteDay(employee, day, true)} OR EXISTS (
  SELECT 1 FROM attendance_location_request lr
   WHERE lr.employee_id = ${employee} AND lr.status = 'approved' AND lr.request_type = 'remote_day'
     AND lr.starts_on <= ${day} AND lr.ends_on >= ${day})
  OR ${repo.PLACE_REMOTE(employee, "e.work_pattern", day)})`;

/**
 * Whether an approved temporary site (a Temporary Home aside) or a field assignment made before PR 4
 * that `employee` is still on covers `day` (attendance.md §6.11, §6.12) (SQL).
 */
const fieldDay = (employee, day) => `(${siteDay(employee, day, false)} OR EXISTS (
  SELECT 1 FROM attendance_field_member fm
    JOIN attendance_field_assignment fa ON fa.field_assignment_id = fm.field_assignment_id
   WHERE fm.employee_id = ${employee} AND fm.removed_at IS NULL AND fa.status = 'active'
     AND fa.starts_on <= ${day} AND fa.ends_on >= ${day}))`;

/**
 * Whether employee `e` is on the register on `day`, `ad` being their day's record: anyone
 * with a record, and everyone active, started and not yet left (attendance.repo.js REGISTER).
 */
const onRegister = (day) => `(ad.attendance_day_id IS NOT NULL
  OR (e.status = 'active' AND (e.start_date IS NULL OR e.start_date <= ${day})
      AND (e.left_on IS NULL OR e.left_on > ${day})))`;

/**
 * Whether employee `e` is on the register on at least one day from `from` to `to`: a record
 * on one of them, or active, started by the last and not yet left on the first day they are
 * on it (onRegister() over each day of the range, in one expression).
 */
const onRegisterBetween = (from, to) => `(EXISTS (SELECT 1 FROM attendance_day x
                WHERE x.employee_id = e.employee_id AND x.attendance_date BETWEEN ${from} AND ${to})
  OR (e.status = 'active' AND GREATEST(e.start_date, ${from}) <= ${to}
      AND (e.left_on IS NULL OR e.left_on > GREATEST(e.start_date, ${from}))))`;

/** statusOf(), over the columns of the facts `f`. */
const STATUS = `CASE f.day_status
  WHEN 'leave' THEN 'on_leave'
  WHEN 'late' THEN 'late'
  WHEN 'present' THEN CASE WHEN f.field_day THEN 'field'
                           WHEN f.remote_day THEN 'remote' ELSE 'on_site' END
  WHEN 'absent' THEN 'absent'
  ELSE CASE WHEN f.on_leave THEN 'on_leave' WHEN f.working_day THEN 'not_in' END
END`;

/** A roster row `r` is flagged: late, or no clock-out on the last working day. Never null. */
const FLAGGED = "(r.status IS NOT DISTINCT FROM 'late' OR r.no_clock_out_yesterday)";

/**
 * The department and name filters every roster list shares, over the employee `e`, as one
 * SQL condition; `bind` appends each value to the query's parameters.
 */
function personFilters(bind, { department_id: departmentId, q }) {
  const department = bind(departmentId || null);
  const term = bind(q || null);
  return `(${department}::uuid IS NULL OR e.department_id = ${department}::uuid)
           AND (${term}::text IS NULL
                OR search_fold(e.first_name || ' ' || e.last_name || ' ' || e.job_title)
                   LIKE '%' || search_fold(${term}::text) || '%')`;
}

/** Appends a value to the query's parameters and returns its placeholder. */
const binder = (params) => (value) => {
  params.push(value);
  return `$${params.length}`;
};

/**
 * Everyone on the register on a day within `scope`, one row each with what their day
 * holds and their status. `filters` narrows the people before anything is worked out.
 *
 * The clock-in's worksite is the one its punch was judged against, read from the day's
 * active clock-in (one a day among the person's and People's punches,
 * attendance_event_one_active_person_uq; the system never clocks in), or on a temporary site's or a
 * field assignment's day the site it was judged against; it shows only while the day's record has a clock-in, so a
 * punch a decision excluded names none.
 *
 * @param {ReturnType<typeof dayOf> & {hours: Array|null}} day  with the company hours in force then
 * @param {ReturnType<typeof dayOf>} yesterday
 * @param {{scope: string, scope_ids: string[]|null}} scope
 * @param {Array} params  the query's parameters; this appends its own
 * @param {{department_id?: string, q?: string}} [filters]
 */
function rosterSql(day, yesterday, scope, params, filters = {}) {
  const bind = binder(params);
  const date = `${bind(day.date)}::date`;
  // Worked out in SQL, per person, as the register does: a holiday entered a moment ago already counts.
  const working = repo.EXPECTED_ON("e.employee_id", date, `${bind(hoursParam(day.hours))}::jsonb`);
  const yDate = `${bind(yesterday.date)}::date`;
  const narrowed = personFilters(bind, filters);
  const s = scopeClause(scope, { column: "e.employee_id" }, params);
  return `
    SELECT f.*, ${STATUS} AS status,
           CASE WHEN f.clock_in_at IS NOT NULL AND (f.field_day OR NOT f.remote_day)
                THEN f.clock_in_worksite END AS worksite
      FROM (
        SELECT e.employee_id, e.first_name, e.last_name, e.job_title, e.department_id,
               d.name AS department, ${photoUrlSql("e")} AS photo_url, e.work_pattern, ${remoteDay("e.employee_id", date)} AS remote_day,
               ${fieldDay("e.employee_id", date)} AS field_day,
               ${working} AS working_day,
               ad.status AS day_status, ${grantedLeave("e.employee_id", date)} AS on_leave,
               ad.first_clock_in_at AS clock_in_at, ad.last_clock_out_at AS clock_out_at,
               COALESCE(ad.late_minutes, 0) AS late_minutes, COALESCE(ad.worked_minutes, 0) AS worked_minutes,
               COALESCE(w.name, CASE WHEN ci.validation #>> '{geofence,place}' IN ('field', 'temporary_site')
                                     THEN ci.validation #>> '{geofence,worksite_name}' END) AS clock_in_worksite,
               (yd.first_clock_in_at IS NOT NULL AND yd.last_clock_out_at IS NULL) AS no_clock_out_yesterday
          FROM employee e
          LEFT JOIN department d ON d.department_id = e.department_id
          LEFT JOIN attendance_day ad ON ad.employee_id = e.employee_id AND ad.attendance_date = ${date}
          LEFT JOIN attendance_day yd ON yd.employee_id = e.employee_id AND yd.attendance_date = ${yDate}
          LEFT JOIN attendance_event ci ON ci.employee_id = e.employee_id AND ci.work_date = ${date}
                AND ci.event_type = 'clock_in' AND ci.validation_state IN ('accepted', 'review')
                AND ci.source <> 'system'
          LEFT JOIN worksite w ON w.worksite_id = ci.worksite_id
         WHERE ${onRegister(date)}
           AND ${narrowed}
           ${s.and}
      ) f`;
}

/**
 * Refuse a range that is not one: a date that is not a real day, a last day before the
 * first, or more than MAX_DAYS days.
 */
function assertRange(from, to) {
  lagos.assertDate(from, "from");
  lagos.assertDate(to, "to");
  const span = lagos.daysBetween(from, to);
  if (span < 0)
    throw new AppError("ATTENDANCE_RANGE", "The last day is before the first", 422, {
      to: ["Before the first day"],
    });
  if (span >= MAX_DAYS)
    throw new AppError("ATTENDANCE_RANGE", `Pick at most ${MAX_DAYS} days`, 422, {
      to: [`More than ${MAX_DAYS} days`],
    });
}

/** The company hours as the SQL takes them: a jsonb array, or null for the working week. */
const hoursParam = (hours) => (Array.isArray(hours) ? JSON.stringify(hours) : null);

/**
 * The day asked for (today in Lagos when none is), with the company hours in force then, and the
 * day before it, as the roster reads them.
 */
async function dayAndYesterday(client, date) {
  const cal = await workingWeek.loadCalendar(client);
  const on = date || lagos.today();
  return { day: { ...dayOf(on, cal), hours: await calendar.companyHoursOn(client, on) }, yesterday: yesterdayOf(on, cal) };
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/**
 * The counts for one day, within the reader's scope, as the register counts them
 * (repo.registerSummary), with `present` split by where people work.
 *
 *   expected  everyone on the register whose own day is worked, but those on leave
 *             (present + absent + not_in); 0 on a day that is not worked for anyone
 *   present   late + on_site + remote + field: a clock-in that counts, on any day
 *   flagged   the people late or with no clock-out yesterday, each once: at most
 *             late + no_clock_out_yesterday, less when someone carries both
 *
 * @param {{query: Function}} client
 * @param {{date?: string}} opts  YYYY-MM-DD; today in Lagos when left out
 * @param {{scope: string, scope_ids: string[]|null}} scope
 */
async function summary(client, { date }, scope) {
  const { day, yesterday } = await dayAndYesterday(client, date);
  const params = [];
  const roster = rosterSql(day, yesterday, scope, params);
  const { rows } = await client.query(
    `SELECT count(*) FILTER (WHERE r.working_day AND r.status <> 'on_leave')::int AS expected,
            count(*) FILTER (WHERE r.status IN ('late', 'on_site', 'remote', 'field'))::int AS present,
            count(*) FILTER (WHERE r.status = 'on_site')::int AS on_site,
            count(*) FILTER (WHERE r.status = 'remote')::int AS remote,
            count(*) FILTER (WHERE r.status = 'field')::int AS field,
            count(*) FILTER (WHERE r.status = 'late')::int AS late,
            count(*) FILTER (WHERE r.status = 'absent')::int AS absent,
            count(*) FILTER (WHERE r.status = 'on_leave')::int AS on_leave,
            count(*) FILTER (WHERE r.status = 'not_in')::int AS not_in,
            count(*) FILTER (WHERE r.no_clock_out_yesterday)::int AS no_clock_out_yesterday,
            count(*) FILTER (WHERE ${FLAGGED})::int AS flagged,
            COALESCE(bool_or(r.working_day), false) AS working_day
       FROM (${roster}) r`,
    params,
  );
  return { date: day.date, ...rows[0] };
}

/** The SQL for each sort the Team roster's contract allow-lists. The first is the default order. */
const SORTS = {
  display_name: "r.last_name, r.first_name",
  department: "r.department",
  clock_in_at: "r.clock_in_at",
};

/** A yes-or-no filter: true or false keeps the rows that match it, anything else keeps every row. */
const yesNo = (value) => (typeof value === "boolean" ? value : null);

/**
 * One page of the people on the register on a day, within the reader's scope, each with
 * their status, clock-in and clock-out, late and worked minutes, the worksite of their clock-in (null
 * when they work remotely or are not in), the yesterday flag and whether they are flagged.
 * Filtered, searched and sorted in SQL. The filters combine: `flagged` with `status` "late"
 * keeps the late, with `no_clock_out_yesterday` the open shifts.
 *
 * @param {{query: Function}} client
 * @param {{date?: string, status?: string, department_id?: string, q?: string,
 *          no_clock_out_yesterday?: boolean, flagged?: boolean}} filters
 * @param {{scope: string, scope_ids: string[]|null}} scope
 * @param {{page?: number, sort?: {field: string, dir: string}}} query  the validated list query
 */
async function page(client, filters, scope, query = {}) {
  const f = filters || {};
  if (f.status !== undefined && f.status !== null && !STATUSES.includes(f.status))
    throw new TypeError(`roster: "${f.status}" is not a roster status`);
  const { day, yesterday } = await dayAndYesterday(client, f.date);
  const params = [];
  const roster = rosterSql(day, yesterday, scope, params, f);
  const bind = binder(params);
  const wanted = bind(f.status || null);
  const noClockOut = bind(yesNo(f.no_clock_out_yesterday));
  const flagged = bind(yesNo(f.flagged));
  return pageQuery(
    client,
    `SELECT r.employee_id, r.first_name, r.last_name, r.job_title, r.department_id, r.department,
            r.photo_url, r.work_pattern, r.status, r.clock_in_at, r.clock_out_at, r.late_minutes,
            r.worked_minutes, r.worksite, r.no_clock_out_yesterday, ${FLAGGED} AS flagged, ${TOTAL_COL}
       FROM (${roster}) r
      WHERE (${wanted}::text IS NULL OR r.status = ${wanted}::text)
        AND (${noClockOut}::boolean IS NULL OR r.no_clock_out_yesterday = ${noClockOut}::boolean)
        AND (${flagged}::boolean IS NULL OR ${FLAGGED} = ${flagged}::boolean)
      ORDER BY ${orderBy(query, SORTS, "r.employee_id")}`,
    params,
    query,
  );
}

/** The SQL for each sort Attendance This Month's contract allow-lists. The first is the default order. */
const MONTH_SORTS = {
  display_name: "m.last_name, m.first_name",
  on_time: "m.days_present - m.late_days",
};

/**
 * One page of the people on the register on any day from `from` to `to` (both included, at
 * most 31), within the reader's scope, each with the totals My Attendance shows for those
 * days (repo.daysSummary, through totalsOf): one paged query, never one per person.
 *
 * The range is taken as the caller gives it; for a month so far it ends today, as personal()
 * ends its totals there. Someone who left during it, or has a record in it, is listed with
 * what they had; someone who starts after it is not.
 *
 * @param {{query: Function}} client
 * @param {{from: string, to: string, department_id?: string, q?: string}} filters  YYYY-MM-DD
 * @param {{scope: string, scope_ids: string[]|null}} scope
 * @param {{page?: number, sort?: {field: string, dir: string}}} query  the validated list query
 * @returns {Promise<{data: Array<{employee_id: string, first_name: string, last_name: string,
 *   job_title: string|null, department_id: string, department: string|null, photo_url: string|null, expected: number,
 *   on_time: number, late: number, absent: number, on_leave: number}>, page: object}>}
 */
async function month(client, filters, scope, query = {}) {
  const { from, to } = filters;
  assertRange(from, to);
  const params = [];
  const bind = binder(params);
  const first = `${bind(from)}::date`;
  const last = `${bind(to)}::date`;
  const narrowed = personFilters(bind, filters);
  const s = scopeClause(scope, { column: "e.employee_id" }, params);
  const result = await pageQuery(
    client,
    `SELECT m.*, ${TOTAL_COL}
       FROM (
         SELECT e.employee_id, e.first_name, e.last_name, e.job_title, e.department_id, d.name AS department,
                ${photoUrlSql("e")} AS photo_url,
                count(*) FILTER (WHERE ad.status IN ('present', 'late'))::int AS days_present,
                count(*) FILTER (WHERE ad.status = 'late')::int AS late_days,
                count(*) FILTER (WHERE ad.status = 'absent')::int AS absent_days,
                count(*) FILTER (WHERE ad.status = 'leave')::int AS leave_days
           FROM employee e
           LEFT JOIN department d ON d.department_id = e.department_id
           LEFT JOIN attendance_day ad ON ad.employee_id = e.employee_id
                 AND ad.attendance_date BETWEEN ${first} AND ${last}
          WHERE ${onRegisterBetween(first, last)}
            AND ${narrowed}
            ${s.and}
          GROUP BY e.employee_id, d.name
       ) m
      ORDER BY ${orderBy(query, MONTH_SORTS, "m.employee_id")}`,
    params,
    query,
  );
  return {
    data: result.data.map((r) => ({
      employee_id: r.employee_id,
      first_name: r.first_name,
      last_name: r.last_name,
      job_title: r.job_title,
      department_id: r.department_id,
      department: r.department,
      photo_url: r.photo_url,
      ...totalsOf(r),
    })),
    page: result.page,
  };
}

/**
 * One person's days from `from` to `to` (both included, at most 31), each with its status
 * as summary() and page() would give it and the attendance module's own record of it
 * (`day_status`), and the totals My Attendance shows for the days up to `today`
 * (repo.daysSummary). The caller has already decided the reader may see this person (their
 * own record, or assertInScope). The person is read whatever their status today, so the
 * record of someone who has left still reads; a day they were not on the register has no
 * status.
 *
 * @param {{query: Function}} client
 * @param {{employee_id: string, from: string, to: string, today?: string}} opts
 *   today  YYYY-MM-DD in Lagos, for the totals; today when left out
 * @returns {Promise<{employee_id: string, from: string, to: string,
 *   days: Array<{date: string, working_day: boolean, status: string|null, day_status: string|null,
 *                clock_in_at: Date|null, clock_out_at: Date|null, late_minutes: number}>,
 *   totals: {expected: number, on_time: number, late: number, absent: number, on_leave: number}}>}
 */
async function personal(client, { employee_id: employeeId, from, to, today = lagos.today() }) {
  assertRange(from, to);
  lagos.assertDate(today, "today");

  const dates = [];
  for (let d = from; d <= to; d = lagos.addDays(d, 1)) dates.push(d);
  // The company hours in force on each date, keyed by the date: a new version can start mid-range.
  const hours = await calendar.companyHoursBetween(client, from, to);

  const { rows } = await client.query(
    `SELECT dy.on_date, ${repo.EXPECTED_ON("e.employee_id", "dy.on_date", "($3::jsonb -> dy.on_date::text)")} AS working_day,
            e.work_pattern,
            ${remoteDay("e.employee_id", "dy.on_date")} AS remote_day,
            ${fieldDay("e.employee_id", "dy.on_date")} AS field_day,
            ${onRegister("dy.on_date")} AS on_register,
            ad.status AS day_status, ${grantedLeave("e.employee_id", "dy.on_date")} AS on_leave,
            ad.first_clock_in_at AS clock_in_at, ad.last_clock_out_at AS clock_out_at,
            COALESCE(ad.late_minutes, 0) AS late_minutes
       FROM employee e
      CROSS JOIN unnest($2::date[]) AS dy(on_date)
       LEFT JOIN attendance_day ad ON ad.employee_id = e.employee_id AND ad.attendance_date = dy.on_date
      WHERE e.employee_id = $1
      ORDER BY dy.on_date`,
    [employeeId, dates, JSON.stringify(hours)],
  );
  if (rows.length === 0) throw new AppError("NOT_FOUND", "That employee does not exist", 404);

  const days = rows.map((r) => ({
    date: r.on_date,
    working_day: r.working_day,
    status: r.on_register ? statusOf(r) : null,
    day_status: r.day_status,
    clock_in_at: r.clock_in_at,
    clock_out_at: r.clock_out_at,
    late_minutes: r.late_minutes,
  }));
  const last = to < today ? to : today;
  const totals = last < from ? { ...NO_TOTALS } : totalsOf(await repo.daysSummary(client, employeeId, from, last));
  return { employee_id: employeeId, from, to, days, totals };
}

module.exports = {
  STATUSES,
  MAX_DAYS,
  dayOf,
  yesterdayOf,
  statusOf,
  outcomeOf,
  totalsOf,
  summary,
  page,
  month,
  personal,
};
