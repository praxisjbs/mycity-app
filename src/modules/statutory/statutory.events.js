"use strict";
/**
 * What the statutory rates record (docs/guides/payroll.md §7). Events carry the item, the day and counts, never a
 * rate's figure or an amount (§6.13 rule 5): the figures live in the table.
 *
 *   statutory_rate.saved                       a version of one item was entered on Configurations, from a day, with
 *                                              its legal source or No Legal Source
 *   statutory_rate.removed                     Remove Change: a version still waiting for its day was taken back and
 *                                              the version before it runs on
 *   payroll_run.statutory_report_requested     Statutory Report was pressed on an approved advanced run: the document
 *                                              is reserved in the same transaction and the pdf-render job renders it
 *
 * Nobody is told: a rate is configuration, and the person who entered it is on the Audit Log.
 *
 * The instrument a version cites, when it is uploaded, is a `statutory_source` document: staged through the upload
 * engine (POST /documents) and claimed by the save (shared/documents/vault claim). It is restricted, so only `payroll`
 * edit holders open it, as a payslip is (guide §13.2 item 33).
 */
const { defineEvents } = require("../../shared/events/catalogue");
const { defineDocumentType } = require("../../shared/documents/types");

const EVENTS = defineEvents("payroll", {
  "statutory_rate.saved": { summary: "A statutory rate, a PAYE table or the relief was entered from a date" },
  "statutory_rate.removed": { summary: "A statutory change still waiting for its day was removed" },
  "payroll_run.statutory_report_requested": { summary: "The statutory report of an approved payroll run was asked for" },
});

/** The legal instrument a statutory version cites, uploaded to the vault. */
const SOURCE_DOC_TYPE = "statutory_source";
defineDocumentType(SOURCE_DOC_TYPE, { label: "Statutory Source", module: "payroll", sensitivity: "restricted" });

module.exports = { EVENTS, SOURCE_DOC_TYPE };
