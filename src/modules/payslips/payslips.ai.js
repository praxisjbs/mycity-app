"use strict";
/**
 * What the assistant may read about payslips (docs/guides/payroll.md §9). A payslip has no create or edit form,
 * so there is no card: its Email a Copy and Download PDF are the person's own buttons on My Payslips.
 *
 *   payslips.mine   the asking person's own published payslips: the month, gross, net and deductions, a page of 25
 *   payslips.list   the payslips of a run or a month within a Payroll reader's reach, draft and published alike
 *
 *   my_pay.summary  the asking person's own published payslips of a year in figures (praxis-ai.md §6.13), by month
 *                   and their deductions by reason
 *
 * `payslips.mine` is the asker's own whatever their grant says, so its amounts are never masked from them and it
 * is read by their own employee id and nobody else's (payslips.service `ownPayslipsForAssistant`); a person
 * finds a payslip of someone else's only through `payslips.list`, which needs `payroll` view and which the engine
 * masks as the screen is (an amount is null, Restricted, for a role without the salary grant). The route "my payslip"
 * opens ESS · My Payslips.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./payslips.service");

const EMPTY = { data: [], page: { number: 1, size: 25, total: 0, pages: 0, has_next: false } };

module.exports = defineManifest({
  module: "payroll",
  reads: [
    {
      key: "payslips.mine",
      summary: "my_pay.summary",
      description: "List my own payslips of a year, newest month first: the month, my gross pay, deductions and net pay, and whether the run is paid. Only payslips already published to me",
      params: c.payslips.EssPayslipQuery,
      permission: ["ess", "view"],
      run: (_client, params, actor) => (actor.employee_id ? service.ownPayslipsForAssistant(actor.employee_id, params) : EMPTY),
      // The asker's own payslip opens on My Payslips (route-map payroll_own_payslip), never on Payroll · Payslips.
      cite: (row) => ({ type: "payroll_own_payslip", id: row.payslip_id, label: `${row.number}, ${row.month}` }),
    },
    {
      key: "payslips.list",
      summary: "payroll.month",
      description: "List the payslips within my reach, by person, month or payroll run: who it is for, the month, gross pay, deductions, net pay and whether it is still a preview or published",
      params: c.payslips.PayslipListQuery,
      permission: ["payroll", "view"],
      run: (_client, params, actor) => service.list(params, actor.scope),
      cite: (row) => ({ type: "payslip", id: row.payslip_id, label: `${row.number}, ${row.employee.display_name}` }),
    },
  ],
  summaries: [
    {
      key: "my_pay.summary",
      description:
        "My own pay for a year in figures: payslips, gross, deductions and net to date, fines and advance repayments, my deductions by reason, and gross, deductions and net by month",
      params: c.payslips.MyPaySummaryQuery,
      permission: ["ess", "view"],
      // The asker's own, read by their employee id alone and never masked from them, as payslips.mine is.
      run: (client, params, actor) => service.myPaySummary(client, params, actor),
    },
  ],
  not_offered: {},
  routes: [{ intent: "my payslip", screen: "ess.my-payslips" }],
});
