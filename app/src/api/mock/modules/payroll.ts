import type { ApprovalInstance, PayrollRun, PayrollRunSummary } from "@mycity/contract/contract.gen.ts";
import type { Grade, PayrollDeduction, Statutory } from "@/api/types/payroll";
import type { Status } from "@/api/types/performance";
import { created, fail, invalid, isoDaysAgo, notFound, ok, paged, route, sid } from "../core";
import { byId, byKey, PEOPLE, refKey, SIGN_INS } from "../data/people";
import { kobo, money, SLIPS } from "../data/payroll";
import { deductionTiersOn } from "./attendance";

const S = (tone: Status["tone"], text: string): Status => ({ tone, text });
const canRun = (u: string) => ["operations", "ceo"].includes(SIGN_INS[u]?.view ?? "");
const isCeo = (u: string) => SIGN_INS[u]?.view === "ceo";
const thisPeriod = () => new Date().toISOString().slice(0, 7);
const now = () => new Date().toISOString();
const operator = () => Object.keys(SIGN_INS).find((k) => SIGN_INS[k].view === "operations") ?? "";

/*
 * Payroll runs in the contract's shapes (packages/contract/schemas/payroll.js): the months before this one are
 * paid, this month's run is waiting on the CEO, and every move the screen makes is the API's own, down to its
 * refusals. The CEO decides it through the approval's routes (POST /workflow/instances/:id/approve), which reach
 * here through organisation.ts's decide chain.
 */
type Status6 = PayrollRun["status"];
const RUN = {
  period: thisPeriod(),
  status: "submitted" as Status6,
  submitted_at: now(),
  submitted_by: operator(),
  approved_at: null as string | null,
  approved_by: null as string | null,
  paid_on: null as string | null,
};
const WID = sid("wf:payroll_run");
const first = (period: string) => `${period}-01`;
const numberOf = (period: string) => `PAY-${period}`;
export const runId = (period: string) => sid(`run:${period}`);
/** A month's run status: this month's is the open run's, every earlier month is paid. */
export const runStatusOf = (period: string): Status6 => (period === RUN.period ? RUN.status : "paid");
const periods = () => [...new Set(SLIPS.map((x) => x.period))].sort().reverse();

function totals(period: string) {
  const list = SLIPS.filter((x) => x.period === period);
  const gross = list.reduce((a, x) => a + x.gross, 0);
  const ded = list.reduce((a, x) => a + x.ded, 0);
  return { headcount: list.length, gross, ded };
}

/** The approval's route as the screen reads it: one stage, the CEO. */
function route1(): NonNullable<PayrollRun["chain"]> {
  const pending = RUN.status === "submitted";
  return [{ key: "ceo", name: "CEO", state: pending ? "now" : "done", approvers: [{ type: "ceo", value: null, label: "CEO" }] }] as PayrollRun["chain"];
}

function runOf(period: string, user: string, withChain = false): PayrollRun {
  const t = totals(period);
  const current = period === RUN.period;
  const status: Status6 = current ? RUN.status : "paid";
  const edit = canRun(user);
  const open = status === "draft" || status === "computed";
  return {
    payroll_run_id: runId(period),
    number: numberOf(period),
    period: first(period),
    status,
    advanced: false,
    headcount: t.headcount,
    gross_pay: money(t.gross),
    total_deductions: money(t.ded),
    net_pay: money(t.gross - t.ded),
    employer_cost: "0.00",
    computed_at: now(),
    submitted_at: current && status !== "computed" ? RUN.submitted_at : null,
    submitted_by_name: current && status !== "computed" ? (byKey(RUN.submitted_by)?.display_name ?? null) : null,
    approved_at: current ? RUN.approved_at : null,
    approved_by_name: current ? (RUN.approved_by ? (byKey(RUN.approved_by)?.display_name ?? null) : null) : "Ifeoma Chukwu",
    paid_on: current ? RUN.paid_on : `${period}-27`,
    payment_reference: null,
    paid_by_name: null,
    returned_reason: null,
    workflow_instance_id: current && status !== "computed" && status !== "draft" ? WID : null,
    chain: withChain && current && status !== "computed" && status !== "draft" ? route1() : [],
    blocking_problems: 0,
    warnings: 0,
    can_compute: open && edit,
    can_submit: status === "computed" && edit,
    can_decide: current && status === "submitted" && isCeo(user),
    can_pay: current && status === "approved" && edit,
    can_discard: open && edit,
    created_at: now(),
  } as PayrollRun;
}

const forbidden = () => fail(403, "FORBIDDEN", "Payroll is for Operations and the CEO.");
const guard = (id: string) => (runId(RUN.period) === id ? null : notFound());

