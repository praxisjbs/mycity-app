"use strict";
/**
 * /api/v1/performance/kpis: a function's operational KPIs (docs/guides/performance.md §5).
 *
 *   GET   /kpis               `performance` view: 25 a page, a function's or all, with the latest month
 *   GET   /kpis/summary       `performance` view: a month's Met, Not Met and awaiting over the active KPIs
 *   GET   /kpis/:id           `performance` view: its months and the scorecard lines that use it
 *   POST  /kpis               `performance` create, goals.function: the head of the function (§6.3)
 *   PATCH /kpis/:id           `performance` edit, goals.function
 *   POST  /kpis/:id/actuals   `performance` edit, goals.function: one month's Met, Not Met or N/A
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const controller = require("./kpis.controller");

const router = express.Router();
const k = c.kpis;

route(router, "get", "/kpis",
  { query: k.KpiListQuery, response: k.KpiPage, summary: "KPIs" },
  requirePermission("performance", "view"), controller.list);

route(router, "get", "/kpis/summary",
  { query: k.KpiSummaryQuery, response: k.KpiSummary, summary: "The KPIs figures" },
  requirePermission("performance", "view"), controller.summary);

route(router, "get", "/kpis/:id",
  { params: c.common.IdParams, response: k.KpiDetail, summary: "One KPI" },
  requirePermission("performance", "view"), controller.get);

route(router, "post", "/kpis",
  { body: k.KpiCreate, response: k.Kpi, summary: "Set up a KPI" },
  requirePermission("performance", "create"), requireCapability("goals.function"), controller.create);

route(router, "patch", "/kpis/:id",
  { params: c.common.IdParams, body: k.KpiEdit, response: k.Kpi, summary: "Change a KPI" },
  requirePermission("performance", "edit"), requireCapability("goals.function"), controller.update);

route(router, "post", "/kpis/:id/actuals",
  { params: c.common.IdParams, body: k.KpiActual, response: k.KpiMonth, summary: "Record a KPI's month" },
  requirePermission("performance", "edit"), requireCapability("goals.function"), controller.recordActual);

module.exports = { basePath: "/performance", surface: "staff", router };
