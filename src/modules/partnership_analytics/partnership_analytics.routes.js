"use strict";
/**
 * Partnerships · Analytics (docs/guides/partnerships.md §5, §6.18).
 *
 *   GET /analytics    view: the period's measures by lead owner, per month, by category, region and stage
 *
 * Mounted on /api/v1/partnerships beside the other partnership modules. Export is the partnerships
 * export (`POST /partnerships/exports`, source `partnerships.analytics`). tests/unit/partnerships-
 * skeleton.test.js holds every route here to the partnerships key.
 */
const router = require("express").Router();
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./partnership_analytics.controller");

route(router, "get", "/analytics",
  { query: c.partnership_analytics.AnalyticsQuery, response: c.partnership_analytics.PartnershipAnalytics, summary: "Partnership analytics for a period" },
  requirePermission("partnerships", "view"), controller.get);

module.exports = { basePath: "/partnerships", surface: "staff", router };
