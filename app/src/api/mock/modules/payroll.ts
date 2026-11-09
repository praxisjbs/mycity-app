import type { ApprovalInstance, DeductionRow, DeductionSummary, PayrollRun, PayrollRunSummary } from "@mycity/contract/contract.gen.ts";
import type { Grade, Statutory } from "@/api/types/payroll";
import type { Status } from "@/api/types/performance";
import { accepted, created, fail, invalid, isoDaysAgo, notFound, ok, paged, route, sid } from "../core";
import { byId, byKey, PEOPLE, refKey, SIGN_INS } from "../data/people";
import { kobo, money, SLIPS } from "../data/payroll";

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
const runId = (period: string) => sid(`run:${period}`);
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
  guard(req.params.id) ?? (RUN.status === "computed" || RUN.status === "submitted" ? fail(409, "NOT_APPROVED", "Payslips go to staff once the run is approved.") : accepted()),
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

/*
 * Deductions in the contract's shapes (packages/contract/schemas/deductions.js): waiting attendance deductions,
 * fines and advances as one list, and the moves the screen makes, down to the API's own refusals: the open
 * month and later for a start, nothing accepted twice, never your own.
 */
type Ded = DeductionRow;
const OPEN = `${thisPeriod()}-01`;
const person = (key: string) => refKey(key);
const flags = (): Pick<Ded, "can_accept" | "can_waive" | "can_release" | "can_cancel"> => ({ can_accept: false, can_waive: false, can_release: false, can_cancel: false });

const DEDS: Ded[] = [
  { source: "attendance", id: "late:bashir", who: "bashir", reason: "Late arrival, 06/10/2026", amount: "1500.00", status: "pending" },
  { source: "attendance", id: "absence:seyi", who: "seyi", reason: "Absence, 08/10/2026", amount: "17307.69", status: "pending" },
  { source: "fine", id: "fine:seyi", who: "seyi", reason: "Studio monitor damage", amount: "45000.00", status: "pending", query: "QRY-0014" },
  { source: "fine", id: "fine:amara", who: "amara", reason: "Lost a company badge", amount: "8000.00", status: "pending", query: "QRY-0019" },
  { source: "fine", id: "fine:chidera", who: "chidera", reason: "Late return of a laptop", amount: "15000.00", status: "pending", query: "QRY-0021" },
  { source: "fine", id: "fine:ngozi", who: "ngozi", reason: "Missed a handover", amount: "6000.00", status: "pending", query: "QRY-0023" },
  { source: "fine", id: "fine:bashir2", who: "bashir", reason: "Unreturned petty cash", amount: "9500.00", status: "pending", query: "QRY-0025" },
  { source: "fine", id: "fine:bashir", who: "bashir", reason: "Late with a delivery", amount: "5000.00", status: "waived", query: "QRY-0011" },
  { source: "advance", id: "advance:amara", who: "amara", reason: "School fees", amount: "50000.00", status: "active", instalments: 2, applied: 0 },
  { source: "fine", id: "fine:ada", who: "ifeoma", reason: "Broken headset", amount: "12000.00", status: "settled", query: "QRY-0007", instalments: 3, applied: 3 },
].map((d, i) => {
  const fine = d.source === "fine";
  const id = sid(`ded:${d.id}`);
  const accepted = d.status === "active" || d.status === "settled";
  return {
    source: d.source as Ded["source"],
    source_id: id,
    sanction_fine_id: fine ? id : null,
    payroll_deduction_id: accepted ? sid(`deduction:${d.id}`) : null,
    employee: person(d.who),
    reason: d.reason,
    pay_amount: d.amount,
    salary_set: true,
    period: d.source === "attendance" ? first(`${thisPeriod()}`) : OPEN,
    instalments: "instalments" in d ? (d.instalments as number) : null,
    instalments_applied: "applied" in d ? (d.applied as number) : null,
    status: d.status as Ded["status"],
    query_number: "query" in d ? (d.query as string) : null,
    created_at: new Date(Date.now() - i * 3600_000 * 5).toISOString(),
    ...flags(),
  } as Ded;
});

