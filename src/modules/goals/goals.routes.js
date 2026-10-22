"use strict";
/**
 * /api/v1/performance: quarters and their rules (docs/guides/performance.md §5). PR 2 adds the
 * organisational goals, objectives, key results, reports, plans and target changes here.
 *
 *   GET   /periods            `performance` view: the quarters, 25 a page, the latest first
 *   GET   /periods/current    `performance` view: the active quarter, else the latest being planned
 *   GET   /periods/:id        `performance` view
 *   POST  /periods            `performance` create, performance.manage: copies the last quarter's rules
 *   PATCH /periods/:id        `performance` edit, performance.manage: name, lock date, live day, rules, status
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const controller = require("./goals.controller");

const router = express.Router();
const g = c.goals;

route(router, "get", "/periods",
  { query: g.PeriodListQuery, response: g.PeriodPage, summary: "Quarters" },
  requirePermission("performance", "view"), controller.periods);

route(router, "get", "/periods/current",
  { response: g.PerformancePeriod, summary: "The current quarter" },
  requirePermission("performance", "view"), controller.currentPeriod);

route(router, "get", "/periods/:id",
  { params: c.common.IdParams, response: g.PerformancePeriod, summary: "One quarter" },
  requirePermission("performance", "view"), controller.period);

route(router, "post", "/periods",
  { body: g.PeriodCreate, response: g.PerformancePeriod, summary: "Set up a quarter" },
  requirePermission("performance", "create"), requireCapability("performance.manage"), controller.createPeriod);

route(router, "patch", "/periods/:id",
  { params: c.common.IdParams, body: g.PeriodEdit, response: g.PerformancePeriod,
    summary: "Change a quarter's dates, rules or status" },
  requirePermission("performance", "edit"), requireCapability("performance.manage"), controller.updatePeriod);

module.exports = { basePath: "/performance", surface: "staff", router };
