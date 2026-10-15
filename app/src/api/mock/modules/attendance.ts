import { audit } from "../data/audit";
import type { AttendancePolicy, Device, FieldAssignment, LocationRequest, PolicySetting, ReconCase } from "@/api/types/attendance";
import { at, created, fail, invalid, isoDaysAgo, isoDaysAhead, notFound, ok, paged, route, sid, fold } from "../core";
import { byId, byKey, PEOPLE, ref, refKey, teamOf, SIGN_INS } from "../data/people";
import { HISTORY, STATUS_PILL, TODAY } from "../data/attendance";

/* ------------------------------------------------------------------ *
 * The person's own day (Clock In panel)
 * ------------------------------------------------------------------ */
const state = new Map<string, { in: string | null; out: string | null }>();
const ARR: Record<string, "Remote" | "Hybrid" | "Field" | "Office-only"> = { hybrid: "Hybrid", remote: "Remote", on_site: "Office-only" };
const arrOf = (key: string) => (key === "adedotun" || key === "grace" ? "Field" : ARR[byKey(key)!.work_pattern]);
const PROFILE: Record<string, string> = { Remote: "Remote · approved home geofence", Hybrid: "Hybrid · office and home days", Field: "Field · assignment first", "Office-only": "Office-only · worksite geofence" };

route("GET /api/v1/attendance/me/today", (req) => {
  const p = byKey(req.user)!;
  const s = state.get(p.user_key) ?? { in: null, out: null };
  const onLeave = p.status === "on_leave";
  return ok({
    date: isoDaysAgo(0),
    state: onLeave ? "unavailable" : s.out ? "complete" : s.in ? "clocked_in" : "not_clocked",
    unavailable_reason: onLeave ? "leave" : null,
    unavailable_message: onLeave ? "You are on approved leave today, so attendance is not recorded." : null,
    clock_in_at: s.in,
    clock_out_at: s.out,
    shift_start: "09:00",
    shift_end: new Date().getDay() === 6 ? "15:00" : "17:00",
    grace_minutes: 10,
    work_pattern: PROFILE[arrOf(p.user_key)],
    location_label: p.work_pattern === "remote" ? "Approved home location" : p.worksite,
    location_radius_m: p.work_pattern === "remote" ? 100 : 120,
    policy_ack_pending: POLICY.acknowledged.has(p.user_key) ? null : { version: POLICY.current.version, blocks_clock_in: false },
  });
});

route("POST /api/v1/attendance/punches", (req) => {
  const p = byKey(req.user)!;
  const kind = req.body.kind === "out" ? "out" : "in";
  const s = state.get(p.user_key) ?? { in: null, out: null };
  if (kind === "in" && s.in) return fail(409, "ALREADY_CLOCKED_IN", "You have already clocked in today.");
  if (kind === "out" && !s.in) return fail(409, "NOT_CLOCKED_IN", "Clock in first.");
  const now = new Date().toISOString();
  const hasLocation = typeof req.body.latitude === "number";
  if (!hasLocation && !req.body.explanation) {
    return ok({ result: "review", title: "Attendance will be reviewed", message: "Your location was not shared, so this was saved for People to review. Add a few words on why.", event_id: null, case_number: null });
  }
  state.set(p.user_key, kind === "in" ? { in: now, out: null } : { ...s, out: now });
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  if (!hasLocation) {
    CASES.unshift(mkCase(p.user_key, 0, "GPS could not be verified", "Awaiting HR", String(req.body.explanation)));
  }
  return ok({
    result: hasLocation ? "accepted" : "review",
    title: hasLocation ? `${kind === "in" ? "Clocked in" : "Clocked out"} at ${hm}` : "Saved for review",
    message: hasLocation ? `Location verified within ${p.work_pattern === "remote" ? "your approved home location" : p.worksite}.` : `People will review the explanation you sent. Reference ${CASES[0].number}.`,
    event_id: sid(`punch:${p.user_key}:${now}`),
    case_number: hasLocation ? null : CASES[0].number,
  });
});

/* ------------------------------------------------------------------ *
 * Own history (ESS · My Attendance)
 * ------------------------------------------------------------------ */
const toEvent = (h: (typeof HISTORY)[number]) => ({
  event_id: h.event_id, employee: ref(h.person)!, date: h.date, clock_in_at: h.clock_in_at, clock_out_at: h.clock_out_at, worked_minutes: h.worked_minutes,
  location: h.location, status: h.status, late_minutes: h.late_minutes, note: h.note,
});
route("GET /api/v1/attendance/me", (req) =>
  paged(HISTORY.filter((h) => h.person.user_key === req.user).map(toEvent), req, {
    search: (r) => [r.location, r.status, r.note],
    filters: { month: (r, v) => r.date.startsWith(v), status: (r, v) => r.status === v },
  }),
);
route("GET /api/v1/attendance/me/summary", (req) => {
  const month = req.query.month ?? isoDaysAgo(0).slice(0, 7);
  const mine = HISTORY.filter((h) => h.person.user_key === req.user && h.date.startsWith(month));
  const worked = mine.filter((h) => h.clock_in_at);
  const late = mine.filter((h) => h.status === "late");
  const mins = worked.reduce((a, h) => a + (h.worked_minutes ?? 0), 0);
  return ok({
    kpis: [
      { key: "days", label: "Days Worked", value: `${worked.length} / ${mine.length}` },
      { key: "ontime", label: "On Time", value: `${worked.length ? Math.round(((worked.length - late.length) / worked.length) * 100) : 100}%`, tone: late.length ? "warn" : "ok", sub: `${late.length} late` },
      { key: "hours", label: "Hours This Month", value: `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m` },
      { key: "review", label: "Under Review", value: String(CASES.filter((c) => c.employee.employee_id === byKey(req.user)!.employee_id && c.status !== "Resolved").length), tone: "warn" },
    ],
    open_cases: CASES.filter((c) => c.employee.employee_id === byKey(req.user)!.employee_id && c.status !== "Resolved"),
  });
});

