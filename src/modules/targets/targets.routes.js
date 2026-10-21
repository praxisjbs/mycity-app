"use strict";
/**
 * /api/v1/performance/targets and /plans: Performance · Targets and a department's month
 * (A16; docs/guides/performance.md §5).
 *
 *   GET  /targets, /targets/summary                  `performance` view · scope by department
 *   POST /targets                                    `performance` create, goals.department: own department
 *   POST /plans/:department_id/:month/submit         `performance` create, goals.department: the month
 *   POST /plans/:id/decide                           `performance` approve: the stage's approver
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const controller = require("./targets.controller");

const router = express.Router();
const t = c.targets;

route(router, "get", "/targets",
  { query: t.TargetListQuery, response: t.TargetPage, summary: "A month's departmental targets" },
  requirePermission("performance", "view"), controller.list);

route(router, "get", "/targets/summary",
  { query: t.TargetSummaryQuery, response: t.TargetsSummary, summary: "A month's plans, chain, results and trail" },
  requirePermission("performance", "view"), controller.summary);

route(router, "post", "/targets",
  { body: t.TargetCreate, response: t.Target, summary: "Set a departmental target" },
  requirePermission("performance", "create"), requireCapability("goals.department"), controller.create);

route(router, "post", "/plans/:department_id/:month/submit",
  { params: t.PlanParams, body: c.common.EmptyBody, response: t.Plan, summary: "Send a department's month for approval" },
  requirePermission("performance", "create"), requireCapability("goals.department"), controller.submitPlan);

route(router, "post", "/plans/:id/decide",
  { params: c.common.IdParams, body: c.goals.DecideBody, response: t.Plan, summary: "Approve or return a department's month" },
  requirePermission("performance", "approve"), controller.decidePlan);

module.exports = { basePath: "/performance", surface: "staff", router };
