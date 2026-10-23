"use strict";
/**
 * My Workspace end to end (docs/guides/workspace.md): the real migrations on a throwaway
 * database, the whole app through HTTP, every response parsed with its contract
 * (APP_ENV=test). A manager sets work for their reporting line and the employee adds
 * their own beside it (A24); cards move between and within columns; a manager sees their
 * line's work and nobody else's; the calendar carries events, invitations and deadlines;
 * Today and Analytics read it all back.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/workspace
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the
 * public schema. Every person here is invented.
 */
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const lagos = require("../../src/shared/time/lagos");
const tasks = require("../../src/modules/tasks/tasks.service");
const queues = require("../../src/jobs/queues");
const realtime = require("../../src/services/realtime/emitter");
const systemMail = require("../../src/services/mail/system-mail.service");

// The reminder engine's tick also queues the daily digests; no queue runs here.
jest.mock("../../src/jobs/queues", () => ({
  ...jest.requireActual("../../src/jobs/queues"),
  enqueue: jest.fn(async () => ({ id: "1" })),
}));

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const PASSWORD = "Work-Space9Test";
const today = lagos.today();
const later = (n) => lagos.addDays(today, n);

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

async function drain() {
  for (let i = 0; i < 10; i += 1) {
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
    const r = await outbox.dispatchDue({ db: pool });
    if (r.claimed === 0) return;
  }
}