/* ------------------------------------------------------------------ *
 * Register (People · Attendance)
 * ------------------------------------------------------------------ */
const DEVICES_SEED: Array<[string, string, string]> = [
  ["seyi", "Pixel 7 · Chrome", "Pending Review"], ["seyi", "MacBook Air · Safari", "Enrolled"], ["bashir", "iPhone 13 · Safari", "Enrolled"], ["cynthia", "iPhone 14 · Safari", "Enrolled"],
  ["tolu", "Galaxy S22 · Chrome", "Enrolled"], ["emeka", "Tecno Camon 20 · Chrome", "Enrolled"], ["amara", "ThinkPad · Edge", "Enrolled"], ["chidera", "iPhone 11 · Safari", "Enrolled"],
  ["adedotun", "Pixel 6 · Chrome", "Enrolled"], ["musa", "Infinix Hot 12 · Chrome", "Revoked"], ["kemi", "Galaxy A54 · Chrome", "Verification unavailable"], ["obinna", "Unknown Android · Chrome", "Blocked"],
];
const DEVICES = DEVICES_SEED.map(([k, name, status], i) => ({ device_id: sid(`dev:${i}`), key: k, name, status: status as Device["status"], first_seen: at(30 + i * 9, "08:10"), last_punch: at(i % 3, "08:0" + (i % 9)), note: i === 0 ? "First seen today, from a new browser." : i === 9 ? "Revoked when the account was suspended." : null }));

const EFFECT = (status: string): { tone: "ok" | "warn" | "err" | "neutral"; text: string } =>
  status === "Enrolled" ? { tone: "ok", text: "Accepted" } : status === "Blocked" || status === "Revoked" ? { tone: "err", text: "Blocked" } : { tone: "warn", text: "Accepted with warning" };

function registerRows(scopeKeys: Set<string> | null) {
  return TODAY.filter((t) => !scopeKeys || scopeKeys.has(t.person.user_key)).map((t) => {
    const arr = arrOf(t.person.user_key);
    const dev = DEVICES.find((d) => d.key === t.person.user_key && (d.status === "Pending Review" || d.status === "Enrolled"));
    const cs = CASES.find((c) => c.employee.employee_id === t.person.employee_id && c.status !== "Resolved" && c.date === isoDaysAgo(0));
    const exception = t.status === "late" ? `Late by ${t.late_min} minutes` : t.status === "new_device" ? "New device, warned" : t.status === "no_clockout" ? "No clock-out yesterday" : null;
    return {
      employee: ref(t.person)!,
      arrangement: arr,
      clock_in: t.clock_in,
      clock_out: null,
      expected_location: arr === "Remote" ? "Approved home" : arr === "Field" ? "Field assignment FA-0031" : t.person.worksite,
      matched_location: t.clock_in ? (arr === "Remote" || t.mode === "Remote" ? "Approved home · inside 100 m" : t.person.worksite) : null,
      device: t.clock_in ? (dev?.name ?? "iPhone · Safari") : null,
      device_status: t.clock_in ? { tone: dev?.status === "Pending Review" ? ("warn" as const) : ("ok" as const), text: dev?.status ?? "Enrolled" } : null,
      status: STATUS_PILL[t.status],
      exception,
      case_number: cs?.number ?? null,
      _f: [arr, t.status, cs ? "recon" : "", !t.clock_in && t.status !== "leave" ? "missing" : "", t.status === "no_clockout" ? "missing" : ""],
    };
  });
}
const scopeSet = (user: string, scope?: string) =>
  scope === "team" || !["operations", "ceo"].includes(SIGN_INS[user]?.view ?? "") ? new Set(teamOf(user).map((p) => p.user_key)) : null;

const FILTERS: Array<[string, string, (f: string[]) => boolean]> = [
  ["Remote", "Remote", (f) => f[0] === "Remote"], ["Hybrid", "Hybrid", (f) => f[0] === "Hybrid"], ["Field", "Field", (f) => f[0] === "Field"],
  ["Office", "Office", (f) => f[0] === "Office-only"], ["late", "Late", (f) => f[1] === "late"], ["missing", "Missing Punch", (f) => f.includes("missing")],
  ["recon", "Needs Reconciliation", (f) => f[2] === "recon"],
];

