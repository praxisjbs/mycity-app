import type {
  ApprovalInstance,
  Budget,
  BudgetChange,
  Disbursement,
  ExpenseCategory,
  ExpenseHistoryEntry,
  ExpenseRequest,
  ExpenseRow,
  ProjectSpend,
  Requisition,
} from "@mycity/contract/contract.gen.ts";
import { at, created, fail, invalid, isoDaysAgo, notFound, ok, paged, route, sid } from "../core";
import { byKey, refKey, SIGN_INS, teamOf } from "../data/people";
import { CATEGORY_NAMES, PROJECT_NAMES, SEED, type SeedRequest } from "../data/expenses";
import { UPLOADS } from "../uploads";
import { sendBackPayrollRun } from "./payroll";

/*
 * Expenses on the contract's paths and shapes (docs/guides/expenses.md §5): requests and their
 * approval, requisitions, disbursements, budgets, projects and categories. The approval's own
 * routes (/workflow/instances/:id/...) reach here through organisation.ts's decide chain.
 */

type Status = ExpenseRow["status"];
type Stage = "line_manager" | "operations_people" | "ceo";
interface Line { id: string; description: string; quantity: string; unit_price: string; amount: string }
interface Req {
  id: string; number: string; requester: string; department: string; category_id: string; project_id: string | null;
  purpose: string; lines: Line[]; amount: string; status: Status; payee_type: ExpenseRow["payee_type"]; uses_profile_account: boolean;
  payee_name: string | null; bank_name: string | null; account_name: string | null; account_number: string | null;
  invoice: ExpenseRequest["invoice"]; wid: string | null; stage: Stage | null; requisition_id: string | null; over_budget: boolean;
  submitted_at: string | null; approved_at: string | null; authorised_at: string | null; disbursed_at: string | null;
  rejected_at: string | null; cancelled_at: string | null; created_at: string; trail: ExpenseHistoryEntry[];
}
interface Req2 { id: string; number: string; by: string; status: Requisition["status"]; wid: string; submitted_at: string; approved_at: string | null; rejected_at: string | null }
interface Pay extends Omit<Disbursement, "request_number" | "purpose" | "reference_missing"> { by: string }
interface Cat { id: string; name: string; type: ExpenseCategory["type"]; description: string | null; active: boolean; created_at: string }
interface BLine { id: string; category_id: string; amount: string }
interface Bud { id: string; number: string; department: string; year: number; lines: BLine[]; changes: BudgetChange[]; approved_at: string }

/* Money in kobo, never in floating point. */
const k = (m: string | null) => Math.round(Number(m ?? "0") * 100);
const m = (kobo: number) => `${kobo < 0 ? "-" : ""}${Math.trunc(Math.abs(kobo) / 100)}.${String(Math.abs(kobo) % 100).padStart(2, "0")}`;
const now = () => new Date().toISOString();
const isOps = (u: string) => SIGN_INS[u]?.view === "operations";
const isCeo = (u: string) => SIGN_INS[u]?.view === "ceo";
const finance = (u: string) => isOps(u) || isCeo(u);
const name = (u: string) => byKey(u)?.display_name ?? "Someone";
const deptId = (dept: string) => sid(`dept:${dept}`);
const projectId = (i: number) => sid(`project:${i}`);

const CATS: Cat[] = [];
const REQS: Req[] = [];
const REQNS: Req2[] = [];
const PAYS: Pay[] = [];
const BUDS: Bud[] = [];
const PROJECT_BUDGETS = new Map<string, string | null>();
const n = { exp: 0, req: 0, dsb: 0, bud: 0 };

const catOf = (id: string) => CATS.find((c) => c.id === id);
const pad = (x: number) => String(x).padStart(4, "0");
const year = () => Number(isoDaysAgo(0).slice(0, 4));
const linesOf = (input: Array<{ description: string; quantity?: string; unit_price: string }>): Line[] =>
  input.map((l, i) => {
    const q = l.quantity || "1";
    return { id: sid(`line:${Math.random()}:${i}`), description: l.description, quantity: q, unit_price: l.unit_price, amount: m(Math.round(Number(q) * k(l.unit_price))) };
  });

/* ------------------------------------------------------------------ *
 * Budgets: committed and spent from the requests, never kept
 * ------------------------------------------------------------------ */

const COMMITTED: Status[] = ["approved", "in_requisition", "authorised"];
const budgetOf = (r: Pick<Req, "department" | "submitted_at" | "created_at">) =>
  BUDS.find((b) => b.department === r.department && b.year === Number((r.submitted_at ?? r.created_at).slice(0, 4)));
const lineOf = (r: Req) => budgetOf(r)?.lines.find((l) => l.category_id === r.category_id);
const lineFigures = (b: Bud, l: BLine) => {
  const on = REQS.filter((r) => r.department === b.department && r.category_id === l.category_id && budgetOf(r) === b);
  const committed = on.filter((r) => COMMITTED.includes(r.status)).reduce((a, r) => a + k(r.amount), 0);
  const spent = on.filter((r) => r.status === "disbursed").reduce((a, r) => a + k(r.amount), 0);
  return { committed, spent, remaining: k(l.amount) - committed - spent };
};
const remainingOf = (r: Req) => {
  const b = budgetOf(r);
  const l = lineOf(r);
  return { line: b && l ? lineFigures(b, l).remaining : null, dept: b ? b.lines.reduce((a, x) => a + lineFigures(b, x).remaining, 0) : null };
};
const flag = (r: Req) => {
  const left = remainingOf(r).line;
  return left === null || k(r.amount) > left;
};

/* ------------------------------------------------------------------ *
 * A request as the wire carries it
 * ------------------------------------------------------------------ */

const STAGE_NAME: Record<Stage, string> = { line_manager: "Line Manager", operations_people: "Operations & People", ceo: "CEO" };
const reqnOf = (r: Req) => REQNS.find((x) => x.id === r.requisition_id);
const waitingOn = (r: Req): string | null =>
  r.status === "submitted" ? STAGE_NAME[r.stage ?? "line_manager"] : r.status === "sent_back" ? "Requester" : r.status === "in_requisition" ? "CEO" : r.status === "approved" || r.status === "authorised" ? "Operations & People" : null;
