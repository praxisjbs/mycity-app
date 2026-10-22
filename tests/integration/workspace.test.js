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

  test("watchers hear about it, and a ping reaches whoever it names", async () => {
    const t = await as("manager").post("/tasks", { title: "Confirm caterer for the launch", primary_assignee_id: emp("staff") });
    const added = await as("manager").post(`/tasks/${t.body.task_id}/watchers`, { employee_id: emp("peer") });
    expect(added.status).toBe(200);
    expect(added.body.watchers.map((p) => p.employee_id)).toContain(emp("peer"));
    const notMine = await as("staff").post(`/tasks/${t.body.task_id}/watchers`, {});
    expect(notMine.body.watching).toBe(true);
    expect((await as("outsider").post(`/tasks/${t.body.task_id}/watchers`, {})).status).toBe(404);

    const pinged = await as("manager").post(`/tasks/${t.body.task_id}/ping`, { message: "Need this by noon", to: "everyone" });
    expect(pinged.status).toBe(200);
    await drain();
    const peerBell = await q(
      `SELECT n.title FROM notification n JOIN app_user u ON u.user_id = n.user_id
        WHERE u.employee_id = $1 ORDER BY n.created_at DESC`,
      [emp("peer")],
    );
    expect(peerBell.rows.map((r) => r.title)).toEqual(expect.arrayContaining([expect.stringMatching(/nudged you/)]));

    const left = await as("staff").del(`/tasks/${t.body.task_id}/watchers/${emp("staff")}`);
    expect(left.body.watching).toBe(false);
    expect((await as("staff").del(`/tasks/${t.body.task_id}/watchers/${emp("peer")}`)).status).toBe(200);
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
    expect(mine.body.overdue_by_reason).toEqual(expect.arrayContaining([{ reason: "waiting_on_others", count: 1 }]));
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
});
