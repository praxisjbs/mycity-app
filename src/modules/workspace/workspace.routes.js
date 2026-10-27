"use strict";
/**
 * /api/v1/workspace: My Workspace · Today, Analytics and the week (docs/guides/workspace.md §5;
 * docs/guides/performance.md §6.18).
 *
 *   GET  /today        `workspace` view: the caller's own day
 *   GET  /analytics    `workspace` view: the caller's, or their reporting line's within scope
 *   POST /analytics/export      `workspace` export: the figures as a file, a run of Home's
 *                               reports engine answered pending (202)
 *   GET  /analytics/export/:id  `workspace` export: one of the caller's own Analytics exports,
 *                               which the screen that pressed waits on to download it
 *   GET  /week         `workspace` view: the caller's week, or someone's in their scope
 *   PUT  /week         `workspace` view: the caller's own Support Needed and accepted summary
 *   GET  /team-weeks   `workspace` view: one row per person in scope but the caller
 *   POST /week/tidy    `workspace` view: one Tidy With AI over the caller's week
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./workspace.controller");

const router = express.Router();

route(router, "get", "/today",
  { response: c.workspace.TodayView, summary: "The caller's day" },
  requirePermission("workspace", "view"), controller.today);

route(router, "get", "/analytics",
  { query: c.workspace.AnalyticsQuery, response: c.workspace.WorkspaceAnalytics, summary: "How work is moving" },
  requirePermission("workspace", "view"), controller.analytics);

route(router, "post", "/analytics/export",
  { body: c.reports.WorkspaceAnalyticsExport, response: c.reports.HomeReportRun, summary: "Export my Workspace Analytics" },
  requirePermission("workspace", "export"), controller.exportAnalytics);

route(router, "get", "/analytics/export/:id",
  { params: c.common.IdParams, response: c.reports.HomeReportRun, summary: "One of my Workspace Analytics exports" },
  requirePermission("workspace", "export"), controller.analyticsExport);

route(router, "get", "/week",
  { query: c.workspace.WeekQuery, response: c.workspace.WeekView, summary: "A person's week" },
  requirePermission("workspace", "view"), controller.week);

route(router, "put", "/week",
  { body: c.workspace.WeekSave, response: c.workspace.WeekView, summary: "Save the week's Support Needed and summary" },
  requirePermission("workspace", "view"), controller.saveWeek);

route(router, "get", "/team-weeks",
  { query: c.workspace.TeamWeekQuery, response: c.workspace.TeamWeekPage, summary: "Team This Week" },
  requirePermission("workspace", "view"), controller.teamWeeks);

route(router, "post", "/week/tidy",
  { body: c.reviews.TidyRequest, response: c.reviews.TidyResult, summary: "Tidy the week into a summary" },
  requirePermission("workspace", "view"), controller.tidyWeek);

module.exports = { basePath: "/workspace", surface: "staff", router };
