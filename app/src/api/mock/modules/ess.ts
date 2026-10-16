import { at, created, invalid, isoDaysAgo, isoDaysAhead, ok, paged, route, sid, fail } from "../core";
import { byKey, managerOf } from "../data/people";

const fmt = (iso: string) => iso.split("-").reverse().join("/");
const ARR: Record<string, string> = { hybrid: "Hybrid", remote: "Remote", on_site: "Office-only" };
const AREA = ["Lekki Phase 1", "Surulere", "Gbagada", "Yaba", "Ikeja", "Ajah", "Magodo"];
const PATCHES = new Map<string, Record<string, string>>();

function profile(key: string) {
  const p = byKey(key)!;
  const m = managerOf(p);
  const x = PATCHES.get(key) ?? {};
  const idx = p.employee_id.charCodeAt(0) % AREA.length;
  const status = p.status === "probation" ? { tone: "warn" as const, text: "Probation" } : { tone: "ok" as const, text: "Confirmed" };
  const arr = ARR[p.work_pattern];
  const sched = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day, i) => {
    if (i === 6) return { day, mode: "Off" as const, hours: "", where: "" };
    const mode = arr === "Remote" ? "Remote" : arr === "Hybrid" ? (i === 2 || i === 5 ? "Remote" : "Office") : "Office";
    return { day, mode: mode as "Office", hours: i === 5 ? "09:00 to 15:00" : "09:00 to 17:00", where: mode === "Remote" ? `Home · ${AREA[idx]}` : p.worksite };
  });
  return {
    employee_id: p.employee_id, display_name: p.display_name, job_title: p.job_title, department: p.department, photo_url: x.photo ?? null,
    chips: [status, { tone: "neutral" as const, text: arr }, { tone: "neutral" as const, text: p.grade }, ...(m ? [{ tone: "neutral" as const, text: `Reports to ${m.display_name}` }] : [])],
    personal: { full_name: p.display_name, date_of_birth: p.date_of_birth, phone: x.phone ?? p.phone, work_email: p.work_email, address: x.address ?? `${AREA[idx]}, Lagos` },
    employment: { job_title: p.job_title, department: p.department, line_manager: m ? `${m.display_name}, ${m.job_title}` : "None", start_date: p.start_date, employment_type: p.employment_type.replace("_", " ").replace(/^./, (c) => c.toUpperCase()), arrangement: arr, status },
    bank: { bank_name: x.bank_name ?? p.bank_name, account_name: p.display_name, account_last4: (x.account_number ?? p.account_last4).slice(-4) },
    next_of_kin: { name: x.next_of_kin_name ?? p.next_of_kin, relationship: x.next_of_kin_relationship ?? "Sibling", phone: x.next_of_kin_phone ?? "+234 806 554 2210" },
    schedule: sched,
    can_change: [
      ["Phone number", "ok", "Immediately"], ["Address", "ok", "Immediately"], ["Bank details", "warn", "Logged, People notified"], ["Next of kin", "ok", "Immediately"], ["Photo", "ok", "Immediately"],
      ["Job title", "neutral", "Only People can"], ["Salary", "neutral", "Only People can"], ["Line manager", "neutral", "Only People can"], ["Work schedule", "neutral", "Only People can"],
    ].map(([field, tone, text]) => ({ field, how: { tone: tone as "ok", text } })),
    history: [
      ...(x.changed ? [{ title: x.changed, when: "Just now", text: "Logged in the audit trail.", tone: "hi" as const }] : []),
      { title: "Bank details updated", when: fmt(isoDaysAgo(61)), text: "Logged. People were notified the same day.", tone: x.changed ? undefined : ("hi" as const) },
      { title: `Grade confirmed as ${p.grade}`, when: fmt(isoDaysAgo(105)), tone: "ok" as const },
      { title: "Phone number updated", when: fmt(isoDaysAgo(206)) },
      { title: "Started at MyCity App Ltd", when: fmt(p.start_date), tone: "ok" as const },
    ],
  };
}

