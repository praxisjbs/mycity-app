"use strict";
/**
 * /api/v1/query-rules: Queries & Sanctions · Rules (docs/guides/queries.md §5).
 *
 *   GET   /, /summary          `queries` view
 *   GET   /firings             `queries` view: the queries rules raised, within the visibility rule
 *   POST  /                    `queries` create + queries.configure: a draft
 *   PATCH /:id                 `queries` edit + queries.configure
 *   POST  /:id/activate, pause `queries` edit + queries.configure
 *   DELETE /:id                 `queries` edit + queries.configure; only a rule that never fired
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const controller = require("./query_rules.controller");

const router = express.Router();
const r = c.query_rules;

route(router, "get", "/summary",
  { response: r.QueryRulesSummary, summary: "The figures above Rules" },
  requirePermission("queries", "view"), controller.summary);

route(router, "get", "/firings",
  { query: r.QueryRuleFiringListQuery, response: r.QueryRuleFiringPage, summary: "Queries the rules raised" },
  requirePermission("queries", "view"), controller.firings);

route(router, "get", "/",
  { query: r.QueryRuleListQuery, response: r.QueryRulePage, summary: "Query rules" },
  requirePermission("queries", "view"), controller.list);

route(router, "post", "/",
  { body: r.QueryRuleCreate, response: r.QueryRule, summary: "Add a query rule, as a draft" },
  requirePermission("queries", "create"), requireCapability("queries.configure"), controller.create);

route(router, "patch", "/:id",
  { params: c.common.IdParams, body: r.QueryRuleUpdate, response: r.QueryRule, summary: "Change a query rule" },
  requirePermission("queries", "edit"), requireCapability("queries.configure"), controller.update);

route(router, "post", "/:id/activate",
  { params: c.common.IdParams, body: c.common.EmptyBody, response: r.QueryRule, summary: "Switch a rule on" },
  requirePermission("queries", "edit"), requireCapability("queries.configure"), controller.activate);

route(router, "post", "/:id/pause",
  { params: c.common.IdParams, body: c.common.EmptyBody, response: r.QueryRule, summary: "Pause a rule" },
  requirePermission("queries", "edit"), requireCapability("queries.configure"), controller.pause);

route(router, "delete", "/:id",
  { params: c.common.IdParams, no_content: true, summary: "Delete a rule that never raised a query" },
  requirePermission("queries", "edit"), requireCapability("queries.configure"), controller.remove);

module.exports = { basePath: "/query-rules", surface: "staff", router };
