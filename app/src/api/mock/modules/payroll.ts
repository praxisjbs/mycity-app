import type {
  ApprovalInstance,
  DeductionRow,
  DeductionSummary,
  GradePlacement,
  PayComponentSet,
  PayrollAdjustment,
  PayrollAdjustmentAdd,
  PayrollProblem,
  PayrollRun,
  PayrollRunSummary,
  PayrollSettings,
  PayrollSettingsChange,
  PayrollSettingsVersion,
  SalaryGrade,
  StatutoryItemState,
  StatutoryRate,
  StatutorySource,
} from "@mycity/contract/contract.gen.ts";
import payrollSchemas from "@mycity/contract/schemas/payroll.js";
import salarySchemas from "@mycity/contract/schemas/salary_structure.js";
import statutorySchemas from "@mycity/contract/schemas/statutory.js";
import { todayIso } from "@mycity/ui";
import type { RawResponse } from "../../client";
import { created, fail, invalid, isoDaysAgo, noContent, notFound, ok, paged, route, sid } from "../core";
import { byId, byKey, PEOPLE, ref, refKey, SIGN_INS } from "../data/people";
import { kobo, money, payDateOf, SLIPS, type MockSlip } from "../data/payroll";
import { exportFile } from "./shared";

const canRun = (u: string) => ["operations", "ceo"].includes(SIGN_INS[u]?.view ?? "");
const isCeo = (u: string) => SIGN_INS[u]?.view === "ceo";
const thisPeriod = () => todayIso().slice(0, 7);
const now = () => new Date().toISOString();
const operator = () => Object.keys(SIGN_INS).find((k) => SIGN_INS[k].view === "operations") ?? "";
const nameOf = (key: string | null) => (key ? (byKey(key)?.display_name ?? null) : null);

/*
 * Payroll runs in the contract's shapes (packages/contract/schemas/payroll.js), held in memory: every month
 * before this one is paid, and this month's run is computed and waiting to be sent. Every move the screen
 * makes is the API's own, down to its refusals (docs/guides/payroll.md §5, §6.9): one run a month, never a
 * month still to come; Compute and Submit only while the run may change; an adjustment or an exclusion sends a
 * Computed run back to Draft; Submit refuses a blocking problem and a changed total; the CEO decides it through
 * the approval's routes (POST /workflow/instances/:id/approve, /reject, /request-changes), which reach here
 * through organisation.ts's and expenses.ts's chains; Approve publishes the month's payslips; Mark Paid ends it.
 */
type Status6 = PayrollRun["status"];
interface RunRow {
  period: string;
  status: Status6;
  created_at: string;
  computed_at: string | null;
  submitted_at: string | null;
  submitted_by: string | null;
  approved_at: string | null;
  approved_by: string | null;
  paid_on: string | null;
  payment_reference: string | null;
  paid_by: string | null;
  returned_reason: string | null;
}
interface AdjustmentRow {
  payroll_adjustment_id: string;
  period: string;
  employee_id: string;
  kind: PayrollAdjustment["kind"];
  label: string;
  amount: number;
  reason: string;
  created_by: string;
  created_at: string;
}

const first = (period: string) => `${period}-01`;
const numberOf = (period: string) => `PAY-${period}`;
export const runId = (period: string) => sid(`run:${period}`);
const wfOf = (period: string) => sid(`wf:payroll_run:${period}`);
const blank = (period: string): RunRow => ({
  period,
  status: "draft",
  created_at: now(),
  computed_at: null,
  submitted_at: null,
  submitted_by: null,
  approved_at: null,
  approved_by: null,
  paid_on: null,
  payment_reference: null,
  paid_by: null,
  returned_reason: null,
});

const RUNS = new Map<string, RunRow>();
for (const period of [...new Set(SLIPS.map((x) => x.period))]) {
  if (period === thisPeriod()) RUNS.set(period, { ...blank(period), status: "computed", computed_at: now() });
  else {
    const day = `${first(period)}T09:00:00.000Z`;
    RUNS.set(period, { ...blank(period), status: "paid", created_at: day, computed_at: day, submitted_at: day, submitted_by: operator(), approved_at: day, approved_by: "ifeoma", paid_on: payDateOf(period), paid_by: operator() });
  }
}
/** The months left out of a run, by person, with the reason. */
const EXCLUDED = new Map<string, Map<string, string>>();
const ADJUSTMENTS: AdjustmentRow[] = [];
/** Payslips already emailed, so Email All sends only to the rest unless Email Again is chosen. */
export const EMAILED = new Map<string, string>();

const periods = () => [...RUNS.keys()].sort().reverse();
const runByWid = (wid: string) => [...RUNS.values()].find((r) => wfOf(r.period) === wid && r.status !== "draft" && r.status !== "computed");
/** A month's run status, or null for a month with no run. */
export const runStatusOf = (period: string): Status6 | null => RUNS.get(period)?.status ?? null;
const isOpen = (r: RunRow) => r.status === "draft" || r.status === "computed";
const lastDay = (period: string) => payDateOf(period, 31);

/** The month's payslips: the demonstration ones, or, for a month first opened here, one for each person who had started. */
function slipsOf(period: string): MockSlip[] {
  const held = SLIPS.filter((x) => x.period === period);
  if (held.length || !RUNS.has(period)) return held;
  PEOPLE.filter((p) => p.start_date <= lastDay(period)).forEach((p, i) =>
    SLIPS.push({
      payslip_id: sid(`slip:${p.user_key}:${period}`),
      number: `PAY-${period}-${String(i + 1).padStart(4, "0")}`,
      person: p,
      period,
      gross: kobo(p.gross_monthly),
      ded: 0,
      status: "in_run",
      paid_on: null,
      ded_reason: null,
      ded_query: null,
    }),
  );
  return SLIPS.filter((x) => x.period === period);
}