route("GET /api/v1/payroll/runs/summary", (req) => {
  if (!canRun(req.user!)) return forbidden();
  const counts = { draft: 0, computed: 0, submitted: 0, approved: 0, paid: 0 };
  for (const p of periods()) counts[runOf(p, req.user!).status] += 1;
  const last = periods().slice(0, 12).reverse();
  const body: PayrollRunSummary = {
    current: runOf(RUN.period, req.user!, true),
    counts,
    trend: last.map((p) => ({ period: first(p), net_pay: runOf(p, req.user!).net_pay })),
  };
  return ok(body);
});
route("GET /api/v1/payroll/runs", (req) =>
  canRun(req.user!)
    ? paged(periods().map((p) => runOf(p, req.user!)), req, {
        filters: { status: (r, v) => r.status === v, year: (r, v) => r.period.startsWith(v) },
      })
    : forbidden(),
);
route("POST /api/v1/payroll/runs", (req) => {
  if (!canRun(req.user!)) return forbidden();
  const period = String((req.body as { period?: string }).period ?? "").slice(0, 7);
  if (periods().includes(period)) return fail(409, "RUN_EXISTS", "This month already has a run", { period: ["Already has a run"] });
  return fail(422, "PERIOD_NOT_ALLOWED", "Pick a month from the first start to this month", { period: ["Pick another month"] });
});
route("GET /api/v1/payroll/runs/:id", (req) => guard(req.params.id) ?? (canRun(req.user!) ? ok(runOf(RUN.period, req.user!, true)) : forbidden()));
route("POST /api/v1/payroll/runs/:id/compute", (req) => {
  const g = guard(req.params.id);
  if (g) return g;
  if (!canRun(req.user!)) return forbidden();
  if (RUN.status !== "draft" && RUN.status !== "computed") return fail(409, "RUN_NOT_EDITABLE", "This run can no longer be changed");
  RUN.status = "computed";
  return ok(runOf(RUN.period, req.user!, true));
});
route("POST /api/v1/payroll/runs/:id/submit", (req) => {
  const g = guard(req.params.id);
  if (g) return g;
  if (!canRun(req.user!)) return forbidden();
  if (RUN.status !== "computed") return fail(409, RUN.status === "draft" ? "RUN_NOT_COMPUTED" : "RUN_NOT_EDITABLE", RUN.status === "draft" ? "Compute the run first" : "This run can no longer be changed");
  RUN.status = "submitted";
  RUN.submitted_at = now();
  RUN.submitted_by = req.user!;
  return ok(runOf(RUN.period, req.user!, true));
});
route("POST /api/v1/payroll/runs/:id/mark-paid", (req) => {
  const g = guard(req.params.id);
  if (g) return g;
  if (!canRun(req.user!)) return forbidden();
  if (RUN.status !== "approved") return fail(409, "NOT_APPROVED", "Only an approved run is marked paid");
  RUN.status = "paid";
  RUN.paid_on = String((req.body as { paid_on?: string }).paid_on ?? isoDaysAgo(0));
  return ok(runOf(RUN.period, req.user!, true));
});
route("POST /api/v1/payroll/runs/:id/email-payslips", (req) =>
  guard(req.params.id) ??
  (RUN.status === "computed" || RUN.status === "submitted"
    ? fail(409, "NOT_APPROVED", "Payslips go to staff once the run is approved.")
    : { status: 202, body: { queued: totals(RUN.period).headcount } }),
);

/** POST /workflow/instances/:id/approve|reject for the month's run: the CEO decides it; null for any other id. */
export function decidePayrollRun(user: string, wid: string, approve: boolean, reason?: string | null) {
  if (wid !== WID) return null;
  if (RUN.status !== "submitted" || !isCeo(user)) return fail(403, "PERMISSION_DENIED", "You are not an approver for this stage");
  if (!approve && !String(reason ?? "").trim()) return invalid({ reason: ["is required"] });
  if (approve) {
    RUN.status = "approved";
    RUN.approved_at = now();
    RUN.approved_by = user;
  } else RUN.status = "draft";
  return ok({ workflow_instance_id: WID, state: approve ? "approved" : "rejected", stage_name: null });
}

/** GET /workflow/instances/:id for the month's run; null for any other id. */
export function payrollRunInstance(user: string, wid: string): ApprovalInstance | null {
  if (wid !== WID || !canRun(user)) return null;
  const pending = RUN.status === "submitted";
  return {
    workflow_instance_id: WID,
    definition_key: "payroll.run",
    definition_name: "Payroll Run",
    version: 1,
    module_key: "payroll",
    entity_type: "payroll_run",
    entity_id: runId(RUN.period),
    subject_employee_id: null,
    subject_name: null,
    state: pending ? "pending" : "approved",
    current_stage: pending ? "ceo" : null,
    stage_name: pending ? "CEO" : null,
    context: {},
    stage_entered_at: RUN.submitted_at,
    stage_due_at: pending ? new Date(Date.parse(RUN.submitted_at) + 72 * 3600000).toISOString() : null,
    opened_by: null,
    opened_by_name: byKey(RUN.submitted_by)?.display_name ?? null,
    opened_at: RUN.submitted_at,
    completed_at: pending ? null : (RUN.approved_at ?? now()),
    route: route1(),
    decisions: [],
    can_decide: pending && isCeo(user),
    can_withdraw: false,
    can_reassign: false,
    link: "/payroll?tab=payroll-runs",
  } as ApprovalInstance;
}

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
  if (RUN.status === "approved" || RUN.status === "paid") return fail(409, "RUN_LOCKED", "This month's run is locked. It goes into next month as an adjustment.");
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
