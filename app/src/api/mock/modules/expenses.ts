import type { Category, Disbursement, ExpenseDetail, ExpenseRow, Requisition } from "@/api/types/expenses";
import type { Status, Trail } from "@/api/types/performance";
import { created, fail, invalid, isoDaysAgo, notFound, ok, paged, route, sid } from "../core";
import { byKey, refKey, SIGN_INS } from "../data/people";
import { REQUESTS, STAGE_PILL, type MockRequest } from "../data/expenses";
import { UPLOADS } from "../uploads";

const S = (tone: Status["tone"], text: string): Status => ({ tone, text });
const k = (m: string) => Math.round(Number(m) * 100);
const m = (kobo: number) => `${Math.trunc(kobo / 100)}.${String(kobo % 100).padStart(2, "0")}`;
const isOps = (u: string) => SIGN_INS[u]?.view === "operations";
const isCeo = (u: string) => SIGN_INS[u]?.view === "ceo";
const LABELS = ["Requested", "Line manager", "Operations", "Requisition", "CEO", "Disbursed"];
const ORDER: MockRequest["stage"][] = ["draft", "line_manager", "operations", "requisition", "ceo", "approved", "disbursed"];

const EXTRA = new Map<string, { beneficiary: { name: string; bank: string; account_last4: string }; invoice: ExpenseDetail["invoice"]; history: Trail[]; requisition: string | null }>();
const extra = (r: MockRequest) => {
  let e = EXTRA.get(r.request_id);
  if (!e) {
    const p = byKey(r.requester)!;
    e = {
      beneficiary: { name: r.title.includes("stage") ? "Stagecraft Nigeria Ltd" : p.display_name, bank: p.bank_name, account_last4: p.account_last4 },
      invoice: { document_id: sid(`inv:${r.request_id}`), file_name: `${r.number.toLowerCase()}-invoice.pdf`, size_bytes: 740 * 1024, mime_type: "application/pdf" },
      history: [{ title: "Submitted", when: r.submitted_at, text: `₦${Number(r.amount).toLocaleString("en-NG")}, ${r.category.toLowerCase()}.`, tone: null }],
      requisition: null,
    };
    EXTRA.set(r.request_id, e);
  }
  return e;
};
const approverOf = (r: MockRequest) => (r.stage === "line_manager" ? byKey(r.requester)?.manager ?? "ifeoma" : r.stage === "operations" ? "cynthia" : null);
const row = (r: MockRequest): ExpenseRow => ({ request_id: r.request_id, number: r.number, title: r.title, requester: refKey(r.requester), category: r.category, amount: r.amount, stage: r.stage, stage_status: STAGE_PILL[r.stage], submitted_at: r.submitted_at, project: r.project });
function detail(r: MockRequest, user: string): ExpenseDetail {
  const e = extra(r);
  const at_ = r.stage === "rejected" ? -1 : Math.min(5, Math.max(0, ORDER.indexOf(r.stage) - (r.stage === "approved" ? 1 : 0)));
  const can = approverOf(r) === user;
  return {
    ...row(r), chain: LABELS.map((label, i) => ({ label, state: r.stage === "disbursed" || i < at_ ? "done" : i === at_ ? "now" : null })),
    chain_note: r.stage === "rejected" ? "Rejected. The reason is in the history." : r.stage === "approved" ? "Approved by the CEO in a requisition. Waiting for Finance to log the transfer." : r.stage === "requisition" ? "Approved by Operations. It goes to the CEO inside the next requisition." : "Every request follows the same chain, whatever the amount.",
    beneficiary: e.beneficiary, invoice: e.invoice, history: e.history, can_approve: can, approve_as: can ? (r.stage === "line_manager" ? "Line Manager" : "Operations") : null, requisition: e.requisition,
  };
}
const find = (id: string) => REQUESTS.find((r) => r.request_id === id);
const inFlight = (r: MockRequest) => !["disbursed", "rejected", "draft"].includes(r.stage);