/** What a payslip comes to: its gross and deductions with the run's adjustments, nothing for a person left out. */
export function slipFigures(x: MockSlip) {
  const reason = EXCLUDED.get(x.period)?.get(x.person.employee_id) ?? null;
  const adjustments = ADJUSTMENTS.filter((a) => a.period === x.period && a.employee_id === x.person.employee_id);
  const plus = adjustments.filter((a) => a.kind === "earning").reduce((s, a) => s + a.amount, 0);
  const minus = adjustments.filter((a) => a.kind === "deduction").reduce((s, a) => s + a.amount, 0);
  return { excluded: reason, earnings: reason ? 0 : x.gross + plus, deductions: reason ? 0 : x.ded + minus, adjustments: reason ? [] : adjustments };
}

function totals(period: string) {
  const paid = slipsOf(period).filter((x) => !slipFigures(x).excluded);
  const gross = paid.reduce((a, x) => a + slipFigures(x).earnings, 0);
  const ded = paid.reduce((a, x) => a + slipFigures(x).deductions, 0);
  return { headcount: paid.length, gross, ded };
}

/** The person whose overtime waits on their line manager in the open month (a warning, never blocking). */
const OVERTIME_WAITING = "tobi";

/** A run's problems (§6.15), blocking first; only while it is a Draft or Computed one. */
function problemsOf(period: string): PayrollProblem[] {
  const r = RUNS.get(period);
  if (!r || !isOpen(r)) return [];
  const out: PayrollProblem[] = [];
  for (const x of slipsOf(period)) {
    const f = slipFigures(x);
    if (f.excluded) continue;
    const who = ref(x.person)!;
    if (f.earnings - f.deductions < 0)
      out.push({ code: "NEGATIVE_NET", severity: "blocking", employee: who, payslip_id: x.payslip_id, message: `${who.display_name} would be paid less than nothing`, action: "Spread a deduction, add an adjustment or exclude them" });
    if (x.person.user_key === OVERTIME_WAITING && period === thisPeriod())
      out.push({ code: "OVERTIME_WAITING", severity: "warning", employee: who, payslip_id: x.payslip_id, message: `2 overtime items wait for a decision for ${who.display_name}`, action: "Ask the line manager to decide" });
    const fines = DEDS.filter((d) => d.source === "fine" && d.status === "pending" && d.employee.employee_id === x.person.employee_id).length;
    if (fines)
      out.push({ code: "FINE_WAITING", severity: "warning", employee: who, payslip_id: x.payslip_id, message: `${fines} ${fines === 1 ? "fine waits" : "fines wait"} for payroll for ${who.display_name}`, action: "Accept, spread or waive it on Deductions" });
  }
  return out.sort((a, b) => Number(a.severity === "warning") - Number(b.severity === "warning"));
}

/** The approval's route as the screen reads it: one stage, the CEO. */
function chainOf(r: RunRow): PayrollRun["chain"] {
  if (isOpen(r)) return [];
  return [{ key: "ceo", name: "CEO", state: r.status === "submitted" ? "now" : "done", approvers: [{ type: "ceo", value: null, label: "CEO" }] }] as PayrollRun["chain"];
}

function runOf(period: string, user: string, withChain = false): PayrollRun {
  const r = RUNS.get(period)!;
  const t = totals(period);
  const edit = canRun(user);
  const open = isOpen(r);
  const problems = problemsOf(period);
  return {
    payroll_run_id: runId(period),
    number: numberOf(period),
    period: first(period),
    status: r.status,
    advanced: false,
    headcount: t.headcount,
    gross_pay: money(t.gross),
    total_deductions: money(t.ded),
    net_pay: money(t.gross - t.ded),
    employer_cost: "0.00",
    computed_at: r.computed_at,
    submitted_at: r.submitted_at,
    submitted_by_name: nameOf(r.submitted_by),
    approved_at: r.approved_at,
    approved_by_name: nameOf(r.approved_by),
    paid_on: r.paid_on,
    payment_reference: r.payment_reference,
    paid_by_name: nameOf(r.paid_by),
    returned_reason: r.returned_reason,
    workflow_instance_id: open ? null : wfOf(period),
    chain: withChain ? chainOf(r) : [],
    blocking_problems: problems.filter((p) => p.severity === "blocking").length,
    warnings: problems.filter((p) => p.severity === "warning").length,
    can_compute: open && edit,
    can_submit: r.status === "computed" && edit,
    can_decide: r.status === "submitted" && isCeo(user) && r.submitted_by !== user,
    can_pay: r.status === "approved" && edit,
    can_discard: open && edit,
    created_at: r.created_at,
  };
}

const forbidden = () => fail(403, "FORBIDDEN", "Payroll is for Operations and the CEO.");
const notEditable = () => fail(409, "RUN_NOT_EDITABLE", "This run can no longer be changed");
const notApproved = () => fail(409, "NOT_APPROVED", "Only an approved run");
const periodOfId = (id: string) => periods().find((p) => runId(p) === id) ?? null;

/** The run a route names, for a reader who may open Payroll: the period, or the refusal. */
function theRun(req: { params: Record<string, string>; user: string | null }): { period: string; run: RunRow } | RawResponse {
  if (!canRun(req.user!)) return forbidden();
  const period = periodOfId(req.params.id);
  return period ? { period, run: RUNS.get(period)! } : fail(404, "NOT_FOUND", "That payroll run does not exist");
}
const refused = (x: { period: string; run: RunRow } | RawResponse): x is RawResponse => "status" in x && "body" in x;

/** The newest run not yet paid, else the latest: the one Payroll Runs shows first. */
const currentPeriod = () => periods().find((p) => RUNS.get(p)!.status !== "paid") ?? periods()[0] ?? null;