const row = (r: Req): ExpenseRow => ({
  expense_request_id: r.id, number: r.number, purpose: r.purpose, amount: r.amount, status: r.status, waiting_on: waitingOn(r),
  category: catOf(r.category_id)?.name ?? "Other", project: r.project_id ? projectName(r.project_id) : null,
  requester: refKey(r.requester), payee_type: r.payee_type, over_budget: r.over_budget, submitted_at: r.submitted_at,
});
function projectName(id: string): string | null {
  const i = PROJECT_NAMES.findIndex((_, x) => projectId(x) === id);
  return i < 0 ? null : PROJECT_NAMES[i];
}
const deciderOf = (r: Req): string | null =>
  r.status === "submitted" ? (r.stage === "line_manager" ? byKey(r.requester)?.manager ?? "ifeoma" : "cynthia") : r.status === "in_requisition" ? "ifeoma" : null;
const sees = (u: string, r: Req) => r.requester === u || finance(u) || byKey(r.requester)?.manager === u || deciderOf(r) === u;
function detail(r: Req, u: string): ExpenseRequest {
  const left = remainingOf(r);
  const own = r.requester === u;
  const all = REQS.filter((o) => o !== r && o.status !== "draft" && r.status !== "draft" && o.amount === r.amount && (o.account_number ?? o.payee_name) === (r.account_number ?? r.payee_name) && o.submitted_at && Math.abs(Date.parse(o.submitted_at) - Date.parse(r.submitted_at ?? now())) <= 30 * 86400000).slice(0, 5);
  // The server names only the requests this reader could open; the rest are a count (audit F8).
  const dupes = all.filter((o) => o.requester === u || finance(u) || deciderOf(o) === u);
  return {
    ...row(r), expense_category_id: r.category_id, project_id: r.project_id, department_id: deptId(r.department), department: r.department, currency: "NGN",
    lines: r.lines.map((l, i) => ({ expense_request_line_id: l.id, position: i + 1, description: l.description, quantity: l.quantity, unit_price: l.unit_price, amount: l.amount })),
    payee_name: r.payee_name, bank_name: r.bank_name, account_name: r.account_name,
    account_number: own || finance(u) || !r.account_number ? r.account_number : `••••••${r.account_number.slice(-4)}`,
    uses_profile_account: r.uses_profile_account, invoice: r.invoice, needed_on: null, requisition_id: r.requisition_id, requisition_number: reqnOf(r)?.number ?? null,
    workflow_instance_id: r.wid, budget_remaining: left.line === null ? null : m(left.line), department_remaining: left.dept === null ? null : m(left.dept),
    possible_duplicates_hidden: all.length - dupes.length,
    possible_duplicates: dupes.map((o) => ({ expense_request_id: o.id, number: o.number, purpose: o.purpose, amount: o.amount, status: o.status, submitted_at: o.submitted_at })),
    can_edit: own && (r.status === "draft" || r.status === "sent_back"),
    can_cancel: (own && ["draft", "sent_back", "submitted"].includes(r.status)) || (finance(u) && COMMITTED.includes(r.status)),
    approved_at: r.approved_at, authorised_at: r.authorised_at, disbursed_at: r.disbursed_at, rejected_at: r.rejected_at, cancelled_at: r.cancelled_at, created_at: r.created_at,
  };
}
const note = (r: Req, action: string, label: string, by: string | null, reason: string | null = null) => r.trail.unshift({ at: now(), action, label, by: by ? name(by) : null, reason });

/* ------------------------------------------------------------------ *
 * The moves, as the services make them
 * ------------------------------------------------------------------ */

function send(r: Req, by: string) {
  const p = byKey(r.requester);
  r.status = "submitted";
  r.stage = teamOf(r.requester).length > 0 ? "operations_people" : "line_manager";
  if (r.stage === "line_manager" && !p?.manager) r.stage = "operations_people";
  r.wid = sid(`wf:${r.id}:${Math.random()}`);
  r.submitted_at = now();
  r.over_budget = flag(r);
  note(r, "expense_request.submitted", "Sent for approval", by);
}
function approveRequest(r: Req, by: string) {
  if (r.stage === "line_manager") {
    r.stage = "operations_people";
    note(r, "workflow.advanced", "Approved, on to the next stage", by);
    return;
  }
  r.status = "approved";
  r.stage = null;
  r.approved_at = now();
  note(r, "expense_request.approved", "Approved by Operations & People", by);
  for (const o of REQS) if (o.status === "submitted") o.over_budget = flag(o);
}
function raise(seed: SeedRequest) {
  n.exp += 1;
  const r: Req = {
    id: sid(`expense:${seed.purpose}`), number: `EXP-${pad(n.exp)}`, requester: seed.by, department: seed.department, category_id: sid(`category:${seed.category}`),
    project_id: seed.project === null ? null : projectId(seed.project), purpose: seed.purpose, lines: linesOf(seed.lines.map(([description, quantity, unit_price]) => ({ description, quantity, unit_price }))),
    amount: "0.00", status: "draft", payee_type: seed.payee, uses_profile_account: seed.payee === "staff", payee_name: seed.payee === "staff" ? name(seed.by) : seed.name,
    bank_name: seed.bank, account_name: seed.payee === "staff" ? name(seed.by) : seed.name, account_number: seed.account, invoice: null, wid: null, stage: null,
    requisition_id: null, over_budget: false, submitted_at: null, approved_at: null, authorised_at: null, disbursed_at: null, rejected_at: null, cancelled_at: null,
    created_at: at(seed.ago + 1, "09:00"), trail: [],
  };
  r.amount = m(r.lines.reduce((a, l) => a + k(l.amount), 0));
  if (seed.invoice) r.invoice = { document_id: sid(`invoice:${seed.purpose}`), file_name: `${r.number.toLowerCase()}-invoice.pdf`, size_bytes: 412 * 1024, mime_type: "application/pdf" };
  note(r, "expense_request.created", "Saved as a draft", seed.by);
  REQS.unshift(r);
  return r;
}

/* ------------------------------------------------------------------ *
 * The demonstration data, walked through the moves (as 80_expenses.js does on staging)
 * ------------------------------------------------------------------ */

