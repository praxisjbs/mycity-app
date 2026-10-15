import type { HomeAlert, HomeBlock, HomeKpi, HomeReport, KpiCell, KpiDetailMeta, KpiRow } from "@/api/types/home";
import { at, created, isoDaysAgo, notFound, ok, paged, route, sid, type Req } from "../core";
import { byKey, PEOPLE, ref, refKey, teamOf, SIGN_INS, type MockPerson } from "../data/people";
import { STATUS_PILL, summaryOf, TODAY, HISTORY, type TodayRow } from "../data/attendance";
import { PARTNERS, stageTone } from "../data/partners";
import { REQUESTS, STAGE_PILL } from "../data/expenses";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const fmtDay = (d: Date) => `${DAY_NAMES[d.getDay()]}, ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
const naira = (amount: string) => {
  const n = Math.round(Number(amount) / 10000) / 100;
  return n >= 1 ? `₦${n.toFixed(2).replace(/0$/, "").replace(/\.0$/, "")}M` : `₦${Math.round(Number(amount) / 1000)}K`;
};
const greet = () => {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

/** Who a viewer's Home and Team cover. */
function scopeFor(user: string): TodayRow[] {
  const view = SIGN_INS[user]?.view;
  if (view === "operations" || view === "ceo") return TODAY;
  const team = new Set(teamOf(user).map((p) => p.user_key));
  return TODAY.filter((t) => team.has(t.person.user_key));
}

function weekDays(kind: "ops" | "ceo" | "partner" | "staff") {
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const items: Record<string, Array<[string, "diary" | "task" | "note"]>> = {
    ops: [["Close out Q4 departmental targets", "task"], ["Panel interview, Adaeze Nnamdi, 11:00", "diary"], ["Ember to Remember Lagos leg, all hands", "diary"], ["Onboarding pack for the Enugu hires", "task"], ["Weekly productivity report goes out", "note"], ["Half day, 09:00 to 15:00", "note"]],
    ceo: [["Board pack review", "task"], ["Payroll sign off", "diary"], ["Ember to Remember Lagos leg", "diary"], ["Investor update draft", "task"], ["Weekly productivity report", "note"], ["Rest day", "note"]],
    partner: [["Eko Hotels re-engagement call", "task"], ["ProvidusBank proposal due", "diary"], ["MTN quarterly review", "diary"], ["Pipeline review with Operations", "task"], ["Lead owner one to ones", "note"], ["Rest day", "note"]],
    staff: [["Shift 09:00 to 17:00, on site", "diary"], ["Shift 09:00 to 17:00, on site", "diary"], ["Ember to Remember Lagos leg", "diary"], ["Shift 09:00 to 17:00, on site", "diary"], ["Reviews due to your manager", "task"], ["Half day, 09:00 to 15:00", "note"]],
  };
  const short = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const days = items[kind].map(([text, k], i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return { day: `${short[i]} ${d.getDate()}`, text, kind: k };
  });
  const sat = new Date(monday);
  sat.setDate(monday.getDate() + 5);
  const month = (d: Date) => d.toLocaleDateString("en-GB", { month: "long" });
  return { range: `Mon ${monday.getDate()} to Sat ${sat.getDate()} ${month(sat)}`, days };
}

const PIPE = () => {
  const counts = [["Contacted", 31], ["In discussion", 22], ["Proposal sent", 14], ["MOU drafted", 8], ["Signed", 5]] as const;
  return counts.map(([label, n], i) => ({ label, pct: Math.round((n / 31) * 100), value: String(n), ...(i === 4 ? { emphasis: "brand" as const } : {}) }));
};
const GOALS = [
  { label: "Revenue, FY target ₦180M", pct: 62, value: "₦112M" },
  { label: "Ember to Remember delivered", pct: 78, value: "On track" },
  { label: "Headcount, 30 by Q1", pct: 83, value: "25 of 30" },
  { label: "Partner network, 10 signed", pct: 50, value: "5 of 10", emphasis: "warn" as const },
  { label: "On time attendance 90%", pct: 87, value: "87%", emphasis: "brand" as const },
  { label: "Engagement actions", pct: 40, value: "2 of 5" },
];

function needYouRequests(stages: string[]) {
  return REQUESTS.filter((r) => stages.includes(r.stage)).map((r) => ({
    id: r.request_id, title: r.title, from: refKey(r.requester), amount: r.amount, stage: r.stage === "ceo" && stages.length === 1 ? { tone: "info" as const, text: "With you" } : STAGE_PILL[r.stage], link: `/expenses?tab=approvals&id=${r.request_id}`,
  }));
}

function attendanceSeries() {
  const values: number[] = [];
  const labels: string[] = [];
  for (let d = 19; d >= 1 && values.length < 14; d -= 1) {
    const date = isoDaysAgo(d);
    const rows = HISTORY.filter((h) => h.date === date);
    if (!rows.length) continue;
    values.push(rows.filter((r) => r.clock_in_at).length);
    labels.push(`${date.slice(8, 10)}/${date.slice(5, 7)}`);
  }
  return { values, labels };
}

function overview(user: string): { greeting: string; subtitle: string; blocks: HomeBlock[] } {
  const p = byKey(user)!;
  const view = SIGN_INS[user]?.view ?? "staff";
  const greeting = `${greet()}, ${p.first_name}`;
  const today = fmtDay(new Date());
  const s = summaryOf(TODAY);

  if (view === "operations") {
    const waiting = REQUESTS.filter((r) => ["operations", "ceo", "line_manager", "requisition"].includes(r.stage));
    const series = attendanceSeries();
    return {
      greeting,
      subtitle: `${today} · ${s.present} of ${TODAY.length} clocked in`,
      blocks: [
        { type: "kpis", items: [
          { key: "clockedin", label: "Clocked in today", value: `${s.present} / ${TODAY.length}`, trend: { text: `${Math.round((s.present / TODAY.length) * 100)}% · ${s.late} late`, dir: "up" } },
          { key: "overdue", label: "Overdue tasks", value: "7", trend: { text: "3 more than last week", dir: "dn" } },
          { key: "approval", label: "Awaiting approval", value: naira(String(waiting.reduce((a, r) => a + Number(r.amount), 0))), trend: { text: `${waiting.length} requests · ${waiting.filter((r) => r.stage === "ceo").length} with CEO`, dir: "fl" } },
          { key: "partnerships", label: "Active partnerships", value: String(PARTNERS.filter((x) => x.stage === "Active partnership").length), trend: { text: "3 closed this month", dir: "up" } },
        ] },
        { type: "split", cols: "1.4/1", blocks: [
          { type: "area", title: "Attendance, last 14 working days", values: series.values, labels: series.labels, note: "Saturdays run 09:00 to 15:00 and show lower by design." },
          { type: "donut", pct: 87, label: "on time", text: "37 on time, 4 late, 7 absent this month. Three late arrivals by Bashir Lawal in 30 days, which is the threshold the rule watches." },
        ] },
        { type: "split", cols: "2", blocks: [
          { type: "need_you", title: "Need You", badge: { tone: "warn", text: `${waiting.length} pending` }, variant: "requests", rows: needYouRequests(["operations", "ceo", "line_manager", "requisition"]) },
          { type: "bars", title: "Partnership pipeline", rows: PIPE(), note: "4 partnerships have had no contact in 30 days. Follow ups raised automatically." },
        ] },
        { type: "bars", title: "Goals this quarter", rows: GOALS, info: "Each role's dashboard leans on the goals it owns. Attendance is primary for People and Operations, not for everyone." },
        { type: "split", cols: "2", blocks: [
          { type: "activity", title: "Across the organisation today", items: [
            { title: "Adedotun Oyinloye raised EXP-0122", when: "08:14", text: "Stage hire, ₦820,000.00. Routed to Operations, then the CEO.", tone: "hi" },
            { title: "Query raised against Bashir Lawal", when: "09:41", text: "Third late arrival in 30 days. Raised by the rule, not a manager.", tone: "hi" },
            { title: "Seyi Balogun punched from a new device", when: "08:58", text: "Pixel 7, Chrome. Warned, not blocked." },
            { title: "Hauwa Yusuf birthday posted", when: "00:01", text: "Posted automatically from her employee record.", tone: "ok" },
            { title: "Amara Okafor submitted October payroll", when: "Yesterday 17:22", text: "25 staff, ₦11.36M net.", tone: "ok" },
          ] },
          { type: "week", title: "Your week", ...weekDays("ops") },
        ] },
      ],
    };
  }

  if (view === "ceo") {
    return {
      greeting,
      subtitle: `${today} · The organisation at a glance`,
      blocks: [
        { type: "kpis", items: [
          { key: "goals", label: "Goals on track", value: "4 of 6", trend: { text: "2 need attention", dir: "dn" } },
          { key: "approval_ceo", label: "Awaiting your approval", value: naira(String(REQUESTS.filter((r) => r.stage === "ceo").reduce((a, r) => a + Number(r.amount), 0))), trend: { text: `${REQUESTS.filter((r) => r.stage === "ceo").length} requests with you`, dir: "fl" } },
          { key: "signed", label: "Signed value, FY", value: "₦9.2M", trend: { text: "of ₦18M target", dir: "up" } },
          { key: "alerts_high", label: "Open high alerts", value: String(ALERTS.filter((a) => a.severity === "high" && !a.cleared).length), tone: "err", trend: { text: "2 over 7 days", dir: "dn" } },
        ] },
        { type: "split", cols: "1.4/1", blocks: [
          { type: "bars", title: "Organisational goals", rows: GOALS, note: "These roll up from every department. The CEO sees the whole board, not one function." },
          { type: "donut", pct: 76, label: "org KPI", text: "Weighted across departments. People 81, Finance 82, Content 76, Partnerships 61, Support 76." },
        ] },
        { type: "split", cols: "2", blocks: [
          { type: "need_you", title: "Need You", badge: { tone: "info", text: "With the CEO" }, variant: "requests", rows: needYouRequests(["ceo"]) },
          { type: "bars", title: "Partnership pipeline", rows: PIPE(), note: "Signed value is ₦9.2M against an ₦18M target for the year." },
        ] },
        { type: "split", cols: "2", blocks: [
          { type: "activity", title: "Across the organisation today", items: [
            { title: "October payroll submitted for approval", when: "Yesterday 17:22", text: "25 staff, ₦11.36M net. Awaiting your sign off.", tone: "hi" },
            { title: "REQ-0042 ageing with you, 6 days", when: "09:00", text: "Over the 2 day approval rule. Alert raised.", tone: "hi" },
            { title: "Kano Trade Council, 52 days quiet", when: "05:00", text: "Oldest open alert on the board." },
            { title: "Q4 departmental targets closing Monday", when: "08:00", text: "Four of six departments confirmed." },
          ] },
          { type: "week", title: "Your week", ...weekDays("ceo") },
        ] },
      ],
    };
  }

  if (view === "partnerships") {
    const quiet = PARTNERS.filter((x) => x.quiet_days > 30);
    return {
      greeting,
      subtitle: `${today} · Your pipeline and partners`,
      blocks: [
        { type: "kpis", items: [
          { key: "partnerships", label: "Active partnerships", value: String(PARTNERS.filter((x) => x.stage === "Active partnership").length), trend: { text: "3 closed this month", dir: "up" } },
          { key: "signed", label: "Signed value", value: "₦9.2M", trend: { text: "of ₦18M target", dir: "fl" } },
          { key: "stale", label: "No contact 30 days +", value: String(quiet.length), tone: "warn", trend: { text: `${quiet.filter((x) => x.quiet_days > 50).length} over 50 days`, dir: "dn" } },
          { key: "proposals", label: "Proposals out", value: String(PARTNERS.filter((x) => x.stage === "Proposal sent").length), trend: { text: "1 awaiting reply", dir: "fl" } },
        ] },
        { type: "split", cols: "1.4/1", blocks: [
          { type: "bars", title: "Partnership pipeline", rows: PIPE(), info: "Attendance does not sit on your Home. Your clocking lives in My Attendance; your Home is your pipeline." },
          { type: "area", title: "Signed value by month, ₦M", values: [2.1, 3.4, 3.4, 5.0, 6.2, 7.1, 7.1, 9.2], labels: ["Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"] },
        ] },
        { type: "split", cols: "2", blocks: [
          { type: "need_you", title: "Need You", badge: { tone: "warn", text: `${quiet.length} going quiet` }, variant: "partnerships", rows: quiet.map((x) => ({ id: x.partner_id, title: x.name, from: refKey(x.owner), amount: null, quiet_days: x.quiet_days, stage: { tone: stageTone(x.stage, x.quiet_days), text: x.stage }, link: `/partnerships?tab=partners&id=${x.partner_id}` })) },
          { type: "week", title: "Your week", ...weekDays("partner") },
        ] },
        { type: "note", text: "Your own attendance is in My Attendance." },
      ],
    };
  }

  const mine = TODAY.find((t) => t.person.user_key === user);
  return {
    greeting,
    subtitle: `${today} · Your day`,
    blocks: [
      { type: "statstrip", items: [
        { label: "Today, shift", value: new Date().getDay() === 6 ? "09:00 to 15:00" : "09:00 to 17:00" },
        { label: "Clock-in", value: mine?.clock_in ?? "Not yet", tone: mine?.clock_in ? "ok" : "warn" },
        { label: "Where", value: mine?.mode === "Remote" ? "Remote, approved home" : `${p.worksite}, on site` },
        { label: "Status", value: STATUS_PILL[mine?.status ?? "not_yet"].text, tone: mine?.status === "late" ? "err" : "ok" },
      ] },
      { type: "kpis", items: [
        { key: "sk_pieces", label: "Pieces published", value: "18 of 24", trend: { text: "75%", dir: "up" } },
        { key: "sk_growth", label: "Channel growth", value: "+6.2%", trend: { text: "up on last month", dir: "up" } },
        { key: "sk_reviews", label: "Reviews filed", value: "2 of 4", tone: "warn", trend: { text: "Due Friday", dir: "fl" } },
        { key: "sk_attendance", label: "My attendance, 30d", value: "20 / 20", tone: "ok", trend: { text: "100% on time", dir: "up" } },
      ] },
      { type: "split", cols: "2", blocks: [
        { type: "bars", title: "My goals this quarter", rows: [
          { label: "24 pieces published", pct: 75, value: "18 of 24" }, { label: "Enugu shot list", pct: 100, value: "Done", emphasis: "brand" },
          { label: "Channel growth", pct: 62, value: "+6.2%" }, { label: "Team reviews filed", pct: 50, value: "2 of 4" },
        ], info: "Your goals are set with your manager in Performance. Progress counts from the tasks linked to each goal." },
        { type: "list", title: "Upcoming leave", info: "Leave is requested in My Leave and approved by your manager. Approved leave shows here and stops the clock in reminder on those days.", rows: [
          { label: "22 to 24 Dec", text: "Annual leave, 3 days", pill: { tone: "ok", text: "Approved" } },
          { label: "Balance", text: "12 days left this year", pill: { tone: "neutral", text: "Annual" } },
        ] },
      ] },
      { type: "week", title: "This week at a glance", ...weekDays("staff") },
      { type: "note", text: "Your tasks and diary live in My Workspace." },
    ],
  };
}

/* ------------------------------------------------------------------ *
 * KPI catalogue: each card's report model
 * ------------------------------------------------------------------ */
const txt = (text: string): KpiCell => ({ kind: "text", text });
const person = (p: MockPerson): KpiCell => ({ kind: "person", person: ref(p)! });
type Detail = { meta: Omit<KpiDetailMeta, "key" | "groups">; groups?: Array<{ value: string; label: string; test: (r: KpiRow & { _g?: string }) => boolean }>; rows: (user: string) => Array<KpiRow & { _g?: string }> };

const attendanceRows = (user: string) =>
  scopeFor(user).map((t) => ({
    id: t.person.employee_id,
    _g: t.status === "leave" ? "leave" : t.status === "no_clockout" ? "noout" : t.status === "late" ? "late" : !t.clock_in ? "absent" : t.mode === "Remote" ? "remote" : "onsite",
    cells: { employee: person(t.person), mode: txt(t.mode === "None" ? "None" : t.mode), clock_in: txt(t.clock_in ?? "None"), status: { kind: "pill", ...STATUS_PILL[t.status] } as KpiCell },
    link: `/people?tab=employees&id=${t.person.employee_id}`,
  }));
const ATT_COLS = [{ key: "employee", label: "Employee" }, { key: "mode", label: "Mode" }, { key: "clock_in", label: "Clock-in" }, { key: "status", label: "Status" }];
const ATT_GROUPS = [
  { value: "onsite", label: "On site", test: (r: { _g?: string }) => r._g === "onsite" },
  { value: "remote", label: "Remote", test: (r: { _g?: string }) => r._g === "remote" },
  { value: "late", label: "Late", test: (r: { _g?: string }) => r._g === "late" },
  { value: "noout", label: "No clock-out", test: (r: { _g?: string }) => r._g === "noout" },
  { value: "leave", label: "On leave", test: (r: { _g?: string }) => r._g === "leave" },
  { value: "absent", label: "Not in", test: (r: { _g?: string }) => r._g === "absent" },
];

const DETAILS: Record<string, Detail> = {
  clockedin: { meta: { title: "Clocked in today", sub: "Grouped the way the attendance rules read them.", columns: ATT_COLS }, groups: ATT_GROUPS, rows: attendanceRows },
  tm_present: { meta: { title: "Present today", sub: null, columns: ATT_COLS }, groups: ATT_GROUPS, rows: attendanceRows },
  tm_onsite: { meta: { title: "On site today", sub: null, columns: ATT_COLS }, rows: (u) => attendanceRows(u).filter((r) => r._g === "onsite" || r._g === "late") },
  tm_remote: { meta: { title: "Working remotely", sub: null, columns: ATT_COLS }, rows: (u) => attendanceRows(u).filter((r) => r._g === "remote") },
  tm_flags: { meta: { title: "Flags today", sub: null, columns: ATT_COLS }, rows: (u) => attendanceRows(u).filter((r) => r._g === "late" || r._g === "noout") },
  overdue: {
    meta: { title: "Overdue tasks", sub: null, columns: [{ key: "task", label: "Task" }, { key: "owner", label: "Owner" }, { key: "due", label: "Due" }, { key: "over", label: "Overdue" }] },
    rows: () => [["Confirm Ember to Remember venue list", "tolu", 2], ["Eko Hotels re-engagement decision", "bashir", 22], ["NDPA certificate upload", "bashir", 12], ["October budget variance note", "amara", 7], ["Panel feedback, Adaeze Nnamdi", "ngozi", 5], ["Studio utilisation report", "emeka", 4], ["Knowledge article backlog", "hauwa", 7]].map(([t, o, d], i) => ({
      id: sid(`ov:${i}`), cells: { task: txt(t as string), owner: person(byKey(o as string)!), due: { kind: "date", date: isoDaysAgo(d as number) }, over: { kind: "pill", tone: "err", text: `+${d} days` } }, link: "/workspace?tab=tasks",
    })),
  },
  approval: {
    meta: { title: "Awaiting approval", sub: null, columns: [{ key: "request", label: "Request" }, { key: "from", label: "From" }, { key: "amount", label: "Amount", align: "n" }, { key: "stage", label: "Stage" }] },
    rows: () => REQUESTS.filter((r) => ["operations", "ceo", "line_manager", "requisition"].includes(r.stage)).map((r) => ({ id: r.request_id, cells: { request: txt(r.title), from: person(byKey(r.requester)!), amount: { kind: "money", amount: r.amount }, stage: { kind: "pill", ...STAGE_PILL[r.stage] } }, link: `/expenses?tab=approvals&id=${r.request_id}` })),
  },
  approval_ceo: {
    meta: { title: "Awaiting your approval", sub: null, columns: [{ key: "request", label: "Request" }, { key: "from", label: "From" }, { key: "amount", label: "Amount", align: "n" }] },
    rows: () => REQUESTS.filter((r) => r.stage === "ceo").map((r) => ({ id: r.request_id, cells: { request: txt(r.title), from: person(byKey(r.requester)!), amount: { kind: "money", amount: r.amount } }, link: `/expenses?tab=approvals&id=${r.request_id}` })),
  },
  partnerships: {
    meta: { title: "Active partnerships", sub: null, columns: [{ key: "partner", label: "Partnership" }, { key: "stage", label: "Stage" }, { key: "last", label: "Last contact" }, { key: "value", label: "Value", align: "n" }] },
    rows: () => PARTNERS.filter((x) => x.stage === "Active partnership").map((x) => ({ id: x.partner_id, cells: { partner: txt(x.name), stage: { kind: "pill", tone: "ok", text: "Active" }, last: txt(`${x.quiet_days} days ago`), value: { kind: "money", amount: x.value } }, link: `/partnerships?tab=partners&id=${x.partner_id}` })),
  },
  signed: {
    meta: { title: "Signed value, this year", sub: "Against an ₦18M target.", columns: [{ key: "partner", label: "Partnership" }, { key: "since", label: "Signed" }, { key: "value", label: "Value", align: "n" }] },
    rows: () => PARTNERS.filter((x) => x.since).map((x) => ({ id: x.partner_id, cells: { partner: txt(x.name), since: { kind: "date", date: x.since! }, value: { kind: "money", amount: x.value } }, link: `/partnerships?tab=partners&id=${x.partner_id}` })),
  },
  stale: {
    meta: { title: "No contact in 30 days or more", sub: null, columns: [{ key: "partner", label: "Partnership" }, { key: "owner", label: "Owner" }, { key: "quiet", label: "Quiet" }, { key: "sev", label: "Severity" }] },
    rows: () => PARTNERS.filter((x) => x.quiet_days >= 30).map((x) => ({ id: x.partner_id, cells: { partner: txt(x.name), owner: person(byKey(x.owner)!), quiet: txt(`${x.quiet_days} days`), sev: { kind: "pill", tone: x.quiet_days > 50 ? "err" : x.quiet_days > 30 ? "warn" : "info", text: x.quiet_days > 50 ? "High" : x.quiet_days > 30 ? "Medium" : "Low" } }, link: `/partnerships?tab=partners&id=${x.partner_id}` })),
  },
  proposals: {
    meta: { title: "Proposals out", sub: null, columns: [{ key: "partner", label: "Partnership" }, { key: "days", label: "Days at stage", align: "n" }, { key: "status", label: "Status" }] },
    rows: () => PARTNERS.filter((x) => x.stage === "Proposal sent").map((x) => ({ id: x.partner_id, cells: { partner: txt(x.name), days: txt(String(x.days_at_stage)), status: { kind: "pill", tone: x.days_at_stage > 30 ? "err" : "warn", text: x.days_at_stage > 30 ? "Chase" : "Awaiting reply" } }, link: `/partnerships?tab=proposals` })),
  },
  goals: {
    meta: { title: "Organisational goals", sub: null, columns: [{ key: "goal", label: "Goal" }, { key: "progress", label: "Progress" }] },
    rows: () => GOALS.map((g, i) => ({ id: `g${i}`, cells: { goal: txt(g.label), progress: { kind: "bar", pct: g.pct, text: g.value } }, link: "/performance?tab=goals" })),
  },
  alerts_high: {
    meta: { title: "High severity alerts", sub: null, columns: [{ key: "alert", label: "Alert" }, { key: "trigger", label: "Trigger" }, { key: "who", label: "Who can clear" }, { key: "over", label: "Over by" }] },
    rows: () => ALERTS.filter((a) => a.severity === "high" && !a.cleared).map((a) => ({ id: a.home_alert_id, cells: { alert: txt(a.title), trigger: txt(a.trigger), who: txt(a.who_clears), over: { kind: "over", text: a.over_by } }, link: `/home?tab=alerts&id=${a.home_alert_id}` })),
  },
  sk_attendance: {
    meta: { title: "My attendance, last 30 days", sub: null, columns: [{ key: "date", label: "Date" }, { key: "in", label: "In" }, { key: "out", label: "Out" }, { key: "status", label: "Status" }] },
    rows: (u) => HISTORY.filter((h) => h.person.user_key === u).slice(0, 26).map((h) => ({
      id: h.event_id, cells: { date: { kind: "date", date: h.date }, in: txt(h.clock_in_at ? new Date(h.clock_in_at).toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" }) : "None"), out: txt(h.clock_out_at ? new Date(h.clock_out_at).toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" }) : "None"), status: { kind: "pill", tone: h.status === "late" ? "err" : h.status === "leave" ? "info" : h.status === "absent" ? "err" : "ok", text: h.status === "on_time" ? "On time" : h.status[0].toUpperCase() + h.status.slice(1) } }, link: "/ess?tab=my-attendance",
    })),
  },
  sk_pieces: { meta: { title: "Pieces published", sub: "Linked to tasks in My Workspace.", columns: [{ key: "work", label: "Contributing work" }, { key: "p", label: "Progress" }] }, rows: () => [["Blog, 12 published", 75, "9 of 12"], ["Social copy", 70, "14 of 20"], ["Enugu brief", 100, "Done"]].map(([w, p, t], i) => ({ id: `p${i}`, cells: { work: txt(w as string), p: { kind: "bar", pct: p as number, text: t as string } }, link: "/workspace?tab=tasks" })) },
  sk_growth: { meta: { title: "Channel growth", sub: "Overall +6.2% on last month.", columns: [{ key: "ch", label: "Channel" }, { key: "p", label: "This month" }] }, rows: () => [["Instagram", 72, "+7.1%"], ["LinkedIn", 55, "+5.4%"], ["X", 40, "+3.9%"]].map(([w, p, t], i) => ({ id: `c${i}`, cells: { ch: txt(w as string), p: { kind: "bar", pct: p as number, text: t as string } }, link: null })) },
  sk_reviews: { meta: { title: "Reviews filed", sub: null, columns: [{ key: "r", label: "Review" }, { key: "s", label: "Status" }] }, rows: () => [["Self rating, Q3", "ok", "Filed"], ["Peer review, Chidera", "ok", "Filed"], ["Peer review, Adedotun", "warn", "Due Friday"], ["Peer review, Emeka", "warn", "Due Friday"]].map(([r, t, s], i) => ({ id: `r${i}`, cells: { r: txt(r), s: { kind: "pill", tone: t as "ok" | "warn", text: s } }, link: "/performance?tab=reviews" })) },
};

/* ------------------------------------------------------------------ *
 * Alerts and rules
 * ------------------------------------------------------------------ */
type A = [string, string, string, string, string, "low" | "medium" | "high", string, number, string | null];
const A_ROWS: A[] = [
  ["Bashir Lawal, 3 late arrivals in 30 days", "Attendance rule", "Operations", "attendance", "+1 over 3", "high", "late_arrivals", 2, "/people?tab=attendance"],
  ["Emeka Obi, no clock-out yesterday", "Missing punch", "Operations", "attendance", "1 day open", "medium", "missing_punch", 1, "/people?tab=attendance"],
  ["Seyi Balogun punched from a new device", "Device policy", "Operations", "attendance", "None", "medium", "device", 1, "/people?tab=devices"],
  ["Eko Hotels, no contact in 34 days", "Partnership inactivity", "Ngozi Eze", "partnership", "+4 over 30", "medium", "inactivity", 4, "/partnerships?tab=partners"],
  ["Kano Trade Council, no contact in 52 days", "Partnership inactivity", "Ngozi Eze", "partnership", "+22 over 30", "high", "inactivity", 22, "/partnerships?tab=partners"],
  ["Requisition REQ-0042 with CEO for 6 days", "Approval ageing", "CEO", "approval", "+4 over 2", "high", "approval_ageing", 6, "/expenses?tab=requisitions"],
  ["NDPA certificate expires soon", "Document expiry", "People", "document", "44 days left", "low", "document_expiry", 0, "/people?tab=employees"],
  ["MTN MOU renewal due", "Contract renewal", "Ngozi Eze", "partnership", "90 days notice", "low", "renewal", 0, "/partnerships?tab=contracts-and-mous"],
  ["Chidera Nwosu probation ends soon", "Confirmation due", "People", "people", "11 days left", "medium", "probation", 3, "/people?tab=employees"],
  ["Marketing spend at 92% of budget", "Budget threshold", "Finance", "budget", "+2 over 90", "medium", "budget", 1, "/expenses?tab=budgets"],
  ["October payroll not submitted", "Payroll cycle", "Operations", "payroll", "due today", "medium", "payroll", 0, "/payroll?tab=payroll-runs"],
  ["Adaeze Nnamdi awaiting panel feedback", "Recruitment SLA", "Hiring manager", "recruitment", "+2 over 3", "high", "recruitment_sla", 5, "/recruitment?tab=interviews"],
];
const ALERTS = A_ROWS.map((a, i) => ({
  home_alert_id: sid(`alert:${i}`), title: a[0], trigger: a[1], who_clears: a[2], category: a[3] as HomeAlert["category"], over_by: a[4], severity: a[5], metric: a[6],
  age: a[7] === 0 ? "today" : `${a[7]} day${a[7] === 1 ? "" : "s"}`, raised_at: at(a[7], "09:00"), link: a[8], cleared: false as boolean,
}));
const RULES = [...new Map(ALERTS.map((a) => [a.metric, a])).values()].map((a, i) => ({
  home_alert_rule_id: sid(`rule:${a.metric}`), name: a.trigger, metric: a.metric, example: a.title, threshold: [3, 1, 1, 30, 2, 60, 14, 90, 3, 1, 3][i] ?? 3, window_days: 30, severity: a.severity, enabled: true,
}));
const CATEGORY_LABEL: Record<string, string> = { attendance: "Attendance", partnership: "Partnerships", approval: "Approvals", document: "Documents", people: "People", budget: "Budget", payroll: "Payroll", recruitment: "Recruitment" };
const alertScope = (user: string) => (SIGN_INS[user]?.view === "partnerships" ? ALERTS.filter((a) => a.category === "partnership") : ALERTS).filter((a) => !a.cleared);

/* ------------------------------------------------------------------ *
 * Reports
 * ------------------------------------------------------------------ */
const REPORTS = [
  ["Daily attendance", "Every weekday at 18:00 to Operations and the CEO.", "scheduled", "Operations, CEO", ["operations", "ceo"]],
  ["Weekly productivity", "Mondays at 08:00. Completion, overdue, workload by team.", "scheduled", "All managers", ["operations", "ceo"]],
  ["Recruitment pipeline", "Fridays. Stage counts and time at stage per vacancy.", "scheduled", "Hiring managers", ["operations", "ceo"]],
  ["Partnership pipeline", "Monthly. Stage movement, signed value, lead owner.", "paused", "Partnerships, CEO", ["operations", "ceo", "partnerships"]],
  ["Monthly expenses", "First working day. By department, project and category.", "scheduled", "Operations, CEO", ["operations", "ceo"]],
  ["Pending approvals", "Daily at 09:00 to whoever is holding one.", "scheduled", "Approvers", ["operations", "ceo"]],
].map((r, i) => ({ home_report_id: sid(`report:${i}`), name: r[0] as string, cadence: r[1] as string, status: r[2] as HomeReport["status"], audience: r[3] as string, roles: r[4] as string[] }));
const RUNS = [
  ["Daily attendance", 1, "18:00", "Operations, CEO", "PDF"], ["Pending approvals", 0, "09:00", "4 approvers", "PDF"], ["Weekly productivity", 3, "08:00", "All managers", "PDF, XLSX"],
  ["Recruitment pipeline", 6, "17:00", "Hiring managers", "PDF"], ["Monthly expenses", 13, "09:12", "Operations, CEO", "XLSX"],
].map((r, i) => ({ run_id: sid(`run:${i}`), number: `RPT-${String(214 - i).padStart(4, "0")}`, report: r[0] as string, run_at: at(r[1] as number, r[2] as string), recipients: r[3] as string, formats: r[4] as string }));
const reportScope = (user: string) => REPORTS.filter((r) => r.roles.includes(SIGN_INS[user]?.view ?? "staff") || (SIGN_INS[user] == null && teamOf(user).length > 0 && r.roles.includes("operations")));

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */
route("GET /api/v1/home/overview", (req) => ok(overview(req.user!)));

route("GET /api/v1/home/kpi/:key/meta", (req) => {
  const d = DETAILS[req.params.key];
  if (!d) return notFound();
  const rows = d.rows(req.user!);
  return ok({ key: req.params.key, ...d.meta, groups: (d.groups ?? []).map((g) => ({ value: g.value, label: g.label, count: rows.filter(g.test).length })).filter((g) => g.count > 0) });
});
route("GET /api/v1/home/kpi/:key", (req: Req) => {
  const d = DETAILS[req.params.key];
  if (!d) return notFound();
  const groups = Object.fromEntries((d.groups ?? []).map((g) => [g.value, g.test]));
  const rows = d.rows(req.user!);
  return paged(rows.map((r) => ({ ...r })), req, {
    search: (r) => Object.values(r.cells).map((c) => (c.kind === "text" ? c.text : c.kind === "person" ? c.person.display_name : "")),
    filters: { group: (r, v) => !!groups[v]?.(r) },
  });
});

route("GET /api/v1/home/team/summary", (req) => {
  const l = scopeFor(req.user!);
  const s = summaryOf(l);
  const view = SIGN_INS[req.user!]?.view;
  return ok({
    scope_label: view === "operations" || view === "ceo" ? "The whole organisation" : "The people you manage",
    kpis: [
      { key: "tm_present", label: "Present today", value: `${s.present} / ${l.length}`, trend: { text: `${s.leave} on leave`, dir: "fl" } },
      { key: "tm_onsite", label: "On site", value: String(s.onsite) },
      { key: "tm_remote", label: "Remote", value: String(s.remote) },
      { key: "tm_flags", label: "Flags", value: String(s.late + s.noout), tone: "warn", trend: { text: `${s.late} late, ${s.noout} no clock-out`, dir: "dn" } },
    ] satisfies HomeKpi[],
    attendance_bars: l.slice(0, 6).map((t) => ({ label: t.person.display_name, pct: t.kpi_pct, value: `${t.kpi_pct}%`, ...(t.kpi_pct < 70 ? { emphasis: "warn" as const } : {}) })),
  });
});
route("GET /api/v1/home/team", (req) =>
  paged(
    scopeFor(req.user!).map((t) => ({ employee: ref(t.person)!, today: STATUS_PILL[t.status], mode: t.mode === "None" ? "None" : t.mode, clock_in: t.clock_in, kpi_pct: t.kpi_pct, open_tasks: t.open_tasks, _s: t.status })),
    req,
    { search: (r) => [r.employee.display_name, r.employee.department], filters: { status: (r, v) => r._s === v } },
  ),
);

route("GET /api/v1/home/alerts/summary", (req) => {
  const l = alertScope(req.user!);
  const cats = [...new Set(l.map((a) => a.category))];
  return ok({
    kpis: [
      { key: "alerts_open", label: "Open alerts", value: String(l.length) },
      { key: "alerts_needs", label: "Needs you", value: String(l.filter((a) => a.who_clears === "Operations" || a.who_clears === "People").length), tone: "warn" },
      { key: "alerts_high", label: "Overdue 7 days +", value: String(l.filter((a) => a.severity === "high").length), tone: "err" },
      { key: "alerts_cleared", label: "Cleared this week", value: String(9 + ALERTS.filter((a) => a.cleared).length), tone: "ok" },
    ],
    sources: [["Attendance rules", 100, "18"], ["Partnership inactivity", 55, "10"], ["Approval ageing", 39, "7"], ["Document expiry", 33, "6"], ["Recruitment SLA", 22, "4"], ["Budget threshold", 11, "2"]].map(([label, pct, value]) => ({ label: label as string, pct: pct as number, value: value as string })),
    categories: cats.map((c) => ({ value: c, label: CATEGORY_LABEL[c], count: l.filter((a) => a.category === c).length })),
  });
});
route("GET /api/v1/home/alerts", (req) =>
  paged(alertScope(req.user!).map((a) => ({ home_alert_id: a.home_alert_id, title: a.title, trigger: a.trigger, category: a.category, who_clears: a.who_clears, age: a.age, over_by: a.over_by, severity: a.severity, raised_at: a.raised_at, link: a.link })), req, {
    search: (r) => [r.title, r.trigger],
    filters: { category: (r, v) => r.category === v },
  }),
);
route("POST /api/v1/home/alerts/:id/clear", (req) => {
  const a = ALERTS.find((x) => x.home_alert_id === req.params.id);
  if (!a) return notFound();
  a.cleared = true;
  return ok(a);
});
route("GET /api/v1/home/alert-rules", (req) => paged(RULES, req, { search: (r) => [r.name, r.example] }));
route("POST /api/v1/home/alert-rules", (req) => {
  const b = req.body as { name: string; metric: string; threshold: number; window_days: number; severity: "low" };
  const rule = { home_alert_rule_id: sid(`rule:${b.name}:${Date.now()}`), name: b.name, metric: b.metric, example: `For example: ${b.name}`, threshold: b.threshold, window_days: b.window_days, severity: b.severity, enabled: true };
  RULES.push(rule);
  return created(rule);
});
route("PATCH /api/v1/home/alert-rules/:id", (req) => {
  const r = RULES.find((x) => x.home_alert_rule_id === req.params.id);
  if (!r) return notFound();
  Object.assign(r, req.body);
  return ok(r);
});

route("GET /api/v1/home/reports/summary", (req) => {
  const l = reportScope(req.user!);
  return ok({ kpis: [
    { key: "rp_sched", label: "Scheduled", value: String(l.filter((r) => r.status === "scheduled").length) },
    { key: "rp_paused", label: "Paused", value: String(l.filter((r) => r.status === "paused").length), tone: "warn" },
    { key: "rp_runs", label: "Run this month", value: "38" },
    { key: "rp_recip", label: "Recipients", value: "11" },
  ] });
});
route("GET /api/v1/home/reports", (req) => paged(reportScope(req.user!).map((r) => ({ home_report_id: r.home_report_id, name: r.name, cadence: r.cadence, status: r.status, audience: r.audience })), req, { search: (r) => [r.name] }));
route("POST /api/v1/home/reports", (req) => {
  const b = req.body as { name: string; schedule: string; recipients: string };
  const r = { home_report_id: sid(`report:${b.name}`), name: b.name, cadence: b.schedule, status: "scheduled" as const, audience: b.recipients, roles: ["operations", "ceo", "partnerships"] };
  REPORTS.unshift(r);
  return created(r);
});
route("POST /api/v1/home/reports/:id/run", (req) => {
  const r = REPORTS.find((x) => x.home_report_id === req.params.id);
  if (!r) return notFound();
  const run = { run_id: sid(`run:${Date.now()}`), number: `RPT-${String(215 + RUNS.length).padStart(4, "0")}`, report: r.name, run_at: new Date().toISOString(), recipients: "You", formats: String(req.body.format).toUpperCase() };
  RUNS.unshift(run);
  return ok(run);
});
route("GET /api/v1/home/report-runs", (req) => paged(RUNS, req, { search: (r) => [r.report, r.number] }));

export const _people = PEOPLE;