route("GET /api/v1/payroll/runs/summary", (req) => {
  if (!canRun(req.user!)) return forbidden();
  const counts = { draft: 0, computed: 0, submitted: 0, approved: 0, paid: 0 };
  for (const p of periods()) counts[RUNS.get(p)!.status] += 1;
  const c = currentPeriod();
  const body: PayrollRunSummary = {
    current: c ? runOf(c, req.user!, true) : null,
    counts,
    trend: periods().slice(0, 12).reverse().map((p) => ({ period: first(p), net_pay: runOf(p, req.user!).net_pay })),
  };
  return ok(body);
});
route("GET /api/v1/payroll/runs", (req) =>
  canRun(req.user!)
    ? paged(periods().map((p) => runOf(p, req.user!)), req, {
        filters: { status: (r, v) => r.status === v, year: (r, v) => r.period.startsWith(v) },
        sort: {
          newest: (a, b) => b.period.localeCompare(a.period),
          period: (a, b) => a.period.localeCompare(b.period),
          status: (a, b) => a.status.localeCompare(b.status),
        },
      })
    : forbidden(),
);
route("POST /api/v1/payroll/runs", (req) => {
  if (!canRun(req.user!)) return forbidden();
  return checked<{ period: string }>(payrollSchemas.PayrollRunCreate, req.body, (b) => {
    const period = b.period.slice(0, 7);
    if (RUNS.has(period)) return fail(409, "RUN_EXISTS", "This month already has a run", { period: ["Already has a run"] });
    const earliest = PEOPLE.map((p) => p.start_date.slice(0, 7)).sort()[0];
    if (period > thisPeriod() || period < earliest) return fail(422, "PERIOD_NOT_ALLOWED", "Pick a month from the first start to this month", { period: ["Pick another month"] });
    RUNS.set(period, blank(period));
    slipsOf(period);
    return created(runOf(period, req.user!, true));
  });
});
route("GET /api/v1/payroll/runs/:id", (req) => {
  const x = theRun(req);
  return refused(x) ? x : ok(runOf(x.period, req.user!, true));
});
route("POST /api/v1/payroll/runs/:id/compute", (req) => {
  const x = theRun(req);
  if (refused(x)) return x;
  if (!isOpen(x.run)) return notEditable();
  Object.assign(x.run, { status: "computed", computed_at: now() });
  return ok(runOf(x.period, req.user!, true));
});
route("GET /api/v1/payroll/runs/:id/problems", (req) => {
  const x = theRun(req);
  return refused(x) ? x : paged(problemsOf(x.period), req);
});
route("POST /api/v1/payroll/runs/:id/submit", (req) => {
  const x = theRun(req);
  if (refused(x)) return x;
  if (x.run.status === "draft") return fail(409, "RUN_NOT_COMPUTED", "Compute the run first");
  if (x.run.status !== "computed") return notEditable();
  const t = totals(x.period);
  if (!t.headcount) return fail(422, "NO_ONE_TO_PAY", "No one to pay this month");
  const blocking = problemsOf(x.period).filter((p) => p.severity === "blocking").length;
  if (blocking) return fail(422, "RUN_HAS_PROBLEMS", "Fix the blocking problems first", { problems: [`${blocking} blocking`] });
  const expected = (req.body as { expected_net_total?: string }).expected_net_total;
  if (expected !== undefined && kobo(expected) !== t.gross - t.ded)
    return fail(409, "RUN_CHANGED", "The totals changed. Check them and send again", { gross_pay: [money(t.gross)], total_deductions: [money(t.ded)], net_pay: [money(t.gross - t.ded)] });
  Object.assign(x.run, { status: "submitted", submitted_at: now(), submitted_by: req.user!, returned_reason: null });
  return ok(runOf(x.period, req.user!, true));
});
route("POST /api/v1/payroll/runs/:id/mark-paid", (req) => {
  const x = theRun(req);
  if (refused(x)) return x;
  return checked<{ paid_on: string; payment_reference?: string | null }>(payrollSchemas.PayrollRunPaid, req.body, (b) => {
    if (x.run.status !== "approved") return notApproved();
    if (b.paid_on > todayIso()) return fail(422, "PAID_IN_THE_FUTURE", "The payment date cannot be in the future", { paid_on: ["Date too late"] });
    Object.assign(x.run, { status: "paid", paid_on: b.paid_on, payment_reference: b.payment_reference ?? null, paid_by: req.user! });
    return ok(runOf(x.period, req.user!, true));
  });
});

const inRun = (period: string, employeeId: string) => slipsOf(period).find((s) => s.person.employee_id === employeeId) ?? null;

route("POST /api/v1/payroll/runs/:id/exclude", (req) => {
  const x = theRun(req);
  if (refused(x)) return x;
  return checked<{ employee_id: string; reason: string }>(payrollSchemas.PayrollRunExclude, req.body, (b) => {
    if (!isOpen(x.run)) return notEditable();
    if (!inRun(x.period, b.employee_id)) return fail(422, "NOT_IN_RUN", "This person is not paid in this month", { employee_id: ["Not paid this month"] });
    if (!EXCLUDED.has(x.period)) EXCLUDED.set(x.period, new Map());
    EXCLUDED.get(x.period)!.set(b.employee_id, b.reason);
    x.run.status = "draft";
    return ok(runOf(x.period, req.user!, true));
  });
});
route("POST /api/v1/payroll/runs/:id/include", (req) => {
  const x = theRun(req);
  if (refused(x)) return x;
  return checked<{ employee_id: string }>(payrollSchemas.PayrollRunInclude, req.body, (b) => {
    if (!isOpen(x.run)) return notEditable();
    if (!EXCLUDED.get(x.period)?.delete(b.employee_id)) return fail(404, "NOT_EXCLUDED", "This person is not left out of the run");
    x.run.status = "draft";
    return ok(runOf(x.period, req.user!, true));
  });
});

function adjustmentOf(a: AdjustmentRow): PayrollAdjustment {
  return {
    payroll_adjustment_id: a.payroll_adjustment_id,
    payroll_run_id: runId(a.period),
    employee: ref(byId(a.employee_id))!,
    kind: a.kind,
    label: a.label,
    pay_amount: money(a.amount),
    reason: a.reason,
    created_by_name: nameOf(a.created_by),
    created_at: a.created_at,
  };
}

