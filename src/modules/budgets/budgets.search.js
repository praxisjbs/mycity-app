"use strict";
/**
 * ⌘K for budgets: a department's budget found by its number, its department or its year ("Programmes
 * 2026"), for every `expenses` holder within their scope (on the department's head), as Expenses ·
 * Budgets lists them. A result opens Expenses · Budgets (shared/route-map.js budget).
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "budget",
  module: "expenses",
  label: "Budgets",
  words: ["budget", "department budget"],
  from: "budget b LEFT JOIN department bd ON bd.department_id = b.department_id",
  key: "b.budget_id",
  columns: ["b.number", "b.name", "bd.name"],
  select: "b.budget_id AS id, b.number AS ref, b.name AS title, bd.name AS sub, b.status AS status",
  order: "b.starts_on DESC",
  scope: { column: "b.owner_id" },
});
