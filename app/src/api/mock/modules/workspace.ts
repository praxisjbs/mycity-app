import type { Task, TaskStatus } from "@/api/types/workspace";
import { at, created, invalid, isoDaysAgo, isoDaysAhead, notFound, ok, paged, route, sid } from "../core";
import { byId, byKey, managerOf, ref, refKey, teamOf } from "../data/people";

type R = [string, TaskStatus, string, number | null, Task["priority"], string | null, string | null];
const ROWS: R[] = [
  ["Confirm Ember to Remember venue list with MTN", "todo", "cynthia", -2, "urgent", null, "MTN Nigeria"],
  ["Draft Enugu launch partnership brief", "todo", "ngozi", 0, "high", null, null],
  ["Collect NDPA certificates from 4 staff", "todo", "cynthia", 1, "normal", null, null],
  ["Decide: re-engage or close Kano Trade Council", "todo", "ngozi", -22, "high", null, "Kano Trade Council"],
  ["Build assessment for Backend Engineer role", "in_progress", "seyi", 2, "normal", null, null],
  ["Shot list for Enugu segment", "in_progress", "tolu", 4, "normal", "ifeoma", null],
  ["Model the Filmhouse revenue share", "in_progress", "amara", 0, "high", null, "Filmhouse Cinemas"],
  ["October payroll preview", "in_review", "amara", 0, "urgent", "ngozi", null],
  ["ProvidusBank logo on ticket email", "in_review", "ngozi", 1, "normal", null, "ProvidusBank"],
  ["Respond to Lagos State legal comments", "in_review", "cynthia", -1, "high", null, "Lagos State Government"],
  ["Publish Partnerships Associate vacancy", "done", "cynthia", -3, "normal", null, null],
  ["Onboard Hauwa Yusuf, Abuja hub", "done", "cynthia", -6, "normal", null, null],
  ["Deliver MTN campaign assets", "done", "adedotun", -4, "high", "ngozi", "MTN Nigeria"],
  ["Review Partnerships Associate shortlist", "todo", "cynthia", 0, "normal", null, null],
  ["Sign off October payroll preview", "todo", "cynthia", 0, "high", null, null],
  ["Approve 5 expense requests", "todo", "cynthia", 0, "normal", null, null],
  ["Close out Q4 departmental targets", "todo", "cynthia", 3, "normal", "ifeoma", null],
  ["Onboarding pack for the Enugu hires", "todo", "cynthia", 6, "normal", "ifeoma", null],
  ["Write three Enugu launch blog posts", "in_progress", "kemi", 5, "normal", "tolu", null],
  ["Edit Ember to Remember teaser", "in_progress", "yusuf", 1, "high", "emeka", null],
  ["Fix clock-in retry on Android", "in_review", "ibrahim", 2, "urgent", "seyi", null],
  ["Support inbox zero, October", "todo", "zainab", 8, "low", "hauwa", null],
  ["Reconcile September disbursements", "done", "funke", -2, "normal", "amara", null],
  ["Prepare Q4 social calendar", "todo", "precious", 9, "normal", "tolu", null],
  ["Photograph the Yaba studio for the site", "done", "rotimi", -8, "low", "emeka", null],
  ["Chase Landmark Beach proposal", "todo", "bashir", -5, "high", null, "Landmark Beach"],
  ["Update partner contact log", "in_progress", "grace", 1, "normal", "bashir", null],
  ["Renew facilities contract", "todo", "damilola", 12, "low", "cynthia", null],
  ["Q3 people report", "done", "damilola", -10, "normal", "cynthia", null],
];
const duePill = (status: TaskStatus, d: number | null) =>
  status === "done" ? { tone: "ok" as const, text: "Done" } : d == null ? { tone: "neutral" as const, text: "No date" } : d < 0 ? { tone: "err" as const, text: `Overdue ${-d}d` } : d === 0 ? { tone: "warn" as const, text: "Due today" } : { tone: "neutral" as const, text: isoDaysAhead(d).split("-").reverse().slice(0, 2).join("/") };
