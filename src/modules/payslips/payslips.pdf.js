"use strict";
/**
 * The payslip as a document (docs/guides/payroll.md §6.10 rules 4 and 6): the two document types, their
 * template variables, and the calls that turn payslips into PDFs through the one document engine
 * (`documents.generate`, rendered by the worker's pdf-render job; Chromium never runs in a request).
 *
 *   payslip                     one person's payslip for one run, made when the run is approved. Restricted:
 *                               the person it is about reads it, anyone else needs `payroll` edit (the vault's
 *                               rule, shared/documents/vault.js canRead), so Management, who may view, may not.
 *   payroll_payslips_export     Download All: every published payslip of a run, one A4 page each, in staff-number
 *                               order; or one person's payslips of a year. An export file (kept 24 hours, never
 *                               locked, read by whoever pressed the button; shared/documents/exports.js).
 *
 * Everything on a printed payslip is a value as it is printed (`₦450,000.00`, `October 2026`, `30/10/2026`): the
 * template states facts, it does not compute them. Employer charges never print. No statutory word is written
 * here: in advanced mode a statutory line arrives as a deduction line with its own label.
 */
const c = require("@mycity/contract");
const { defineDocType } = require("../../shared/documents/generate");
const documents = require("../../shared/documents/generate");
const { defineVariables } = require("../../shared/templates/variables");
const m = require("../../shared/money/money");
const { formatDate, formatMonth } = require("../../shared/time/day-first");
const settings = require("../payroll/payroll.config.repo");
const repo = require("./payslips.repo");

/** The document type of one payslip, and the record it belongs to. */
const PAYSLIP_DOC = "payslip";
/** The document type of Download All, a run's or a person's. */
const EXPORT_DOC = "payroll_payslips_export";

defineDocType(PAYSLIP_DOC, {
  label: "Payslip",
  module: "payroll",
  template: "payslip",
  numbering: null,
  sensitivity: "restricted",
  heading: false,
  title: (d) => `Payslip ${d.number}`,
});
defineVariables("document", "payslip", c.payslips.PayslipVars);

defineDocType(EXPORT_DOC, {
  label: "Payslips Download",
  module: "payroll",
  template: "payslip-batch",
  numbering: null,
  sensitivity: "restricted",
  export: true,
  heading: false,
  title: (d) => d.title,
});
defineVariables("document", "payslip-batch", c.payslips.PayslipBatchVars);

/** A line as the document prints it. */
const printedLine = (l) => ({ label: l.label, detail: l.detail || null, amount: m.formatNaira(l.amount) });

/**
 * The variables of one payslip, every value as printed.
 * @param {object} row    a repo print row (printRowsOfRun, printRowsOfYear)
 * @param {object[]} lines  its earning and deduction lines, in print order
 * @param {string} payDate  the day it is paid or was paid, ISO
 */
function varsOf(row, lines, payDate) {
  return {
    number: row.number,
    period_label: formatMonth(row.period),
    pay_date_label: formatDate(payDate),
    employee_name: row.employee_name,
    staff_number: String(row.staff_number),
    job_title: row.job_title || null,
    department: row.department || null,
    bank_name: row.bank_name || null,
    account_last4: row.account_last4 || null,
    working_days: row.working_days === null || row.working_days === undefined ? null : `${row.working_days_paid ?? row.working_days} of ${row.working_days}`,
    earnings: lines.filter((l) => l.kind === "earning").map(printedLine),
    deductions: lines.filter((l) => l.kind === "deduction").map(printedLine),
    gross_pay: m.formatNaira(row.earnings_total),
    total_deductions: m.formatNaira(row.deductions_total),
    net_pay: m.formatNaira(row.net_pay),
  };
}

/**
 * The day a payslip is paid: the run's own date once it is marked paid, else its month's pay date. Months repeat in
 * a year's payslips, so the setting is read once for each.
 */
async function payDatesOf(db, rows) {
  const dates = new Map();
  for (const r of rows) {
    if (r.run_paid_on) dates.set(r.period, r.run_paid_on);
    else if (!dates.has(r.period)) dates.set(r.period, await settings.payDateFor(db, r.period));
  }
  return dates;
}

/** The variables of each of these print rows, in the order given. */
async function varsOfRows(db, rows) {
  const [lines, dates] = await Promise.all([repo.printLinesOf(db, rows.map((r) => r.payslip_id)), payDatesOf(db, rows)]);
  return rows.map((r) => varsOf(r, lines.get(r.payslip_id) || [], dates.get(r.period)));
}

/**
 * Request the PDF of every published payslip of a run, in the lock's transaction (guide §6.9 rule 3): each becomes a
 * pending document the worker renders, and the payslip names it. The actor is none: the approver is not the uploader
 * of a person's payslip, so reading a payslip is only ever its owner's or a `payroll` edit holder's.
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {string} runId
 * @returns {Promise<number>} how many documents were requested
 */
async function requestForRun(client, runId) {
  const rows = await repo.printRowsOfRun(client, runId);
  const vars = await varsOfRows(client, rows);
  for (let i = 0; i < rows.length; i += 1) {
    const doc = await documents.generate(client, {
      doc_type: PAYSLIP_DOC,
      entity: { type: "payslip", id: rows[i].payslip_id },
      subject_employee_id: rows[i].employee_id,
      data: vars[i],
      actor: null,
    });
    await repo.setDocument(client, rows[i].payslip_id, doc.document_id);
  }
  return rows.length;
}

/**
 * Download All: one document of these payslips, a page each, reserved in the request (guide §6.10 rule 6). It is
 * pending until the pdf-render job has rendered it; the screen waits on its ExportFile and downloads it.
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {{rows: object[], title: string, period_label: string, entity: {type: string, id: string}, subject_employee_id?: string|null, actor: object}} p
 * @returns {Promise<object>} the document row, pending
 */
async function requestExport(client, { rows, title, period_label: periodLabel, entity, subject_employee_id: subjectId = null, actor }) {
  return documents.generate(client, {
    doc_type: EXPORT_DOC,
    entity,
    subject_employee_id: subjectId,
    data: { title, period_label: periodLabel, payslips: await varsOfRows(client, rows) },
    actor,
  });
}

module.exports = { PAYSLIP_DOC, EXPORT_DOC, varsOf, varsOfRows, requestForRun, requestExport };
