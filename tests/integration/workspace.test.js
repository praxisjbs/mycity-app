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
});