route("GET /api/v1/expenses/mine/summary", (req) => {
  const mine = REQUESTS.filter((r) => r.requester === req.user);
  return ok({ in_flight: mine.filter(inFlight).length, disbursed_this_year: m(mine.filter((r) => r.stage === "disbursed").reduce((a, r) => a + k(r.amount), 0) + 1_420_000_00), average_turnaround: "3.1 days", rejected: mine.filter((r) => r.stage === "rejected").length, focus_id: mine.find(inFlight)?.request_id ?? mine[0]?.request_id ?? null });
});
route("GET /api/v1/expenses/approvals/summary", (req) => {
  const mine = REQUESTS.filter((r) => approverOf(r) === req.user);
  const oldest = mine.reduce((a, r) => Math.max(a, Math.floor((Date.now() - new Date(r.submitted_at).getTime()) / 86400000)), 0);
  return ok({ with_you: mine.length, total_value: m(mine.reduce((a, r) => a + k(r.amount), 0)), oldest_days: oldest, approved_this_month: 11, focus_id: [...mine].sort((a, b) => k(b.amount) - k(a.amount))[0]?.request_id ?? null });
});
route("GET /api/v1/expenses/requests", (req) => {
  const u = req.user!;
  const scope = req.query.scope ?? "mine";
  const list = scope === "approvals" ? REQUESTS.filter((r) => approverOf(r) === u) : scope === "all" && (isOps(u) || isCeo(u)) ? REQUESTS : REQUESTS.filter((r) => r.requester === u);
  return paged(list.map(row), { ...req, query: Object.fromEntries(Object.entries(req.query).filter(([x]) => x !== "scope")) }, { search: (r) => [r.number, r.title, r.requester.display_name, r.category], filters: { stage: (r, v) => r.stage === v } });
});
route("GET /api/v1/expenses/requests/:id", (req) => {
  const r = find(req.params.id);
  if (!r) return notFound();
  const u = req.user!;
  if (r.requester !== u && approverOf(r) !== u && !isOps(u) && !isCeo(u) && byKey(r.requester)?.manager !== u) return fail(403, "FORBIDDEN", "You can only open your own requests and those waiting on you.");
  return ok(detail(r, u));
});
route("POST /api/v1/expenses/requests", (req) => {
  const b = req.body as Record<string, string>;
  const cat = CATS.find((c) => c.category_id === b.category_id);
  const f: Record<string, string[]> = {};
  if (!b.title || b.title.trim().length < 6) f.title = ["What it is for, in a sentence"];
  if (!cat) f.category_id = ["Pick the category"];
  if (!(Number(b.amount) > 0)) f.amount = ["Enter the amount in Naira"];
  if (!b.beneficiary_name?.trim()) f.beneficiary_name = ["Who is paid"];
  if (!b.bank) f.bank = ["Pick the bank"];
  if (!/^\d{10}$/.test(b.account_number ?? "")) f.account_number = ["Ten digits (NUBAN)"];
  if (!b.invoice_document_id) f.invoice_document_id = ["Attach the vendor invoice"];
  if (Object.keys(f).length) return invalid(f);
  const n = Math.max(...REQUESTS.map((r) => Number(r.number.slice(4)))) + 1;
  const r: MockRequest = { request_id: sid(`exp:new:${n}`), number: `EXP-${String(n).padStart(4, "0")}`, title: b.title.trim(), requester: req.user!, category: cat!.name, department: "", amount: b.amount, stage: "line_manager", submitted_at: new Date().toISOString(), project: b.project || null };
  REQUESTS.unshift(r);
  const up = UPLOADS.get(b.invoice_document_id);
  EXTRA.set(r.request_id, { beneficiary: { name: b.beneficiary_name.trim(), bank: b.bank, account_last4: b.account_number.slice(-4) }, invoice: up ?? { document_id: b.invoice_document_id, file_name: "invoice.pdf", size_bytes: 0, mime_type: "application/pdf" }, history: [{ title: "Submitted", when: r.submitted_at, text: `₦${Number(r.amount).toLocaleString("en-NG")}, ${cat!.name.toLowerCase()}.`, tone: null }], requisition: null });
  cat!.requests += 1;
  return created(detail(r, req.user!));
});
route("POST /api/v1/expenses/requests/:id/approve", (req) => {
  const r = find(req.params.id);
  if (!r) return notFound();
  if (approverOf(r) !== req.user) return fail(403, "NOT_YOURS", "This request is not waiting on you.");
  const who = byKey(req.user)!.display_name;
  extra(r).history.unshift({ title: r.stage === "line_manager" ? "Approved by line manager" : "Approved by Operations", when: new Date().toISOString(), text: `${who}.`, tone: "ok" });
  r.stage = r.stage === "line_manager" ? "operations" : "requisition";
  return ok(detail(r, req.user!));
});
route("POST /api/v1/expenses/requests/:id/reject", (req) => {
  const r = find(req.params.id);
  if (!r) return notFound();
  if (approverOf(r) !== req.user) return fail(403, "NOT_YOURS", "This request is not waiting on you.");
  const reason = String(req.body.reason ?? "").trim();
  if (reason.length < 6) return invalid({ reason: ["Say why. The requester sees it"] });
  r.stage = "rejected";
  extra(r).history.unshift({ title: "Rejected", when: new Date().toISOString(), text: `${byKey(req.user)!.display_name}: ${reason}`, tone: "hi" });
  return ok(detail(r, req.user!));
});