CATEGORY_NAMES.forEach(([nm, type], i) => CATS.push({ id: sid(`category:${nm}`), name: nm, type, description: null, active: true, created_at: at(40 - i, "09:00") }));
for (const [dept, lines] of SEED.budgets) {
  n.bud += 1;
  BUDS.push({ id: sid(`budget:${dept}`), number: `BUD-${year()}-${pad(n.bud)}`, department: dept, year: year(), approved_at: at(30, "10:00"), changes: [],
    lines: lines.map(([cat, amount]) => ({ id: sid(`bline:${dept}:${cat}`), category_id: sid(`category:${cat}`), amount })) });
  const b = BUDS[BUDS.length - 1];
  b.changes = b.lines.map((l) => ({ at: b.approved_at, by: name("cynthia"), category: catOf(l.category_id)?.name ?? null, before: null, after: l.amount }));
}
PROJECT_NAMES.forEach((_, i) => PROJECT_BUDGETS.set(projectId(i), SEED.projectBudgets[i] ?? null));
const toGroup: Req[] = [];
const toAuthorise: Array<{ r: Req; seed: SeedRequest }> = [];
for (const seed of SEED.requests) {
  const r = raise(seed);
  if (seed.walk === "draft") continue;
  send(r, seed.by);
  if (seed.walk === "with_manager") continue;
  if (seed.walk === "sent_back" || seed.walk === "rejected") {
    const by = byKey(seed.by)?.manager ?? "cynthia";
    if (seed.walk === "sent_back") Object.assign(r, { status: "sent_back", stage: null });
    else Object.assign(r, { status: "rejected", stage: null, rejected_at: now() });
    note(r, seed.walk === "sent_back" ? "expense_request.sent_back" : "expense_request.rejected", seed.walk === "sent_back" ? "Sent back to the requester" : "Rejected", by, seed.reason ?? null);
    continue;
  }
  if (r.stage === "line_manager") approveRequest(r, byKey(seed.by)?.manager ?? "ifeoma");
  if (seed.walk === "with_operations") continue;
  approveRequest(r, "cynthia");
  if (seed.walk === "in_requisition") toGroup.push(r);
  else if (seed.walk !== "approved") toAuthorise.push({ r, seed });
}
function group(rs: Req[], by: string): Req2 {
  n.req += 1;
  const q: Req2 = { id: sid(`requisition:${n.req}`), number: `REQ-${pad(n.req)}`, by, status: "submitted", wid: sid(`wf:requisition:${n.req}`), submitted_at: now(), approved_at: null, rejected_at: null };
  REQNS.unshift(q);
  for (const r of rs) {
    Object.assign(r, { status: "in_requisition", requisition_id: q.id });
    note(r, "requisition.submitted", "Put in a requisition for the CEO", by);
  }
  return q;
}
function settleRequisition(q: Req2, approve: boolean, by: string, reason: string | null) {
  q.status = approve ? "approved" : "rejected";
  q[approve ? "approved_at" : "rejected_at"] = now();
  for (const r of REQS.filter((x) => x.requisition_id === q.id && x.status === "in_requisition")) {
    if (approve) Object.assign(r, { status: "authorised", authorised_at: now() });
    else Object.assign(r, { status: "approved", requisition_id: null });
    note(r, approve ? "requisition.approved" : "requisition.rejected", approve ? "Authorised by the CEO" : "Requisition rejected by the CEO", by, reason);
  }
}
function pay(r: Req, by: string, reference: string | null, paidOn: string, receipt: Disbursement["receipt"] = null): Pay {
  n.dsb += 1;
  const d: Pay = {
    disbursement_id: sid(`disbursement:${r.id}`), number: `DSB-${pad(n.dsb)}`, expense_request_id: r.id, recipient_type: r.payee_type, recipient_name: r.payee_name ?? name(r.requester),
    bank_name: r.bank_name, account_name: r.account_name, account_number: r.account_number, amount: r.amount, payment_reference: reference, receipt, paid_on: paidOn,
    paid_at: now(), processed_by: name(by), by,
  };
  PAYS.unshift(d);
  Object.assign(r, { status: "disbursed", disbursed_at: now() });
  note(r, "disbursement.recorded", "Paid", by);
  return d;
}
if (toAuthorise.length) {
  const q = group(toAuthorise.map((x) => x.r), "cynthia");
  settleRequisition(q, true, "ifeoma", null);
  toAuthorise.filter((x) => x.seed.walk === "paid").forEach((x, i) => pay(x.r, "cynthia", x.seed.reference ?? null, isoDaysAgo(i + 1)));
}
if (toGroup.length) group(toGroup, "cynthia");

/* ------------------------------------------------------------------ *
 * Requests
 * ------------------------------------------------------------------ */

const LIST_FILTERS = {
  status: (r: ExpenseRow, v: string) => r.status === v,
  expense_category_id: (r: ExpenseRow, v: string) => find(r.expense_request_id)?.category_id === v,
  project_id: (r: ExpenseRow, v: string) => find(r.expense_request_id)?.project_id === v,
  department_id: (r: ExpenseRow, v: string) => deptId(find(r.expense_request_id)?.department ?? "") === v,
  payee_type: (r: ExpenseRow, v: string) => r.payee_type === v,
  over_budget: (r: ExpenseRow, v: string) => String(r.over_budget) === v,
  in_flight: (r: ExpenseRow, v: string) => String(["submitted", "sent_back", ...COMMITTED].includes(r.status)) === v,
};
const SORT = {
  submitted_at: (a: ExpenseRow, b: ExpenseRow) => String(a.submitted_at).localeCompare(String(b.submitted_at)),
  amount: (a: ExpenseRow, b: ExpenseRow) => k(a.amount) - k(b.amount),
  number: (a: ExpenseRow, b: ExpenseRow) => a.number.localeCompare(b.number),
  created_at: (a: ExpenseRow, b: ExpenseRow) => String(find(a.expense_request_id)?.created_at).localeCompare(String(find(b.expense_request_id)?.created_at)),
};
const list = (rows: Req[], req: Parameters<typeof paged>[1]) =>
  paged(rows.map(row), req, {
    search: (r) => [r.number, r.purpose, r.requester.display_name, r.category],
    filters: {
      ...LIST_FILTERS,
      disbursed_from: (r: ExpenseRow, v: string) => r.status === "disbursed" && String(find(r.expense_request_id)?.disbursed_at).slice(0, 10) >= v,
      approved_by_me_from: (r: ExpenseRow, v: string) =>
        !!find(r.expense_request_id)?.trail.some((t) => (t.action === "expense_request.approved" || t.action === "workflow.advanced") && t.by === name(String(req.user)) && t.at.slice(0, 10) >= v),
    },
    sort: SORT,
  });
