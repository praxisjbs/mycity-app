"use strict";
/**
 * /api/v1/sanctions: Queries & Sanctions · Sanctions and Chain Settings (docs/guides/queries.md §5).
 *
 *   GET   /, /summary, /:id   `queries` view: sanctions whose query the reader may see
 *   GET   /standing           `queries` view, scope all: one person's rungs in force and the next
 *   GET   /chain              `queries` view: the ladder in order
 *   POST  /chain              `queries` create + queries.configure: add a rung at a position
 *   PATCH /chain/:id          `queries` edit + queries.configure: move, change or retire a rung
 *
 *   POST  /:id/approve        the approver its stage waits on (the workflow service says who);
 *                             Operations & People sign it there (guide §6.4)
 *   POST  /:id/reject         the same approver, with a reason
 *
 * A sanction is proposed from its query (POST /queries/:id/decision).
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const controller = require("./sanctions.controller");

const router = express.Router();
const s = c.sanctions;

route(router, "get", "/summary",
  { response: s.SanctionsSummary, summary: "The figures above Sanctions" },
  requirePermission("queries", "view"), controller.summary);

route(router, "get", "/standing",
  { query: s.SanctionStandingQuery, response: s.SanctionStanding, summary: "One person's place on the chain" },
  requirePermission("queries", "view"), controller.standing);

route(router, "get", "/chain",
  { query: s.ConsequenceStepListQuery, response: s.ConsequenceStepPage, summary: "The consequence chain" },
  requirePermission("queries", "view"), controller.listChain);

route(router, "post", "/chain",
  { body: s.ConsequenceStepCreate, response: s.ConsequenceStep, summary: "Add a rung to the chain" },
  requirePermission("queries", "create"), requireCapability("queries.configure"), controller.addStep);

route(router, "patch", "/chain/:id",
  { params: c.common.IdParams, body: s.ConsequenceStepUpdate, response: s.ConsequenceStep,
    summary: "Move, change or retire a rung" },
  requirePermission("queries", "edit"), requireCapability("queries.configure"), controller.updateStep);

route(router, "get", "/",
  { query: s.SanctionListQuery, response: s.SanctionPage, summary: "Sanctions the reader may see" },
  requirePermission("queries", "view"), controller.list);

route(router, "get", "/:id",
  { params: c.common.IdParams, response: s.SanctionDetail, summary: "One sanction" },
  requirePermission("queries", "view"), controller.get);

route(router, "post", "/:id/approve",
  { params: c.common.IdParams, body: s.SanctionApprove, response: s.SanctionDetail,
    summary: "Approve the stage a sanction waits on; Operations & People sign it" },
  requirePermission("queries", "approve"), controller.approve);

route(router, "post", "/:id/reject",
  { params: c.common.IdParams, body: s.SanctionReject, response: s.SanctionDetail,
    summary: "Reject a proposed sanction, saying why" },
  requirePermission("queries", "approve"), controller.reject);

module.exports = { basePath: "/sanctions", surface: "staff", router };
