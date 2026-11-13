"use strict";
/**
 * What a payslip comes to (docs/guides/payroll.md §6.3 to §6.8, §6.14): pure functions, no database, no
 * clock. Compute reads a person's month from the owners (payroll.inputs.js), hands it here, and writes
 * what comes back; a test can check every figure without PostgreSQL.
 *
 * Money is `shared/money` throughout (Decimal, kobo, half up) and is rounded once, where a line is
 * written: a prorated Monthly Pay, a daily rate times days, an allocated instalment. An amount that
 * attendance already priced is taken as it is. A payslip's totals are the sums of its lines and the net
 * follows from them, so a payslip can never disagree with its own lines (§6.8 rule 2). A line's amount
 * is never negative; its kind gives the direction.
 *
 *   proratedPay()      Monthly Pay for the part of the month a person is paid
 *   daysAmount()       the daily rate times days, rounded once (unpaid leave, unpaid suspension)
 *   instalmentShares() a deduction spread over months, the kobo that do not divide to the first
 *   buildLines()       the ordered lines of one payslip from one person's month
 *   totalsOf()         the payslip's totals from its lines
 *   sumTotals()        a run's totals from its payslips'
 *   payDate()          the day a month is paid: the pay day, or the month's last day when it is past
 *   componentPay()     advanced mode: a person's pay split, each component prorated, rounded once (§6.11 rule 6)
 *   computeStatutory() advanced mode: PAYE on the year to date (or its refund), pension, NHF, ITF and NSITF from the
 *                      figures in force, each rule traced to a row of §6.16, none of them a default (§6.12)
 *   payslipOf()        a payslip's lines and, in advanced mode, the month's taxable pay its PAYE was worked from
 */
const m = require("../../shared/money/money");

/** Each line's code with the direction and the words the payslip shows (§4.2). */
const LINES = Object.freeze({
  monthly_pay: { kind: "earning", label: "Monthly Pay" },
  overtime: { kind: "earning", label: "Overtime" },
  lateness: { kind: "deduction", label: "Lateness" },
  early_departure: { kind: "deduction", label: "Early Departure" },
  absence: { kind: "deduction", label: "Absence" },
  unpaid_leave: { kind: "deduction", label: "Unpaid Leave" },
  unpaid_suspension: { kind: "deduction", label: "Unpaid Suspension" },
  fine: { kind: "deduction", label: "Fine" },
  advance: { kind: "deduction", label: "Salary Advance Repayment" },
});

/** The attendance kinds that are deductions, with the code each becomes and how its count reads. */
const ATTENDANCE_DEDUCTIONS = Object.freeze([
  { kind: "late", code: "lateness", one: "late arrival", many: "late arrivals" },
  { kind: "early_departure", code: "early_departure", one: "early departure", many: "early departures" },
  { kind: "absence", code: "absence", one: "absence", many: "absences" },
]);

const MONTHS = Object.freeze([
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]);

const plural = (n, one, many) => `${n} ${Number(n) === 1 ? one : many}`;

/** "12 October" or "12 to 13 October" for two dates in one month. */
function rangeLabel(from, to) {
  const day = (d) => String(Number(d.slice(8, 10)));
  const month = MONTHS[Number(from.slice(5, 7)) - 1];
  return from === to ? `${day(from)} ${month}` : `${day(from)} to ${day(to)} ${month}`;
}

/** The days of a leave or a suspension as a payslip reads them: "2 days", "0.5 days", "1 day". */
function daysLabel(days) {
  const n = m.money(String(days)).toNumber();
  return `${n} ${n === 1 ? "day" : "days"}`;
}

/**
 * Monthly Pay for the part of the month a person is paid (§6.3 rule 1). A person paid the whole month is
 * paid the whole gross, never a daily rate times days. Otherwise the gross times the part, rounded once:
 * the part is the working days paid over the working days, and for a person with no working day in the
 * month (a month of Off days) the calendar days employed over the days of the month.
 * @param {string|object} gross  the person's monthly gross
 * @param {{workingDays: number, daysPaid: number, calendarDays: number, calendarPaid: number}} part
 * @returns {string} the amount on the wire
 */
