"use strict";
/**
 * ⌘K for attendance: a person's days and their exceptions, found by the person's name,
 * within the reader's `people` scope, as People · Attendance shows them. A day opens on
 * People · Attendance (the person's own on ESS · My Attendance); an exception opens the
 * same way (shared/route-map.js attendance_record, attendance_exception). A remote
 * employee's home location is found by their name and opens in Homes; a work location request
 * by its number or the person's name, and opens in Requests. Neither by its address. A field
 * assignment by its number, name, client or anyone on it (seen when one of them is in scope),
 * opening in Field; never by a site's address.
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = [
  recordProvider({
    type: "attendance_record",
    module: "people",
    label: "Attendance Days",
    words: ["attendance", "clock in", "timesheet"],
    from: "attendance_day ad JOIN employee e ON e.employee_id = ad.employee_id",
    key: "ad.attendance_day_id",
    columns: ["e.first_name", "e.last_name", "e.preferred_name"],
    select:
      "ad.attendance_day_id AS id, to_char(ad.attendance_date, 'DD/MM/YYYY') AS ref, btrim(e.first_name || ' ' || e.last_name) AS title, ad.status AS sub, ad.status AS status",
    order: "ad.attendance_date DESC",
    scope: { column: "ad.employee_id" },
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
    select:
      "x.attendance_exception_id AS id, to_char(ad.attendance_date, 'DD/MM/YYYY') AS ref, btrim(e.first_name || ' ' || e.last_name) AS title, replace(x.exception_type, '_', ' ') AS sub, x.status AS status",
    order: "x.created_at DESC",
    scope: { column: "ad.employee_id" },
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
];
