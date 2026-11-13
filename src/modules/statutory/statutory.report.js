"use strict";
/**
 * The statutory report (docs/guides/payroll.md §6.12 rule 6): a run's PAYE (and PAYE Refund), pension, NHF, ITF and NSITF,
 * per item and per person, with the base each was worked from and the amount, the employee and employer totals, how PAYE
 * was worked out and the figures with no line of their own (rent relief, the minimum wage), each item's legal source as
 * the run's snapshot holds it, when and where each is remitted (§6.16), and each person's tax and pension numbers (Not
 * Set where none is held). PAYE and its refund are grouped by the State each person lives in, whose Internal Revenue
 * Service the tax goes to (the Guidelines 2026, para 25; §13.1 item 46).
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
const lagos = require("../../shared/time/lagos");
const { formatDate, formatMonth } = require("../../shared/time/day-first");
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

/** The tenth of the month after a run's period, PAYE's remittance day ("10/11/2026" for October 2026). */
const tenthOfNext = (period) => formatDate(`${lagos.addMonths(period, 1).slice(0, 8)}10`);

/**
 * Each line's words on the report: its name, which number identifies a person for it, which rate's source it prints,
 * whether its people are grouped by State, and when and where it is remitted, as §6.16 cites each.
 */
const ITEMS = Object.freeze({
  paye: {
    label: "PAYE",
    number: "Tax ID",
    of: (p) => p.tax_id,
    rate: "paye",
    byState: true,
    remit: (period) =>
      `By ${tenthOfNext(period)}, to the Internal Revenue Service of the State each person lives in (Operation of PAYE Regulations 2002, reg 7(1); Joint Revenue Board's Guidelines 2026, paras 12.2 and 25)`,
  },
  paye_refund: {
    label: "PAYE Refund",
    number: "Tax ID",
    of: (p) => p.tax_id,
    rate: "paye",
    byState: true,
    remit: () => "Paid back to each person in this run, the year's cumulative tax having fallen (Operation of PAYE Regulations 2002, reg 4(2))",
  },
  pension_employee: {
    label: "Employee Pension",
    number: "Pension PIN",
    of: (p) => p.pension_pin,
    rate: "pension_employee",
    remit: () => "Within 7 working days of pay day, with the employer's share (Pension Reform Act 2014, s.11(3))",
  },
  pension_employer: {
    label: "Employer Pension",
    number: "Pension PIN",
    of: (p) => p.pension_pin,
    rate: "pension_employer",
    remit: () => "Within 7 working days of pay day, with the employee's share (Pension Reform Act 2014, s.11(3))",
  },
  nhf: {
    label: "NHF",
    number: "NHF Number",
    of: (p) => p.nhf_number,
    rate: "nhf",
    remit: () => "Within one month of the deduction, to the Federal Mortgage Bank of Nigeria (National Housing Fund Act, s.9(2))",
  },
  itf: {
    label: "ITF",
    number: null,
    of: () => null,
    rate: "itf",
    remit: (period) =>
      `The year's contribution, by 1 April ${Number(period.slice(0, 4)) + 1} (Industrial Training Fund Act, s.16 as inserted in 2011)`,
  },
  nsitf: {
    label: "NSITF",
    number: null,
    of: () => null,
    rate: "nsitf",
    remit: () => "In the first two working days of the month (Employee's Compensation Act 2010, s.33(1); NSITF's statement of the rate)",
  },
});
const BASES = Object.freeze({
  gross: "gross pay",
  pensionable: "pensionable pay",
  basic: "basic pay",
  taxable: "taxable pay",
  annual_payroll: "payroll",
  rent: "the year's rent",
});
const STATUS = Object.freeze({ approved: "Approved", paid: "Paid" });
const yesNo = (v) => (v === true ? "Yes" : v === false ? "No" : "Not Set");
const BASIS = Object.freeze({ annualised: "Annualised", monthly: "Monthly" });

/** What a snapshot taken before sources were kept says of its rows: 6040 marked such rows with this reason. */
const BEFORE_SOURCES = "Entered before sources were required";

/** Where a person lives, as a group of the report reads it. */
const stateLabel = (code) => (code && c.organisation.STATE_LABELS[code]) || "Not Set";

/**
 * A rate's legal source as the report prints it: the instrument and section with the day checked, or No Legal Source
 * with its reason; and its link, when it has one.
 * @param {object|undefined} r  a row of the run's snapshot (`statutory_rates`)
 * @returns {{label: string, link: string|null}}
 */
