"use strict";
/**
 * /api/v1/performance/goals: Performance · Goals (A16; docs/guides/performance.md §5).
 *
 *   GET   /, /summary, /:id        `performance` view: every goal, the cascade, Goal Progress
 *   POST  /                        `performance` create, goals.organisation or goals.company
 *                                  (the service checks the one the level needs)
 *   PATCH /:id                     `performance` edit: a draft or returned goal
 *   POST  /:id/submit              `performance` create: an annual or monthly goal into approval
 *   POST  /:id/decide              `performance` approve: the stage's approver
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability, requireAnyCapability } = require("../../middleware/rbac");
const controller = require("./goals.controller");

const router = express.Router();
const g = c.goals;
const one = { params: c.common.IdParams };

route(router, "get", "/",
  { query: g.GoalListQuery, response: g.GoalPage, summary: "Goals, one level or all" },
  requirePermission("performance", "view"), controller.list);

route(router, "get", "/summary",
  { query: g.GoalsSummaryQuery, response: g.GoalsSummary, summary: "The cascade and Goal Progress for a year" },
  requirePermission("performance", "view"), controller.summary);

route(router, "get", "/:id",
  { ...one, response: g.GoalDetail, summary: "One goal: its cascade, trace, children and approval" },
  requirePermission("performance", "view"), controller.get);

route(router, "post", "/",
  { body: g.GoalCreate, response: g.Goal, summary: "Set an organisational, annual or monthly goal" },
  requirePermission("performance", "create"),
  requireAnyCapability(["goals.organisation", "goals.company"]),
  controller.create);

route(router, "patch", "/:id",
  { ...one, body: g.GoalEdit, response: g.GoalDetail, summary: "Change a draft or returned goal" },
  requirePermission("performance", "edit"), controller.edit);

route(router, "post", "/:id/submit",
  { ...one, body: c.common.EmptyBody, response: g.GoalDetail, summary: "Send a goal for approval" },
  requirePermission("performance", "create"), requireCapability("goals.company"), controller.submit);

route(router, "post", "/:id/decide",
  { ...one, body: g.DecideBody, response: g.GoalDetail, summary: "Approve or return a goal" },
  requirePermission("performance", "approve"), controller.decide);

module.exports = { basePath: "/performance/goals", surface: "staff", router };
