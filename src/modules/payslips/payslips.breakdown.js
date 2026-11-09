"use strict";
/**
 * What stands behind a payslip line (docs/guides/payroll.md §6.10 rule 7): the pay items of a grouped line
 * (the month's lateness, early departures, absences, overtime), each with its day, its minutes and its status;
 * an adjustment's line with its reason, which only Payroll readers read; a fine's or an advance's instalment
 * with the month it falls due; and an unpaid leave's or suspension's line as it was made. 25 a page.
 *
 * Only Payroll readers open it (`payroll` view, GET /payslips/:id/lines/:line_id/items): the person reads their
 * own payslip's PDF and the Deductions list, which already name the query and the month.
 */
const { envelope } = require("../../shared/http/paged");
const repo = require("./payslips.repo");

/** What a pay item of each kind is called on the breakdown. */
const ITEM_WORDS = Object.freeze({
  late: "Late Arrival",
  early_departure: "Early Departure",
  absence: "Absence",
  overtime: "Overtime",
});

/** What a pay item's status is called. */
const STATUS_WORDS = Object.freeze({
  pending: "Pending",
  confirmed: "Confirmed",
  in_run: "In the Run",
  waived: "Waived",
  cut: "Cut",
});

const empty = () => envelope([], 1, 0);

/** A single row as a page of one. */
const single = (item) => envelope([item], 1, 1);

/** A pay item as the contract's PayslipLineItem. */
const itemOf = (row) => ({
  source_id: row.source_id,
  label: ITEM_WORDS[row.kind] || row.kind,
  work_date: row.work_date,
  minutes: row.minutes === null || row.minutes === undefined ? null : Number(row.minutes),
  status: STATUS_WORDS[row.status] || row.status,
  pay_amount: row.amount,
  reason: null,
});

/**
 * The items behind one line of a payslip, or a page of none when the line stands on nothing of its own (Monthly
 * Pay, a statutory line). The caller has already found the payslip and checked the reader may read it.
 * @param {{query: Function}} db
 * @param {string} payslipId
 * @param {string} lineId
 * @param {object} query  the validated PageQuery
 * @returns {Promise<object|null>} a page, or null when the payslip has no such line
 */
async function itemsOf(db, payslipId, lineId, query) {
  const line = await repo.lineOf(db, payslipId, lineId);
  if (!line) return null;
  const kind = line.source_id === null ? repo.GROUPS[line.code] : null;
  if (kind) {
    const page = await repo.itemsOf(db, line, kind, query);
    return { ...page, data: page.data.map(itemOf) };
  }
  if (!line.source_id) return empty();

  if (line.source_type === "payroll_adjustment") {
    const a = await repo.adjustmentBehind(db, line.source_id);
    if (!a) return empty();
    return single({ source_id: a.payroll_adjustment_id, label: a.label, work_date: null, minutes: null, status: "Added to the Run", pay_amount: a.amount, reason: a.reason });
  }
  if (line.source_type === "payroll_deduction_instalment") {
    const i = await repo.instalmentBehind(db, line.source_id);
    if (!i) return empty();
    const status = { scheduled: "Scheduled", in_run: "In the Run", applied: "Deducted", cancelled: "Cancelled" }[i.status] || i.status;
    return single({ source_id: i.payroll_deduction_instalment_id, label: line.detail || line.label, work_date: i.period, minutes: null, status, pay_amount: i.amount, reason: null });
  }
  // Unpaid leave and unpaid suspension: one request or sanction, worded as the line says it.
  return single({
    source_id: line.source_id,
    label: line.detail || line.label,
    work_date: null,
    minutes: null,
    status: line.source_type === "sanction" ? "Issued" : "Approved",
    pay_amount: line.amount,
    reason: null,
  });
}

module.exports = { ITEM_WORDS, itemsOf };
