"use strict";
/**
 * /api/v1/system-health: Settings · System Health. Reading needs `system_health` view,
 * acting on a fault needs edit, and downloading a brief needs export, because the file
 * carries stack traces and leaves the building.
 *
 * The readiness checks themselves stay on the unauthenticated /api/health/ready, which
 * the proxy and the uptime probe call. This module reads the same probes and adds the
 * words, the history and the faults.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./system_health.controller");

const router = express.Router();
const view = requirePermission("system_health", "view");
const edit = requirePermission("system_health", "edit");
const exportFaults = requirePermission("system_health", "export");

route(router, "get", "/status",
  { response: c.system_health.SystemHealthStatus, summary: "Every readiness check as it stands now" },
  view, controller.status);

route(router, "get", "/performance",
  { query: c.system_health.PerformanceQuery, response: c.system_health.PerformanceSeries, summary: "How the app and the server behaved over an hour, a day, a week or a month" },
  view, controller.performance);

route(router, "get", "/capacity",
  { response: c.system_health.PerformanceCapacity, summary: "The server now: processor, memory and disk in real units, split by what uses them" },
  view, controller.capacity);

route(router, "get", "/routes",
  { query: c.system_health.RouteStatQuery, response: c.system_health.RouteStatPage, summary: "Each route over the window, slowest first" },
  view, controller.routes);

route(router, "get", "/database",
  { response: c.system_health.DatabaseSummary, summary: "This database: size, growth, connections, cache and locks" },
  view, controller.database);

route(router, "get", "/database/tables",
  { query: c.system_health.TableStatQuery, response: c.system_health.TableStatPage, summary: "This database's tables, largest first" },
  view, controller.tables);

route(router, "get", "/database/queries",
  { query: c.system_health.QueryStatQuery, response: c.system_health.QueryStatPage, summary: "The statements that took the most time, from pg_stat_statements" },
  view, controller.queries);

route(router, "get", "/background",
  { response: c.system_health.BackgroundWork, summary: "The queues, the outbox and the live workers" },
  view, controller.background);

route(router, "get", "/background/jobs",
  { query: c.system_health.JobRunQuery, response: c.system_health.JobRunPage, summary: "Every scheduler and how its runs have gone" },
  view, controller.jobs);

route(router, "get", "/processes",
  { response: c.system_health.ProcessList, summary: "People online and each live API and worker process" },
  view, controller.processes);

route(router, "get", "/targets",
  { response: c.system_health.PerformanceTargets, summary: "What Performance is judged against, and the levels Status alarms at" },
  view, controller.targets);

route(router, "put", "/targets",
  { body: c.system_health.PerformanceTargetsUpdate, response: c.system_health.PerformanceTargets, summary: "Set the targets and warning levels" },
  edit, controller.saveTargets);

route(router, "get", "/faults",
  { query: c.system_health.FaultListQuery, response: c.system_health.FaultPage, summary: "Faults, grouped, with the status the team shares" },
  view, controller.faults);

route(router, "get", "/faults/:id",
  { response: c.system_health.FaultDetail, summary: "One fault: what it is, when, and the latest occurrences" },
  view, controller.fault);

route(router, "patch", "/faults/:id",
  { body: c.system_health.FaultPatch, response: c.system_health.FaultDetail, summary: "Set a fault's status or who holds it" },
  edit, controller.patch);

route(router, "post", "/faults/:id/notes",
  { body: c.system_health.FaultNoteCreate, response: c.system_health.FaultNote, summary: "Leave a note on a fault" },
  edit, controller.note);

route(router, "post", "/faults/bulk",
  { body: c.system_health.FaultBulkStatus, response: c.system_health.FaultBulkResult, summary: "Set one status on several faults" },
  edit, controller.bulk);

route(router, "post", "/briefs",
  { body: c.system_health.BriefRequest, response: c.documents.ExportFile, summary: "Download the ticked faults as a brief for an AI" },
  exportFaults, controller.brief);

module.exports = { basePath: "/system-health", surface: "staff", router };
