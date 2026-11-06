"use strict";
/**
 * ⌘K for expense categories: a category found by its name, for every `expenses` holder, as
 * Expenses · Categories lists it. A result opens Expenses · Categories (shared/route-map.js
 * expense_category).
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "expense_category",
  module: "expenses",
  label: "Expense Categories",
  words: ["expense categories", "expense types"],
  from: "expense_category c",
  key: "c.expense_category_id",
  columns: ["c.name"],
  select:
    "c.expense_category_id AS id, NULL::text AS ref, c.name AS title, initcap(c.type) AS sub, CASE WHEN c.active THEN 'active' ELSE 'inactive' END AS status",
  order: "c.name",
});
