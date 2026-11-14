"use strict";
/**
 * What a run is computed from, read in batches (docs/guides/payroll.md §4.4): everyone paid in a month and,
 * for them, the attendance items, the unpaid leave and suspension, and the instalments of fines and
 * advances that fall due. A run reads for every person at once, in a handful of queries, so Compute does
 * not grow with the number of people in queries per person (the one exception is a person's working days,
 * which attendance counts for each person: `attendance.pay.monthRates`).
 *
 * Payroll only reads here. Everything it asks another module to write goes through that module's own
 * function inside the run's transaction: attendance's `takeIntoRun` and `releaseFromRun`, and
 * `sanctions.fines.settle`. The tables read, by owner:
 *
 *   employee (organisation)       status, start_date, left_on, gross_monthly, bank_name, account_number
 *   attendance_pay_item           pending deductions and confirmed overtime with no run (attendance)
 *   leave_request, leave_type     approved leave of a type flagged `unpaid` (leave)
 *   sanction, consequence_step    issued sanctions whose step has financial_effect `unpaid_days` (sanctions)
 *   payroll_deduction(_instalment), sanction_fine, employee_query
 *                                 the instalments due, with the query number a fine's line names
 *
 * Every set is loaded whole on purpose (`// pagination:complete`): a run is computed for everyone paid in
 * one month, and a set past its ceiling fails loudly rather than computing a part of the payroll.
 */
const { completeQuery } = require("../../shared/http/paged");

/** The most people a run holds; a company past this needs this file looked at, not a silent cut. */
const MAX_PEOPLE = 5000;
/** The most pay items, leave requests or instalments one run reads. */
const MAX_ITEMS = 200000;

/** The leave request a person was granted: approved, or sent for approval and the approval approved. */
const GRANTED = `(lr.status = 'approved' OR (lr.status = 'submitted' AND wi.state IN ('approved', 'timeout_approved')))`;

/**
 * Everyone paid in the month, in staff-number order (§6.1 rule 1): started on or before its last day and
 * not gone before its first, whatever their employment type and whether they are active or suspended. A
 * person who has left is paid for the days of their last month; an archived record, or one marked left
 * with no date, is never paid. A person with no start date is in the run, so its No Start Date problem
 * names them, never left out without a word (§6.1 rule 2).
 * @param {{query: Function}} db
 * @param {string} first  the month's first day
 * @param {string} last   the month's last day
 * @param {string[]|null} [only]  restrict to these people (one exclusion, one adjustment)
 */
async function peopleFor(db, first, last, only = null) {
  // pagination:complete everyone paid in one month; a run is computed for all of them
  const { rows } = await completeQuery(
    db,
    `SELECT e.employee_id, e.staff_number, btrim(e.first_name || ' ' || e.last_name) AS display_name,
            e.status, e.start_date::text AS start_date, e.left_on::text AS left_on, e.contract_ends_on::text AS contract_ends_on,
            e.gross_monthly::text AS gross_monthly, e.work_pattern, e.bank_name, e.account_number, e.nhf_contributes
       FROM employee e
      WHERE (e.start_date IS NULL OR e.start_date <= $2::date)
        AND (e.left_on IS NULL OR e.left_on >= $1::date)
        AND e.status IN ('active', 'suspended', 'left')
        AND (e.status <> 'left' OR e.left_on IS NOT NULL)
        AND ($3::uuid[] IS NULL OR e.employee_id = ANY($3::uuid[]))
      ORDER BY e.staff_number, e.employee_id`,
    [first, last, only],
    { label: "The people paid in a month", ceiling: MAX_PEOPLE },
  );
  return rows;
}

/**
 * The pay items a run counts (§6.3 rule 2, §6.4 rule 1): pending late, early and absent deductions and
 * confirmed overtime, dated up to the month's last day and in no run. An item for an earlier month still
 * pending when that month's run locked is taken by this one. Each carries its person's gross and pattern so
 * an item with no price can be priced (attendance.pay.pricesOf).
 * @param {{query: Function}} db
 * @param {string[]} employeeIds
 * @param {string} last  the month's last day
 */
