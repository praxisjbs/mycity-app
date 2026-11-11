import type { EssDeductionRow, EssPayslipSummary, Payslip, PayslipDetail, PayslipLine } from "@mycity/contract/contract.gen.ts";
import { todayIso } from "@mycity/ui";
import { fail, notFound, ok, paged, route, sid } from "../core";
import { ref, SIGN_INS } from "../data/people";
import { DEDUCTION_EVENTS, money, payDateOf, SLIPS, type MockSlip } from "../data/payroll";
import { EMAILED, publishedOf, runId, runStatusOf, slipFigures } from "./payroll";
import { exportFile } from "./shared";

/*
 * Payslips in the contract's shapes (packages/contract/schemas/payslips.js): Payroll readers list and open every
 * payslip of a run under /payslips, a draft until the run is approved, excluded when the person is left out, and
 * published after; a person reads only their own published ones under /ess/payslips, with the year's cards, a copy
 * by email (once a minute), Download All and the deductions behind them. Each payslip's figures are the run's
 * (payroll.ts): its adjustments and exclusions included.
 */
const canAll = (u: string) => ["operations", "ceo"].includes(SIGN_INS[u]?.view ?? "");
const isoMonth = (period: string) => `${period}-01`;
const hasRun = (x: MockSlip) => runStatusOf(x.period) !== null;
const published = (x: MockSlip) => publishedOf(x.period).includes(x);

const row = (x: MockSlip): Payslip => {
  const f = slipFigures(x);
  const out = published(x);
  return {
    payslip_id: x.payslip_id,
    number: x.number,
    payroll_run_id: runId(x.period),
    period: isoMonth(x.period),
    run_status: runStatusOf(x.period)!,
    employee: ref(x.person)!,
    staff_number: x.person.staff_number,
    status: f.excluded ? "excluded" : out ? "published" : "draft",
    excluded_reason: f.excluded,
    gross_pay: money(f.earnings),
    total_deductions: money(f.deductions),
    net_pay: money(f.earnings - f.deductions),
    has_deduction: f.deductions > 0,
    published_at: out ? `${isoMonth(x.period)}T09:00:00.000Z` : null,
    emailed_at: EMAILED.get(x.payslip_id) ?? null,
  };
};

/** Simple mode: one Monthly Pay line, what was deducted from it, and the run's adjustments; none for a person left out. */
function lines(x: MockSlip): PayslipLine[] {
  const f = slipFigures(x);
  if (f.excluded) return [];
  const base = { has_breakdown: false, detail: null };
  const out: PayslipLine[] = [{ ...base, payslip_line_id: sid(`line:${x.payslip_id}:pay`), position: 1, kind: "earning", code: "monthly_pay", label: "Monthly Pay", pay_amount: money(x.gross) }];
  if (x.ded > 0) out.push({ ...base, payslip_line_id: sid(`line:${x.payslip_id}:fine`), position: 0, kind: "deduction", code: "fine", label: "Fine", detail: x.ded_query ? `${x.ded_query}, 1 of 1` : null, pay_amount: money(x.ded) });
  for (const a of f.adjustments)
    out.push({ ...base, payslip_line_id: sid(`line:${a.payroll_adjustment_id}`), position: 0, kind: a.kind, code: a.kind === "earning" ? "adjustment_earning" : "adjustment_deduction", label: a.label, pay_amount: money(a.amount) });
  return out.map((l, i) => ({ ...l, position: i + 1 }));
}

const detail = (x: MockSlip): PayslipDetail => ({
  ...row(x),
  gross_monthly: money(x.gross),
  working_days: 26,
  working_days_paid: 26,
  bank_name: x.person.bank_name,
  account_last4: x.person.account_last4,
  pay_date: x.paid_on ?? payDateOf(x.period),
  pdf_ready: published(x),
  lines: lines(x),
});

/* ───────────── Payroll · Payslips ───────────── */