const find = (id: string) => REQS.find((r) => r.id === id);
const mine = (u: string) => REQS.filter((r) => r.requester === u);

route("GET /api/v1/expenses/mine", (req) => list(mine(req.user!), req));
route("GET /api/v1/expenses/mine/summary", (req) => {
  const own = mine(req.user!);
  const y = String(year());
  const paid = own.filter((r) => r.status === "disbursed" && r.disbursed_at?.startsWith(y));
  const days = paid.map((r) => (Date.parse(r.disbursed_at!) - Date.parse(r.submitted_at!)) / 86400000);
  return ok({
    in_flight: own.filter((r) => ["submitted", "sent_back", ...COMMITTED].includes(r.status)).length,
    disbursed_this_year: m(paid.reduce((a, r) => a + k(r.amount), 0)),
    average_turnaround_days: days.length ? Math.round((days.reduce((a, d) => a + d, 0) / days.length) * 10) / 10 : null,
    rejected: own.filter((r) => r.status === "rejected").length,
  });
});
/* The Bank field's suggestions: the common banks (expenses.service COMMON_BANKS) and every bank a request names. */
const COMMON_BANKS = [
  "Access Bank", "Citibank", "Ecobank", "Fidelity Bank", "First Bank", "FCMB", "Globus Bank", "GTBank", "Jaiz Bank",
  "Keystone Bank", "Kuda", "Moniepoint", "Opay", "PalmPay", "Polaris Bank", "Providus Bank", "Stanbic IBTC",
  "Standard Chartered", "Sterling Bank", "Union Bank", "UBA", "Unity Bank", "Wema Bank", "Zenith Bank",
];
route("GET /api/v1/expenses/banks", (req) => {
  const uses = new Map<string, { bank_name: string; uses: number }>();
  for (const b of COMMON_BANKS) uses.set(b.toLowerCase(), { bank_name: b, uses: 0 });
  for (const r of REQS) {
    const b = r.bank_name?.trim();
    if (!b) continue;
    const had = uses.get(b.toLowerCase());
    uses.set(b.toLowerCase(), { bank_name: had?.bank_name ?? b, uses: (had?.uses ?? 0) + 1 });
  }
  const rows = [...uses.values()].sort((a, b) => b.uses - a.uses || a.bank_name.localeCompare(b.bank_name));
  return paged(rows, req, { search: (b) => [b.bank_name] });
});
route("GET /api/v1/expenses", (req) => list(REQS.filter((r) => r.status !== "draft" && sees(req.user!, r)), req));
route("GET /api/v1/expenses/approvals", (req) => list(REQS.filter((r) => r.status === "submitted" && deciderOf(r) === req.user && r.requester !== req.user), req));
route("GET /api/v1/expenses/approvals/summary", (req) => {
  const waiting = REQS.filter((r) => r.status === "submitted" && deciderOf(r) === req.user && r.requester !== req.user);
  return ok({
    with_you: waiting.length,
    total_value: m(waiting.reduce((a, r) => a + k(r.amount), 0)),
    oldest_days: waiting.length ? Math.max(...waiting.map((r) => Math.floor((Date.now() - Date.parse(r.submitted_at!)) / 86400000))) : null,
    approved_this_month: REQS.filter((r) => r.trail.some((t) => (t.action === "expense_request.approved" || t.action === "workflow.advanced") && t.by === name(req.user!))).length,
  });
});
route("GET /api/v1/expenses/:id", (req) => {
  const r = find(req.params.id);
  return r && (r.status !== "draft" || r.requester === req.user) && sees(req.user!, r) ? ok(detail(r, req.user!)) : notFound();
});
route("GET /api/v1/expenses/:id/history", (req) => {
  const r = find(req.params.id);
  return r && sees(req.user!, r) ? paged(r.trail, req) : notFound();
});

