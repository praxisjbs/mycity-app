"use strict";
/**
 * ⌘K: the people, the departments and the open seats of the organisation
 * (docs/guides/foundation.md §6.7, docs/guides/organogram.md §9).
 *
 * A person is found by name (first, last, middle or the one they go by), staff number, work
 * email, post or work phone (typed any way: 0803 123 4567, +234 803..., the last four digits),
 * and a result opens their record. The work phone is not a masked field; personal and
 * next-of-kin numbers are, and are never searched. Record scope narrows it exactly as it
 * narrows the register: Operations and People find everyone, a line manager their team,
 * everybody else themselves. An archived record is out of the way until People restore it.
 *
 * An open seat (a post nobody holds yet, such as Head Sales & Revenue) is found by its title or
 * department, and opens on the Organogram focused on it.
 *
 * The people lead the records (`lead`): a name typed finds the person before their attendance
 * days, leave and requests.
 */
const { recordProvider } = require("../../shared/search/provider");

const employees = recordProvider({
  type: "employee",
  module: "people",
  label: "Employees",
  words: ["employee", "staff", "person", "people", "colleague", "who is"],
  from: "employee e JOIN department d ON d.department_id = e.department_id",
  key: "e.employee_id",
  columns: ["e.first_name", "e.last_name", "e.preferred_name", "e.middle_name", "e.staff_number", "e.work_email", "e.job_title"],
  select:
    "e.employee_id AS id, e.staff_number::text AS ref, btrim(e.first_name || ' ' || e.last_name) AS title, e.job_title || ' · ' || d.name AS sub, e.status AS status",
  where: "e.status <> 'archived'",
  scope: { column: "e.employee_id" },
  phones: ["e.phone"],
  lead: true,
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

const seats = recordProvider({
  type: "org_seat",
  module: "people",
  label: "Open Seats",
  words: ["seat", "open seat", "open role", "vacant"],
  from: "org_seat s JOIN department d ON d.department_id = s.department_id",
  key: "s.org_seat_id",
  columns: ["s.title", "d.name"],
  select: "s.org_seat_id AS id, s.title AS title, 'Vacant · ' || d.name AS sub, s.status AS status",
  where: "s.status = 'vacant'",
});

module.exports = [employees, departments, seats];