function sourceLabel(r) {
  if (!r || r.no_legal_source === true || !r.source_title)
    return { label: `No Legal Source: ${(r && r.no_source_reason) || BEFORE_SOURCES}`, link: null };
  const checked = r.source_checked_on ? `. Checked ${formatDate(r.source_checked_on)}` : "";
  return { label: `${r.source_title}, ${r.source_section}${checked}`, link: r.source_url || null };
}

/** A figure with no line of its own, as the box above the items prints it, with its source; or Not in force. */
function figureRule(label, row, words) {
  if (!row) return { label, value: "Not in force" };
  const source = sourceLabel(row);
  return { label, value: `${words(row)}. Source: ${source.label}${source.link ? ` · ${source.link}` : ""}` };
}

/**
 * The box above the items: how PAYE was worked out and the figures that have no line (§6.12 rules 11, 14 and 15). A run
 * computed before PR 11 kept the accountant's conventions instead, and prints them as it was computed.
 */
function rulesOf(snapshot, used) {
  if (snapshot.paye_method !== "cumulative") {
    const conventions = snapshot.conventions || {};
    return [
      { label: "PAYE Basis", value: BASIS[conventions.paye_basis] || "Not Set" },
      { label: "Pension Reduces Taxable Pay", value: yesNo(conventions.pension_reduces_taxable) },
      { label: "NHF Reduces Taxable Pay", value: yesNo(conventions.nhf_reduces_taxable) },
      ...(used.has("relief") ? [{ label: "Relief Source", value: sourceLabel(used.get("relief")).label }] : []),
    ];
  }
  return [
    {
      label: "PAYE",
      value:
        "On the year to date, the year's bands scaled to the months elapsed (Operation of PAYE Regulations 2002, regs 3 and 4; Nigeria Tax Administration Act 2025, s.51(7))",
    },
    {
      label: "Taxable Pay",
      value: "Gross pay less employee pension and NHF as deducted (Nigeria Tax Act 2025, s.30(2)(a)(i) and (iii))",
    },
    figureRule("Rent Relief", used.get("rent_relief"), (r) => `${m.money(String(r.rate)).toFixed()}% of the year's rent declared, at most ${m.formatNaira(r.flat_amount)}`),
    figureRule("Minimum Wage", used.get("minimum_wage"), (r) => `${m.formatNaira(r.flat_amount)} a month: no PAYE at or below it`),
  ];
}

/**
 * The report's variables from the run and its statutory lines, every value as printed. The rate, base and source of each
 * item are the ones in the run's snapshot (the figures it was computed with), so a figure changed since does not show.
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
    const rate = used.get(words.rate);
    const total = m.sum(rows.map((r) => r.amount));
    if (rows[0].kind === "employer") employer = employer.plus(total);
    else if (code === "paye_refund") employee = employee.minus(total);
    else employee = employee.plus(total);
    const printed = (r) => ({
      employee_name: r.employee_name,
      staff_number: String(r.staff_number),
      statutory_number: words.of(r) || null,
      base: r.base_amount === null ? m.formatNaira(r.amount) : m.formatNaira(r.base_amount),
      amount: m.formatNaira(r.amount),
    });
    const groups = [];
    if (words.byState) {
      for (const r of rows) {
        const label = stateLabel(r.state_of_residence);
        let group = groups.find((g) => g.label === label);
        if (!group) groups.push((group = { label, rows: [], sum: [] }));
        group.rows.push(printed(r));
        group.sum.push(r.amount);
      }
    } else groups.push({ label: null, rows: rows.map(printed), sum: null });
    const source = sourceLabel(rate);
    const paye = code === "paye" || code === "paye_refund";
    items.push({
      label: words.label,
      kind_label: rows[0].kind === "employer" ? "Employer" : "Employee",
      rate_label: paye ? "Cumulative bands" : rate ? `${m.money(String(rate.rate)).toFixed()}%` : rows[0].detail || "Rate",
      base_label: BASES[paye ? "taxable" : rate ? rate.base : "gross"] || "pay",
      number_label: words.number,
      source_label: source.label,
      source_link: source.link,
      remit_label: words.remit(run.period),
      groups: groups.map((g) => ({ label: g.label, rows: g.rows, total: g.sum ? m.formatNaira(m.sum(g.sum)) : null })),
      total: m.formatNaira(total),
    });
  }
  return {
    title: "Statutory Report",
    run_number: run.number,
    period_label: formatMonth(run.period),
    status_label: STATUS[run.status] || "Approved",
    rules: rulesOf(snapshot, used),
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

module.exports = { REPORT_DOC, varsOf, sourceLabel, requestReport };
