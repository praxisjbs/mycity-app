"use strict";
/**
 * /api/v1: People · Employees (#24), the employee 360, departments, vacant seats and the
 * reporting tree behind Org Chart (#91) and Organogram (#92).
 *
 * Reading the register and a record needs `people` view, by record scope: Operations and
 * People see everyone, a line manager their team, everybody else their own record. The
 * Org Chart is the exception every member of staff may read, so it takes `ess` view: the
 * tree carries no restricted field for anyone (docs/guides/organogram.md §6, §8).
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCeo } = require("../../middleware/rbac");
const controller = require("./organisation.controller");

const router = express.Router();
const view = requirePermission("people", "view");
const create = requirePermission("people", "create");
const edit = requirePermission("people", "edit");
const archive = requirePermission("people", "delete");

route(router, "get", "/employees",
  { query: c.organisation.EmployeeListQuery, response: c.organisation.EmployeePage, summary: "The staff register" },
  view, controller.list);

route(router, "get", "/employees/summary",
  { response: c.organisation.EmployeesSummary, summary: "Counts above the register" },
  view, controller.summary);

route(router, "post", "/employees",
  { body: c.organisation.EmployeeCreate, response: c.organisation.Employee360, summary: "Add an employee" },
  create, controller.create);

route(router, "get", "/employees/:id",
  { response: c.organisation.Employee360, summary: "One employee, the 360" },
  view, controller.get);

route(router, "patch", "/employees/:id",
  { body: c.organisation.EmployeeUpdate, response: c.organisation.Employee360, summary: "Correct a record" },
  edit, controller.update);

route(router, "post", "/employees/:id/archive",
  { body: c.organisation.EmployeeArchive, response: c.organisation.Employee360, summary: "Archive a record" },
  archive, controller.archive);

route(router, "post", "/employees/:id/restore",
  { body: c.common.EmptyBody, response: c.organisation.Employee360, summary: "Restore a record" },
  archive, controller.restore);

route(router, "patch", "/employees/:id/line-manager",
  { body: c.organisation.EmployeeReportingUpdate, response: c.organisation.Employee360, summary: "Set who someone reports to" },
  edit, controller.setLineManager);

route(router, "get", "/employees/:id/history",
  { query: c.common.PageQuery, response: c.organisation.EmployeeHistoryPage, summary: "What has been done to a record" },
  view, controller.history);

/* Download Their Data: the CEO only, one person's data as Download My Data builds it (docs/guides/ess.md §5). */
route(router, "post", "/employees/:id/data-export",
  { params: c.common.IdParams, body: c.common.EmptyBody, response: c.documents.ExportFile,
    summary: "Download a copy of one person's data, for the CEO" },
  view, requireCeo(), controller.requestDataExport);

route(router, "get", "/departments",
  { query: c.organisation.DepartmentListQuery, response: c.organisation.DepartmentPage, summary: "Departments" },
  view, controller.departments);

route(router, "post", "/departments",
  { body: c.organisation.DepartmentCreate, response: c.organisation.Department, summary: "Add a department" },
  create, controller.createDepartment);

route(router, "patch", "/departments/:id",
  { body: c.organisation.DepartmentUpdate, response: c.organisation.Department, summary: "Change a department" },
  edit, controller.updateDepartment);

route(router, "get", "/org-seats",
  { query: c.organisation.OrgSeatListQuery, response: c.organisation.OrgSeatPage, summary: "Seats in the structure" },
  view, controller.seats);

route(router, "post", "/org-seats",
  { body: c.organisation.OrgSeatCreate, response: c.organisation.OrgSeat, summary: "Add a vacant seat" },
  create, controller.createSeat);

route(router, "patch", "/org-seats/:id",
  { body: c.organisation.OrgSeatUpdate, response: c.organisation.OrgSeat, summary: "Change a vacant seat" },
  edit, controller.updateSeat);

/* Every member of staff reads the chart; nothing on a node is restricted. */
route(router, "get", "/org-chart",
  { query: c.organisation.OrgChartQuery, response: c.organisation.OrgChartTree, summary: "The whole reporting tree" },
  requirePermission("ess", "view"), controller.orgChart);

/*
 * Download PDF: the same chart as a file, drawn by the pdf-render job and downloaded where it was
 * asked for.
 * It holds nothing the read does not, so it takes the read's grant (docs/guides/organogram.md §8).
 */
route(router, "post", "/org-chart/exports",
  { body: c.organisation.OrgChartExportRequest, response: c.documents.ExportFile, summary: "Download the whole chart as a PDF" },
  requirePermission("ess", "view"), controller.requestOrgChartExport);

module.exports = { basePath: "/", surface: "staff", router };
