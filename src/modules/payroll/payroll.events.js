"use strict";
/**
 * What a payroll run records, who it tells, and how its approval reaches it (docs/guides/payroll.md §7).
 * Loaded by the API (through the service) and the worker.
 *
 *   payroll_run.created, .computed, .discarded   a run was opened, computed or discarded
 *   payroll_run.submitted    Submit committed: the pay items and instalments are frozen and `payroll.run`
 *                            opened, naming the CEO; the engine tells the approver "Approval needed"
 *   payroll_run.returned     the approver sent it back or rejected it, or the opener withdrew it: everything
 *                            frozen was released and the run is a Draft again; the engine tells the submitter
 *   payroll_run.approved     the approval ended approved: the run is locked and its payslips published
 *   payroll_run.paid         Mark Paid: the money has been transferred
 *   payslip.published        one per person, in the lock: "Your payslip is ready"
 *   payslip.excluded, .included   a person was left out of a run, or put back
 *   payroll_adjustment.added, .removed   a one-off earning or deduction was added to a run, or taken off
 *   payroll_deduction.settled   a fine or an advance was deducted in full (its last instalment applied)
 *   payroll_setting.changed  the advanced option, the pay day, Bank Details Required or a convention, from a date
 *                            (security: the access watchers are told)
 *
 * Events carry ids, the period, counts and statuses, never an amount (§6.13 rule 5): amounts live in the
 * tables and are masked on the way out, so an audit line never carries one either.
 *
 * A run is decided in its approval (`payroll.run`, shared/workflow). The engine already tells the
 * approver when it reaches them and the submitter when it is decided or sent back
 * (shared/notifications/fanout.js), so this file adds only the person's own notice. After commit, each of
 * the approval's moves is copied onto the run, at least once and idempotently (payroll.service settle and
 * sentBack): its end (approved, rejected, or withdrawn), and a Send Back, which withdraws the approval for
 * its opener and returns the run to Draft. A timeout never approves a payroll: the definition carries
 * money, so the engine re-arms the stage and tells the CEO instead.
 */
const { defineEvents, WORKFLOW } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");
const outbox = require("../../shared/events/outbox");
const workflow = require("../../shared/workflow/engine");
const { formatMonth } = require("../../shared/time/day-first");

const EVENTS = defineEvents("payroll", {
  "payroll_run.created": { summary: "A payroll run was opened for a month" },
  "payroll_run.computed": { summary: "A payroll run was computed" },
  "payroll_run.discarded": { summary: "A payroll run that was never sent was discarded" },
  "payroll_run.submitted": { summary: "A payroll run was sent for approval" },
  "payroll_run.returned": { summary: "A payroll run came back from approval to a draft" },
  "payroll_run.approved": { summary: "A payroll run was approved and locked" },
  "payroll_run.paid": { summary: "A payroll run was marked paid" },
  "payslip.published": { summary: "A payslip was published to its owner" },
  "payslip.excluded": { summary: "A person was left out of a payroll run" },
  "payslip.included": { summary: "A person was put back into a payroll run" },
  "payroll_adjustment.added": { summary: "A one-off earning or deduction was added to a payroll run" },
  "payroll_adjustment.removed": { summary: "A one-off earning or deduction was taken off a payroll run" },
  "payroll_deduction.settled": { summary: "A fine or an advance was deducted in full" },
  // Configurations: the advanced option, the pay day, Bank Details Required or a convention changed from a date.
  // Security: who may change how everyone is paid is watched as access changes are (§7).
  "payroll_setting.changed": { summary: "The payroll setting was changed from a date", security: true },
});

/** The approval flow every run opens (seeded in 6099; DEFAULTS in shared/workflow/definitions.js). */
const DEFINITION_KEY = "payroll.run";

defineNotification(EVENTS.PAYSLIP_PUBLISHED, {
  to: [{ subject: true }],
  title: "Your payslip is ready",
  body: (e) => formatMonth(e.payload.period),
});

/*
 * The service is required when a handler runs, not when this file loads: the service requires this file
 * for its event keys, and the worker loads this file on its own.
 */
const service = () => require("./payroll.service");
const ofRun = (event) =>
  event.payload && event.payload.definition_key === DEFINITION_KEY && event.entity && event.entity.type === "payroll_run";

workflow.onCompleted(DEFINITION_KEY, "payroll.apply_decision", (event) =>
  service().settle(event.entity.id, event.payload.state, event.payload.instance_id, event.payload.reason),
);

outbox.register(WORKFLOW.WORKFLOW_CANCELLED, "payroll.apply_withdrawal", (event) =>
  ofRun(event) ? service().settle(event.entity.id, "cancelled", event.payload.instance_id, event.payload.reason) : undefined,
);

outbox.register(WORKFLOW.WORKFLOW_CHANGES_REQUESTED, "payroll.sent_back", (event) =>
  ofRun(event) ? service().sentBack(event.entity.id, event.payload) : undefined,
);

module.exports = { EVENTS, DEFINITION_KEY };