interface MReq { requisition_id: string; number: string; ids: string[]; submitted_on: string; approved_on: string | null }
const REQS: MReq[] = [
  { requisition_id: sid("rq:42"), number: "REQ-0042", ids: REQUESTS.filter((r) => r.stage === "ceo").map((r) => r.request_id), submitted_on: isoDaysAgo(6), approved_on: null },
  { requisition_id: sid("rq:41"), number: "REQ-0041", ids: REQUESTS.filter((r) => r.stage === "disbursed").slice(0, 2).map((r) => r.request_id), submitted_on: isoDaysAgo(23), approved_on: isoDaysAgo(22) },
  { requisition_id: sid("rq:40"), number: "REQ-0040", ids: REQUESTS.filter((r) => r.stage === "disbursed").slice(2).map((r) => r.request_id), submitted_on: isoDaysAgo(37), approved_on: isoDaysAgo(36) },
];
REQS.forEach((q) => q.ids.forEach((id) => (extra(find(id)!).requisition = q.number)));
const reqOut = (q: MReq, user: string): Requisition => {
  const items = q.ids.map((id) => find(id)!).filter(Boolean);
  const days = Math.floor((Date.now() - new Date(`${q.submitted_on}T09:00:00+01:00`).getTime()) / 86400000);
  const done = items.every((r) => r.stage === "disbursed");
  return { requisition_id: q.requisition_id, number: q.number, count: items.length, total: m(items.reduce((a, r) => a + k(r.amount), 0)), submitted_on: q.submitted_on, approved_on: q.approved_on, status: q.approved_on ? (done ? S("ok", "Disbursed") : S("info", "Approved")) : S("warn", `With CEO · ${days} days`), can_approve: !q.approved_on && isCeo(user) };
};
route("GET /api/v1/expenses/requisitions/summary", () => {
  const open = REQS.filter((q) => !q.approved_on);
  const days = open.reduce((a, q) => Math.max(a, Math.floor((Date.now() - new Date(`${q.submitted_on}T09:00:00+01:00`).getTime()) / 86400000)), 0);
  return ok({ with_ceo: open.length, days_waiting: days, disbursed_this_year: "14800000.00", average_size: `${Math.round(REQS.reduce((a, q) => a + q.ids.length, 0) / REQS.length)} requests`, ready_to_group: REQUESTS.filter((r) => r.stage === "requisition").length, focus_id: open[0]?.requisition_id ?? REQS[0].requisition_id });
});
route("GET /api/v1/expenses/requisitions", (req) => paged(REQS.map((q) => reqOut(q, req.user!)), req, { search: (q) => [q.number] }));
route("GET /api/v1/expenses/requisitions/:id", (req) => {
  const q = REQS.find((x) => x.requisition_id === req.params.id);
  return q ? ok({ ...reqOut(q, req.user!), items: q.ids.map((id) => row(find(id)!)) }) : notFound();
});
route("POST /api/v1/expenses/requisitions", (req) => {
  if (!isOps(req.user!)) return fail(403, "FORBIDDEN", "Operations groups requests into a requisition.");
  const ids = (req.body.request_ids as string[]) ?? [];
  const items = ids.map(find);
  if (!ids.length) return invalid({ request_ids: ["Pick at least one approved request"] });
  if (items.some((r) => !r || r.stage !== "requisition")) return fail(409, "NOT_READY", "Only requests Operations has approved can go into a requisition.");
  const n = 43 + REQS.length - 3;
  const q: MReq = { requisition_id: sid(`rq:${n}`), number: `REQ-${String(n).padStart(4, "0")}`, ids, submitted_on: isoDaysAgo(0), approved_on: null };
  REQS.unshift(q);
  items.forEach((r) => {
    r!.stage = "ceo";
    extra(r!).requisition = q.number;
    extra(r!).history.unshift({ title: `In ${q.number}, with the CEO`, when: new Date().toISOString(), text: null, tone: "hi" });
  });
  return created({ ...reqOut(q, req.user!), items: ids.map((id) => row(find(id)!)) });
});
route("POST /api/v1/expenses/requisitions/:id/approve", (req) => {
  const q = REQS.find((x) => x.requisition_id === req.params.id);
  if (!q) return notFound();
  if (!isCeo(req.user!)) return fail(403, "FORBIDDEN", "Only the CEO approves a requisition.");
  if (q.approved_on) return fail(409, "ALREADY_APPROVED", "This requisition is already approved.");
  const remove = new Set((req.body.remove_ids as string[]) ?? []);
  q.ids.forEach((id) => {
    const r = find(id)!;
    if (remove.has(id)) {
      r.stage = "requisition";
      extra(r).requisition = null;
      extra(r).history.unshift({ title: `Removed from ${q.number}`, when: new Date().toISOString(), text: "Back in the queue for the next requisition.", tone: "hi" });
    } else {
      r.stage = "approved";
      extra(r).history.unshift({ title: "Approved by the CEO", when: new Date().toISOString(), text: `In ${q.number}.`, tone: "ok" });
    }
  });
  q.ids = q.ids.filter((id) => !remove.has(id));
  q.approved_on = isoDaysAgo(0);
  return ok({ ...reqOut(q, req.user!), items: q.ids.map((id) => row(find(id)!)) });
});

