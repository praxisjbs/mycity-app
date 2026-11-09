"use strict";
/**
 * Payroll runs, their problems and adjustments, and the payroll settings (docs/guides/payroll.md §4.2,
 * §5, §6.9, §6.11, Appendix C). Simple mode only: the advanced tables (salary grades, pay components,
 * statutory rates) and their contracts come with PR 5.
 *
 * A run is one month's payroll for everyone paid that month, one run per month ever. Its statuses (the
 * table's CHECK, migration 6000):
 *   draft      opened, or sent back, or changed since it was computed
 *   computed   every payslip and line built; its problems listed
 *   submitted  with the CEO's approval (`payroll.run`, schemas/workflow.js); the pay items it took are frozen
 *   approved   locked: nothing in it changes, and its payslips are published
 *   paid       the money has been transferred outside the system; a date and an optional reference are kept
 *
 * Amounts derived from a salary carry the names the salary mask already governs (shared/rbac/field-mask,
 * `employee.salary`, guide §6.13): a run's totals are `gross_pay`, `total_deductions`, `net_pay`, and
 * `employer_cost`; an adjustment's amount is `pay_amount`. None is a column of its table (the columns
 * are `earnings_total`, `deductions_total`, `net_total`, `employer_total` and `amount`), so each is
 * declared virtual below, and each is nullable: a reader without the salary grant gets null and the
 * screen shows Restricted. A request that takes money in names it `amount`, as the column does; only
 * what leaves the API is masked.
 *
 * Money is a two-place string, NGN only (shared/money). A period is a month's first day. Messages on a
 * field are four words or fewer.
 */
const { z } = require("zod");
const {
  uuid,
  optionalText,
  isoDate,
  isoDateTime,
  money,
  positiveMoney,
  monthStart,
  changesBeside,
  nothingOn,
  listQuery,
  Paged,
} = require("./common");
const { PersonRef } = require("./organisation");
const { RouteStage } = require("./workflow");

/* ------------------------------------------------------------------ *
 * Words
 * ------------------------------------------------------------------ */

const RunStatus = z.enum(["draft", "computed", "submitted", "approved", "paid"]);

/** What a one-off adjustment does to the person's pay. */
const AdjustmentKind = z.enum(["earning", "deduction"]);

/** How PAYE bands are applied (guide §6.12 rule 1): the accountant's choice, entered on Configurations. */
const PayeBasis = z.enum(["annualised", "monthly"]);

const ProblemSeverity = z.enum(["blocking", "warning"]);

/** The problems a run reports (guide §6.15). Blocking ones stop Submit; warnings never do. */
const ProblemCode = z.enum([
  "NO_SALARY",
  "NEGATIVE_NET",
  "NO_RATES",
  "OVERTIME_WAITING",
  "NO_BANK",
  "CONTRACT_ENDED",
  "NO_PAY_SPLIT",
  "FINE_WAITING",
]);

/** A reason a person types: 10 to 500 characters. */
const reasonText = z
  .string()
  .trim()
  .min(1, "Give a reason")
  .max(500, "At most 500 characters")
  .refine((v) => v.length >= 10, "At least 10 characters");

/* ------------------------------------------------------------------ *
 * Reading runs
 * ------------------------------------------------------------------ */

/**
 * One run. A list row carries the same shape with an empty `chain`: the approval's route is read for the
 * run a person opens (GET /payroll/runs/:id), not for every row of a page. The `can_*` flags say what the
 * reader may press on it now (their grant, the run's status and, for `can_decide`, whether the approval
 * waits on them). Totals are null for a reader without the salary grant.
 */
const PayrollRun = z
  .object({
    payroll_run_id: uuid,
    number: z.string(),
    period: isoDate,
    status: RunStatus,
    advanced: z.boolean(),
    headcount: z.number().int().min(0),
    gross_pay: money.nullable(),
    total_deductions: money.nullable(),
    net_pay: money.nullable(),
    employer_cost: money.nullable(),
    computed_at: isoDateTime.nullable(),
    submitted_at: isoDateTime.nullable(),
    submitted_by_name: z.string().nullable(),
    approved_at: isoDateTime.nullable(),
    approved_by_name: z.string().nullable(),
    paid_on: isoDate.nullable(),
    payment_reference: z.string().nullable(),
    paid_by_name: z.string().nullable(),
    returned_reason: z.string().nullable(),
    workflow_instance_id: uuid.nullable(),
    chain: z.array(RouteStage),
    blocking_problems: z.number().int().min(0),
    warnings: z.number().int().min(0),
    can_compute: z.boolean(),
    can_submit: z.boolean(),
    can_decide: z.boolean(),
    can_pay: z.boolean(),
    can_discard: z.boolean(),
    created_at: isoDateTime,
  })
  .strict();

/** GET /payroll/runs: newest month first. `year` is a calendar year of the period. */
const PayrollRunListQuery = listQuery(
  { status: RunStatus.optional(), year: z.coerce.number().int().min(2020).max(2100).optional() },
  ["period", "status"],
);
const PayrollRunPage = Paged(PayrollRun);

