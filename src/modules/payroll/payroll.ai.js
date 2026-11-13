"use strict";
/**
 * What the assistant may read and do about payroll runs (docs/guides/payroll.md §9). Payroll registers no AI job
 * of its own: it adds no model call, and its reads and cards run on the assistant engine's existing job.
 *
 * Reads, a page of 25 at a time: the runs (their month and status and, for a reader with the salary grant,
 * their headcount and totals; the engine masks the amounts for anyone else, as the screen shows them Restricted).
 * Summaries, figures and never rows: a month's headcount, gross, deductions and net, with its payslips by
 * department and by status; and the runs over a year by month (praxis-ai.md §6.13, Finance and pay). Money
 * only for a reader with the salary grant.
 *
 * Cards the person confirms (praxis-ai.md §6.11, decision 33), each through the service function the screen's own
 * button calls, each risk `payroll` so Confirm It's You comes first (decision 11): New Run, Submit for Approval
 * and Add Adjustment. A card names the run it acts on, as the screen's button never does (it sits on the run
 * that is open), so Submit and Add Adjustment take the run beside the form's own fields. Approve and Reject are
 * the approvals' own card (approvals.decide).
 *
 * The advanced switch, the pay day and the bank rule (`PayrollSettingsChange`) are not a card: they are one version
 * of the setting, saved with the date they start and, to switch on, the statutory figures in force in view, so the
 * assistant opens Configurations ("turn on advanced payroll") and the person saves it
 * there. The rates, bands, grades, placements and pay components carry their own reasons (`ai:none design:` on the
 * statutory and salary_structure controllers).
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const routeMap = require("../../shared/route-map");
const people = require("../organisation/organisation.cards");
const service = require("./payroll.service");

const screen = () => routeMap.screenPath("payroll", "payroll-runs");

/** The run a card is for, asked among those it may act on (praxis-ai.md decision 34) and matched when written by its month or number. */
const askRun = (kind) => ({ field: "payroll_run_id", question: "Which run?", options: ({ db }) => service.cardRunChoices(db, kind) });
const resolveRun = (kind) => ({ payroll_run_id: (value, _actor, db) => service.cardRunIdOf(db, value, kind) });
/** The run as a chip: its number and month. Without a database, by id alone. */
const runRecords = (values, _actor, db) => (db ? service.cardRun(db, values.payroll_run_id) : values.payroll_run_id ? [{ type: "payroll_run", id: values.payroll_run_id }] : []);