function proratedPay(gross, { workingDays, daysPaid, calendarDays, calendarPaid }) {
  const whole = workingDays > 0 ? daysPaid === workingDays : calendarPaid === calendarDays;
  if (whole) return m.toWire(gross);
  const [paid, of] = workingDays > 0 ? [daysPaid, workingDays] : [calendarPaid, calendarDays];
  if (paid <= 0 || of <= 0) return m.toWire(0);
  return m.toWire(m.money(gross).times(paid).dividedBy(of));
}

/**
 * The daily rate times days, rounded once (§6.5): `gross / workingDays * days`, at full precision until
 * the end. Nothing with no working day in the month, which has no daily rate (§6.2 rule 3).
 * @param {string|object} gross
 * @param {number} workingDays  the person's working days in the month
 * @param {number|string} days  how many of them, a half day allowed
 */
function daysAmount(gross, workingDays, days) {
  if (!workingDays || m.money(String(days)).isZero()) return m.toWire(0);
  return m.toWire(m.money(gross).dividedBy(workingDays).times(m.money(String(days))));
}

/**
 * A deduction spread over months: equal shares, the kobo that do not divide going to the first
 * (₦10,000.00 over 3 is 3,333.34, 3,333.33, 3,333.33). They sum exactly to the total (§6.6 rule 3).
 * @returns {string[]} one amount per month
 */
function instalmentShares(total, months) {
  return m.allocate(total, Array.from({ length: months }, () => 1));
}

/* ------------------------------------------------------------------ *
 * Advanced mode (§6.11 rule 6, §6.12): the pay split and the statutory items
 * ------------------------------------------------------------------ */

/**
 * The statutory items that become lines, in the order a payslip prints them, with their words. PAYE Refund is an earning
 * (§13.1 item 43); rent relief and the minimum wage are figures with no line of their own.
 */
const STATUTORY_LINES = Object.freeze([
  { item: "pension_employee", kind: "deduction", label: "Pension" },
  { item: "nhf", kind: "deduction", label: "NHF" },
  { item: "paye", kind: "deduction", label: "PAYE" },
  { item: "paye_refund", kind: "earning", label: "PAYE Refund" },
  { item: "pension_employer", kind: "employer", label: "Employer Pension" },
  { item: "itf", kind: "employer", label: "ITF" },
  { item: "nsitf", kind: "employer", label: "NSITF" },
]);

/** The components pension's base is never less than: "basic salary, housing allowance and transport allowance" (s.120). */
const PENSION_FLOOR = Object.freeze(["basic", "housing", "transport"]);

/** "7.5%" from a stored rate ("7.500000"). */
function rateLabel(rate) {
  return `${m.money(String(rate)).toFixed()}%`;
}

/**
 * A person's pay split for the part of the month they are paid (§6.11 rule 6): each component prorated as Monthly
 * Pay is (§6.3 rule 1) and rounded once, so a person paid the whole month is paid each component whole. The pensionable
 * pay is the components marked pensionable, never less than basic, housing and transport as paid (Pension Reform Act
 * 2014, s.120, "shall not be less than a total sum of basic salary, housing allowance and transport allowance"). Pure.
 * @param {Array<{id: string, code: string, label: string, amount: string, pensionable: boolean}>} components
 * @param {{workingDays: number, daysPaid: number, calendarDays: number, calendarPaid: number}} part
 * @returns {{lines: Array<{id: string, code: string, label: string, amount: string, pensionable: boolean}>, basic: string, pensionable: string}}
 */
