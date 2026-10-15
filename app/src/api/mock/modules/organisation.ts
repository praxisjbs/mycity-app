import type { LeaveRequest } from "@/api/types/leave";
import { at, created, invalid, isoDaysAgo, isoDaysAhead, notFound, ok, paged, route, sid, fail } from "../core";
import { byId, byKey, DEPARTMENTS, managerOf, PEOPLE, ref, refKey, reportsOf, teamOf, SIGN_INS, type MockPerson } from "../data/people";
import { HISTORY, STATUS_PILL, TODAY } from "../data/attendance";

const ARR: Record<string, string> = { hybrid: "Hybrid", remote: "Remote", on_site: "Office-only" };
const arrangement = (p: MockPerson) => (p.user_key === "adedotun" || p.user_key === "grace" ? "Field" : ARR[p.work_pattern]);
const statusPill = (p: MockPerson) =>
  p.status === "suspended" ? { tone: "err" as const, text: "Suspended" } : p.status === "probation" ? { tone: "warn" as const, text: "Probation" } : p.status === "on_leave" ? { tone: "info" as const, text: "On Leave" } : { tone: "ok" as const, text: "Active" };
const full = (user: string) => ["operations", "ceo"].includes(SIGN_INS[user]?.view ?? "");

const row = (p: MockPerson) => {
  const t = TODAY.find((x) => x.person.user_key === p.user_key)!;
  return {
    employee_id: p.employee_id, staff_number: p.staff_number, display_name: p.display_name, job_title: p.job_title, department: p.department,
    line_manager: ref(managerOf(p)), arrangement: arrangement(p), attendance_today: STATUS_PILL[t.status], status: statusPill(p), _s: p.status,
  };
};

route("GET /api/v1/employees", (req) => {
  const scope = full(req.user!) ? PEOPLE : [byKey(req.user)!, ...teamOf(req.user!)];
  return paged(scope.map(row), req, {
    search: (r) => [r.display_name, r.job_title, r.department, r.staff_number],
    filters: { department: (r, v) => r.department === v, status: (r, v) => r._s === v, arrangement: (r, v) => r.arrangement === v },
  });
});

route("GET /api/v1/employees/summary", () => {
  const counts = DEPARTMENTS.map((d) => [d, PEOPLE.filter((p) => p.department === d).length] as const).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const max = counts[0][1];
  const arrs = ["Remote", "Hybrid", "Field", "Office-only"];
  return ok({
    kpis: [
      { key: "headcount", label: "Headcount", value: String(PEOPLE.length) },
      { key: "confirmed", label: "Confirmed", value: String(PEOPLE.filter((p) => p.status === "confirmed").length), tone: "ok" },
      { key: "probation", label: "On Probation", value: String(PEOPLE.filter((p) => p.status === "probation").length), tone: "warn" },
      { key: "attrition", label: "Attrition, 90 Days", value: "1" },
    ],
    arrangements: arrs.map((a) => ({ label: a, value: `${PEOPLE.filter((p) => arrangement(p) === a).length} staff` })),
    departments: counts.map(([label, n]) => ({ label, pct: Math.round((n / max) * 100), value: String(n) })),
    decisions: [
      { title: "Chidera Nwosu", text: `Probation ends ${isoDaysAhead(10).split("-").reverse().join("/")}`, action: { tone: "warn", text: "Confirm or extend" }, link: `/people?tab=employees&id=${byKey("chidera")!.employee_id}` },
      { title: "Seyi Balogun", text: "New device pending review", action: { tone: "warn", text: "Enrol or reject" }, link: "/people?tab=devices" },
      { title: "Bashir Lawal", text: "Query open since last week", action: { tone: "err", text: "Awaiting his response" }, link: "/queries?tab=queries" },
    ],
  });
});

