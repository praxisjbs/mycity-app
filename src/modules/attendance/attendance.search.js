"use strict";
/**
 * ⌘K for attendance: a person's days and their exceptions, found by the person's name,
 * within the reader's `people` scope, as People · Attendance shows them. A day opens on
 * People · Attendance (the person's own on ESS · My Attendance); an exception opens the
 * same way (shared/route-map.js attendance_record, attendance_exception). A remote
 * employee's home location is found by their name and opens in Homes; never by its address.
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
];