module.exports = defineManifest({
  module: "payroll",
  reads: [
    {
      key: "payroll.runs",
      summary: "payroll.trend",
      description: "List payroll runs, newest month first: the month, its status (draft, computed, submitted, approved, paid), and with the salary grant the headcount, gross, deductions and net pay",
      params: c.payroll.PayrollRunListQuery,
      permission: ["payroll", "view"],
      run: (_client, params, actor) => service.listRuns(actor, params),
      cite: (row) => ({ type: "payroll_run", id: row.payroll_run_id, label: service.runLabel(row) }),
    },
  ],
  summaries: [
    {
      key: "payroll.month",
      description:
        "A month's payroll in figures: people paid, with the salary grant gross, deductions and net; payslips by department (gross as net and deductions, stacked) and by status. Default: the latest run",
      params: c.payroll.PayrollMonthQuery,
      permission: ["payroll", "view"],
      run: (client, params, actor) => service.monthSummary(client, params, actor),
    },
    {
      key: "payroll.trend",
      description:
        "Payroll over a year or up to 24 months: runs, months paid, the latest run and its status, runs by status, people paid by month and, with the salary grant, gross, deductions and net by month",
      params: c.payroll.PayrollTrendQuery,
      permission: ["payroll", "view"],
      run: (client, params, actor) => service.trendSummary(client, params, actor),
    },
  ],
  actions: [
    {
      key: "payroll_runs.create",
      label: "New Run",
      description: "Open the payroll run for a month, as a draft that Operations and People compute and send to the CEO. One run a month, never a month still to come",
      input: c.payroll.PayrollRunCreate,
      permission: ["payroll", "create"],
      risk: "payroll",
      form: "none: New Run's modal sits on Payroll Runs and is built with the screens; the card carries the same month (PayrollRunCreate)",
      fields: ["period"],
      asks: [{ field: "period", question: "Which month is the run for?" }],
      // The same function New Run's button calls: one run a month, the month not still to come.
      run: (values, actor) => service.createRun(actor, values),
      readback: (run) => [{ type: "payroll_run", id: run.payroll_run_id, label: service.runLabel(run), status: "draft", link: screen() }],
      labels: { period: "Month" },
    },
    {
      key: "payroll_runs.submit",
      label: "Submit for Approval",
      description: "Send a computed payroll run to the CEO for approval, which freezes what is in it. The run must be computed; give its net pay as read, so a changed total is told before anything is frozen",
      input: c.payroll.PayrollRunSubmission,
      permission: ["payroll", "edit"],
      risk: "payroll",
      form: "none: Submit for Approval is a button on the run open on Payroll Runs and never names it; the card names the run and the net pay the person saw (PayrollRunSubmission)",
      fields: ["payroll_run_id", "expected_net_total"],
      asks: [askRun("submit")],
      resolve: resolveRun("submit"),
      records: runRecords,
      check: (client, values) => service.assertCardRun(client, values.payroll_run_id, "submit"),
      // The same function Submit for Approval calls: it computes again, refuses a blocking problem or a changed total, and freezes.
      run: (values, actor) => service.submitRun(actor, values.payroll_run_id, { expected_net_total: values.expected_net_total }),
      readback: (run) => [{ type: "payroll_run", id: run.payroll_run_id, label: service.runLabel(run), status: "sent for approval", link: screen() }],
      labels: { payroll_run_id: "Run", expected_net_total: "Net Pay" },
    },
    {
      key: "payroll_adjustments.add",
      label: "Add Adjustment",
      description: "Add a one-off earning (a bonus, a correction) or deduction to one person's payslip in a draft or computed run: the person, a label, the amount and the reason. The run goes back to draft",
      input: c.payroll.PayrollRunAdjust,
      permission: ["payroll", "edit"],
      risk: "payroll",
      form: "none: Add Adjustment's form sits on the run open on Payroll Runs and never names it; the card names the run (PayrollRunAdjust)",
      fields: ["payroll_run_id", "employee_id", "kind", "label", "amount", "reason"],
      picks: { employee_id: "employee" },
      resolve: resolveRun("adjust"),
      names: (values, _actor, db) => people.peopleNamed(db, [values.employee_id]),
      asks: [
        askRun("adjust"),
        { field: "employee_id", question: "Who is it for?", read: "employees.list", params: { status: "active" } },
        { field: "kind", question: "Is it an earning or a deduction?", choices: ["Earning", "Deduction"] },
        { field: "label", question: "What is it called?" },
        { field: "amount", question: "How much is it?" },
        { field: "reason", question: "What is the reason?" },
      ],
      records: runRecords,
      check: (client, values) => service.assertCardRun(client, values.payroll_run_id, "adjust"),
      // The same function Add Adjustment calls: the person must be paid in the run, and the run goes back to draft.
      run: (values, actor) =>
        service.addAdjustment(actor, values.payroll_run_id, { employee_id: values.employee_id, kind: values.kind, label: values.label, amount: values.amount, reason: values.reason }),
      readback: (a) => [{ type: "payroll_run", id: a.payroll_run_id, label: `${a.label}, ${a.employee.display_name}`, status: "added", link: screen() }],
      labels: { payroll_run_id: "Run", employee_id: "Person", kind: "Type", label: "Label", amount: "Amount", reason: "Reason" },
    },
  ],
  not_offered: {},
  routes: [
    { intent: "run payroll", screen: "payroll.payroll-runs", params: { action: "new" } },
    { intent: "turn on advanced payroll", screen: "payroll.configurations" },
  ],
});
