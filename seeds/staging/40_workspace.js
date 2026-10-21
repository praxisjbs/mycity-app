"use strict";
/**
 * Staging demonstration data: My Workspace (M2; docs/guides/workspace.md; F13).
 *
 * Everything goes through the tasks and calendar services as the person who would do it, on
 * MyCity's real staff found by post (lib/staff.js), so numbers, audit lines and notifications
 * are the real ones:
 *
 *   tasks       the CEO sets work for Operations & People and Management, the head of
 *               department and the line manager for their teams (A24), and people add their own
 *   calendar    this week's management meeting with its attendees, and a team standup
 *
 * Home wrote rows of its own into these two tables before M2 existed (lib/forward-rows.js); this
 * seed takes them away first, as lib/home-staging-rows.js asks, so Home reads M2's records.
 *
 * Run only by `scripts/db/seed.js --staging` (which refuses production three ways), after
 * 10_staff.js and before 60_home.js, so Home's sweep sees these records. Idempotent: each part
 * is left alone once it has records of its own (a numbered task, an event). A part that fails is
 * logged and the rest carry on, so a demonstration gap never stops a deploy.
 */
const path = require("node:path");
const c = require("@mycity/contract");
const { realStaff } = require("./lib/staff");
const { removeHomeStagingRows } = require("./lib/home-staging-rows");
const { loginsOf } = require("../lib/leave-sample");

const ROOT = path.resolve(__dirname, "..", "..");
const src = (p) => require(path.join(ROOT, "src", p));

/** The tables Home's forward rows filled that My Workspace now owns. */
const M2_TABLES = ["calendar_event", "task"];

/** Run one part, logging rather than throwing. */
async function part(log, name, fn) {
  try {
    await fn();
  } catch (err) {
    log(`${name}: skipped (${err.code || err.name}: ${err.message})`);
  }
}

async function exists(pool, sql) {
  const { rows } = await pool.query(sql);
  return rows.length > 0;
}

module.exports = async function seed({ pool, log }) {
  const lagos = src("shared/time/lagos");
  const { atomically } = src("shared/db/tx");
  const { scopeFor } = src("middleware/rbac");
  const tasks = src("modules/tasks/tasks.service");
  const calendar = src("modules/calendar/calendar.service");

  const client = await pool.connect();
  try {
    await atomically(client, () => removeHomeStagingRows(client, M2_TABLES));
  } finally {
    client.release();
  }

  const staff = await realStaff(pool);
  const people = [staff.ceo, staff.operations, staff.head, staff.manager, ...staff.management, ...staff.everyone].filter(Boolean);
  const logins = await loginsOf(pool, [...new Set(people.map((p) => p.employee_id))]);
  const as = (p) => (p ? logins.get(p.employee_id) || null : null);
  const ceo = as(staff.ceo);
  const head = as(staff.head);
  const manager = as(staff.manager);
  const headTeam = staff.reportsOf(staff.head).filter((p) => as(p));
  const managerTeam = staff.reportsOf(staff.manager).filter((p) => as(p));
  if (!ceo) {
    log("workspace: no CEO login yet (10_staff.js gives one), nothing added");
    return;
  }

  const today = lagos.today();
  const day = (n) => lagos.addDays(today, n);

  /* ---------------- My Workspace ---------------- */

  await part(log, "tasks", async () => {
    if (await exists(pool, "SELECT 1 FROM task WHERE number IS NOT NULL LIMIT 1")) return log("tasks: already there");
    const set = async (by, to, body) => {
      if (!by || !to) return;
      const scope = await scopeFor(by, "workspace", "create");
      return tasks.create(by, scope, c.tasks.TaskCreate.parse({ ...body, primary_assignee_id: to.employee_id }));
    };
    const plan = [
      [ceo, staff.operations, { title: "Sign off the payroll preview", priority: "high", cadence: "weekly" }],
      [ceo, staff.operations, { title: "Review the partnerships shortlist", due_on: day(2) }],
      [ceo, staff.management[0], { title: "Close out departmental targets", due_on: day(1) }],
      [ceo, staff.management[1], { title: "Fix clock-in retry on Android", priority: "urgent", due_on: day(3) }],
      [head, headTeam[0], { title: "Prepare the social calendar", cadence: "daily" }],
      [head, headTeam[0], { title: "Design the partner pitch deck", cadence: "weekly" }],
      [head, headTeam[1], { title: "Update the partner contact log", due_on: day(2) }],
      [head, headTeam[2], { title: "Chase the Eko Hotels proposal", priority: "high", due_on: day(1) }],
      [manager, managerTeam[0], { title: "Update listings for the Enugu launch", cadence: "weekly" }],
    ];
    let n = 0;
    for (const [by, to, body] of plan) if (await set(by, to, body)) n += 1;
    // A person's own work beside what was set for them (A24).
    for (const p of headTeam.slice(0, 2)) {
      const me = as(p);
      if (await set(me, p, { title: "Draft my notes for the team meeting", due_on: day(1), priority: "low" })) n += 1;
    }
    log(`tasks: ${n} added`);
  });

  await part(log, "calendar", async () => {
    if (await exists(pool, "SELECT 1 FROM calendar_event LIMIT 1")) return log("calendar: already there");
    const at = (d, hhmm) => lagos.instant(d, hhmm).toISOString();
    const meet = day(1);
    const attendees = [staff.operations, ...staff.management].filter((p) => p && as(p)).map((p) => p.employee_id);
    await calendar.create(
      ceo,
      c.calendar.CalendarEventCreate.parse({
        title: "Management Meeting",
        starts_at: at(meet, "10:00"),
        ends_at: at(meet, "11:00"),
        attendee_ids: attendees,
      }),
    );
    if (head && headTeam.length) {
      await calendar.create(
        head,
        c.calendar.CalendarEventCreate.parse({
          title: "Partnerships Standup",
          starts_at: at(meet, "09:30"),
          ends_at: at(meet, "10:00"),
          attendee_ids: headTeam.map((p) => p.employee_id),
        }),
      );
    }
    log("calendar: this week's meetings added");
  });

};

module.exports.M2_TABLES = M2_TABLES;