/** What a reader may press on a row now: their grant, the row's state, and never their own (§6.6 rule 8). */
function offered(d: Ded, user: string): Ded {
  const mine = byKey(user)?.employee_id === d.employee.employee_id;
  const may = canRun(user) && !mine;
  const waiting = d.source === "fine" && d.status === "pending";
  const running = d.status === "active" && !(d.instalments_applied && d.instalments_applied > 0);
  return {
    ...d,
    can_accept: may && waiting,
    can_waive: may && waiting,
    can_release: may && d.source === "fine" && running,
    can_cancel: may && d.source === "advance" && running,
  };
}

const figure = (rows: Ded[]) => ({ count: rows.length, pay_amount: money(rows.reduce((a, r) => a + kobo(r.pay_amount ?? "0"), 0)) });
const queue = (a: Ded, b: Ded) => Number(b.status === "pending") - Number(a.status === "pending") || b.created_at.localeCompare(a.created_at);

route("GET /api/v1/deductions/summary", (req) => {
  if (!canRun(req.user!)) return forbidden();
  const live = DEDS.filter((d) => d.status !== "waived");
  const body: DeductionSummary = {
    open_period: OPEN,
    pending_fines: figure(DEDS.filter((d) => d.source === "fine" && d.status === "pending")),
    pending_attendance: figure(DEDS.filter((d) => d.source === "attendance" && d.status === "pending")),
    active: figure(live.filter((d) => d.status === "active")),
    recovered_this_year: figure(live.filter((d) => d.status === "settled")),
  };
  return ok(body);
});
route("GET /api/v1/deductions", (req) =>
  canRun(req.user!)
    ? paged(DEDS.map((d) => offered(d, req.user!)), req, {
        search: (d) => [d.employee.display_name, d.reason, d.query_number],
        filters: {
          status: (d, v) => d.status === v,
          source: (d, v) => d.source === v,
          employee_id: (d, v) => d.employee.employee_id === v,
          month: (d, v) => d.period.startsWith(v),
        },
        sort: {
          queue,
          created: (a, b) => a.created_at.localeCompare(b.created_at),
          employee: (a, b) => a.employee.display_name.localeCompare(b.employee.display_name),
          amount: (a, b) => kobo(a.pay_amount ?? "0") - kobo(b.pay_amount ?? "0"),
        },
      })
    : forbidden(),
);

const byFine = (id: string) => DEDS.find((d) => d.source === "fine" && d.source_id === id);
const byDeduction = (id: string) => DEDS.find((d) => d.payroll_deduction_id === id);
const reasonFault = (reason: unknown) => (String(reason ?? "").trim().length >= 10 ? null : invalid({ reason: [String(reason ?? "").trim() ? "At least 10 characters" : "Give a reason"] }));
const own = (user: string, d: Ded) => byKey(user)?.employee_id === d.employee.employee_id;
const startFault = (start: unknown, months: unknown) => {
  const n = Number(months);
  if (!Number.isInteger(n) || n < 1 || n > 12) return invalid({ months: ["Pick 1 to 12"] });
  if (typeof start !== "string" || !/^\d{4}-\d{2}-01$/.test(start)) return invalid({ start_period: ["Pick a start month"] });
  if (start < OPEN) return fail(422, "START_NOT_ALLOWED", "Start this month or a later one", { start_period: ["Pick a later month"] });
  return null;
};