function profile(p: MockPerson, viewer: string) {
  const mgr = managerOf(p);
  const rows = HISTORY.filter((h) => h.person.user_key === p.user_key);
  const last30 = rows.slice(0, 26);
  const onTime = last30.filter((h) => h.clock_in_at && h.status !== "late").length;
  const worked = last30.filter((h) => h.clock_in_at).length;
  const isBashir = p.user_key === "bashir";
  const t = TODAY.find((x) => x.person.user_key === p.user_key)!;
  const canPay = full(viewer) || viewer === p.user_key;
  const hm = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)) : null);
  return {
    employee_id: p.employee_id, staff_number: p.staff_number, display_name: p.display_name, job_title: p.job_title, department: p.department, grade: p.grade,
    line_manager: ref(mgr), start_date: p.start_date, employment_type: p.employment_type.replace("_", " ").replace(/^./, (c) => c.toUpperCase()), arrangement: arrangement(p), status: statusPill(p),
    work_email: p.work_email, phone: p.phone, gross_monthly: canPay ? p.gross_monthly : null, bank_name: canPay ? p.bank_name : null, account_last4: canPay ? p.account_last4 : null, next_of_kin: p.next_of_kin,
    stats: [
      { label: "Attendance, 30d", value: `${onTime} / ${worked}`, tone: onTime < worked ? ("warn" as const) : undefined },
      { label: "KPI Score", value: `${t.kpi_pct}%` },
      { label: "Open Tasks", value: String(t.open_tasks) },
      { label: "Leave Left", value: `${8 + (PEOPLE.indexOf(p) % 9)} days` },
      { label: "Open Queries", value: isBashir ? "1" : "0", tone: isBashir ? ("warn" as const) : ("ok" as const) },
    ],
    kpis: isBashir
      ? [{ label: "3 MOUs Signed", pct: 33, value: "1 of 3", emphasis: "warn" as const }, { label: "Partner Contact Cadence", pct: 48, value: "11 of 23", emphasis: "warn" as const }, { label: "Proposals Sent", pct: 50, value: "1 of 2" }, { label: "Pipeline Added", pct: 70, value: "3 prospects" }]
      : [{ label: "Quarter Goal", pct: t.kpi_pct, value: `${t.kpi_pct}%` }, { label: "Tasks on Time", pct: 80, value: "8 of 10" }, { label: "Reviews Filed", pct: 50, value: "2 of 4" }, { label: "Training Complete", pct: 100, value: "Done", emphasis: "brand" as const }],
    activity: isBashir
      ? [
          { title: "Query raised, 3 late arrivals in 30 days", when: `${isoDaysAgo(7).split("-").reverse().join("/")} 09:41`, text: "Raised by a system rule, not a manager. Awaiting his response.", tone: "hi" as const },
          { title: "Clocked in 09:41 · 41 minutes late", when: "Today 09:41" },
          { title: "Eko Hotels flagged, 34 days no contact", when: isoDaysAgo(9).split("-").reverse().join("/"), text: "Follow-up task raised automatically." },
          { title: "Warning served, repeated lateness", when: isoDaysAgo(46).split("-").reverse().join("/"), text: "₦12,500.00 deduction applied in the August run." },
          { title: "Q3 review closed, 3.2 manager rating", when: isoDaysAgo(14).split("-").reverse().join("/"), tone: "ok" as const },
        ]
      : [
          { title: "Recognised by Cynthia Osakunih", when: `${isoDaysAgo(5).split("-").reverse().join("/")} 09:04`, text: "\"Turned the Enugu shot list around in a day.\"", tone: "hi" as const },
          { title: `Clocked in · ${p.worksite}`, when: t.clock_in ? `Today ${t.clock_in}` : "Not today", tone: "ok" as const },
          { title: "Q3 review closed, 4.0 manager rating", when: isoDaysAgo(14).split("-").reverse().join("/"), tone: "ok" as const },
          { title: "Departmental target approved", when: isoDaysAgo(8).split("-").reverse().join("/") },
        ],
    punches: rows.slice(0, 6).map((h) => ({ date: h.date, in: hm(h.clock_in_at), out: hm(h.clock_out_at), location: h.location, status: h.status === "late" ? { tone: "err" as const, text: `Late ${h.late_minutes}m` } : h.status === "leave" ? { tone: "info" as const, text: "On Leave" } : h.status === "absent" ? { tone: "err" as const, text: "Absent" } : { tone: "ok" as const, text: h.status === "weekend" ? "Saturday" : "On Time" } })),
    documents: [
      { name: "Employment contract", status: { tone: "ok" as const, text: "Signed" }, expires: null, document: null },
      { name: "Valid ID", status: { tone: "ok" as const, text: "Verified" }, expires: null, document: null },
      { name: "NDPA certificate", status: isBashir ? { tone: "err" as const, text: "Missing" } : { tone: "warn" as const, text: "Expiring" }, expires: isBashir ? null : isoDaysAhead(47), document: null },
      { name: "Academic certificates", status: { tone: "ok" as const, text: "Received" }, expires: null, document: null },
    ],
    queries: isBashir
      ? [
          { subject: "3 late arrivals in 30 days", raised_by: "System rule", date: isoDaysAgo(7), outcome: { tone: "warn" as const, text: "Awaiting response" } },
          { subject: "Repeated lateness, August", raised_by: "Cynthia Osakunih", date: isoDaysAgo(47), outcome: { tone: "neutral" as const, text: "Warning, ₦12,500.00" } },
          { subject: "Missed partner follow-up", raised_by: "Cynthia Osakunih", date: isoDaysAgo(94), outcome: { tone: "neutral" as const, text: "Closed, caution" } },
        ]
      : [],
    open_queries: isBashir ? 1 : 0,
  };
}

