"use strict";
/**
 * Payslips: one person's pay for one run, its lines, its PDF and the person's own view of them
 * (docs/guides/payroll.md §4.2, §5, §6.10, Appendix C). Payroll readers list and open every payslip
 * within their `payroll` grant under /payslips; a person reads only their own published ones under
 * /ess/payslips (the `ess` module calls the payslips service with the caller's own employee id).
 *
 * A payslip's statuses (the table's CHECK, migration 6000):
 *   draft      built by Compute; a Payroll reader sees a Preview, the person sees nothing
 *   excluded   left out of this run with a reason; no lines
 *   published  its run is approved: the person can open it and its PDF is made
 *
 * A line's `kind` gives its direction and its amount is never negative: an `earning` adds to the net, a
 * `deduction` takes from it, an `employer` charge is MyCity's own cost and never reduces it. The statutory
 * codes (`paye`, `paye_refund`, `pension_employee`, `pension_employer`, `nhf`, `itf`, `nsitf`) appear only in advanced
 * mode; `paye_refund` is an earning, the tax paid back when the year's cumulative tax falls (guide §13.1 item 43).
 *
 * Amounts derived from a salary carry the names the salary mask governs (guide §6.13): a payslip's totals
 * are `gross_pay`, `total_deductions` and `net_pay`, a line's amount is `pay_amount`; `gross_monthly`,
 * `bank_name` and `account_last4` are masked by their own keys. Each is nullable: a reader without the
 * grant gets null and the screen shows Restricted. A person always sees their own.
 *
 * Money is a two-place string, NGN only (shared/money). A period is a month's first day.
 */
const { z } = require("zod");
const { uuid, isoDate, isoDateTime, money, listQuery, Paged } = require("./common");
const { PersonRef } = require("./organisation");
const { RunStatus } = require("./payroll");
const { InstalmentStatus } = require("./deductions");

/* ------------------------------------------------------------------ *
 * Words
 * ------------------------------------------------------------------ */

const PayslipStatus = z.enum(["draft", "excluded", "published"]);

const PayslipLineKind = z.enum(["earning", "deduction", "employer"]);

const PayslipLineCode = z.enum([
  "monthly_pay",
  "overtime",
  "lateness",
  "early_departure",
  "absence",
  "unpaid_leave",
  "unpaid_suspension",
  "fine",
  "advance",
  "adjustment_earning",
  "adjustment_deduction",
  "paye",
  "paye_refund",
  "pension_employee",
  "pension_employer",
  "nhf",
  "itf",
  "nsitf",
]);

/** Where an instalment on My Payslips · Deductions comes from. */
const EssDeductionSource = z.enum(["fine", "advance"]);

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/** One line of a payslip, in the order the slip prints. `has_breakdown` is true for a grouped line (the month's lateness) whose pay items are listed behind it. */
const PayslipLine = z
  .object({
    payslip_line_id: uuid,
    position: z.number().int().min(1),
    kind: PayslipLineKind,
    code: PayslipLineCode,
    label: z.string(),
    detail: z.string().nullable(),
    pay_amount: money.nullable(),
    has_breakdown: z.boolean(),
  })
  .strict();

/**
 * One payslip as a list row shows it. `period` is the run's month; `run_status` the run's, which is what
 * My Payslips reads for Paid, Paid with a deduction and In the run; `has_deduction` is whether any
 * deduction line is on it. A Payroll reader sees a Preview of a draft; the person sees only published ones.
 */
const Payslip = z
  .object({
    payslip_id: uuid,
    number: z.string(),
    payroll_run_id: uuid,
    period: isoDate,
    run_status: RunStatus,
    employee: PersonRef,
    staff_number: z.string(),
    status: PayslipStatus,
    excluded_reason: z.string().nullable(),
    gross_pay: money.nullable(),
    total_deductions: money.nullable(),
    net_pay: money.nullable(),
    has_deduction: z.boolean(),
    published_at: isoDateTime.nullable(),
    emailed_at: isoDateTime.nullable(),
  })
  .strict();

/**
 * One payslip as its modal shows it: its lines, the days it paid, the bank it goes to and the day it is
 * paid. `pay_date` is the date paid once the run is paid, else the month's pay date (the pay day, or the
 * month's last day when it is past; guide §6.11 rule 1). `pdf_ready` is false while the document engine is
 * still rendering (Preparing) and for a draft, which has no PDF.
 */
