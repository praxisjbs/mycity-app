"use strict";
/**
 * /api/v1/payroll: payroll runs and the payroll setting (docs/guides/payroll.md §5). The payslips', the deductions',
 * the statutory rates' and the salary structure's own routers are in their modules.
 *
 *   GET    /runs, /runs/summary         `payroll` view: Run History, and the run to show first with the
 *                                       runs by status and the last twelve months' net
 *   POST   /runs                        `payroll` create: New Run (the month, as its first day)
 *   GET    /runs/:id                    `payroll` view: the run, its approval's route and what the reader may press
 *   POST   /runs/:id/compute            `payroll` edit: Compute Run, a Draft or Computed run, idempotent
 *   GET    /runs/:id/problems           `payroll` view: what stands in the way, blocking first, 25 a page
 *   POST   /runs/:id/submit             `payroll` edit: Submit for Approval; computes again, freezes, opens `payroll.run`
 *   POST   /runs/:id/mark-paid          `payroll` edit: Mark Paid, an approved run
 *   POST   /runs/:id/exclude, /include  `payroll` edit: leave a person out of the run, or put them back
 *   GET    /runs/:id/adjustments        `payroll` view: a run's one-off earnings and deductions, 25 a page
 *   POST   /runs/:id/adjustments        `payroll` edit: Add Adjustment (the run goes back to Draft)
 *   DELETE /runs/:id/adjustments/:adjustment_id   `payroll` edit: take one off (the run goes back to Draft)
 *   DELETE /runs/:id                    `payroll` delete: Discard, a run never sent
 *   POST   /runs/:id/email-payslips     `payroll` edit: Email All Payslips, an approved or paid run (202, the worker mails)
 *   POST   /runs/:id/payslips-export    `payroll` export: Download All, one PDF of the run's payslips (202, the file the
 *                                       screen waits on)
 *   POST   /runs/:id/statutory-report   `payroll` export: Statutory Report of an approved or paid advanced run (202)
 *   GET    /settings                    `payroll` view: the setting today, the version in force and the next one
 *   PATCH  /settings                    `payroll` edit and `payroll.configure`: a new version from today or later (the
 *                                       pay day, Bank Details Required, Switch On or Off, the conventions)
 *
 * Email All and Download All are written in payslips.service (the `published` guard); their routes sit here because they
 * are the run's buttons. A run is approved, sent back or rejected in its approval (/workflow/instances/:id/approve, request-changes,
 * reject), never here: whoever the stage names decides, with `payroll` approve. Locked means locked: a Submitted,
 * Approved or Paid run answers 409 RUN_NOT_EDITABLE to everything but its approval and Mark Paid.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const controller = require("./payroll.controller");

const router = express.Router();
const p = c.payroll;
const byId = { params: c.common.IdParams };

route(router, "get", "/runs", { query: p.PayrollRunListQuery, response: p.PayrollRunPage, summary: "Payroll runs, newest month first" },
  requirePermission("payroll", "view"), controller.list);

route(router, "get", "/runs/summary", { response: p.PayrollRunSummary, summary: "The run to show first, the runs by status and the trend" },
  requirePermission("payroll", "view"), controller.summary);

route(router, "post", "/runs", { body: p.PayrollRunCreate, response: p.PayrollRun, summary: "Open a run for a month" },
  requirePermission("payroll", "create"), controller.create);

route(router, "get", "/runs/:id", { ...byId, response: p.PayrollRun, summary: "One payroll run" },
  requirePermission("payroll", "view"), controller.get);

route(router, "post", "/runs/:id/compute", { ...byId, body: c.common.EmptyBody, response: p.PayrollRun, summary: "Compute every payslip of a run" },
  requirePermission("payroll", "edit"), controller.compute);

route(router, "get", "/runs/:id/problems", { ...byId, query: c.common.PageQuery, response: p.PayrollProblemPage, summary: "What stands in the way of a run" },
  requirePermission("payroll", "view"), controller.problems);

route(router, "post", "/runs/:id/submit", { ...byId, body: p.PayrollRunSubmit, response: p.PayrollRun, summary: "Send a run to the CEO for approval" },
  requirePermission("payroll", "edit"), controller.submit);

route(router, "post", "/runs/:id/mark-paid", { ...byId, body: p.PayrollRunPaid, response: p.PayrollRun, summary: "Record that an approved run was paid" },
  requirePermission("payroll", "edit"), controller.markPaid);

route(router, "post", "/runs/:id/exclude", { ...byId, body: p.PayrollRunExclude, response: p.PayrollRun, summary: "Leave a person out of a run" },
  requirePermission("payroll", "edit"), controller.exclude);

route(router, "post", "/runs/:id/include", { ...byId, body: p.PayrollRunInclude, response: p.PayrollRun, summary: "Put an excluded person back into a run" },
  requirePermission("payroll", "edit"), controller.include);

route(router, "get", "/runs/:id/adjustments", { ...byId, query: c.common.PageQuery, response: p.PayrollAdjustmentPage, summary: "A run's adjustments" },
  requirePermission("payroll", "view"), controller.adjustments);

route(router, "post", "/runs/:id/adjustments", { ...byId, body: p.PayrollAdjustmentAdd, response: p.PayrollAdjustment, summary: "Add a one-off earning or deduction to a run" },
  requirePermission("payroll", "edit"), controller.addAdjustment);

route(router, "delete", "/runs/:id/adjustments/:adjustment_id", { params: p.PayrollAdjustmentParams, no_content: true, summary: "Take an adjustment off a run" },
  requirePermission("payroll", "edit"), controller.removeAdjustment);

route(router, "delete", "/runs/:id", { ...byId, no_content: true, summary: "Discard a run that was never sent" },
  requirePermission("payroll", "delete"), controller.discard);

route(router, "post", "/runs/:id/email-payslips", { ...byId, body: p.PayslipEmailAll, response: c.payslips.PayslipEmailQueued, summary: "Email every payslip of an approved run" },
  requirePermission("payroll", "edit"), controller.emailPayslips);

route(router, "post", "/runs/:id/payslips-export", { ...byId, body: c.common.EmptyBody, response: c.documents.ExportFile, summary: "Download every payslip of an approved run as one PDF" },
  requirePermission("payroll", "export"), controller.payslipsExport);

route(router, "post", "/runs/:id/statutory-report", { ...byId, body: c.common.EmptyBody, response: c.documents.ExportFile, summary: "The statutory report of an approved advanced run" },
  requirePermission("payroll", "export"), controller.statutoryReport);

route(router, "get", "/settings", { response: p.PayrollSettings, summary: "The payroll setting: pay day, bank rule, the advanced option" },
  requirePermission("payroll", "view"), controller.settings);

route(router, "patch", "/settings", { body: p.PayrollSettingsChange, response: p.PayrollSettings, summary: "Change the payroll setting from a date" },
  requirePermission("payroll", "edit"), requireCapability("payroll.configure"), controller.changeSettings);

module.exports = { basePath: "/payroll", surface: "staff", router };