function componentPay(components, part) {
  const lines = components.map((c) => ({ ...c, amount: proratedPay(c.amount, part) }));
  const total = (pick) => m.sum(lines.filter(pick).map((c) => c.amount));
  const marked = total((c) => c.pensionable);
  const floor = total((c) => PENSION_FLOOR.includes(String(c.code)));
  return {
    lines,
    basic: m.toWire(total((c) => c.code === "basic")),
    pensionable: m.toWire(m.Decimal.max(marked, floor)),
  };
}

/**
 * Tax over ordered bands (§6.12): each band taxes the part of `amount` between its `band_from` and its `band_to` (no
 * end on the last) at its rate. Unrounded.
 * @param {string|object} amount
 * @param {Array<{band_from: string|object, band_to: string|object|null, rate: string, position: number}>} bands
 */
function progressiveTax(amount, bands) {
  const taxable = m.money(amount);
  let tax = m.ZERO;
  for (const b of [...bands].sort((x, y) => x.position - y.position)) {
    const from = m.money(b.band_from);
    if (taxable.lessThanOrEqualTo(from)) break;
    const to = b.band_to === null || b.band_to === undefined ? taxable : m.Decimal.min(taxable, m.money(b.band_to));
    if (to.greaterThan(from)) tax = tax.plus(m.percentOf(to.minus(from), b.rate));
  }
  return tax;
}

/**
 * A year's bands as they stand after `month` months of the calendar year (JBS Praxis, §13.1 item 39): each limit times
 * month/12, the rates unchanged. Unrounded.
 * @param {Array<{band_from: string, band_to: string|null, rate: string, position: number}>} bands
 * @param {number} month  1 to 12
 */
function scaledBands(bands, month) {
  const k = m.money(month).dividedBy(12);
  return bands.map((b) => ({
    ...b,
    band_from: m.money(b.band_from).times(k),
    band_to: b.band_to === null || b.band_to === undefined ? null : m.money(b.band_to).times(k),
  }));
}

/**
 * A year's rent relief (Nigeria Tax Act 2025, s.30(2)(a)(vi)): its rate of the rent the person declared for the year,
 * at most its cap; nothing without the figures in force or a declaration. Unrounded.
 * @param {{rate: string, flat_amount: string}|undefined} row  rent relief's version in force
 * @param {string|null} yearRent  the declared rent, pro-rated to the year
 */
function rentReliefOf(row, yearRent) {
  if (!row || yearRent === null || yearRent === undefined) return m.ZERO;
  return m.Decimal.min(m.percentOf(yearRent, row.rate), m.money(row.flat_amount));
}

/** The year to date of a person with none: a joiner with no leaving certificate, MyCity's first statutory month. */
const NOTHING_TO_DATE = Object.freeze({ taxable_pay: "0.00", tax: "0.00" });