route("POST /api/v1/deductions/fines/:sanction_fine_id/accept", (req) => {
  if (!canRun(req.user!)) return forbidden();
  const d = byFine(req.params.sanction_fine_id);
  if (!d) return notFound();
  const b = req.body as { months?: unknown; start_period?: unknown };
  const bad = startFault(b.start_period, b.months);
  if (bad) return bad;
  if (own(req.user!, d)) return fail(403, "OWN_RECORD", "Someone else accepts your own fine");
  if (d.status !== "pending") return fail(409, "FINE_NOT_MOVABLE", "This fine cannot be accepted now");
  Object.assign(d, { status: "active", payroll_deduction_id: sid(`deduction:${d.source_id}`), instalments: Number(b.months), instalments_applied: 0, period: String(b.start_period) });
  return ok(offered(d, req.user!));
});
route("POST /api/v1/deductions/fines/:sanction_fine_id/waive", (req) => {
  if (!canRun(req.user!)) return forbidden();
  const d = byFine(req.params.sanction_fine_id);
  if (!d) return notFound();
  const bad = reasonFault(req.body.reason);
  if (bad) return bad;
  if (own(req.user!, d)) return fail(403, "OWN_RECORD", "Someone else waives your own fine");
  if (d.status !== "pending") return fail(409, "FINE_NOT_MOVABLE", "This fine cannot be waived now");
  d.status = "waived";
  return ok(offered(d, req.user!));
});
route("POST /api/v1/deductions/:id/release", (req) => {
  if (!canRun(req.user!)) return forbidden();
  const d = byDeduction(req.params.id);
  if (!d || d.source !== "fine") return notFound();
  const bad = reasonFault(req.body.reason);
  if (bad) return bad;
  if (own(req.user!, d)) return fail(403, "OWN_RECORD", "Someone else releases your own fine");
  if (d.status !== "active") return fail(409, "FINE_NOT_MOVABLE", "This fine is no longer accepted");
  if ((d.instalments_applied ?? 0) > 0) return fail(409, "INSTALMENTS_STARTED", "A month of this deduction is already in a run");
  Object.assign(d, { status: "pending", payroll_deduction_id: null, instalments: null, instalments_applied: null });
  return ok(offered(d, req.user!));
});
route("POST /api/v1/deductions/advances", (req) => {
  if (!canRun(req.user!)) return forbidden();
  const b = req.body as Record<string, unknown>;
  const p = byId(String(b.employee_id ?? ""));
  const f: Record<string, string[]> = {};
  if (!p) f.employee_id = ["Pick a person"];
  if (!(Number(b.amount) > 0)) f.amount = ["Enter an amount"];
  if (!b.granted_on) f.granted_on = ["Pick a date"];
  else if (String(b.granted_on) > isoDaysAgo(0)) f.granted_on = ["Not in the future"];
  if (String(b.reason ?? "").trim().length < 10) f.reason = [String(b.reason ?? "").trim() ? "At least 10 characters" : "Give a reason"];
  if (Object.keys(f).length) return invalid(f);
  const bad = startFault(b.start_period, b.months);
  if (bad) return bad;
  if (byKey(req.user!)?.employee_id === p!.employee_id) return fail(403, "OWN_RECORD", "Someone else records your own advance");
  const id = sid(`deduction:advance:${DEDS.length}`);
  const d = offered({ ...flags(), source: "advance", source_id: id, sanction_fine_id: null, payroll_deduction_id: id, employee: refKey(p!.user_key), reason: String(b.reason).trim(), pay_amount: String(b.amount), salary_set: true, period: String(b.start_period), instalments: Number(b.months), instalments_applied: 0, status: "active", query_number: null, created_at: now() }, req.user!);
  DEDS.unshift(d);
  return created(d);
});
route("POST /api/v1/deductions/:id/cancel", (req) => {
  if (!canRun(req.user!)) return forbidden();
  const d = byDeduction(req.params.id);
  if (!d || d.source !== "advance") return notFound();
  const bad = reasonFault(req.body.reason);
  if (bad) return bad;
  if (own(req.user!, d)) return fail(403, "OWN_RECORD", "Someone else cancels your own advance");
  if ((d.instalments_applied ?? 0) > 0) return fail(409, "INSTALMENTS_STARTED", "A month of this deduction is already in a run");
  DEDS.splice(DEDS.indexOf(d), 1);
  return ok({ ...d, can_cancel: false });
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