route("GET /api/v1/attendance/summary", (req) => {
  const rows = registerRows(scopeSet(req.user!, req.query.scope));
  const n = rows.length;
  const inn = rows.filter((r) => r.clock_in).length;
  const late = rows.filter((r) => r._f[1] === "late").length;
  const hours = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map((h) => rows.filter((r) => r.clock_in && Number(r.clock_in.slice(0, 2)) < h + 1).length);
  const recon = CASES.filter((c) => c.status === "Awaiting HR").length;
  return ok({
    date: isoDaysAgo(0),
    scope: req.query.scope === "team" ? "team" : "all",
    kpis: [
      { key: "in", label: "Clocked in", value: `${inn} / ${n}` },
      { key: "site", label: "On Site", value: String(rows.filter((r) => r.clock_in && r.matched_location && !r.matched_location.startsWith("Approved home")).length) },
      { key: "remote", label: "Remote", value: String(rows.filter((r) => r.matched_location?.startsWith("Approved home")).length) },
      { key: "field", label: "On Assignment", value: String(rows.filter((r) => r.arrangement === "Field" && r.clock_in).length) },
      { key: "late", label: "Late", value: String(late), tone: late ? "warn" : undefined },
      { key: "out", label: "Outside Geofence", value: "1", tone: "warn" },
      { key: "missout", label: "Missing Clock-Out", value: String(CASES.filter((c) => c.type === "Missing Clock-Out" && c.status !== "Resolved").length), tone: "err" },
      { key: "recon", label: "Needs Reconciliation", value: String(recon), tone: recon ? "warn" : "ok" },
    ],
    hours,
    on_time_pct: Math.round((inn / Math.max(1, n)) * 100),
    donut_text: `${inn} of ${n} have clocked in. ${late} late, ${rows.filter((r) => r._f[1] === "leave").length} on approved leave.`,
    filters: FILTERS.map(([value, label, test]) => ({ value, label, count: rows.filter((r) => test(r._f)).length })),
  });
});
route("GET /api/v1/attendance/register", (req) => {
  const rows = registerRows(scopeSet(req.user!, req.query.scope));
  const test = Object.fromEntries(FILTERS.map(([v, , t]) => [v, t]));
  return paged(rows, { ...req, query: Object.fromEntries(Object.entries(req.query).filter(([k]) => k !== "scope")) }, {
    search: (r) => [r.employee.display_name, r.employee.department, r.expected_location],
    filters: { filter: (r, v) => !!test[v]?.(r._f) },
  });
});
route("GET /api/v1/attendance/register/:employee_id", (req) => {
  const p = byId(req.params.employee_id);
  if (!p) return notFound();
  const t = TODAY.find((x) => x.person.user_key === p.user_key)!;
  const arr = arrOf(p.user_key);
  const events = t.clock_in
    ? [{
        event_number: `EV-${String(3000 + PEOPLE.indexOf(p)).padStart(5, "0")}`, kind: "in" as const, system_time: t.clock_in, device_time: t.clock_in, gps: "6.4474, 3.4216", accuracy_m: 14,
        expected: arr === "Remote" ? "Approved home" : p.worksite, matched: arr === "Remote" ? "Approved home" : p.worksite, distance: "38 m", device: "iPhone · Safari",
        device_status: t.status === "new_device" ? "Pending Review" : "Enrolled", result: t.status === "late" ? "Accepted, late" : "Accepted", exception: t.status === "late" ? `Late by ${t.late_min} minutes` : null,
        policy_version: `v${POLICY.current.version}`, source: "Employee device", superseded: false,
      }]
    : [];
  return ok({
    employee: ref(p)!, date: isoDaysAgo(0), arrangement: `${arr} · ${t.mode}`, shift: new Date().getDay() === 6 ? "09:00 to 15:00" : "09:00 to 17:00",
    status: STATUS_PILL[t.status], hours: t.clock_in ? "In progress" : "None", events, case_number: CASES.find((c) => c.employee.employee_id === p.employee_id && c.status !== "Resolved")?.number ?? null,
  });
});

/* ------------------------------------------------------------------ *
 * Field assignments
 * ------------------------------------------------------------------ */
const ASSIGNMENTS = [
  ["Ember to Remember venue check", ["adedotun", "grace"], "Activation team", "MTN Ember to Remember", [["Terra Kulture, VI", 150], ["Muri Okunola Park", 200]], 0, "10:00", "16:00", "Ngozi Eze", "Approved", "Venue walk-through with MTN brand team"],
  ["Enugu city launch recce", ["tolu", "emeka"], null, "Enugu city launch", [["Polo Park Mall, Enugu", 250]], -3, "09:00", "17:00", "Ifeoma Chukwu", "Awaiting manager", null],
  ["Ikeja City Mall shoot", ["yusuf", "rotimi"], "Studio", "Ikeja City Mall", [["Ikeja City Mall", 200]], 2, "08:00", "14:00", "Emeka Obi", "Completed", null],
  ["ProvidusBank branch content", ["kemi"], null, "ProvidusBank", [["Providus, Adeola Odeku", 100]], 5, "11:00", "15:00", "Tolu Adeyemi", "Completed", null],
].map((a, i) => ({
  assignment_id: sid(`fa:${i}`), number: `FA-${String(31 - i).padStart(4, "0")}`, name: a[0] as string, employees: (a[1] as string[]).map(refKey), team: a[2] as string | null,
  client: a[3] as string, sites: (a[4] as Array<[string, number]>).map(([name, radius_m]) => ({ name, radius_m })), date: (a[5] as number) < 0 ? isoDaysAhead(-(a[5] as number)) : isoDaysAgo(a[5] as number),
  start: a[6] as string, end: a[7] as string, approver: a[8] as string, status: a[9] as FieldAssignment["status"], note: a[10] as string | null,
}));
route("GET /api/v1/attendance/assignments", (req) => paged(ASSIGNMENTS, req, { search: (r) => [r.name, r.client, r.number, ...r.employees.map((e) => e.display_name)], filters: { status: (r, v) => r.status === v } }));
route("POST /api/v1/attendance/assignments", (req) => {
  const b = req.body as { name: string; employee_ids: string[]; client: string; site_name: string; radius_m: number; date: string; start: string; end: string; note?: string };
  const fields: Record<string, string[]> = {};
  if (!b.name) fields.name = ["Name the assignment"];
  if (!b.employee_ids?.length) fields.employee_ids = ["Pick at least one person"];
  if (!b.date) fields.date = ["Pick a date"];
  if (b.radius_m < 100 || b.radius_m > 500) fields.radius_m = ["Between 100 and 500"];
  if (Object.keys(fields).length) return invalid(fields);
  const a = { assignment_id: sid(`fa:${Date.now()}`), number: `FA-${String(32 + ASSIGNMENTS.length).padStart(4, "0")}`, name: b.name, employees: b.employee_ids.map((id) => ref(byId(id))!), team: null, client: b.client, sites: [{ name: b.site_name, radius_m: b.radius_m }], date: b.date, start: b.start, end: b.end, approver: "Line manager", status: "Awaiting manager" as FieldAssignment["status"], note: b.note ?? null };
  ASSIGNMENTS.unshift(a);
  return created(a);
});
route("POST /api/v1/attendance/assignments/:id/approve", (req) => {
  const a = ASSIGNMENTS.find((x) => x.assignment_id === req.params.id);
  if (!a) return notFound();
  a.status = "Approved";
  return ok(a);
});

