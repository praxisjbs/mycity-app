"use strict";
/**
 * What the assistant may read and do about budgets (docs/guides/expenses.md §9).
 *
 * Reads: the departments' budgets for a year with their lines by category (allocated, committed,
 * spent and remaining), within the reader's `expenses` scope, and each project's budget and spend
 * for a reader whose scope is all (as Expenses · Projects), an empty page for anyone else. 25 a page.
 *
 * Summary: a year's budgets in figures, by department and by category (by project for scope all),
 * each row a stacked bar of Spent, Committed, Remaining and Over Budget (praxis-ai.md §6.13, §6.19).
 *
 * Cards a holder of `expenses.finance` confirms, through the service functions the tabs' own
 * buttons call: New Budget (a department's year by category), Edit Budget (the lines again, whole)
 * and Set Budget on a project (or none).
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const { envelope } = require("../../shared/http/paged");
const service = require("./budgets.service");

const LINES = { lines: "Lines" };

module.exports = defineManifest({
  module: "expenses",
  reads: [
    {
      key: "budgets.list",
      summary: "budgets.summary",
      description: "List the departments' budgets for a year: each one's allocation, committed (approved, not yet paid), spent and remaining, and the same by category",
      params: c.budgets.BudgetListQuery,
      permission: ["expenses", "view"],
      run: (_client, params, actor) => service.list(params, actor.scope),
      cite: (row) => ({ type: "budget", id: row.budget_id, label: `${row.number}, ${row.name}` }),
    },
    {
      key: "budgets.projects",
      summary: "budgets.summary",
      description: "List the projects with their optional budget and what their expense requests have committed and spent, and what is left",
      params: c.budgets.ProjectSpendListQuery,
      permission: ["expenses", "view"],
      run: (_client, params, actor) => (actor.scope && actor.scope.scope === "all" ? service.projects(params, actor.scope) : envelope([], 1, 0)),
      cite: (row) => ({ type: "project", id: row.project_id, label: `${row.number} ${row.name}`.trim() }),
    },
  ],
  summaries: [
    {
      key: "budgets.summary",
      description: "A year's budgets in figures: allocated, committed, spent and remaining by department, category or project, each split for a stacked bar, and what was paid by month",
      params: c.budgets.BudgetSummaryQuery,
      permission: ["expenses", "view"],
      run: (client, params, actor) => service.aiSummary(client, params, actor.scope),
    },
  ],
  actions: [
    {
      key: "budgets.create",
      label: "New Budget",
      description: "Set a department's budget for a calendar year: an amount for each expense category",
      input: c.budgets.BudgetCreate,
      permission: ["expenses", "create"],
      capability: "expenses.finance",
      risk: "standard",
      picks: { department_id: "department" },
      names: (values, _actor, db) => service.cardNames(db, values),
      asks: [
        { field: "department_id", question: "Which department?" },
        { field: "year", question: "Which year?" },
        { field: "lines", question: "How much for each category?", read: "expense_categories.list" },
      ],
      run: (values, actor) => service.create(actor, values),
      readback: service.readback("set"),
      labels: { department_id: "Department", year: "Year", ...LINES },
    },
    {
      key: "budgets.edit",
      label: "Edit Budget",
      description: "Change a department's budget: every category's amount again, a category left out taken away",
      input: c.budgets.BudgetLinesChange,
      permission: ["expenses", "edit"],
      capability: "expenses.finance",
      risk: "standard",
      form: "none: Edit Budget's form changes the budget open on Expenses · Budgets and never names it; the card does (BudgetLinesChange)",
      asks: [
        { field: "budget_id", question: "Which budget?", options: ({ db }) => service.names(db) },
        { field: "lines", question: "How much for each category?", read: "budgets.list" },
      ],
      resolve: { budget_id: (value, _actor, db) => service.idOf(db, value) },
      records: (values, _actor, db) => service.cardBudget(db, values.budget_id),
      names: (values, _actor, db) => service.cardNames(db, values),
      check: (client, values) => service.assertCardBudget(client, values.budget_id),
      run: (values, actor) => service.update(actor, values.budget_id, { lines: values.lines }),
      readback: service.readback("saved"),
      labels: { budget_id: "Budget", ...LINES },
    },
    {
      key: "budgets.set_project",
      label: "Set Budget",
      description: "Set a project's budget, or take it away (no amount), so its spend is tracked against it",
      input: c.budgets.ProjectBudgetSet,
      permission: ["expenses", "edit"],
      capability: "expenses.finance",
      risk: "standard",
      form: "none: Set Budget's form sets the project open on Expenses · Projects and never names it; the card does (ProjectBudgetSet)",
      picks: { project_id: "project" },
      asks: [
        { field: "project_id", question: "Which project?", read: "budgets.projects" },
        { field: "budget_amount", question: "How much is its budget?" },
      ],
      run: (values, actor) => service.setProjectBudget(actor, actor.scope, values.project_id, { budget_amount: values.budget_amount }),
      readback: service.projectReadback,
      labels: { project_id: "Project", budget_amount: "Budget" },
    },
  ],
  not_offered: {
    BudgetUpdate: "via budgets.edit: Edit Budget's own request, which never names its budget; the card is BudgetLinesChange",
  },
  routes: [
    { intent: "set a budget", screen: "expenses.budgets" },
  ],
});