route("GET /api/v1/ess/profile", (req) => ok(profile(req.user!)));
route("PATCH /api/v1/ess/profile", (req) => {
  const b = req.body as Record<string, string>;
  const f: Record<string, string[]> = {};
  if (b.phone !== undefined && !/^(\+?234|0)\d{10}$/.test(b.phone.replace(/[\s\-().]/g, ""))) f.phone = ["must be a Nigerian phone number"];
  if (b.account_number !== undefined && !/^\d{10}$/.test(b.account_number)) f.account_number = ["must be a 10-digit NUBAN"];
  if (b.address !== undefined && b.address.trim().length < 5) f.address = ["Enter the address"];
  if (Object.keys(f).length) return invalid(f);
  const prev = PATCHES.get(req.user!) ?? {};
  const changed = b.photo_document_id ? "Photo updated" : b.bank_name || b.account_number ? "Bank details updated" : b.phone ? "Phone number updated" : b.address ? "Address updated" : "Next of kin updated";
  PATCHES.set(req.user!, { ...prev, ...b, ...(b.photo_document_id ? { photo: "" } : {}), changed });
  return ok(profile(req.user!));
});

route("GET /api/v1/ess/performance", (req) => {
  const p = byKey(req.user)!;
  const m = managerOf(p);
  return ok({
    period: new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
    set_by: m?.display_name ?? "The board",
    stats: [{ label: "KPI Score", value: "71%" }, { label: "On Track", value: "2 of 4" }, { label: "Weight Assigned", value: "100%" }, { label: "Last Review", value: "4.0 · Q3" }, { label: "Next Cycle", value: `Opens ${fmt(isoDaysAhead(6)).slice(0, 5)}` }],
    kpis: [{ label: "Partnership MOUs", pct: 75, value: "3 of 4" }, { label: "Staff Onboarded", pct: 100, value: "2 of 2", emphasis: "brand" as const }, { label: "Expense Turnaround", pct: 60, value: "3.1 days" }, { label: "Policy Refresh", pct: 40, value: "2 of 5" }],
    chain: [
      { title: "ORG-2026-03 · Scale to 12 cities", level: "Organisational · set by the CEO", top: true },
      { title: "Operational readiness for 4 new cities", level: "Annual · set by management" },
      { title: "Reduce approval turnaround to 2 days", level: "Monthly · set by management" },
      { title: `${p.department} efficiency, Q4`, level: `Departmental · set by ${m?.display_name ?? "management"}` },
      { title: "Expense turnaround, 3.1 days", level: "Your KPI · 60% complete", mine: true },
    ],
    reviews: [["Q3 2026", "4.2", "4.0", "Approved", "ok", "Closed"], ["Q2 2026", "3.9", "4.1", "Approved", "ok", "Closed"], ["Q1 2026", "4.0", "3.9", "Approved", "ok", "Closed"], ["Q4 2026", null, null, null, "warn", `Opens ${fmt(isoDaysAhead(6)).slice(0, 5)}`]].map((r, i) => ({
      review_id: sid(`rev:${req.user}:${i}`), cycle: r[0] as string, self: r[1], manager: r[2], second: r[3], status: { tone: r[4] as "ok", text: r[5] as string },
      manager_comment: r[1] ? "Strong quarter on partnerships. Turnaround still above the 2 day target." : null,
    })),
  });
});

const ARCH = (user: string) =>
  user === "bashir" || user === "cynthia"
    ? [
        ["Repeated lateness, August", "Ifeoma Chukwu", 47, "Submitted the next day", "neutral", "Upheld, sanction"],
        ["Missing Clock-Out", "System", 122, "Submitted the same day", "ok", "Closed, no action"],
        ["Missing clock-outs, March 2025", "System", 562, "Submitted the next day", "neutral", "Upheld, sanction"],
      ]
    : [["Missing Clock-Out", "System", 122, "Submitted the same day", "ok", "Closed, no action"]];