route("GET /api/v1/payroll/runs/:id/adjustments", (req) => {
  const x = theRun(req);
  return refused(x) ? x : paged(ADJUSTMENTS.filter((a) => a.period === x.period).map(adjustmentOf), req);
});
route("POST /api/v1/payroll/runs/:id/adjustments", (req) => {
  const x = theRun(req);
  if (refused(x)) return x;
  return checked<PayrollAdjustmentAdd>(payrollSchemas.PayrollAdjustmentAdd, req.body, (b) => {
    if (!isOpen(x.run)) return notEditable();
    if (!inRun(x.period, b.employee_id)) return fail(422, "NOT_IN_RUN", "This person is not paid in this month", { employee_id: ["Not paid this month"] });
    if (EXCLUDED.get(x.period)?.has(b.employee_id)) return fail(422, "NOT_IN_RUN", "This person is left out of the run", { employee_id: ["Left out of this run"] });
    const a: AdjustmentRow = { payroll_adjustment_id: sid(`adjustment:${x.period}:${ADJUSTMENTS.length}:${now()}`), period: x.period, employee_id: b.employee_id, kind: b.kind, label: b.label, amount: kobo(b.amount), reason: b.reason, created_by: req.user!, created_at: now() };
    ADJUSTMENTS.push(a);
    x.run.status = "draft";
    return created(adjustmentOf(a));
  });
});
route("DELETE /api/v1/payroll/runs/:id/adjustments/:adjustment_id", (req) => {
  const x = theRun(req);
  if (refused(x)) return x;
  if (!isOpen(x.run)) return notEditable();
  const at = ADJUSTMENTS.findIndex((a) => a.period === x.period && a.payroll_adjustment_id === req.params.adjustment_id);
  if (at < 0) return fail(404, "NOT_FOUND", "That adjustment does not exist");
  ADJUSTMENTS.splice(at, 1);
  x.run.status = "draft";
  return noContent();
});
route("DELETE /api/v1/payroll/runs/:id", (req) => {
  const x = theRun(req);
  if (refused(x)) return x;
  if (!isOpen(x.run)) return notEditable();
  RUNS.delete(x.period);
  EXCLUDED.delete(x.period);
  for (let i = ADJUSTMENTS.length - 1; i >= 0; i -= 1) if (ADJUSTMENTS[i].period === x.period) ADJUSTMENTS.splice(i, 1);
  return noContent();
});

/** The month's published payslips: every one not left out, once the run is approved. */
export const publishedOf = (period: string) => (["approved", "paid"].includes(runStatusOf(period) ?? "") ? slipsOf(period).filter((x) => !slipFigures(x).excluded) : []);

route("POST /api/v1/payroll/runs/:id/email-payslips", (req) => {
  const x = theRun(req);
  if (refused(x)) return x;
  if (x.run.status !== "approved" && x.run.status !== "paid") return fail(409, "NOT_APPROVED", "Payslips go to staff once the run is approved");
  const resend = (req.body as { resend?: boolean }).resend === true;
  const going = publishedOf(x.period).filter((s) => resend || !EMAILED.has(s.payslip_id));
  for (const s of going) EMAILED.set(s.payslip_id, now());
  return { status: 202, body: { queued: going.length } };
});
route("POST /api/v1/payroll/runs/:id/payslips-export", (req) => {
  const x = theRun(req);
  if (refused(x)) return x;
  if (x.run.status !== "approved" && x.run.status !== "paid") return fail(409, "NOT_APPROVED", "Payslips download once the run is approved");
  return exportFile(req.user!, `payslips-${numberOf(x.period).toLowerCase()}`, "pdf");
});
route("POST /api/v1/payroll/runs/:id/statutory-report", (req) => {
  const x = theRun(req);
  return refused(x) ? x : fail(409, "ADVANCED_OFF", "This run was computed without statutory items");
});

/** POST /workflow/instances/:id/approve|reject for a month's run: the CEO decides it; null for any other id. */
export function decidePayrollRun(user: string, wid: string, approve: boolean, reason?: string | null) {
  const r = runByWid(wid);
  if (!r) return null;
  if (r.status !== "submitted" || !isCeo(user) || r.submitted_by === user) return fail(403, "PERMISSION_DENIED", "You are not an approver for this stage");
  if (!approve && !String(reason ?? "").trim()) return invalid({ reason: ["is required"] });
  if (approve) Object.assign(r, { status: "approved", approved_at: now(), approved_by: user });
  else Object.assign(r, { status: "draft", returned_reason: String(reason).trim(), submitted_at: null, submitted_by: null });
  return ok({ workflow_instance_id: wid, state: approve ? "approved" : "rejected", stage_name: null });
}

/** POST /workflow/instances/:id/request-changes for a month's run: Send Back, to Draft with the reason; null for any other id. */
export function sendBackPayrollRun(user: string, wid: string, reason?: string | null) {
  const r = runByWid(wid);
  if (!r) return null;
  if (r.status !== "submitted" || !isCeo(user) || r.submitted_by === user) return fail(403, "PERMISSION_DENIED", "You are not an approver for this stage");
  if (!String(reason ?? "").trim()) return invalid({ reason: ["is required"] });
  Object.assign(r, { status: "draft", returned_reason: String(reason).trim(), submitted_at: null, submitted_by: null });
  return ok({ workflow_instance_id: wid, state: "cancelled", stage_name: null });
}

