import type { CalendarEvent, CalendarItem, Task, TaskActivity, TaskComment, TaskDetail } from "@mycity/contract/contract.gen.ts";
import { at, created, fail, invalid, isoDaysAgo, isoDaysAhead, notFound, ok, paged, route, sid } from "../core";
import { byId, byKey, ref, refKey, teamOf } from "../data/people";

/**
 * My Workspace in the browser, in the contract's shapes (docs/guides/workspace.md §5).
 * The same records seed staging (F13). Rules the API applies are kept where a screen
 * shows them: who may set a task for whom (A24), and a cancelled task off the board.
 */
type Status = Task["status"];
type R = [string, Status, string, number | null, Task["priority"], string | null, string | null];
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

const due = (d: number | null) => (d == null ? null : at(-d, d === 0 ? "17:00" : "17:00"));
const TASKS: Task[] = ROWS.map((r, i) => ({
  task_id: sid(`task:${i}`),
  number: `TSK-${String(400 - i).padStart(4, "0")}`,
  title: r[0],
  description: null,
  status: r[1],
  priority: r[4],
  cadence: r[5] ? "weekly" : null,
  assignee: refKey(r[2]),
  set_by: refKey(r[5] ?? r[2]),
  due_at: due(r[3]),
  overdue: false,
  started_at: r[1] === "todo" ? null : at(3, "10:00"),
  completed_at: r[1] === "done" ? at(Math.max(1, -(r[3] ?? 1)), "15:00") : null,
  cancelled_at: null,
  cancel_reason: null,
  blocked_reason: null,
  blocked_at: null,
  counts_towards: null,
  entity_type: r[6] ? "partner" : null,
  entity_id: r[6] ? sid(`partner:${r[6]}`) : null,
  link: r[6] ? { module: "partnerships", tab: "partners", id: sid(`partner:${r[6]}`), path: `/partnerships?tab=partners&id=${sid(`partner:${r[6]}`)}` } : null,
  recurrence: null,
  comment_count: 0,
  is_commitment: false,
  acceptance_criteria: null,
  commitment_month: null,
  original_due_at: null,
  rescoped_at: null,
  commitment_set_id: null,
  created_at: at(10, "09:00"),
  updated_at: at(1, "09:00"),
}));
const COMMENTS: TaskComment[] = [];
const ACTIVITY: TaskActivity[] = [];

const open = (t: Task) => t.status !== "done" && t.status !== "cancelled";
const fresh = (t: Task): Task => ({ ...t, overdue: Boolean(open(t) && t.due_at && Date.parse(t.due_at) < Date.now()) });
const me = (user?: string | null) => byKey(user)!.employee_id;
const mine = (user: string, t: Task) => t.assignee?.employee_id === me(user) || t.set_by?.employee_id === me(user);
const scoped = (user: string, scope?: string) => {
  if (scope !== "team") return TASKS.filter((t) => mine(user, t));
  const team = new Set([me(user), ...teamOf(user).map((p) => p.employee_id)]);
  return TASKS.filter((t) => (t.assignee && team.has(t.assignee.employee_id)) || mine(user, t));
};
const canSetFor = (user: string, id: string) => id === me(user) || teamOf(user).some((p) => p.employee_id === id);
const manages = (user: string, t: Task) => t.set_by?.employee_id === me(user) || (t.assignee?.employee_id !== me(user) && canSetFor(user, t.assignee!.employee_id));
const weekBounds = () => {
  const d = new Date();
  const wd = (d.getUTCDay() + 6) % 7;
  return [isoDaysAgo(wd), isoDaysAhead(7 - wd)];
};
const log = (user: string, t: Task, kind: TaskActivity["kind"], from: Status | null = null, to: Status | null = null) =>
  ACTIVITY.unshift({ task_activity_id: sid(`act:${Date.now()}:${ACTIVITY.length}`), task_id: t.task_id, task_title: t.title, actor: refKey(user), kind, from_status: from, to_status: to, detail: null, created_at: new Date().toISOString() });