const PayslipDetail = Payslip.extend({
  gross_monthly: money.nullable(),
  working_days: z.number().int().min(0).nullable(),
  working_days_paid: z.number().int().min(0).nullable(),
  bank_name: z.string().nullable(),
  account_last4: z.string().nullable(),
  pay_date: isoDate,
  pdf_ready: z.boolean(),
  lines: z.array(PayslipLine),
}).strict();

/**
 * GET /payslips: draft and published alike for a Payroll reader. `period` is a month's first day. A
 * list is sorted by the person's name unless a sort is asked for.
 */
const PayslipListQuery = listQuery(
  {
    run_id: uuid.optional(),
    period: isoDate.optional(),
    employee_id: uuid.optional(),
    status: PayslipStatus.optional(),
  },
  ["employee", "net_pay", "number"],
);
const PayslipPage = Paged(Payslip);

/**
 * One pay item behind a grouped line (GET /payslips/:id/lines/:line_id/items): the day, its minutes, its
 * status and its amount; an adjustment's line shows its reason to Payroll readers only.
 */
const PayslipLineItem = z
  .object({
    source_id: uuid,
    label: z.string(),
    work_date: isoDate.nullable(),
    minutes: z.number().int().min(0).nullable(),
    status: z.string(),
    pay_amount: money.nullable(),
    reason: z.string().nullable(),
  })
  .strict();
const PayslipLineItemPage = Paged(PayslipLineItem);

/** The two path parameters of GET /payslips/:id/lines/:line_id/items. */
const PayslipLineParams = z.object({ id: uuid, line_id: uuid }).strict();

/* ------------------------------------------------------------------ *
 * Mail
 * ------------------------------------------------------------------ */

/**
 * POST /payroll/runs/:id/email-payslips answers 202 with how many mails were queued for the first
 * send: the published payslips not yet emailed, or every one when `resend` is set. The worker sends
 * them (the outbox handler `payroll.email_payslips`), so this is the count to expect, not a delivery.
 */
const PayslipEmailQueued = z.object({ queued: z.number().int().min(0) }).strict();

/** POST /ess/payslips/:id/email: a copy is on its way to the person's work email. */
const PayslipCopySent = z.object({ sent: z.boolean() }).strict();

/**
 * The variables of templates/email/payslip-ready.html: the month and where to read the payslip. The
 * mail never carries an amount (guide §6.10 rule 5).
 */