type Body = { purpose?: string; expense_category_id?: string; project_id?: string | null; department_id?: string | null; lines?: Array<{ description: string; quantity?: string; unit_price: string }>; payee_type?: ExpenseRow["payee_type"]; uses_profile_account?: boolean; payee_name?: string | null; bank_name?: string | null; account_name?: string | null; account_number?: string | null; invoice_document_id?: string | null; submit?: boolean };
function check(b: Body) {
  const f: Record<string, string[]> = {};
  if (!b.purpose?.trim()) f.purpose = ["Required"];
  const c = b.expense_category_id ? catOf(b.expense_category_id) : null;
  if (!c) f.expense_category_id = ["Required"];
  else if (!c.active) f.expense_category_id = ["Not offered"];
  if (!b.lines?.length) f.lines = ["Add a line"];
  if (!b.payee_type) f.payee_type = ["Required"];
  return f;
}
function fill(r: Req, b: Body, u: string) {
  const dept = b.department_id ? [...new Set(REQS.map((x) => x.department)), ...BUDS.map((x) => x.department), byKey(u)?.department ?? ""].find((d) => deptId(d) === b.department_id) : null;
  Object.assign(r, {
    purpose: b.purpose!.trim(), category_id: b.expense_category_id!, project_id: b.project_id || null, department: dept ?? byKey(u)?.department ?? "Operations & People",
    lines: linesOf(b.lines!), payee_type: b.payee_type!, uses_profile_account: b.payee_type === "staff" && b.uses_profile_account === true,
  });
  r.amount = m(r.lines.reduce((a, l) => a + k(l.amount), 0));
  if (r.uses_profile_account) Object.assign(r, { payee_name: name(u), bank_name: byKey(u)?.bank_name ?? null, account_name: name(u), account_number: `00000${byKey(u)?.account_last4 ?? "0000"}0` });
  else Object.assign(r, { payee_name: b.payee_name || null, bank_name: b.bank_name || null, account_name: b.account_name || null, account_number: b.account_number || null });
  if (b.invoice_document_id) {
    const doc = UPLOADS.get(b.invoice_document_id);
    r.invoice = doc ?? r.invoice;
  }
}
const payeeMissing = (r: Req) => {
  const f: Record<string, string[]> = {};
  if (!r.uses_profile_account) for (const key of ["payee_name", "bank_name", "account_name", "account_number"] as const) if (!r[key]) f[key] = ["Required"];
  return f;
};
route("POST /api/v1/expenses/mine", (req) => {
  const b = req.body as Body;
  const f = check(b);
  if (Object.keys(f).length) return invalid(f);
  const r = raise({ purpose: b.purpose!, by: req.user!, department: byKey(req.user!)?.department ?? "Operations & People", category: catOf(b.expense_category_id!)!.name, project: null, payee: b.payee_type!, name: null, bank: null, account: null, lines: [], ago: -1, walk: "draft" });
  fill(r, b, req.user!);
  if (b.submit) {
    const missing = payeeMissing(r);
    if (Object.keys(missing).length) return invalid(missing);
    send(r, req.user!);
  }
  return created(detail(r, req.user!));
});
route("PATCH /api/v1/expenses/mine/:id", (req) => {
  const r = find(req.params.id);
  if (!r || r.requester !== req.user) return notFound();
  if (r.status !== "draft" && r.status !== "sent_back") return fail(409, "EXPENSE_NOT_EDITABLE", "Only a draft or a sent-back request is edited");
  const b = req.body as Body;
  const f = check(b);
  if (Object.keys(f).length) return invalid(f);
  fill(r, b, req.user!);
  note(r, "expense_request.updated", "Changed", req.user);
  return ok(detail(r, req.user!));
});
route("POST /api/v1/expenses/mine/:id/submit", (req) => {
  const r = find(req.params.id);
  if (!r || r.requester !== req.user) return notFound();
  if (r.status !== "draft" && r.status !== "sent_back") return fail(409, "EXPENSE_ALREADY_SENT", "This request was already sent");
  const missing = payeeMissing(r);
  if (Object.keys(missing).length) return invalid(missing);
  send(r, req.user!);
  return ok(detail(r, req.user!));
});
route("POST /api/v1/expenses/mine/:id/cancel", (req) => {
  const r = find(req.params.id);
  if (!r || r.requester !== req.user) return notFound();
  if (!["draft", "sent_back", "submitted"].includes(r.status)) return fail(409, "EXPENSE_NOT_CANCELLABLE", "Ask Operations & People to withdraw it");
  Object.assign(r, { status: "cancelled", stage: null, cancelled_at: now() });
  note(r, "expense_request.cancelled", "Cancelled", req.user, (req.body as { reason?: string })?.reason ?? null);
  return ok(detail(r, req.user!));
});
route("POST /api/v1/expenses/:id/withdraw", (req) => {
  const r = find(req.params.id);
  if (!r || !finance(req.user!)) return notFound();
  const reason = (req.body as { reason?: string })?.reason;
  if (!reason?.trim()) return invalid({ reason: ["Give a reason"] });
  if (!COMMITTED.includes(r.status)) return fail(409, "EXPENSE_NOT_WITHDRAWABLE", "Only an approved request not yet paid is withdrawn");
  Object.assign(r, { status: "cancelled", requisition_id: null, cancelled_at: now() });
  note(r, "expense_request.withdrawn", "Withdrawn", req.user, reason);
  return ok(detail(r, req.user!));
});
// The AI features answer as the API does with no provider set up: off (docs/guides/expenses.md §9).
route("POST /api/v1/expenses/mine/invoice-reading", () => ok({ available: false, reason: "off", payee_name: null, expense_category_id: null, category: null, lines: [], amount: null, ai_run_id: null }));
route("POST /api/v1/expenses/mine/category-suggestion", () => ok({ available: false, reason: "off", expense_category_id: null, category: null, ai_run_id: null }));
route("POST /api/v1/expenses/:id/duplicate-check", (req) => {
  const r = find(req.params.id);
  if (!r || !sees(req.user!, r)) return notFound();
  const none = detail(r, req.user!).possible_duplicates.length === 0;
  return ok({ available: false, reason: none ? "none" : "off", duplicate: null, explanation: null, ai_run_id: null });
});

/* ------------------------------------------------------------------ *
 * The approval's own routes, through organisation.ts's decide chain
 * ------------------------------------------------------------------ */

const byWid = (wid: string) => REQS.find((r) => r.wid === wid);
const reqnByWid = (wid: string) => REQNS.find((q) => q.wid === wid);

/** Approve or reject at the stage the reader is named on; null when the id is not an expense approval. */
export function decideExpense(user: string, wid: string, approve: boolean, reason?: string | null) {
  const q = reqnByWid(wid);
  if (q) {
    if (q.status !== "submitted") return fail(409, "REQUISITION_DECIDED", "This requisition was already decided");
    if (!isCeo(user)) return fail(403, "PERMISSION_DENIED", "You are not an approver for this stage");
    if (!approve && !String(reason ?? "").trim()) return invalid({ reason: ["is required"] });
    settleRequisition(q, approve, user, reason ?? null);
    return ok({ workflow_instance_id: wid, state: q.status, stage_name: null });
  }
  const r = byWid(wid);
  if (!r) return null;
  if (r.status !== "submitted" || deciderOf(r) !== user || r.requester === user) return fail(403, "PERMISSION_DENIED", "You are not an approver for this stage");
  if (!approve) {
    if (!String(reason ?? "").trim()) return invalid({ reason: ["is required"] });
    Object.assign(r, { status: "rejected", stage: null, rejected_at: now() });
    note(r, "expense_request.rejected", "Rejected", user, reason ?? null);
    return ok({ workflow_instance_id: wid, state: "rejected", stage_name: null });
  }
  approveRequest(r, user);
  return ok({ workflow_instance_id: wid, state: r.status === "submitted" ? "pending" : "approved", stage_name: r.stage ? STAGE_NAME[r.stage] : null });
}
route("POST /api/v1/workflow/instances/:id/request-changes", (req) => {
  const r = byWid(req.params.id);
  // Another module's approval sent back: a payroll run returns to Draft with the reason.
  if (!r) return sendBackPayrollRun(req.user!, req.params.id, (req.body as { reason?: string })?.reason) ?? notFound();
  if (r.status !== "submitted" || deciderOf(r) !== req.user) return fail(403, "PERMISSION_DENIED", "You are not an approver for this stage");
  const reason = (req.body as { reason?: string })?.reason;
  if (!reason?.trim()) return invalid({ reason: ["is required"] });
  Object.assign(r, { status: "sent_back", stage: null });
  note(r, "expense_request.sent_back", "Sent back to the requester", req.user, reason);
  return ok({ workflow_instance_id: r.wid, state: "cancelled", stage_name: null });
});

