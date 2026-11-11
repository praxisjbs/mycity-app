"use strict";
/**
 * /api/v1/expenses: expense requests (docs/guides/expenses.md §5).
 *
 *   GET   /mine, /mine/summary     the caller's own requests and ESS · My Requests' four cards
 *   GET   /banks                   `expenses` create: the Bank field's suggestions, 25 a page
 *   POST  /mine                    `expenses` create: New Request (`submit` sends it at once)
 *   PATCH /mine/:id                `expenses` edit: a draft or sent-back request of their own
 *   POST  /mine/:id/submit         `expenses` create: Send Request, Send Again
 *   POST  /mine/:id/cancel         `expenses` edit: Cancel Request, before Operations & People approve
 *   GET   /                        `expenses` view, within scope: the requests
 *   GET   /approvals, /summary     `expenses` approve: the requests waiting on the caller now
 *   GET   /:id                     `expenses` view, within scope, or named on its approval's stage
 *   POST  /:id/withdraw            `expenses` edit and `expenses.finance`: once approved, until paid
 *   POST  /mine/invoice-reading    `expenses` create: Read Invoice (Image Reading), a suggestion
 *   POST  /mine/category-suggestion `expenses` create: Suggest Category (Default), a suggestion
 *   GET   /:id/history             `expenses` view, as GET /:id: the request's history, 25 a page
 *   POST  /:id/duplicate-check     `expenses` view, within scope or named on its stage: Check
 *                                  Duplicate (Default), read on the modal; nothing is kept
 *
 * A request is approved, sent back or rejected in its approval (/workflow/instances/:id/approve,
 * request_changes, reject), never here: whoever the stage names decides, with `expenses` approve.
 * The invoice is staged through POST /documents first and named by its document_id.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const controller = require("./expenses.controller");

const router = express.Router();
const x = c.expenses;

route(router, "get", "/mine",
  { query: x.ExpenseListQuery, response: x.ExpensePage, self: true, summary: "My expense requests" },
  controller.mine);

route(router, "get", "/mine/summary",
  { response: x.ExpenseMineSummary, self: true, summary: "The figures above My Requests" },
  controller.mineSummary);

route(router, "get", "/banks",
  { query: x.ExpenseBankListQuery, response: x.ExpenseBankPage, summary: "The banks New Request suggests" },
  requirePermission("expenses", "create"), controller.banks);

route(router, "post", "/mine",
  { body: x.ExpenseCreate, response: x.ExpenseRequest, summary: "Raise an expense request" },
  requirePermission("expenses", "create"), controller.create);

route(router, "post", "/mine/invoice-reading",
  { body: x.ExpenseInvoiceReading, response: x.ExpenseInvoiceSuggestion, summary: "Read an invoice for New Request" },
  requirePermission("expenses", "create"), controller.readInvoice);

route(router, "post", "/mine/category-suggestion",
  { body: x.ExpenseCategoryHint, response: x.ExpenseCategorySuggestion, summary: "Suggest a category for New Request" },
  requirePermission("expenses", "create"), controller.suggestCategory);

route(router, "patch", "/mine/:id",
  { params: c.common.IdParams, body: x.ExpenseUpdate, response: x.ExpenseRequest,
    summary: "Change a draft or sent-back request of mine" },
  requirePermission("expenses", "edit"), controller.update);

route(router, "post", "/mine/:id/submit",
  { params: c.common.IdParams, body: c.common.EmptyBody, response: x.ExpenseRequest,
    summary: "Send a request of mine for approval" },
  requirePermission("expenses", "create"), controller.submit);

route(router, "post", "/mine/:id/cancel",
  { params: c.common.IdParams, body: x.ExpenseCancel, response: x.ExpenseRequest,
    summary: "Cancel a request of mine before Operations & People approve it" },
  requirePermission("expenses", "edit"), controller.cancel);

route(router, "get", "/",
  { query: x.ExpenseListQuery, response: x.ExpensePage, summary: "Expense requests" },
  requirePermission("expenses", "view"), controller.list);

route(router, "get", "/approvals",
  { query: x.ExpenseListQuery, response: x.ExpensePage, summary: "Expense requests waiting on me" },
  requirePermission("expenses", "approve"), controller.approvals);

route(router, "get", "/approvals/summary",
  { response: x.ExpenseApprovalsSummary, summary: "The figures above Expenses, Approvals" },
  requirePermission("expenses", "approve"), controller.approvalsSummary);

route(router, "get", "/:id",
  { params: c.common.IdParams, response: x.ExpenseRequest, summary: "One expense request" },
  requirePermission("expenses", "view"), controller.get);

route(router, "get", "/:id/history",
  { params: c.common.IdParams, query: c.common.PageQuery, response: x.ExpenseHistoryPage, summary: "A request's history" },
  requirePermission("expenses", "view"), controller.history);

route(router, "post", "/:id/duplicate-check",
  { params: c.common.IdParams, body: c.common.EmptyBody, response: x.ExpenseDuplicateCheck,
    summary: "Compare a request with the ones it may repeat" },
  requirePermission("expenses", "view"), controller.checkDuplicate);

route(router, "post", "/:id/withdraw",
  { params: c.common.IdParams, body: x.ExpenseCancel, response: x.ExpenseRequest,
    summary: "Withdraw an approved request before it is paid" },
  requirePermission("expenses", "edit"), requireCapability("expenses.finance"), controller.withdraw);

module.exports = { basePath: "/expenses", surface: "staff", router };
