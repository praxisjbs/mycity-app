import type { Grade, PayrollDeduction, RunRow, Statutory } from "@/api/types/payroll";
import type { Status } from "@/api/types/performance";
import { accepted, created, fail, invalid, isoDaysAgo, notFound, ok, paged, route, sid } from "../core";
import { byId, byKey, PEOPLE, refKey, SIGN_INS } from "../data/people";
import { kobo, money, SLIPS } from "../data/payroll";
import { deductionTiersOn } from "./attendance";

const S = (tone: Status["tone"], text: string): Status => ({ tone, text });
const canRun = (u: string) => ["operations", "ceo"].includes(SIGN_INS[u]?.view ?? "");
const isCeo = (u: string) => SIGN_INS[u]?.view === "ceo";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthOf = (p: string) => `${MONTHS[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}`;
const thisPeriod = () => new Date().toISOString().slice(0, 7);

type Stage = "computed" | "submitted" | "approved" | "paid";
const RUN = { period: thisPeriod(), stage: "submitted" as Stage, approved_by: null as string | null, paid_on: null as string | null };

function totals(period: string) {
  const list = SLIPS.filter((x) => x.period === period);
  const gross = list.reduce((a, x) => a + x.gross, 0);
  const ded = list.reduce((a, x) => a + x.ded, 0);
  return { headcount: list.length, gross, ded };
}
function runRow(period: string): RunRow {
  const t = totals(period);
  const current = period === RUN.period;
  const status = !current ? S("ok", `Paid 27/${period.slice(5)}`) : RUN.stage === "paid" ? S("ok", `Paid ${RUN.paid_on?.split("-").reverse().join("/")}`) : RUN.stage === "approved" ? S("info", "Approved, locked") : RUN.stage === "submitted" ? S("warn", "Awaiting Approval") : S("neutral", "Computed");
  return { run_id: sid(`run:${period}`), period, headcount: t.headcount, gross: money(t.gross), deductions: money(t.ded), net: money(t.gross - t.ded), approved_by: current ? RUN.approved_by : "Ifeoma Chukwu", status };
}
const periods = () => [...new Set(SLIPS.map((x) => x.period))].sort().reverse();

