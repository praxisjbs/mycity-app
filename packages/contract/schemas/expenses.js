"use strict";
/**
 * Expense requests (docs/guides/expenses.md §3, §5, §6.1, §6.2): what a person asks money for,
 * line by line, who it is paid to, and where it waits.
 *
 * ESS · My Requests reads and writes the caller's own under /expenses/mine; Expenses · Approvals
 * and the lists read everyone within the caller's `expenses` scope under /expenses. A request is
 * decided in its approval (`expenses.request`, schemas/workflow.js), never by an expense route of
 * its own, so a request carries the id of the approval it waits on; the screen reads the chain
 * from GET /workflow/instances/:id.
 *
 * Statuses (the contract's spelling is the table's CHECK, migration 8010):
 *   draft           saved, not sent
 *   submitted       with its approval: the line manager, then Operations & People
 *   sent_back       returned to the requester to change and send again
 *   approved        Operations & People approved it; waiting to be put in a requisition
 *   in_requisition  in a requisition the CEO has not decided
 *   authorised      the CEO approved its requisition; waiting to be paid
 *   disbursed       paid
 *   rejected, cancelled
 *
 * Money is a two-place string, NGN only (shared/money). A line's amount is quantity times unit
 * price; the request's amount is the sum of its lines, both worked out by the service.
 */
const { z } = require("zod");
const {
  uuid,
  text,
  optionalText,
  isoDate,
  isoDateTime,
  money,
  blank,
  listQuery,
  Paged,
} = require("./common");
const { PersonRef } = require("./organisation");
const { DocumentRef } = require("./documents");

const ExpenseStatus = z.enum([
  "draft",
  "submitted",
  "sent_back",
  "approved",
  "in_requisition",
  "authorised",
  "disbursed",
  "rejected",
  "cancelled",
]);

/** Who the money goes to. Staff may use the bank account on their employee record. */
const PayeeType = z.enum(["staff", "vendor", "partner", "task_team"]);

/** A query-string boolean: "true" or "false". */
const flag = z.enum(["true", "false"]).transform((v) => v === "true");

/** A quantity: a positive number with at most two places, sent as a string like money. */
const quantity = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "must be a number like 2 or 1.5");

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

const ExpenseLine = z
  .object({
    expense_request_line_id: uuid,
    position: z.number().int().min(1),
    description: z.string(),
    quantity: z.string(),
    unit_price: money,
    amount: money,
  })
  .strict();

/** One request as a list row shows it. */
const ExpenseRow = z
  .object({
    expense_request_id: uuid,
    number: z.string(),
    purpose: z.string(),
    amount: money,
    status: ExpenseStatus,
    waiting_on: z.string().nullable(),
    category: z.string(),
    project: z.string().nullable(),
    requester: PersonRef,
    payee_type: PayeeType,
    over_budget: z.boolean(),
    submitted_at: isoDateTime.nullable(),
  })
  .strict();

/** One request as its modal shows it. Bank details are masked for a reader without `employee.bank`. */
const ExpenseRequest = ExpenseRow.extend({
  expense_category_id: uuid,
  project_id: uuid.nullable(),
  department_id: uuid.nullable(),
  department: z.string().nullable(),
  currency: z.literal("NGN"),
  lines: z.array(ExpenseLine),
  payee_name: z.string().nullable(),
  bank_name: z.string().nullable(),
  account_name: z.string().nullable(),
  account_number: z.string().nullable(),
  uses_profile_account: z.boolean(),
  invoice: DocumentRef.nullable(),
  needed_on: isoDate.nullable(),
  requisition_id: uuid.nullable(),
  requisition_number: z.string().nullable(),
  workflow_instance_id: uuid.nullable(),
  budget_remaining: money.nullable(),
  can_edit: z.boolean(),
  can_cancel: z.boolean(),
  approved_at: isoDateTime.nullable(),
  authorised_at: isoDateTime.nullable(),
  disbursed_at: isoDateTime.nullable(),
  rejected_at: isoDateTime.nullable(),
  cancelled_at: isoDateTime.nullable(),
  created_at: isoDateTime,
}).strict();

const ExpenseListQuery = listQuery(
  {
    status: ExpenseStatus.optional(),
    expense_category_id: uuid.optional(),
    project_id: uuid.optional(),
    department_id: uuid.optional(),
    payee_type: PayeeType.optional(),
    over_budget: flag.optional(),
  },
  ["submitted_at", "amount", "number", "created_at"],
);
const ExpensePage = Paged(ExpenseRow);

/** The four cards above ESS · My Requests. */
const ExpenseMineSummary = z
  .object({
    in_flight: z.number().int().min(0),
    disbursed_this_year: money,
    average_turnaround_days: z.number().nullable(),
    rejected: z.number().int().min(0),
  })
  .strict();

