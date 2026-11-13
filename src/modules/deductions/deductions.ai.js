"use strict";
/**
 * What the assistant may read and do about deductions (docs/guides/payroll.md §9). Payroll registers no AI job of its
 * own: it adds no model call, and its reads and cards run on the assistant engine's existing job.
 *
 * Reads, a page of 25 at a time: the deductions waiting or running (attendance items, fines and advances, as
 * Payroll · Deductions lists them, masked as the screen is) and, for the asking person, their own deductions and
 * the instalments scheduled (`deductions.mine`, never masked from them: payslips.service `ownDeductionsForAssistant`).
 *
 * A summary, figures and never rows (praxis-ai.md §6.13, Finance and pay): what the tab lists by source, status,
 * department and month, its amounts only for a reader with the salary grant.
 *
 * Cards the person confirms (praxis-ai.md §6.11, decision 33), each through the service function a button on Payroll ·
 * Deductions calls, each risk `payroll` so Confirm It's You comes first (decision 11): Accept Deduction (a fine, this
 * month or spread), Waive Fine and Record Advance. A fine's buttons sit on its own sheet and never name it, so the
 * card takes the fine beside the form's own fields (`FineAccept`, `FineWaive`). Never a person's own fine or advance:
 * the card is refused when it is drawn, and again at the press (403 OWN_RECORD, §6.6 rule 8). An attendance item is
 * waived on People · Attendance, never here.
 *
 * The routes: "record a salary advance" opens Payroll · Deductions on Record Advance.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const routeMap = require("../../shared/route-map");
const people = require("../organisation/organisation.cards");
const payslips = require("../payslips/payslips.service");
const service = require("./deductions.service");

const EMPTY = { data: [], page: { number: 1, size: 25, total: 0, pages: 0, has_next: false } };

const screen = () => routeMap.screenPath("payroll", "deductions");

/** The fine a card is for, asked among those waiting for payroll (decision 34) and matched when written by the person or the query. */
const askFine = { field: "sanction_fine_id", question: "Which fine?", read: "deductions.list", params: { status: "pending", source: "fine" }, type: "deduction" };
/** The month a deduction starts in, asked among the twelve from the open month and matched when written as "October 2026" or "2026-10". */
const askStart = { field: "start_period", question: "Which month does it start?", options: ({ db }) => service.startMonthChoices(db) };
const resolveStart = { start_period: (value, _actor, db) => service.startMonthOf(db, value) };
/** The months a fine or an advance is spread over, one to twelve; one is this month. */
const askMonths = (choices) => ({ field: "months", question: "Over how many months?", choices });
/** The fine as a chip: the person and the query. Without a database, by id alone. */
const fineRecords = (values, _actor, db) => (db ? service.cardFine(db, values.sanction_fine_id) : values.sanction_fine_id ? [{ type: "deduction", id: values.sanction_fine_id }] : []);