/** GET /workflow/instances/:id for a month's run; null for any other id. */
export function payrollRunInstance(user: string, wid: string): ApprovalInstance | null {
  const r = runByWid(wid);
  if (!r || !canRun(user)) return null;
  const pending = r.status === "submitted";
  return {
    workflow_instance_id: wid,
    definition_key: "payroll.run",
    definition_name: "Payroll Run",
    version: 1,
    module_key: "payroll",
    entity_type: "payroll_run",
    entity_id: runId(r.period),
    subject_employee_id: null,
    subject_name: null,
    state: pending ? "pending" : "approved",
    current_stage: pending ? "ceo" : null,
    stage_name: pending ? "CEO" : null,
    context: {},
    stage_entered_at: r.submitted_at ?? now(),
    stage_due_at: pending && r.submitted_at ? new Date(Date.parse(r.submitted_at) + 72 * 3600000).toISOString() : null,
    opened_by: null,
    opened_by_name: nameOf(r.submitted_by),
    opened_at: r.submitted_at ?? now(),
    completed_at: pending ? null : (r.approved_at ?? now()),
    route: chainOf(r),
    decisions: [],
    can_decide: pending && isCeo(user) && r.submitted_by !== user,
    can_withdraw: false,
    can_reassign: false,
    link: `/payroll?tab=payroll-runs&id=${runId(r.period)}`,
  } as ApprovalInstance;
}

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

/*
 * Configurations in the contract's shapes (packages/contract/schemas/payroll.js, statutory.js, salary_structure.js):
 * the setting, the statutory rates, grades, placements and pay splits. It starts as production does, with nothing
 * entered: simple mode, the pay day the default 30, no rate, no band and no grade (A26; docs/guides/payroll.md §6.11).
 * Each change is a version from today or later, checked by the contract's own schema and refused as the API refuses it.
 */
type Version = { effective_from: string; effective_to: string | null };
type GradeRow = Version & { salary_grade_id: string; code: string; name: string; minimum: string; maximum: string; created_at: string };
type PlaceRow = Version & { employee_id: string; salary_grade_id: string };
type SplitRow = Version & { employee_id: string; code: string; label: string; amount: string; pensionable: boolean };
interface Issue {
  path: PropertyKey[];
  message: string;
  params?: { code?: unknown };
}
interface Checker<T> {
  safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: Issue[] } };
}

const SETTINGS: PayrollSettingsVersion[] = [];
const RATES: StatutoryRate[] = [];
const GRADE_ROWS: GradeRow[] = [];
const PLACES: PlaceRow[] = [];
const SPLITS: SplitRow[] = [];

const inForce = (r: Version, day: string) => r.effective_from <= day && (r.effective_to === null || r.effective_to > day);
const fromToday = (r: Version, day: string) => r.effective_to === null || r.effective_to > day;
const configures = (u: string) => canRun(u);
const notConfigurer = () => fail(403, "CAPABILITY_REQUIRED", "You do not have permission to do that.");
const forbiddenRead = () => fail(403, "FORBIDDEN", "You do not have permission to see this.");
const tooEarly = () => fail(422, "EFFECTIVE_IN_THE_PAST", "A change starts today or later", { effective_from: ["Date too early"] });
const advancedOff = () => fail(409, "ADVANCED_OFF", "Switch on Advanced Payroll first");
const hasBeenOn = () => SETTINGS.some((v) => v.advanced_enabled);
const operatorName = (u: string) => byKey(u)?.display_name ?? null;

/**
 * The body through the contract's schema: the parsed value, or the 422 the API sends. Like shared/http/validate, a
 * refusal whose every issue names one rule of the contract's (`params.code`, SOURCE_REQUIRED) is answered with it.
 */
function checked<T>(schema: unknown, body: unknown, then: (data: T) => RawResponse): RawResponse {
  const r = (schema as Checker<T>).safeParse(body);
  if (r.success) return then(r.data);
  const fields: Record<string, string[]> = {};
  for (const i of r.error.issues) fields[i.path.map(String).join(".") || "body"] ??= [i.message];
  const codes = r.error.issues.map((i) => (typeof i.params?.code === "string" ? i.params.code : null));
  if (codes[0] && codes.every((c) => c === codes[0])) return fail(422, codes[0], "Check the highlighted fields", fields);
  return invalid(fields);
}

/**
 * Remove Change on a list of versions (shared/db/effective-dated removeVersion): the version of a key starting on `from`,
 * a day still to come, comes off, and the version before it runs on to where it ended. One in force is 409
 * VERSION_IN_FORCE; a day no version starts on is 404. A run of that month sent for approval, approved or paid that read
 * it (only an advanced one, for a rate) keeps it too (payroll.lock assertVersionUnread).
 */
function removeVersion<T extends Version>(list: T[], mine: (r: T) => boolean, from: string, opts: { advancedOnly?: boolean } = {}): RawResponse {
  if (!list.some((r) => mine(r) && r.effective_from === from)) return notFound();
  if (from <= todayIso()) return fail(409, "VERSION_IN_FORCE", "This change is in force. Save a new one from a later date instead.", { effective_from: ["Already in force"] });
  const run = RUNS.get(`${from.slice(0, 7)}-01`);
  // The mock's runs are all simple, so only the setting is ever kept by one; a rate never is.
  if (run && ["submitted", "approved", "paid"].includes(run.status) && !opts.advancedOnly)
    return fail(409, "VERSION_IN_FORCE", "A payroll run sent for approval was computed with this change", { effective_from: ["A run uses it"] });
  const end = list.filter((r) => mine(r) && r.effective_from > from).reduce<string | null>((d, r) => (d === null || r.effective_from < d ? r.effective_from : d), null);
  for (let i = list.length - 1; i >= 0; i -= 1) if (mine(list[i]) && list[i].effective_from === from) list.splice(i, 1);
  for (const r of list) if (mine(r) && r.effective_to === from) r.effective_to = end;
  return noContent();
}

/**
 * A new version of a key from `from`: refused when one starts later, the same day's replaced, the open one ended the
 * day before (shared/db/effective-dated, with `replace`).
 */