/**
 * The statutory lines of one payslip (§6.12), pure and deterministic, with no figure in the code: every rate, band and
 * amount is a row of `rates` (those in force on the run's last day), and every rule traces to a row of §6.16.
 *
 *   pension_employee, pension_employer  rate × the base its row names: the pensionable pay (never less than basic,
 *                                        housing and transport) or the month's gross (Pension Reform Act 2014, s.4(1),
 *                                        s.120)
 *   nhf                                  rate × the month's gross, only for a person who chose to contribute and whose
 *                                        rate of pay is the minimum wage or more (NHF Act s.4(1)(b) as substituted in
 *                                        2023; §13.1 items 44 and 45)
 *   itf, nsitf                           rate × the month's gross, its share of the payroll (ITF Act s.6(1) and s.16;
 *                                        Employee's Compensation Act 2010, s.33(1))
 *   paye, paye_refund                    cumulative over the calendar year (Operation of PAYE Regulations 2002, regs 3
 *                                        and 4; Nigeria Tax Administration Act 2025, s.51(6) and (7)): the taxable pay
 *                                        to date (each month's gross less employee pension and NHF as deducted, Nigeria
 *                                        Tax Act 2025, s.30(2)(a)(i) and (iii)) less rent relief to date (the year's
 *                                        relief × month/12), taxed on the year's bands × month/12 (§13.1 item 39); that
 *                                        tax less the PAYE already deducted this year is the month's PAYE, or its PAYE
 *                                        Refund when it has fallen (reg 4(2), §13.1 item 43). None for a person whose
 *                                        rate of pay is the minimum wage or less (NTA s.58 and s.163(1)(t)): their month
 *                                        stays out of the year to date (`taxable_pay` null, §13.1 item 45)
 *
 * An item with no row is not computed (§6.12 rule 3), and nothing is defaulted; a row naming a base its item no longer
 * allows (a version saved before PR 11 on `basic`) is not computed either, and Compute reports it missing. Each line is
 * rounded once, half up, from full precision; a line of nothing is left off. Each carries `base_amount`, what it was
 * worked from (for PAYE and its refund the month's taxable pay), for the statutory report.
 *
 * @param {object} p
 * @param {string} p.gross        the month's earnings: Monthly Pay or the split, overtime, earning adjustments
 * @param {string} p.pensionable  the pensionable pay as paid (componentPay; the whole Monthly Pay with no split)
 * @param {string} p.rate_of_pay  the person's monthly gross: the minimum wage's measure (§13.1 item 45)
 * @param {boolean} p.nhf_contributes  whether the person chose to contribute to NHF (§13.1 item 44)
 * @param {number} p.month        the period's month of the calendar year, 1 to 12
 * @param {{taxable_pay: string, tax: string}} [p.to_date]  the year before this month: Pay to Date and the earlier
 *                                months' advanced payslips (their taxable pay; their PAYE less PAYE Refund)
 * @param {string|null} [p.year_rent]  the rent the person declared for the year, pro-rated to it, or null
 * @param {Record<string, any>} p.rates  item → its row: `{ base, rate }`; paye `{ base, bands }`; rent_relief
 *                                `{ base, rate, flat_amount }`; minimum_wage `{ base, flat_amount }`
 * @returns {{lines: Array<{kind: string, code: string, label: string, detail: string|null, amount: string,
 *   base_amount: string}>, taxable_pay: string|null}}
 */
function computeStatutory(p) {
  const rates = p.rates || {};
  const month = Number(p.month);
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error("computeStatutory: month is 1 to 12");
  const toDate = p.to_date || NOTHING_TO_DATE;
  const g = m.money(p.gross);
  const bases = { gross: g, annual_payroll: g, pensionable: m.money(p.pensionable) };
  const wage = rates.minimum_wage ? m.money(rates.minimum_wage.flat_amount) : null;
  const amounts = {};
  const out = [];
  const specOf = (item) => STATUTORY_LINES.find((s) => s.item === item);
  const line = (spec, amount, base, detail) => {
    amounts[spec.item] = m.round(amount);
    if (m.isZero(amounts[spec.item])) return;
    out.push({ kind: spec.kind, code: spec.item, label: spec.label, detail, amount: m.toWire(amount), base_amount: m.toWire(base) });
  };

  // NHF is a deduction only for a person who chose it and earns the minimum wage or more; with no wage in force that
  // cannot be told, and Compute reports the wage missing.
  const nhfDue = p.nhf_contributes === true && wage !== null && m.compare(p.rate_of_pay, wage) >= 0;

  // The flat-rate items first: PAYE's taxable pay reads employee pension and NHF as deducted.
  for (const spec of STATUTORY_LINES) {
    if (spec.item === "paye" || spec.item === "paye_refund") continue;
    const r = rates[spec.item];
    if (!r || (spec.item === "nhf" && !nhfDue)) continue;
    const base = bases[r.base];
    if (!base) continue;
    line(spec, m.percentOf(base, r.rate), base, rateLabel(r.rate));
  }

  let taxable = null;
  const paye = rates.paye;
  const exempt = wage !== null && m.compare(p.rate_of_pay, wage) <= 0;
  if (paye && paye.bands && paye.bands.length && !exempt) {
    const pension = amounts.pension_employee || m.ZERO;
    const nhf = amounts.nhf || m.ZERO;
    const monthTaxable = m.Decimal.max(m.ZERO, g.minus(pension).minus(nhf));
    const relief = rentReliefOf(rates.rent_relief, p.year_rent).times(month).dividedBy(12);
    const chargeable = m.Decimal.max(m.ZERO, m.money(toDate.taxable_pay).plus(monthTaxable).minus(relief));
    const due = progressiveTax(chargeable, scaledBands(paye.bands, month)).minus(m.money(toDate.tax));
    if (due.isNegative()) line(specOf("paye_refund"), due.negated(), monthTaxable, null);
    else line(specOf("paye"), due, monthTaxable, null);
    taxable = m.toWire(monthTaxable);
  }

  const order = STATUTORY_LINES.map((s) => s.item);
  return { lines: out.sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code)), taxable_pay: taxable };
}

