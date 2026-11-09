import type { EssDeductionRow, EssPayslipSummary, Payslip, PayslipDetail, PayslipLine } from "@mycity/contract/contract.gen.ts";
import { fail, notFound, ok, paged, route, sid } from "../core";
import { ref, SIGN_INS } from "../data/people";
import { DEDUCTION_EVENTS, money, nextPayday, SLIPS, type MockSlip } from "../data/payroll";
import { runId, runStatusOf } from "./payroll";

/*
 * Payslips in the contract's shapes (packages/contract/schemas/payslips.js): Payroll readers list and open every
 * payslip of a run under /payslips, a draft until the run is approved and published after; a person reads only their
 * own published ones under /ess/payslips, with the year's cards, a copy by email and the deductions behind them.
 */
const published = (x: MockSlip) => ["approved", "paid"].includes(runStatusOf(x.period));
const canAll = (u: string) => ["operations", "ceo"].includes(SIGN_INS[u]?.view ?? "");
const isoMonth = (period: string) => `${period}-01`;

const row = (x: MockSlip): Payslip => {
  const out = published(x);
  return {
    payslip_id: x.payslip_id,
    number: x.number,
    payroll_run_id: runId(x.period),
    period: isoMonth(x.period),
    run_status: runStatusOf(x.period),
    employee: ref(x.person)!,
    staff_number: x.person.staff_number,
    status: out ? "published" : "draft",
    excluded_reason: null,
    gross_pay: money(x.gross),
    total_deductions: money(x.ded),
    net_pay: money(x.gross - x.ded),
    has_deduction: x.ded > 0,
    published_at: out ? `${isoMonth(x.period)}T09:00:00.000Z` : null,
    emailed_at: null,
  };
};

/** Simple mode: one Monthly Pay line, and what was deducted from it. */
function lines(x: MockSlip): PayslipLine[] {
  const base = { has_breakdown: false, detail: null };
  const out: PayslipLine[] = [{ ...base, payslip_line_id: sid(`line:${x.payslip_id}:1`), position: 1, kind: "earning", code: "monthly_pay", label: "Monthly Pay", pay_amount: money(x.gross) }];
  if (x.ded > 0)
    out.push({ ...base, payslip_line_id: sid(`line:${x.payslip_id}:2`), position: 2, kind: "deduction", code: "fine", label: "Fine", detail: x.ded_query, pay_amount: money(x.ded) });
  return out;
}

const detail = (x: MockSlip): PayslipDetail => ({
  ...row(x),
  gross_monthly: money(x.gross),
  working_days: 26,
  working_days_paid: 26,
  bank_name: x.person.bank_name,
  account_last4: x.person.account_last4,
  pay_date: x.paid_on ?? `${isoMonth(x.period).slice(0, 8)}30`,
  pdf_ready: published(x),
  lines: lines(x),
});

/* ───────────── Payroll · Payslips ───────────── */

route("GET /api/v1/payslips", (req) => {
  if (!canAll(req.user!)) return fail(403, "FORBIDDEN", "You cannot open payslips.");
  const list = SLIPS.filter((x) => runId(x.period) === (req.query.run_id ?? runId(x.period)) && (!req.query.employee_id || x.person.employee_id === req.query.employee_id));
  return paged(list.map(row), req, {
    search: (r) => [r.employee.display_name, r.number, r.period],
    filters: { period: (r, v) => r.period === v, status: (r, v) => r.status === v },
  });
});

route("GET /api/v1/payslips/:id", (req) => {
  const x = SLIPS.find((s) => s.payslip_id === req.params.id);
  if (!x) return notFound();
  if (!canAll(req.user!)) return fail(403, "FORBIDDEN", "You cannot open payslips.");
  return ok(detail(x));
});

/* ───────────── ESS · My Payslips ───────────── */

const mine = (user: string) => SLIPS.filter((x) => x.person.user_key === user && published(x));

route("GET /api/v1/ess/payslips", (req) => {
  const year = req.query.year ?? new Date().getUTCFullYear();
  const list = mine(req.user!).filter((x) => x.period.startsWith(String(year)));
  return paged(list.map(row), { ...req, query: Object.fromEntries(Object.entries(req.query).filter(([k]) => k !== "year")) });
});

route("GET /api/v1/ess/payslips/summary", (req) => {
  const year = Number(req.query.year ?? new Date().getUTCFullYear());
  const list = mine(req.user!).filter((x) => x.period.startsWith(String(year)));
  const g = list.reduce((a, x) => a + x.gross, 0);
  const d = list.reduce((a, x) => a + x.ded, 0);
  const body: EssPayslipSummary = { year, gross_pay: money(g), net_pay: money(g - d), payslips: list.length, total_deductions: money(d), next_payday: nextPayday() };
  return ok(body);
});

route("GET /api/v1/ess/payslips/:id", (req) => {
  const x = mine(req.user!).find((s) => s.payslip_id === req.params.id);
  return x ? ok(detail(x)) : notFound();
});

route("POST /api/v1/ess/payslips/:id/email", (req) => (mine(req.user!).some((s) => s.payslip_id === req.params.id) ? ok({ sent: true }) : notFound()));

route("GET /api/v1/ess/deductions", (req) => {
  const rows: EssDeductionRow[] = SLIPS.filter((x) => x.person.user_key === req.user && x.ded > 0).map((x) => ({
    payroll_deduction_instalment_id: sid(`instalment:${x.payslip_id}`),
    source: "fine",
    period: isoMonth(x.period),
    reason: x.ded_reason ?? "Fine",
    pay_amount: money(x.ded),
    instalment: 1,
    instalments: 1,
    status: published(x) ? "applied" : "in_run",
    query_number: x.ded_query,
    query_id: null,
  }));
  return paged(rows, req);
});

export const _d = DEDUCTION_EVENTS;
