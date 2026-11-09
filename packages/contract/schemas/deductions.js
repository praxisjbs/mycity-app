"use strict";
/**
 * Deductions: the Payroll · Deductions tab and its actions (docs/guides/payroll.md §4.2, §5, §6.6,
 * Appendix C). Three kinds of money come off a person's pay and the tab lists them together:
 *
 *   attendance  a late, early or absent day priced by attendance (`attendance_pay_item`). Listed here but
 *               never accepted here: it flows into the run unless People waive it on People · Attendance
 *   fine        a sanction's fine (`sanction_fine`), pending until Operations & People accept it for this
 *               month, spread it over two to twelve months or waive it. An accepted fine is a deduction
 *   advance     salary paid before the month it belongs to, outside the system, recorded on this tab and
 *               recovered in instalments
 *
 * A deduction row on the wire (`DeductionRow`) is therefore a union of those three tables, not a row of
 * one: `source` says which and `source_id` is the record behind it. What a row's status means on the tab:
 *   pending   a pending item or fine, nothing scheduled yet
 *   active    a deduction with instalments left to recover
 *   settled   every instalment applied
 *   waived    a fine Operations & People waived
 *
 * A deduction's own statuses (the table's CHECK, migration 6010) are active, settled and cancelled; an
 * instalment's are scheduled, in_run, applied and cancelled. Amounts derived from a salary carry the
 * names the salary mask governs (`pay_amount`, guide §6.13) and are nullable; a request that takes money
 * in names it `amount`, as the column does, and months are `months`, written as `instalments`.
 *
 * Money is a two-place string, NGN only (shared/money). A period is a month's first day. Messages on a
 * field are four words or fewer.
 */
const { z } = require("zod");
const { uuid, isoDate, isoDateTime, money, positiveMoney, monthStart, listQuery, Paged } = require("./common");
const { PersonRef } = require("./organisation");

/* ------------------------------------------------------------------ *
 * Words
 * ------------------------------------------------------------------ */

/** Where a deduction row comes from (a filter and a column on the tab). */
const DeductionSource = z.enum(["attendance", "fine", "advance"]);

/** A row's status on the tab (above). */
const DeductionStatus = z.enum(["pending", "active", "settled", "waived"]);

/** A `payroll_deduction`'s own status. */
const DeductionState = z.enum(["active", "settled", "cancelled"]);

/** One month's share of a deduction. */
const InstalmentStatus = z.enum(["scheduled", "in_run", "applied", "cancelled"]);

/** A month, as YYYY-MM: the Deductions tab's month filter. */
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick a month");

/** A reason a person types: 10 to 500 characters. */
const reasonText = z
  .string()
  .trim()
  .min(1, "Give a reason")
  .max(500, "At most 500 characters")
  .refine((v) => v.length >= 10, "At least 10 characters");

/** How many months to recover a fine or an advance over: one (this month) to twelve. */
const months = z.number().int().min(1, "Pick 1 to 12").max(12, "Pick 1 to 12");

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/**
 * One row of the Deductions tab. `source_id` is the attendance pay item, the sanction fine or the advance
 * (a `payroll_deduction`) behind it; a fine that has been accepted also carries its `payroll_deduction_id`,
 * which Release needs. `period` is the month the row belongs to (the day's month, the fine's first month
 * or the deduction's first month). `instalments` and `instalments_applied` are null for a row with none
 * yet. `query_number` is the fine's query (QRY-0019). `salary_set` is false for an attendance row priced
 * for a person with no monthly gross yet, whose `pay_amount` is then null for a reason other than the mask
 * (the screen says No Salary Set, not Restricted). The `can_*` flags say what the reader may press now;
 * they are all false for an attendance row, which is waived on People · Attendance.
 */
const DeductionRow = z
  .object({
    source: DeductionSource,
    source_id: uuid,
    sanction_fine_id: uuid.nullable(),
    payroll_deduction_id: uuid.nullable(),
    employee: PersonRef,
    reason: z.string(),
    pay_amount: money.nullable(),
    salary_set: z.boolean(),
    period: isoDate,
    instalments: z.number().int().min(1).max(12).nullable(),
    instalments_applied: z.number().int().min(0).max(12).nullable(),
    status: DeductionStatus,
    query_number: z.string().nullable(),
    created_at: isoDateTime,
    can_accept: z.boolean(),
    can_waive: z.boolean(),
    can_release: z.boolean(),
    can_cancel: z.boolean(),
  })
  .strict();