function addVersion<T extends Version>(list: T[], mine: (r: T) => boolean, from: string, rows: T[]): RawResponse | null {
  if (list.some((r) => mine(r) && r.effective_from > from))
    return fail(409, "VERSION_EXISTS", "A version already starts on or after this date. Change that version instead.", {
      effective_from: ["a version already starts on or after this date"],
    });
  for (let i = list.length - 1; i >= 0; i -= 1) if (mine(list[i]) && list[i].effective_from === from) list.splice(i, 1);
  for (const r of list) if (mine(r) && r.effective_to === null && r.effective_from < from) r.effective_to = from;
  list.push(...rows);
  return null;
}

/* The setting */

function settingsView(): PayrollSettings {
  const day = todayIso();
  const current = SETTINGS.find((v) => inForce(v, day)) ?? null;
  const next = [...SETTINGS].filter((v) => v.effective_from > day).sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0] ?? null;
  return {
    advanced_enabled: current?.advanced_enabled ?? false,
    advanced_has_been_on: hasBeenOn(),
    pay_day: current?.pay_day ?? 30,
    pay_day_is_default: !current?.pay_day,
    require_bank_details: current?.require_bank_details ?? false,
    paye_basis: current?.paye_basis ?? null,
    pension_reduces_taxable: current?.pension_reduces_taxable ?? null,
    nhf_reduces_taxable: current?.nhf_reduces_taxable ?? null,
    current,
    next,
  };
}

route("GET /api/v1/payroll/settings", (req) => (canRun(req.user!) ? ok(settingsView()) : forbiddenRead()));

const CONVENTION_KEYS = ["paye_basis", "pension_reduces_taxable", "nhf_reduces_taxable"] as const;
/** What switching on needs: PAYE Basis is not asked since PR 10, and an unset one reads as annualised. */
const REQUIRED_CONVENTIONS = ["pension_reduces_taxable", "nhf_reduces_taxable"] as const;

route("PATCH /api/v1/payroll/settings", (req) => {
  if (!configures(req.user!)) return notConfigurer();
  return checked<PayrollSettingsChange>(payrollSchemas.PayrollSettingsChange, req.body, (b) => {
    if (b.effective_from < todayIso()) return tooEarly();
    const latest = [...SETTINGS].sort((a, c) => c.effective_from.localeCompare(a.effective_from))[0] ?? null;
    const merged = {
      advanced_enabled: b.advanced_enabled ?? latest?.advanced_enabled ?? false,
      pay_day: b.pay_day ?? latest?.pay_day ?? null,
      require_bank_details: b.require_bank_details ?? latest?.require_bank_details ?? false,
      paye_basis: b.paye_basis ?? latest?.paye_basis ?? null,
      pension_reduces_taxable: b.pension_reduces_taxable ?? latest?.pension_reduces_taxable ?? null,
      nhf_reduces_taxable: b.nhf_reduces_taxable ?? latest?.nhf_reduces_taxable ?? null,
    };
    const conventionsSent = CONVENTION_KEYS.some((k) => b[k] !== undefined);
    if (conventionsSent && b.advanced_enabled !== true && !hasBeenOn()) return fail(409, "ADVANCED_OFF", "Conventions are set when Advanced Payroll is switched on");
    if (b.advanced_enabled === true && latest?.advanced_enabled !== true) {
      if (!RATES.some((r) => inForce(r, b.effective_from))) return fail(409, "NO_RATES", "Enter a statutory rate in force from this date first", { effective_from: ["No rate that day"] });
      const unset = REQUIRED_CONVENTIONS.filter((k) => merged[k] === null);
      if (unset.length) return fail(409, "NO_CONVENTIONS", "Set the conventions to switch on", Object.fromEntries(unset.map((k) => [k, ["Pick one"]])));
    }
    const row: PayrollSettingsVersion = {
      payroll_setting_id: sid(`setting:${b.effective_from}`),
      ...merged,
      effective_from: b.effective_from,
      effective_to: null,
      reason: b.reason ?? null,
      changed_by_name: operatorName(req.user!),
    };
    return addVersion(SETTINGS, () => true, b.effective_from, [row]) ?? ok(settingsView());
  });
});

route("DELETE /api/v1/payroll/settings/versions/:effective_from", (req) => {
  if (!configures(req.user!)) return notConfigurer();
  return removeVersion(SETTINGS, () => true, req.params.effective_from);
});

/* Statutory rates */

const ITEMS: StatutoryRate["item"][] = ["paye", "pension_employee", "pension_employer", "nhf", "itf", "nsitf", "relief"];
const ORDER: StatutoryRate["item"][] = ["paye", "pension_employee", "pension_employer", "nhf", "relief", "itf", "nsitf"];
const byItem = (a: StatutoryRate, b: StatutoryRate) =>
  ORDER.indexOf(a.item) - ORDER.indexOf(b.item) || a.effective_from.localeCompare(b.effective_from) || (a.position ?? 0) - (b.position ?? 0);

function brief(item: StatutoryRate["item"], rows: StatutoryRate[]): StatutoryItemState["current"] {
  const mine = rows.filter((r) => r.item === item);
  if (!mine.length) return null;
  const r = mine[0];
  return {
    rate: item === "paye" ? null : r.rate,
    flat_amount: item === "relief" ? r.flat_amount : null,
    base: r.base,
    bands: item === "paye" ? mine.length : null,
    effective_from: r.effective_from,
    ...sourceOf(r),
  };
}

/** A version's legal source, every column, as the API reads it back. */
const sourceOf = (r: StatutorySource): StatutorySource => ({
  source_title: r.source_title,
  source_section: r.source_section,
  source_url: r.source_url,
  source_document_id: r.source_document_id,
  source_checked_on: r.source_checked_on,
  no_legal_source: r.no_legal_source,
  no_source_reason: r.no_source_reason,
});