/** GET /workflow/instances/:id for a request or a requisition; null for any other id. */
export function expenseInstance(user: string, wid: string): ApprovalInstance | null {
  const q = reqnByWid(wid);
  const r = q ? null : byWid(wid);
  if (!q && !r) return null;
  if (r && !sees(user, r)) return null;
  const stages: Stage[] = q ? ["ceo"] : ["line_manager", "operations_people"];
  const pending = q ? q.status === "submitted" : r!.status === "submitted";
  const current: Stage | null = q ? (pending ? "ceo" : null) : pending ? r!.stage : null;
  const state = pending ? "pending" : q ? (q.status === "approved" ? "approved" : q.status === "rejected" ? "rejected" : "cancelled") : r!.status === "rejected" ? "rejected" : r!.status === "sent_back" || r!.status === "cancelled" ? "cancelled" : "approved";
  const opened = (q ? q.submitted_at : r!.submitted_at) ?? now();
  const who = r ? byKey(r.requester) : null;
  return {
    workflow_instance_id: wid, definition_key: q ? "expenses.requisition" : "expenses.request", definition_name: q ? "Requisition" : "Expense Request", version: 1, module_key: "expenses",
    entity_type: q ? "requisition" : "expense", entity_id: q ? q.id : r!.id, subject_employee_id: who?.employee_id ?? null, subject_name: who?.display_name ?? null,
    state, current_stage: current, stage_name: current ? STAGE_NAME[current] : null, context: {}, stage_entered_at: opened,
    stage_due_at: pending ? new Date(Date.parse(opened) + 48 * 3600000).toISOString() : null,
    opened_by: null, opened_by_name: q ? name(q.by) : who?.display_name ?? null, opened_at: opened, completed_at: pending ? null : now(),
    route: stages.map((key) => ({
      key, name: STAGE_NAME[key],
      state: !pending ? (state === "approved" ? "done" : "stopped") : key === current ? "now" : stages.indexOf(key) < stages.indexOf(current!) ? "done" : "todo",
      approvers: [key === "line_manager" ? { type: "manager_of_subject", value: null, label: "Line Manager" } : key === "ceo" ? { type: "ceo", value: null, label: "CEO" } : { type: "role", value: "operations_people", label: "Operations & People" }],
    })),
    decisions: [],
    can_decide: pending && (q ? isCeo(user) : deciderOf(r!) === user && r!.requester !== user),
    can_withdraw: false, can_reassign: false, link: q ? "/expenses?tab=requisitions" : "/expenses?tab=approvals",
  } as ApprovalInstance;
}

/* ------------------------------------------------------------------ *
 * Categories
 * ------------------------------------------------------------------ */

const month = () => isoDaysAgo(0).slice(0, 7);
const catOut = (c: Cat): ExpenseCategory => {
  const on = REQS.filter((r) => r.category_id === c.id && r.status !== "draft");
  return { expense_category_id: c.id, name: c.name, type: c.type, description: c.description, active: c.active, created_at: c.created_at, requests: on.length,
    spent_this_month: m(on.filter((r) => r.status === "disbursed" && r.disbursed_at?.startsWith(month())).reduce((a, r) => a + k(r.amount), 0)) };
};
route("GET /api/v1/expense-categories", (req) =>
  paged(CATS.map(catOut), req, {
    search: (c) => [c.name], filters: { active: (c, v) => String(c.active) === v, type: (c, v) => c.type === v },
    sort: { name: (a, b) => a.name.localeCompare(b.name), spent_this_month: (a, b) => k(a.spent_this_month) - k(b.spent_this_month), created_at: (a, b) => a.created_at.localeCompare(b.created_at) },
  }),
);
route("POST /api/v1/expense-categories", (req) => {
  if (!finance(req.user!)) return fail(403, "CAPABILITY_REQUIRED", "You cannot manage expense categories");
  const b = req.body as { name?: string; type?: Cat["type"]; description?: string | null };
  if (!b.name?.trim()) return invalid({ name: ["Required"] });
  if (CATS.some((c) => c.name.toLowerCase() === b.name!.trim().toLowerCase())) return fail(409, "CATEGORY_EXISTS", "A category of that name exists", { name: ["Already used"] });
  const c: Cat = { id: sid(`category:${b.name}`), name: b.name.trim(), type: b.type ?? "operating", description: b.description || null, active: true, created_at: now() };
  CATS.push(c);
  return created(catOut(c));
});
route("PATCH /api/v1/expense-categories/:id", (req) => {
  if (!finance(req.user!)) return fail(403, "CAPABILITY_REQUIRED", "You cannot manage expense categories");
  const c = catOf(req.params.id);
  if (!c) return notFound();
  const b = req.body as Partial<Cat> & { name?: string };
  if (b.name !== undefined) c.name = b.name.trim();
  if (b.type) c.type = b.type;
  if (b.description !== undefined) c.description = b.description || null;
  if (typeof b.active === "boolean") c.active = b.active;
  return ok(catOut(c));
});
route("POST /api/v1/expense-categories/suggested", (req) => {
  if (!finance(req.user!)) return fail(403, "CAPABILITY_REQUIRED", "You cannot manage expense categories");
  if (CATS.length) return fail(409, "CATEGORIES_EXIST", "Categories are already set up");
  CATEGORY_NAMES.forEach(([nm, type]) => CATS.push({ id: sid(`category:${nm}`), name: nm, type, description: null, active: true, created_at: now() }));
  return paged(CATS.map(catOut), { ...req, query: {} });
});

/* ------------------------------------------------------------------ *
 * Requisitions
 * ------------------------------------------------------------------ */