route("GET /api/v1/payslips", (req) => {
  if (!canAll(req.user!)) return fail(403, "FORBIDDEN", "You cannot open payslips.");
  return paged(SLIPS.filter(hasRun).map(row), req, {
    search: (r) => [r.employee.display_name, r.number, r.staff_number],
    filters: {
      run_id: (r, v) => r.payroll_run_id === v,
      period: (r, v) => r.period === v,
      employee_id: (r, v) => r.employee.employee_id === v,
      status: (r, v) => r.status === v,
    },
    sort: {
      employee: (a, b) => a.employee.display_name.localeCompare(b.employee.display_name),
      net_pay: (a, b) => Number(a.net_pay) - Number(b.net_pay),
      number: (a, b) => a.number.localeCompare(b.number),
    },
  });
});

route("GET /api/v1/payslips/:id", (req) => {
  const x = SLIPS.find((s) => s.payslip_id === req.params.id && hasRun(s));
  if (!x) return notFound();
  if (!canAll(req.user!)) return fail(403, "FORBIDDEN", "You cannot open payslips.");
  return ok(detail(x));
});

/** The pay items behind a grouped line: the mock's slips carry no grouped line, so every line stands on nothing. */
route("GET /api/v1/payslips/:id/lines/:line_id/items", (req) => (SLIPS.some((s) => s.payslip_id === req.params.id) ? paged([], req) : notFound()));

/* ───────────── ESS · My Payslips ───────────── */

const mine = (user: string) => SLIPS.filter((x) => x.person.user_key === user && published(x));
const yearOf = (req: { query: Record<string, string>; body?: Record<string, unknown> }) => String(req.body?.year ?? req.query.year ?? todayIso().slice(0, 4));

route("GET /api/v1/ess/payslips", (req) => {
  const list = mine(req.user!).filter((x) => x.period.startsWith(yearOf(req)));
  return paged(
    list.map(row).sort((a, b) => b.period.localeCompare(a.period)),
    { ...req, query: Object.fromEntries(Object.entries(req.query).filter(([k]) => k !== "year")) },
  );
});

/** The first pay date on or after today whose month's run is not paid (§6.11 rule 1). */
function nextPayday(): string {
  const today = todayIso();
  let period = today.slice(0, 7);
  for (let i = 0; i < 24; i += 1) {
    const day = payDateOf(period);
    if (day >= today && runStatusOf(period) !== "paid") return day;
    const [y, m] = period.split("-").map(Number);
    period = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  }
  return payDateOf(period);
}

route("GET /api/v1/ess/payslips/summary", (req) => {
  const year = Number(yearOf(req));
  const list = mine(req.user!).filter((x) => x.period.startsWith(String(year)));
  const g = list.reduce((a, x) => a + slipFigures(x).earnings, 0);
  const d = list.reduce((a, x) => a + slipFigures(x).deductions, 0);
  const body: EssPayslipSummary = { year, gross_pay: money(g), net_pay: money(g - d), payslips: list.length, total_deductions: money(d), next_payday: nextPayday() };
  return ok(body);
});

route("POST /api/v1/ess/payslips/export", (req) => {
  const year = yearOf(req);
  if (!mine(req.user!).some((x) => x.period.startsWith(year))) return fail(409, "NO_PAYSLIPS", `No payslips in ${year}`);
  return exportFile(req.user!, `payslips-${year}`, "pdf");
});

route("GET /api/v1/ess/payslips/:id", (req) => {
  const x = mine(req.user!).find((s) => s.payslip_id === req.params.id);
  return x ? ok(detail(x)) : notFound();
});

route("POST /api/v1/ess/payslips/:id/email", (req) => {
  const x = mine(req.user!).find((s) => s.payslip_id === req.params.id);
  if (!x) return notFound();
  const last = EMAILED.get(x.payslip_id);
  if (last && Date.now() - Date.parse(last) < 60_000) return fail(429, "EMAIL_TOO_SOON", "A copy went a moment ago. Try again in a minute");
  EMAILED.set(x.payslip_id, new Date().toISOString());
  return ok({ sent: true });
});

route("GET /api/v1/ess/deductions", (req) => {
  const rows: EssDeductionRow[] = SLIPS.filter((x) => x.person.user_key === req.user && x.ded > 0 && hasRun(x)).map((x) => ({
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
  return paged(rows.sort((a, b) => b.period.localeCompare(a.period)), req);
});

export const _d = DEDUCTION_EVENTS;
