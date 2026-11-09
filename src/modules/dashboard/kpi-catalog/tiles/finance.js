"use strict";
/**
 * Finance cards: expenses awaiting approval, how much of the running budgets is used (committed
 * and spent, handoff decision 16), and the payroll runs not yet paid.
 *
 *   expenses, budgets   their source adapters (M8), in the reader's scope on `expenses`
 *   payroll             its source adapter (M6), in the reader's scope on `payroll`. The card keeps
 *                       `employee.salary` as its sensitive field, so a reader who may not
 *                       see pay never sees a payroll card at all.
 *
 * Money is Naira only (shared/money), a wire string from the database to the screen.
 */
const expenses = require("../../sources/expenses.source");
const budgets = require("../../sources/budgets.source");
const payroll = require("../../sources/payroll.source");
const { formatMonth } = require("../../../../shared/time/day-first");
const { cell, linkTo, plural, record, records } = require("../shared");

/** The reader's scope on expenses, which also holds budgets. */
const scopeOf = (ctx) => ctx.scope("expenses");

/** A run's status as the card's list reads it. */
const STATUS_WORDS = Object.freeze({ draft: "Draft", computed: "Computed", submitted: "Submitted", approved: "Approved" });

const ENTRIES = [
  {
    id: "expenses_pending",
    domain: "finance",
    label: "Expenses Awaiting Approval",
    unit: "money",
    module: "expenses",
    capability: null,
    sensitive_field: null,
    status: "live",
    pickable: true,
    tone: null,
    source: "expenses",
    value: (client, g, ctx) =>
      g.money(async () => {
        const v = await expenses.awaiting(client, scopeOf(ctx));
        return { amount: v.amount, requests: v.n };
      }),
    caption: (f) => plural(f.requests, "request"),
    detail: {
      title: "Expenses Awaiting Approval",
      columns: [
        { key: "request", label: "Request" },
        { key: "employee", label: "Employee", phone: true },
        { key: "purpose", label: "Purpose" },
        { key: "category", label: "Category" },
        { key: "amount", label: "Amount", numeric: true, phone: true },
        { key: "submitted", label: "Submitted" },
      ],
      groups: [],
      list: async (client, query, ctx) =>
        records(await expenses.awaitingPage(client, scopeOf(ctx), query), (r) =>
          record(
            r.expense_request_id,
            {
              request: cell.text(r.number),
              employee: cell.person(r.employee),
              purpose: cell.text(r.purpose),
              category: cell.text(r.category),
              amount: cell.money(r.amount, r.currency),
              submitted: cell.time(r.submitted_at),
            },
            linkTo("expense", r.expense_request_id),
          ),
        ),
    },
  },
  {
    id: "budget_vs_actual",
    domain: "finance",
    label: "Budget Used",
    unit: "pct",
    module: "expenses",
    capability: null,
    sensitive_field: null,
    status: "live",
    pickable: true,
    tone: null,
    source: "budgets",
    value: (client, g, ctx) => g.ratio(() => budgets.used(client, { today: ctx.today }, scopeOf(ctx))),
    caption: (f) => (f.denominator > 0 ? `across ${plural(f.denominator, "budget")}` : null),
    detail: {
      title: "Budgets Running Now",
      columns: [
        { key: "budget", label: "Budget" },
        { key: "department", label: "Department" },
        { key: "owner", label: "Owner" },
        { key: "allocated", label: "Allocated", numeric: true },
        { key: "committed", label: "Committed", numeric: true },
        { key: "spent", label: "Spent", numeric: true, phone: true },
        { key: "used", label: "Used", numeric: true, phone: true },
      ],
      groups: [],
      list: async (client, query, ctx) =>
        records(await budgets.usedPage(client, { today: ctx.today }, scopeOf(ctx), query), (r) =>
          record(
            r.budget_id,
            {
              budget: cell.text(r.name),
              department: cell.text(r.department),
              owner: cell.person(r.owner),
              allocated: cell.money(r.allocated),
              committed: cell.money(r.committed),
              spent: cell.money(r.spent),
              used: cell.number(r.used),
            },
            linkTo("budget", r.budget_id),
          ),
        ),
    },
  },
  {
    id: "payroll_run_state",
    domain: "finance",
    label: "Payroll In Progress",
    unit: "count",
    module: "payroll",
    capability: null,
    sensitive_field: "employee.salary",
    status: "live",
    pickable: true,
    tone: null,
    source: "payroll",
    value: (client, g, ctx) => g.count(() => payroll.inProgressCount(client, ctx.scope("payroll"))),
    detail: {
      title: "Payroll In Progress",
      columns: [
        { key: "run", label: "Run" },
        { key: "month", label: "Month", phone: true },
        { key: "status", label: "Status", phone: true },
        { key: "staff", label: "Staff", numeric: true },
        { key: "net", label: "Net", numeric: true },
      ],
      groups: [],
      list: async (client, query, ctx) =>
        records(await payroll.inProgressPage(client, ctx.scope("payroll"), query), (r) =>
          record(
            r.payroll_run_id,
            {
              run: cell.text(r.number),
              month: cell.text(formatMonth(r.period)),
              status: cell.text(STATUS_WORDS[r.status] || r.status),
              staff: cell.number(r.headcount),
              net: cell.money(r.net_total),
            },
            linkTo("payroll_run", r.payroll_run_id),
          ),
        ),
    },
  },
];

module.exports = { ENTRIES };