route("GET /api/v1/statutory/items", (req) => {
  if (!canRun(req.user!)) return forbiddenRead();
  const day = todayIso();
  const items: StatutoryItemState[] = ITEMS.map((item) => {
    const later = RATES.filter((r) => r.item === item && r.effective_from > day).sort(byItem);
    const first = later[0]?.effective_from;
    return {
      item,
      kind: statutorySchemas.ITEM_KIND[item] as StatutoryItemState["kind"],
      bases: [...statutorySchemas.ITEM_BASES[item]] as StatutoryItemState["bases"],
      current: brief(item, RATES.filter((r) => inForce(r, day)).sort(byItem)),
      next: brief(item, later.filter((r) => r.effective_from === first)),
    };
  });
  return ok({ items });
});

route("GET /api/v1/statutory/rates", (req) => {
  if (!canRun(req.user!)) return forbiddenRead();
  const day = todayIso();
  return paged(
    RATES.filter((r) => (req.query.as_of ? inForce(r, req.query.as_of) : fromToday(r, day))),
    { ...req, query: Object.fromEntries(Object.entries(req.query).filter(([k]) => k !== "as_of")) },
    { filters: { item: (r, v) => r.item === v }, sort: { item: byItem, effective_from: (a, b) => a.effective_from.localeCompare(b.effective_from) } },
  );
});

type RatesSave = {
  item: StatutoryRate["item"];
  effective_from: string;
  base?: StatutoryRate["base"];
  rate?: string;
  flat_amount?: string;
  bands?: Array<{ band_from: string; band_to: string | null; rate: string }>;
  source_title?: string;
  source_section?: string;
  source_url?: string;
  source_document_id?: string;
  source_checked_on?: string;
  no_legal_source?: boolean;
  no_source_reason?: string;
};

route("POST /api/v1/statutory/rates", (req) => {
  if (!configures(req.user!)) return notConfigurer();
  return checked<RatesSave>(statutorySchemas.StatutoryRatesSave, req.body, (b) => {
    if (b.effective_from < todayIso()) return tooEarly();
    if (b.source_checked_on && b.source_checked_on > todayIso())
      return fail(422, "CHECKED_IN_THE_FUTURE", "The day checked is today or earlier", { source_checked_on: ["Not after today"] });
    const kind = statutorySchemas.ITEM_KIND[b.item] as StatutoryRate["kind"];
    const base = (b.base ?? statutorySchemas.ITEM_BASES[b.item][0]) as StatutoryRate["base"];
    const source: StatutorySource = b.no_legal_source
      ? { source_title: null, source_section: null, source_url: null, source_document_id: null, source_checked_on: null, no_legal_source: true, no_source_reason: b.no_source_reason ?? null }
      : {
          source_title: b.source_title ?? null,
          source_section: b.source_section ?? null,
          source_url: b.source_url ?? null,
          source_document_id: b.source_document_id ?? null,
          source_checked_on: b.source_checked_on ?? null,
          no_legal_source: false,
          no_source_reason: null,
        };
    const common = { item: b.item, kind, base, effective_from: b.effective_from, effective_to: null, ...source, created_by_name: operatorName(req.user!), created_at: now() };
    const rows: StatutoryRate[] =
      b.item === "paye"
        ? (b.bands ?? []).map((band, i) => ({ ...common, statutory_rate_id: sid(`rate:paye:${b.effective_from}:${i}`), rate: band.rate, band_from: band.band_from, band_to: band.band_to, flat_amount: null, position: i + 1 }))
        : [{ ...common, statutory_rate_id: sid(`rate:${b.item}:${b.effective_from}`), rate: b.rate ?? "0", band_from: null, band_to: null, flat_amount: b.item === "relief" ? (b.flat_amount ?? "0.00") : null, position: null }];
    const refused = addVersion(RATES, (r) => r.item === b.item, b.effective_from, rows);
    if (refused) return refused;
    return created({ data: rows, page: { number: 1, size: __CONTRACT_PAGE_SIZE__, total: rows.length, pages: 1, has_next: false } });
  });
});

route("DELETE /api/v1/statutory/rates/:item/versions/:effective_from", (req) => {
  if (!configures(req.user!)) return notConfigurer();
  return checked<{ item: StatutoryRate["item"]; effective_from: string }>(statutorySchemas.StatutoryVersionParams, req.params, (p) =>
    removeVersion(RATES, (r) => r.item === p.item, p.effective_from, { advancedOnly: true }),
  );
});

/* Salary structure */

const gradeOf = (id: string) => GRADE_ROWS.find((g) => g.salary_grade_id === id);
const bandOn = (code: string, day: string) => GRADE_ROWS.find((g) => g.code === code && inForce(g, day)) ?? null;

function placementOf(p: (typeof PEOPLE)[number], day: string): GradePlacement {
  const placed = PLACES.find((x) => x.employee_id === p.employee_id && inForce(x, day)) ?? null;
  const band = placed ? bandOn(gradeOf(placed.salary_grade_id)?.code ?? "", day) : null;
  const gross = Number(p.gross_monthly);
  const position: GradePlacement["band_position"] = !band ? null : gross < Number(band.minimum) ? "below" : gross > Number(band.maximum) ? "above" : "within";
  return {
    employee: ref(p)!,
    gross_pay: p.gross_monthly,
    salary_grade_id: band?.salary_grade_id ?? null,
    grade_code: band?.code ?? null,
    grade_name: band?.name ?? null,
    band_position: position,
    effective_from: placed?.effective_from ?? null,
    has_pay_split: SPLITS.some((s) => s.employee_id === p.employee_id && inForce(s, day)),
  };
}

function gradeView(g: GradeRow, day: string): SalaryGrade {
  const placed = PEOPLE.map((p) => placementOf(p, day)).filter((x) => x.grade_code === g.code);
  return {
    salary_grade_id: g.salary_grade_id,
    code: g.code,
    name: g.name,
    band_minimum: g.minimum,
    band_maximum: g.maximum,
    effective_from: g.effective_from,
    effective_to: g.effective_to,
    staff: placed.length,
    below_minimum: placed.filter((x) => x.band_position === "below").length,
    above_maximum: placed.filter((x) => x.band_position === "above").length,
    created_at: g.created_at,
  };
}

