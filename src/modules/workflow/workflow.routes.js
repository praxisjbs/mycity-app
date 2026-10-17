"use strict";
/**
 * Approvals (docs/guides/foundation.md §5). The module mounts at the API root, because
 * its two halves live under two prefixes:
 *
 *   /workflow/...            requests: My Approvals, one request, and the moves on it.
 *                            Every route is `self`: whether the caller may read or move a
 *                            request depends on the request (who it names, who opened
 *                            it, its module's grant), so the service decides, and a
 *                            request the caller may not read is a 404.
 *   /settings/approvals/...  the flows, `settings` view to read and edit to change.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./workflow.controller");

const router = express.Router();
const w = c.workflow;

route(router, "get", "/workflow/mine",
  { query: w.ApprovalMineQuery, response: w.ApprovalWaitingPage, self: true, summary: "Requests waiting on me" },
  controller.mine);

route(router, "get", "/workflow/mine/count",
  { response: w.ApprovalCount, self: true, summary: "How many requests wait on me" },
  controller.mineCount);

route(router, "get", "/workflow/instances/:id",
  { params: c.common.IdParams, response: w.ApprovalInstance, self: true, summary: "One request, its route and its decisions" },
  controller.instance);

route(router, "post", "/workflow/instances/:id/approve",
  { params: c.common.IdParams, body: w.ApproveBody, response: w.ApprovalInstance, self: true, summary: "Approve the stage waiting on me" },
  controller.approve);

route(router, "post", "/workflow/instances/:id/reject",
  { params: c.common.IdParams, body: w.ReasonBody, response: w.ApprovalInstance, self: true, summary: "Reject a request, saying why" },
  controller.reject);

route(router, "post", "/workflow/instances/:id/request-changes",
  { params: c.common.IdParams, body: w.ReasonBody, response: w.ApprovalInstance, self: true, summary: "Send a request back for changes, saying why" },
  controller.requestChanges);

route(router, "post", "/workflow/instances/:id/withdraw",
  { params: c.common.IdParams, body: w.WithdrawBody, response: w.ApprovalInstance, self: true, summary: "Withdraw my own request" },
  controller.withdraw);

route(router, "post", "/workflow/instances/:id/reassign",
  { params: c.common.IdParams, body: w.ReassignBody, response: w.ApprovalInstance, self: true, summary: "Give the waiting stage to someone else" },
  controller.reassign);

route(router, "get", "/settings/approvals",
  { query: w.ApprovalFlowListQuery, response: w.ApprovalFlowPage, summary: "Every approval flow and its stages" },
  requirePermission("settings", "view"), controller.flows);

route(router, "get", "/settings/approvals/summary",
  { response: w.ApprovalsSummary, summary: "The figures above the approval flows" },
  requirePermission("settings", "view"), controller.flowsSummary);

route(router, "put", "/settings/approvals/:id/steps",
  { params: c.common.IdParams, body: w.ApprovalStepsUpdate, response: w.ApprovalFlow, summary: "Save a flow's stages as a new version" },
  requirePermission("settings", "edit"), controller.saveSteps);

module.exports = { basePath: "/", surface: "staff", router };
