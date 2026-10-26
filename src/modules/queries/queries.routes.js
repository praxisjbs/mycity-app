"use strict";
/**
 * /api/v1/queries: Queries & Sanctions · Queries (docs/guides/queries.md §5).
 *
 *   GET  /, /summary, /:id      `queries` view: scope all sees every query, anyone else
 *                               only the ones they raised (queries.visibility.js)
 *   POST /                      `queries` create: raise a query
 *   POST /:id/remind            `queries` create: Send Reminder
 *   POST /:id/decision          `queries` edit: close with no action, or propose a sanction
 *
 * A proposed sanction is approved or rejected in its approval (/workflow/instances/:id),
 * never here. The employee's own queries are under /ess/queries.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./queries.controller");

const router = express.Router();
const qs = c.queries;

route(router, "get", "/summary",
  { response: qs.QueriesSummary, summary: "The figures above Queries" },
  requirePermission("queries", "view"), controller.summary);

route(router, "get", "/",
  { query: qs.QueryListQuery, response: qs.QueryPage, summary: "Queries the reader may see" },
  requirePermission("queries", "view"), controller.list);

route(router, "get", "/policies",
  { query: qs.CitablePolicyListQuery, response: qs.CitablePolicyPage, summary: "Policies a query or rule may cite" },
  requirePermission("queries", "view"), controller.policies);

route(router, "get", "/:id",
  { params: c.common.IdParams, response: qs.QueryDetail, summary: "One query" },
  requirePermission("queries", "view"), controller.get);

route(router, "post", "/",
  { body: qs.QueryCreate, response: qs.QueryDetail, summary: "Raise a query" },
  requirePermission("queries", "create"), controller.raise);

route(router, "post", "/:id/remind",
  { params: c.common.IdParams, body: c.common.EmptyBody, response: qs.QueryDetail,
    summary: "Remind the employee to respond" },
  requirePermission("queries", "create"), controller.remind);

route(router, "post", "/:id/decision",
  { params: c.common.IdParams, body: qs.QueryDecision, response: qs.QueryDetail,
    summary: "Close a query with no action, or propose a sanction" },
  requirePermission("queries", "edit"), controller.decide);

module.exports = { basePath: "/queries", surface: "staff", router };
