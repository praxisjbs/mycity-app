"use strict";
/**
 * /api/v1/expense-categories: what a request's money is for (docs/guides/expenses.md §5, §6.7).
 *
 *   GET   /             `expenses` view: Expenses · Categories and every category picker, 25 a page
 *   POST  /             `expenses` create and `expenses.finance`: New Category
 *   PATCH /:id          `expenses` edit and `expenses.finance`: Edit Category, Deactivate
 *   POST  /suggested    `expenses` create and `expenses.finance`: Add Suggested Categories,
 *                       only while there are none
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const controller = require("./expense_categories.controller");

const router = express.Router();
const k = c.expense_categories;

route(router, "get", "/",
  { query: k.ExpenseCategoryListQuery, response: k.ExpenseCategoryPage, summary: "The expense categories" },
  requirePermission("expenses", "view"), controller.list);

route(router, "post", "/",
  { body: k.ExpenseCategoryCreate, response: k.ExpenseCategory, summary: "Add an expense category" },
  requirePermission("expenses", "create"), requireCapability("expenses.finance"), controller.create);

route(router, "post", "/suggested",
  { body: c.common.EmptyBody, response: k.ExpenseCategoryPage, summary: "Add the suggested categories while there are none" },
  requirePermission("expenses", "create"), requireCapability("expenses.finance"), controller.addSuggested);

route(router, "patch", "/:id",
  { params: c.common.IdParams, body: k.ExpenseCategoryUpdate, response: k.ExpenseCategory,
    summary: "Change, deactivate or restore an expense category" },
  requirePermission("expenses", "edit"), requireCapability("expenses.finance"), controller.update);

module.exports = { basePath: "/expense-categories", surface: "staff", router };
