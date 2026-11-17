"use strict";
/**
 * ⌘K for leave: a request found by the person's name, the leave type or its relief officer's
 * name, within the reader's `people` scope, exactly as People · Leave lists it. A result opens
 * the request on People · Leave (shared/route-map.js leave_request), where its handover note is.
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "leave_request",
  module: "people",
  label: "Leave Requests",
  words: ["leave requests", "time off", "relief officer", "handover note"],
  from: `leave_request lr
    JOIN employee e ON e.employee_id = lr.employee_id
    JOIN leave_type t ON t.leave_type_id = lr.leave_type_id
    LEFT JOIN employee re ON re.employee_id = lr.relief_employee_id`,
  key: "lr.leave_request_id",
  columns: ["e.first_name", "e.last_name", "e.preferred_name", "t.name", "COALESCE(re.first_name || ' ' || re.last_name, '')"],
  select:
    "lr.leave_request_id AS id, NULL::text AS ref, btrim(e.first_name || ' ' || e.last_name) AS title, t.name AS sub, lr.status AS status",
  order: "lr.starts_on DESC",
  scope: { column: "lr.employee_id" },
});
