"use strict";
/**
 * /api/v1/statutory: the statutory rates (docs/guides/payroll.md §5, §6.12). They are read and entered whatever the
 * advanced option's state, so the first rates are in force before it is first switched on (§13.1 item 25).
 *
 *   GET  /rates   `payroll` view: with `as_of`, the rows in force that day; without, today's and those starting later
 *   POST /rates   `payroll` edit and `payroll.configure`: a version of one item from today or later
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

route(router, "get", "/rates", { query: s.StatutoryRateListQuery, response: s.StatutoryRatePage, summary: "Statutory rates, PAYE bands and the relief" },
  requirePermission("payroll", "view"), controller.list);

route(router, "post", "/rates", { body: s.StatutoryRatesSave, response: s.StatutoryRatePage, summary: "Enter a version of a statutory item from a date" },
  requirePermission("payroll", "edit"), requireCapability("payroll.configure"), controller.save);

module.exports = { basePath: "/statutory", surface: "staff", router };