/* ------------------------------------------------------------------ *
 * Work location requests
 * ------------------------------------------------------------------ */
const REQUESTS = [
  ["chidera", "Temporary home-location change", 2, 6, "Yaba, Lagos", "12 Herbert Macaulay Way, Yaba", "Staying with family while my flat is repaired", "Awaiting HR", "I know about this and support it"],
  ["amara", "Remote day", 1, 1, "Surulere, Lagos", null, "Plumber visit, will work from home", "Awaiting manager", null],
  ["bashir", "Client visit", 0, 0, "Eko Hotels, VI", "Plot 1415 Adetokunbo Ademola, VI", "Re-engagement meeting with Eko Hotels", "Approved", "Supported"],
  ["cynthia", "Temporary home-location change", 9, 12, "Lekki Phase 1", "4 Admiralty Way, Lekki", "Home renovation", "Awaiting HR", null],
  ["kemi", "Remote day", -14, -14, "Ikorodu, Lagos", null, "Hospital appointment in the morning", "Expired", null],
  ["obinna", "Field correction", -3, -3, "Ikeja", null, "Clocked in from the client site by mistake", "Rejected", null],
].map((r, i) => ({
  request_id: sid(`lr:${i}`), number: `LR-${String(58 - i).padStart(4, "0")}`, employee: refKey(r[0] as string), key: r[0] as string, type: r[1] as LocationRequest["type"],
  from: (r[2] as number) >= 0 ? isoDaysAhead(r[2] as number) : isoDaysAgo(-(r[2] as number)), to: (r[3] as number) >= 0 ? isoDaysAhead(r[3] as number) : isoDaysAgo(-(r[3] as number)),
  area: r[4] as string, address: r[5] as string | null, radius_m: 100, reason: r[6] as string, evidence: null as string | null, status: r[7] as LocationRequest["status"], manager_note: r[8] as string | null, hr_note: null as string | null,
  history: [{ at: at(2 + i, "10:12"), by: byKey(r[0] as string)!.display_name, text: "Submitted" }],
}));
route("GET /api/v1/attendance/location-requests", (req) => {
  const scope = req.query.scope ?? "all";
  const team = new Set(teamOf(req.user!).map((p) => p.user_key));
  const rows = REQUESTS.filter((r) => (scope === "own" ? r.key === req.user : scope === "team" ? team.has(r.key) : true));
  return paged(rows, { ...req, query: Object.fromEntries(Object.entries(req.query).filter(([k]) => k !== "scope")) }, { search: (r) => [r.number, r.employee.display_name, r.area, r.reason], filters: { status: (r, v) => r.status === v } });
});
route("POST /api/v1/attendance/location-requests", (req) => {
  const b = req.body as { type: string; from: string; to: string; address: string; reason: string; evidence?: string };
  const fields: Record<string, string[]> = {};
  if (!b.from) fields.from = ["Pick the first day"];
  if (!b.to) fields.to = ["Pick the last day"];
  if (b.from && b.to && b.to < b.from) fields.to = ["Ends before it starts"];
  if (!b.address || b.address.length < 6) fields.address = ["Enter the address"];
  if (!b.reason || b.reason.length < 10) fields.reason = ["Write at least 10 characters"];
  if (Object.keys(fields).length) return invalid(fields);
  const p = byKey(req.user)!;
  const r = { request_id: sid(`lr:${Date.now()}`), number: `LR-${String(59 + REQUESTS.length).padStart(4, "0")}`, employee: ref(p)!, key: p.user_key, type: b.type as LocationRequest["type"], from: b.from, to: b.to, area: b.address.split(",").slice(-2).join(",").trim() || b.address, address: b.address, radius_m: 100, reason: b.reason, evidence: b.evidence ?? null, status: "Awaiting manager" as LocationRequest["status"], manager_note: null as string | null, hr_note: null as string | null, history: [{ at: new Date().toISOString(), by: p.display_name, text: "Submitted" }] };
  REQUESTS.unshift(r);
  return created(r);
});
route("POST /api/v1/attendance/location-requests/:id/recommendation", (req) => {
  const r = REQUESTS.find((x) => x.request_id === req.params.id);
  if (!r) return notFound();
  r.manager_note = String(req.body.note ?? "");
  r.status = "Awaiting HR";
  r.history.push({ at: new Date().toISOString(), by: byKey(req.user)!.display_name, text: req.body.recommend ? "Recommended" : "Not recommended" });
  return ok(r);
});
route("POST /api/v1/attendance/location-requests/:id/decision", (req) => {
  const r = REQUESTS.find((x) => x.request_id === req.params.id);
  if (!r) return notFound();
  if (r.key === req.user) return fail(403, "SELF_APPROVAL", "You cannot approve your own request. It goes to the CEO.");
  r.status = req.body.approve ? "Approved" : "Rejected";
  r.hr_note = (req.body.note as string) || null;
  r.history.push({ at: new Date().toISOString(), by: byKey(req.user)!.display_name, text: req.body.approve ? "Approved by People" : "Rejected by People" });
  return ok(r);
});

