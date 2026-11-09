"use strict";
/**
 * What the payslips module records, and what follows (docs/guides/payroll.md §6.10, §7). Loaded by the API
 * (through the service) and the worker. Events carry ids, the period, counts and a flag, never an amount
 * (§6.13 rule 5): amounts live in the tables and are masked on the way out.
 *
 *   payroll_run.email_requested   Email All Payslips was pressed: the outbox handler `payroll.email_payslips`
 *                                 walks the run's published payslips not yet emailed (all of them on a resend),
 *                                 25 a pass, and marks each emailed in its own transaction
 *   payslip.emailed               one payslip was mailed to its owner, by Email All or Email a Copy: the handler
 *                                 `payslips.mail` queues the mail with the PDF attached; audit
 *   payroll_run.export_requested  Download All was pressed on a run: its PDF is reserved in the same transaction
 *   payslip.export_requested      a person pressed Download All on My Payslips: their year's PDF was reserved
 *
 * A mail is queued once for each `payslip.emailed` (the job id carries the event), and a payslip is marked emailed
 * before its mail is queued, so a repeat press of Email All never mails a person twice. The PDFs are made at
 * approval (payslips.pdf.js, in the lock) and rendered by the worker's pdf-render job; Email All takes the payslips
 * whose PDF is done and tries again for the rest.
 *
 * The service is required when a handler runs, not when this file loads: the service requires this file for its
 * event keys, and the worker loads this file on its own. Requiring payslips.pdf here registers the document types
 * and their template variables in the worker, which renders them.
 */
const c = require("@mycity/contract");
const { defineEvents } = require("../../shared/events/catalogue");
const { defineVariables } = require("../../shared/templates/variables");
const outbox = require("../../shared/events/outbox");

const EVENTS = defineEvents("payroll", {
  "payroll_run.email_requested": { summary: "Email All Payslips was pressed on a payroll run" },
  "payroll_run.export_requested": { summary: "Download All was pressed on a payroll run" },
  "payslip.emailed": { summary: "A payslip was emailed to its owner" },
  "payslip.export_requested": { summary: "A person downloaded all their payslips of a year" },
});

/** The mail a payslip is sent with. */
const EMAIL = "payslip-ready";
defineVariables("email", EMAIL, c.payslips.PayslipReadyEmailVars);

// The document types and their variables are registered where the worker also loads them.
require("./payslips.pdf");

const service = () => require("./payslips.service");

outbox.register(EVENTS.PAYROLL_RUN_EMAIL_REQUESTED, "payroll.email_payslips", (event, ctx) => service().emailRun(event, ctx));
outbox.register(EVENTS.PAYSLIP_EMAILED, "payslips.mail", (event, ctx) => service().mailPayslip(event, ctx));

module.exports = { EVENTS, EMAIL };
