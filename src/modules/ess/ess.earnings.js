"use strict";
/**
 * ESS · My Payslips: the employee's own payslips and the deductions on them (docs/guides/payroll.md §5, §6.10;
 * docs/guides/ess.md §5). Everything here is the caller's own record: the employee comes from the session
 * (meOf), never from the request, and the payslips service answers only for that employee. This tab never reads
 * payroll's tables: it calls the owner, which publishes a payslip only once its run is approved, so a person sees
 * nothing of a month still in the run.
 */
const payslips = require("../payslips/payslips.service");
const { meOf } = require("./ess.documents");

/** The person's published payslips of a year, newest month first, 25 a page. */
const list = (user, query) => payslips.ownList(meOf(user), query);

/** The cards above My Payslips: the year's gross, Net Received, payslips and deductions, and Next Payday. */
const summary = (user, query) => payslips.ownSummary(meOf(user), query);

/** One of the person's own published payslips. */
const get = (user, id) => payslips.ownGet(meOf(user), id);

/** The PDF of one of the person's own payslips (a document the vault lets its owner read). */
const pdf = (user, id) => payslips.ownPdf(meOf(user), id);

/** Email a Copy: the PDF to the person's work email, at most once a minute. */
const email = (user, id) => {
  meOf(user);
  return payslips.emailOwnCopy(user, id);
};

/** Download All: the person's payslips of a year as one PDF, kept 24 hours. */
const exportYear = (user, query) => {
  meOf(user);
  return payslips.requestOwnExport(user, query);
};

/** My Payslips · Deductions: each month that carried one and each scheduled instalment. */
const deductions = (user, query) => payslips.ownDeductions(meOf(user), query);

module.exports = { list, summary, get, pdf, email, exportYear, deductions };
