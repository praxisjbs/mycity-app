"use strict";
/**
 * What the assistant may read and do about expense categories (docs/guides/expenses.md §9): every
 * `expenses` holder reads them, a page of 25 at a time; a holder of `expenses.finance` adds one
 * (New Category) or changes one (Save Category: rename it, change its type or description,
 * deactivate it or offer it again), each as a card the person confirms, through the service
 * function Expenses · Categories' own buttons call. Add Suggested Categories is one press on the
 * empty tab and has no form, so it stays there.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const routeMap = require("../../shared/route-map");
const service = require("./expense_categories.service");

const line = (status) => (row) => [{ type: "expense_category", id: row.expense_category_id, label: row.name, status, link: routeMap.screenPath("expenses", "categories") }];
const LABELS = { name: "Name", type: "Type", description: "Description" };

module.exports = defineManifest({
  module: "expenses",
  reads: [
    {
      key: "expense_categories.list",
      description: "List the expense categories: each one's type, whether it is offered, this month's spend and how many requests name it",
      params: c.expense_categories.ExpenseCategoryListQuery,
      permission: ["expenses", "view"],
      run: (_client, params) => service.list(params),
      cite: (row) => ({ type: "expense_category", id: row.expense_category_id, label: row.name }),
    },
  ],
  actions: [
    {
      key: "expense_categories.create",
      label: "New Category",
      description: "Add an expense category requests can be raised under: its name, operating or capital, and what it is for",
      input: c.expense_categories.ExpenseCategoryCreate,
      permission: ["expenses", "create"],
      capability: "expenses.finance",
      risk: "standard",
      form: "none: Expenses · Categories' form is on INTERIM rules until the screens move onto the contract (docs/handoff/m8-expenses.md PR 7); the card carries ExpenseCategoryCreate",
      asks: [{ field: "name", question: "What is the category called?" }],
      // The same function New Category calls: the name is checked against every category's.
      run: (values, actor) => service.create(actor, values),
      readback: line("added"),
      labels: LABELS,
    },
    {
      key: "expense_categories.edit",
      label: "Save Category",
      description: "Change an expense category: rename it, make it operating or capital, change what it is for, or deactivate it (active false) or offer it again (true); only what changes",
      input: c.expense_categories.ExpenseCategoryChange,
      permission: ["expenses", "edit"],
      capability: "expenses.finance",
      risk: "standard",
      form: "none: Edit Category's form changes the category open on Expenses · Categories and never names it; the card does",
      fields: ["expense_category_id", "name", "type", "description", "active"],
      asks: [{ field: "expense_category_id", question: "Which category?", options: ({ db }) => service.names(db) }],
      resolve: { expense_category_id: (value, _actor, db) => service.idOf(db, value) },
      records: (values, _actor, db) => service.cardCategory(db, values.expense_category_id),
      check: (client, values) => service.assertCard(client, values.expense_category_id),
      run: (values, actor) => {
        const { expense_category_id: id, ...changes } = values;
        return service.update(actor, id, changes);
      },
      readback: line("saved"),
      labels: { expense_category_id: "Category", ...LABELS, active: "Offered" },
    },
  ],
  not_offered: {
    ExpenseCategoryUpdate:
      "via expense_categories.edit: Edit Category's own request, which never names its category; the card is ExpenseCategoryChange",
  },
  routes: [{ intent: "manage expense categories", screen: "expenses.categories" }],
});