route("GET /api/v1/payroll/runs/summary", (req) => {
  const labels = ["Computed", "Previewed", "Submitted", "Approved", "Locked", "Paid"];
  const doneUpTo = { computed: 1, submitted: 2, approved: 5, paid: 6 }[RUN.stage];
  const chain = labels.map((label, i) => ({ label, state: (i < doneUpTo ? "done" : i === doneUpTo ? "now" : null) as "done" | "now" | null }));
  const last = periods().slice(0, 6).reverse();
  return ok({
    current: { ...runRow(RUN.period), stage: RUN.stage === "submitted" ? "awaiting_approval" : RUN.stage === "computed" ? "review" : RUN.stage, chain, can_submit: RUN.stage === "computed" && canRun(req.user!), can_approve: RUN.stage === "submitted" && isCeo(req.user!), can_pay: RUN.stage === "approved" && canRun(req.user!) },
    next_period: (() => { const d = new Date(`${RUN.period}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 7); })(),
    trend: { labels: last.map((p) => MONTHS[Number(p.slice(5)) - 1].slice(0, 3)), values: last.map((p) => runRow(p).net) },
    trend_note: "A step between months is new hires joining, not a pay rise.",
  });
});
route("GET /api/v1/payroll/runs", (req) => (canRun(req.user!) ? paged(periods().map(runRow), req, { search: (r) => [monthOf(r.period)] }) : fail(403, "FORBIDDEN", "Payroll is for Operations and the CEO.")));
route("POST /api/v1/payroll/runs", (req) => {
  if (!canRun(req.user!)) return fail(403, "FORBIDDEN", "Payroll is for Operations and the CEO.");
  if (RUN.stage !== "paid") return fail(409, "RUN_OPEN", `${monthOf(RUN.period)} is still open. Finish it before starting the next.`);
  return fail(409, "TOO_EARLY", "The next run opens on the 1st of the month.");
});
const runGuard = (id: string) => (sid(`run:${RUN.period}`) === id ? null : notFound());
route("POST /api/v1/payroll/runs/:id/submit", (req) => runGuard(req.params.id) ?? (RUN.stage !== "computed" ? fail(409, "WRONG_STAGE", "Only a computed run can be submitted.") : ((RUN.stage = "submitted"), ok(runRow(RUN.period)))));
route("POST /api/v1/payroll/runs/:id/approve", (req) => {
  const g = runGuard(req.params.id);
  if (g) return g;
  if (!isCeo(req.user!)) return fail(403, "FORBIDDEN", "Only the CEO approves a payroll run.");
  if (RUN.stage !== "submitted") return fail(409, "WRONG_STAGE", "Only a submitted run can be approved.");
  RUN.stage = "approved";
  RUN.approved_by = byKey(req.user)!.display_name;
  return ok(runRow(RUN.period));
});
route("POST /api/v1/payroll/runs/:id/paid", (req) => {
  const g = runGuard(req.params.id);
  if (g) return g;
  if (RUN.stage !== "approved") return fail(409, "WRONG_STAGE", "Only an approved, locked run can be marked paid.");
  RUN.stage = "paid";
  RUN.paid_on = String(req.body.paid_on ?? isoDaysAgo(0));
  return ok(runRow(RUN.period));
});
route("POST /api/v1/payroll/runs/:id/email-payslips", (req) => runGuard(req.params.id) ?? (RUN.stage === "computed" || RUN.stage === "submitted" ? fail(409, "NOT_APPROVED", "Payslips go to staff once the run is approved.") : accepted()));

const GRADES: Grade[] = [
  ["G1", "Associate", 150000, 180000, 220000], ["G2", "Officer", 200000, 250000, 300000], ["G3", "Senior", 360000, 440000, 520000],
  ["G4", "Lead", 460000, 540000, 640000], ["G5", "Head", 520000, 640000, 760000], ["G6", "Executive", 1200000, 1500000, 1800000],
].map((g) => {
  const code = g[0] as string;
  return { grade_id: sid(`grade:${code}`), code, band: g[1] as string, minimum: money(kobo(String(g[2]))), midpoint: money(kobo(String(g[3]))), maximum: money(kobo(String(g[4]))), staff: PEOPLE.filter((p) => p.grade.startsWith(code)).length };
});
route("GET /api/v1/payroll/grades/summary", () => {
  let below = 0, above = 0;
  PEOPLE.forEach((p) => {
    const g = GRADES.find((x) => p.grade.startsWith(x.code));
    if (!g) return;
    const pay = Number(p.gross_monthly);
    if (pay < Number(g.minimum)) below++;
    if (pay > Number(g.maximum)) above++;
  });
  return ok({ grades: GRADES.length, placed: PEOPLE.length, below_minimum: below, above_maximum: above, scale_max: GRADES.reduce((m, g) => (Number(g.maximum) > Number(m) ? g.maximum : m), "0.00") });
});
route("GET /api/v1/payroll/grades", (req) => paged(GRADES, req, { search: (g) => [g.code, g.band] }));
route("POST /api/v1/payroll/grades", (req) => {
  const b = req.body as Record<string, string>;
  const f: Record<string, string[]> = {};
  if (!/^G\d{1,2}$/.test(b.code ?? "")) f.code = ["Like G7"];
  else if (GRADES.some((g) => g.code === b.code)) f.code = ["That grade exists"];
  if (!b.band?.trim()) f.band = ["Name the band"];
  const [mn, md, mx] = [Number(b.minimum), Number(b.midpoint), Number(b.maximum)];
  if (!(mn > 0)) f.minimum = ["Enter the minimum"];
  if (!(md > mn)) f.midpoint = ["Above the minimum"];
  if (!(mx > md)) f.maximum = ["Above the midpoint"];
  if (!b.effective_from) f.effective_from = ["Pick the date it applies from"];
  else if (b.effective_from < isoDaysAgo(0)) f.effective_from = ["A band applies from a date, never backwards"];
  if (Object.keys(f).length) return invalid(f);
  const g: Grade = { grade_id: sid(`grade:${b.code}`), code: b.code, band: b.band.trim(), minimum: b.minimum, midpoint: b.midpoint, maximum: b.maximum, staff: 0 };
  GRADES.push(g);
  return created(g);
});

const DEDS: PayrollDeduction[] = [
  ["bashir", "Lateness, 3 instances", "Queries & Sanctions", "12500.00", 0, S("warn", "Pending acceptance")],
  ["seyi", "Studio monitor damage", "Fine, sanction", "45000.00", -3, S("ok", "Recovered")],
  ["amara", "Salary advance repayment", "Advance", "50000.00", 0, S("ok", "Accepted")],
].map((d, i) => {
  const dt = new Date();
  dt.setUTCDate(1);
  dt.setUTCMonth(dt.getUTCMonth() + (d[4] as number));
  return { deduction_id: sid(`ded:${i}`), employee: refKey(d[0] as string), reason: d[1] as string, source: d[2] as string, amount: d[3] as string, period: dt.toISOString().slice(0, 7), status: d[5] as Status };
});
/** An accepted deduction lands on that person's payslip in the open run, as one line with its reason. */
function apply(d: PayrollDeduction) {
  const slip = SLIPS.find((x) => x.person.employee_id === d.employee.employee_id && x.period === d.period);
  if (!slip) return;
  slip.ded += kobo(d.amount);
  slip.ded_reason = d.reason;
  slip.ded_query = d.source === "Queries & Sanctions" ? "QRY-0014" : null;
}
DEDS.filter((d) => d.status.text === "Accepted" && d.period === RUN.period).forEach(apply);

route("GET /api/v1/payroll/deductions/summary", () => {
  const pending = DEDS.filter((d) => d.status.text === "Pending acceptance");
  const applied = DEDS.filter((d) => d.period === RUN.period && d.status.text === "Accepted").reduce((a, d) => a + kobo(d.amount), 0);
  const f = pending[0];
  return ok({
    pending: pending.length, applied_this_period: money(applied), recovered_this_year: "45000.00", sources: new Set(DEDS.map((d) => d.source)).size, tiers_on: deductionTiersOn(),
    focus: f ? { deduction_id: f.deduction_id, title: `Pending: ${f.employee.display_name}`, chain: [{ label: "Query Closed", state: "done" }, { label: "Warning Served", state: "done" }, { label: "Deduction Raised", state: "done" }, { label: "Accepted", state: "now" }, { label: "In the Run", state: null }, { label: "Applied", state: null }], note: "Raised by a sanction. It waits for a person, which is correct: nothing deducts itself." } : null,
  });
});
route("GET /api/v1/payroll/deductions", (req) => paged(DEDS, req, { search: (d) => [d.employee.display_name, d.reason, d.source], filters: { status: (d, v) => (v === "pending" ? d.status.text === "Pending acceptance" : d.status.text !== "Pending acceptance") } }));
route("POST /api/v1/payroll/deductions", (req) => {
  if (!canRun(req.user!)) return fail(403, "FORBIDDEN", "Payroll is for Operations and the CEO.");
  const b = req.body as Record<string, string>;
  const p = byId(b.employee_id);
  const f: Record<string, string[]> = {};
  if (!p) f.employee_id = ["Pick the employee"];
  if (!b.reason?.trim()) f.reason = ["Give the reason; it is the payslip line"];
  if (!(Number(b.amount) > 0)) f.amount = ["Enter the amount"];
  if (Object.keys(f).length) return invalid(f);
  const d: PayrollDeduction = { deduction_id: sid(`ded:new:${DEDS.length}`), employee: refKey(p!.user_key), reason: b.reason.trim(), source: "Added by Operations", amount: b.amount, period: b.period || RUN.period, status: S("warn", "Pending acceptance") };
  DEDS.unshift(d);
  return created(d);
});
const findD = (id: string) => DEDS.find((d) => d.deduction_id === id);
route("POST /api/v1/payroll/deductions/:id/accept", (req) => {
  const d = findD(req.params.id);
  if (!d) return notFound();
  if (RUN.stage === "approved" || RUN.stage === "paid") return fail(409, "RUN_LOCKED", "This month's run is locked. It goes into next month as an adjustment.");
  d.status = S("ok", Number(req.body.runs) === 2 ? "Accepted, over 2 runs" : "Accepted");
  if (Number(req.body.runs) === 2) d.amount = money(Math.round(kobo(d.amount) / 2));
  d.period = RUN.period;
  apply(d);
  return ok(d);
});
route("POST /api/v1/payroll/deductions/:id/waive", (req) => {
  const d = findD(req.params.id);
  if (!d) return notFound();
  if (!String(req.body.reason ?? "").trim()) return invalid({ reason: ["Say why it is waived"] });
  d.status = S("neutral", "Waived");
  return ok(d);
});

const STAT: Statutory = {
  enabled: false, effective_from: null,
  items: [["PAYE", "Employee", "Progressive bands", "Gross less relief, pension and NHF"], ["Pension, employee", "Employee", "8%", "Basic, housing, transport"], ["Pension, employer", "Employer", "10%", "Basic, housing, transport"], ["NHF", "Employee", "2.5%", "Basic"], ["ITF", "Employer", "1%", "Annual payroll"], ["NSITF", "Employer", "1%", "Annual payroll"]].map(([item, kind, rate, base]) => ({ item, kind: kind as "Employee", rate, base, status: S("neutral", "Configured, off") })),
  paye_bands: [["First", "300000.00", "7%"], ["Next", "300000.00", "11%"], ["Next", "500000.00", "15%"], ["Next", "500000.00", "19%"], ["Next", "1600000.00", "21%"], ["Above", "3200000.00", "24%"]].map(([label, annual, rate]) => ({ label, annual, rate })),
};
route("GET /api/v1/payroll/statutory", () => ok(STAT));
route("POST /api/v1/payroll/statutory/enable", (req) => {
  if (!isCeo(req.user!)) return fail(403, "FORBIDDEN", "Switching statutory payroll on is the CEO's decision.");
  const from = String(req.body.effective_from ?? "");
  if (!from || from < isoDaysAgo(0)) return invalid({ effective_from: ["From a future date. A locked run never changes"] });
  STAT.enabled = true;
  STAT.effective_from = from;
  STAT.items = STAT.items.map((i) => ({ ...i, status: S("ok", "On") }));
  return ok(STAT);
});
