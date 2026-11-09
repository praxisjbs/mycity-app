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

/**
 * The lines of one payslip, in the order the slip prints them: earnings, then deductions, then employer
 * charges, `position` counting from 1 (§4.2). A line of nothing is left off. Pure.
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
 * @returns {Array<{position: number, kind: string, code: string, label: string, detail: string|null,
 *   amount: string, source_type: string|null, source_id: string|null}>}
 */
function buildLines(p) {
  if (p.gross === null || p.gross === undefined) return [];
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
    });
  };

  add("monthly_pay", proratedPay(p.gross, p.part));
  const overtime = m.sum((p.overtime || []).map((i) => i.amount));
  if (!overtime.isZero()) add("overtime", overtime, { detail: plural((p.overtime || []).length, "day", "days") });
  for (const a of p.adjustments || []) {
    if (a.kind === "earning")
      add("adjustment_earning", a.amount, { kind: "earning", label: a.label, source_type: "payroll_adjustment", source_id: a.id });
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

  const rank = { earning: 0, deduction: 1, employer: 2 };
  return out
    .map((line, i) => ({ line, i }))
    .sort((a, b) => rank[a.line.kind] - rank[b.line.kind] || a.i - b.i)
    .map(({ line }, i) => ({ position: i + 1, ...line }));
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
