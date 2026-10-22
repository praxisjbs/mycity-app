"use strict";
/**
 * /api/v1/performance: scorecards and the contribution check (docs/guides/performance.md §5).
 * Commitments join in PR 4.
 *
 *   GET   /scorecards               `performance` view · own, team, all, and those naming the reader
 *   GET   /scorecards/:id           `performance` view · scope, or its reviewer or dotted manager
 *   POST  /scorecards               `performance` create · team or all, never one's own
 *   PUT   /scorecards/:id/lines     `performance` edit · scope: a draft scorecard of a draft plan
 *   PATCH /scorecards/:id           `performance` edit · scope; the reviewer needs performance.manage
 *   POST  /scorecards/:id/agree     `performance` view: the employee or the reviewer
 *   POST  /scorecards/:id/disagree  `performance` view: the employee or the reviewer
 *   GET   /contributions            `performance` view: a plan's split key results, OK or Rebalance
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./targets.controller");

const router = express.Router();
const t = c.targets;

route(router, "get", "/scorecards",
  { query: t.ScorecardListQuery, response: t.ScorecardPage, summary: "Scorecards" },
  requirePermission("performance", "view"), controller.list);

route(router, "get", "/scorecards/:id",
  { params: c.common.IdParams, response: t.ScorecardDetail, summary: "One scorecard" },
  requirePermission("performance", "view"), controller.get);

route(router, "post", "/scorecards",
  { body: t.ScorecardCreate, response: t.ScorecardDetail, summary: "Draft a scorecard" },
  requirePermission("performance", "create"), controller.create);

route(router, "put", "/scorecards/:id/lines",
  { params: c.common.IdParams, body: t.ScorecardLinesSave, response: t.ScorecardDetail, summary: "Save a scorecard's lines" },
  requirePermission("performance", "edit"), controller.saveLines);

route(router, "patch", "/scorecards/:id",
  { params: c.common.IdParams, body: t.ScorecardEdit, response: t.ScorecardDetail, summary: "Change a scorecard's scope or reviewer" },
  requirePermission("performance", "edit"), controller.update);

route(router, "post", "/scorecards/:id/agree",
  { params: c.common.IdParams, body: c.common.EmptyBody, response: t.ScorecardDetail, summary: "Agree a scorecard" },
  requirePermission("performance", "view"), controller.agree);

route(router, "post", "/scorecards/:id/disagree",
  { params: c.common.IdParams, body: t.DisagreeBody, response: t.ScorecardDetail, summary: "Disagree with a scorecard" },
  requirePermission("performance", "view"), controller.disagree);

route(router, "get", "/contributions",
  { query: t.ContributionQuery, response: t.ContributionPage, summary: "Split key results and their shares" },
  requirePermission("performance", "view"), controller.contributions);

module.exports = { basePath: "/performance", surface: "staff", router };
