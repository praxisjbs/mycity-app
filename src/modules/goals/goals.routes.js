"use strict";
/**
 * /api/v1/performance: quarters, organisational goals, the OKR tree, Report Month, plans and target
 * changes (docs/guides/performance.md §5). The service checks whose function a write is for
 * (goals.authority.js); a route checks the grant and the capability.
 *
 *   GET   /periods · /periods/current · /periods/:id      `performance` view
 *   POST  /periods · PATCH /periods/:id                    create · edit, performance.manage
 *   GET   /goals · /goals/:id                              `performance` view
 *   POST  /goals · PATCH · DELETE /goals/:id               create · edit · delete, goals.organisation
 *   GET   /okrs                                            `performance` view: 25 objectives a page, with their key results
 *   GET   /okrs/summary                                    `performance` view: the figures over the quarter or a function
 *   GET   /objectives/:id                                  `performance` view: one objective, with its key results
 *   POST  /objectives · PATCH · DELETE /objectives/:id     goals.company or goals.function: a draft plan only
 *   GET   /key-results                                     `performance` view: a quarter's key results for a picker
 *   POST  /key-results · PATCH · DELETE /key-results/:id   as objectives; a binding TBC target by its owner or head
 *   GET   /key-results/:id · /key-results/:id/trace        `performance` view
 *   POST  /reports                                         `performance` edit: the head, or the accountable person
 *   POST  /key-results/:id/confirm                         `performance` approve, goals.confirm
 *   GET   /plans · /plans/:id                              `performance` view
 *   GET   /functions                                       `performance` view: the company and each function, may the reader set it
 *   POST  /plans/:id/submit                                `performance` create, goals.company or goals.function
 *   GET   /target-changes · POST /target-changes           view (a line's within scope) · edit: opens performance.target_change
 *   GET   /target-changes/:id                              `performance` view: one change, named in full
 *   GET   /approvals                                       `performance` view: plan stages and target changes waiting on the reader
 *   GET   /analytics · /analytics/people                   `performance` view: the quarter's figures and its people, in scope
 *   POST  /analytics/people/export                         `performance` export: the people table as a workbook (202)
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability, requireAnyCapability } = require("../../middleware/rbac");
const controller = require("./goals.controller");

const router = express.Router();
const g = c.goals;
const view = requirePermission("performance", "view");
const setsGoals = requireAnyCapability(["goals.company", "goals.function"]);
const id = c.common.IdParams;

route(router, "get", "/periods", { query: g.PeriodListQuery, response: g.PeriodPage, summary: "Quarters" }, view, controller.periods);
route(router, "get", "/periods/current", { response: g.PerformancePeriod, summary: "The current quarter" }, view, controller.currentPeriod);
route(router, "get", "/periods/:id", { params: id, response: g.PerformancePeriod, summary: "One quarter" }, view, controller.period);
route(router, "post", "/periods",
  { body: g.PeriodCreate, response: g.PerformancePeriod, summary: "Set up a quarter" },
  requirePermission("performance", "create"), requireCapability("performance.manage"), controller.createPeriod);
route(router, "patch", "/periods/:id",
  { params: id, body: g.PeriodEdit, response: g.PerformancePeriod, summary: "Change a quarter's dates, rules or status" },
  requirePermission("performance", "edit"), requireCapability("performance.manage"), controller.updatePeriod);

route(router, "get", "/goals", { query: g.GoalListQuery, response: g.OrganisationalGoalPage, summary: "Organisational goals" }, view, controller.goals);
route(router, "get", "/goals/:id", { params: id, response: g.OrganisationalGoalDetail, summary: "One organisational goal" }, view, controller.goal);
route(router, "post", "/goals",
  { body: g.OrganisationalGoalCreate, response: g.OrganisationalGoal, summary: "Record an organisational goal" },
  requirePermission("performance", "create"), requireCapability("goals.organisation"), controller.createGoal);
route(router, "patch", "/goals/:id",
  { params: id, body: g.OrganisationalGoalEdit, response: g.OrganisationalGoal, summary: "Change an organisational goal" },
  requirePermission("performance", "edit"), requireCapability("goals.organisation"), controller.updateGoal);
route(router, "delete", "/goals/:id",
  { params: id, no_content: true, summary: "Remove an organisational goal no company objective serves" },
  requirePermission("performance", "delete"), requireCapability("goals.organisation"), controller.deleteGoal);

route(router, "get", "/okrs", { query: g.OkrListQuery, response: g.ObjectivePage, summary: "The OKR tree" }, view, controller.okrs);
route(router, "get", "/okrs/summary", { query: g.OkrSummaryQuery, response: g.OkrSummary, summary: "The Goals figures" }, view, controller.okrSummary);
route(router, "get", "/objectives/:id", { params: id, response: g.Objective, summary: "One objective" }, view, controller.objective);
route(router, "post", "/objectives",
  { body: g.ObjectiveCreate, response: g.Objective, summary: "Set an objective" },
  requirePermission("performance", "create"), setsGoals, controller.createObjective);
route(router, "patch", "/objectives/:id",
  { params: id, body: g.ObjectiveEdit, response: g.Objective, summary: "Change an objective" },
  requirePermission("performance", "edit"), setsGoals, controller.updateObjective);
route(router, "delete", "/objectives/:id",
  { params: id, no_content: true, summary: "Remove a draft objective" },
  requirePermission("performance", "edit"), setsGoals, controller.deleteObjective);

route(router, "get", "/key-results",
  { query: g.KeyResultListQuery, response: g.KeyResultRefPage, summary: "A quarter's key results, for a picker" }, view, controller.keyResults);
route(router, "post", "/key-results",
  { body: g.KeyResultCreate, response: g.KeyResult, summary: "Set a key result" },
  requirePermission("performance", "create"), setsGoals, controller.createKeyResult);
route(router, "get", "/key-results/:id", { params: id, response: g.KeyResultDetail, summary: "One key result" }, view, controller.keyResult);
route(router, "get", "/key-results/:id/trace", { params: id, response: g.Trace, summary: "What a key result rolls up to" }, view, controller.trace);
route(router, "patch", "/key-results/:id",
  { params: id, body: g.KeyResultEdit, response: g.KeyResult, summary: "Change a key result" },
  requirePermission("performance", "edit"), controller.updateKeyResult);
route(router, "delete", "/key-results/:id",
  { params: id, no_content: true, summary: "Remove a draft key result" },
  requirePermission("performance", "edit"), setsGoals, controller.deleteKeyResult);
route(router, "post", "/reports",
  { body: g.MonthReport, response: g.MonthReportResult, summary: "Report a function's month" },
  requirePermission("performance", "edit"), controller.report);
route(router, "post", "/key-results/:id/confirm",
  { params: id, body: g.ConfirmScore, response: g.KeyResultMonth, summary: "Confirm a key result's score" },
  requirePermission("performance", "approve"), requireCapability("goals.confirm"), controller.confirm);

route(router, "get", "/plans", { query: g.PlanListQuery, response: g.PlanPage, summary: "Quarter plans" }, view, controller.plans);
route(router, "get", "/functions",
  { query: g.PerformanceFunctionListQuery, response: g.PerformanceFunctionPage, summary: "The functions the reader may set goals and KPIs for" },
  view, controller.functions);
route(router, "get", "/plans/:id", { params: id, response: g.PlanDetail, summary: "One quarter plan" }, view, controller.plan);
route(router, "post", "/plans/:id/submit",
  { params: id, body: c.common.EmptyBody, response: g.PlanDetail, summary: "Send a plan for approval" },
  requirePermission("performance", "create"), setsGoals, controller.submitPlan);

route(router, "get", "/target-changes",
  { query: g.TargetChangeListQuery, response: g.TargetChangePage, summary: "Target changes" }, view, controller.changes);
route(router, "get", "/target-changes/:id",
  { params: id, response: g.TargetChangeDetail, summary: "One target change" }, view, controller.change);
route(router, "post", "/target-changes",
  { body: g.TargetChangeCreate, response: g.TargetChange, summary: "Ask to change a binding target" },
  requirePermission("performance", "edit"), controller.requestChange);
route(router, "get", "/approvals",
  { query: g.PerformanceApprovalQuery, response: g.PerformanceApprovalPage, summary: "Plan stages, target changes and mid-quarter scorecards waiting on you" },
  view, controller.approvals);

route(router, "get", "/analytics",
  { query: g.PerformanceAnalyticsQuery, response: g.PerformanceAnalytics, summary: "Performance Analytics" }, view, controller.analytics);
route(router, "get", "/analytics/people",
  { query: g.AnalyticsPeopleQuery, response: g.AnalyticsPersonPage, summary: "The quarter's people, by score" }, view, controller.analyticsPeople);
route(router, "post", "/analytics/people/export",
  { body: g.AnalyticsExportRequest, response: c.documents.ExportFile, summary: "Export the quarter's people as a workbook" },
  requirePermission("performance", "export"), controller.exportAnalyticsPeople);

module.exports = { basePath: "/performance", surface: "staff", router };