/**
 * GET /deductions: one page of the union, newest first. `month` is YYYY-MM and keeps the rows whose
 * `period` is in it.
 */
const DeductionListQuery = listQuery(
  {
    status: DeductionStatus.optional(),
    source: DeductionSource.optional(),
    employee_id: uuid.optional(),
    month: month.optional(),
  },
  ["created", "employee", "amount"],
);
const DeductionPage = Paged(DeductionRow);

/** How many, and how much: one figure above the tab. `pay_amount` is null below the salary grant. */
const DeductionFigure = z.object({ count: z.number().int().min(0), pay_amount: money.nullable() }).strict();

/**
 * GET /deductions/summary: Pending Fines, Pending Attendance, Active (what is left to recover) and
 * Recovered This Year (instalments applied this calendar year, Lagos). `open_period` is the month a fine
 * is accepted into unless the person picks a later one (guide §6.6 rule 2): the month of the newest run
 * still a Draft or Computed one, else the current Lagos month if it has no run, else the next. The screen
 * offers the months from it and works out none itself.
 */
const DeductionSummary = z
  .object({
    open_period: isoDate,
    pending_fines: DeductionFigure,
    pending_attendance: DeductionFigure,
    active: DeductionFigure,
    recovered_this_year: DeductionFigure,
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

/** The path of a fine's Accept and Waive. */
const FineParams = z.object({ sanction_fine_id: uuid }).strict();

/**
 * POST /deductions/fines/:sanction_fine_id/accept. One month is Accept This Month; two to twelve is
 * Spread Over Months, in equal shares from `start_period`, which is never a month that already has a
 * submitted, approved or paid run.
 */
const DeductionAccept = z
  .object({
    months,
    start_period: monthStart("Pick a start month"),
  })
  .strict();

/** Waive a pending fine, and Release an accepted one back to pending: the reason the person reads. */
const DeductionWaive = z.object({ reason: reasonText }).strict();

/**
 * POST /deductions/advances: salary paid to a person before the month it belongs to, outside this system.
 * `granted_on` is the day it was paid; it is recovered in `months` equal instalments from `start_period`.
 */
const AdvanceRecord = z
  .object({
    employee_id: uuid,
    amount: positiveMoney,
    granted_on: isoDate,
    months,
    start_period: monthStart("Pick a start month"),
    reason: reasonText,
  })
  .strict();

/** Cancel an advance recorded in error, while none of its instalments is in a run or applied. */
const AdvanceCancel = z.object({ reason: reasonText }).strict();

/* ------------------------------------------------------------------ *
 * Gate 6 (check/contract-columns.js): which table each schema is a row of
 * ------------------------------------------------------------------ */

const TABLES = {
  DeductionRow: {
    table: null,
    reason: "a union of attendance_pay_item, sanction_fine and payroll_deduction rows, each read as its owner reads it",
  },
  DeductionListQuery: { table: null, reason: "list controls for the Deductions tab" },
  DeductionPage: { table: null, reason: "a page of deductions" },
  DeductionFigure: { table: null, reason: "a count and an amount over deductions" },
  DeductionSummary: { table: null, reason: "figures over the deductions" },
  FineParams: { table: null, reason: "the :sanction_fine_id path parameter" },
  DeductionAccept: {
    table: "payroll_deduction",
    virtual: { months: "written as payroll_deduction.instalments, and one payroll_deduction_instalment each" },
  },
  DeductionWaive: { table: null, reason: "a reason kept on the audit trail, not a column" },
  AdvanceRecord: {
    table: "payroll_deduction",
    virtual: {
      amount: "written as payroll_deduction.total_amount",
      months: "written as payroll_deduction.instalments, and one payroll_deduction_instalment each",
    },
  },
  AdvanceCancel: {
    table: "payroll_deduction",
    virtual: { reason: "written as payroll_deduction.cancel_reason" },
  },
};

module.exports = {
  TABLES,
  DeductionSource,
  DeductionStatus,
  DeductionState,
  InstalmentStatus,
  DeductionRow,
  DeductionListQuery,
  DeductionPage,
  DeductionFigure,
  DeductionSummary,
  FineParams,
  DeductionAccept,
  DeductionWaive,
  AdvanceRecord,
  AdvanceCancel,
};