/** The four cards above Expenses · Approvals. */
const ExpenseApprovalsSummary = z
  .object({
    with_you: z.number().int().min(0),
    total_value: money,
    oldest_days: z.number().int().min(0).nullable(),
    approved_this_month: z.number().int().min(0),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

const ExpenseLineInput = z
  .object({
    description: text(200),
    quantity: quantity.default("1"),
    unit_price: money,
  })
  .strict();

/** The request's fields, shared by New Request and Edit. */
const ExpenseFields = z
  .object({
    purpose: text(200),
    expense_category_id: uuid,
    project_id: blank(uuid),
    department_id: blank(uuid),
    needed_on: blank(isoDate),
    lines: z.array(ExpenseLineInput).min(1, "Add a line").max(25),
    payee_type: PayeeType,
    uses_profile_account: z.boolean().default(false),
    payee_name: optionalText(150),
    bank_name: optionalText(100),
    account_name: optionalText(150),
    account_number: blank(z.string().regex(/^\d{10}$/, "Ten digits")),
    invoice_document_id: blank(uuid),
  })
  .strict();

/** New Request. `submit` sends it at once (Send Request); without it the request is a draft. */
const ExpenseCreate = ExpenseFields.extend({ submit: z.boolean().default(false) }).strict();

/** Edit, while a draft or sent back. Every field is sent again, as the form holds them all. */
const ExpenseUpdate = ExpenseFields;

/** Cancel Request, and an `expenses.finance` holder's Withdraw. */
const ExpenseCancel = z.object({ reason: optionalText(500) }).strict();

/*
 * Praxis AI's cards (docs/guides/praxis-ai.md §6.11, decision 33). A card carries flat fields, so
 * New Request's card holds its first line beside the request and Add Line adds the rest, one line
 * a press, as a scorecard's lines are carried; Save Request names the request and carries only
 * what changes. The invoice is a file and stays on the form.
 */

/** New Request's card: the form's fields, its first line flat, and Send Request (on by default). */
const ExpenseRequestAdd = ExpenseFields.omit({ lines: true, invoice_document_id: true })
  .extend({
    description: text(200),
    quantity: quantity.default("1"),
    unit_price: money,
    submit: z.boolean().default(true),
  })
  .strict();

/** Save Request's card: a draft or sent-back request of the person's own, and what changes on it. */
const ExpenseChange = ExpenseFields.omit({ lines: true, invoice_document_id: true })
  .partial()
  .extend({ expense_request_id: uuid })
  .strict();

/** Add Line's card: one more line on a draft or sent-back request of the person's own. */
const ExpenseLineAdd = z
  .object({
    expense_request_id: uuid,
    description: text(200),
    quantity: quantity.default("1"),
    unit_price: money,
  })
  .strict();

const TABLES = {
  ExpenseLine: { table: "expense_request_line" },
  ExpenseRow: {
    table: "expense_request",
    virtual: {
      waiting_on: "the waiting stage's name, from workflow_instance",
      category: "expense_category.name",
      project: "project.name",
      requester: "the person, from employee and department",
    },
  },
  ExpenseRequest: {
    table: "expense_request",
    virtual: {
      waiting_on: "the waiting stage's name, from workflow_instance",
      category: "expense_category.name",
      project: "project.name",
      requester: "the person, from employee and department",
      department: "department.name",
      lines: "expense_request_line rows",
      invoice: "the document behind invoice_document_id",
      requisition_number: "requisition.number",
      budget_remaining: "the budget line's allocation less committed and spent",
      can_edit: "draft or sent back, and the reader is its requester",
      can_cancel: "the reader may cancel or withdraw it now",
    },
  },
  ExpenseListQuery: { table: null, reason: "list controls for the requests" },
  ExpensePage: { table: null, reason: "a page of requests" },
  ExpenseMineSummary: { table: null, reason: "figures over the caller's requests" },
  ExpenseApprovalsSummary: { table: null, reason: "figures over the requests waiting on the caller" },
  ExpenseLineInput: { table: "expense_request_line" },
  ExpenseFields: { table: "expense_request", virtual: { lines: "written to expense_request_line" } },
  ExpenseCreate: {
    table: "expense_request",
    virtual: { lines: "written to expense_request_line", submit: "sends it at once" },
  },
  ExpenseUpdate: { table: "expense_request", virtual: { lines: "written to expense_request_line" } },
  ExpenseCancel: { table: null, reason: "a reason for the history, not a column" },
  ExpenseRequestAdd: {
    table: "expense_request",
    virtual: {
      description: "the first line, written to expense_request_line",
      quantity: "the first line, written to expense_request_line",
      unit_price: "the first line, written to expense_request_line",
      submit: "sends it at once",
    },
  },
  ExpenseChange: { table: "expense_request" },
  ExpenseLineAdd: { table: "expense_request_line" },
};

module.exports = {
  TABLES,
  ExpenseStatus,
  PayeeType,
  ExpenseLine,
  ExpenseRow,
  ExpenseRequest,
  ExpenseListQuery,
  ExpensePage,
  ExpenseMineSummary,
  ExpenseApprovalsSummary,
  ExpenseLineInput,
  ExpenseFields,
  ExpenseCreate,
  ExpenseUpdate,
  ExpenseCancel,
  ExpenseRequestAdd,
  ExpenseChange,
  ExpenseLineAdd,
};
