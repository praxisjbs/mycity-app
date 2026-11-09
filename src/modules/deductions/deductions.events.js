"use strict";
/**
 * What the deductions tab records and who it tells (docs/guides/payroll.md §6.6, §7). Loaded by the API
 * (through the service) and the worker.
 *
 *   payroll_deduction.accepted   a fine was accepted into the months Operations & People chose, or an
 *                                advance was recorded; the person is told "Deduction Scheduled"
 *   payroll_deduction.waived     a pending fine was waived; the person is told "Fine Waived"
 *   payroll_deduction.released   an accepted fine went back to waiting before any month was taken
 *   payroll_deduction.cancelled  an advance recorded in error was cancelled
 *   payroll_deduction.fine_pending   a sanction was issued with a fine: payroll edit holders are told
 *                                "Fine Waiting for Payroll"
 *
 * `payroll_deduction.settled` is the run's (payroll.events.js): the lock settles a deduction whose last
 * instalment applied. Events carry ids, the months and counts, never an amount (§6.13 rule 5): amounts live
 * in the tables and are masked on the way out, so a notice, an audit line and an email never carry one.
 *
 * The fine's waiting notice is written after the sanction commits, from an outbox handler on
 * `sanction.issued` (queries guide §7), so a rolled-back approval tells nobody and a retry tells once.
 */
const { defineEvents } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");
const outbox = require("../../shared/events/outbox");
const { formatMonth } = require("../../shared/time/day-first");
const { EVENTS: SANCTION_EVENTS } = require("../sanctions/sanctions.events");

const EVENTS = defineEvents("payroll", {
  "payroll_deduction.accepted": { summary: "A fine was accepted or an advance recorded, to be deducted over months" },
  "payroll_deduction.waived": { summary: "A fine waiting for payroll was waived" },
  "payroll_deduction.released": { summary: "An accepted fine went back to waiting for payroll" },
  "payroll_deduction.cancelled": { summary: "An advance recorded in error was cancelled" },
  "payroll_deduction.fine_pending": { summary: "A fine is waiting for payroll to accept or waive it" },
});

const months = (n) => `${n} ${Number(n) === 1 ? "month" : "months"}`;

defineNotification(EVENTS.PAYROLL_DEDUCTION_ACCEPTED, {
  to: [{ subject: true }],
  title: "Deduction Scheduled",
  body: (e) => `${months(e.payload.instalments)} from ${formatMonth(e.payload.start_period)}: ${e.payload.reason}`,
});

defineNotification(EVENTS.PAYROLL_DEDUCTION_WAIVED, {
  to: [{ subject: true }],
  title: "Fine Waived",
  body: (e) => `${e.payload.query_number}: ${e.payload.reason}`,
});

defineNotification(EVENTS.PAYROLL_DEDUCTION_FINE_PENDING, {
  to: [{ permission: ["payroll", "edit"] }],
  who: "Everyone with payroll edit",
  title: "Fine Waiting for Payroll",
  body: (e) => `${e.payload.employee_name}, ${e.payload.query_number}`,
});

/*
 * The service is required when a handler runs, not when this file loads: the service requires this file for
 * its event keys, and the worker loads this file on its own.
 */
outbox.register(SANCTION_EVENTS.SANCTION_ISSUED, "deductions.fine_pending", (event) =>
  event.payload && event.payload.fine_amount ? require("./deductions.service").fineWaiting(event.payload) : undefined,
);

module.exports = { EVENTS };
