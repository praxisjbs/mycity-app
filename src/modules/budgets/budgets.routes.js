"use strict";
/**
 * /api/v1/budgets: department budgets by year and category, and project budgets
 * (docs/guides/expenses.md §5, §6.6).
 *
 *   GET   /                  `expenses` view, within scope (on the department's head): Budgets
 *   POST  /                  `expenses` create and `expenses.finance`: New Budget
 *   GET   /projects          `expenses` view, scope all: Expenses · Projects
 *   PATCH /projects/:id      `expenses` edit and `expenses.finance`: Set Budget on a project
 *   GET   /:id               `expenses` view, within scope: one budget and its lines
 *   PATCH /:id               `expenses` edit and `expenses.finance`: Edit Budget
 *   GET   /:id/history       `expenses` view, within scope: Budget History, 25 a page
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const controller = require("./budgets.controller");

const router = express.Router();
const b = c.budgets;

route(router, "get", "/",
  { query: b.BudgetListQuery, response: b.BudgetPage, summary: "Department budgets" },
  requirePermission("expenses", "view"), controller.list);

route(router, "post", "/",
  { body: b.BudgetCreate, response: b.Budget, summary: "Set a department's budget for a year" },
  requirePermission("expenses", "create"), requireCapability("expenses.finance"), controller.create);

route(router, "get", "/projects",
  { query: b.ProjectSpendListQuery, response: b.ProjectSpendPage, summary: "Each project's budget and spend" },
  requirePermission("expenses", "view"), controller.projects);

route(router, "patch", "/projects/:id",
  { params: c.common.IdParams, body: b.ProjectBudget, response: b.ProjectSpend, summary: "Set or take away a project's budget" },
  requirePermission("expenses", "edit"), requireCapability("expenses.finance"), controller.setProjectBudget);

route(router, "get", "/:id",
  { params: c.common.IdParams, response: b.Budget, summary: "One department budget and its lines" },
  requirePermission("expenses", "view"), controller.get);

route(router, "patch", "/:id",
  { params: c.common.IdParams, body: b.BudgetUpdate, response: b.Budget, summary: "Change a department budget's lines" },
  requirePermission("expenses", "edit"), requireCapability("expenses.finance"), controller.update);

route(router, "get", "/:id/history",
  { params: c.common.IdParams, query: c.common.PageQuery, response: b.BudgetChangePage, summary: "A budget's changes" },
  requirePermission("expenses", "view"), controller.history);

module.exports = { basePath: "/budgets", surface: "staff", router };