const PayslipReadyEmailVars = z
  .object({
    period_label: z.string(),
    number: z.string(),
    read_url: z.string(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * The document
 * ------------------------------------------------------------------ */

/**
 * The variables of templates/documents/payslip.html, every value as it is printed (`₦450,000.00`,
 * `October 2026`, `30/10/2026`). Employer charges are not here: they are on the statutory report, never
 * on the slip. In simple mode `earnings` and `deductions` carry no statutory line.
 */
const PayslipPrintedLine = z.object({ label: z.string(), detail: z.string().nullable(), amount: z.string() }).strict();
const PayslipVars = z
  .object({
    number: z.string(),
    period_label: z.string(),
    pay_date_label: z.string(),
    employee_name: z.string(),
    staff_number: z.string(),
    job_title: z.string().nullable(),
    department: z.string().nullable(),
    bank_name: z.string().nullable(),
    account_last4: z.string().nullable(),
    working_days: z.string().nullable(),
    earnings: z.array(PayslipPrintedLine),
    deductions: z.array(PayslipPrintedLine),
    gross_pay: z.string(),
    total_deductions: z.string(),
    net_pay: z.string(),
  })
  .strict();

/**
 * The variables of templates/documents/payslip-batch.html: Download All, one A4 page a payslip, in staff
 * number order (guide §6.10 rule 6).
 */
const PayslipBatchVars = z
  .object({
    title: z.string(),
    period_label: z.string(),
    payslips: z.array(PayslipVars),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * My Payslips (ESS)
 * ------------------------------------------------------------------ */

/** GET /ess/payslips and the summary: the year to read (this Lagos year when absent). */
const EssPayslipQuery = listQuery({ year: z.coerce.number().int().min(2020).max(2100).optional() });

/** The cards above My Payslips: the year's gross, Net Received, how many payslips, what was deducted, and the next pay day. */
const EssPayslipSummary = z
  .object({
    year: z.number().int(),
    gross_pay: money.nullable(),
    net_pay: money.nullable(),
    payslips: z.number().int().min(0),
    total_deductions: money.nullable(),
    next_payday: isoDate.nullable(),
  })
  .strict();

/**
 * One instalment of a fine or an advance the person is repaying, or has repaid, on My Payslips ·
 * Deductions. `query_number` is the fine's query (QRY-0019) and `query_id` opens it on My Queries.
 * `instalment` of `instalments` reads "1 of 3".
 */
const EssDeductionRow = z
  .object({
    payroll_deduction_instalment_id: uuid,
    source: EssDeductionSource,
    period: isoDate,
    reason: z.string(),
    pay_amount: money.nullable(),
    instalment: z.number().int().min(1).max(12),
    instalments: z.number().int().min(1).max(12),
    status: InstalmentStatus,
    query_number: z.string().nullable(),
    query_id: uuid.nullable(),
  })
  .strict();
const EssDeductionPage = Paged(EssDeductionRow);

/* ------------------------------------------------------------------ *
 * Gate 6 (check/contract-columns.js): which table each schema is a row of
 * ------------------------------------------------------------------ */

const SALARY_NAMES = {
  gross_pay: "payslip.earnings_total, named for the salary mask",
  total_deductions: "payslip.deductions_total, named for the salary mask",
};

const TABLES = {
  PayslipLine: {
    table: "payslip_line",
    virtual: {
      pay_amount: "payslip_line.amount, named for the salary mask",
      has_breakdown: "whether the line is a group with no single source",
    },
  },
  Payslip: {
    table: "payslip",
    virtual: {
      ...SALARY_NAMES,
      period: "payroll_run.period",
      run_status: "payroll_run.status",
      employee: "the person, from employee and department",
      staff_number: "employee.staff_number",
      has_deduction: "whether the payslip has a deduction line",
    },
  },
  PayslipDetail: {
    table: "payslip",
    virtual: {
      ...SALARY_NAMES,
      period: "payroll_run.period",
      run_status: "payroll_run.status",
      employee: "the person, from employee and department",
      staff_number: "employee.staff_number",
      has_deduction: "whether the payslip has a deduction line",
      pay_date: "the date paid once the run is paid, else the month's pay date from the pay day",
      pdf_ready: "whether the document behind document_id has rendered",
      lines: "its payslip_line rows",
    },
  },
  PayslipListQuery: { table: null, reason: "list controls for the payslips" },
  PayslipPage: { table: null, reason: "a page of payslips" },
  PayslipLineItem: { table: null, reason: "a pay item, adjustment or instalment behind a grouped line, read as its owner reads it" },
  PayslipLineItemPage: { table: null, reason: "a page of the items behind a payslip line" },
  PayslipLineParams: { table: null, reason: "the :id and :line_id path parameters" },
  PayslipEmailQueued: { table: null, reason: "how many payslip mails Email All queued" },
  PayslipCopySent: { table: null, reason: "whether a copy of a payslip was sent to its owner" },
  PayslipReadyEmailVars: { table: null, reason: "the variables of templates/email/payslip-ready.html" },
  PayslipPrintedLine: { table: null, reason: "a payslip line as the document prints it" },
  PayslipVars: { table: null, reason: "template variables of the payslip document" },
  PayslipBatchVars: { table: null, reason: "template variables of the Download All document" },
  EssPayslipQuery: { table: null, reason: "list controls for the person's own payslips" },
  EssPayslipSummary: { table: null, reason: "figures over the person's own payslips for a year" },
  EssDeductionRow: {
    table: "payroll_deduction_instalment",
    virtual: {
      source: "payroll_deduction.source, as fine or advance",
      reason: "payroll_deduction.reason",
      pay_amount: "payroll_deduction_instalment.amount, named for the salary mask",
      instalment: "this instalment's place in its deduction, from its period",
      instalments: "payroll_deduction.instalments",
      query_number: "the fine's query number, from employee_query",
      query_id: "the fine's query, from employee_query",
    },
  },
  EssDeductionPage: { table: null, reason: "a page of the person's own deductions" },
};

module.exports = {
  TABLES,
  PayslipStatus,
  PayslipLineKind,
  PayslipLineCode,
  EssDeductionSource,
  PayslipLine,
  Payslip,
  PayslipDetail,
  PayslipListQuery,
  PayslipPage,
  PayslipLineItem,
  PayslipLineItemPage,
  PayslipLineParams,
  PayslipEmailQueued,
  PayslipCopySent,
  PayslipReadyEmailVars,
  PayslipPrintedLine,
  PayslipVars,
  PayslipBatchVars,
  EssPayslipQuery,
  EssPayslipSummary,
  EssDeductionRow,
  EssDeductionPage,
};