/* ------------------------------------------------------------------ *
 * Reconciliation cases
 * ------------------------------------------------------------------ */
const SUGGEST: Record<string, string> = {
  "Missing Clock-Out": "add_out", "Missing clock-in": "add_in", "Outside home geofence": "approve_loc", "Field location without a matching assignment": "attach_fa",
  "Leave and attendance conflict": "leave", "Employee-submitted correction": "correct", "Duplicate punch": "exclude_dup", "GPS could not be verified": "add_in", "Outside Geofence": "approve_loc",
};
function mkCase(key: string, daysBack: number, type: string, status: string, explanation: string | null, n = CASES_SEQ++) {
  const p = byKey(key)!;
  return {
    case_id: sid(`case:${n}`), number: `ATT-${String(140 + n).padStart(4, "0")}`, employee: ref(p)!, department: p.department, arrangement: arrOf(key), date: isoDaysAgo(daysBack), type,
    status: status as ReconCase["status"], explanation, manager_note: null as string | null, payroll_impact: (type === "Missing Clock-Out" ? "Possible deduction" : "None") as ReconCase["payroll_impact"], suggested_outcome: SUGGEST[type] ?? "info",
    evidence: [["Expected", p.work_pattern === "remote" ? "Approved home, 100 m" : `${p.worksite}, 120 m`], ["Recorded", type.includes("geofence") ? "1.4 km from the fence" : type.includes("clock-out") ? "Clock-in 08:22, no clock-out" : "See the event trail"], ["Device", "Enrolled"], ["Policy", `v${POLICY_START}`]] as Array<[string, string]>,
  };
}
let CASES_SEQ = 0;
const POLICY_START = 4;
const CASES = [
  mkCase("emeka", 1, "Missing Clock-Out", "Awaiting HR", "Left for the Enugu recce at 15:30 and forgot to clock out."),
  mkCase("chidera", 0, "Outside home geofence", "Awaiting manager", "Working from my aunt's place while the flat is repaired. Request LR-0058 is in."),
  mkCase("grace", 2, "Field location without a matching assignment", "Awaiting HR", "Was at the Ikeja City Mall activation with Bashir."),
  mkCase("seyi", 0, "Duplicate punch", "Awaiting HR", null),
  mkCase("kemi", 4, "GPS could not be verified", "Awaiting employee", null),
  mkCase("tobi", 6, "Leave and attendance conflict", "Resolved", "Clocked in by habit on the first leave day."),
  mkCase("obinna", 3, "Employee-submitted correction", "Escalated", "Clock-in time should be 08:05, not 09:05."),
];
route("GET /api/v1/attendance/cases", (req) => {
  const scope = req.query.scope ?? "all";
  const team = new Set(teamOf(req.user!).map((p) => p.employee_id));
  const me = byKey(req.user)!.employee_id;
  const rows = CASES.filter((c) => (scope === "own" ? c.employee.employee_id === me : scope === "team" ? team.has(c.employee.employee_id) : true));
  return paged(rows, { ...req, query: Object.fromEntries(Object.entries(req.query).filter(([k]) => k !== "scope")) }, {
    search: (r) => [r.number, r.employee.display_name, r.type, r.department],
    filters: { status: (r, v) => (v === "open" ? r.status !== "Resolved" && r.status !== "Escalated" : r.status === v), type: (r, v) => fold(r.type) === fold(v) },
  });
});
route("POST /api/v1/attendance/cases/:id/decision", (req) => {
  const c = CASES.find((x) => x.case_id === req.params.id);
  if (!c) return notFound();
  const note = String(req.body.note ?? "");
  if (note.trim().length < 10) return invalid({ note: ["Write at least 10 characters"] });
  const outcome = String(req.body.outcome);
  c.status = outcome === "escalate" ? "Escalated" : outcome === "info" ? "Awaiting employee" : "Resolved";
  return ok(c);
});
route("POST /api/v1/attendance/cases/:id/explanation", (req) => {
  const c = CASES.find((x) => x.case_id === req.params.id);
  if (!c) return notFound();
  const e = String(req.body.explanation ?? "");
  if (e.trim().length < 10) return invalid({ explanation: ["Write at least 10 characters"] });
  c.explanation = e;
  c.status = "Awaiting manager";
  return ok(c);
});

/* ------------------------------------------------------------------ *
 * Devices
 * ------------------------------------------------------------------ */
