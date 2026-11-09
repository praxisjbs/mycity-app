"use strict";
/**
 * What the assistant may do about payroll runs (docs/guides/payroll.md §9). Payroll registers no AI job of
 * its own: it adds no model call, and its cards run on the assistant engine's existing job.
 *
 * One card so far, through the service function New Run's own button calls: New Run opens the run for a
 * month. The rest of payroll's reads, summary and cards (Submit for Approval, Add Adjustment, the deductions
 * and advances) come with M6 PR 6. Gate 23 holds a built module's create form to a card from the PR that
 * builds the module, so New Run's is here. It is risk `payroll`: Confirm It's You first (praxis-ai.md
 * decision 11), though opening a run decides no pay. Approve and Reject are the approvals' own card
 * (approvals.decide).
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const routeMap = require("../../shared/route-map");
const { formatMonth } = require("../../shared/time/day-first");
const service = require("./payroll.service");

module.exports = defineManifest({
  module: "payroll",
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
      readback: (run) => [
        {
          type: "payroll_run",
          id: run.payroll_run_id,
          label: `${run.number}, ${formatMonth(run.period)}`,
          status: "draft",
          link: routeMap.screenPath("payroll", "payroll-runs"),
        },
      ],
      labels: { period: "Month" },
    },
  ],
  not_offered: {},
  routes: [{ intent: "run payroll", screen: "payroll.payroll-runs", params: { action: "new" } }],
});
