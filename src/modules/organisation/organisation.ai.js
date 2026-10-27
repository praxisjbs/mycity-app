"use strict";
/**
 * What the assistant may read about the organisation, and where it sends a person to
 * change something (A23: it reads, it never writes).
 *
 * It answers "who reports to whom", "who reports to X", "how many people are in
 * <department>", "who heads <department>" and "which roles are vacant" from the same rows the screens read, in
 * the caller's own scope, 25 at a time (docs/guides/organogram.md §9).
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const repo = require("./organisation.repo");
const service = require("./organisation.service");

module.exports = defineManifest({
  module: "people",
  reads: [
    {
      key: "employees.list",
      description:
        "List staff, by department, status, work arrangement, employment type or line manager",
      params: c.organisation.EmployeeListQuery,
      permission: ["people", "view"],
      run: (client, params, actor) => repo.list(client, params, actor.scope),
      cite: (row) => ({ type: "employee", id: row.employee_id, label: row.display_name }),
    },
    {
      key: "departments.list",
      description: "List departments with their codes, heads (or who acts for an open head role), how many people and open roles each has, and whether it is in use",
      params: c.organisation.DepartmentListQuery,
      permission: ["people", "view"],
      run: (client, params) => service.departments(client, params),
      cite: (row) => ({ type: "department", id: row.department_id, label: row.name }),
    },
    {
      key: "seats.list",
      description: "List the seats in the structure, including the roles nobody holds yet",
      params: c.organisation.OrgSeatListQuery,
      permission: ["people", "view"],
      run: (client, params) => repo.seats(client, params),
      cite: (row) => ({ type: "employee", id: row.org_seat_id, label: row.title }),
    },
  ],
  routes: [
    { intent: "add an employee", screen: "people.employees", params: { new: "1" }, prefill: c.organisation.EmployeePrefill },
    { intent: "import a staff sheet", screen: "people.employees", params: { import: "1" } },
    { intent: "show the org chart", screen: "ess.org-chart" },
    { intent: "change who someone reports to", screen: "people.organogram" },
    { intent: "add a department", screen: "people.departments", params: { new: "1" } },
    { intent: "change a department's head, or move people between departments", screen: "people.departments" },
  ],
});