const DISB: Disbursement[] = REQUESTS.filter((r) => r.stage === "disbursed").map((r, i) => ({ disbursement_id: sid(`dis:${r.request_id}`), number: r.number, beneficiary: extra(r).beneficiary.name, bank: extra(r).beneficiary.bank, amount: r.amount, bank_reference: `FT26${String(9281244 + i * 4471).slice(0, 7)}${i}`, paid_on: r.submitted_at.slice(0, 10) <= isoDaysAgo(2) ? isoDaysAgo(Math.max(1, Math.floor((Date.now() - new Date(r.submitted_at).getTime()) / 86400000) - 2)) : isoDaysAgo(0), status: S("ok", "Settled") }));
route("GET /api/v1/expenses/disbursements/summary", () => {
  const month = isoDaysAgo(0).slice(0, 7);
  return ok({ settled_this_month: m(DISB.filter((d) => d.paid_on.startsWith(month)).reduce((a, d) => a + k(d.amount), 0)), awaiting: REQUESTS.filter((r) => r.stage === "approved").length, average_days: "1.2 days", missing_reference: 0, trend: { labels: ["Jun", "Jul", "Aug", "Sep", "Oct"], values: ["1420000.00", "986000.00", "1680000.00", "2214000.00", m(DISB.reduce((a, d) => a + k(d.amount), 0))] } });
});
route("GET /api/v1/expenses/disbursements", (req) => paged(DISB, req, { search: (d) => [d.number, d.beneficiary, d.bank_reference] }));
route("POST /api/v1/expenses/disbursements", (req) => {
  if (!isOps(req.user!) && !isCeo(req.user!)) return fail(403, "FORBIDDEN", "Finance and Operations log disbursements.");
  const b = req.body as Record<string, string>;
  const r = find(b.request_id);
  const f: Record<string, string[]> = {};
  if (!r) f.request_id = ["Pick the approved request"];
  else if (r.stage !== "approved") f.request_id = ["Only a CEO-approved request can be disbursed"];
  if (!/^[A-Z0-9]{8,24}$/.test((b.bank_reference ?? "").toUpperCase())) f.bank_reference = ["The bank's transfer reference, 8 to 24 letters and digits"];
  if (!b.paid_on) f.paid_on = ["The date the bank confirmed"];
  else if (b.paid_on > isoDaysAgo(0)) f.paid_on = ["Logged after the bank confirms, never ahead"];
  if (Object.keys(f).length) return invalid(f);
  r!.stage = "disbursed";
  const e = extra(r!);
  e.history.unshift({ title: "Disbursed", when: new Date().toISOString(), text: `Bank reference ${b.bank_reference.toUpperCase()}.`, tone: "ok" });
  const d: Disbursement = { disbursement_id: sid(`dis:${r!.request_id}`), number: r!.number, beneficiary: e.beneficiary.name, bank: e.beneficiary.bank, amount: r!.amount, bank_reference: b.bank_reference.toUpperCase(), paid_on: b.paid_on, status: S("ok", "Settled") };
  DISB.unshift(d);
  return created(d);
});