/**
 * What an advanced run cannot compute without (§6.15, No Rates Set): a PAYE table; the minimum wage when PAYE or NHF is in
 * force, since PAYE's exemption and NHF's floor read it (§13.1 item 45); and an item whose version names a base its item no
 * longer allows (statutory.rates ratesOn `misbased`, a version saved before PR 11). The items that have their figures are
 * computed either way, and Submit refuses the run until the missing are entered: the engine never defaults one.
 * @param {{rates: Record<string, object>, misbased: string[]}} rated
 * @returns {string[]}
 */
function statutoryMissing({ rates, misbased }) {
  const out = [];
  if (!rates.paye) out.push("paye");
  if ((rates.paye || rates.nhf) && !rates.minimum_wage) out.push("minimum_wage");
  for (const item of misbased || []) if (!out.includes(item)) out.push(item);
  return out;
}

/**
 * The lines of one payslip, in the order the slip prints them: earnings, then deductions, then employer
 * charges, `position` counting from 1 (§4.2), and in advanced mode the month's taxable pay its PAYE was worked from
 * (null in simple mode and in a month the minimum wage exempts). A line of nothing is left off. Pure.
 *
 * In advanced mode (`p.statutory` given) the earnings are the person's pay split when they have one (each
 * component a Monthly Pay line under its own label), and the statutory lines follow the earnings: employee items
 * as deductions before the rest (PAYE Refund among the earnings), employer items last, never in the net (§6.12 rule 2).
 *
 * @param {object} p
 * @param {string|null} p.gross  the monthly gross; null is No Salary Set and a payslip with no lines
 * @param {{workingDays: number, daysPaid: number, calendarDays: number, calendarPaid: number}} p.part
 * @param {Array<{id: string, amount: string}>} p.overtime  confirmed overtime items, priced by attendance
 * @param {Record<string, Array<{id: string, amount: string}>>} p.deductions  pending items by attendance kind
 * @param {Array<{id: string, days: string|number, from: string, to: string, amount: string}>} p.unpaidLeave
 *   one per approved unpaid request, its days in the month, the span inside the month and the amount
 * @param {Array<{id: string, days: number, from: string, to: string, amount: string}>} p.unpaidSuspension
 * @param {Array<{id: string, code: "fine"|"advance", amount: string, detail: string|null}>} p.instalments
 * @param {Array<{id: string, kind: "earning"|"deduction", label: string, amount: string}>} p.adjustments
 * @param {Array<{id: string, code: string, label: string, amount: string, pensionable: boolean}>|null} [p.components]
 *   advanced mode: the person's pay split in force, when they have one
 * @param {{rates: object, month: number, nhf_contributes?: boolean, to_date?: object, year_rent?: string|null}|null} [p.statutory]
 *   advanced mode: the figures in force, the period's month, the person's NHF choice, their year to date and declared rent
 * @returns {{lines: Array<{position: number, kind: string, code: string, label: string, detail: string|null,
 *   amount: string, source_type: string|null, source_id: string|null, base_amount: string|null}>, taxable_pay: string|null}}
 */
