"use strict";
/**
 * What the assistant may read and do about expense requests (docs/guides/expenses.md §9).
 *
 * Reads, a page of 25 at a time: the person's own requests; the requests within their `expenses`
 * scope (a line manager their team's, Operations & People everyone's), never somebody else's draft;
 * and the requests waiting on them now. Bank details are masked by the engine for a reader without
 * `employee.bank`, as on the screen.
 *
 * Cards the person confirms (praxis-ai.md §6.11, decision 33), each through the service function
 * New Request's and Edit's own buttons call: New Request (the request with its first line, sent at
 * once unless the person keeps a draft), Add Line (one more line on a draft or sent-back request),
 * Save Request (what changes on one) and Send Request (a draft sent). A draft's card offers Add
 * Another Item and Send Request once pressed (`then`). The invoice is a file and stays on the form. Approve,
 * Send Back and Reject are the approvals' own card (approvals.decide).
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const categories = require("../expense_categories/expense_categories.service");
const service = require("./expenses.service");

const cite = (row) => ({ type: "expense", id: row.expense_request_id, label: `${row.number}, ${row.purpose}` });

const PAYEES = ["Staff", "Vendor", "Partner", "Dedicated Task Team"];

/** The fields of the request a card carries, as the form names them. */
const LABELS = {
  purpose: "Purpose",
  expense_category_id: "Category",
  project_id: "Project",
  department_id: "Department",
  needed_on: "Needed By",
  payee_type: "Payee Type",
  uses_profile_account: "Use My Company Account",
  payee_name: "Payee",
  bank_name: "Bank",
  account_name: "Account Name",
  account_number: "Account Number",
};

/** A category written by name is matched among those offered on a request (decision 32). */
const resolveCategory = { expense_category_id: (value, _actor, db) => categories.idOf(db, value, { active: true }) };
const askCategory = { field: "expense_category_id", question: "Which category?", options: ({ db }) => categories.names(db, { active: true }) };
const askRequest = { field: "expense_request_id", question: "Which request?", read: "expenses.mine" };
/** One line in one turn: what it is, how many and the price of each, read from the one answer (quantity is 1 when not said). */
const askItem = { field: "description", also: ["quantity", "unit_price"], question: "What are you paying for? How many? How much is each?" };