const devOut = (d: (typeof DEVICES)[number]) => ({ device_id: d.device_id, employee: refKey(d.key), name: d.name, first_seen: d.first_seen, last_punch: d.last_punch, status: d.status, effect: EFFECT(d.status), note: d.note });
route("GET /api/v1/attendance/devices", (req) =>
  paged(DEVICES.filter((d) => req.query.scope !== "own" || d.key === req.user).map(devOut), { ...req, query: Object.fromEntries(Object.entries(req.query).filter(([k]) => k !== "scope")) }, {
    search: (r) => [r.name, r.employee.display_name],
    filters: { status: (r, v) => r.status === v },
  }),
);
route("GET /api/v1/attendance/devices/summary", () => {
  const n = (s: string) => DEVICES.filter((d) => d.status === s).length;
  return ok({
    counts: [
      { label: "Enrolled", value: String(n("Enrolled")), tone: "ok" }, { label: "New or Pending", value: String(n("Pending Review")), tone: n("Pending Review") ? "warn" : undefined },
      { label: "Blocked", value: String(n("Blocked")), tone: n("Blocked") ? "err" : undefined }, { label: "Revoked", value: String(n("Revoked")) }, { label: "Verification Unavailable", value: String(n("Verification unavailable")) },
    ],
    effects: ["Enrolled", "Pending Review", "Blocked", "Revoked", "Verification unavailable"].map((s) => ({ state: s === "Pending Review" ? "New or Pending" : s, effect: EFFECT(s) })),
    policy_version: POLICY.current.version,
  });
});
route("POST /api/v1/attendance/devices", (req) => {
  const mine = DEVICES.filter((d) => d.key === req.user && d.status !== "Revoked" && d.status !== "Blocked");
  if (mine.length >= 3) return fail(409, "DEVICE_LIMIT", "You already have three devices. Remove one first.");
  if (!String(req.body.name ?? "").trim()) return invalid({ name: ["Name the device"] });
  const d = { device_id: sid(`dev:${Date.now()}`), key: req.user!, name: String(req.body.name), status: "Pending Review" as Device["status"], first_seen: new Date().toISOString(), last_punch: null as unknown as string, note: (req.body.reason as string) || null };
  DEVICES.unshift(d);
  return created(devOut(d));
});
route("POST /api/v1/attendance/devices/:id/status", (req) => {
  const d = DEVICES.find((x) => x.device_id === req.params.id);
  if (!d) return notFound();
  d.status = req.body.status as Device["status"];
  return ok(devOut(d));
});

/* ------------------------------------------------------------------ *
 * Worksites and every geofenced location
 * ------------------------------------------------------------------ */
const SITES = [
  ["MTN Head Office, Ikoyi", "Office", "4 Aromire Road, Ikoyi, Lagos", 120, "Principal worksite", 590, 200],
  ["MyCity Studio, Yaba", "Office", "21 Herbert Macaulay Way, Yaba", 100, "Studio and production", 360, 110],
  ["MyCity Office, Lekki", "Office", "7 Admiralty Way, Lekki Phase 1", 120, "Overflow desks", 820, 230],
  ["Approved home · Lekki", "Approved home", "Masked · full address in the HR detail view", 100, "Cynthia Osakunih", 860, 205],
  ["Approved home · Surulere", "Approved home", "Masked · full address in the HR detail view", 100, "Amara Okafor", 300, 160],
  ["Approved home · Gbagada", "Approved home", "Masked · full address in the HR detail view", 100, "Seyi Balogun", 260, 80],
  ["Temporary location · Yaba", "Temporary location", "Masked · full address in the HR detail view", 100, "Chidera Nwosu", 380, 140],
  ["FA-0031 · Terra Kulture, VI", "Field assignment", "1376 Tiamiyu Savage St, Victoria Island", 150, "Adedotun Oyinloye, Grace Okon", 640, 230],
  ["FA-0031 · Muri Okunola Park", "Field assignment", "Muri Okunola Park, Victoria Island", 200, "Adedotun Oyinloye, Grace Okon", 680, 250],
].map((s, i) => ({
  location_id: sid(`ws:${i}`), name: s[0] as string, type: s[1] as "Office", address: s[2] as string, radius_m: s[3] as number, assigned: s[4] as string,
  attendance_today: [9, 4, 2, 1, 1, 1, 0, 2, 0][i], dates: s[1] === "Field assignment" ? `Today, 10:00 to 16:00` : s[1] === "Temporary location" ? "Pending Approval" : "Onwards",
  mode: s[1] === "Office" ? "Hybrid: warn · Office-only: block" : s[1] === "Field assignment" ? "Warn" : "Warn", status: s[1] === "Temporary location" ? "Pending" : "Active",
  status_tone: (s[1] === "Temporary location" ? "warn" : "ok") as "ok", map: { x: s[5] as number, y: s[6] as number },
}));
route("GET /api/v1/attendance/worksites", (req) => paged(SITES, req, { search: (r) => [r.name, r.address, r.assigned], filters: { type: (r, v) => r.type === v } }));
route("POST /api/v1/attendance/worksites", (req) => {
  const b = req.body as { name: string; address: string; radius_m: number };
  const fields: Record<string, string[]> = {};
  if (!b.name) fields.name = ["Name the worksite"];
  if (!b.address) fields.address = ["Enter the address"];
  if (!(b.radius_m >= 50 && b.radius_m <= 300)) fields.radius_m = ["Between 50 and 300"];
  if (Object.keys(fields).length) return invalid(fields);
  const w = { location_id: sid(`ws:${b.name}`), name: b.name, type: "Office" as const, address: b.address, radius_m: b.radius_m, assigned: "None yet", attendance_today: 0, dates: "Onwards", mode: "Hybrid: warn · Office-only: block", status: "Active", status_tone: "ok" as const, map: null as unknown as { x: number; y: number } };
  SITES.splice(3, 0, w);
  return created(w);
});

/* ------------------------------------------------------------------ *
 * Policy: versions, a draft, publishing, acknowledgment
 * ------------------------------------------------------------------ */
