"use strict";
/**
 * ⌘K: the people and the departments of the organisation (docs/guides/foundation.md §6.7,
 * docs/guides/organogram.md §9).
 *
 * A person is found by name, staff number, work email or post, and a result opens their
 * record. Record scope narrows it exactly as it narrows the register: Operations and
 * People find everyone, a line manager their team, everybody else themselves. An
 * archived record is out of the way until People restore it.
 */
const { recordProvider } = require("../../shared/search/provider");

const employees = recordProvider({
  type: "employee",
  module: "people",
  label: "Employees",
  words: ["employee", "staff", "person", "people", "colleague", "who is"],
  from: "employee e JOIN department d ON d.department_id = e.department_id",
  key: "e.employee_id",
  columns: ["e.first_name", "e.last_name", "e.staff_number", "e.work_email", "e.job_title"],
  select:
    "e.employee_id AS id, e.staff_number::text AS ref, btrim(e.first_name || ' ' || e.last_name) AS title, e.job_title || ' · ' || d.name AS sub, e.status AS status",
  where: "e.status <> 'archived'",
  scope: { column: "e.employee_id" },
});

const departments = recordProvider({
  type: "department",
  module: "people",
  label: "Departments",
  words: ["department", "team", "unit", "structure"],
  from: "department d",
  key: "d.department_id",
  columns: ["d.name", "d.code"],
  select: "d.department_id AS id, d.code::text AS ref, d.name AS title, NULL::text AS sub",
  where: "d.active",
});

module.exports = [employees, departments];
