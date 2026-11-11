"use strict";
/**
 * What the statutory rates record (docs/guides/payroll.md §7). Events carry the item, the day and counts, never a
 * rate's figure or an amount (§6.13 rule 5): the figures live in the table.
 *
 *   statutory_rate.saved                       a version of one item was entered on Configurations, from a day
 *   payroll_run.statutory_report_requested     Statutory Report was pressed on an approved advanced run: the document
 *                                              is reserved in the same transaction and the pdf-render job renders it
 *
 * Nobody is told: a rate is configuration, and the person who entered it is on the Audit Log.
 */
const { defineEvents } = require("../../shared/events/catalogue");

const EVENTS = defineEvents("payroll", {
  "statutory_rate.saved": { summary: "A statutory rate, a PAYE table or the relief was entered from a date" },
  "payroll_run.statutory_report_requested": { summary: "The statutory report of an approved payroll run was asked for" },
});

module.exports = { EVENTS };
