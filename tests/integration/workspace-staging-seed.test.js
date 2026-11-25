"use strict";
/**
 * My Workspace's staging seed end to end (seeds/staging/40_workspace.js, docs/guides/workspace.md §4):
 * the real migrations, MyCity's real staff from 10_staff.js as the runner loads them, then the seed
 * twice. Through the services it shares a task with People and one with a Department, sets a
 * repeating task, two reminders and this week's Support Needed lines beside the board's work, and
 * the second run changes nothing. A later deploy finds the board aged and puts it back (QA BG-026):
 * the open tasks on their days from the deploy's day, each overdue one with its reason, the
 * priorities spread, and an earlier week's weekly report done.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/workspace-staging-seed
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public
 * schema. The seed runs on today's date, so what it sets ahead (the reminders) still lies ahead.
 */
const path = require("node:path");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const requestContext = require("../../src/config/request-context");
const { rebuild } = require("./helpers/schema");
const runner = require("../../scripts/db/seed");
const outbox = require("../../src/shared/events/outbox");
const lagos = require("../../src/shared/time/lagos");
const workingWeek = require("../../src/shared/time/working-week");
const realtime = require("../../src/services/realtime/emitter");
const { scopeFor } = require("../../src/middleware/rbac");
const workspace = require("../../src/modules/workspace/workspace.service");
const staffSeed = require("../../seeds/staging/10_staff");
const seed = require("../../seeds/staging/40_workspace");
const { realStaff } = require("../../seeds/staging/lib/staff");
const { loginsOf } = require("../../seeds/lib/leave-sample");

// The queues and the socket emitter would hold Redis connections open past the run.
jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);

/** A seed file run as the runner runs one: in its request context, as the seed. */
const runFile = (fn, logs = []) =>
  requestContext.run({ requestId: "seed-staging", surface: "script" }, () =>
    fn({ pool, actor: runner.ACTOR, log: (m) => logs.push(m) }),
  );

