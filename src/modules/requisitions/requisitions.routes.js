"use strict";
/**
 * /api/v1/requisitions: Operations & People's batch of approved requests for the CEO
 * (docs/guides/expenses.md §5, §6.4).
 *
 *   GET   /              `expenses` view and `expenses.finance` (the CEO passes): the requisitions
 *   POST  /              `expenses` create and `expenses.finance`: Create Requisition, 1 to 25
 *   GET   /:id           `expenses` view and `expenses.finance`: one, with its requests
 *   POST  /:id/remove    `expenses` approve: whoever its stage names (the CEO) takes a request out
 *
 * The CEO approves or rejects a requisition in its approval (/workflow/instances/:id/approve,
 * reject), never here.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const controller = require("./requisitions.controller");

const router = express.Router();
const r = c.requisitions;

route(router, "get", "/",
  { query: r.RequisitionListQuery, response: r.RequisitionPage, summary: "Requisitions" },
  requirePermission("expenses", "view"), requireCapability("expenses.finance"), controller.list);

route(router, "post", "/",
  { body: r.RequisitionCreate, response: r.RequisitionDetail, summary: "Group approved requests for the CEO" },
  requirePermission("expenses", "create"), requireCapability("expenses.finance"), controller.create);

route(router, "get", "/:id",
  { params: c.common.IdParams, response: r.RequisitionDetail, summary: "One requisition and its requests" },
  requirePermission("expenses", "view"), requireCapability("expenses.finance"), controller.get);

route(router, "post", "/:id/remove",
  { params: c.common.IdParams, body: r.RequisitionRemove, response: r.RequisitionDetail,
    summary: "Take a request out of a requisition before deciding it" },
  requirePermission("expenses", "approve"), controller.remove);

module.exports = { basePath: "/requisitions", surface: "staff", router };