const find = (user: string, id: string) => {
  const t = TASKS.find((x) => x.task_id === id);
  return t && (mine(user, t) || scoped(user, "team").includes(t)) ? t : undefined;
};
const detail = (user: string, t: Task): TaskDetail => ({ ...fresh(t), can_edit: true, can_reassign: manages(user, t), can_cancel: manages(user, t) && t.status !== "cancelled" });

route("GET /api/v1/tasks", (req) => {
  const { scope, ...query } = req.query;
  const list = scoped(req.user!, scope).filter((t) => (query.status ? true : t.status !== "cancelled")).map(fresh);
  const [from, to] = weekBounds();
  const today = isoDaysAgo(0);
  return paged(list, { ...req, query }, {
    search: (t) => [t.title, t.number, t.assignee?.display_name],
    filters: {
      status: (t, v) => t.status === v,
      assignee_id: (t, v) => t.assignee?.employee_id === v,
      cadence: (t, v) => t.cadence === v,
      priority: (t, v) => t.priority === v,
      employee_target_id: (t, v) => t.counts_towards?.employee_target_id === v,
      due: (t, v) => (v === "overdue" ? t.overdue : v === "today" ? Boolean(t.due_at?.startsWith(today)) : Boolean(t.due_at && t.due_at >= from && t.due_at < to)),
    },
    sort: { due_at: (a, b) => (a.due_at ?? "9").localeCompare(b.due_at ?? "9"), created_at: (a, b) => a.created_at.localeCompare(b.created_at) },
  });
});
route("GET /api/v1/tasks/summary", (req) => {
  const l = scoped(req.user!, req.query.scope).map(fresh);
  const [from, to] = weekBounds();
  return ok({
    open: l.filter(open).length,
    due_this_week: l.filter((t) => open(t) && t.due_at && t.due_at >= from && t.due_at < to).length,
    overdue: l.filter((t) => t.overdue).length,
    done_this_week: l.filter((t) => t.status === "done" && t.completed_at && t.completed_at >= from).length,
  });
});
route("GET /api/v1/tasks/:id", (req) => {
  const t = find(req.user!, req.params.id);
  return t ? ok(detail(req.user!, t)) : notFound();
});
route("POST /api/v1/tasks", (req) => {
  const b = req.body as { title?: string; primary_assignee_id?: string; due_on?: string; cadence?: Task["cadence"]; priority?: Task["priority"]; description?: string };
  if (!b.title || !b.title.trim()) return invalid({ title: ["Name the task"] });
  const assignee = b.primary_assignee_id ? byId(b.primary_assignee_id) : byKey(req.user);
  if (!assignee || !canSetFor(req.user!, assignee.employee_id)) return invalid({ primary_assignee_id: ["Not in your team"] });
  const t: Task = {
    ...TASKS[0], task_id: sid(`task:${Date.now()}`), number: `TSK-${String(401 + TASKS.length).padStart(4, "0")}`, title: b.title.trim(),
    description: b.description || null, status: "todo", priority: b.priority ?? "normal", cadence: b.cadence || null,
    assignee: ref(assignee)!, set_by: refKey(req.user!), due_at: b.due_on ? `${b.due_on}T16:00:00.000Z` : null,
    started_at: null, completed_at: null, entity_type: null, entity_id: null, link: null, comment_count: 0,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  TASKS.unshift(t);
  log(req.user!, t, "created", null, "todo");
  return created(fresh(t));
});
route("PATCH /api/v1/tasks/:id", (req) => {
  const t = find(req.user!, req.params.id);
  if (!t) return notFound();
  const b = req.body as Record<string, unknown>;
  if (["title", "due_on", "cadence", "primary_assignee_id"].some((k) => k in b) && !manages(req.user!, t)) return fail(403, "FORBIDDEN", "Only the person who set this task can change that");
  if (typeof b.title === "string") t.title = b.title;
  if ("description" in b) t.description = (b.description as string) || null;
  if (b.priority) t.priority = b.priority as Task["priority"];
  if ("due_on" in b) t.due_at = b.due_on ? `${b.due_on}T16:00:00.000Z` : null;
  log(req.user!, t, "edited");
  return ok(fresh(t));
});
route("POST /api/v1/tasks/:id/move", (req) => {
  const t = find(req.user!, req.params.id);
  if (!t) return notFound();
  if (t.status === "cancelled") return fail(409, "TASK_CANCELLED", "This task was cancelled");
  const to = (req.body as { status: Status }).status;
  const from = t.status;
  if (to === "in_progress" && !t.started_at) t.started_at = new Date().toISOString();
  t.completed_at = to === "done" ? new Date().toISOString() : null;
  t.status = to;
  if (from !== to) log(req.user!, t, "status_changed", from, to);
  return ok(fresh(t));
});
route("POST /api/v1/tasks/:id/block", (req) => {
  const t = find(req.user!, req.params.id);
  if (!t) return notFound();
  t.blocked_reason = (req.body as { blocked_reason: string }).blocked_reason;
  t.blocked_at = new Date().toISOString();
  log(req.user!, t, "blocked");
  return ok(fresh(t));
});
route("POST /api/v1/tasks/:id/unblock", (req) => {
  const t = find(req.user!, req.params.id);
  if (!t) return notFound();
  t.blocked_reason = null;
  t.blocked_at = null;
  log(req.user!, t, "unblocked");
  return ok(fresh(t));
});
route("POST /api/v1/tasks/:id/cancel", (req) => {
  const t = find(req.user!, req.params.id);
  if (!t) return notFound();
  if (!manages(req.user!, t)) return fail(403, "FORBIDDEN", "Only the person who set this task can cancel it");
  log(req.user!, t, "cancelled", t.status, "cancelled");
  Object.assign(t, { status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: (req.body as { cancel_reason: string }).cancel_reason });
  return ok(fresh(t));
});
route("GET /api/v1/tasks/:id/comments", (req) => {
  const t = find(req.user!, req.params.id);
  return t ? paged(COMMENTS.filter((c) => c.task_id === t.task_id), req, { sort: { created_at: (a, b) => a.created_at.localeCompare(b.created_at) } }) : notFound();
});
route("POST /api/v1/tasks/:id/comments", (req) => {
  const t = find(req.user!, req.params.id);
  if (!t) return notFound();
  const c: TaskComment = { task_comment_id: sid(`c:${Date.now()}`), task_id: t.task_id, author: refKey(req.user!), body: (req.body as { body: string }).body, created_at: new Date().toISOString() };
  COMMENTS.push(c);
  t.comment_count += 1;
  log(req.user!, t, "commented");
  return created(c);
});
route("GET /api/v1/tasks/:id/activity", (req) => {
  const t = find(req.user!, req.params.id);
  return t ? paged(ACTIVITY.filter((a) => a.task_id === t.task_id), req, { sort: { created_at: (a, b) => a.created_at.localeCompare(b.created_at) } }) : notFound();
});

/* Calendar */
type E = [number, string, CalendarEvent["event_type"], string, number];
const EVENT_ROWS: E[] = [
  [-5, "Management review", "meeting", "10:00", 90], [2, "MTN venue list", "deadline", "17:00", 30], [4, "Panel: Adaeze Nnamdi", "interview", "11:00", 60],
  [5, "Ember to Remember, Lagos", "campaign", "09:00", 480], [9, "Fatima Sani interview", "interview", "14:00", 45], [13, "Enugu shoot", "event", "08:00", 480],
  [0, "Partnerships standup", "meeting", "09:30", 30], [0, "MTN venue walkthrough", "meeting", "11:00", 60],
];
const EVENTS: CalendarEvent[] = EVENT_ROWS.map(([d, title, type, hm, mins], i) => {
  const starts = at(-d, hm);
  return {
    calendar_event_id: sid(`ev:${i}`), title, description: null, event_type: type, owner: refKey("cynthia"),
    starts_at: starts, ends_at: new Date(Date.parse(starts) + mins * 60000).toISOString(), all_day: false, location: null,
    visibility: "everyone", attendees: [], my_response: null, entity_type: null, entity_id: null, link: null, cancelled_at: null, can_edit: false,
    created_at: at(20, "09:00"),
  };
});
const asItem = (e: CalendarEvent): CalendarItem => ({ item_kind: "event", item_id: e.calendar_event_id, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at, all_day: e.all_day, event_type: e.event_type, location: e.location, my_response: e.my_response, link: { module: "workspace", tab: "calendar", id: e.calendar_event_id, path: `/workspace?tab=calendar&id=${e.calendar_event_id}` } });
const taskItem = (t: Task): CalendarItem => ({ item_kind: "task", item_id: t.task_id, title: t.title, starts_at: t.due_at!, ends_at: new Date(Date.parse(t.due_at!) + 60000).toISOString(), all_day: false, event_type: "deadline", location: null, my_response: null, link: { module: "workspace", tab: "tasks", id: t.task_id, path: `/workspace?tab=tasks&id=${t.task_id}` } });
const sees = (user: string, e: CalendarEvent) => e.visibility === "everyone" || e.owner?.employee_id === me(user) || e.attendees.some((a) => a.employee.employee_id === me(user));
const view = (user: string, e: CalendarEvent): CalendarEvent => ({ ...e, my_response: e.attendees.find((a) => a.employee.employee_id === me(user))?.response ?? null, can_edit: e.owner?.employee_id === me(user) && !e.cancelled_at });

route("GET /api/v1/calendar", (req) => {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return invalid({ month: ["must be a month as YYYY-MM"] });
  const items = [
    ...EVENTS.filter((e) => !e.cancelled_at && sees(req.user!, e)).map(asItem),
    ...TASKS.filter((t) => t.assignee?.employee_id === me(req.user) && open(t) && t.due_at).map(taskItem),
  ].filter((i) => i.starts_at.startsWith(month)).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return paged(items, { ...req, query: Object.fromEntries(Object.entries(req.query).filter(([k]) => k !== "month")) }, {
    search: (i) => [i.title],
    filters: { item_kind: (i, v) => i.item_kind === v },
    sort: { starts_at: (a, b) => a.starts_at.localeCompare(b.starts_at) },
  });
});
route("GET /api/v1/calendar/:id", (req) => {
  const e = EVENTS.find((x) => x.calendar_event_id === req.params.id);
  return e && sees(req.user!, e) ? ok(view(req.user!, e)) : notFound();
});
route("POST /api/v1/calendar", (req) => {
  const b = req.body as { title?: string; starts_at?: string; ends_at?: string; event_type?: CalendarEvent["event_type"]; all_day?: boolean; location?: string; visibility?: CalendarEvent["visibility"]; attendee_ids?: string[] };
  const f: Record<string, string[]> = {};
  if (!b.title) f.title = ["Name the event"];
  if (!b.starts_at) f.starts_at = ["Pick a start"];
  if (b.starts_at && b.ends_at && b.ends_at <= b.starts_at) f.ends_at = ["Ends before it starts"];
  if (Object.keys(f).length) return invalid(f);
  const e: CalendarEvent = {
    calendar_event_id: sid(`ev:${Date.now()}`), title: b.title!, description: null, event_type: b.event_type ?? "meeting", owner: refKey(req.user!),
    starts_at: b.starts_at!, ends_at: b.ends_at!, all_day: Boolean(b.all_day), location: b.location || null, visibility: b.visibility ?? "attendees",
    attendees: (b.attendee_ids ?? []).map((id) => ({ employee: ref(byId(id))!, response: "pending" as const })), my_response: null,
    entity_type: null, entity_id: null, link: null, cancelled_at: null, can_edit: true, created_at: new Date().toISOString(),
  };
  EVENTS.push(e);
  return created(view(req.user!, e));
});
route("PATCH /api/v1/calendar/:id", (req) => {
  const e = EVENTS.find((x) => x.calendar_event_id === req.params.id);
  if (!e || !sees(req.user!, e)) return notFound();
  if (e.owner?.employee_id !== me(req.user)) return fail(403, "FORBIDDEN", "Only the person who made this event can change it");
  Object.assign(e, req.body);
  return ok(view(req.user!, e));
});
route("POST /api/v1/calendar/:id/cancel", (req) => {
  const e = EVENTS.find((x) => x.calendar_event_id === req.params.id);
  if (!e || !sees(req.user!, e)) return notFound();
  if (e.owner?.employee_id !== me(req.user)) return fail(403, "FORBIDDEN", "Only the person who made this event can change it");
  e.cancelled_at = new Date().toISOString();
  return ok(view(req.user!, e));
});
route("POST /api/v1/calendar/:id/respond", (req) => {
  const e = EVENTS.find((x) => x.calendar_event_id === req.params.id);
  if (!e || !sees(req.user!, e)) return notFound();
  const a = e.attendees.find((x) => x.employee.employee_id === me(req.user));
  if (!a) return fail(409, "NOT_INVITED", "You are not invited to this event");
  a.response = (req.body as { response: "accepted" | "declined" }).response;
  return ok(view(req.user!, e));
});

/* Today and Analytics */
route("GET /api/v1/workspace/today", (req) => {
  const id = me(req.user);
  const today = isoDaysAgo(0);
  const own = TASKS.filter((t) => t.assignee?.employee_id === id && open(t)).map(fresh);
  const dueToday = own.filter((t) => t.due_at?.startsWith(today));
  const overdue = own.filter((t) => t.overdue);
  const fromOthers = own.filter((t) => t.set_by && t.set_by.employee_id !== id);
  const [from] = weekBounds();
  const diary = EVENTS.filter((e) => sees(req.user!, e) && e.starts_at.startsWith(today)).map(asItem);
  const since = ACTIVITY.filter((a) => TASKS.some((t) => t.task_id === a.task_id && t.assignee?.employee_id === id) && a.actor?.employee_id !== id).slice(0, 25);
  return ok({
    date: today,
    due_today: dueToday.length,
    overdue: overdue.length,
    in_review: own.filter((t) => t.status === "in_review").length,
    done_this_week: TASKS.filter((t) => t.assignee?.employee_id === id && t.status === "done" && (t.completed_at ?? "") >= from).length,
    my_day: { data: [...overdue, ...dueToday.filter((t) => !t.overdue)].slice(0, 25), total: overdue.length + dueToday.length },
    set_by_manager: { data: fromOthers.slice(0, 25), total: fromOthers.length },
    diary: { data: diary, total: diary.length },
    since: { data: since.map((a) => ({ task_id: a.task_id, task_title: a.task_title, actor: a.actor, kind: a.kind, to_status: a.to_status, created_at: a.created_at })), total: since.length },
  });
});
route("GET /api/v1/workspace/analytics", (req) => {
  const l = scoped(req.user!, req.query.scope).map(fresh);
  const done = l.filter((t) => t.status === "done");
  const openNow = l.filter(open);
  const by = new Map<string, { employee: NonNullable<Task["assignee"]>; open: number }>();
  for (const t of openNow) {
    if (!t.assignee) continue;
    const e = by.get(t.assignee.employee_id) ?? { employee: t.assignee, open: 0 };
    e.open += 1;
    by.set(t.assignee.employee_id, e);
  }
  const days = req.query.period === "90d" ? 90 : req.query.period === "year" ? 290 : 30;
  return ok({
    from: isoDaysAgo(days - 1),
    to: isoDaysAgo(0),
    completion_rate: done.length + openNow.length ? Math.round((done.length / (done.length + openNow.length)) * 1000) / 10 : null,
    overdue: openNow.filter((t) => t.overdue).length,
    avg_completion_days: 2.4,
    done: done.length,
    cancelled: l.filter((t) => t.status === "cancelled").length,
    completed_per_week: [18, 22, 19, 26, 24, 31].map((count, i) => ({ week_start: isoDaysAgo(7 * (5 - i)), count })),
    workload: [...by.values()].sort((a, b) => b.open - a.open).slice(0, 25),
    by_priority: (["urgent", "high", "normal", "low"] as const).map((priority) => ({ priority, open: openNow.filter((t) => t.priority === priority).length })),
  });
});
