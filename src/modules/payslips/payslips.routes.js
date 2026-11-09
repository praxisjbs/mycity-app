"use strict";
/**
 * /api/v1/payslips: Payroll · Payslips (docs/guides/payroll.md §5). The month's payslips with a person's pay on
 * them, draft and published alike for a Payroll reader. Email All Payslips and Download All on a run are the
 * run's routes, under /payroll/runs; the person's own payslips are /ess/payslips (src/modules/ess).
 *
 *   GET /                              `payroll` view: 25 a page, by run, month, person, status or name
 *   GET /:id                           `payroll` view: one payslip with its lines
 *   GET /:id/lines/:line_id/items      `payroll` view: the pay items behind a grouped line, 25 a page
 *   GET /:id/pdf                       `payroll` edit: the PDF, a restricted file (409 NOT_APPROVED for a draft,
 *                                      409 NOT_READY while it renders)
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./payslips.controller");

const router = express.Router();
const s = c.payslips;
const byId = { params: c.common.IdParams };

route(router, "get", "/", { query: s.PayslipListQuery, response: s.PayslipPage, summary: "Payslips of a month or a person" },
  requirePermission("payroll", "view"), controller.list);

route(router, "get", "/:id", { ...byId, response: s.PayslipDetail, summary: "One payslip with its lines" },
  requirePermission("payroll", "view"), controller.get);

route(router, "get", "/:id/lines/:line_id/items", { params: s.PayslipLineParams, query: c.common.PageQuery, response: s.PayslipLineItemPage, summary: "What stands behind a payslip line" },
  requirePermission("payroll", "view"), controller.lineItems);

route(router, "get", "/:id/pdf", { ...byId, no_content: true, summary: "A payslip's PDF" },
  requirePermission("payroll", "edit"), controller.pdf);

module.exports = { basePath: "/payslips", surface: "staff", router };