route("GET /api/v1/expenses/budgets", () =>
  ok({
    illustrative: true, year: new Date().getUTCFullYear(),
    lines: [["Marketing & Sales", 2500000, 2300000], ["Studio", 1800000, 1100000], ["Partnerships", 1400000, 600000], ["Operations", 1800000, 400000], ["Content", 800000, 300000]].map(([department, b, a]) => {
      const pct = Math.round(((a as number) * 100) / (b as number));
      return { department: department as string, budget: `${b}.00`, actual: `${a}.00`, variance: `${(b as number) - (a as number)}.00`, pct, status: pct >= 90 ? S("warn", `${pct}% used`) : S("ok", `${pct}% used`) };
    }),
  }),
);

const CATS: Category[] = [
  ["Travel", "Operating", "200000.00"], ["Transport", "Operating", "200000.00"], ["Events", "Operating", "500000.00"], ["Production", "Operating", "300000.00"], ["Hospitality", "Operating", "200000.00"],
  ["Office", "Operating", "100000.00"], ["Communication", "Operating", "100000.00"], ["Facilities", "Operating", "250000.00"], ["Equipment", "Capital", "250000.00"],
].map(([name, kind, flag]) => {
  const rs = REQUESTS.filter((r) => r.category === name);
  return { category_id: sid(`cat:${name}`), name, kind: kind as Category["kind"], flag_above: flag, this_month: m(rs.reduce((a, r) => a + k(r.amount), 0)), requests: rs.length };
});
route("GET /api/v1/expenses/categories/summary", () => {
  const sorted = [...CATS].sort((a, b) => k(b.this_month) - k(a.this_month));
  const max = k(sorted[0].this_month) || 1;
  return ok({ categories: CATS.length, spend_this_month: m(CATS.reduce((a, c) => a + k(c.this_month), 0)), requests: CATS.reduce((a, c) => a + c.requests, 0), capital: CATS.filter((c) => c.kind === "Capital").length, by_category: sorted.map((c, i) => ({ label: c.name, pct: Math.round((k(c.this_month) * 100) / max), value: `₦${Math.round(k(c.this_month) / 100000)}k`, ...(i === sorted.length - 1 ? { emphasis: "brand" as const } : {}) })) });
});
route("GET /api/v1/expenses/categories", (req) => paged(CATS, req, { search: (c) => [c.name, c.kind] }));
route("POST /api/v1/expenses/categories", (req) => {
  if (!isOps(req.user!) && !isCeo(req.user!)) return fail(403, "FORBIDDEN", "Operations manages categories.");
  const b = req.body as Record<string, string>;
  const f: Record<string, string[]> = {};
  if (!b.name?.trim()) f.name = ["Name the category"];
  else if (CATS.some((c) => c.name.toLowerCase() === b.name.trim().toLowerCase())) f.name = ["That category exists"];
  if (!(Number(b.flag_above) > 0)) f.flag_above = ["The amount above which it is flagged"];
  if (Object.keys(f).length) return invalid(f);
  const c: Category = { category_id: sid(`cat:${b.name}`), name: b.name.trim(), kind: (b.kind as Category["kind"]) ?? "Operating", flag_above: b.flag_above, this_month: "0.00", requests: 0 };
  CATS.push(c);
  return created(c);
});