const reqnOut = (q: Req2, u: string): Requisition => {
  const items = REQS.filter((r) => r.requisition_id === q.id);
  return { requisition_id: q.id, number: q.number, status: q.status, requests: items.length, total_amount: m(items.reduce((a, r) => a + k(r.amount), 0)), requester: refKey(q.by),
    workflow_instance_id: q.wid, submitted_at: q.submitted_at, approved_at: q.approved_at, rejected_at: q.rejected_at, can_decide: q.status === "submitted" && isCeo(u) };
};
route("GET /api/v1/requisitions", (req) =>
  finance(req.user!)
    ? paged(REQNS.map((q) => reqnOut(q, req.user!)), req, { search: (q) => [q.number], filters: { status: (q, v) => q.status === v },
        sort: { submitted_at: (a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)), total_amount: (a, b) => k(a.total_amount) - k(b.total_amount), number: (a, b) => a.number.localeCompare(b.number) } })
    : fail(403, "CAPABILITY_REQUIRED", "You cannot open the requisitions"),
);
route("GET /api/v1/requisitions/:id", (req) => {
  const q = REQNS.find((x) => x.id === req.params.id);
  if (!q || !finance(req.user!)) return notFound();
  return ok({ ...reqnOut(q, req.user!), items: REQS.filter((r) => r.requisition_id === q.id).map(row) });
});
route("POST /api/v1/requisitions", (req) => {
  if (!finance(req.user!)) return fail(403, "CAPABILITY_REQUIRED", "You cannot group requests");
  const ids = [...new Set((req.body as { expense_request_ids?: string[] }).expense_request_ids ?? [])];
  if (!ids.length) return invalid({ expense_request_ids: ["Tick a request"] });
  const rs = ids.map(find);
  if (rs.some((r) => !r || r.status !== "approved")) return fail(409, "REQUEST_NOT_APPROVED", "Only approved requests not in a requisition are grouped", { expense_request_ids: ["Not waiting for a requisition"] });
  const q = group(rs as Req[], req.user!);
  return created({ ...reqnOut(q, req.user!), items: REQS.filter((r) => r.requisition_id === q.id).map(row) });
});
route("POST /api/v1/requisitions/:id/remove", (req) => {
  const q = REQNS.find((x) => x.id === req.params.id);
  if (!q) return notFound();
  if (q.status !== "submitted") return fail(409, "REQUISITION_DECIDED", "This requisition was already decided");
  if (!isCeo(req.user!)) return fail(403, "PERMISSION_DENIED", "Only the requisition's approver removes a request");
  const b = req.body as { expense_request_id?: string; reason?: string };
  if (!b.reason?.trim()) return invalid({ reason: ["Required"] });
  const r = b.expense_request_id ? find(b.expense_request_id) : null;
  if (!r || r.requisition_id !== q.id) return invalid({ expense_request_id: ["Not in it"] });
  Object.assign(r, { status: "approved", requisition_id: null });
  note(r, "requisition.request_removed", "Removed from its requisition by the CEO", req.user, b.reason);
  if (!REQS.some((x) => x.requisition_id === q.id)) q.status = "cancelled";
  return ok({ ...reqnOut(q, req.user!), items: REQS.filter((x) => x.requisition_id === q.id).map(row) });
});

/* ------------------------------------------------------------------ *
 * Disbursements
 * ------------------------------------------------------------------ */

const payOut = (d: Pay): Disbursement => {
  const r = find(d.expense_request_id)!;
  const { by: _by, ...rest } = d;
  return { ...rest, request_number: r.number, purpose: r.purpose, reference_missing: d.payment_reference === null };
};
route("GET /api/v1/disbursements", (req) =>
  finance(req.user!)
    ? paged(PAYS.map(payOut), req, { search: (d) => [d.number, d.request_number, d.payment_reference, d.recipient_name], filters: { reference_missing: (d, v) => String(d.reference_missing) === v },
        sort: { paid_at: (a, b) => String(b.paid_at).localeCompare(String(a.paid_at)), amount: (a, b) => k(a.amount) - k(b.amount), number: (a, b) => a.number.localeCompare(b.number) } })
    : fail(403, "CAPABILITY_REQUIRED", "You cannot open the disbursements"),
);
route("POST /api/v1/disbursements", (req) => {
  if (!finance(req.user!)) return fail(403, "CAPABILITY_REQUIRED", "You cannot record disbursements");
  const b = req.body as { expense_request_id?: string; payment_reference?: string | null; receipt_document_id?: string | null; paid_on?: string; confirm_without_reference?: boolean };
  if (!b.payment_reference && !b.receipt_document_id && b.confirm_without_reference !== true) return fail(422, "REFERENCE_REQUIRED", "Add the bank reference, or save without one", { payment_reference: ["Add the reference"] });
  if (!b.paid_on) return invalid({ paid_on: ["Required"] });
  const r = b.expense_request_id ? find(b.expense_request_id) : null;
  if (!r) return invalid({ expense_request_id: ["No such request"] });
  if (r.status === "disbursed") return fail(409, "ALREADY_DISBURSED", "This request is already paid");
  if (r.status !== "authorised") return invalid({ expense_request_id: ["Not authorised yet"] });
  const receipt = b.receipt_document_id ? UPLOADS.get(b.receipt_document_id) ?? null : null;
  return created(payOut(pay(r, req.user!, b.payment_reference || null, b.paid_on, receipt)));
});
route("PATCH /api/v1/disbursements/:id", (req) => {
  const d = PAYS.find((x) => x.disbursement_id === req.params.id);
  if (!d || !finance(req.user!)) return notFound();
  const b = req.body as { payment_reference?: string };
  if (!b.payment_reference?.trim()) return invalid({ payment_reference: ["Required"] });
  d.payment_reference = b.payment_reference.trim();
  note(find(d.expense_request_id)!, "disbursement.reference_added", "Bank reference added", req.user);
  return ok(payOut(d));
});

/* ------------------------------------------------------------------ *
 * Budgets and projects
 * ------------------------------------------------------------------ */

