import { notFound, noContent, ok, paged, route, fail } from "../core";
import { byKey, ref, SIGN_INS } from "../data/people";
import { DEDUCTION_EVENTS, earnings, money, nextPayday, SLIPS, type MockSlip } from "../data/payroll";

const row = (x: MockSlip) => ({
  payslip_id: x.payslip_id, number: x.number, employee: ref(x.person)!, period: x.period, gross: money(x.gross), deductions: money(x.ded),
  net: money(x.gross - x.ded), status: x.status, paid_on: x.paid_on, has_query_deduction: x.ded > 0,
});
const canAll = (u: string) => ["operations", "ceo"].includes(SIGN_INS[u]?.view ?? "");

route("GET /api/v1/payslips", (req) => {
  const own = req.query.scope !== "all" || !canAll(req.user!);
  const list = SLIPS.filter((x) => (!own || x.person.user_key === req.user) && (!req.query.year || x.period.startsWith(req.query.year)));
  const q = Object.fromEntries(Object.entries(req.query).filter(([k]) => k !== "scope" && k !== "year"));
  return paged(list.map(row), { ...req, query: q }, { search: (r) => [r.employee.display_name, r.number, r.period], filters: { period: (r, v) => r.period === v, status: (r, v) => r.status === v } });
});

route("GET /api/v1/payslips/summary", (req) => {
  const mine = SLIPS.filter((x) => x.person.user_key === req.user);
  const years = [...new Set(mine.map((x) => Number(x.period.slice(0, 4))))].sort((a, b) => b - a);
  const year = Number(req.query.year ?? years[0]);
  const paid = mine.filter((x) => x.period.startsWith(String(year)) && x.status === "paid");
  const g = paid.reduce((a, x) => a + x.gross, 0);
  const d = paid.reduce((a, x) => a + x.ded, 0);
  return ok({ year, years, gross: money(g), deductions: money(d), net: money(g - d), count: paid.length, next_payday: year === years[0] ? nextPayday() : null });
});

route("GET /api/v1/payslips/deductions", (req) =>
  paged(
    SLIPS.filter((x) => x.person.user_key === req.user && x.ded > 0).map((x) => ({ period: x.period, amount: money(x.ded), reason: x.ded_reason!, query_number: x.ded_query!, outcome: { tone: "neutral" as const, text: "Upheld, deducted" } })),
    { ...req, query: Object.fromEntries(Object.entries(req.query).filter(([k]) => k !== "scope")) },
  ),
);

route("GET /api/v1/payslips/:id", (req) => {
  const x = SLIPS.find((s) => s.payslip_id === req.params.id);
  if (!x) return notFound();
  if (x.person.user_key !== req.user && !canAll(req.user!)) return fail(403, "FORBIDDEN", "You can only open your own payslips.");
  return ok({
    ...row(x), job_title: x.person.job_title, grade: x.person.grade, bank_name: x.person.bank_name, account_last4: x.person.account_last4,
    earnings: earnings(x.gross), deduction_lines: x.ded ? [{ label: x.ded_reason ?? "Deductions", amount: money(x.ded), reference: x.ded_query }] : [], approved_by: x.status === "paid" ? "Ifeoma Chukwu" : null,
  });
});
route("POST /api/v1/payslips/:id/email", () => noContent());

export const _d = DEDUCTION_EVENTS;
export const _b = byKey;