async function payItemsFor(db, employeeIds, last) {
  if (!employeeIds.length) return [];
  // pagination:complete the pay items one run counts for the people it pays
  const { rows } = await completeQuery(
    db,
    `SELECT pi.attendance_pay_item_id, pi.employee_id, pi.kind, pi.work_date::text AS work_date, pi.minutes, pi.rest_day,
            pi.method, pi.amount::text AS amount, pi.policy_version_id, pi.status, pi.confirmed_minutes,
            e.gross_monthly::text AS gross_monthly, e.work_pattern
       FROM attendance_pay_item pi
       JOIN employee e ON e.employee_id = pi.employee_id
      WHERE pi.employee_id = ANY($1::uuid[]) AND pi.payroll_run_id IS NULL AND pi.work_date <= $2::date
        AND ((pi.kind = 'overtime' AND pi.status = 'confirmed') OR (pi.kind <> 'overtime' AND pi.status = 'pending'))
      ORDER BY pi.employee_id, pi.work_date, pi.kind`,
    [employeeIds, last],
    { label: "The attendance items of a run", ceiling: MAX_ITEMS },
  );
  return rows;
}

/**
 * The approved requests of a type flagged `unpaid` that touch the month (§6.5 rule 1), for these people.
 * A leave in days only: an unpaid type counted in hours has no daily rate to price it with.
 */
async function unpaidLeaveFor(db, employeeIds, first, last) {
  if (!employeeIds.length) return [];
  // pagination:complete the unpaid leave touching one month, for the people a run pays
  const { rows } = await completeQuery(
    db,
    `SELECT lr.leave_request_id, lr.employee_id, lr.starts_on::text AS starts_on, lr.ends_on::text AS ends_on,
            lr.amount::text AS days
       FROM leave_request lr
       JOIN leave_type t ON t.leave_type_id = lr.leave_type_id
       LEFT JOIN workflow_instance wi ON wi.workflow_instance_id = lr.workflow_instance_id
      WHERE lr.employee_id = ANY($1::uuid[]) AND t.unpaid AND t.unit = 'days' AND ${GRANTED}
        AND lr.starts_on <= $3::date AND lr.ends_on >= $2::date
      ORDER BY lr.employee_id, lr.starts_on, lr.leave_request_id`,
    [employeeIds, first, last],
    { label: "The unpaid leave of a month", ceiling: MAX_ITEMS },
  );
  return rows;
}

/**
 * The issued sanctions whose step takes pay away (`financial_effect = 'unpaid_days'`) that overlap the
 * month (§6.5 rule 2). A sanction with no end date is one day, its effective day.
 */
async function unpaidSuspensionsFor(db, employeeIds, first, last) {
  if (!employeeIds.length) return [];
  // pagination:complete the unpaid suspensions overlapping one month, for the people a run pays
  const { rows } = await completeQuery(
    db,
    `SELECT s.sanction_id, s.employee_id, s.effective_on::text AS starts_on, COALESCE(s.ends_on, s.effective_on)::text AS ends_on
       FROM sanction s
       JOIN consequence_step cs ON cs.consequence_step_id = s.consequence_step_id
      WHERE s.employee_id = ANY($1::uuid[]) AND s.status = 'issued' AND cs.financial_effect = 'unpaid_days'
        AND s.effective_on <= $3::date AND COALESCE(s.ends_on, s.effective_on) >= $2::date
      ORDER BY s.employee_id, s.effective_on, s.sanction_id`,
    [employeeIds, first, last],
    { label: "The unpaid suspensions of a month", ceiling: MAX_ITEMS },
  );
  return rows;
}

/**
 * The instalments a run takes (§6.6 rules 7 and 9): every scheduled instalment of a live deduction whose
 * month is the run's, and, for a person who leaves in or before the month, every one they still owe, so
 * what is owed is recovered from final pay. Each names its deduction's source, its fine's query number and
 * which of the deduction's instalments it is ("QRY-0019, 1 of 3").
 * @param {{query: Function}} db
 * @param {string[]} employeeIds
 * @param {string} period  the month's first day
 * @param {string} last    the month's last day
 */
