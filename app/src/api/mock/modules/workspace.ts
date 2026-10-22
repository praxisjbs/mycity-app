import type {
  CalendarEvent,
  CalendarItem,
  Commitment,
  CommitmentSetRow,
  CountsTowardsOption,
  Task,
  TaskActivity,
  TaskComment,
  TaskDetail,
  TeamWeek,
  WeekView,
} from "@mycity/contract/contract.gen.ts";
import { at, created, fail, invalid, isoDaysAgo, isoDaysAhead, notFound, ok, paged, route, sid, uuid } from "../core";
import { OBJECTIVES, SCORECARDS } from "../data/performance";
import { byId, byKey, ref, refKey, teamOf } from "../data/people";
import { exportFile } from "./shared";

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
  rescope_reason: null,
  commitment_set_id: null,
  commitment_state: null,
  created_at: at(10, "09:00"),
  updated_at: at(1, "09:00"),
}));
const COMMENTS: TaskComment[] = [];
const ACTIVITY: TaskActivity[] = [];

const open = (t: Task) => t.status !== "done" && t.status !== "cancelled";
const fresh = (t: Task): Task => ({ ...t, overdue: Boolean(open(t) && t.due_at && Date.parse(t.due_at) < Date.now()), commitment_state: stateOf(t) });
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
const detail = (user: string, t: Task): TaskDetail => {
  const f = fresh(t);
  const approved = Boolean(t.is_commitment && t.original_due_at);
  const pending = RESCOPES.get(t.task_id);
  const rec = recoveryOf(t.task_id);
  const actsFor = t.assignee?.employee_id === me(user) || canSetFor(user, t.assignee!.employee_id);
  return {
    ...f,
    can_edit: true,
    can_reassign: manages(user, t),
    can_cancel: manages(user, t) && t.status !== "cancelled" && !approved,
    set_status: setOf(t)?.status ?? null,
    rescope: pending ? { workflow_instance_id: pending, can_decide: t.assignee?.employee_id !== me(user) && canSetFor(user, t.assignee!.employee_id) } : null,
    recovery: rec,
    can_rescope: approved && !pending && !t.rescoped_at && open(t) && actsFor,
    can_set_recovery: f.commitment_state === "missed" && !rec && actsFor,
  };
};

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
      is_commitment: (t, v) => t.is_commitment === (v === "true"),
      commitment_month: (t, v) => t.commitment_month === v,
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
  const b = req.body as {
    title?: string; primary_assignee_id?: string; due_on?: string; cadence?: Task["cadence"]; priority?: Task["priority"]; description?: string;
    is_commitment?: boolean; acceptance_criteria?: string; commitment_month?: string; employee_target_id?: string; entity_type?: Task["entity_type"]; entity_id?: string;
  };
  if (!b.title || !b.title.trim()) return invalid({ title: ["Name the task"] });
  const assignee = b.primary_assignee_id ? byId(b.primary_assignee_id) : byKey(req.user);
  if (!assignee || !canSetFor(req.user!, assignee.employee_id)) return invalid({ primary_assignee_id: ["Not in your team"] });
  const problem = commitmentProblem(b);
  if (problem) return invalid(problem);
  const t: Task = {
    ...TASKS[0], task_id: sid(`task:${Date.now()}`), number: `TSK-${String(401 + TASKS.length).padStart(4, "0")}`, title: b.title.trim(),
    description: b.description || null, status: "todo", priority: b.priority ?? "normal", cadence: b.cadence || null,
    assignee: ref(assignee)!, set_by: refKey(req.user!), due_at: b.due_on ? `${b.due_on}T16:00:00.000Z` : null,
    started_at: null, completed_at: null, entity_type: b.entity_type ?? null, entity_id: b.entity_id ?? null, link: null, comment_count: 0,
    counts_towards: countsTowardsOf(b), is_commitment: Boolean(b.is_commitment), acceptance_criteria: b.is_commitment ? b.acceptance_criteria ?? null : null,
    commitment_month: b.is_commitment ? b.commitment_month ?? null : null, original_due_at: null, rescoped_at: null, rescope_reason: null, commitment_set_id: null,
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
  const approved = Boolean(t.is_commitment && t.original_due_at);
  const marks = ["is_commitment", "acceptance_criteria", "commitment_month"].some((k) => k in b && b[k] !== (t as unknown as Record<string, unknown>)[k]);
  if (approved && marks) return fail(409, "COMMITMENT_APPROVED", "Approved commitments are rescoped, not changed");
  if (!approved && marks) {
    const will = { is_commitment: "is_commitment" in b ? Boolean(b.is_commitment) : t.is_commitment, acceptance_criteria: (b.acceptance_criteria as string) ?? t.acceptance_criteria, commitment_month: (b.commitment_month as string) ?? t.commitment_month, due_on: "due_on" in b ? (b.due_on as string) : t.due_at?.slice(0, 10) };
    const problem = commitmentProblem(will);
    if (problem) return invalid(problem);
    Object.assign(t, { is_commitment: will.is_commitment, acceptance_criteria: will.is_commitment ? will.acceptance_criteria ?? null : null, commitment_month: will.is_commitment ? will.commitment_month ?? null : null });
  }
  if ("employee_target_id" in b || "entity_type" in b) t.counts_towards = countsTowardsOf({ employee_target_id: b.employee_target_id as string, entity_type: b.entity_type as Task["entity_type"], entity_id: b.entity_id as string });
  if ("entity_type" in b) Object.assign(t, { entity_type: b.entity_type ?? null, entity_id: b.entity_id ?? null });
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
  if (t.is_commitment && t.original_due_at) return fail(409, "COMMITMENT_APPROVED", "Approved commitments are rescoped, not changed");
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
const asItem = (e: CalendarEvent): CalendarItem => ({ item_kind: "event", item_id: e.calendar_event_id, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at, all_day: e.all_day, event_type: e.event_type, location: e.location, my_response: e.my_response, performance_kind: null, link: { module: "workspace", tab: "calendar", id: e.calendar_event_id, path: `/workspace?tab=calendar&id=${e.calendar_event_id}` } });
const taskItem = (t: Task): CalendarItem => ({ item_kind: "task", item_id: t.task_id, title: t.title, starts_at: t.due_at!, ends_at: new Date(Date.parse(t.due_at!) + 60000).toISOString(), all_day: false, event_type: "deadline", location: null, my_response: null, performance_kind: null, link: { module: "workspace", tab: "tasks", id: t.task_id, path: `/workspace?tab=tasks&id=${t.task_id}` } });
/** The reader's performance dates (performance.md §6.18): a check-in due and a key result finishing, all day. */
const performanceItems = (): CalendarItem[] => {
  const day = (n: number) => isoDaysAhead(n);
  const allDay = (d: string) => ({ starts_at: `${d}T00:00:00+01:00`, ends_at: `${isoDaysAhead(Math.round((Date.parse(d) - Date.parse(isoDaysAgo(0))) / 86400000) + 1)}T00:00:00+01:00` });
  return [
    { item_kind: "performance", item_id: sid("perf:checkin"), title: "Check-In: This Month", ...allDay(day(3)), all_day: true, event_type: null, location: null, my_response: null, performance_kind: "check_in_due", link: { module: "ess", tab: "my-performance", id: sid("perf:checkin"), path: `/ess?tab=my-performance&id=${sid("perf:checkin")}` } },
    { item_kind: "performance", item_id: sid("perf:kr:BM-KR1.2"), title: "BM-KR1.2 Publish 36 city stories across channels", ...allDay(day(6)), all_day: true, event_type: null, location: null, my_response: null, performance_kind: "key_result_due", link: { module: "performance", tab: "goals", id: sid("perf:kr:BM-KR1.2"), path: `/performance?tab=goals&id=${sid("perf:kr:BM-KR1.2")}` } },
  ];
};
const sees = (user: string, e: CalendarEvent) => e.visibility === "everyone" || e.owner?.employee_id === me(user) || e.attendees.some((a) => a.employee.employee_id === me(user));
const view = (user: string, e: CalendarEvent): CalendarEvent => ({ ...e, my_response: e.attendees.find((a) => a.employee.employee_id === me(user))?.response ?? null, can_edit: e.owner?.employee_id === me(user) && !e.cancelled_at });

route("GET /api/v1/calendar", (req) => {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return invalid({ month: ["must be a month as YYYY-MM"] });
  const items = [
    ...EVENTS.filter((e) => !e.cancelled_at && sees(req.user!, e)).map(asItem),
    ...TASKS.filter((t) => t.assignee?.employee_id === me(req.user) && open(t) && t.due_at).map(taskItem),
    ...performanceItems(),
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

/* ───────────── Commitments (docs/guides/performance.md §6.11) ───────────── */

type MockSet = CommitmentSetRow & { key: string };
const SETS: MockSet[] = [];
/** A rescope waiting for approval: task id → its instance id. */
const RESCOPES = new Map<string, string>();
const firstOf = (iso: string) => `${iso.slice(0, 7)}-01`;
const nextMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`;
};
/** The start of a Lagos day after the given instant's day, as an instant. */
const endOfDay = (iso: string) => Date.parse(`${new Date(Date.parse(iso) + 3600_000).toISOString().slice(0, 10)}T23:00:00Z`);

function stateOf(t: Task): Commitment["state"] | null {
  if (!t.is_commitment || t.status === "cancelled") return null;
  if (t.rescoped_at) return "rescoped";
  if (!t.original_due_at) return "awaiting_approval";
  if (t.status === "done") return t.completed_at && Date.parse(t.completed_at) < endOfDay(t.original_due_at) ? "on_time" : "late";
  if (t.commitment_month && Date.parse(`${nextMonth(t.commitment_month)}T00:00:00+01:00`) <= Date.now()) return "missed";
  return "due";
}
const setOf = (t: Task) => SETS.find((s) => s.commitment_set_id === t.commitment_set_id);
function recoveryOf(taskId: string): TaskDetail["recovery"] {
  const r = TASKS.find((x) => x.entity_type === "task" && x.entity_id === taskId && x.status !== "cancelled");
  return r ? { task_id: r.task_id, number: r.number, assignee: r.assignee, due_at: r.due_at } : null;
}
function commitmentProblem(b: { is_commitment?: boolean; acceptance_criteria?: string | null; commitment_month?: string | null; due_on?: string | null }): Record<string, string[]> | null {
  if (!b.is_commitment) return null;
  if (!b.acceptance_criteria) return { acceptance_criteria: ["Give the criteria"] };
  if (!b.commitment_month) return { commitment_month: ["Pick the month"] };
  if (!b.due_on) return { due_on: ["Pick a due date"] };
  if (b.due_on.slice(0, 7) !== b.commitment_month.slice(0, 7)) return { due_on: ["Not in that month"] };
  return null;
}

/* Counts Towards: the scorecard lines and key results of the mock's Marketing & Sales quarter. */
const LINES = SCORECARDS.flatMap((c) => c.lines.map((l) => ({ line: l, owner: c.employee.employee_id })));
const KEY_RESULTS = OBJECTIVES.flatMap((o) => o.key_results);
function countsTowardsOf(b: { employee_target_id?: string | null; entity_type?: Task["entity_type"]; entity_id?: string | null }): Task["counts_towards"] {
  const l = b.employee_target_id ? LINES.find((x) => x.line.employee_target_id === b.employee_target_id)?.line : undefined;
  if (l) return { kind: "line", employee_target_id: l.employee_target_id, okr_key_result_id: null, title: l.title, link: { module: "performance", tab: "targets", id: l.employee_target_id, path: `/performance?tab=targets&id=${l.employee_target_id}` } };
  const kr = b.entity_type === "key_result" ? KEY_RESULTS.find((k) => k.okr_key_result_id === b.entity_id) : undefined;
  if (kr) return { kind: "key_result", employee_target_id: null, okr_key_result_id: kr.okr_key_result_id, title: `${kr.code} ${kr.statement}`, link: { module: "performance", tab: "goals", id: kr.okr_key_result_id, path: `/performance?tab=goals&id=${kr.okr_key_result_id}` } };
  return null;
}
route("GET /api/v1/tasks/counts-towards", (req) => {
  const { assignee_id, month, ...query } = req.query;
  const who = assignee_id || me(req.user);
  if (!canSetFor(req.user!, who)) return invalid({ assignee_id: ["Not in your team"] });
  void month;
  const options: CountsTowardsOption[] = [
    ...LINES.filter((x) => x.owner === who).map((x) => ({ kind: "line" as const, employee_target_id: x.line.employee_target_id, okr_key_result_id: null, title: x.line.title, sub: "Q4 2026" })),
    ...KEY_RESULTS.filter((k) => k.accountable?.employee_id === who).map((k) => ({ kind: "key_result" as const, employee_target_id: null, okr_key_result_id: k.okr_key_result_id, title: `${k.code} ${k.statement}`, sub: "Q4 2026" })),
  ];
  return paged(options, { ...req, query }, { search: (o) => [o.title] });
});

/** A person's set for a month, made when missing. */
function setFor(key: string, month: string): MockSet {
  let s = SETS.find((x) => x.key === key && x.month === month);
  if (!s) {
    const p = byKey(key)!;
    s = { key, commitment_set_id: sid(`cset:${key}:${month}`), employee_id: p.employee_id, employee: ref(p)!, month, status: "draft", workflow_instance_id: null, submitted_at: null, approved_at: null, task_count: 0, returned_reason: null };
    SETS.push(s);
  }
  return s;
}
const keyOf = (t: Task) => byId(t.assignee?.employee_id)?.user_key ?? "";
/** Send a month: its unapproved commitments go into the set, which waits on the manager, or is approved as sent by them. */
function send(user: string, key: string, month: string) {
  const s = setFor(key, month);
  if (s.status === "submitted") return fail(409, "COMMITMENTS_WAITING", "This month is already waiting for approval");
  const mine = TASKS.filter((t) => keyOf(t) === key && t.is_commitment && t.commitment_month === month && !t.original_due_at && !t.rescoped_at && t.status !== "cancelled");
  if (!mine.length) return fail(422, "COMMITMENTS_EMPTY", "Mark a commitment for that month first");
  for (const t of mine) t.commitment_set_id = s.commitment_set_id;
  Object.assign(s, { status: "submitted", submitted_at: new Date().toISOString(), workflow_instance_id: uuid(), returned_reason: null });
  if (byKey(key)?.manager === user) settleSet(s, true);
  s.task_count = TASKS.filter((t) => t.commitment_set_id === s.commitment_set_id && t.status !== "cancelled").length;
  return ok(stripSet(s));
}
function settleSet(s: MockSet, approve: boolean, reason?: string | null) {
  if (approve) {
    for (const t of TASKS.filter((x) => x.commitment_set_id === s.commitment_set_id && !x.original_due_at)) t.original_due_at = t.due_at;
    Object.assign(s, { status: "approved", approved_at: new Date().toISOString() });
  } else Object.assign(s, { status: "returned", returned_reason: reason ?? null });
}
const stripSet = ({ key: _key, ...s }: MockSet): CommitmentSetRow => s;
/** The set or rescope waiting on this login: the person's manager decides, the CEO a head's. */
const waitsOn = (user: string, key: string) => byKey(key)?.manager === user || (user === "ifeoma" && byKey(key)?.manager === "ifeoma");

/** POST /workflow/instances/:id/approve|reject for a month of commitments or a rescope (the leave mock passes it on). */
export function decideCommitment(user: string, wid: string, approve: boolean, reason?: string | null) {
  const s = SETS.find((x) => x.workflow_instance_id === wid && x.status === "submitted");
  if (s) {
    if (!waitsOn(user, s.key)) return fail(403, "PERMISSION_DENIED", "You are not an approver for this stage");
    if (!approve && !String(reason ?? "").trim()) return invalid({ reason: ["is required"] });
    settleSet(s, approve, reason);
    return ok({ workflow_instance_id: wid, state: approve ? "approved" : "rejected", stage_name: null });
  }
  const taskId = [...RESCOPES].find(([, w]) => w === wid)?.[0];
  const t = taskId ? TASKS.find((x) => x.task_id === taskId) : undefined;
  if (!t) return null;
  if (!waitsOn(user, keyOf(t))) return fail(403, "PERMISSION_DENIED", "You are not an approver for this stage");
  if (!approve && !String(reason ?? "").trim()) return invalid({ reason: ["is required"] });
  RESCOPES.delete(t.task_id);
  if (approve) t.rescoped_at = new Date().toISOString();
  else t.rescope_reason = null;
  return ok({ workflow_instance_id: wid, state: approve ? "approved" : "rejected", stage_name: null });
}

const commitmentOf = (t: Task): Commitment => {
  const f = fresh(t);
  return {
    task_id: t.task_id, number: t.number, title: t.title, acceptance_criteria: t.acceptance_criteria, employee: t.assignee, commitment_month: t.commitment_month!,
    due_at: t.due_at, original_due_at: t.original_due_at, completed_at: t.completed_at, rescoped_at: t.rescoped_at, rescope_reason: t.rescope_reason,
    commitment_set_id: t.commitment_set_id, set_status: setOf(t)?.status ?? null, state: f.commitment_state!, rescope_pending: RESCOPES.has(t.task_id),
    recovery: recoveryOf(t.task_id), employee_target_id: t.counts_towards?.employee_target_id ?? null,
    link: { module: "workspace", tab: "tasks", id: t.task_id, path: `/workspace?tab=tasks&id=${t.task_id}` },
  };
};
/** The commitments a login may read: their own and their team's, everyone's for Operations and the CEO. */
const commitmentsFor = (user: string, waiting = false) => {
  const all = user === "cynthia" || user === "ifeoma";
  const team = new Set([me(user), ...teamOf(user).map((p) => p.employee_id)]);
  return TASKS.filter((t) => t.is_commitment && t.status !== "cancelled" && t.assignee && (waiting
    ? (setOf(t)?.status === "submitted" || RESCOPES.has(t.task_id)) && waitsOn(user, keyOf(t))
    : all || team.has(t.assignee.employee_id)));
};
const monthOf = (key?: string) => (key ? `${key}-01` : firstOf(isoDaysAgo(0)));
route("GET /api/v1/performance/commitments", (req) => {
  const { waiting_on_me, month, ...query } = req.query;
  const rows = commitmentsFor(req.user!, waiting_on_me === "true").filter((t) => !month || t.commitment_month === monthOf(month)).map(commitmentOf);
  return paged(rows, { ...req, query }, {
    search: (c) => [c.title, c.number, c.employee?.display_name],
    filters: { state: (c, v) => c.state === v, employee_id: (c, v) => c.employee?.employee_id === v, department_id: () => true },
    sort: { due_at: (a, b) => (a.due_at ?? "9").localeCompare(b.due_at ?? "9"), employee: (a, b) => (a.employee?.display_name ?? "").localeCompare(b.employee?.display_name ?? "") },
  });
});
route("GET /api/v1/performance/commitments/summary", (req) => {
  const month = monthOf(req.query.month);
  const rows = commitmentsFor(req.user!).filter((t) => t.commitment_month === month && (!req.query.employee_id || t.assignee?.employee_id === req.query.employee_id)).map(commitmentOf);
  const n = (s: Commitment["state"]) => rows.filter((c) => c.state === s).length;
  return ok({ month, commitments: rows.length, awaiting_approval: rows.filter((c) => c.state === "awaiting_approval" && c.set_status === "submitted").length, due: n("due"), on_time: n("on_time"), late: n("late"), missed: n("missed"), rescoped: n("rescoped") });
});
route("GET /api/v1/performance/commitments/sets", (req) => {
  const { waiting_on_me, month, ...query } = req.query;
  const all = req.user === "cynthia" || req.user === "ifeoma";
  const team = new Set([req.user, ...teamOf(req.user!).map((p) => p.user_key)]);
  for (const s of SETS) s.task_count = TASKS.filter((t) => t.commitment_set_id === s.commitment_set_id && t.status !== "cancelled").length;
  const rows = SETS.filter((s) => (waiting_on_me === "true" ? s.status === "submitted" && waitsOn(req.user!, s.key) : all || team.has(s.key)) && (!month || s.month === monthOf(month))).map(stripSet);
  return paged(rows, { ...req, query }, {
    search: (s) => [s.employee.display_name],
    filters: { employee_id: (s, v) => s.employee_id === v, status: (s, v) => s.status === v },
    sort: { submitted_at: (a, b) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""), employee: (a, b) => a.employee.display_name.localeCompare(b.employee.display_name) },
  });
});
route("POST /api/v1/performance/commitments/sets/:employee_id/:month/submit", (req) => {
  const who = byId(req.params.employee_id);
  if (!who || !canSetFor(req.user!, who.employee_id)) return fail(403, "FORBIDDEN", "You can send for yourself and your team");
  return send(req.user!, who.user_key, monthOf(req.params.month));
});
route("POST /api/v1/performance/commitments/report", (req) => exportFile(req.user!, `commitments-${String(req.body.month ?? "")}`));
route("POST /api/v1/performance/commitments/:id/rescope", (req) => {
  const t = find(req.user!, req.params.id);
  if (!t || !t.is_commitment) return notFound();
  if (!t.original_due_at) return fail(409, "COMMITMENT_NOT_APPROVED", "Only an approved commitment is rescoped");
  if (t.status === "done") return fail(409, "COMMITMENT_DONE", "This commitment is done");
  if (RESCOPES.has(t.task_id)) return fail(409, "WORKFLOW_ALREADY_OPEN", "A rescope is already waiting");
  t.rescope_reason = String(req.body.reason ?? "");
  if (byKey(keyOf(t))?.manager === req.user) t.rescoped_at = new Date().toISOString();
  else RESCOPES.set(t.task_id, uuid());
  return ok(commitmentOf(t));
});
route("POST /api/v1/performance/commitments/:id/recovery", (req) => {
  const t = find(req.user!, req.params.id);
  if (!t || !t.is_commitment) return notFound();
  if (stateOf(t) !== "missed") return fail(409, "COMMITMENT_NOT_MISSED", "Only a missed commitment needs recovery");
  if (recoveryOf(t.task_id)) return fail(409, "RECOVERY_SET", "This commitment already has a recovery");
  const owner = byId(String(req.body.primary_assignee_id ?? ""));
  if (!owner || !canSetFor(req.user!, owner.employee_id)) return invalid({ primary_assignee_id: ["Not in your team"] });
  const r: Task = {
    ...TASKS[0], task_id: sid(`task:recovery:${t.task_id}`), number: `TSK-${String(401 + TASKS.length).padStart(4, "0")}`, title: `Recovery: ${t.title}`.slice(0, 200),
    description: null, status: "todo", priority: "high", cadence: null, assignee: ref(owner)!, set_by: refKey(req.user!), due_at: `${String(req.body.due_on)}T16:00:00.000Z`,
    started_at: null, completed_at: null, entity_type: "task", entity_id: t.task_id, link: { module: "workspace", tab: "tasks", id: t.task_id, path: `/workspace?tab=tasks&id=${t.task_id}` },
    comment_count: 0, counts_towards: null, is_commitment: false, acceptance_criteria: null, commitment_month: null, original_due_at: null, rescoped_at: null, rescope_reason: null,
    commitment_set_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  TASKS.unshift(r);
  return created(commitmentOf(t));
});

/* The demonstration month: Cynthia's own commitments, one of her team's waiting on her, one missed last month. */
(() => {
  const mark = (title: string, criteria: string) => {
    const t = TASKS.find((x) => x.title === title);
    if (!t || !t.due_at) return null;
    Object.assign(t, { is_commitment: true, acceptance_criteria: criteria, commitment_month: firstOf(t.due_at) });
    return t;
  };
  const approve = (t: Task | null) => {
    if (!t) return;
    const s = setFor(keyOf(t), t.commitment_month!);
    t.commitment_set_id = s.commitment_set_id;
    t.original_due_at = t.due_at;
    Object.assign(s, { status: "approved", submitted_at: at(20, "10:00"), approved_at: at(19, "11:00"), workflow_instance_id: sid(`cset:wf:${s.commitment_set_id}`) });
  };
  approve(mark("Collect NDPA certificates from 4 staff", "All four certificates filed in People"));
  approve(mark("Publish Partnerships Associate vacancy", "Live on the careers page"));
  mark("Review Partnerships Associate shortlist", "Shortlist of five sent to the panel");
  approve(mark("Chase Landmark Beach proposal", "Signed proposal or a written no"));
  approve(mark("Decide: re-engage or close Kano Trade Council", "Decision recorded on the partner"));
  const waiting = mark("Renew facilities contract", "Renewal signed for 12 months");
  if (waiting) {
    const s = setFor(keyOf(waiting), waiting.commitment_month!);
    waiting.commitment_set_id = s.commitment_set_id;
    Object.assign(s, { status: "submitted", submitted_at: at(1, "09:00"), workflow_instance_id: sid(`cset:wf:${s.commitment_set_id}`) });
  }
})();

/* ───────────── The week (performance.md §6.18) ───────────── */

const WEEKS = new Map<string, { support_needed: string | null; summary_text: string | null; updated_at: string | null }>();
const mondayOf = () => isoDaysAgo((new Date().getUTCDay() + 6) % 7);
const weekOf = (employeeId: string, monday: string): WeekView => {
  const plus = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  const own = TASKS.filter((t) => t.assignee?.employee_id === employeeId).map(fresh);
  const list = (rows: Task[]) => ({ data: rows.slice(0, 25), total: rows.length });
  const saved = WEEKS.get(`${employeeId}:${monday}`);
  return {
    employee: ref(byId(employeeId))!,
    week_starts_on: monday,
    done: list(own.filter((t) => t.status === "done" && (t.completed_at ?? "") >= monday && (t.completed_at ?? "") < plus(monday, 7))),
    planned: list(own.filter((t) => open(t) && t.due_at && t.due_at >= plus(monday, 7) && t.due_at < plus(monday, 14))),
    blocked: list(own.filter((t) => open(t) && t.blocked_reason)),
    support_needed: saved?.support_needed ?? null,
    summary_text: saved?.summary_text ?? null,
    updated_at: saved?.updated_at ?? null,
  };
};
route("GET /api/v1/workspace/week", (req) => {
  const who = req.query.employee_id || me(req.user);
  if (who !== me(req.user) && !canSetFor(req.user!, who)) return notFound();
  return ok(weekOf(who, req.query.week_starts_on || mondayOf()));
});
route("PUT /api/v1/workspace/week", (req) => {
  const b = req.body as { week_starts_on: string; support_needed?: string | null; summary_text?: string | null };
  const k = `${me(req.user)}:${b.week_starts_on}`;
  const was = WEEKS.get(k) ?? { support_needed: null, summary_text: null, updated_at: null };
  WEEKS.set(k, {
    support_needed: "support_needed" in b ? b.support_needed || null : was.support_needed,
    summary_text: "summary_text" in b ? b.summary_text || null : was.summary_text,
    updated_at: new Date().toISOString(),
  });
  return ok(weekOf(me(req.user), b.week_starts_on));
});
route("GET /api/v1/workspace/team-weeks", (req) => {
  const { week_starts_on, ...query } = req.query;
  const monday = week_starts_on || mondayOf();
  const rows: TeamWeek[] = teamOf(req.user!).map((p) => {
    const w = weekOf(p.employee_id, monday);
    return { employee: ref(p)!, done: w.done.total, planned: w.planned.total, blocked: w.blocked.total, support_needed: w.support_needed };
  });
  return paged(rows, { ...req, query }, { search: (r) => [r.employee.display_name], sort: { employee: (a, b) => a.employee.display_name.localeCompare(b.employee.display_name) } });
});
route("POST /api/v1/workspace/week/tidy", (req) => {
  const b = req.body as { kind: string; text: string };
  if (b.kind !== "week") return invalid({ kind: ["Must be week"] });
  const w = weekOf(me(req.user), mondayOf());
  const lines = (rows: Task[]) => (rows.length ? rows.map((t) => t.title).join("\n") : "None.");
  const tidied = `Done\n${lines(w.done.data)}\nPlanned\n${lines(w.planned.data)}\nBlocked\n${lines(w.blocked.data)}\nSupport Needed\n${b.text.trim()}`;
  return ok({ available: true, original: b.text, tidied, ai_run_id: uuid() });
});