route("GET /api/v1/employees/:id", (req) => {
  const p = byId(req.params.id);
  if (!p) return notFound();
  if (!full(req.user!) && p.user_key !== req.user && !teamOf(req.user!).includes(p)) return fail(403, "FORBIDDEN", "You can only open people you manage.");
  return ok(profile(p, req.user!));
});

const NG_PHONE = /^(\+?234|0)\d{10}$/;
route("POST /api/v1/employees", (req) => {
  const b = req.body as Record<string, string>;
  const f: Record<string, string[]> = {};
  const need = ["first_name", "last_name", "work_email", "phone", "job_title", "start_date", "employment_type", "work_pattern", "department_id"];
  for (const k of need) if (!b[k] || !String(b[k]).trim()) f[k] = ["Required"];
  if (b.work_email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(b.work_email)) f.work_email = ["Check the spelling"];
  if (b.work_email && PEOPLE.some((p) => p.work_email === b.work_email.toLowerCase())) f.work_email = ["is already in use"];
  if (b.phone && !NG_PHONE.test(b.phone.replace(/[\s\-().]/g, ""))) f.phone = ["must be a Nigerian phone number"];
  if (b.account_number && !/^\d{10}$/.test(b.account_number)) f.account_number = ["must be a 10-digit NUBAN"];
  if (b.gross_monthly && !/^\d{1,16}\.\d{2}$/.test(b.gross_monthly)) f.gross_monthly = ["must be an amount like 1250000.00"];
  if (Object.keys(f).length) return invalid(f);
  const key = b.work_email.split("@")[0];
  const dept = DEPTS.find((d) => d.department_id === b.department_id)?.name ?? "Operations & People";
  const p: MockPerson = {
    employee_id: sid(`employee:${key}`), user_key: key, staff_number: b.staff_number || `MCA-${String(PEOPLE.length + 1).padStart(4, "0")}`, first_name: b.first_name, last_name: b.last_name,
    display_name: `${b.first_name} ${b.last_name}`, job_title: b.job_title, department: dept, grade: "G1 · Associate", manager: byId(b.line_manager_id)?.user_key ?? "cynthia", work_email: b.work_email.toLowerCase(),
    phone: b.phone, start_date: b.start_date, date_of_birth: b.date_of_birth || "1998-01-01", employment_type: b.employment_type as "full_time", work_pattern: b.work_pattern as "hybrid", status: "probation",
    worksite: "MTN Head Office, Ikoyi", gross_monthly: b.gross_monthly || "0.00", bank_name: b.bank_name || "", account_last4: (b.account_number || "0000").slice(-4), next_of_kin: b.next_of_kin || "",
  };
  PEOPLE.push(p);
  TODAY.push({ person: p, mode: "None", clock_in: null, status: "not_yet", late_min: 0, kpi_pct: 0, open_tasks: 0 });
  return created(profile(p, req.user!));
});

const DEPTS = DEPARTMENTS.map((name) => ({ department_id: sid(`dept:${name}`), name }));
route("GET /api/v1/departments", (req) =>
  paged(DEPTS.map((d) => {
    const members = PEOPLE.filter((p) => p.department === d.name);
    const head = members.find((p) => /Head|Lead|Chief/.test(p.job_title)) ?? members[0];
    return { department_id: d.department_id, name: d.name, head: ref(head), headcount: members.length };
  }), req, { search: (r) => [r.name] }),
);

