"use strict";
/**
 * /api/v1/home: Home's reports, their schedules and the files they produce
 * (docs/guides/home.md §5). The Overview, Team and Alerts mount their own routers at the same
 * base path; the Overview Export (POST /overview/export) is the Overview's.
 *
 *   GET   /reports                 `home` view, `home.reports`: a page of 25
 *   GET   /reports/summary         as above: Scheduled, Paused, Runs This Month, Recipients
 *   GET   /reports/:id             as above: one report (404 when the reader may not see it)
 *   POST  /reports                 as above: a report, with a schedule or on demand
 *   PATCH /reports/:id             as above, its owner or the CEO: name, filters, sharing, schedule
 *   PATCH /reports/:id/schedule    as above: Pause or Resume
 *   POST  /reports/:id/archive     as above: archived, its schedule stopped, its runs kept
 *   POST  /reports/:id/run         as above, and the report's source: Run Now, one pending file
 *   GET   /report-runs             as above: Recent Runs, a page of 25, newest first
 *   GET   /report-runs/:id         as above: one run on the reader's Recent Runs (404 otherwise)
 *
 * Every login holds `home` view, so the reports a reader sees are decided in the service; the
 * capability opens the tab and sets no scope. A literal path is defined before the `/:id`
 * beside it.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const controller = require("./reports.controller");

const router = express.Router();
const r = c.reports;
const view = requirePermission("home", "view");
const reports = requireCapability("home.reports");

route(router, "get", "/reports",
  { query: r.HomeReportQuery, response: r.HomeReportPage, summary: "The reports I may see" },
  view, reports, controller.list);

route(router, "get", "/reports/summary",
  { response: r.HomeReportSummary, summary: "The counts over the reports I may see" },
  view, reports, controller.summary);

route(router, "get", "/reports/:id",
  { params: c.common.IdParams, response: r.HomeReport, summary: "One report" },
  view, reports, controller.get);

route(router, "post", "/reports",
  { body: r.HomeReportCreate, response: r.HomeReport, summary: "Build a report" },
  view, reports, controller.create);

route(router, "patch", "/reports/:id",
  { params: c.common.IdParams, body: r.HomeReportUpdate, response: r.HomeReport,
    summary: "Change a report or its schedule" },
  view, reports, controller.update);

route(router, "patch", "/reports/:id/schedule",
  { params: c.common.IdParams, body: r.HomeReportScheduleState, response: r.HomeReport,
    summary: "Pause or resume a report's schedule" },
  view, reports, controller.setActive);

route(router, "post", "/reports/:id/archive",
  { params: c.common.IdParams, body: c.common.EmptyBody, response: r.HomeReport, summary: "Archive a report" },
  view, reports, controller.archive);

route(router, "post", "/reports/:id/run",
  { params: c.common.IdParams, body: r.HomeReportRunNow, response: r.HomeReportRun,
    summary: "Run a report now, for me" },
  view, reports, controller.runNow);

route(router, "get", "/report-runs",
  { query: r.HomeReportRunQuery, response: r.HomeReportRunPage, summary: "The report files I received or own" },
  view, reports, controller.runs);

route(router, "get", "/report-runs/:id",
  { params: c.common.IdParams, response: r.HomeReportRun, summary: "One report file I received or own" },
  view, reports, controller.getRun);

module.exports = { basePath: "/home", surface: "staff", router };
