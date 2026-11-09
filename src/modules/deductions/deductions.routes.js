"use strict";
/**
 * /api/v1/deductions: Payroll · Deductions (docs/guides/payroll.md §5, §6.6). The tab lists one page of three
 * kinds of money that come off pay, and its buttons move them.
 *
 *   GET  /, /summary                      `payroll` view: the union of waiting attendance deductions, fines and
 *                                         advances, 25 a page; the figures above it and the open month
 *   POST /fines/:sanction_fine_id/accept  `payroll` edit: Accept This Month (one) or Spread Over Months
 *   POST /fines/:sanction_fine_id/waive   `payroll` edit: Waive a pending fine, with a reason
 *   POST /:id/release                     `payroll` edit: an accepted fine goes back to waiting, before any month is taken
 *   POST /advances                        `payroll` create: Record Advance
 *   POST /:id/cancel                      `payroll` edit: Cancel Advance, before any month is taken
 *
 * Never your own: nobody accepts, waives, releases, records or cancels a deduction for themselves (403
 * OWN_RECORD). An attendance deduction is listed here and waived on People · Attendance.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./deductions.controller");

const router = express.Router();
const d = c.deductions;

route(router, "get", "/", { query: d.DeductionListQuery, response: d.DeductionPage, summary: "Deductions: waiting attendance deductions, fines and advances" },
  requirePermission("payroll", "view"), controller.list);

route(router, "get", "/summary", { response: d.DeductionSummary, summary: "Pending fines, pending attendance, active and recovered this year" },
  requirePermission("payroll", "view"), controller.summary);

route(router, "post", "/fines/:sanction_fine_id/accept", { params: d.FineParams, body: d.DeductionAccept, response: d.DeductionRow, summary: "Accept a fine for this month or spread it over months" },
  requirePermission("payroll", "edit"), controller.accept);

route(router, "post", "/fines/:sanction_fine_id/waive", { params: d.FineParams, body: d.DeductionWaive, response: d.DeductionRow, summary: "Waive a pending fine" },
  requirePermission("payroll", "edit"), controller.waive);

route(router, "post", "/advances", { body: d.AdvanceRecord, response: d.DeductionRow, summary: "Record a salary advance and the months it is recovered over" },
  requirePermission("payroll", "create"), controller.record);

route(router, "post", "/:id/release", { params: c.common.IdParams, body: d.DeductionWaive, response: d.DeductionRow, summary: "Send an accepted fine back to waiting" },
  requirePermission("payroll", "edit"), controller.release);

route(router, "post", "/:id/cancel", { params: c.common.IdParams, body: d.AdvanceCancel, response: d.DeductionRow, summary: "Cancel an advance recorded in error" },
  requirePermission("payroll", "edit"), controller.cancel);

module.exports = { basePath: "/deductions", surface: "staff", router };