/* The reporting tree. A complete set by design: a tree with a missing branch is wrong. */
const VACANT = [{ seat_id: sid("seat:head-finance"), display_name: "Head, Finance", job_title: "Open role", department: "Finance", manager: "ifeoma" }];
const DOTTED: Record<string, string> = { adedotun: "Content Lead" };
route("GET /api/v1/org-chart", (req) => {
  const builder = req.query.view === "builder" && full(req.user!);
  const seatOf = (key: string | null) => (key ? sid(`seat:${key}`) : null);
  const nodes = [
    ...PEOPLE.filter((p) => p.status !== "suspended").map((p) => ({
      employee_id: p.employee_id, seat_id: seatOf(p.user_key)!, display_name: p.display_name, job_title: p.job_title, department: p.department,
      manager_seat_id: p.user_key === "amara" ? VACANT[0].seat_id : seatOf(p.manager), is_ceo: p.user_key === "ifeoma", vacant: false, dotted_line_to: DOTTED[p.user_key] ?? null,
      meta: builder ? `Since ${p.start_date.slice(0, 4)} · ${ARR[p.work_pattern].replace("Office-only", "On Site")}` : null,
    })),
    ...VACANT.map((v) => ({ employee_id: null, seat_id: v.seat_id, display_name: v.display_name, job_title: v.job_title, department: v.department, manager_seat_id: seatOf(v.manager), is_ceo: false, vacant: true, dotted_line_to: null, meta: null })),
  ];
  return ok({ nodes, seats: nodes.length, filled: nodes.filter((n) => !n.vacant).length });
});
route("PATCH /api/v1/employees/:id/line-manager", (req) => {
  const p = byId(req.params.id);
  const m = byId(req.body.line_manager_id as string);
  if (!p || !m) return notFound();
  if (p === m || teamOf(p.user_key).includes(m)) return invalid({ line_manager_id: ["would make a loop in the reporting line"] });
  p.manager = m.user_key;
  return ok({ ok: true });
});

/* ------------------------------------------------------------------ *
 * Leave
 * ------------------------------------------------------------------ */
type L = [string, string, number, number, number, string, string | null];
const L_ROWS: L[] = [
  ["hauwa", "Annual", -2, 1, 3, "Approved", "Family visit"], ["amara", "Annual", 6, 10, 5, "Pending", "Trip to Enugu"], ["chidera", "Compassionate", 0, 0, 1, "Pending", "Family emergency"],
  ["tolu", "Annual", 69, 78, 7, "Approved", "End of year break"], ["tobi", "Annual", -3, 2, 5, "Approved", null], ["kemi", "Sick", -12, -11, 2, "Approved", "Flu"],
  ["seyi", "Study", 20, 21, 2, "Approved", "AWS exam"], ["grace", "Annual", 30, 34, 5, "Rejected", "Clashes with Ember to Remember"], ["bashir", "Annual", 45, 49, 5, "Pending", "Wedding"],
  ["cynthia", "Annual", 72, 80, 6, "Approved", "Christmas"], ["obinna", "Paternity", -40, -27, 10, "Approved", null], ["blessing", "Annual", 14, 15, 2, "Cancelled", null],
];
const iso = (n: number) => (n >= 0 ? isoDaysAhead(n) : isoDaysAgo(-n));
const LEAVE = L_ROWS.map((l, i) => ({
  leave_id: sid(`leave:${i}`), number: `LV-${String(88 - i).padStart(4, "0")}`, employee: refKey(l[0]), key: l[0], type: l[1] as LeaveRequest["type"], from: iso(l[2]), to: iso(l[3]), days: l[4],
  reason: l[6], status: l[5] as LeaveRequest["status"], approver: l[5] === "Pending" ? null : "Cynthia Osakunih", submitted_at: at(5 + i, "10:00"),
}));
const leaveScope = (user: string, scope?: string) =>
  scope === "own" ? LEAVE.filter((l) => l.key === user) : scope === "team" || !full(user) ? LEAVE.filter((l) => teamOf(user).some((p) => p.user_key === l.key)) : LEAVE;