const TASKS: Task[] = ROWS.map((r, i) => ({
  task_id: sid(`task:${i}`), number: `TSK-${String(400 - i).padStart(4, "0")}`, title: r[0], status: r[1], owner: refKey(r[2]), set_by: r[5] ? refKey(r[5]) : null,
  due: r[3] == null ? null : r[3] < 0 ? isoDaysAgo(-r[3]) : isoDaysAhead(r[3]), priority: r[4], linked: r[6] ? { kind: "partner", label: r[6], link: "/partnerships?tab=partners" } : null,
  due_pill: duePill(r[1], r[3]), description: null,
}));
const refresh = (t: Task) => {
  const d = t.due ? Math.round((Date.parse(t.due) - Date.parse(isoDaysAgo(0))) / 86400000) : null;
  t.due_pill = duePill(t.status, d);
  return t;
};
const scoped = (user: string, scope?: string) => {
  const me = byKey(user)!.employee_id;
  if (scope === "team") {
    const team = new Set([me, ...teamOf(user).map((p) => p.employee_id)]);
    return TASKS.filter((t) => team.has(t.owner.employee_id));
  }
  return TASKS.filter((t) => t.owner.employee_id === me || (["cynthia", "ifeoma"].includes(user) && t.owner.employee_id !== me && t.owner.employee_id === byKey("ngozi")!.employee_id));
};

route("GET /api/v1/workspace/today", (req) => {
  const me = byKey(req.user)!.employee_id;
  const mine = TASKS.filter((t) => t.owner.employee_id === me && t.status !== "done");
  const due = mine.filter((t) => t.due_pill.text === "Due today");
  const over = mine.filter((t) => t.due_pill.tone === "err");
  return ok({
    date: isoDaysAgo(0),
    kpis: [{ key: "due", label: "Due today", value: String(due.length) }, { key: "over", label: "Overdue", value: String(over.length), tone: over.length ? "err" : undefined }, { key: "meet", label: "Meetings", value: "2" }, { key: "in", label: "Clocked in", value: "08:04", tone: "ok" }],
    my_day: [...over, ...due].filter((t) => !t.set_by).slice(0, 6),
    set_by_manager: mine.filter((t) => t.set_by && t.set_by.employee_id !== me).slice(0, 6),
    diary: [
      { time: "09:30", title: "Partnerships standup", sub: "30 min · #partnerships", confirmed: true },
      { time: "11:00", title: "MTN venue walkthrough", sub: "1 hour · Victoria Island", confirmed: true },
      { time: "14:00", title: "Payroll preview with Amara", sub: "45 min · call", confirmed: false },
      { time: "16:30", title: "Panel prep, Adaeze Nnamdi", sub: "30 min · call", confirmed: false },
    ],
    activity: [
      { title: "Adedotun Oyinloye moved a task to In review", when: "08:20", text: "ProvidusBank logo on ticket email.", tone: "hi" },
      { title: "Tolu Adeyemi completed the Enugu shot list", when: "Yesterday 16:40", tone: "ok" },
      { title: "Ifeoma Chukwu approved the Content target", when: "Yesterday 16:40", tone: "ok" },
      { title: "Seyi Balogun commented on your task", when: "Yesterday 11:02", text: "\"Assessment is ready to publish.\"" },
    ],
  });
});
route("GET /api/v1/tasks/summary", (req) => {
  const l = scoped(req.user!, req.query.scope);
  const open = l.filter((t) => t.status !== "done");
  return ok({ kpis: [
    { key: "open", label: "Open", value: String(open.length) },
    { key: "week", label: "Due this week", value: String(open.filter((t) => t.due && t.due <= isoDaysAhead(6) && t.due >= isoDaysAgo(0)).length) },
    { key: "over", label: "Overdue", value: String(open.filter((t) => t.due_pill.tone === "err").length), tone: "err" },
    { key: "done", label: "Completed, 30d", value: String(l.filter((t) => t.status === "done").length + 41), tone: "ok" },
  ] });
});
route("GET /api/v1/tasks", (req) =>
  paged(scoped(req.user!, req.query.scope).map(refresh), { ...req, query: Object.fromEntries(Object.entries(req.query).filter(([k]) => k !== "scope")) }, {
    search: (t) => [t.title, t.owner.display_name, t.number],
    filters: { status: (t, v) => t.status === v },
  }),
);
route("POST /api/v1/tasks", (req) => {
  const b = req.body as { title: string; owner_id?: string; due?: string; priority: Task["priority"]; description?: string };
  if (!b.title || b.title.trim().length < 3) return invalid({ title: ["Name the task"] });
  const owner = b.owner_id ? byId(b.owner_id)! : byKey(req.user)!;
  const meKey = req.user!;
  const t: Task = { task_id: sid(`task:${Date.now()}`), number: `TSK-${String(401 + TASKS.length).padStart(4, "0")}`, title: b.title.trim(), status: "todo", owner: ref(owner)!, set_by: owner.user_key !== meKey ? ref(byKey(meKey))! : null, due: b.due || null, priority: b.priority, linked: null, due_pill: { tone: "neutral", text: "" }, description: b.description ?? null };
  TASKS.unshift(refresh(t));
  return created(t);
});
route("PATCH /api/v1/tasks/:id", (req) => {
  const t = TASKS.find((x) => x.task_id === req.params.id);
  if (!t) return notFound();
  Object.assign(t, req.body);
  return ok(refresh(t));
});