module.exports = defineManifest({
  module: "expenses",
  reads: [
    {
      key: "expenses.mine",
      description: "List my own expense requests: what each is for, its amount, its category and project, and where it is (draft, waiting on whom, sent back, approved, paid, rejected or cancelled)",
      params: c.expenses.ExpenseListQuery,
      permission: ["expenses", "view"],
      run: (_client, params, actor) => service.listMine(actor.employee_id, params),
      cite,
    },
    {
      key: "expenses.list",
      description: "List expense requests within my reach: who raised each, what it is for, its amount, category, project and payee type, whether it is over budget, and where it is",
      params: c.expenses.ExpenseListQuery,
      permission: ["expenses", "view"],
      run: (_client, params, actor) => service.list(params, actor.scope, actor),
      cite,
    },
    {
      key: "expenses.approvals",
      description: "List the expense requests waiting on my decision now, oldest first",
      params: c.expenses.ExpenseListQuery,
      // A read asks `view`; only what the stages name the person is returned, so it is empty for anyone who decides none.
      permission: ["expenses", "view"],
      run: (_client, params, actor) => service.approvals(actor, params),
      cite,
    },
  ],
  actions: [
    {
      key: "my_expenses.create",
      label: "New Request",
      description: "Raise an expense request of my own: purpose, category, first item, how many, price of each, payee and bank; sent now, or a draft when I name several items so Add Line adds the rest",
      input: c.expenses.ExpenseRequestAdd,
      permission: ["expenses", "create"],
      risk: "standard",
      form: "none: New Request's form holds many lines and its invoice; the card carries its first line flat (ExpenseRequestAdd) and Add Line the rest",
      fields: ["purpose", "expense_category_id", "project_id", "department_id", "needed_on", "description", "quantity", "unit_price", "payee_type", "uses_profile_account", "payee_name", "bank_name", "account_name", "account_number", "submit"],
      picks: { project_id: "project", department_id: "department" },
      resolve: resolveCategory,
      names: (values, _actor, db) => service.cardNames(db, values),
      asks: [
        { field: "purpose", question: "What is the money for?" },
        askCategory,
        askItem,
        { field: "unit_price", question: "How much is each?" },
        { field: "payee_type", question: "Who is it paid to?", choices: PAYEES },
      ],
      // A draft offers another item and sending it; a request sent at once offers nothing more.
      then: (r) => service.nextAfter(r),
      // The same function New Request calls: the category, the lines, the payee and the approval are its own.
      run: (values, actor) => service.createFromCard(actor, values),
      readback: service.readbackOf("saved"),
      labels: { ...LABELS, description: "Item", quantity: "Quantity", unit_price: "Unit Price", submit: "Send Now" },
    },
    {
      key: "my_expenses.add_line",
      label: "Add Line",
      description: "Add one more item to a draft or sent-back expense request of mine: its description, quantity and unit price",
      input: c.expenses.ExpenseLineAdd,
      permission: ["expenses", "edit"],
      risk: "standard",
      form: "none: Edit's form holds every line of the request open on My Requests and never names it; the card names the request and adds one line",
      fields: ["expense_request_id", "description", "quantity", "unit_price"],
      asks: [askRequest, askItem, { field: "unit_price", question: "How much is each?" }],
      records: (values, actor, db) => service.cardRequest(db, actor, values.expense_request_id),
      check: (client, values, actor) => service.assertCardEditable(client, actor, values.expense_request_id),
      run: (values, actor) => service.addLineFromCard(actor, values),
      readback: service.readbackOf("saved"),
      then: (r) => service.nextAfter(r),
      labels: { expense_request_id: "Request", description: "Item", quantity: "Quantity", unit_price: "Unit Price" },
    },
    {
      key: "my_expenses.submit",
      label: "Send Request",
      description: "Send a draft or sent-back expense request of mine for approval, as Send Request and Send Again do",
      input: c.expenses.ExpenseSend,
      permission: ["expenses", "create"],
      risk: "standard",
      form: "none: Send Request is a press on the request's own modal, with no form of its own",
      fields: ["expense_request_id"],
      asks: [askRequest],
      records: (values, actor, db) => service.cardRequest(db, actor, values.expense_request_id),
      check: (client, values, actor) => service.assertCardEditable(client, actor, values.expense_request_id),
      // The same function the modal's Send Request calls: the approval opens in its transaction.
      run: (values, actor) => service.submitFromCard(actor, values),
      readback: service.readbackOf("sent"),
      labels: { expense_request_id: "Request" },
    },
    {
      key: "my_expenses.edit",
      label: "Save Request",
      description: "Change a draft or sent-back expense request of mine: purpose, category, project, department, day needed, payee and bank details; only what changes",
      input: c.expenses.ExpenseChange,
      permission: ["expenses", "edit"],
      risk: "standard",
      form: "none: Edit's form changes the request open on My Requests and never names it; the card does (ExpenseChange)",
      fields: ["expense_request_id", "purpose", "expense_category_id", "project_id", "department_id", "needed_on", "payee_type", "uses_profile_account", "payee_name", "bank_name", "account_name", "account_number"],
      picks: { project_id: "project", department_id: "department" },
      resolve: resolveCategory,
      names: (values, _actor, db) => service.cardNames(db, values),
      asks: [askRequest],
      records: (values, actor, db) => service.cardRequest(db, actor, values.expense_request_id),
      check: (client, values, actor) => service.assertCardEditable(client, actor, values.expense_request_id),
      run: (values, actor) => service.changeFromCard(actor, values),
      readback: service.readbackOf("saved"),
      labels: { expense_request_id: "Request", ...LABELS },
    },
  ],
  not_offered: {
    ExpenseCreate: "via my_expenses.create: New Request's own request, many lines and an invoice; the card carries its first line flat and Add Line the rest",
    ExpenseUpdate: "via my_expenses.edit: Edit's own request, which never names its request; the card is ExpenseChange, and Add Line adds an item",
  },
  routes: [
    { intent: "raise an expense request", screen: "ess.my-requests", params: { action: "new" } },
    { intent: "approve expense requests", screen: "expenses.approvals" },
  ],
});