/** The tables the seed writes, and how many rows each holds. */
const TABLES = ["task", "task_assignee", "task_step", "task_dependency", "task_watcher", "task_blockage", "task_comment", "reminder", "weekly_summary", "calendar_event", "calendar_event_attendee"];
async function counts() {
  const out = {};
  for (const table of TABLES) out[table] = (await q(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
  return out;
}

describeDb("My Workspace's staging seed against the real migrations", () => {
  let first;
  let second;
  let staff;
  const logs = [];
  const monday = lagos.addDays(lagos.today(), 1 - lagos.weekday(lagos.today()));

  beforeAll(async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    await rebuild(pool, config.DB_NAME);
    await q("INSERT INTO system_marker (environment) VALUES ('test')");
    workingWeek.invalidateCalendar();
    outbox.markReady();
    await runFile(staffSeed);
    await runFile(seed, logs);
    first = await counts();
    await runFile(seed, logs);
    second = await counts();
    staff = await realStaff(pool);
  }, 180_000);

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("the runner loads it after the staff and before Home", () => {
    const files = runner.seedFiles("staging").map((f) => path.basename(f));
    const at = files.indexOf("40_workspace.js");
    expect(at).toBeGreaterThan(files.indexOf("10_staff.js"));
    expect(at).toBeLessThan(files.indexOf("60_home.js"));
  });

  test("running it twice changes nothing, and nothing was skipped", () => {
    expect(second).toEqual(first);
    expect(logs.filter((m) => m.includes("skipped"))).toEqual([]);
    for (const table of ["task", "task_assignee", "reminder", "weekly_summary", "calendar_event"]) expect([table, first[table] > 0]).toEqual([table, true]);
  });

  test("a task shared with People under one of them, and one shared with the head's department under the head", async () => {
    const { rows } = await q(
      `SELECT t.title, t.primary_assignee_id, t.set_by_employee_id, array_agg(a.employee_id ORDER BY a.employee_id) AS members,
              bool_and(e.department_id = d.department_id) AS same_department
         FROM task t
         JOIN task_assignee a ON a.task_id = t.task_id
         JOIN employee e ON e.employee_id = a.employee_id
         JOIN employee l ON l.employee_id = t.primary_assignee_id
         LEFT JOIN department d ON d.department_id = l.department_id
        GROUP BY t.task_id ORDER BY t.title`,
    );
    const byTitle = Object.fromEntries(rows.map((r) => [r.title, r]));
    const people = byTitle["Prepare the Q4 partner review"];
    expect(people).toBeDefined();
    expect(people.set_by_employee_id).toBe(staff.head.employee_id);
    expect(people.members).not.toContain(people.primary_assignee_id);
    const department = byTitle["Collect the department's Q4 leave plans"];
    expect(department).toBeDefined();
    expect(department).toMatchObject({ set_by_employee_id: staff.ceo.employee_id, primary_assignee_id: staff.head.employee_id, same_department: true });
    expect(department.members).not.toContain(staff.head.employee_id);
  });

  test("a repeating task, due on the Friday it repeats on", async () => {
    const { rows } = await q("SELECT recurrence, due_at FROM task WHERE recurrence IS NOT NULL");
    expect(rows).toHaveLength(1);
    expect(rows[0].recurrence).toEqual({ freq: "weekly", days: [5] });
    expect(lagos.weekday(lagos.dateOf(rows[0].due_at))).toBe(5);
  });

  test("two reminders on one open task, both still ahead", async () => {
    const { rows } = await q(
      `SELECT r.entity_id, r.due_at, t.status FROM reminder r JOIN task t ON t.task_id::text = r.entity_id
        WHERE r.reminder_key = 'task_reminder' AND r.state = 'pending'`,
    );
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.entity_id)).size).toBe(1);
    for (const r of rows) {
      expect(["done", "cancelled"]).not.toContain(r.status);
      expect(new Date(r.due_at).getTime()).toBeGreaterThan(Date.now());
    }
  });

  test("this week's Support Needed lines show on the manager's Team This Week", async () => {
    const { rows } = await q("SELECT employee_id, support_needed FROM weekly_summary WHERE week_starts_on = $1", [monday]);
    expect(rows.length).toBeGreaterThan(0);
    const head = (await loginsOf(pool, [staff.head.employee_id])).get(staff.head.employee_id);
    const page = await workspace.teamWeeks(head, await scopeFor(head, "workspace", "view"), { page: 1 });
    const lines = page.data.filter((r) => r.support_needed).map((r) => r.support_needed);
    expect(lines).toContain("Sign-off on the MTN venue budget by Wednesday");
  });

  test("the open tasks' priorities are spread, not left at Normal", async () => {
    const { rows } = await q("SELECT priority, count(*)::int AS n FROM task WHERE status NOT IN ('done', 'cancelled') GROUP BY priority");
    const by = Object.fromEntries(rows.map((r) => [r.priority, r.n]));
    for (const p of ["low", "normal", "high", "urgent"]) expect([p, (by[p] || 0) > 0]).toEqual([p, true]);
    const open = rows.reduce((n, r) => n + r.n, 0);
    expect(by.normal).toBeLessThan(open / 2);
  });

  // Last: it ages the board as weeks on staging would, then runs the seed as the next deploy does.
  test("a later deploy moves the open tasks back to their days, each overdue one with its reason", async () => {
    const day = (n) => lagos.addDays(lagos.today(), n);
    const dayOf = async (title) => lagos.dateOf((await q("SELECT due_at FROM task WHERE title = $1 AND status <> 'done' ORDER BY created_at LIMIT 1", [title])).rows[0].due_at);
    expect(await dayOf("Plan the Enugu launch week")).toBe(day(6));
    // Three weeks pass: every open task drifts back, its priority and reason as a careless edit might leave them.
    await q(
      `UPDATE task SET due_at = due_at - interval '21 days', late_reason = NULL,
                       priority = CASE WHEN title = 'Plan the Enugu launch week' THEN 'high' ELSE 'normal' END
        WHERE status NOT IN ('done', 'cancelled') AND due_at IS NOT NULL`,
    );
    const later = [];
    await runFile(seed, later);
    expect(later.filter((m) => m.includes("skipped"))).toEqual([]);
    expect(await dayOf("Plan the Enugu launch week")).toBe(day(6));
    expect(await dayOf("Review the partnerships shortlist")).toBe(day(-2));
    expect(await dayOf("Prepare the Q4 partner review")).toBe(day(4));
    expect(await dayOf("Draft my notes for the team meeting")).toBe(day(1));
    // Nothing open is left more than a day late without a reason (the seed's own overdue rows carry theirs).
    const { rows: late } = await q(
      `SELECT title, late_reason FROM task
        WHERE status NOT IN ('done', 'cancelled') AND due_at < $1`,
      [lagos.instant(lagos.today(), "00:00")],
    );
    expect(late.length).toBeGreaterThan(0);
    for (const t of late) expect([t.title, Boolean(t.late_reason)]).toEqual([t.title, true]);
    // A priority someone set on staging stays theirs; one left at Normal takes the plan's again.
    const prio = async (title) => (await q("SELECT priority FROM task WHERE title = $1 ORDER BY created_at LIMIT 1", [title])).rows[0].priority;
    expect(await prio("Plan the Enugu launch week")).toBe("high");
    expect(await prio("Approve the October expense requests")).toBe("urgent");
    // The weekly report from an earlier week was sent: done, so it is not left overdue.
    const report = (await q("SELECT status, late_reason FROM task WHERE recurrence IS NOT NULL ORDER BY created_at LIMIT 1")).rows[0];
    expect(report).toMatchObject({ status: "done", late_reason: "deprioritised" });
    // And the deploy after that, the same day, changes nothing.
    const now = await counts();
    await runFile(seed, []);
    expect(await counts()).toEqual(now);
  });
});
