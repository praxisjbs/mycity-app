"use strict";
/**
 * What the assistant may read about the organisation, and where it sends a person to
 * change something (A23: it reads, it never writes).
 *
 * It answers "who reports to whom", "who reports to X", "how many people are in
 * <department>", "who heads <department>" and "which roles are vacant" from the same rows the screens read, in
 * the caller's own scope, 25 at a time (docs/guides/organogram.md §9); employees.summary counts the
 * register by department, status, arrangement, type, manager or confirmation due (figures, never rows,
 * docs/guides/praxis-ai.md §6.13).
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const repo = require("./organisation.repo");
const service = require("./organisation.service");

module.exports = defineManifest({
  module: "people",
  // Every Create schema of this module's contract, and why the assistant does not offer it (gate 23).
  not_offered: {
    DepartmentCreate: "a department is added on People, Departments with its head and code in view",
    EmployeeCreate: "Add Employee is a form of many restricted fields (pay, bank, personal); the route opens it filled with the names and job",
    OrgSeatCreate: "a seat is placed on the organogram, where the structure is in view",
  },
  summaries: [
    {
      key: "employees.summary",
      description: "Headcount figures: people by department, status, work arrangement, employment type or line manager, on probation and due for confirmation, contracts ending",
      params: c.organisation.EmployeeSummaryQuery,
      permission: ["people", "view"],
      run: (client, params, actor) => service.aiSummary(client, params, actor.scope),
    },
  ],
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
