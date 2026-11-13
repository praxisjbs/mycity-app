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
 *   pay_to_date.saved, pay_to_date.removed     a person's taxable pay and tax for a year before MyCity's first
 *                                              statutory month was entered, changed or taken away (§13.1 item 42); the
 *                                              person and the year, never a figure
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
  "statutory_rate.saved": { summary: "A statutory rate, a PAYE table, rent relief or the minimum wage was entered from a date" },
  "statutory_rate.removed": { summary: "A statutory change still waiting for its day was removed" },
  "payroll_run.statutory_report_requested": { summary: "The statutory report of an approved payroll run was asked for" },
  "pay_to_date.saved": { summary: "A person's pay and tax to date for a year was entered", sensitive: true },
  "pay_to_date.removed": { summary: "A person's pay and tax to date for a year was removed", sensitive: true },
});

/** The legal instrument a statutory version cites, uploaded to the vault. */
const SOURCE_DOC_TYPE = "statutory_source";
defineDocumentType(SOURCE_DOC_TYPE, { label: "Statutory Source", module: "payroll", sensitivity: "restricted" });

/** A previous employer's leaving certificate behind a person's Pay to Date (Operation of PAYE Regulations 2002, reg 5). */
const CERTIFICATE_DOC_TYPE = "leaving_certificate";
defineDocumentType(CERTIFICATE_DOC_TYPE, { label: "Leaving Certificate", module: "payroll", sensitivity: "restricted" });

module.exports = { EVENTS, SOURCE_DOC_TYPE, CERTIFICATE_DOC_TYPE };