route("GET /api/v1/leave/requests", (req) =>
  paged(leaveScope(req.user!, req.query.scope), { ...req, query: Object.fromEntries(Object.entries(req.query).filter(([k]) => k !== "scope")) }, {
    search: (r) => [r.employee.display_name, r.type, r.number, r.reason],
    filters: { status: (r, v) => r.status === v, type: (r, v) => r.type === v },
  }),
);
route("GET /api/v1/leave/summary", (req) => {
  const l = leaveScope(req.user!, req.query.scope);
  const today = isoDaysAgo(0);
  return ok({ kpis: [
    { key: "today", label: "On Leave Today", value: String(l.filter((x) => x.status === "Approved" && x.from <= today && x.to >= today).length) },
    { key: "pending", label: "Pending Approval", value: String(l.filter((x) => x.status === "Pending").length), tone: "warn" },
    { key: "month", label: "Approved This Month", value: String(l.filter((x) => x.status === "Approved" && x.from.slice(0, 7) === today.slice(0, 7)).length) },
    { key: "clash", label: "Clashes", value: "0", tone: "ok" },
  ] });
});
route("GET /api/v1/leave/balances", (req) => {
  const mine = LEAVE.filter((l) => l.key === req.user);
  const taken = (t: string) => mine.filter((l) => l.type === t && l.status === "Approved" && l.to < isoDaysAgo(0)).reduce((a, l) => a + l.days, 0);
  const booked = (t: string) => mine.filter((l) => l.type === t && (l.status === "Approved" || l.status === "Pending") && l.to >= isoDaysAgo(0)).reduce((a, l) => a + l.days, 0);
  return ok({ year: new Date().getFullYear(), balances: [["Annual", 21], ["Sick", 10], ["Compassionate", 5], ["Study", 5]].map(([t, e]) => ({ type: t as "Annual", entitled: e as number, taken: taken(t as string) + (t === "Annual" ? 6 : 0), booked: booked(t as string), left: (e as number) - taken(t as string) - booked(t as string) - (t === "Annual" ? 6 : 0) })) });
});
route("POST /api/v1/leave/requests", (req) => {
  const b = req.body as { type: string; from: string; to: string; reason: string; employee_id?: string };
  const f: Record<string, string[]> = {};
  if (!b.from) f.from = ["Pick the first day"];
  if (!b.to) f.to = ["Pick the last day"];
  if (b.from && b.to && b.to < b.from) f.to = ["Ends before it starts"];
  if (b.type !== "Sick" && b.from && b.from < isoDaysAgo(0)) f.from = ["Starts in the past"];
  if (!b.reason || b.reason.trim().length < 3) f.reason = ["Give a short reason"];
  if (Object.keys(f).length) return invalid(f);
  const who = b.employee_id ? byId(b.employee_id)! : byKey(req.user)!;
  const days = Math.round((Date.parse(b.to) - Date.parse(b.from)) / 86400000) + 1;
  const l = { leave_id: sid(`leave:${Date.now()}`), number: `LV-${String(89 + LEAVE.length).padStart(4, "0")}`, employee: ref(who)!, key: who.user_key, type: b.type as LeaveRequest["type"], from: b.from, to: b.to, days, reason: b.reason, status: (b.employee_id ? "Approved" : "Pending") as LeaveRequest["status"], approver: b.employee_id ? byKey(req.user)!.display_name : null, submitted_at: new Date().toISOString() };
  LEAVE.unshift(l);
  return created(l);
});
route("POST /api/v1/leave/requests/:id/decision", (req) => {
  const l = LEAVE.find((x) => x.leave_id === req.params.id);
  if (!l) return notFound();
  if (l.key === req.user) return fail(403, "SELF_APPROVAL", "You cannot approve your own leave.");
  l.status = req.body.approve ? "Approved" : "Rejected";
  l.approver = byKey(req.user)!.display_name;
  return ok(l);
});
route("POST /api/v1/leave/requests/:id/cancel", (req) => {
  const l = LEAVE.find((x) => x.leave_id === req.params.id);
  if (!l) return notFound();
  l.status = "Cancelled";
  return ok(l);
});
route("GET /api/v1/leave/requests/:id/cover", (req) => {
  const l = LEAVE.find((x) => x.leave_id === req.params.id);
  if (!l) return notFound();
  const p = byKey(l.key)!;
  const peers = PEOPLE.filter((x) => x.department === p.department && x !== p);
  return ok({
    title: `Cover Check, ${l.from.split("-").reverse().join("/")} to ${l.to.split("-").reverse().join("/")}`,
    text: `${p.display_name} has requested ${l.days} day${l.days === 1 ? "" : "s"}. This is what is open in that window.`,
    rows: [
      { title: `${p.department} cover`, text: peers.length ? `${peers[0].display_name} is in that week` : `Nobody else in ${p.department}`, tone: peers.length ? "ok" : "err", result: peers.length ? "Clear" : "Conflict" },
      { title: "Tasks due in the window", text: "2 tasks, both can move", tone: "warn", result: "Needs agreement" },
      { title: "Others on leave", text: `${LEAVE.filter((x) => x !== l && x.status === "Approved" && x.from <= l.to && x.to >= l.from && byKey(x.key)!.department === p.department).length} in the same department`, tone: "ok", result: "Clear" },
      { title: "Payroll run", text: "Not in the window", tone: "ok", result: "Clear" },
    ],
  });
});

export const _reports = reportsOf;
