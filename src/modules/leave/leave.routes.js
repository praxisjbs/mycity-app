"use strict";
/**
 * /api/v1/leave: People · Leave and the leave types (docs/guides/ess.md §5).
 *
 *   GET   /types                    every login: the Request Leave form lists them
 *   POST  /types, PATCH /types/:id  `people` create, edit: the types People offer
 *   DELETE /types/:id               `people` delete: only a type nothing has used
 *   GET   /requests, /summary,      `people` view, within the grant's scope: Operations &
 *         /requests/:id, /clashes   People see everyone, a line manager their team
 *   POST  /requests                 `people` create: leave recorded for someone, approved
 *   POST  /requests/:id/cancel      `people` edit: cancel granted leave before it ends
 *   GET   /balances                 `people` view: one person's year, within scope
 *   PUT   /balances                 `people` edit: one person's allowance of a type for a year
 *
 * A request is approved or rejected in its approval (/workflow/instances/:id/approve,
 * reject), never here: whoever the flow names decides, with `people` approve.
 * The employee's own leave is under /ess/leave.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./leave.controller");

const router = express.Router();
const l = c.leave;

route(router, "get", "/types",
  { query: l.LeaveTypeListQuery, response: l.LeaveTypePage, summary: "The leave types offered" },
  requirePermission("ess", "view"), controller.listTypes);

route(router, "post", "/types",
  { body: l.LeaveTypeCreate, response: l.LeaveType, summary: "Add a leave type" },
  requirePermission("people", "create"), controller.createType);

route(router, "patch", "/types/:id",
  { params: c.common.IdParams, body: l.LeaveTypeUpdate, response: l.LeaveType,
    summary: "Change or retire a leave type" },
  requirePermission("people", "edit"), controller.updateType);

route(router, "delete", "/types/:id",
  { params: c.common.IdParams, no_content: true, summary: "Delete a leave type nobody has used" },
  requirePermission("people", "delete"), controller.deleteType);

route(router, "get", "/requests",
  { query: l.LeaveListQuery, response: l.LeavePage, summary: "Leave requests" },
  requirePermission("people", "view"), controller.list);

route(router, "get", "/summary",
  { response: l.LeaveSummary, summary: "The figures above People, Leave" },
  requirePermission("people", "view"), controller.summary);

route(router, "get", "/requests/:id",
  { params: c.common.IdParams, response: l.LeaveRequest, summary: "One leave request" },
  requirePermission("people", "view"), controller.get);

route(router, "get", "/requests/:id/clashes",
  { params: c.common.IdParams, query: l.LeaveClashQuery, response: l.LeavePage,
    summary: "Who else in the department is away on those days" },
  requirePermission("people", "view"), controller.clashes);

route(router, "post", "/requests",
  { body: l.LeaveRecordCreate, response: l.LeaveRequest, summary: "Record leave for someone" },
  requirePermission("people", "create"), controller.record);

route(router, "post", "/requests/:id/cancel",
  { params: c.common.IdParams, body: l.LeaveCancel, response: l.LeaveRequest,
    summary: "Cancel granted leave before it ends" },
  requirePermission("people", "edit"), controller.cancel);

route(router, "get", "/balances",
  { query: l.LeaveBalanceQuery, response: l.LeaveBalances, summary: "One person's leave year" },
  requirePermission("people", "view"), controller.balances);

route(router, "put", "/balances",
  { body: l.LeaveAllowanceSet, response: l.LeaveBalances,
    summary: "Set one person's allowance of a leave type for a year" },
  requirePermission("people", "edit"), controller.setAllowance);

module.exports = { basePath: "/leave", surface: "staff", router };
