"use strict";
/**
 * /api/v1/statutory: the statutory rates (docs/guides/payroll.md §5, §6.12). They are read and entered whatever the
 * advanced option's state, so the first rates are in force before it is first switched on (§13.1 item 25).
 *
 *   GET  /items   `payroll` view: the eight items, each with the version in force today and the next (never paged:
 *                 a fixed set the code knows)
 *   GET  /rates   `payroll` view: with `as_of`, the rows in force that day; without, today's and those starting later
 *   POST /rates   `payroll` edit and `payroll.configure`: a version of one item from today or later, with its legal
 *                 source or No Legal Source
 *   DELETE /rates/:item/versions/:effective_from   `payroll` edit and `payroll.configure`: Remove Change, a version
 *                 still waiting for its day (204); the version before it runs on
 *
 *   GET  /employees/:employee_id/pay-to-date   `payroll` view: a person's taxable pay and tax for each year before
 *                 MyCity's first statutory month, newest year first, masked as the salary is
 *   PUT  /employees/:employee_id/pay-to-date/:year   `payroll` edit and `payroll.configure`: the year's figures, made or
 *                 replaced, with the leaving certificate when there is one
 *   DELETE /employees/:employee_id/pay-to-date/:year   `payroll` edit and `payroll.configure` (204)
 *
 * A run's statutory report is asked for on the run: POST /payroll/runs/:id/statutory-report (payroll.routes.js).
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const controller = require("./statutory.controller");

const router = express.Router();
const s = c.statutory;

route(router, "get", "/rates", { query: s.StatutoryRateListQuery, response: s.StatutoryRatePage, summary: "Statutory rates, PAYE bands, rent relief and the minimum wage" },
  requirePermission("payroll", "view"), controller.list);

route(router, "get", "/items", { response: s.StatutoryItems, summary: "The eight statutory items and their versions" },
  requirePermission("payroll", "view"), controller.items);

route(router, "post", "/rates", { body: s.StatutoryRatesSave, response: s.StatutoryRatePage, summary: "Enter a version of a statutory item from a date" },
  requirePermission("payroll", "edit"), requireCapability("payroll.configure"), controller.save);

route(router, "delete", "/rates/:item/versions/:effective_from", { params: s.StatutoryVersionParams, no_content: true, summary: "Remove a statutory change still waiting for its day" },
  requirePermission("payroll", "edit"), requireCapability("payroll.configure"), controller.removeChange);

route(router, "get", "/employees/:employee_id/pay-to-date",
  { params: s.PayToDateParams, query: c.common.PageQuery, response: s.PayToDatePage, summary: "A person's pay and tax to date, by year" },
  requirePermission("payroll", "view"), controller.payToDate);

route(router, "put", "/employees/:employee_id/pay-to-date/:year",
  { params: s.PayToDateYearParams, body: s.PayToDateSave, response: s.PayToDate, summary: "Enter a person's pay and tax to date for a year" },
  requirePermission("payroll", "edit"), requireCapability("payroll.configure"), controller.savePayToDate);

route(router, "delete", "/employees/:employee_id/pay-to-date/:year",
  { params: s.PayToDateYearParams, no_content: true, summary: "Remove a person's pay and tax to date for a year" },
  requirePermission("payroll", "edit"), requireCapability("payroll.configure"), controller.removePayToDate);

module.exports = { basePath: "/statutory", surface: "staff", router };
