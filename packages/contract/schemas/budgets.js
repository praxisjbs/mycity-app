"use strict";
/**
 * Budgets (docs/guides/expenses.md §3 step 7, §6.6): each department's budget for a calendar
 * year, by category, and each project's optional budget, with what is committed (approved, not yet
 * paid), spent (disbursed) and remaining. Set and changed by holders of `expenses.finance`; every
 * change is read back as Budget History from the audit ledger.
 */
const { z } = require("zod");
const { uuid, isoDate, isoDateTime, money, listQuery, Paged } = require("./common");
const { PersonRef } = require("./organisation");

const BudgetStatus = z.enum(["draft", "approved", "closed"]);

const year = z.coerce.number().int().min(2025).max(2100);

const BudgetLine = z
  .object({
    budget_line_id: uuid,
    expense_category_id: uuid,
    category: z.string(),
    amount: money,
    committed_amount: money,
    spent_amount: money,
    remaining: money,
  })
  .strict();

const Budget = z
  .object({
    budget_id: uuid,
    number: z.string(),
    name: z.string(),
    department_id: uuid.nullable(),
    department: z.string().nullable(),
    owner: PersonRef.nullable(),
    starts_on: isoDate,
    ends_on: isoDate,
    status: BudgetStatus,
    allocated: money,
    committed: money,
    spent: money,
    remaining: money,
    lines: z.array(BudgetLine),
    approved_at: isoDateTime.nullable(),
  })
  .strict();

const BudgetListQuery = listQuery(
  { year: year.optional(), department_id: uuid.optional() },
  ["name", "allocated", "remaining"],
);
const BudgetPage = Paged(Budget);

const BudgetLineInput = z
  .object({
    expense_category_id: uuid,
    amount: money,
  })
  .strict();

/** New Budget: a department's year, its lines by category. */
const BudgetCreate = z
  .object({
    department_id: uuid,
    year,
    lines: z.array(BudgetLineInput).min(1, "Add a category").max(25),
  })
  .strict();

/** Edit Budget: the lines again, whole. */
const BudgetUpdate = z
  .object({
    lines: z.array(BudgetLineInput).min(1, "Add a category").max(25),
  })
  .strict();

/** Edit Budget as a Praxis AI card: the budget it changes, by id, and its lines again, whole. */
const BudgetLinesChange = z
  .object({
    budget_id: uuid,
    lines: z.array(BudgetLineInput).min(1, "Add a category").max(25),
  })
  .strict();

/** One change in Budget History, from the audit ledger. */
const BudgetChange = z
  .object({
    at: isoDateTime,
    by: z.string().nullable(),
    category: z.string().nullable(),
    before: money.nullable(),
    after: money.nullable(),
  })
  .strict();
const BudgetChangePage = Paged(BudgetChange);

/** A project as Expenses · Projects shows it. */
const ProjectSpend = z
  .object({
    project_id: uuid,
    number: z.string(),
    name: z.string(),
    budget_amount: money.nullable(),
    committed: money,
    spent: money,
    remaining: money.nullable(),
    requests: z.number().int().min(0),
  })
  .strict();
const ProjectSpendListQuery = listQuery({}, ["name", "spent", "remaining"]);
const ProjectSpendPage = Paged(ProjectSpend);

/** Set Budget on a project; null takes it away. */
const ProjectBudget = z.object({ budget_amount: money.nullable() }).strict();

/** Set Budget as a Praxis AI card: the project it sets, by id. */
const ProjectBudgetSet = z.object({ project_id: uuid, budget_amount: money.nullable() }).strict();

/**
 * The assistant's budget summary (docs/guides/praxis-ai.md §6.13, Finance: Budgets): a year's
 * budgets in figures, grouped by department, category or project. By project only for a reader
 * whose scope is all, as Expenses · Projects. Figures, never a row.
 */
const BudgetSummaryBy = z.enum(["department", "category", "project"]);
const BudgetSummaryQuery = z
  .object({
    year: year.optional(),
    department_id: uuid.optional(),
    by: BudgetSummaryBy.default("department"),
  })
  .strict();

const TABLES = {
  BudgetLine: {
    table: "budget_line",
    virtual: { category: "expense_category.name", remaining: "amount less committed and spent" },
  },
  Budget: {
    table: "budget",
    virtual: {
      department: "department.name",
      owner: "the department's head, from employee",
      allocated: "sum of budget_line.amount",
      committed: "sum of budget_line.committed_amount",
      spent: "sum of budget_line.spent_amount",
      remaining: "allocated less committed and spent",
      lines: "budget_line rows",
    },
  },
  BudgetListQuery: { table: null, reason: "list controls for the budgets" },
  BudgetPage: { table: null, reason: "a page of budgets" },
  BudgetLineInput: { table: "budget_line" },
  BudgetCreate: {
    table: "budget",
    virtual: { year: "sets starts_on and ends_on", lines: "written to budget_line" },
  },
  BudgetUpdate: { table: "budget", virtual: { lines: "written to budget_line" } },
  BudgetLinesChange: { table: "budget", virtual: { lines: "written to budget_line" } },
  BudgetChange: { table: null, reason: "an audit_ledger entry about a budget" },
  BudgetChangePage: { table: null, reason: "a page of budget changes" },
  ProjectSpend: {
    table: "project",
    virtual: {
      committed: "sum of the project's committed expense_request.amount",
      spent: "sum of the project's disbursed expense_request.amount",
      remaining: "budget_amount less committed and spent",
      requests: "count of expense_request naming it",
    },
  },
  ProjectSpendListQuery: { table: null, reason: "list controls for the projects" },
  ProjectSpendPage: { table: null, reason: "a page of projects" },
  ProjectBudget: { table: "project" },
  ProjectBudgetSet: { table: "project" },
  BudgetSummaryQuery: { table: null, reason: "the year, department and grouping of the assistant's budget summary; figures, never a row" },
};

module.exports = {
  TABLES,
  BudgetStatus,
  BudgetLine,
  Budget,
  BudgetListQuery,
  BudgetSummaryBy,
  BudgetSummaryQuery,
  BudgetPage,
  BudgetLineInput,
  BudgetCreate,
  BudgetUpdate,
  BudgetLinesChange,
  BudgetChange,
  BudgetChangePage,
  ProjectSpend,
  ProjectSpendListQuery,
  ProjectSpendPage,
  ProjectBudget,
  ProjectBudgetSet,
};