function budOut(b: Bud): Budget {
  const lines = b.lines.map((l) => {
    const f = lineFigures(b, l);
    return { budget_line_id: l.id, expense_category_id: l.category_id, category: catOf(l.category_id)?.name ?? "Other", amount: l.amount, committed_amount: m(f.committed), spent_amount: m(f.spent), remaining: m(f.remaining) };
  });
  const sum = (key: "amount" | "committed_amount" | "spent_amount" | "remaining") => m(lines.reduce((a, l) => a + k(l[key]), 0));
  const head = byKey(teamOf("ifeoma").find((p) => p.department === b.department)?.user_key);
  return { budget_id: b.id, number: b.number, name: `${b.department} ${b.year}`, department_id: deptId(b.department), department: b.department, owner: head ? refKey(head.user_key) : null,
    starts_on: `${b.year}-01-01`, ends_on: `${b.year}-12-31`, status: "approved", allocated: sum("amount"), committed: sum("committed_amount"), spent: sum("spent_amount"), remaining: sum("remaining"), lines, approved_at: b.approved_at };
}
const budgetSees = (u: string, b: Bud) => finance(u) || byKey(u)?.department === b.department;
route("GET /api/v1/budgets", (req) =>
  paged(BUDS.filter((b) => budgetSees(req.user!, b)).map(budOut), req, {
    search: (b) => [b.number, b.name, b.department], filters: { year: (b, v) => b.starts_on.startsWith(v), department_id: (b, v) => b.department_id === v },
    sort: { name: (a, b) => a.name.localeCompare(b.name), allocated: (a, b) => k(a.allocated) - k(b.allocated), remaining: (a, b) => k(a.remaining) - k(b.remaining) },
  }),
);
route("GET /api/v1/budgets/projects", (req) => {
  if (!finance(req.user!)) return fail(403, "FORBIDDEN", "Projects' spend is read across the company");
  return paged(PROJECT_NAMES.map((_, i) => projectOut(i)), req, { search: (p) => [p.number, p.name], sort: { name: (a, b) => a.name.localeCompare(b.name), spent: (a, b) => k(a.spent) - k(b.spent), remaining: (a, b) => k(a.remaining) - k(b.remaining) } });
});
function projectOut(i: number): ProjectSpend {
  const id = projectId(i);
  const on = REQS.filter((r) => r.project_id === id && r.status !== "draft");
  const committed = on.filter((r) => COMMITTED.includes(r.status)).reduce((a, r) => a + k(r.amount), 0);
  const spent = on.filter((r) => r.status === "disbursed").reduce((a, r) => a + k(r.amount), 0);
  const budget = PROJECT_BUDGETS.get(id) ?? null;
  return { project_id: id, number: `PRJ-2026-${String(i + 1).padStart(6, "0")}`, name: PROJECT_NAMES[i], budget_amount: budget, committed: m(committed), spent: m(spent), remaining: budget === null ? null : m(k(budget) - committed - spent), requests: on.length };
}
route("PATCH /api/v1/budgets/projects/:id", (req) => {
  if (!finance(req.user!)) return fail(403, "CAPABILITY_REQUIRED", "You cannot set budgets");
  const i = PROJECT_NAMES.findIndex((_, x) => projectId(x) === req.params.id);
  if (i < 0) return notFound();
  PROJECT_BUDGETS.set(req.params.id, (req.body as { budget_amount: string | null }).budget_amount);
  return ok(projectOut(i));
});
route("GET /api/v1/budgets/:id", (req) => {
  const b = BUDS.find((x) => x.id === req.params.id);
  return b && budgetSees(req.user!, b) ? ok(budOut(b)) : notFound();
});
route("GET /api/v1/budgets/:id/history", (req) => {
  const b = BUDS.find((x) => x.id === req.params.id);
  return b && budgetSees(req.user!, b) ? paged(b.changes, req) : notFound();
});
type BudgetBody = { department_id?: string; year?: number; lines?: Array<{ expense_category_id: string; amount: string }> };
function checkLines(lines: BudgetBody["lines"]) {
  if (!lines?.length) return { lines: ["Add a category"] };
  if (new Set(lines.map((l) => l.expense_category_id)).size !== lines.length) return { lines: ["Each category once"] };
  return null;
}
route("POST /api/v1/budgets", (req) => {
  if (!finance(req.user!)) return fail(403, "CAPABILITY_REQUIRED", "You cannot set budgets");
  const b = req.body as BudgetBody;
  const bad = checkLines(b.lines);
  if (bad) return invalid(bad);
  const dept = [...new Set([...BUDS.map((x) => x.department), ...REQS.map((x) => x.department), ...teamOf("ifeoma").map((p) => p.department)])].find((d) => deptId(d) === b.department_id);
  if (!dept) return invalid({ department_id: ["Not a department"] });
  if (BUDS.some((x) => x.department === dept && x.year === Number(b.year))) return fail(409, "BUDGET_EXISTS", `${dept} already has a ${b.year} budget`, { year: ["Already set"] });
  n.bud += 1;
  const bud: Bud = { id: sid(`budget:${dept}:${b.year}`), number: `BUD-${b.year}-${pad(n.bud)}`, department: dept, year: Number(b.year), approved_at: now(), changes: [],
    lines: b.lines!.map((l) => ({ id: sid(`bline:${dept}:${l.expense_category_id}:${b.year}`), category_id: l.expense_category_id, amount: l.amount })) };
  bud.changes = bud.lines.map((l) => ({ at: now(), by: name(req.user!), category: catOf(l.category_id)?.name ?? null, before: null, after: l.amount }));
  BUDS.push(bud);
  return created(budOut(bud));
});
route("PATCH /api/v1/budgets/:id", (req) => {
  if (!finance(req.user!)) return fail(403, "CAPABILITY_REQUIRED", "You cannot set budgets");
  const bud = BUDS.find((x) => x.id === req.params.id);
  if (!bud) return notFound();
  const lines = (req.body as BudgetBody).lines;
  const bad = checkLines(lines);
  if (bad) return invalid(bad);
  const changes: BudgetChange[] = [];
  for (const l of lines!) {
    const was = bud.lines.find((x) => x.category_id === l.expense_category_id);
    if (!was) {
      bud.lines.push({ id: sid(`bline:${bud.id}:${l.expense_category_id}`), category_id: l.expense_category_id, amount: l.amount });
      changes.push({ at: now(), by: name(req.user!), category: catOf(l.expense_category_id)?.name ?? null, before: null, after: l.amount });
    } else if (was.amount !== l.amount) {
      changes.push({ at: now(), by: name(req.user!), category: catOf(l.expense_category_id)?.name ?? null, before: was.amount, after: l.amount });
      was.amount = l.amount;
    }
  }
  for (const was of [...bud.lines]) {
    if (lines!.some((l) => l.expense_category_id === was.category_id)) continue;
    changes.push({ at: now(), by: name(req.user!), category: catOf(was.category_id)?.name ?? null, before: was.amount, after: null });
    bud.lines.splice(bud.lines.indexOf(was), 1);
  }
  bud.changes.unshift(...changes);
  for (const r of REQS) if (r.status === "submitted") r.over_budget = flag(r);
  return ok(budOut(bud));
});

/** The requests waiting on an approval, for Home's Expenses Awaiting Approval card. */
export const pendingExpenses = () =>
  REQS.filter((r) => r.status === "submitted").map((r) => ({ id: r.id, number: r.number, requester: r.requester, purpose: r.purpose, category: catOf(r.category_id)?.name ?? "Other", amount: r.amount, submitted_at: r.submitted_at! }));
