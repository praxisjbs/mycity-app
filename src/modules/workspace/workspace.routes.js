"use strict";
/**
 * /api/v1/workspace: My Workspace · Today and Analytics (docs/guides/workspace.md §5).
 *
 *   GET /today       `workspace` view: the caller's own day
 *   GET /analytics   `workspace` view: the caller's, or their reporting line's within scope
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

module.exports = { basePath: "/workspace", surface: "staff", router };