const SETTINGS: PolicySetting[] = [
  { key: "wk_start", section: "Working Day", label: "Shift Start", help: "The default start time. A person's schedule can differ.", kind: "time", value: "09:00" },
  { key: "grace", section: "Working Day", label: "Grace Minutes", help: "Minutes after the start before a clock-in counts as late.", kind: "number", value: 10, min: 0, max: 60 },
  { key: "sat_half", section: "Working Day", label: "Saturday Half Day", help: "The working week is set per day (A22).", kind: "bool", value: true },
  { key: "late_rule", section: "Lateness", label: "Lates Before a Query", help: "How many late arrivals in 30 days raise a query automatically in Queries & Sanctions.", kind: "number", value: 3, min: 1, max: 10 },
  { key: "mode_remote", section: "Location Verification", label: "Remote Outside Home", help: "What happens when a remote employee clocks in outside the 100 m home geofence.", kind: "mode", value: "warn", options: ["record", "warn", "block"] },
  { key: "mode_hybrid", section: "Location Verification", label: "Hybrid Outside Location", help: "Office days check the office, remote days check the home.", kind: "mode", value: "warn", options: ["record", "warn", "block"] },
  { key: "mode_office", section: "Location Verification", label: "Office-Only Outside Office", help: "Office-only staff must be inside their assigned office geofence.", kind: "mode", value: "block", options: ["record", "warn", "block"] },
  { key: "mode_field", section: "Location Verification", label: "Field Outside Assignment", help: "An approved field assignment overrides office and home for its window.", kind: "mode", value: "warn", options: ["record", "warn", "block"] },
  { key: "radius_remote", section: "Location Verification", label: "Home Geofence Radius", help: "Fixed at 100 m for registered and temporary homes.", kind: "locked", value: "100 m · fixed" },
  { key: "good_acc", section: "Location Verification", label: "GPS Accuracy, Metres", help: "A reading at or better than this is used as it is.", kind: "number", value: 50, min: 10, max: 200 },
  { key: "dev_record", section: "Devices", label: "Record Device on Punch", help: "Devices are recorded so the policy can be tightened later without losing history.", kind: "bool", value: true },
  { key: "dev_warn_new", section: "Devices", label: "Warn on New Device", help: "Accept the punch from an unenrolled device with a warning, and send it for review.", kind: "bool", value: true },
  { key: "dev_block_unenrolled", section: "Devices", label: "Block Unenrolled Devices", help: "Refuse punches from a device People have not enrolled.", kind: "bool", value: false },
  { key: "deduction_tiers", section: "Payroll", label: "Lateness Deduction Tiers", help: "When on, reviewed late arrivals carry a computed deduction (10%, 20%, 30% of the day by the hour). A person still accepts each one in Payroll.", kind: "bool", value: false },
  { key: "ack_blocks", section: "Acknowledgment", label: "Read Before Clock-In", help: "When on, Clock In waits until the employee acknowledges the latest version.", kind: "bool", value: false },
];
const POLICY = {
  current: {
    version: POLICY_START, published_at: at(6, "11:20"), published_by: "Cynthia Osakunih", summary: "Saturday half day added; Office-only staff now blocked outside the office.",
    changes: ["Saturday is a half day, 09:00 to 15:00", "Office-only: outside the office is now blocked, not warned", "Grace period stays at 10 minutes"],
    settings: SETTINGS, acknowledged_at: null as string | null, draft: null as AttendancePolicy["draft"],
  } as AttendancePolicy,
  acknowledged: new Set(["cynthia", "ifeoma", "tolu", "bashir", "seyi"]),
  history: [
    { version: 3, published_at: at(48, "10:00"), published_by: "Cynthia Osakunih", summary: "Device recording switched on for everyone.", changes: ["Record Device on Punch"] },
    { version: 2, published_at: at(96, "09:30"), published_by: "Cynthia Osakunih", summary: "Field assignments introduced.", changes: ["An approved field assignment overrides office and home"] },
    { version: 1, published_at: at(140, "12:00"), published_by: "Ifeoma Chukwu", summary: "First attendance policy.", changes: ["Geofenced clock-in for every arrangement"] },
  ],
};
const withAck = (user: string, p: AttendancePolicy): AttendancePolicy => ({ ...p, acknowledged_at: POLICY.acknowledged.has(user) && p.version === POLICY.current.version ? at(5, "09:02") : p.version < POLICY.current.version ? at(50, "09:00") : null });
route("GET /api/v1/attendance/policies/current", (req) => ok(withAck(req.user!, POLICY.current)));
route("GET /api/v1/attendance/policies", (req) =>
  paged([POLICY.current, ...POLICY.history.map((h) => ({ ...h, settings: [], acknowledged_at: null, draft: null }))].map((p) => withAck(req.user!, p as AttendancePolicy)), req, { search: (r) => [r.summary, String(r.version)] }),
);
route("PATCH /api/v1/attendance/policies/draft", (req) => {
  const changes = (req.body.settings ?? {}) as Record<string, string | number | boolean>;
  const base = POLICY.current.draft?.settings ?? SETTINGS.map((s) => ({ ...s }));
  const next = base.map((s) => (s.key in changes && s.kind !== "locked" ? { ...s, value: changes[s.key] } : s));
  const changed = next.filter((s) => SETTINGS.find((o) => o.key === s.key)!.value !== s.value).map((s) => s.key);
  POLICY.current.draft = changed.length ? { changed_keys: changed, settings: next } : null;
  Object.keys(changes).forEach((k) => {
    const f = SETTINGS.find((o) => o.key === k);
    if (f) audit(byKey(req.user)!.display_name, "Policy draft changed", `Attendance policy draft · ${f.label}`, String(f.value), String(changes[k]), "Not published, nobody notified", "Attendance");
  });
  return ok(POLICY.current);
});
route("POST /api/v1/attendance/policies/draft/discard", () => {
  POLICY.current.draft = null;
  return ok(POLICY.current);
});
route("POST /api/v1/attendance/policies/publish", (req) => {
  const d = POLICY.current.draft;
  if (!d) return fail(409, "NO_DRAFT", "There is nothing to publish.");
  const summary = String(req.body.summary ?? "").trim();
  if (summary.length < 10) return invalid({ summary: ["Write at least 10 characters"] });
  POLICY.history.unshift({ version: POLICY.current.version, published_at: POLICY.current.published_at, published_by: POLICY.current.published_by, summary: POLICY.current.summary, changes: POLICY.current.changes });
  d.settings.forEach((s) => (SETTINGS.find((o) => o.key === s.key)!.value = s.value));
  POLICY.current = { ...POLICY.current, version: POLICY.current.version + 1, published_at: new Date().toISOString(), published_by: byKey(req.user)!.display_name, summary, changes: d.changed_keys.map((k) => SETTINGS.find((s) => s.key === k)!.label), draft: null };
  POLICY.acknowledged = new Set([req.user!]);
  audit(byKey(req.user)!.display_name, "Policy published", "Attendance policy", `v${POLICY.current.version - 1}`, `v${POLICY.current.version}`, summary, "Attendance");
  return ok(POLICY.current);
});
route("GET /api/v1/attendance/policies/:version/acknowledgements", (req) =>
  paged(
    PEOPLE.filter((p) => p.status !== "suspended").map((p, i) => ({ employee: refKey(p.user_key), read_at: POLICY.acknowledged.has(p.user_key) || i % 3 === 0 ? at(5, "09:00") : null, acknowledged_at: POLICY.acknowledged.has(p.user_key) ? at(5, "09:02") : null })).sort((a, b) => Number(!!b.acknowledged_at) - Number(!!a.acknowledged_at)),
    req,
    { search: (r) => [r.employee.display_name] },
  ),
);
route("POST /api/v1/attendance/policies/:version/acknowledge", (req) => {
  POLICY.acknowledged.add(req.user!);
  return ok(withAck(req.user!, POLICY.current));
});