const OPEN = new Map<string, Array<{ query_id: string; number: string; subject: string; raised_by: string; date: string; response: string | null; outcome: { tone: "warn"; text: string }; respond_by: string | null }>>([
  ["bashir", [{ query_id: sid("q:bashir:open"), number: "QRY-0014", subject: "3 late arrivals in 30 days", raised_by: "System rule", date: isoDaysAgo(7), response: null, outcome: { tone: "warn", text: "Awaiting your response" }, respond_by: at(-1, "09:41") }]],
]);
route("GET /api/v1/ess/queries/summary", (req) => {
  const arch = ARCH(req.user!);
  const sanc = SANC(req.user!);
  return ok({ open: (OPEN.get(req.user!) ?? []).filter((q) => !q.response).length, archived: arch.length, archived_note: `${arch.filter((a) => a[5] === "Closed, no action").length} closed with no action`, sanctions: sanc.length, last_sanction: sanc[0]?.date ?? null });
});
route("GET /api/v1/ess/queries", (req) => {
  const view = req.query.view;
  const q = Object.fromEntries(Object.entries(req.query).filter(([k]) => k !== "view"));
  if (view === "open") return paged(OPEN.get(req.user!) ?? [], { ...req, query: q });
  return paged(ARCH(req.user!).map((a, i) => ({ query_id: sid(`qa:${req.user}:${i}`), number: `QRY-${String(11 - i * 3).padStart(4, "0")}`, subject: a[0] as string, raised_by: a[1] as string, date: isoDaysAgo(a[2] as number), response: a[3] as string, outcome: { tone: a[4] as "ok", text: a[5] as string }, respond_by: null })), { ...req, query: q });
});
route("POST /api/v1/ess/queries/:id/response", (req) => {
  const list = OPEN.get(req.user!) ?? [];
  const qq = list.find((x) => x.query_id === req.params.id);
  if (!qq) return fail(404, "NOT_FOUND", "That query is not open.");
  const r = String(req.body.response ?? "");
  if (r.trim().length < 20) return invalid({ response: ["Write at least 20 characters"] });
  qq.response = r;
  qq.outcome = { tone: "warn", text: "Response sent, awaiting decision" };
  return ok(qq);
});
const SANC = (user: string) =>
  user === "bashir" || user === "cynthia"
    ? [
        { sanction_id: sid(`s:${user}:1`), kind: "Warning", reason: "Repeated lateness, August", date: isoDaysAgo(46), deduction: "12500.00", status: { tone: "neutral" as const, text: "Served" } },
        { sanction_id: sid(`s:${user}:2`), kind: "Caution", reason: "Missing clock-outs, March 2025", date: isoDaysAgo(560), deduction: "7500.00", status: { tone: "neutral" as const, text: "Served" } },
      ]
    : [];
route("GET /api/v1/ess/sanctions", (req) => paged(SANC(req.user!), req));

const DOCS = new Map<string, Array<{ document_ref_id: string; name: string; uploaded: string | null; status: { tone: "ok" | "warn" | "err"; text: string }; expires: string | null; document: null | { document_id: string; file_name: string; size_bytes: number; mime_type: string }; signed_number: string | null }>>();
const docsOf = (user: string) => {
  if (!DOCS.has(user)) {
    const p = byKey(user)!;
    DOCS.set(user, [
      { document_ref_id: sid(`d:${user}:1`), name: "Employment contract", uploaded: p.start_date, status: { tone: "ok", text: "Signed" }, expires: null, document: null, signed_number: "CON-0004" },
      { document_ref_id: sid(`d:${user}:2`), name: "Data privacy acknowledgement", uploaded: p.start_date, status: { tone: "ok", text: "Signed" }, expires: null, document: null, signed_number: null },
      { document_ref_id: sid(`d:${user}:3`), name: "NDPA training certificate", uploaded: isoDaysAgo(276), status: { tone: "warn", text: "Expiring" }, expires: isoDaysAhead(47), document: null, signed_number: null },
      { document_ref_id: sid(`d:${user}:4`), name: "Passport photograph", uploaded: null, status: { tone: "err", text: "Missing" }, expires: null, document: null, signed_number: null },
      { document_ref_id: sid(`d:${user}:5`), name: "Bank verification number", uploaded: p.start_date, status: { tone: "ok", text: "Verified" }, expires: null, document: null, signed_number: null },
    ]);
  }
  return DOCS.get(user)!;
};
route("GET /api/v1/ess/documents", (req) => paged(docsOf(req.user!), req, { search: (r) => [r.name] }));
route("POST /api/v1/ess/documents", (req) => {
  const list = docsOf(req.user!);
  const name = String(req.body.name ?? "");
  const existing = list.find((d) => d.name === name);
  const doc = { document_id: String(req.body.document_id), file_name: name, size_bytes: 0, mime_type: "application/pdf" };
  if (existing) Object.assign(existing, { uploaded: isoDaysAgo(0), status: { tone: "warn", text: "Awaiting verification" }, document: doc });
  else list.unshift({ document_ref_id: sid(`d:${Date.now()}`), name, uploaded: isoDaysAgo(0), status: { tone: "warn", text: "Awaiting verification" }, expires: null, document: doc, signed_number: null });
  return created(existing ?? list[0]);
});

