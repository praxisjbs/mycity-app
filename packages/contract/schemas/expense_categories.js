"use strict";
/**
 * Expense categories (docs/guides/expenses.md §6.7): what a request's money is for, kept by
 * holders of `expenses.finance` on Expenses · Categories and offered to every request.
 *
 * A category has a name, a type and an optional description. Its `code` is made from its name by
 * the service and never shown. There is no approval threshold (decision 1 of 04/11/2026). MyCity
 * enters its own categories (A26); Add Suggested Categories creates the twelve defaults in one
 * press while there are none.
 */
const { z } = require("zod");
const { uuid, text, optionalText, isoDateTime, money, listQuery, Paged } = require("./common");

const CategoryType = z.enum(["operating", "capital"]);

/** A query-string boolean: "true" or "false". */
const flag = z.enum(["true", "false"]).transform((v) => v === "true");

/** One category as the list and the pickers show it. */
const ExpenseCategory = z
  .object({
    expense_category_id: uuid,
    name: z.string(),
    type: CategoryType,
    description: z.string().nullable(),
    active: z.boolean(),
    spent_this_month: money,
    requests: z.number().int().min(0),
    created_at: isoDateTime,
  })
  .strict();

const ExpenseCategoryListQuery = listQuery(
  { active: flag.optional(), type: CategoryType.optional() },
  ["name", "spent_this_month", "created_at"],
);
const ExpenseCategoryPage = Paged(ExpenseCategory);

/** New Category. */
const ExpenseCategoryCreate = z
  .object({
    name: text(80),
    type: CategoryType.default("operating"),
    description: optionalText(300),
  })
  .strict();

/** Edit Category, Deactivate (active false) and its way back. */
const ExpenseCategoryUpdate = z
  .object({
    name: text(80).optional(),
    type: CategoryType.optional(),
    description: optionalText(300),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to change", path: ["name"] });

/** Save Category's card (praxis-ai.md decision 33): the category, matched by its name, and what changes. */
const ExpenseCategoryChange = z
  .object({
    expense_category_id: uuid,
    name: text(80).optional(),
    type: CategoryType.optional(),
    description: optionalText(300),
    active: z.boolean().optional(),
  })
  .strict();

const TABLES = {
  ExpenseCategoryChange: { table: "expense_category" },
  ExpenseCategory: {
    table: "expense_category",
    virtual: {
      spent_this_month: "sum of this month's disbursed expense_request.amount in the category",
      requests: "count of expense_request in the category",
    },
  },
  ExpenseCategoryListQuery: { table: null, reason: "list controls for the categories" },
  ExpenseCategoryPage: { table: null, reason: "a page of categories" },
  ExpenseCategoryCreate: { table: "expense_category" },
  ExpenseCategoryUpdate: { table: "expense_category" },
};

module.exports = {
  TABLES,
  CategoryType,
  ExpenseCategory,
  ExpenseCategoryListQuery,
  ExpenseCategoryPage,
  ExpenseCategoryCreate,
  ExpenseCategoryUpdate,
  ExpenseCategoryChange,
};