/* ------------------------------------------------------------------ *
 * A person's attendance setup (People · Employees)
 * ------------------------------------------------------------------ */
const SETUP_OVERRIDES = new Map<string, { arrangement?: string; schedule?: Record<string, "Office" | "Remote">; history: Array<{ title: string; when: string; text: string }> }>();
route("GET /api/v1/attendance/setup/:employee_id", (req) => {
  const p = byId(req.params.employee_id);
  if (!p) return notFound();
  const o = SETUP_OVERRIDES.get(p.user_key);
  const arr = (o?.arrangement as ReturnType<typeof arrOf> | undefined) ?? arrOf(p.user_key);
  const home = arr === "Remote" || arr === "Hybrid";
  const fa = ASSIGNMENTS.find((a) => a.date === isoDaysAgo(0) && a.employees.some((e) => e.employee_id === p.employee_id));
  const tmp = REQUESTS.find((r) => r.key === p.user_key && r.type === "Temporary home-location change");
  return ok({
    employee: ref(p)!, arrangement: arr, primary_location: arr === "Remote" ? "Approved home" : arr === "Field" ? "Field assignment first" : p.worksite,
    office: p.worksite === "Remote" ? "MTN Head Office, Ikoyi" : p.worksite, office_radius_m: 120,
    home_area: home ? ["Lekki", "Surulere", "Gbagada", "Yaba", "Ikeja"][PEOPLE.indexOf(p) % 5] : null,
    home_address: home ? `${10 + PEOPLE.indexOf(p)} Adebayo Street, ${["Lekki", "Surulere", "Gbagada", "Yaba", "Ikeja"][PEOPLE.indexOf(p) % 5]}, Lagos` : null,
    home_radius_m: home ? 100 : null, field_assignment_today: fa ? `${fa.number} · ${fa.name}, ${fa.start} to ${fa.end}` : null,
    temporary_location: tmp ? { tone: tmp.status === "Approved" ? "ok" : tmp.status === "Awaiting HR" || tmp.status === "Awaiting manager" ? "warn" : "neutral", text: `${tmp.status} · ${tmp.area}` } : { tone: "neutral", text: "None" },
    schedule: arr === "Hybrid" ? (o?.schedule ?? { Mon: "Office", Tue: "Office", Wed: "Remote", Thu: "Office", Fri: "Office", Sat: "Remote" }) : null,
    profile: `${PROFILE[arr]} · policy v${POLICY.current.version}`,
    history: o?.history ?? [{ title: `Arrangement set to ${arr}`, when: `${p.start_date.split("-").reverse().join("/")} · Cynthia Osakunih`, text: "On joining." }],
  });
});
route("PATCH /api/v1/attendance/setup/:employee_id", (req) => {
  const p = byId(req.params.employee_id);
  if (!p) return notFound();
  if (String(req.body.reason ?? "").trim().length < 5) return invalid({ reason: ["Give a reason"] });
  const o = SETUP_OVERRIDES.get(p.user_key) ?? { history: [] };
  const before = o.arrangement ?? arrOf(p.user_key);
  if (req.body.arrangement) o.arrangement = String(req.body.arrangement);
  if (req.body.schedule) o.schedule = req.body.schedule as Record<string, "Office">;
  o.history.unshift({ title: `Arrangement: ${before} → ${o.arrangement ?? before}`, when: `Just now · ${byKey(req.user)!.display_name}`, text: String(req.body.reason) });
  SETUP_OVERRIDES.set(p.user_key, o);
  return ok({ ok: true });
});

/** Read by Payroll: is the lateness tier setting on in the published policy? */
export const deductionTiersOn = () => SETTINGS.find((x) => x.key === "deduction_tiers")?.value === true;
