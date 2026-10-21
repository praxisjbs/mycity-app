"use strict";
/**
 * /api/v1/performance/kpis: Performance · KPIs (A16; docs/guides/performance.md §5).
 *
 *   GET  /, /summary                 `performance` view · scope on the person
 *   GET  /employees/:id              `performance` view · scope: one person's month
 *   PUT  /employees/:id              `performance` create, kpis.assign: their draft KPIs for a month
 *   POST /:id/actual                 `performance` edit: a manual KPI's figure (the person or setter)
 *   GET  /:id/trace                  `performance` view · scope: Rolls Up To
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const controller = require("./kpis.controller");

const router = express.Router();
const k = c.kpis;
const one = { params: c.common.IdParams };

route(router, "get", "/",
  { query: k.KpiListQuery, response: k.KpiPage, summary: "A month's KPIs, person by person" },
  requirePermission("performance", "view"), controller.list);

route(router, "get", "/summary",
  { query: k.KpiSummaryQuery, response: k.KpisSummary, summary: "The figures above the KPIs" },
  requirePermission("performance", "view"), controller.summary);

route(router, "get", "/employees/:id",
  { ...one, query: k.KpiMonthQuery, response: k.EmployeeKpis, summary: "One person's KPIs for a month" },
  requirePermission("performance", "view"), controller.ofEmployee);

route(router, "put", "/employees/:id",
  { ...one, body: k.KpiAssign, response: k.EmployeeKpis, summary: "Set one person's KPIs for a month" },
  requirePermission("performance", "create"), requireCapability("kpis.assign"), controller.assign);

route(router, "post", "/:id/actual",
  { ...one, body: k.KpiActual, response: k.Kpi, summary: "Record a manual KPI's figure" },
  requirePermission("performance", "edit"), controller.actual);

route(router, "get", "/:id/trace",
  { ...one, response: k.KpiTrace, summary: "What a KPI rolls up to" },
  requirePermission("performance", "view"), controller.trace);

module.exports = { basePath: "/performance/kpis", surface: "staff", router };
