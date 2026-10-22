"use strict";
/**
 * /api/v1/performance: scorecards, the contribution check and commitments
 * (docs/guides/performance.md §5).
 *
 *   GET   /scorecards               `performance` view · own, team, all, and those naming the reader
 *   GET   /scorecards/:id           `performance` view · scope, or its reviewer or dotted manager
 *   POST  /scorecards               `performance` create · team or all, never one's own
 *   PUT   /scorecards/:id/lines     `performance` edit · scope: a draft scorecard of a draft plan
 *   PATCH /scorecards/:id           `performance` edit · scope; the reviewer needs performance.manage
 *   POST  /scorecards/:id/agree     `performance` view: the employee or the reviewer
 *   POST  /scorecards/:id/disagree  `performance` view: the employee or the reviewer
 *   POST  /scorecards/:id/submit    `performance` edit · scope: a scorecard drafted after its plan bound
 *   GET   /contributions            `performance` view: a plan's split key results, OK or Rebalance
 *
 *   GET   /commitments              `performance` view · own, team, all, or those waiting on the reader
 *   GET   /commitments/summary      `performance` view · scope: a month's figures
 *   GET   /commitments/sets         `performance` view · scope, or waiting on the reader: Waiting On You
 *   POST  /commitments/sets/:employee_id/:month/submit   `workspace` edit: the person or their manager
 *   POST  /commitments/report       `performance` export: the month-end delivery report (202)
 *   POST  /commitments/:id/rescope  `workspace` edit: the person or their manager
 *   POST  /commitments/:id/recovery `workspace` create: a Recovery task for a missed commitment
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

route(router, "post", "/scorecards/:id/submit",
  { params: c.common.IdParams, body: c.common.EmptyBody, response: t.ScorecardDetail, summary: "Send a mid-quarter scorecard for approval" },
  requirePermission("performance", "edit"), controller.submit);

route(router, "get", "/contributions",
  { query: t.ContributionQuery, response: t.ContributionPage, summary: "Split key results and their shares" },
  requirePermission("performance", "view"), controller.contributions);

route(router, "get", "/commitments",
  { query: t.CommitmentListQuery, response: t.CommitmentPage, summary: "A month's commitments" },
  requirePermission("performance", "view"), controller.commitments);

route(router, "get", "/commitments/summary",
  { query: t.CommitmentSummaryQuery, response: t.CommitmentSummary, summary: "A month's commitments by state" },
  requirePermission("performance", "view"), controller.commitmentSummary);

route(router, "get", "/commitments/sets",
  { query: t.CommitmentSetListQuery, response: t.CommitmentSetPage, summary: "People's months of commitments" },
  requirePermission("performance", "view"), controller.commitmentSets);

route(router, "post", "/commitments/sets/:employee_id/:month/submit",
  { params: t.CommitmentSetParams, body: c.common.EmptyBody, response: t.CommitmentSetRow, summary: "Send a month's commitments" },
  requirePermission("workspace", "edit"), controller.submitCommitments);

route(router, "post", "/commitments/report",
  { body: t.CommitmentReportRequest, response: c.documents.ExportFile, summary: "The month-end delivery report" },
  requirePermission("performance", "export"), controller.commitmentReport);

route(router, "post", "/commitments/:id/rescope",
  { params: c.common.IdParams, body: t.CommitmentRescope, response: t.Commitment, summary: "Ask to rescope a commitment" },
  requirePermission("workspace", "edit"), controller.rescope);

route(router, "post", "/commitments/:id/recovery",
  { params: c.common.IdParams, body: t.CommitmentRecovery, response: t.Commitment, summary: "Set a missed commitment's recovery" },
  requirePermission("workspace", "create"), controller.recovery);

module.exports = { basePath: "/performance", surface: "staff", router };
