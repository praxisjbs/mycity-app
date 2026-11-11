"use strict";
/**
 * The statutory report (docs/guides/payroll.md §6.12 rule 6): a run's PAYE, pension, NHF, ITF and NSITF, per item
 * and per person, with the base each rate was applied to and the amount, the employee and employer totals, the
 * conventions the run was computed with and each person's tax and pension numbers (Not Set where none is held).
 *
 *   statutory_report    an export document (kept 24 hours, read by whoever pressed the button), restricted, rendered
 *                       by the worker's pdf-render job from `templates/documents/statutory-report.html`
 *
 * It is made from the run's stored lines, never computed again, so it says what the run paid. Only an approved or
 * paid run has one (the `published` guard: its figures are locked) and only an advanced one (409 ADVANCED_OFF). A
 * reader whose role hides pay or tax numbers is not handed it: the controller asks first, as Download All does.
 */
const c = require("@mycity/contract");
const documents = require("../../shared/documents/generate");
const { defineDocType } = require("../../shared/documents/generate");
const exportFiles = require("../../shared/documents/exports");
const { defineVariables } = require("../../shared/templates/variables");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const m = require("../../shared/money/money");
const { formatMonth } = require("../../shared/time/day-first");
const lock = require("../payroll/payroll.lock");
const repo = require("./statutory.repo");
const { EVENTS } = require("./statutory.events");

const REPORT_DOC = "statutory_report";

defineDocType(REPORT_DOC, {
  label: "Statutory Report",
  module: "payroll",
  template: "statutory-report",
  numbering: null,
  sensitivity: "restricted",
  export: true,
  heading: false,
  title: (d) => d.title,
});
defineVariables("document", "statutory-report", c.statutory.StatutoryReportVars);

/** Each item's words on the report: its name, which number identifies a person for it, and its base in words. */
const ITEMS = Object.freeze({
  paye: { label: "PAYE", number: "Tax ID", of: (p) => p.tax_id },
  pension_employee: { label: "Employee Pension", number: "Pension PIN", of: (p) => p.pension_pin },
  pension_employer: { label: "Employer Pension", number: "Pension PIN", of: (p) => p.pension_pin },
  nhf: { label: "NHF", number: "NHF Number", of: (p) => p.nhf_number },
  itf: { label: "ITF", number: null, of: () => null },
  nsitf: { label: "NSITF", number: null, of: () => null },
});
const BASES = Object.freeze({
  gross: "gross pay",
  pensionable: "pensionable pay",
  basic: "basic pay",
  taxable: "taxable pay",
  annual_payroll: "payroll",
});
const STATUS = Object.freeze({ approved: "Approved", paid: "Paid" });
const yesNo = (v) => (v === true ? "Yes" : v === false ? "No" : "Not Set");
const BASIS = Object.freeze({ annualised: "Annualised", monthly: "Monthly" });

/**
 * The report's variables from the run and its statutory lines, every value as printed. The rate and base of each item
 * are the ones in the run's snapshot (the rates it was computed with), so a rate changed since does not show.
 * @param {object} run    the locked run row, with its config_snapshot
 * @param {object[]} lines  repo.reportLines
 */
function varsOf(run, lines) {
  const snapshot = run.config_snapshot || {};
  const used = new Map((snapshot.statutory_rates || []).map((r) => [r.item, r]));
  const byItem = new Map();
  for (const l of lines) {
    const list = byItem.get(l.code);
    if (list) list.push(l);
    else byItem.set(l.code, [l]);
  }
  const items = [];
  let employee = m.ZERO;
  let employer = m.ZERO;
  for (const [code, rows] of byItem) {
    const words = ITEMS[code];
    const rate = used.get(code);
    const total = m.sum(rows.map((r) => r.amount));
    if (rows[0].kind === "employer") employer = employer.plus(total);
    else employee = employee.plus(total);
    items.push({
      label: words.label,
      kind_label: rows[0].kind === "employer" ? "Employer" : "Employee",
      rate_label: code === "paye" ? "Progressive bands" : rate ? `${m.money(String(rate.rate)).toFixed()}%` : rows[0].detail || "Rate",
      base_label: BASES[rate ? rate.base : code === "paye" ? "taxable" : "gross"] || "pay",
      number_label: words.number,
      rows: rows.map((r) => ({
        employee_name: r.employee_name,
        staff_number: String(r.staff_number),
        statutory_number: words.of(r) || null,
        base: r.base_amount === null ? m.formatNaira(r.amount) : m.formatNaira(r.base_amount),
        amount: m.formatNaira(r.amount),
      })),
      total: m.formatNaira(total),
    });
  }
  const conventions = snapshot.conventions || {};
  return {
    title: "Statutory Report",
    number: run.number,
    period_label: formatMonth(run.period),
    status_label: STATUS[run.status] || "Approved",
    paye_basis_label: BASIS[conventions.paye_basis] || "Not Set",
    pension_reduces_label: yesNo(conventions.pension_reduces_taxable),
    nhf_reduces_label: yesNo(conventions.nhf_reduces_taxable),
    items,
    employee_total: m.formatNaira(employee),
    employer_total: m.formatNaira(employer),
  };
}

/**
 * Statutory Report on an approved or paid advanced run (`published` guard; 409 ADVANCED_OFF for a simple run): the
 * document reserved here, in the request, and rendered by the worker; the screen waits on its ExportFile.
 */
const requestReport = lock.defineWrite("statutoryReport", "published", async (client, run, { actor }) => {
  if (!run.advanced) throw new AppError("ADVANCED_OFF", "This run was computed without statutory items", 409);
  const lines = await repo.reportLines(client, run.payroll_run_id);
  const doc = await documents.generate(client, {
    doc_type: REPORT_DOC,
    entity: { type: "payroll_run", id: run.payroll_run_id },
    subject_employee_id: null,
    data: varsOf(run, lines),
    actor,
  });
  await emit(client, {
    key: EVENTS.PAYROLL_RUN_STATUTORY_REPORT_REQUESTED,
    entity: { type: "payroll_run", id: run.payroll_run_id },
    actor,
    payload: { payroll_run_id: run.payroll_run_id, number: run.number, period: run.period, document_id: doc.document_id, lines: lines.length },
  });
  return exportFiles.present(doc);
});

module.exports = { REPORT_DOC, varsOf, requestReport };