function payslipOf(p) {
  if (p.gross === null || p.gross === undefined) return { lines: [], taxable_pay: null };
  const out = [];
  const add = (code, amount, extra = {}) => {
    if (m.isZero(amount)) return;
    const spec = LINES[code] || {};
    out.push({
      kind: extra.kind || spec.kind,
      code,
      label: extra.label || spec.label,
      detail: extra.detail || null,
      amount: m.toWire(amount),
      source_type: extra.source_type || null,
      source_id: extra.source_id || null,
      base_amount: extra.base_amount || null,
    });
  };

  // Monthly Pay, or in advanced mode the pay split, each component under its own label.
  const split = p.statutory && p.components && p.components.length ? componentPay(p.components, p.part) : null;
  const monthly = proratedPay(p.gross, p.part);
  if (split) for (const c of split.lines) add("monthly_pay", c.amount, { label: c.label, source_type: "employee_pay_component", source_id: c.id });
  else add("monthly_pay", monthly);
  const overtime = m.sum((p.overtime || []).map((i) => i.amount));
  if (!overtime.isZero()) add("overtime", overtime, { detail: plural((p.overtime || []).length, "day", "days") });
  for (const a of p.adjustments || []) {
    if (a.kind === "earning")
      add("adjustment_earning", a.amount, { kind: "earning", label: a.label, source_type: "payroll_adjustment", source_id: a.id });
  }

  // Advanced mode: the statutory items on the month's earnings, employee items first among the deductions.
  const employer = [];
  let taxable = null;
  if (p.statutory) {
    const st = p.statutory;
    const statutory = computeStatutory({
      gross: m.toWire(m.sum(out.map((l) => l.amount))),
      pensionable: split ? split.pensionable : monthly,
      rate_of_pay: p.gross,
      nhf_contributes: st.nhf_contributes === true,
      month: st.month,
      to_date: st.to_date || NOTHING_TO_DATE,
      year_rent: st.year_rent ?? null,
      rates: st.rates,
    });
    taxable = statutory.taxable_pay;
    for (const s of statutory.lines) {
      if (s.kind === "employer") employer.push(s);
      else add(s.code, s.amount, { kind: s.kind, label: s.label, detail: s.detail, base_amount: s.base_amount });
    }
  }

  for (const k of ATTENDANCE_DEDUCTIONS) {
    const items = (p.deductions || {})[k.kind] || [];
    const total = m.sum(items.map((i) => i.amount));
    if (items.length && !total.isZero()) add(k.code, total, { detail: plural(items.length, k.one, k.many) });
  }
  for (const l of p.unpaidLeave || [])
    add("unpaid_leave", l.amount, { detail: `${daysLabel(l.days)}, ${rangeLabel(l.from, l.to)}`, source_type: "leave_request", source_id: l.id });
  for (const s of p.unpaidSuspension || [])
    add("unpaid_suspension", s.amount, { detail: `${daysLabel(s.days)}, ${rangeLabel(s.from, s.to)}`, source_type: "sanction", source_id: s.id });
  for (const i of p.instalments || [])
    add(i.code, i.amount, { detail: i.detail, source_type: "payroll_deduction_instalment", source_id: i.id });
  for (const a of p.adjustments || []) {
    if (a.kind === "deduction")
      add("adjustment_deduction", a.amount, { kind: "deduction", label: a.label, source_type: "payroll_adjustment", source_id: a.id });
  }
  for (const s of employer) add(s.code, s.amount, { kind: "employer", label: s.label, detail: s.detail, base_amount: s.base_amount });

  const rank = { earning: 0, deduction: 1, employer: 2 };
  const lines = out
    .map((line, i) => ({ line, i }))
    .sort((a, b) => rank[a.line.kind] - rank[b.line.kind] || a.i - b.i)
    .map(({ line }, i) => ({ position: i + 1, ...line }));
  return { lines, taxable_pay: taxable };
}

