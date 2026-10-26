"use strict";
/**
 * ⌘K for attendance: a person's days and their exceptions, found by the person's name,
 * within the reader's `people` scope, as People · Attendance shows them. A day opens on
 * People · Attendance (the person's own on ESS · My Attendance); an exception opens the
 * same way (shared/route-map.js attendance_record, attendance_exception). A remote
 * employee's home location is found by their name and opens in Homes; a work location request
 * by its number or the person's name, and opens in Requests. Neither by its address. A field
 * assignment by its number, name, client or anyone on it (seen when one of them is in scope),
 * opening in Field; never by a site's address. A temporary site (PR 4) by its number, name, purpose
 * or anyone on it, within the reader's `people` scope, opening People · Worksites (`?site=`); the
 * person's own, those they submitted or are or were on, as My Temporary Sites, opening Work Location
 * Requests (`?site=`). Never by an address.
 *
 * A day and an exception read as the person, then what it was and its date ("Present ·
 * 26/10/2026", "Missing Clock-Out · 26/10/2026"), in the words People · Attendance uses, so
 * two days of one person never read the same. A person has a day for every working day, so
 * each lists at most three, newest first (`cap`); the person's own record comes before them
 * (organisation.search.js `lead`) and People · Attendance holds the rest.
 */
const { recordProvider } = require("../../shared/search/provider");

/** A day's date as people read it. */
const DAY = "to_char(ad.attendance_date, 'DD/MM/YYYY')";
/** A day's status in the words the attendance screens show (app/src/features/attendance/labels.ts). */
const DAY_STATUS = `CASE ad.status WHEN 'present' THEN 'Present' WHEN 'late' THEN 'Late' WHEN 'absent' THEN 'Absent'
  WHEN 'leave' THEN 'On Leave' ELSE 'Not Counted' END`;
/** An exception's kind in the same words. */
const EXCEPTION_TYPE = `CASE x.exception_type WHEN 'outside_worksite' THEN 'Outside Worksite' WHEN 'outside_home' THEN 'Outside Home'
  WHEN 'location_unverified' THEN 'Location Unclear' WHEN 'unknown_device' THEN 'Unknown Device'
  WHEN 'suspicious_timestamp' THEN 'Device Time Ahead' WHEN 'missing_clock_out' THEN 'Missing Clock-Out'
  WHEN 'automatic_clock_out' THEN 'System Clock-Out' ELSE initcap(replace(x.exception_type, '_', ' ')) END`;
/** Days and exceptions listed in ⌘K at most. */
const DAYS_LISTED = 3;