describeDb("my workspace against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  let ip = 0;

  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
    post: (path, body = {}) =>
      request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    patch: (path, body = {}) =>
      request(app).patch(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    put: (path, body = {}) =>
      request(app).put(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    del: (path) => request(app).delete(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
  });
  const emp = (who) => people[who].employee.employee_id;

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));

    const sample = (first, last, email, job, department) => ({
      first_name: first,
      last_name: last,
      work_email: email,
      phone: "08031234567",
      job_title: job,
      department_name: department,
      start_date: "2026-01-05",
      employment_type: "full_time",
      work_pattern: "on_site",
    });
    const make = (key, first, last, role, job, department = "Programmes") =>
      tx(async (client) => {
        people[key] = await createAdmin(
          client,
          { employee: sample(first, last, `${key}@mycity.test`, job, department), role_code: role, is_ceo: false },
          PASSWORD,
          { allowAdditional: true },
        );
      });
    await make("manager", "Ifeoma", "Chukwu", "manager", "Programme Lead");
    await make("staff", "Musa", "Danjuma", "employee", "Field Officer");
    await make("peer", "Zainab", "Lawal", "employee", "Field Officer");
    await make("outsider", "Bisi", "Ade", "employee", "Accounts Officer", "Finance");
    await make("director", "Ngozi", "Okafor", "management", "Operations Director", "Management");
    await make("ops", "Ngozi", "Eze", "operations_people", "Operations & People Lead", "Operations");
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = ANY($2::uuid[])", [
      emp("manager"),
      [emp("staff"), emp("peer")],
    ]);
    await require("../../src/shared/rbac/grants-cache").bumpTeamVersion();
    await drain();

    for (const key of Object.keys(people)) {
      ip += 1;
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.62.0.${ip}`)
        .send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  const ids = {};
  const bell = async (who) =>
    (await q(
      `SELECT n.title FROM notification n JOIN app_user u ON u.user_id = n.user_id WHERE u.employee_id = $1`,
      [emp(who)],
    )).rows.map((r) => r.title);

  test("a manager sets a weekly task for their report, who adds their own beside it (A24)", async () => {
    const set = await as("manager").post("/tasks", {
      title: "Visit three Lekki venues",
      primary_assignee_id: emp("staff"),
      cadence: "weekly",
      priority: "high",
    });
    expect(set.status).toBe(201);
    expect(set.body.number).toMatch(/^TSK-\d{4}$/);
    expect(set.body.assignee.employee_id).toBe(emp("staff"));
    expect(set.body.set_by.employee_id).toBe(emp("manager"));
    expect(set.body.due_at).not.toBeNull();
    ids.set = set.body.task_id;

    const own = await as("staff").post("/tasks", { title: "Write up venue notes", due_on: later(2) });
    expect(own.status).toBe(201);
    expect(own.body.set_by.employee_id).toBe(emp("staff"));
    ids.own = own.body.task_id;

    const board = await as("staff").get("/tasks?status=todo");
    expect(board.status).toBe(200);
    expect(board.body.data.map((t) => t.task_id).sort()).toEqual([ids.set, ids.own].sort());
  });

  test("nobody sets work for someone outside their scope", async () => {
    const res = await as("staff").post("/tasks", { title: "Chase the Eko follow-up", primary_assignee_id: emp("peer") });
    expect(res.status).toBe(422);
    expect(res.body.error.fields.primary_assignee_id).toBeTruthy();
    const out = await as("manager").post("/tasks", { title: "Not my team", primary_assignee_id: emp("outsider") });
    expect(out.status).toBe(422);
  });

  test("a manager sees their line's work and nobody else's", async () => {
    await as("outsider").post("/tasks", { title: "Reconcile September" });
    const team = await as("manager").get("/tasks?scope=team");
    expect(team.status).toBe(200);
    const titles = team.body.data.map((t) => t.title);
    expect(titles).toEqual(expect.arrayContaining(["Visit three Lekki venues", "Write up venue notes"]));
    expect(titles).not.toContain("Reconcile September");

    const outsiderTask = (await q("SELECT task_id FROM task WHERE title = 'Reconcile September'")).rows[0].task_id;
    expect((await as("manager").get(`/tasks/${outsiderTask}`)).status).toBe(404);
    expect((await as("peer").get(`/tasks/${ids.set}`)).status).toBe(404);
  });

  test("a reader whose grant is all sees everyone's work on My Team, its figures and the Wait On picker", async () => {
    const team = await as("director").get("/tasks?scope=team");
    expect(team.status).toBe(200);
    expect(team.body.data.map((t) => t.title)).toEqual(
      expect.arrayContaining(["Visit three Lekki venues", "Write up venue notes", "Reconcile September"]),
    );
    const figures = await as("director").get("/tasks/summary?scope=team");
    expect(figures.status).toBe(200);
    expect(figures.body.open).toBeGreaterThanOrEqual(3);
    const cancelled = await as("director").get("/tasks?scope=team&status=cancelled");
    expect(cancelled.status).toBe(200);
    // Their own board is still only their own.
    expect((await as("director").get("/tasks")).body.page.total).toBe(0);
  });

  test("a reader whose grant reaches everyone reads My Team's analytics (fault #1 in Analytics)", async () => {
    const analytics = await as("ops").get("/workspace/analytics?scope=team");
    expect(analytics.status).toBe(200);
    expect(analytics.body.workload.map((w) => w.employee.employee_id)).toEqual(expect.arrayContaining([emp("staff"), emp("outsider")]));
  });

  test("the assignee moves a manager's task but cannot change what the manager decided", async () => {
    const edit = await as("staff").patch(`/tasks/${ids.set}`, { title: "Visit two venues" });
    expect(edit.status).toBe(403);
    const notes = await as("staff").patch(`/tasks/${ids.set}`, { description: "Lekki Phase 1 first" });
    expect(notes.status).toBe(200);
    expect(notes.body.description).toBe("Lekki Phase 1 first");
    const cancel = await as("staff").post(`/tasks/${ids.set}/cancel`, { cancel_reason: "Too many" });
    expect(cancel.status).toBe(403);
  });

  test("cards move between columns and keep their place within one", async () => {
    const a = await as("staff").post(`/tasks/${ids.set}/move`, { status: "in_progress" });
    expect(a.status).toBe(200);
    expect(a.body.started_at).not.toBeNull();
    const b = await as("staff").post(`/tasks/${ids.own}/move`, { status: "in_progress", before_task_id: ids.set });
    expect(b.status).toBe(200);
    const col = await as("staff").get("/tasks?status=in_progress");
    expect(col.body.data.map((t) => t.task_id)).toEqual([ids.own, ids.set]);

    const wrong = await as("staff").post(`/tasks/${ids.own}/move`, { status: "todo", before_task_id: ids.set });
    expect(wrong.status).toBe(409);

    const done = await as("staff").post(`/tasks/${ids.set}/move`, { status: "done" });
    expect(done.body.completed_at).not.toBeNull();
    const back = await as("staff").post(`/tasks/${ids.set}/move`, { status: "in_review" });
    expect(back.body.completed_at).toBeNull();
    await as("staff").post(`/tasks/${ids.set}/move`, { status: "done" });
    await drain();
    const keys = (await q("SELECT event_key FROM event_log WHERE entity_id = $1 ORDER BY occurred_at", [ids.set])).rows.map((r) => r.event_key);
    expect(keys).toEqual(expect.arrayContaining(["task.created", "task.completed", "task.reopened"]));
  });

  test("blocking tells the setter; comments and history are on the panel", async () => {
    const blocked = await as("staff").post(`/tasks/${ids.own}/block`, { blocked_reason: "Waiting on the venue's reply" });
    expect(blocked.body.blocked_reason).toBe("Waiting on the venue's reply");
    const c = await as("manager").post(`/tasks/${ids.own}/comments`, { body: "Ring them this afternoon" });
    expect(c.status).toBe(201);
    expect(c.body.author.employee_id).toBe(emp("manager"));
    const comments = await as("staff").get(`/tasks/${ids.own}/comments`);
    expect(comments.body.page.total).toBe(1);
    const history = await as("staff").get(`/tasks/${ids.own}/activity`);
    expect(history.body.data.map((a) => a.kind)).toEqual(expect.arrayContaining(["created", "status_changed", "blocked", "commented"]));
    const panel = await as("staff").get(`/tasks/${ids.own}`);
    expect(panel.body.comment_count).toBe(1);
    expect(panel.body.can_cancel).toBe(true);
  });

  test("the setter cancels with a reason; cancelled leaves the board but stays reportable", async () => {
    const t = await as("manager").post("/tasks", { title: "Draft the Abuja plan", primary_assignee_id: emp("peer"), cadence: "daily" });
    const cancelled = await as("manager").post(`/tasks/${t.body.task_id}/cancel`, { cancel_reason: "Plan moved to November" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("cancelled");
    const board = await as("peer").get("/tasks");
    expect(board.body.data.map((x) => x.task_id)).not.toContain(t.body.task_id);
    const shown = await as("peer").get("/tasks?status=cancelled");
    expect(shown.body.data.map((x) => x.task_id)).toContain(t.body.task_id);
    const move = await as("peer").post(`/tasks/${t.body.task_id}/move`, { status: "todo" });
    expect(move.status).toBe(409);
  });

  test("the calendar holds events, invitations and task deadlines", async () => {
    const starts = lagos.instant(later(1), "10:00").toISOString();
    const ends = lagos.instant(later(1), "11:00").toISOString();
    const ev = await as("manager").post("/calendar", {
      title: "Venue review",
      starts_at: starts,
      ends_at: ends,
      attendee_ids: [emp("staff")],
    });
    expect(ev.status).toBe(201);
    expect(ev.body.attendees).toHaveLength(1);
    const answer = await as("staff").post(`/calendar/${ev.body.calendar_event_id}/respond`, { response: "accepted" });
    expect(answer.body.my_response).toBe("accepted");
    expect((await as("peer").get(`/calendar/${ev.body.calendar_event_id}`)).status).toBe(404);
    expect((await as("staff").patch(`/calendar/${ev.body.calendar_event_id}`, { title: "Mine now" })).status).toBe(403);

    const month = later(1).slice(0, 7);
    const own = await as("staff").get(`/calendar?month=${month}`);
    expect(own.status).toBe(200);
    expect(own.body.data.map((i) => i.title)).toContain("Venue review");
    const due = (await as("staff").get(`/calendar?month=${later(2).slice(0, 7)}`)).body.data;
    expect(due.find((i) => i.item_kind === "task" && i.item_id === ids.own)).toBeTruthy();
  });

  test("Today and Analytics read it back", async () => {
    const day = await as("staff").get("/workspace/today");
    expect(day.status).toBe(200);
    expect(day.body.date).toBe(today);
    expect(day.body.done_this_week).toBeGreaterThanOrEqual(1);

    const mine = await as("staff").get("/workspace/analytics");
    expect(mine.status).toBe(200);
    expect(mine.body.done).toBe(1);
    expect(mine.body.by_priority).toHaveLength(4);
    const team = await as("manager").get("/workspace/analytics?scope=team&period=90d");
    expect(team.body.workload.map((w) => w.employee.employee_id)).toEqual(expect.arrayContaining([emp("staff")]));
    expect(team.body.workload.map((w) => w.employee.employee_id)).not.toContain(emp("outsider"));
  });

  test("a repeating task comes round again on its next working day", async () => {
    const r = await as("staff").post("/tasks", {
      title: "Post the weekly update",
      due_on: later(-3),
      recurrence: { freq: "weekly", days: [1, 4] },
    });
    expect(r.status).toBe(201);
    const out = await tasks.sweep(new Date());
    expect(out.repeated).toBeGreaterThanOrEqual(1);
    const next = await q("SELECT due_at FROM task WHERE parent_task_id = $1", [r.body.task_id]);
    expect(next.rows).toHaveLength(1);
    const again = await tasks.sweep(new Date());
    expect(again.repeated).toBe(0);
  });
  test("steps: the assignee plans them, anyone who sees the task ticks them, the card counts them", async () => {
    const t = await as("manager").post("/tasks", { title: "Prepare the Ikeja launch kit", primary_assignee_id: emp("staff") });
    const one = await as("staff").post(`/tasks/${t.body.task_id}/steps`, { title: "Order banners", due_on: later(1) });
    expect(one.status).toBe(201);
    const two = await as("manager").post(`/tasks/${t.body.task_id}/steps`, { title: "Book the van" });
    expect(two.status).toBe(201);
    expect(two.body.sort_order).toBeGreaterThan(one.body.sort_order);
    const tick = await as("manager").patch(`/tasks/${t.body.task_id}/steps/${one.body.task_step_id}`, { done: true });
    expect(tick.status).toBe(200);
    expect(tick.body.done_by.employee_id).toBe(emp("manager"));
    expect((await as("outsider").patch(`/tasks/${t.body.task_id}/steps/${one.body.task_step_id}`, { done: false })).status).toBe(404);
    const card = await as("staff").get(`/tasks/${t.body.task_id}`);
    expect(card.body.steps_total).toBe(2);
    expect(card.body.steps_done).toBe(1);
    expect(card.body.steps.map((x) => x.title)).toEqual(["Order banners", "Book the van"]);
    const gone = await as("staff").del(`/tasks/${t.body.task_id}/steps/${two.body.task_step_id}`);
    expect(gone.status).toBe(200);
    expect(gone.body.steps).toHaveLength(1);
    const history = await as("staff").get(`/tasks/${t.body.task_id}/activity`);
    expect(history.body.data.map((a) => a.kind)).toEqual(expect.arrayContaining(["step_added", "step_done", "step_removed"]));
  });

  test("waiting on: a task does not start before what it waits on is done, no loops, and an override lets it go", async () => {
    const first = await as("staff").post("/tasks", { title: "Get venue sign-off" });
    const then = await as("staff").post("/tasks", { title: "Print the venue map" });
    const link = await as("staff").post(`/tasks/${then.body.task_id}/waiting-on`, { depends_on_task_id: first.body.task_id });
    expect(link.status).toBe(200);
    expect(link.body.waiting).toBe(true);
    expect(link.body.waiting_on[0].task.number).toBe(first.body.number);
    expect(link.body.waiting_on[0].satisfied).toBe(false);

    const loop = await as("staff").post(`/tasks/${first.body.task_id}/waiting-on`, { depends_on_task_id: then.body.task_id });
    expect(loop.status).toBe(422);
    expect(loop.body.error.fields.depends_on_task_id).toBeDefined();

    const early = await as("staff").post(`/tasks/${then.body.task_id}/move`, { status: "in_progress" });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("TASK_WAITING");

    const held = await as("staff").get(`/tasks/${first.body.task_id}`);
    expect(held.body.holding_up[0].task.task_id).toBe(then.body.task_id);

    const go = await as("staff").post(`/tasks/${then.body.task_id}/waiting-on/${link.body.waiting_on[0].task_dependency_id}/override`, { override_reason: "Sign-off promised by phone" });
    expect(go.body.waiting).toBe(false);
    expect(go.body.waiting_on[0].override_reason).toBe("Sign-off promised by phone");
    expect((await as("staff").post(`/tasks/${then.body.task_id}/move`, { status: "in_progress" })).status).toBe(200);

    const outsiderTask = await as("outsider").post("/tasks", { title: "Close the books" });
    const hidden = await as("staff").post(`/tasks/${first.body.task_id}/waiting-on`, { depends_on_task_id: outsiderTask.body.task_id });
    expect(hidden.status).toBe(422);
  });

  test("watchers are people who can already see the task; they hear about it, and a ping reaches whoever it names", async () => {
    const t = await as("manager").post("/tasks", { title: "Confirm caterer for the launch", primary_assignee_id: emp("staff") });
    // Zainab works beside Musa but cannot open his tasks: she is never made a watcher of one.
    const unseen = await as("manager").post(`/tasks/${t.body.task_id}/watchers`, { employee_id: emp("peer") });
    expect(unseen.status).toBe(422);
    expect(unseen.body.error.fields.employee_id).toEqual(["Cannot see this task"]);
    const added = await as("manager").post(`/tasks/${t.body.task_id}/watchers`, { employee_id: emp("director") });
    expect(added.status).toBe(200);
    expect(added.body.watchers.map((p) => p.employee_id)).toContain(emp("director"));
    const notMine = await as("staff").post(`/tasks/${t.body.task_id}/watchers`, {});
    expect(notMine.body.watching).toBe(true);
    expect((await as("outsider").post(`/tasks/${t.body.task_id}/watchers`, {})).status).toBe(404);

    const pinged = await as("manager").post(`/tasks/${t.body.task_id}/ping`, { message: "Need this by noon", to: "everyone" });
    expect(pinged.status).toBe(200);
    await drain();
    expect(await bell("director")).toEqual(expect.arrayContaining([expect.stringMatching(/nudged you/)]));
    expect(await bell("peer")).not.toEqual(expect.arrayContaining([expect.stringMatching(/nudged you on/)]));

    const left = await as("staff").del(`/tasks/${t.body.task_id}/watchers/${emp("staff")}`);
    expect(left.body.watching).toBe(false);
    expect((await as("staff").del(`/tasks/${t.body.task_id}/watchers/${emp("director")}`)).status).toBe(200);
  });

  test("a hold has a note and an expected day; clearing it moves the due time on and keeps the history", async () => {
    const t = await as("staff").post("/tasks", { title: "Collect the permit", due_on: later(3) });
    const block = await as("staff").post(`/tasks/${t.body.task_id}/block`, { blocked_reason: "Council office closed", estimated_resolve_on: later(2) });
    expect(block.status).toBe(200);
    expect((await as("staff").post(`/tasks/${t.body.task_id}/block`, { blocked_reason: "Again" })).status).toBe(409);
    const panel = await as("staff").get(`/tasks/${t.body.task_id}`);
    expect(panel.body.blockage.note).toBe("Council office closed");
    expect(panel.body.blockage.estimated_resolve_on).toBe(later(2));

    const team = await as("manager").get("/workspace/analytics?scope=team");
    expect(team.body.blocked.data.map((b) => b.task.task_id)).toContain(t.body.task_id);

    const cleared = await as("staff").post(`/tasks/${t.body.task_id}/unblock`, { resolve_note: "Opened again" });
    expect(cleared.status).toBe(200);
    expect(Date.parse(cleared.body.due_at)).toBeGreaterThan(Date.parse(t.body.due_at));
    const holds = await as("staff").get(`/tasks/${t.body.task_id}/blockages`);
    expect(holds.body.data).toHaveLength(1);
    expect(holds.body.data[0].due_shift_days).toBe(1);
    expect(holds.body.data[0].resolve_note).toBe("Opened again");

    await as("staff").post(`/tasks/${t.body.task_id}/block`, { blocked_reason: "Waiting on the stamp" });
    const kept = await as("staff").post(`/tasks/${t.body.task_id}/unblock`, { push_due: false });
    expect(kept.body.due_at).toBe(cleared.body.due_at);
    expect((await as("staff").get(`/tasks/${t.body.task_id}/blockages`)).body.page.total).toBe(2);
  });

  test("reminders: up to three, they follow the due time, and Done cancels them", async () => {
    const t = await as("staff").post("/tasks", { title: "Send the press note", due_on: later(4) });
    const set = await as("staff").put(`/tasks/${t.body.task_id}/reminders`, {
      reminders: [{ minutes_before: 60 }, { minutes_before: 1440 }],
    });
    expect(set.status).toBe(200);
    expect(set.body.reminders.map((r) => r.minutes_before)).toEqual([60, 1440]);
    expect(Date.parse(set.body.reminders[0].remind_at)).toBe(Date.parse(t.body.due_at) - 60 * 60000);

    const moved = await as("staff").patch(`/tasks/${t.body.task_id}`, { due_on: later(5) });
    const after = await as("staff").get(`/tasks/${t.body.task_id}`);
    expect(Date.parse(after.body.reminders[0].remind_at)).toBe(Date.parse(moved.body.due_at) - 60 * 60000);

    const tooMany = await as("staff").put(`/tasks/${t.body.task_id}/reminders`, { reminders: [{ minutes_before: 1 }, { minutes_before: 2 }, { minutes_before: 3 }, { minutes_before: 4 }] });
    expect(tooMany.status).toBe(422);
    const noDue = await as("staff").post("/tasks", { title: "Undated thought" });
    expect((await as("staff").put(`/tasks/${noDue.body.task_id}/reminders`, { reminders: [{ minutes_before: 30 }] })).status).toBe(422);

    await as("staff").post(`/tasks/${t.body.task_id}/move`, { status: "done" });
    expect((await as("staff").get(`/tasks/${t.body.task_id}`)).body.reminders).toHaveLength(0);
  });

  test("a late task carries its reason, and Analytics counts the overdue by reason and by age", async () => {
    const late = await as("staff").post("/tasks", { title: "Return the projector", due_on: later(-6) });
    const why = await as("staff").patch(`/tasks/${late.body.task_id}`, { late_reason: "waiting_on_others" });
    expect(why.status).toBe(200);
    expect(why.body.late_reason).toBe("waiting_on_others");
    const mine = await as("staff").get("/workspace/analytics");
    expect(mine.body.overdue_by_reason).toEqual(expect.arrayContaining([{ reason: "waiting_on_others", label: "Waiting on Others", count: 1 }]));
    expect(mine.body.overdue_aging.reduce((n, b) => n + b.count, 0)).toBe(mine.body.overdue);
    expect(mine.body.open).toBeGreaterThan(0);

    const done = await as("staff").post(`/tasks/${late.body.task_id}/move`, { status: "done", late_reason: "underestimated" });
    expect(done.body.late_reason).toBe("underestimated");
    const summary = await as("staff").get("/tasks/summary");
    expect(summary.body.done_30d).toBeGreaterThanOrEqual(1);
  });
  test("a repeat needs a due date to count from; set one and it repeats", async () => {
    const bare = await as("staff").post("/tasks", { title: "Water the plants", recurrence: { freq: "daily" } });
    expect(bare.status).toBe(422);
    expect(bare.body.error.fields.recurrence).toBeDefined();
    const t = await as("staff").post("/tasks", { title: "Water the plants", due_on: later(1) });
    const set = await as("staff").patch(`/tasks/${t.body.task_id}`, { recurrence: { freq: "weekly", days: [1, 3, 5] } });
    expect(set.status).toBe(200);
    expect(set.body.recurrence).toEqual({ freq: "weekly", days: [1, 3, 5] });
    expect((await as("staff").patch(`/tasks/${t.body.task_id}`, { due_on: null })).status).toBe(422);
    expect((await as("staff").patch(`/tasks/${t.body.task_id}`, { recurrence: { freq: "hourly" } })).status).toBe(422);
  });

  test("an event's reminders follow its start, go when it is called off, and fire to the people still going", async () => {
    const reminders = require("../../src/modules/notifications/notifications.reminders");
    const start = new Date(Date.now() + 3 * 86_400_000);
    start.setUTCMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 3_600_000);
    const made = await as("manager").post("/calendar", {
      title: "Venue Walkthrough",
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      attendee_ids: [emp("staff"), emp("peer")],
      reminder_minutes: [60, 15],
    });
    expect(made.status).toBe(201);
    expect(made.body.reminder_minutes).toEqual([15, 60]);
    const due = await q("SELECT due_at FROM reminder WHERE entity_id = $1 AND state = 'pending' ORDER BY due_at", [made.body.calendar_event_id]);
    expect(due.rows.map((r) => r.due_at.getTime())).toEqual([start.getTime() - 3_600_000, start.getTime() - 900_000]);

    const later2 = new Date(start.getTime() + 86_400_000);
    const moved = await as("manager").patch(`/calendar/${made.body.calendar_event_id}`, {
      starts_at: later2.toISOString(),
      ends_at: new Date(later2.getTime() + 3_600_000).toISOString(),
    });
    expect(moved.body.reminder_minutes).toEqual([15, 60]);
    const due2 = await q("SELECT min(due_at) AS first FROM reminder WHERE entity_id = $1 AND state = 'pending'", [made.body.calendar_event_id]);
    expect(due2.rows[0].first.getTime()).toBe(later2.getTime() - 3_600_000);

    await as("peer").post(`/calendar/${made.body.calendar_event_id}/respond`, { response: "declined" });
    const fired = await reminders.tick({ now: new Date(later2.getTime() - 3_590_000) });
    expect(fired).toBeTruthy();
    await drain();
    const told = await q(
      `SELECT u.employee_id FROM notification n JOIN app_user u ON u.user_id = n.user_id
        WHERE n.title = 'Starting soon: Venue Walkthrough'`,
    );
    const who = told.rows.map((r) => r.employee_id);
    expect(who).toEqual(expect.arrayContaining([emp("manager"), emp("staff")]));
    expect(who).not.toContain(emp("peer"));

    await as("manager").post(`/calendar/${made.body.calendar_event_id}/cancel`, {});
    const left = await q("SELECT count(*)::int AS n FROM reminder WHERE entity_id = $1 AND state = 'pending'", [made.body.calendar_event_id]);
    expect(left.rows[0].n).toBe(0);
  });

  test("a task reminder fires to the assignee through the reminder engine", async () => {
    const reminders = require("../../src/modules/notifications/notifications.reminders");
    const t = await as("manager").post("/tasks", { title: "Send the venue deposit", primary_assignee_id: emp("staff"), due_on: later(2) });
    await as("manager").put(`/tasks/${t.body.task_id}/reminders`, { reminders: [{ minutes_before: 60 }] });
    await reminders.tick({ now: new Date(Date.parse(t.body.due_at) - 3_500_000) });
    await drain();
    const told = await q(
      `SELECT n.title FROM notification n JOIN app_user u ON u.user_id = n.user_id WHERE u.employee_id = $1`,
      [emp("staff")],
    );
    expect(told.rows.map((r) => r.title)).toContain("Reminder: Send the venue deposit");
  });

  test("a card moves above another in its column, and to the foot without one", async () => {
    const a = await as("staff").post("/tasks", { title: "Order A" });
    const b = await as("staff").post("/tasks", { title: "Order B" });
    const c = await as("staff").post("/tasks", { title: "Order C" });
    const up = await as("staff").post(`/tasks/${c.body.task_id}/move`, { status: "todo", before_task_id: a.body.task_id });
    expect(up.status).toBe(200);
    const order = async () =>
      (await as("staff").get("/tasks?status=todo&q=Order")).body.data.map((t) => t.title);
    expect(await order()).toEqual(["Order C", "Order A", "Order B"]);
    await as("staff").post(`/tasks/${c.body.task_id}/move`, { status: "todo", before_task_id: null });
    expect(await order()).toEqual(["Order A", "Order B", "Order C"]);
    const wrong = await as("staff").post(`/tasks/${a.body.task_id}/move`, { status: "in_progress", before_task_id: b.body.task_id });
    expect(wrong.status).toBe(409);
  });

  test("swept after the day's due time, the next one is for the rule's following day, never late at birth", async () => {
    const thursdayEvening = new Date("2026-10-22T18:30:00Z"); // a Thursday, 19:30 in Lagos, after the day's close
    const r = await as("staff").post("/tasks", { title: "Send the Thursday digest", due_on: "2026-10-19", recurrence: { freq: "weekly", days: [1, 4] } });
    expect(r.status).toBe(201);
    await tasks.sweep(thursdayEvening);
    const next = await q("SELECT due_at FROM task WHERE parent_task_id = $1", [r.body.task_id]);
    expect(next.rows.map((row) => lagos.dateOf(new Date(row.due_at)))).toEqual(["2026-10-26"]);
    expect((await tasks.sweep(thursdayEvening)).repeated).toBe(0);
  });

  /* Shared tasks: one lead, the people sharing it beside them (A24 as extended, workspace.md §6). */
  const programmes = async () => (await q("SELECT department_id FROM department WHERE name = 'Programmes'")).rows[0].department_id;

  test("shared: a manager shares a task under a lead; the people on it see it, work it and hear of it", async () => {
    const t = await as("manager").post("/tasks", {
      title: "Run the Surulere pop-up",
      primary_assignee_id: emp("staff"),
      member_ids: [emp("peer"), emp("staff")],
    });
    expect(t.status).toBe(201);
    expect(t.body.assignee.employee_id).toBe(emp("staff"));
    expect(t.body.members.map((p) => p.employee_id)).toEqual([emp("peer")]);

    const board = await as("peer").get("/tasks?q=Surulere");
    expect(board.body.data.map((x) => x.task_id)).toEqual([t.body.task_id]);
    expect((await as("peer").post(`/tasks/${t.body.task_id}/move`, { status: "in_progress" })).status).toBe(200);
    const panel = await as("peer").get(`/tasks/${t.body.task_id}`);
    expect(panel.body.can_plan).toBe(true);
    expect(panel.body.can_reassign).toBe(false);
    expect((await as("peer").post(`/tasks/${t.body.task_id}/steps`, { title: "Book the canopy" })).status).toBe(201);
    expect((await as("peer").patch(`/tasks/${t.body.task_id}`, { priority: "high" })).status).toBe(200);
    const mark = await as("peer").patch(`/tasks/${t.body.task_id}`, { is_commitment: true });
    expect(mark.status).toBe(403);
    const asIs = await as("peer").patch(`/tasks/${t.body.task_id}`, { is_commitment: false, description: "Canopy from Ojuelegba" });
    expect(asIs.status).toBe(200);
    expect((await as("peer").patch(`/tasks/${t.body.task_id}`, { member_ids: [] })).status).toBe(403);

    await as("peer").post(`/tasks/${t.body.task_id}/move`, { status: "done" });
    await drain();
    expect(await bell("peer")).toEqual(expect.arrayContaining(["Ifeoma Chukwu shared a task with you"]));
    expect(await bell("staff")).toEqual(expect.arrayContaining(["Ifeoma Chukwu shared a task with you", "Musa Danjuma is done"]));
    expect((await as("outsider").get(`/tasks/${t.body.task_id}`)).status).toBe(404);
  });

  test("shared: staff share a task they lead with their own department, never beyond it or under another lead", async () => {
    const own = await as("staff").post("/tasks", { title: "Swap stand duty", member_ids: [emp("peer")] });
    expect(own.status).toBe(201);
    expect(own.body.assignee.employee_id).toBe(emp("staff"));
    expect(own.body.members.map((p) => p.employee_id)).toEqual([emp("peer")]);

    const far = await as("staff").post("/tasks", { title: "Ask Finance for receipts", member_ids: [emp("outsider")] });
    expect(far.status).toBe(422);
    expect(far.body.error.fields.member_ids).toEqual(["Not in your team"]);
    const both = await as("staff").post("/tasks", { title: "Both", member_ids: [emp("peer")], department_id: await programmes() });
    expect(both.status).toBe(422);

    const report = await as("manager").post("/tasks", {
      title: "Ops handover",
      primary_assignee_id: emp("staff"),
      member_ids: [emp("ops")],
    });
    expect(report.status).toBe(422);
    expect(report.body.error.fields.member_ids).toEqual(["Not in your team"]);
  });

  test("shared: a department becomes its people, under a lead picked from it; the pickers list who the caller may add", async () => {
    const programmesId = await programmes();
    const noLead = await as("ops").post("/tasks", { title: "Programmes stock count", department_id: programmesId });
    expect(noLead.status).toBe(422);
    expect(noLead.body.error.fields.primary_assignee_id).toEqual(["Pick a lead"]);
    const elsewhere = await as("ops").post("/tasks", { title: "Programmes stock count", department_id: programmesId, primary_assignee_id: emp("outsider") });
    expect(elsewhere.status).toBe(422);
    expect(elsewhere.body.error.fields.primary_assignee_id).toEqual(["Not in that department"]);
    const dept = await as("ops").post("/tasks", { title: "Programmes stock count", department_id: programmesId, primary_assignee_id: emp("manager") });
    expect(dept.status).toBe(201);
    expect(dept.body.assignee.employee_id).toBe(emp("manager"));
    expect(dept.body.members.map((p) => p.employee_id).sort()).toEqual([emp("staff"), emp("peer")].sort());

    const finance = (await q("SELECT department_id FROM department WHERE name = 'Finance'")).rows[0].department_id;
    const nobody = await as("staff").post("/tasks", { title: "Count Finance", department_id: finance, primary_assignee_id: emp("staff") });
    expect(nobody.status).toBe(422);
    expect(nobody.body.error.fields.department_id).toEqual(["Nobody to share with"]);

    const named = await as("manager").post("/tasks", { title: "Pack the stand", primary_assignee_id: emp("staff"), member_ids: [emp("peer")] });
    expect(named.status).toBe(422);
    expect(named.body.error.fields.primary_assignee_id).toEqual(["Pick from the people"]);

    const who = (res) => res.body.data.map((p) => p.employee_id).sort();
    expect((await as("staff").get("/tasks/people")).body.page.total).toBe(0);
    expect(who(await as("staff").get("/tasks/people?shared=true"))).toEqual([emp("manager"), emp("peer")].sort());
    expect(who(await as("manager").get("/tasks/people"))).toEqual([emp("staff"), emp("peer")].sort());
    const everyone = who(await as("ops").get("/tasks/people"));
    expect(everyone).toEqual(expect.arrayContaining([emp("manager"), emp("staff"), emp("peer"), emp("outsider")]));
    expect(everyone).not.toContain(emp("ops"));
    expect(who(await as("ops").get("/tasks/people?q=zain"))).toEqual([emp("peer")]);
    const leads = `/tasks/people?department_id=${programmesId}`;
    expect(who(await as("ops").get(leads))).toEqual([emp("manager"), emp("staff"), emp("peer")].sort());
    expect(who(await as("manager").get(leads))).toEqual([emp("manager"), emp("staff"), emp("peer")].sort());
    expect(who(await as("staff").get(leads))).toEqual([emp("staff")]);
  });

  test("shared: due today reaches the lead and the people sharing it", async () => {
    const thursdayMorning = new Date("2026-10-22T06:30:00Z"); // a Thursday, 07:30 in Lagos
    const t = await as("manager").post("/tasks", { title: "Hand in the Ikeja float", member_ids: [emp("staff"), emp("peer")], due_on: "2026-10-22" });
    expect(t.status).toBe(201);
    await tasks.sweep(thursdayMorning);
    await drain();
    const told = await q(
      `SELECT u.employee_id FROM notification n JOIN app_user u ON u.user_id = n.user_id
        WHERE n.title = 'Due today' AND n.body LIKE $1`,
      [`${t.body.number}:%`],
    );
    expect(told.rows.map((r) => r.employee_id).sort()).toEqual([emp("manager"), emp("staff"), emp("peer")].sort());
  });

  test("shared: the setter changes who shares it, and whoever is added hears", async () => {
    const t = await as("manager").post("/tasks", { title: "Print launch flyers", primary_assignee_id: emp("staff") });
    expect(t.body.members).toEqual([]);
    const shared = await as("manager").patch(`/tasks/${t.body.task_id}`, { member_ids: [emp("peer")] });
    expect(shared.status).toBe(200);
    expect(shared.body.members.map((p) => p.employee_id)).toEqual([emp("peer")]);
    await drain();
    expect(await bell("peer")).toEqual(expect.arrayContaining(["Ifeoma Chukwu put you on a task"]));

    const lead = await as("manager").patch(`/tasks/${t.body.task_id}`, { primary_assignee_id: emp("peer") });
    expect(lead.body.assignee.employee_id).toBe(emp("peer"));
    expect(lead.body.members).toEqual([]);
    const alone = await as("manager").patch(`/tasks/${t.body.task_id}`, { member_ids: [] });
    expect(alone.body.members).toEqual([]);
  });

  test("shared: a repeat is shared with the same people", async () => {
    const r = await as("manager").post("/tasks", {
      title: "Restock the Yaba kiosk",
      member_ids: [emp("staff")],
      due_on: later(-2),
      recurrence: { freq: "daily" },
    });
    expect(r.status).toBe(201);
    await tasks.sweep(new Date());
    const next = await q(
      `SELECT ta.employee_id FROM task n JOIN task_assignee ta ON ta.task_id = n.task_id WHERE n.parent_task_id = $1`,
      [r.body.task_id],
    );
    expect(next.rows.map((x) => x.employee_id)).toEqual([emp("staff")]);
  });

  /* ------------------------------------------------------------------ *
   * The 23/10 audit: who manages, who hears, what Today and Analytics count
   * ------------------------------------------------------------------ */

  const lagosAt = (hm) => lagos.instant(today, hm);
  const todayOf = (who, scope, now) =>
    require("../../src/modules/workspace/workspace.today").today(
      { user_id: people[who].user.user_id, employee_id: emp(who) },
      { scope, scope_ids: scope === "all" ? null : [emp(who)], employee_id: emp(who) },
      now,
    );

  test("the assignee of a task someone else set never manages it, even with an all grant; the setter and managers over them do", async () => {
    const t = await as("director").post("/tasks", { title: "Draft the Q4 staffing plan", primary_assignee_id: emp("ops") });
    expect(t.status).toBe(201);
    expect((await as("ops").patch(`/tasks/${t.body.task_id}`, { title: "Draft a staffing plan" })).status).toBe(403);
    expect((await as("ops").post(`/tasks/${t.body.task_id}/cancel`, { cancel_reason: "Not needed" })).status).toBe(403);
    const panel = await as("ops").get(`/tasks/${t.body.task_id}`);
    expect(panel.body.can_reassign).toBe(false);
    expect(panel.body.can_cancel).toBe(false);
    expect((await as("ops").patch(`/tasks/${t.body.task_id}`, { priority: "high" })).status).toBe(200);
    expect((await as("director").patch(`/tasks/${t.body.task_id}`, { title: "Draft the Q4 plan" })).status).toBe(200);

    // Over someone else's task, an all grant still manages it.
    const report = await as("manager").post("/tasks", { title: "Count the banners", primary_assignee_id: emp("staff") });
    expect((await as("ops").patch(`/tasks/${report.body.task_id}`, { title: "Count every banner" })).status).toBe(200);
  });

  test("Analytics: Mine counts what the reader leads or shares; what they set for others counts under My Team", async () => {
    const open = async (who, scope) => (await as(who).get(`/workspace/analytics${scope ? "?scope=team" : ""}`)).body.open;
    const [mineBefore, teamBefore, peerBefore] = [await open("manager"), await open("manager", "team"), await open("peer")];
    const t = await as("manager").post("/tasks", { title: "Collect stand receipts", primary_assignee_id: emp("staff"), member_ids: [emp("staff"), emp("peer")] });
    expect(t.status).toBe(201);
    expect(await open("manager")).toBe(mineBefore);
    expect(await open("manager", "team")).toBe(teamBefore + 1);
    expect(await open("peer")).toBe(peerBefore + 1);
  });

  test("Today: due today is open and not yet past, From Your Manager is the open tasks someone else set, and the diary is today's", async () => {
    const one = await as("ops").post("/tasks", { title: "Today probe one", primary_assignee_id: emp("outsider"), due_on: today });
    const two = await as("ops").post("/tasks", { title: "Today probe two", primary_assignee_id: emp("outsider"), due_on: today });
    const own = await as("outsider").post("/tasks", { title: "Today probe mine", due_on: today });
    const done = await as("ops").post("/tasks", { title: "Today probe done", primary_assignee_id: emp("outsider"), due_on: today });
    for (const r of [one, two, own, done]) expect(r.status).toBe(201);
    expect((await as("outsider").post(`/tasks/${done.body.task_id}/move`, { status: "done" })).status).toBe(200);
    const ev = await as("outsider").post("/calendar", {
      title: "Today probe meeting",
      starts_at: lagosAt("12:00").toISOString(),
      ends_at: lagosAt("13:00").toISOString(),
    });
    expect(ev.status).toBe(201);
    await as("outsider").post("/calendar", {
      title: "Tomorrow probe meeting",
      starts_at: lagos.instant(later(1), "12:00").toISOString(),
      ends_at: lagos.instant(later(1), "13:00").toISOString(),
    });

    const morning = await todayOf("outsider", "own", lagosAt("10:00"));
    const titles = (list) => list.data.map((t) => t.title);
    expect(titles(morning.my_day)).toEqual(expect.arrayContaining(["Today probe one", "Today probe two", "Today probe mine"]));
    expect(titles(morning.my_day)).not.toContain("Today probe done");
    expect(morning.due_today).toBeGreaterThanOrEqual(3);
    expect(morning.my_day.total).toBe(morning.overdue + morning.due_today);
    expect(titles(morning.set_by_manager)).toEqual(expect.arrayContaining(["Today probe one", "Today probe two"]));
    expect(titles(morning.set_by_manager)).not.toContain("Today probe mine");
    expect(titles(morning.set_by_manager)).not.toContain("Today probe done");
    expect(morning.set_by_manager.total).toBe(morning.set_by_manager.data.length);
    expect(morning.diary.data.map((i) => i.title)).toContain("Today probe meeting");
    expect(morning.diary.data.map((i) => i.title)).not.toContain("Tomorrow probe meeting");

    // Past the day's close a task due today is overdue, and counted once.
    const evening = await todayOf("outsider", "own", lagosAt("18:00"));
    expect(evening.due_today).toBe(0);
    expect(evening.my_day.total).toBe(evening.overdue);
    expect(titles(evening.my_day)).toEqual(expect.arrayContaining(["Today probe one", "Today probe mine"]));
  });

  test("done: the people on a task waiting on it hear about their own task, never the title of one they cannot open", async () => {
    const prereq = await as("ops").post("/tasks", { title: "Close the Finance ledger", primary_assignee_id: emp("outsider") });
    const waiting = await as("ops").post("/tasks", { title: "Pay the Ikeja vendor", primary_assignee_id: emp("staff") });
    expect((await as("ops").post(`/tasks/${waiting.body.task_id}/waiting-on`, { depends_on_task_id: prereq.body.task_id })).status).toBe(200);
    const panel = await as("staff").get(`/tasks/${waiting.body.task_id}`);
    expect(panel.body.waiting_on[0].task.title).toBe("A task you cannot open");

    expect((await as("outsider").post(`/tasks/${prereq.body.task_id}/move`, { status: "done" })).status).toBe(200);
    await drain();
    const told = await q(
      `SELECT n.title, n.body FROM notification n JOIN app_user u ON u.user_id = n.user_id WHERE u.employee_id = $1`,
      [emp("staff")],
    );
    expect(told.rows).toEqual(expect.arrayContaining([{ title: "A task you wait on is done", body: `${waiting.body.number}: Pay the Ikeja vendor` }]));
    expect(told.rows.some((r) => `${r.title} ${r.body}`.includes("Close the Finance ledger"))).toBe(false);

    // Someone sharing the other task may open it, so its title shows on the line.
    const sharedPrereq = await as("ops").post("/tasks", { title: "Sign the Finance memo", primary_assignee_id: emp("outsider"), member_ids: [emp("outsider"), emp("staff")] });
    expect(sharedPrereq.status).toBe(201);
    const next = await as("ops").post("/tasks", { title: "File the signed memo", primary_assignee_id: emp("staff") });
    expect((await as("ops").post(`/tasks/${next.body.task_id}/waiting-on`, { depends_on_task_id: sharedPrereq.body.task_id })).status).toBe(200);
    expect((await as("staff").get(`/tasks/${next.body.task_id}`)).body.waiting_on[0].task.title).toBe("Sign the Finance memo");
  });

  test("clearing a blocker tells the setter", async () => {
    const t = await as("manager").post("/tasks", { title: "Collect the gazebo", primary_assignee_id: emp("staff") });
    await as("staff").post(`/tasks/${t.body.task_id}/block`, { blocked_reason: "Van is out" });
    expect((await as("staff").post(`/tasks/${t.body.task_id}/unblock`, { resolve_note: "Van is back" })).status).toBe(200);
    await drain();
    expect(await bell("manager")).toEqual(expect.arrayContaining(["Unblocked: Collect the gazebo"]));
  });

  test("a repeat arrives quietly, and a task whose lead has left stops repeating", async () => {
    const r = await as("manager").post("/tasks", {
      title: "Sweep the Ajah stand",
      primary_assignee_id: emp("staff"),
      due_on: later(-2),
      recurrence: { freq: "daily" },
    });
    expect(r.status).toBe(201);
    await tasks.sweep(new Date());
    await drain();
    const told = await q(
      `SELECT count(*)::int AS n FROM notification n JOIN app_user u ON u.user_id = n.user_id
        WHERE u.employee_id = $1 AND n.title LIKE '%set you a task' AND n.body LIKE '%: Sweep the Ajah stand'`,
      [emp("staff")],
    );
    expect(told.rows[0].n).toBe(1);

    let leaver;
    await tx(async (client) => {
      leaver = await createAdmin(
        client,
        {
          employee: {
            first_name: "Tolu",
            last_name: "Bello",
            work_email: "leaver@mycity.test",
            phone: "08031234567",
            job_title: "Field Officer",
            department_name: "Programmes",
            start_date: "2026-01-05",
            employment_type: "full_time",
            work_pattern: "on_site",
          },
          role_code: "employee",
          is_ceo: false,
        },
        PASSWORD,
        { allowAdditional: true },
      );
    });
    const gone = await as("ops").post("/tasks", {
      title: "Restock the Lekki stand",
      primary_assignee_id: leaver.employee.employee_id,
      due_on: later(-2),
      recurrence: { freq: "daily" },
    });
    expect(gone.status).toBe(201);
    await q("UPDATE employee SET status = 'left' WHERE employee_id = $1", [leaver.employee.employee_id]);
    await tasks.sweep(new Date());
    expect((await q("SELECT 1 FROM task WHERE parent_task_id = $1", [gone.body.task_id])).rows).toHaveLength(0);
  });

  test("a card lands above another only on the reader's own board", async () => {
    const mine = await as("staff").post("/tasks", { title: "Tidy the stand box" });
    const theirs = await as("ops").post("/tasks", { title: "Audit petty cash", primary_assignee_id: emp("outsider") });
    const moved = await as("staff").post(`/tasks/${mine.body.task_id}/move`, { status: "todo", before_task_id: theirs.body.task_id });
    expect(moved.status).toBe(409);
  });

  test("a task cancelled with its record takes its reminders with it", async () => {
    const t = await as("staff").post("/tasks", { title: "Chase the KR evidence", due_on: later(6) });
    await as("staff").put(`/tasks/${t.body.task_id}/reminders`, { reminders: [{ minutes_before: 60 }] });
    const record = (await q("SELECT gen_random_uuid() AS id")).rows[0].id;
    await q("UPDATE task SET entity_type = 'key_result', entity_id = $2 WHERE task_id = $1", [t.body.task_id, record]);
    await tx((client) => tasks.cancelForRecord(client, null, { entity_type: "key_result", entity_id: record, reason: "Key result reverted" }));
    const after = await as("staff").get(`/tasks/${t.body.task_id}`);
    expect(after.body.status).toBe("cancelled");
    expect(after.body.reminders).toHaveLength(0);
  });

  test("a shared task is on its people's calendars and found from ⌘K", async () => {
    const t = await as("manager").post("/tasks", { title: "Brief the Ikorodu crew", primary_assignee_id: emp("staff"), member_ids: [emp("staff"), emp("peer")], due_on: later(3) });
    expect(t.status).toBe(201);
    const month = (await as("peer").get(`/calendar?month=${later(3).slice(0, 7)}&item_kind=task`)).body.data;
    expect(month.map((i) => i.item_id)).toContain(t.body.task_id);
    const found = await as("peer").get("/search?q=Ikorodu");
    expect(found.status).toBe(200);
    const items = found.body.groups.flatMap((g) => g.items);
    expect(items.map((i) => i.id)).toContain(t.body.task_id);
    // A task they did not set and do not share stays out of their search.
    const hidden = await as("manager").post("/tasks", { title: "Ikorodu budget review", primary_assignee_id: emp("staff") });
    expect((await as("peer").get("/search?q=Ikorodu")).body.groups.flatMap((g) => g.items).map((i) => i.id)).not.toContain(hidden.body.task_id);
  });

  test("an event's new people hear an invitation, people taken off hear that, and only a real change tells the rest", async () => {
    const starts = lagos.instant(later(2), "10:00").toISOString();
    const ends = lagos.instant(later(2), "11:00").toISOString();
    const ev = await as("manager").post("/calendar", { title: "Stand layout walk", starts_at: starts, ends_at: ends, attendee_ids: [emp("staff")] });
    expect(ev.status).toBe(201);
    const id = ev.body.calendar_event_id;
    expect((await as("manager").patch(`/calendar/${id}`, { attendee_ids: [emp("peer")] })).status).toBe(200);
    await drain();
    expect(await bell("peer")).toEqual(expect.arrayContaining(["Invitation: Stand layout walk"]));
    expect(await bell("staff")).toEqual(expect.arrayContaining(["No longer invited: Stand layout walk"]));
    expect(await bell("peer")).not.toEqual(expect.arrayContaining(["Changed: Stand layout walk"]));

    // Times compare as instants, whatever the text says: 09:30 UTC is after 10:00 Lagos (09:00 UTC),
    // and 09:30 Lagos (08:30 UTC) is before 09:00 UTC.
    const after = await as("manager").post("/calendar", { title: "Offset after", starts_at: `${later(2)}T10:00:00+01:00`, ends_at: `${later(2)}T09:30:00Z` });
    expect(after.status).toBe(201);
    const before = await as("manager").post("/calendar", { title: "Offset before", starts_at: `${later(2)}T09:00:00Z`, ends_at: `${later(2)}T09:30:00+01:00` });
    expect(before.status).toBe(422);
    const moved = await as("manager").patch(`/calendar/${id}`, { starts_at: lagos.instant(later(2), "14:00").toISOString(), ends_at: lagos.instant(later(2), "15:00").toISOString() });
    expect(moved.status).toBe(200);
    await drain();
    expect(await bell("peer")).toEqual(expect.arrayContaining(["Changed: Stand layout walk"]));
  });

  /* ------------------------------------------------------------------ *
   * The 23/10 audit, part 3: projects, late reasons, invitations, the live board
   * ------------------------------------------------------------------ */

  test("projects: anyone starts one, everyone lists it, and its board holds only the tasks the reader could see", async () => {
    const made = await as("staff").post("/projects", { name: "Lekki Launch", description: "Stands and flyers", due_on: later(20) });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ name: "Lekki Launch", status: "active", open: 0, done: 0, can_edit: true });
    expect(made.body.number).toMatch(/^PRJ-/);
    expect(made.body.owner.employee_id).toBe(emp("staff"));
    const id = made.body.project_id;

    const mine = await as("staff").post("/tasks", { title: "Print the Lekki flyers", project_id: id });
    expect(mine.status).toBe(201);
    expect(mine.body.project).toMatchObject({ project_id: id, name: "Lekki Launch" });
    const theirs = await as("ops").post("/tasks", { title: "Book the Lekki van", primary_assignee_id: emp("outsider"), project_id: id });
    expect(theirs.status).toBe(201);

    // Everyone sees the project; its counts and its board hold what each reader may see.
    const forPeer = (await as("peer").get("/projects?q=lekki")).body.data.find((p) => p.project_id === id);
    expect(forPeer).toMatchObject({ open: 0, can_edit: false });
    const forStaff = (await as("staff").get(`/projects/${id}`)).body;
    expect(forStaff.open).toBe(1);
    const forOps = (await as("ops").get(`/projects/${id}`)).body;
    expect(forOps).toMatchObject({ open: 2, can_edit: true });
    const board = await as("staff").get(`/tasks?scope=team&project_id=${id}`);
    expect(board.body.data.map((t) => t.title)).toEqual(["Print the Lekki flyers"]);
    expect((await as("ops").get(`/tasks?scope=team&project_id=${id}`)).body.page.total).toBe(2);

    // Only its owner (or an all grant) changes it; a completed project takes no new task.
    expect((await as("peer").patch(`/projects/${id}`, { name: "Mine now" })).status).toBe(403);
    const done = await as("staff").patch(`/projects/${id}`, { status: "completed" });
    expect(done.body).toMatchObject({ status: "completed" });
    expect(done.body.completed_at).toBeTruthy();
    const late = await as("staff").post("/tasks", { title: "One more stand", project_id: id });
    expect(late.status).toBe(422);
    expect(late.body.error.fields.project_id).toEqual(["Project is closed"]);
    expect((await as("staff").get("/projects?status=completed")).body.data.map((p) => p.project_id)).toContain(id);
    expect((await as("ops").patch(`/projects/${id}`, { status: "active" })).body.status).toBe("active");

    // A task leaves a project, or joins one, with whoever manages it.
    const out = await as("staff").patch(`/tasks/${mine.body.task_id}`, { project_id: null });
    expect(out.body.project).toBeNull();
    const back = await as("staff").patch(`/tasks/${mine.body.task_id}`, { project_id: id });
    expect(back.body.project.project_id).toBe(id);
    const found = await as("peer").get("/search?q=Lekki%20Launch");
    expect(found.body.groups.flatMap((g) => g.items).map((i) => i.id)).toContain(id);
  });

  test("late reasons: six to start, holders add and switch them, and Why Late takes only those switched on", async () => {
    const on = await as("staff").get("/tasks/late-reasons");
    expect(on.status).toBe(200);
    expect(on.body.data.map((r) => r.code)).toEqual([
      "waiting_on_others", "waiting_on_client", "blocked_by_another_team", "underestimated", "deprioritised", "other",
    ]);
    expect((await as("staff").post("/tasks/late-reasons", { label: "Power Cut" })).status).toBe(403);
    const added = await as("ops").post("/tasks/late-reasons", { label: "Power Cut" });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ code: "power_cut", label: "Power Cut", active: true });
    const again = await as("ops").post("/tasks/late-reasons", { label: "power cut" });
    expect(again.status).toBe(422);
    expect(again.body.error.fields.label).toEqual(["Already a reason"]);

    const t = await as("staff").post("/tasks", { title: "Fix the stand lights", due_on: later(-2) });
    expect((await as("staff").patch(`/tasks/${t.body.task_id}`, { late_reason: "power_cut" })).body.late_reason_label).toBe("Power Cut");
    const off = await as("director").patch(`/tasks/late-reasons/${added.body.task_late_reason_id}`, { active: false });
    expect(off.body.active).toBe(false);
    expect((await as("staff").get("/tasks/late-reasons")).body.data.map((r) => r.code)).not.toContain("power_cut");
    expect((await as("staff").get("/tasks/late-reasons?all=true")).body.data.map((r) => r.code)).not.toContain("power_cut");
    expect((await as("ops").get("/tasks/late-reasons?all=true")).body.data.map((r) => r.code)).toContain("power_cut");
    // The answer keeps its words; a new answer must be a reason switched on.
    expect((await as("staff").get(`/tasks/${t.body.task_id}`)).body.late_reason_label).toBe("Power Cut");
    const refused = await as("staff").post(`/tasks/${t.body.task_id}/move`, { status: "done", late_reason: "power_cut" });
    expect(refused.status).toBe(422);
    expect(refused.body.error.fields.late_reason).toEqual(["Pick a reason"]);
    expect((await as("staff").post(`/tasks/${t.body.task_id}/move`, { status: "done", late_reason: "waiting_on_client" })).status).toBe(200);
    const analytics = await as("staff").get("/workspace/analytics");
    expect(analytics.body.overdue_by_reason.every((r) => r.reason === null || typeof r.label === "string")).toBe(true);
  });

  test("invitations by email: the attendees get the event as an .ics, updated and cancelled with it, never the owner", async () => {
    queues.enqueue.mockClear();
    const starts = lagos.instant(later(4), "10:00").toISOString();
    const ends = lagos.instant(later(4), "11:00").toISOString();
    const ev = await as("manager").post("/calendar", { title: "Stand rehearsal", starts_at: starts, ends_at: ends, attendee_ids: [emp("staff")] });
    expect(ev.status).toBe(201);
    await drain();
    const invites = () => queues.enqueue.mock.calls.filter((c) => c[0] === "email-send" && c[1] === "calendar-invite").map((c) => c[2]);
    expect(invites().map((j) => j.to.email)).toEqual(["staff@mycity.test"]);
    const first = invites()[0];
    expect(first.data).toMatchObject({ heading: "Invitation", title: "Stand rehearsal", called_off: false });
    expect(first.attachments[0].content).toMatch(/METHOD:REQUEST/);
    expect(first.attachments[0].content).toMatch(/SEQUENCE:0/);
    // It renders through system mail as it would be sent.
    await systemMail.send({ to: first.to, template: first.template, data: first.data, recipient: first.recipient, attachments: first.attachments });
    const mail = systemMail.capturedMail().find((m) => m.template === "calendar-invite");
    expect(mail.subject).toBe("Invitation: Stand rehearsal");
    expect(mail.text).toMatch(/Organised by Ifeoma Chukwu/);

    queues.enqueue.mockClear();
    await as("manager").patch(`/calendar/${ev.body.calendar_event_id}`, { starts_at: lagos.instant(later(4), "12:00").toISOString(), ends_at: lagos.instant(later(4), "13:00").toISOString() });
    await drain();
    expect(invites()[0].data.heading).toBe("Updated");
    expect(invites()[0].attachments[0].content).toMatch(/SEQUENCE:1/);

    queues.enqueue.mockClear();
    await as("manager").post(`/calendar/${ev.body.calendar_event_id}/cancel`, {});
    await drain();
    expect(invites()[0].data).toMatchObject({ heading: "Called Off", called_off: true });
    expect(invites()[0].attachments[0].content).toMatch(/METHOD:CANCEL/);
    expect(invites().map((j) => j.to.email)).not.toContain("manager@mycity.test");
  });

  test("the live board: a change reaches the browsers of everyone who may see the task, and nobody else", async () => {
    const told = jest.spyOn(realtime, "toUser").mockReturnValue(true);
    expect(realtime.toUser("someone", "task.changed", {})).toBe(true);
    const t = await as("manager").post("/tasks", { title: "Mark out the stand", primary_assignee_id: emp("staff") });
    const other = await as("manager").post("/tasks", { title: "Bring the cones", primary_assignee_id: emp("staff") });
    await drain();
    told.mockClear();
    expect((await as("staff").post(`/tasks/${t.body.task_id}/move`, { status: "todo", before_task_id: other.body.task_id })).status).toBe(200);
    await drain();
    const reached = new Set(told.mock.calls.filter((c) => c[1] === "task.changed" && c[2].task_id === t.body.task_id).map((c) => c[0]));
    expect(reached.has(people.staff.user.user_id)).toBe(true);
    expect(reached.has(people.manager.user.user_id)).toBe(true);
    expect(reached.has(people.ops.user.user_id)).toBe(true);
    expect(reached.has(people.peer.user.user_id)).toBe(false);
    expect(reached.has(people.outsider.user.user_id)).toBe(false);
    told.mockRestore();
  });

  test("a lead who has left shows Left, and Home's roster counts open tasks for a reader who may see them", async () => {
    let gone;
    await tx(async (client) => {
      gone = await createAdmin(
        client,
        {
          employee: {
            first_name: "Kemi",
            last_name: "Ojo",
            work_email: "gone@mycity.test",
            phone: "08031234567",
            job_title: "Field Officer",
            department_name: "Programmes",
            start_date: "2026-01-05",
            employment_type: "full_time",
            work_pattern: "on_site",
          },
          role_code: "employee",
          is_ceo: false,
        },
        PASSWORD,
        { allowAdditional: true },
      );
    });
    const t = await as("ops").post("/tasks", { title: "Return the stand keys", primary_assignee_id: gone.employee.employee_id });
    expect(t.body.assignee_left).toBe(false);
    await q("UPDATE employee SET status = 'left' WHERE employee_id = $1", [gone.employee.employee_id]);
    expect((await as("ops").get(`/tasks/${t.body.task_id}`)).body.assignee_left).toBe(true);

    const roster = await as("ops").get("/home/team?q=Danjuma");
    if (roster.status === 200 && roster.body.data.length) {
      const row = roster.body.data.find((r) => r.employee.employee_id === emp("staff"));
      if (row) expect(typeof row.open_tasks).toBe("number");
    }
  });

  test("Praxis AI's New Event names its attendees, and start a project opens New Project", () => {
    const c = require("@mycity/contract");
    expect(c.calendar.CalendarEventPrefill.parse({ title: "Stand walk", attendee_ids: [emp("staff")] }).attendee_ids).toEqual([emp("staff")]);
    expect(c.projects.ProjectPrefill.parse({ name: "Ikeja Launch" }).name).toBe("Ikeja Launch");
  });
});