async function instalmentsFor(db, employeeIds, period, last) {
  if (!employeeIds.length) return [];
  // pagination:complete the instalments falling due in one month, for the people a run pays
  const { rows } = await completeQuery(
    db,
    `SELECT i.payroll_deduction_instalment_id, d.employee_id, d.payroll_deduction_id, d.source, i.period::text AS period,
            i.amount::text AS amount, q.number AS query_number, n.ordinal::int AS ordinal, n.of::int AS of
       FROM payroll_deduction_instalment i
       JOIN payroll_deduction d ON d.payroll_deduction_id = i.payroll_deduction_id
       JOIN employee e ON e.employee_id = d.employee_id
       LEFT JOIN sanction_fine f ON f.sanction_fine_id = d.sanction_fine_id
       LEFT JOIN sanction x ON x.sanction_id = f.sanction_id
       LEFT JOIN employee_query q ON q.employee_query_id = x.employee_query_id
       JOIN LATERAL (
         SELECT count(*) FILTER (WHERE s.period <= i.period) AS ordinal, count(*) AS of
           FROM payroll_deduction_instalment s
          WHERE s.payroll_deduction_id = i.payroll_deduction_id AND s.status <> 'cancelled'
       ) n ON true
      WHERE d.employee_id = ANY($1::uuid[]) AND d.status = 'active' AND i.status = 'scheduled'
        AND (i.period = $2::date OR (e.left_on IS NOT NULL AND e.left_on <= $3::date AND i.period > $2::date))
      ORDER BY d.employee_id, (d.source <> 'sanction_fine'), i.period, d.created_at, i.payroll_deduction_instalment_id`,
    [employeeIds, period, last],
    { label: "The instalments of a month", ceiling: MAX_ITEMS },
  );
  return rows;
}

/**
 * Each person's PAYE year to date before `period` from MyCity's own runs (§6.12 rule 11): the taxable pay their advanced
 * payslips of the same calendar year kept (none for a month the minimum wage exempted, §13.1 item 45), and the PAYE those
 * payslips deducted less any PAYE Refund, read from runs sent for approval, approved or paid. A run of an earlier month
 * still in Draft or Computed is not counted: the run reports it (EARLIER_RUN_OPEN), so a month is never taxed twice.
 * Pay to Date, entered on Configurations, is added by the caller (statutory.repo payToDateFor).
 * @param {{query: Function}} db
 * @param {string[]} employeeIds
 * @param {string} period  the run's month, its first day
 * @returns {Promise<Map<string, {taxable_pay: string, tax: string}>>}
 */
async function yearToDateFor(db, employeeIds, period) {
  if (!employeeIds.length) return new Map();
  // pagination:complete one sum a person paid in a month; a run reads everyone it pays
  const { rows } = await completeQuery(
    db,
    `SELECT p.employee_id, COALESCE(sum(p.taxable_pay), 0)::text AS taxable_pay,
            COALESCE(sum(t.tax), 0)::text AS tax
       FROM payslip p
       JOIN payroll_run r ON r.payroll_run_id = p.payroll_run_id
       LEFT JOIN LATERAL (SELECT sum(CASE l.code WHEN 'paye' THEN l.amount ELSE -l.amount END) AS tax
                            FROM payslip_line l
                           WHERE l.payslip_id = p.payslip_id AND l.code IN ('paye', 'paye_refund')) t ON true
      WHERE p.employee_id = ANY($1::uuid[]) AND p.status <> 'excluded'
        AND r.advanced AND r.status IN ('submitted', 'approved', 'paid')
        AND r.period >= date_trunc('year', $2::date)::date AND r.period < $2::date
      GROUP BY p.employee_id`,
    [employeeIds, period],
    { label: "Each person's PAYE year to date", ceiling: MAX_PEOPLE },
  );
  return new Map(rows.map((r) => [r.employee_id, { taxable_pay: r.taxable_pay, tax: r.tax }]));
}

module.exports = { MAX_PEOPLE, peopleFor, payItemsFor, unpaidLeaveFor, unpaidSuspensionsFor, instalmentsFor, yearToDateFor };