const structureGuard = (u: string) => (!canRun(u) ? forbiddenRead() : !hasBeenOn() ? advancedOff() : null);

route("GET /api/v1/salary-structure/grades", (req) => {
  const refused = structureGuard(req.user!);
  if (refused) return refused;
  const day = todayIso();
  return paged(
    GRADE_ROWS.filter((g) => (req.query.as_of ? inForce(g, req.query.as_of) : fromToday(g, day))).map((g) => gradeView(g, day)),
    { ...req, query: Object.fromEntries(Object.entries(req.query).filter(([k]) => k !== "as_of")) },
    {
      sort: {
        minimum: (a, b) => kobo(a.band_minimum ?? "0") - kobo(b.band_minimum ?? "0"),
        code: (a, b) => a.code.localeCompare(b.code),
        name: (a, b) => a.name.localeCompare(b.name),
      },
    },
  );
});

type GradeSave = { code: string; name: string; minimum: string; maximum: string; effective_from: string };

route("POST /api/v1/salary-structure/grades", (req) => {
  if (!configures(req.user!)) return notConfigurer();
  if (!hasBeenOn()) return advancedOff();
  return checked<GradeSave>(salarySchemas.SalaryGradeSave, req.body, (b) => {
    if (b.effective_from < todayIso()) return tooEarly();
    const row: GradeRow = { salary_grade_id: sid(`grade:${b.code}:${b.effective_from}`), code: b.code, name: b.name, minimum: b.minimum, maximum: b.maximum, effective_from: b.effective_from, effective_to: null, created_at: now() };
    return addVersion(GRADE_ROWS, (g) => g.code === b.code, b.effective_from, [row]) ?? created(gradeView(row, todayIso()));
  });
});

route("GET /api/v1/salary-structure/placements", (req) => {
  const refused = structureGuard(req.user!);
  if (refused) return refused;
  const day = todayIso();
  return paged(
    PEOPLE.map((p) => placementOf(p, day)),
    req,
    {
      search: (x) => [x.employee.display_name],
      filters: {
        salary_grade_id: (x, v) => x.grade_code !== null && x.grade_code === (gradeOf(v)?.code ?? ""),
        band_position: (x, v) => (v === "unplaced" ? x.grade_code === null : x.band_position === v),
      },
      sort: {
        employee: (a, b) => a.employee.display_name.localeCompare(b.employee.display_name),
        grade: (a, b) => (a.grade_code ?? "~").localeCompare(b.grade_code ?? "~"),
      },
    },
  );
});

route("PUT /api/v1/salary-structure/placements/:employee_id", (req) => {
  if (!configures(req.user!)) return notConfigurer();
  if (!hasBeenOn()) return advancedOff();
  const p = byId(req.params.employee_id);
  if (!p) return notFound();
  return checked<{ salary_grade_id: string; effective_from: string }>(salarySchemas.GradePlacementSave, req.body, (b) => {
    if (b.effective_from < todayIso()) return tooEarly();
    const grade = gradeOf(b.salary_grade_id);
    if (!grade) return invalid({ salary_grade_id: ["No such grade"] });
    const band = bandOn(grade.code, b.effective_from);
    if (!band) return fail(422, "GRADE_NOT_IN_FORCE", "That grade has no band on this date", { salary_grade_id: ["No band that day"] });
    const row: PlaceRow = { employee_id: p.employee_id, salary_grade_id: band.salary_grade_id, effective_from: b.effective_from, effective_to: null };
    return addVersion(PLACES, (x) => x.employee_id === p.employee_id, b.effective_from, [row]) ?? ok(placementOf(p, todayIso()));
  });
});

function splitView(p: (typeof PEOPLE)[number]): PayComponentSet {
  const day = todayIso();
  const of = (rows: SplitRow[]) =>
    rows.length
      ? { effective_from: rows[0].effective_from, effective_to: rows[0].effective_to, components: rows.map((r) => ({ code: r.code, label: r.label, pay_amount: r.amount, pensionable: r.pensionable, effective_from: r.effective_from, effective_to: r.effective_to })) }
      : null;
  const mine = SPLITS.filter((s) => s.employee_id === p.employee_id);
  const later = mine.filter((s) => s.effective_from > day).sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  return {
    employee: ref(p)!,
    gross_pay: p.gross_monthly,
    current: of(mine.filter((s) => inForce(s, day))),
    next: of(later.filter((s) => s.effective_from === later[0]?.effective_from)),
  };
}

route("GET /api/v1/salary-structure/employees/:employee_id/components", (req) => {
  const refused = structureGuard(req.user!);
  if (refused) return refused;
  const p = byId(req.params.employee_id);
  return p ? ok(splitView(p)) : notFound();
});

type SplitSave = { effective_from: string; components: Array<{ code: string; label: string; amount: string; pensionable: boolean }> };

route("PUT /api/v1/salary-structure/employees/:employee_id/components", (req) => {
  if (!configures(req.user!)) return notConfigurer();
  if (!hasBeenOn()) return advancedOff();
  const p = byId(req.params.employee_id);
  if (!p) return notFound();
  return checked<SplitSave>(salarySchemas.PayComponentsSave, req.body, (b) => {
    if (b.effective_from < todayIso()) return tooEarly();
    if (b.components.reduce((a, c) => a + kobo(c.amount), 0) !== kobo(p.gross_monthly))
      return fail(422, "SPLIT_NOT_GROSS", "The components must add up to the monthly gross", { components: ["Must equal the gross"] });
    const rows: SplitRow[] = b.components.map((c) => ({ employee_id: p.employee_id, ...c, effective_from: b.effective_from, effective_to: null }));
    return addVersion(SPLITS, (s) => s.employee_id === p.employee_id, b.effective_from, rows) ?? ok(splitView(p));
  });
});