/** The lines of one payslip (payslipOf without the taxable pay): what simple mode and the tests read. */
function buildLines(p) {
  return payslipOf(p).lines;
}

/**
 * A payslip's totals from its lines (§6.8 rule 2): the net is earnings less deductions, employer charges
 * never in it. It can be below zero; that is the Negative Net problem, never a capped figure (§6.7).
 * @returns {{earnings_total: string, deductions_total: string, employer_total: string, net_pay: string}}
 */
function totalsOf(lines) {
  const sum = (kind) => m.sum(lines.filter((l) => l.kind === kind).map((l) => l.amount));
  const earnings = sum("earning");
  const deductions = sum("deduction");
  return {
    earnings_total: m.toWire(earnings),
    deductions_total: m.toWire(deductions),
    employer_total: m.toWire(sum("employer")),
    net_pay: m.toWire(earnings.minus(deductions)),
  };
}

/**
 * A run's totals from its payslips' (§6.8 rule 2). An excluded payslip counts for nothing, and neither
 * does one the caller leaves out of the list.
 * @param {Array<{status: string, earnings_total: string, deductions_total: string, employer_total: string, net_pay: string}>} payslips
 * @returns {{headcount: number, earnings_total: string, deductions_total: string, net_total: string, employer_total: string}}
 */
function sumTotals(payslips) {
  const paid = payslips.filter((p) => p.status !== "excluded");
  return {
    headcount: paid.length,
    earnings_total: m.toWire(m.sum(paid.map((p) => p.earnings_total))),
    deductions_total: m.toWire(m.sum(paid.map((p) => p.deductions_total))),
    net_total: m.toWire(m.sum(paid.map((p) => p.net_pay))),
    employer_total: m.toWire(m.sum(paid.map((p) => p.employer_total))),
  };
}

/**
 * The day a month is paid (§6.11 rule 1): the pay day of that month, or its last day when the pay day
 * is past the end (30 pays on 28 or 29 February, 31 on 30 April). A plain calendar date: a Sunday or a
 * holiday keeps its date, because MyCity's CEO transfers by hand.
 * @param {string} period  the month's first day, YYYY-MM-DD
 * @param {number} payDay  1 to 31, from the setting (payroll.config.repo.js payDayOf)
 */
function payDate(period, payDay) {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(payDay, lastDay);
  return `${period.slice(0, 8)}${String(day).padStart(2, "0")}`;
}

/**
 * The part of a month a person is paid: the working days between two dates, counted from the person's
 * own working dates (§6.3 rule 1). A joiner is paid from their start date and a leaver to the day they
 * left. Pure; the dates are Lagos business dates as YYYY-MM-DD.
 * @param {string[]} workingDates  every working date of the person's month
 * @param {{first: string, last: string, from: string, to: string}} span  the month and the span paid in it
 */
function paidPart(workingDates, { first, last, from, to }) {
  const start = from > first ? from : first;
  const end = to < last ? to : last;
  const inMonth = (d) => d >= first && d <= last;
  const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;
  return {
    workingDays: workingDates.filter(inMonth).length,
    daysPaid: start > end ? 0 : workingDates.filter((d) => d >= start && d <= end).length,
    calendarDays: days(first, last),
    calendarPaid: start > end ? 0 : days(start, end),
  };
}

module.exports = {
  LINES,
  ATTENDANCE_DEDUCTIONS,
  STATUTORY_LINES,
  PENSION_FLOOR,
  NOTHING_TO_DATE,
  componentPay,
  progressiveTax,
  scaledBands,
  rentReliefOf,
  computeStatutory,
  statutoryMissing,
  payslipOf,
  proratedPay,
  daysAmount,
  instalmentShares,
  buildLines,
  totalsOf,
  sumTotals,
  payDate,
  paidPart,
  rangeLabel,
};