module.exports = [
  recordProvider({
    type: "attendance_record",
    module: "people",
    label: "Attendance Days",
    words: ["attendance", "clock in", "timesheet"],
    from: "attendance_day ad JOIN employee e ON e.employee_id = ad.employee_id",
    key: "ad.attendance_day_id",
    columns: ["e.first_name", "e.last_name", "e.preferred_name"],
    select: `ad.attendance_day_id AS id, ${DAY} AS ref, btrim(e.first_name || ' ' || e.last_name) AS title,
      ${DAY_STATUS} || ' · ' || ${DAY} AS sub, ad.status AS status`,
    order: "ad.attendance_date DESC",
    scope: { column: "ad.employee_id" },
    cap: DAYS_LISTED,
  }),
  recordProvider({
    type: "attendance_exception",
    module: "people",
    label: "Attendance Exceptions",
    words: ["exception", "exceptions", "reconcile", "missing clock out"],
    from: `attendance_exception x
      JOIN attendance_day ad ON ad.attendance_day_id = x.attendance_day_id
      JOIN employee e ON e.employee_id = ad.employee_id`,
    key: "x.attendance_exception_id",
    columns: ["e.first_name", "e.last_name", "e.preferred_name", "x.exception_type"],
    select: `x.attendance_exception_id AS id, ${DAY} AS ref, btrim(e.first_name || ' ' || e.last_name) AS title,
      ${EXCEPTION_TYPE} || ' · ' || ${DAY} AS sub, x.status AS status`,
    order: "ad.attendance_date DESC, x.created_at DESC",
    scope: { column: "ad.employee_id" },
    cap: DAYS_LISTED,
  }),
  recordProvider({
    type: "attendance_home",
    module: "people",
    label: "Home Locations",
    words: ["home location", "remote home", "work from home"],
    from: "attendance_home h JOIN employee e ON e.employee_id = h.employee_id",
    key: "h.attendance_home_id",
    columns: ["e.first_name", "e.last_name", "e.preferred_name"],
    select:
      "h.attendance_home_id AS id, to_char(h.requested_at, 'DD/MM/YYYY') AS ref, btrim(e.first_name || ' ' || e.last_name) AS title, h.status AS sub, h.status AS status",
    order: "h.requested_at DESC",
    scope: { column: "h.employee_id" },
    // Found only while the Attendance policy's Home Location is on (§1.3), as Homes is shown.
    available: (client) => require("./attendance.home").onDate(client),
  }),
  recordProvider({
    type: "attendance_location_request",
    module: "people",
    label: "Work Location Requests",
    words: ["work location", "location request", "remote day", "client visit", "temporary home"],
    from: "attendance_location_request r JOIN employee e ON e.employee_id = r.employee_id",
    key: "r.location_request_id",
    columns: ["r.number", "e.first_name", "e.last_name", "e.preferred_name"],
    select:
      "r.location_request_id AS id, r.number AS ref, btrim(e.first_name || ' ' || e.last_name) AS title, replace(r.request_type, '_', ' ') AS sub, r.status AS status",
    order: "r.requested_at DESC",
    scope: { column: "r.employee_id" },
  }),
  recordProvider({
    type: "attendance_field_assignment",
    module: "people",
    label: "Field Assignments",
    words: ["field assignment", "field work", "sent out", "venue", "crew"],
    from: "attendance_field_assignment a",
    key: "a.field_assignment_id",
    columns: [
      "a.number",
      "a.name",
      "a.client",
      `(SELECT string_agg(fe.first_name || ' ' || fe.last_name || ' ' || COALESCE(fe.preferred_name, ''), ' ')
          FROM attendance_field_member fm JOIN employee fe ON fe.employee_id = fm.employee_id
         WHERE fm.field_assignment_id = a.field_assignment_id)`,
    ],
    select:
      "a.field_assignment_id AS id, a.number AS ref, a.name AS title, a.client AS sub, a.status AS status",
    order: "a.starts_on DESC",
    scope: {
      column: "m.employee_id",
      through: "attendance_field_member m WHERE m.field_assignment_id = a.field_assignment_id",
    },
  }),
  recordProvider({
    type: "attendance_temporary_site",
    module: "people",
    label: "Temporary Sites",
    words: ["temporary site", "temporary sites", "work site", "out of station"],
    from: "attendance_temporary_site s",
    key: "s.temporary_site_id",
    columns: [
      "s.number",
      "s.name",
      "replace(s.purpose, '_', ' ')",
      `(SELECT string_agg(te.first_name || ' ' || te.last_name || ' ' || COALESCE(te.preferred_name, ''), ' ')
          FROM attendance_temporary_site_member tm JOIN employee te ON te.employee_id = tm.employee_id
         WHERE tm.temporary_site_id = s.temporary_site_id)`,
    ],
    select:
      "s.temporary_site_id AS id, s.number AS ref, s.name AS title, replace(s.purpose, '_', ' ') AS sub, s.status AS status",
    order: "s.starts_on DESC",
    scope: {
      column: "m.employee_id",
      through: "attendance_temporary_site_member m WHERE m.temporary_site_id = s.temporary_site_id",
    },
  }),
  recordProvider({
    type: "attendance_own_temporary_site",
    module: "ess",
    label: "My Temporary Sites",
    words: ["my temporary sites", "my work sites", "my sites"],
    from: "attendance_temporary_site s JOIN app_user u ON u.status = 'active'",
    key: "s.temporary_site_id",
    columns: ["s.number", "s.name", "replace(s.purpose, '_', ' ')"],
    select:
      "s.temporary_site_id AS id, s.number AS ref, s.name AS title, replace(s.purpose, '_', ' ') AS sub, s.status AS status",
    where: `s.submitted_by = u.user_id OR EXISTS (SELECT 1 FROM attendance_temporary_site_member om
              WHERE om.temporary_site_id = s.temporary_site_id AND om.employee_id = u.employee_id)`,
    order: "s.starts_on DESC",
    owner: { column: "u.user_id" },
  }),
];