module.exports = defineManifest({
  module: "payroll",
  reads: [
    {
      key: "deductions.list",
      summary: "deductions.summary",
      description:
        "List deductions: attendance items waiting, fines (waiting, active, settled, waived) and salary advances, by person, source, status or month, with who each is about, why, its month and status",
      params: c.deductions.DeductionListQuery,
      permission: ["payroll", "view"],
      run: (_client, params, actor) => service.list(actor, params),
      // A fine is cited by its own id, so a card asking "which fine?" matches the person's words to it; an advance by its deduction's.
      cite: (row) => ({
        type: "deduction",
        id: row.sanction_fine_id || row.source_id,
        label: row.source === "fine" ? service.fineLabel({ ...row, reason_text: row.reason }) : `${row.employee.display_name}, ${row.reason}`,
      }),
    },
    {
      key: "deductions.mine",
      summary: "my_pay.summary",
      description: "List my own deductions on my payslips: each month that carried a fine or an advance repayment and each still scheduled, with the reason, query number, which instalment and the amount",
      params: c.common.PageQuery,
      permission: ["ess", "view"],
      run: (_client, params, actor) => (actor.employee_id ? payslips.ownDeductionsForAssistant(actor.employee_id, params) : EMPTY),
      cite: (row) => ({ type: "payroll_own_deduction", id: row.payroll_deduction_instalment_id, label: `${row.reason}, ${row.month}` }),
    },
  ],
  summaries: [
    {
      key: "deductions.summary",
      description:
        "Deductions in figures by source, status, department and month: how many, waiting, waived; with the salary grant their amounts, scheduled ahead, recovered this year and advances owed",
      params: c.deductions.DeductionSummaryQuery,
      permission: ["payroll", "view"],
      run: (client, params, actor) => service.aiSummary(client, params, actor),
    },
  ],
  actions: [
    {
      key: "deductions.accept",
      label: "Accept Deduction",
      description: "Accept a fine waiting for payroll: this month (one month), or spread over two to twelve months in equal shares from a start month. Never a fine of the person asking",
      input: c.deductions.FineAccept,
      permission: ["payroll", "edit"],
      risk: "payroll",
      form: "none: Accept This Month and Spread Over Months sit on a fine's sheet on Payroll · Deductions and never name it; the card names the fine (FineAccept)",
      fields: ["sanction_fine_id", "months", "start_period"],
      resolve: resolveStart,
      asks: [askFine, askMonths(["This Month", "2 Months", "3 Months", "6 Months", "12 Months"]), askStart],
      records: fineRecords,
      check: (client, values, actor) => service.assertCardFine(client, values.sanction_fine_id, actor),
      // The same function the sheet's Accept This Month and Spread Over Months call.
      run: (values, actor) => service.acceptFine(actor, values.sanction_fine_id, { months: values.months, start_period: values.start_period }),
      readback: (row) => [{ type: "deduction", id: row.sanction_fine_id, label: service.fineLabel({ ...row, reason_text: row.reason }), status: "accepted", link: screen() }],
      labels: { sanction_fine_id: "Fine", months: "Months", start_period: "Start Month" },
    },
    {
      key: "deductions.waive",
      label: "Waive Fine",
      description: "Waive a fine waiting for payroll, with the reason: nothing is deducted and the person is told. Never a fine of the person asking",
      input: c.deductions.FineWaive,
      permission: ["payroll", "edit"],
      risk: "payroll",
      form: "none: Waive sits on a fine's sheet on Payroll · Deductions and never names it; the card names the fine (FineWaive)",
      fields: ["sanction_fine_id", "reason"],
      asks: [askFine, { field: "reason", question: "Why waive it?" }],
      records: fineRecords,
      check: (client, values, actor) => service.assertCardFine(client, values.sanction_fine_id, actor),
      // The same function the sheet's Waive calls.
      run: (values, actor) => service.waiveFine(actor, values.sanction_fine_id, { reason: values.reason }),
      readback: (row) => [{ type: "deduction", id: row.sanction_fine_id, label: service.fineLabel({ ...row, reason_text: row.reason }), status: "waived", link: screen() }],
      labels: { sanction_fine_id: "Fine", reason: "Reason" },
    },
    {
      key: "advances.record",
      label: "Record Advance",
      description:
        "Record a salary advance already paid outside the system, recovered in equal monthly instalments (one to twelve) from a start month: the person, amount, day paid, months, reason. Never for the asker",
      input: c.deductions.AdvanceRecord,
      permission: ["payroll", "create"],
      risk: "payroll",
      fields: ["employee_id", "amount", "granted_on", "months", "start_period", "reason"],
      picks: { employee_id: "employee" },
      resolve: resolveStart,
      names: (values, _actor, db) => people.peopleNamed(db, [values.employee_id]),
      asks: [
        { field: "employee_id", question: "Who is the advance for?", read: "employees.list", params: { status: "active" } },
        { field: "amount", question: "How much was advanced?" },
        { field: "granted_on", question: "What day was it paid?", choices: ["Today", "Yesterday"] },
        askMonths(["1 Month", "2 Months", "3 Months", "6 Months"]),
        askStart,
        { field: "reason", question: "What was it for?" },
      ],
      check: (client, values, actor) => service.assertCardAdvance(client, values, actor),
      // The same function Record Advance calls: the day not still to come, the first month not before the open one.
      run: (values, actor) => service.recordAdvance(actor, values),
      readback: (row) => [{ type: "deduction", id: row.payroll_deduction_id, label: `${row.employee.display_name}, salary advance`, status: "recorded", link: screen() }],
      labels: { employee_id: "Person", amount: "Amount", granted_on: "Paid On", months: "Months", start_period: "Start Month", reason: "Reason" },
    },
  ],
  not_offered: {},
  routes: [{ intent: "record a salary advance", screen: "payroll.deductions", params: { action: "advance" } }],
});
