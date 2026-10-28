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
 *   GET, PUT /my-signature      `queries` view: the reader's saved signature (queries.signature.js)
 *
 * A proposed sanction is approved or rejected on the query's card (/sanctions/:id/approve,
 * /reject), never here. The employee's own queries are under /ess/queries.
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

route(router, "get", "/assist",
  { response: qs.AiAvailability, summary: "Whether Write With AI may answer now" },
  requirePermission("queries", "create"), controller.assistStatus);

route(router, "post", "/assist",
  { body: qs.QueryDraftRequest, response: qs.QueryDraft, summary: "Draft a query's subject and what happened; nothing is kept" },
  requirePermission("queries", "create"), controller.assist);

route(router, "get", "/policies",
  { query: qs.CitablePolicyListQuery, response: qs.CitablePolicyPage, summary: "Policies a query or rule may cite" },
  requirePermission("queries", "view"), controller.policies);

route(router, "get", "/my-signature",
  { response: qs.MySignature, summary: "The signature my letters start from" },
  requirePermission("queries", "view"), controller.mySignature);

route(router, "put", "/my-signature",
  { body: qs.MySignatureSave, response: qs.MySignature, summary: "Save the signature my letters start from" },
  requirePermission("queries", "view"), controller.saveMySignature);

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