const EVENTS = [
  [-5, "Management review", "Meeting", true], [-2, "Payroll preview", "Payroll", false], [2, "MTN venue list", "Deadline", true], [3, "Q4 targets close", "Task", false],
  [4, "Panel: Adaeze Nnamdi", "Interview", false], [5, "Ember to Remember, Lagos", "Campaign", false], [6, "Onboarding pack, Enugu", "Task", false], [9, "Fatima Sani interview", "Interview", false],
  [11, "Q4 review cycle opens", "Cycle", false], [11, "Chiamaka Eze starts", "Onboarding", false], [13, "Enugu shoot", "Studio", false], [14, "Enugu shoot", "Studio", false],
  [15, "Chidera probation ends", "Decision", false], [0, "Partnerships standup", "Meeting", false],
].map((e, i) => ({ event_id: sid(`ev:${i}`), date: (e[0] as number) < 0 ? isoDaysAgo(-(e[0] as number)) : isoDaysAhead(e[0] as number), title: e[1] as string, kind: e[2] as string, highlight: e[3] as boolean, link: null as string | null }));
const payday = () => { const d = new Date(); d.setUTCDate(27); return d.toISOString().slice(0, 10); };
route("GET /api/v1/calendar", (req) => {
  const all = [...EVENTS, { event_id: sid("ev:payday"), date: payday(), title: "Payday", kind: "Payroll", highlight: true, link: "/ess?tab=my-payslips" }].sort((a, b) => a.date.localeCompare(b.date));
  return paged(all, req, { search: (e) => [e.title, e.kind], filters: { month: (e, v) => e.date.startsWith(v) } });
});
route("POST /api/v1/calendar", (req) => {
  const b = req.body as { title: string; date: string; kind: string };
  const f: Record<string, string[]> = {};
  if (!b.title) f.title = ["Name the event"];
  if (!b.date) f.date = ["Pick a date"];
  if (Object.keys(f).length) return invalid(f);
  const e = { event_id: sid(`ev:${Date.now()}`), date: b.date, title: b.title, kind: b.kind || "Event", highlight: false, link: null };
  EVENTS.push(e);
  return created(e);
});

route("GET /api/v1/workspace/analytics", (req) => {
  const l = scoped(req.user!, "team");
  const open = l.filter((t) => t.status !== "done");
  const by = new Map<string, number>();
  open.forEach((t) => by.set(t.owner.display_name, (by.get(t.owner.display_name) ?? 0) + 1));
  const top = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const max = top[0]?.[1] ?? 1;
  return ok({
    kpis: [{ key: "rate", label: "Completion rate", value: "78%", trend: "up 6 points", dir: "up" }, { key: "over", label: "Overdue", value: String(open.filter((t) => t.due_pill.tone === "err").length), tone: "err" }, { key: "avg", label: "Avg completion", value: "2.4 days" }, { key: "open", label: "Open tasks", value: String(open.length) }],
    completed_per_week: [18, 22, 19, 26, 24, 31],
    workload: top.map(([label, n]) => ({ label, pct: Math.round((n / max) * 100), value: `${n} open` })),
    priority: [["Urgent", 22, "7", "warn"], ["High", 38, "12"], ["Normal", 66, "21"], ["Low", 25, "8"]].map(([label, pct, value, e]) => ({ label: label as string, pct: pct as number, value: value as string, ...(e ? { emphasis: "warn" as const } : {}) })),
    late_reasons: [["Waiting on somebody else", 3, 43], ["Underestimated", 2, 29], ["Deprioritised, not reassigned", 1, 14], ["No reason recorded", 1, 14]].map(([reason, count, pct]) => ({ reason: reason as string, count: count as number, pct: pct as number })),
  });
});
export const _m = managerOf;
export const _a = at;
