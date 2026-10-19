"use strict";
/**
 * /api/v1/ess: the caller's own record (docs/guides/ess.md §5).
 *
 * Every route is `self: true`: it is authenticated, and the record it answers
 * for is taken from the session. The `ess` permission key is always `own` scope
 * (shared/access/access.catalog.js OWN_ONLY), so a grant check here would add
 * nothing a wrong employee id could slip past; the service reads the employee
 * from `req.user` and there is no parameter that names another.
 *
 * My Profile, My Documents (M0, track B), My Leave (M1) and My Queries (M3) are on the real
 * API. The other tabs are added here as their milestones land.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const upload = require("../../middleware/upload");
const controller = require("./ess.controller");

const router = express.Router();

route(router, "get", "/documents",
  { query: c.documents.DocumentListQuery, response: c.documents.DocumentListPage, self: true,
    summary: "My documents" },
  controller.listDocuments);

route(router, "get", "/documents/summary",
  { response: c.documents.DocumentSummary, self: true, summary: "Counts above my documents" },
  controller.documentSummary);

route(router, "post", "/documents",
  { body: c.ess.EssDocumentUpload, response: c.documents.DocumentRow, self: true,
    summary: "Upload one of my documents" },
  upload.single("file", { purpose: "document" }), controller.addDocument);

/* My Profile: my record, the fields I change myself, and its history. */

route(router, "get", "/profile",
  { response: c.ess.EssProfile, self: true, summary: "My record" },
  controller.profile);

route(router, "patch", "/profile",
  { body: c.ess.EssProfileUpdate, response: c.ess.EssProfile, self: true,
    summary: "Change my contact, next-of-kin and bank details" },
  controller.updateProfile);

route(router, "get", "/profile/history",
  { query: c.common.PageQuery, response: c.organisation.EmployeeHistoryPage, self: true,
    summary: "What has been done to my record" },
  controller.profileHistory);

/* My Leave: the caller's own requests. Approving is in My Approvals, never here. */

route(router, "get", "/leave",
  { query: c.ess.EssLeaveListQuery, response: c.leave.LeavePage, self: true,
    summary: "My leave requests" },
  controller.listLeave);

route(router, "get", "/leave/calendar",
  { query: c.ess.EssLeaveCalendarQuery, response: c.leave.LeavePage, self: true,
    summary: "The leave calendar: mine, those under me, or everyone" },
  controller.leaveCalendar);

route(router, "get", "/leave/balances",
  { query: c.ess.EssLeaveBalanceQuery, response: c.leave.LeaveBalances, self: true,
    summary: "What is left of my year, per leave type" },
  controller.leaveBalances);

route(router, "get", "/leave/:id",
  { params: c.common.IdParams, response: c.leave.LeaveRequest, self: true,
    summary: "One of my leave requests" },
  controller.getLeave);

route(router, "post", "/leave",
  { body: c.leave.LeaveRequestCreate, response: c.leave.LeaveRequest, self: true,
    summary: "Ask for leave" },
  controller.requestLeave);

route(router, "post", "/leave/:id/cancel",
  { params: c.common.IdParams, body: c.leave.LeaveCancel, response: c.leave.LeaveRequest,
    self: true, summary: "Cancel one of my leave requests" },
  controller.cancelLeave);

route(router, "get", "/queries",
  { query: c.queries.EssQueryListQuery, response: c.queries.MyQueryPage, self: true,
    summary: "My queries" },
  controller.listQueries);

route(router, "post", "/queries/:id/response",
  { params: c.common.IdParams, body: c.queries.QueryResponseCreate, response: c.queries.MyQuery,
    self: true, summary: "Respond to one of my queries" },
  controller.respondToQuery);

module.exports = { basePath: "/ess", surface: "staff", router };