/** The runs not yet paid, counted by status. */
const PayrollRunCounts = z
  .object({
    draft: z.number().int().min(0),
    computed: z.number().int().min(0),
    submitted: z.number().int().min(0),
    approved: z.number().int().min(0),
    paid: z.number().int().min(0),
  })
  .strict();

/** One month of the Net Payroll by Month chart. */
const PayrollTrendMonth = z.object({ period: isoDate, net_pay: money.nullable() }).strict();

/**
 * GET /payroll/runs/summary: the run to show first (the open one, else the latest), the runs by status,
 * and the last 12 months' net.
 */
const PayrollRunSummary = z
  .object({
    current: PayrollRun.nullable(),
    counts: PayrollRunCounts,
    trend: z.array(PayrollTrendMonth).max(12),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Writing runs
 * ------------------------------------------------------------------ */

/** New Run: the month, as its first day. A second run for a month is a 409. */
const PayrollRunCreate = z.object({ period: monthStart("Pick a month") }).strict();

/** Submit for Approval: the net the person saw, so a changed total is told first (guide §6.9 rule 7). */
const PayrollRunSubmit = z.object({ expected_net_total: money.optional() }).strict();

/** Mark Paid: the day the money was transferred and, if they wish, the bank's reference. */
const PayrollRunPaid = z
  .object({
    paid_on: isoDate,
    payment_reference: optionalText(100),
  })
  .strict();

/** Exclude: leave one person out of this run, with the reason. */
const PayrollRunExclude = z.object({ employee_id: uuid, reason: reasonText }).strict();

/* ------------------------------------------------------------------ *
 * Problems
 * ------------------------------------------------------------------ */

/**
 * One problem a run reports (guide §6.15): worked out on read from the run's payslips, never stored.
 * `message` says what is wrong and `action` what to do, in the words the screen shows; `employee` is the
 * person it is about, null for a problem about the run.
 */
const PayrollProblem = z
  .object({
    code: ProblemCode,
    severity: ProblemSeverity,
    employee: PersonRef.nullable(),
    payslip_id: uuid.nullable(),
    message: z.string(),
    action: z.string(),
  })
  .strict();
const PayrollProblemPage = Paged(PayrollProblem);

/* ------------------------------------------------------------------ *
 * Adjustments
 * ------------------------------------------------------------------ */

/** A one-off earning or deduction on one person's payslip in one run. */
const PayrollAdjustment = z
  .object({
    payroll_adjustment_id: uuid,
    payroll_run_id: uuid,
    employee: PersonRef,
    kind: AdjustmentKind,
    label: z.string(),
    pay_amount: money.nullable(),
    reason: z.string(),
    created_by_name: z.string().nullable(),
    created_at: isoDateTime,
  })
  .strict();
const PayrollAdjustmentPage = Paged(PayrollAdjustment);

/** Add Adjustment: only on a Draft or Computed run, whose person is paid in it. The label is up to 60 characters. */
const PayrollAdjustmentAdd = z
  .object({
    employee_id: uuid,
    kind: AdjustmentKind,
    label: z.string().trim().min(1, "Give a label").max(60, "At most 60 characters"),
    amount: positiveMoney,
    reason: reasonText,
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Settings (Configurations)
 * ------------------------------------------------------------------ */

/**
 * One version of the setting. It is effective-dated (shared/db/effective-dated): a change is a new
 * version from a date, and the one before it ends the day before. `pay_day` is null until MyCity sets one.
 */
const PayrollSettingsVersion = z
  .object({
    payroll_setting_id: uuid,
    advanced_enabled: z.boolean(),
    pay_day: z.number().int().min(1).max(31).nullable(),
    require_bank_details: z.boolean(),
    paye_basis: PayeBasis.nullable(),
    pension_reduces_taxable: z.boolean().nullable(),
    nhf_reduces_taxable: z.boolean().nullable(),
    effective_from: isoDate,
    effective_to: isoDate.nullable(),
    reason: z.string().nullable(),
    changed_by_name: z.string().nullable(),
  })
  .strict();

/**
 * GET /payroll/settings: the setting as it stands today. With no row the run is simple, the pay day is the
 * default 30 (`pay_day_is_default`), bank details are a warning and the conventions are unset (null). The
 * conventions, Salary Structure and Pay Components show once the option is on or has been
 * (`advanced_has_been_on`); Statutory Items and PAYE Bands always show, so the first rates are entered
 * before it is switched on (guide §13.1 item 25). `current` is the version in force and `next` the one
 * that starts later, each null when there is none.
 */
const PayrollSettings = z
  .object({
    advanced_enabled: z.boolean(),
    advanced_has_been_on: z.boolean(),
    pay_day: z.number().int().min(1).max(31),
    pay_day_is_default: z.boolean(),
    require_bank_details: z.boolean(),
    paye_basis: PayeBasis.nullable(),
    pension_reduces_taxable: z.boolean().nullable(),
    nhf_reduces_taxable: z.boolean().nullable(),
    current: PayrollSettingsVersion.nullable(),
    next: PayrollSettingsVersion.nullable(),
  })
  .strict();

/**
 * PATCH /payroll/settings: a new version from `effective_from` (today or later, Lagos). Only what is sent
 * changes; the rest carries over from the version in force. The conventions are taken by the route in PR 5,
 * once the option has been on or is being switched on.
 */
const PayrollSettingsChange = z
  .object({
    advanced_enabled: z.boolean().optional(),
    effective_from: isoDate,
    pay_day: z.number().int().min(1, "Pick 1 to 31").max(31, "Pick 1 to 31").optional(),
    require_bank_details: z.boolean().optional(),
    paye_basis: PayeBasis.optional(),
    pension_reduces_taxable: z.boolean().optional(),
    nhf_reduces_taxable: z.boolean().optional(),
    reason: optionalText(500),
  })
  .strict()
  .refine(changesBeside(["effective_from", "reason"]), nothingOn("effective_from"));

/** POST /payroll/runs/:id/email-payslips: send to those not yet emailed, or to everyone again. */
const PayslipEmailAll = z.object({ resend: z.boolean().default(false) }).strict();

/* ------------------------------------------------------------------ *
 * Gate 6 (check/contract-columns.js): which table each schema is a row of
 * ------------------------------------------------------------------ */

const RUN_VIRTUAL = {
  gross_pay: "payroll_run.earnings_total, named for the salary mask",
  total_deductions: "payroll_run.deductions_total, named for the salary mask",
  net_pay: "payroll_run.net_total, named for the salary mask",
  employer_cost: "payroll_run.employer_total, named for the salary mask",
  submitted_by_name: "who submitted it, from app_user and employee",
  approved_by_name: "who approved it, from app_user and employee",
  paid_by_name: "who marked it paid, from app_user and employee",
  chain: "the approval's route, from workflow_instance; empty on a list row",
  blocking_problems: "how many blocking problems it reports, worked out from its payslips",
  warnings: "how many warnings it reports, worked out from its payslips",
  can_compute: "Draft or Computed, and the reader may edit payroll",
  can_submit: "Computed, and the reader may edit payroll",
  can_decide: "Submitted, and the reader is the approver its approval waits on",
  can_pay: "Approved, and the reader may edit payroll",
  can_discard: "Draft or Computed, and the reader may delete payroll",
};

const TABLES = {
  PayrollRun: { table: "payroll_run", virtual: RUN_VIRTUAL },
  PayrollRunListQuery: { table: null, reason: "list controls for the runs" },
  PayrollRunPage: { table: null, reason: "a page of runs" },
  PayrollRunCounts: { table: null, reason: "the runs counted by status" },
  PayrollTrendMonth: { table: null, reason: "one month's net on the Net Payroll by Month chart" },
  PayrollRunSummary: { table: null, reason: "the current run, the runs by status and the last twelve months' net" },
  PayrollRunCreate: { table: "payroll_run" },
  PayrollRunSubmit: {
    table: "payroll_run",
    virtual: { expected_net_total: "the net the person saw, compared with the recomputed payroll_run.net_total" },
  },
  PayrollRunPaid: { table: "payroll_run" },
  PayrollRunExclude: {
    table: "payslip",
    virtual: { reason: "written as payslip.excluded_reason" },
  },
  PayrollProblem: { table: null, reason: "a problem a run reports, worked out on read and never stored" },
  PayrollProblemPage: { table: null, reason: "a page of a run's problems" },
  PayrollAdjustment: {
    table: "payroll_adjustment",
    virtual: {
      employee: "the person, from employee and department",
      pay_amount: "payroll_adjustment.amount, named for the salary mask",
      created_by_name: "who added it, from app_user and employee",
    },
  },
  PayrollAdjustmentPage: { table: null, reason: "a page of a run's adjustments" },
  PayrollAdjustmentAdd: { table: "payroll_adjustment" },
  PayrollSettingsVersion: {
    table: "payroll_setting",
    virtual: { changed_by_name: "who changed it, from app_user and employee" },
  },
  PayrollSettings: {
    table: "payroll_setting",
    virtual: {
      advanced_has_been_on: "whether any version has advanced_enabled",
      pay_day_is_default: "whether no version sets a pay day, so the default 30 stands",
      current: "the payroll_setting version in force today",
      next: "the payroll_setting version that starts later",
    },
  },
  PayrollSettingsChange: { table: "payroll_setting" },
  PayslipEmailAll: { table: null, reason: "whether to mail again those already emailed; each send sets payslip.emailed_at" },
};

module.exports = {
  TABLES,
  RunStatus,
  AdjustmentKind,
  PayeBasis,
  ProblemSeverity,
  ProblemCode,
  PayrollRun,
  PayrollRunListQuery,
  PayrollRunPage,
  PayrollRunCounts,
  PayrollTrendMonth,
  PayrollRunSummary,
  PayrollRunCreate,
  PayrollRunSubmit,
  PayrollRunPaid,
  PayrollRunExclude,
  PayrollProblem,
  PayrollProblemPage,
  PayrollAdjustment,
  PayrollAdjustmentPage,
  PayrollAdjustmentAdd,
  PayrollSettingsVersion,
  PayrollSettings,
  PayrollSettingsChange,
  PayslipEmailAll,
};
