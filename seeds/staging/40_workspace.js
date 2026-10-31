"use strict";
/**
 * Staging demonstration data: My Workspace (M2; docs/guides/workspace.md; F13).
 *
 * Everything goes through the tasks and calendar services as the person who would do it, on
 * MyCity's real staff found by post (lib/staff.js), so numbers, audit lines and notifications
 * are the real ones:
 *
 *   tasks       the CEO sets work for Operations & People and Management, the head of
 *               department and the line manager for their teams (A24), and people add their own;
 *               spread across the four columns, with steps, a task waiting on another, watchers,
 *               two holds, late reasons on the overdue, and six weeks of finished work for Analytics
 *   shared      a task the head shares with two of their team under one of them as lead (People),
 *               and one the CEO shares with the head's department under the head (Department)
 *   repeating   a weekly report the line manager sets, due each Friday
 *   reminders   two reminders (a day and an hour before) on the next open task due
 *   week        this week's Support Needed line from two people, which Team This Week shows
 *   calendar    this week's meetings with their attendees, a walkthrough, a review, today's
 *               planning, and the month's campaign and review-cycle dates
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

module.exports = async function seed({ pool, log = () => {}, now = new Date() }) {
  const lagos = src("shared/time/lagos");
  const { atomically } = src("shared/db/tx");
  const { scopeFor } = src("middleware/rbac");
  const tasks = src("modules/tasks/tasks.service");
  const calendar = src("modules/calendar/calendar.service");
  const workspace = src("modules/workspace/workspace.service");

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
  // Work is set for everyone on a team; only someone with a login adds their own.
  const headTeam = staff.reportsOf(staff.head);
  const managerTeam = staff.reportsOf(staff.manager);
  if (!ceo) {
    log("workspace: no CEO login yet (10_staff.js gives one), nothing added");
    return;
  }

  // The run's day, as Home's seed takes it, so a test can read Home on a fixed date.
  const today = lagos.today(now);
  const day = (n) => lagos.addDays(today, n);
  // Monday of the run's week (weekday is 1 for Monday, 7 for Sunday).
  const monday = lagos.addDays(today, 1 - lagos.weekday(today));

  const scopes = new Map();
  const scopeOf = async (by, action) => {
    const k = `${by.user_id}:${action}`;
    if (!scopes.has(k)) scopes.set(k, await scopeFor(by, "workspace", action));
    return scopes.get(k);
  };
  /** Set a task as `by` for `to`; the task as the service returns it, or null when either is missing. */
  const set = async (by, to, body) => {
    if (!by || !to) return null;
    return tasks.create(by, await scopeOf(by, "create"), c.tasks.TaskCreate.parse({ ...body, primary_assignee_id: to.employee_id }));
  };
  const edit = async (by) => scopeOf(by, "edit");
  /** Move it along the board, one column at a time, as the person who set it. */
  const moveTo = async (by, t, status, lateReason) => {
    const columns = ["in_progress", "in_review", "done"];
    for (const step of columns.slice(0, columns.indexOf(status) + 1)) {
      const body = { status: step, before_task_id: null, ...(step === "done" && lateReason ? { late_reason: lateReason } : {}) };
      await tasks.move(by, await edit(by), t.task_id, c.tasks.TaskMove.parse(body));
    }
  };

  /* ---------------- My Workspace ---------------- */

  await part(log, "tasks", async () => {
    if (await exists(pool, "SELECT 1 FROM task WHERE number IS NOT NULL LIMIT 1")) return log("tasks: already there");
    const ops = staff.operations;
    const mgmt = staff.management;
    const headTeam3 = headTeam.slice(0, 3);
    // [setter, assignee, task, column, extras]
    const plan = [
      [ceo, ops, { title: "Sign off the payroll preview", priority: "high", cadence: "weekly" }, "in_review"],
      // Overdue, so Home's Overdue Tasks and My Overdue Tasks have something to show.
      [ceo, ops, { title: "Review the partnerships shortlist", due_on: day(-2) }, "todo", { late: "waiting_on_others", steps: [["Collect the four proposals", true], ["Score them against the brief", false]] }],
      [ceo, ops, { title: "Close out Q4 departmental targets", due_on: day(1), priority: "high" }, "in_progress", { steps: [["Content", true], ["Partnerships", true], ["Studio", false], ["Finance", false]] }],
      [ceo, ops, { title: "Approve the October expense requests", due_on: day(0) }, "todo"],
      [ceo, mgmt[0], { title: "Close out departmental targets", due_on: day(-1) }, "todo", { late: "underestimated" }],
      [ceo, mgmt[1], { title: "Fix clock-in retry on Android", priority: "urgent", due_on: day(3) }, "in_review", { block: ["Waiting on the vendor's new build", day(2)] }],
      [ceo, mgmt[0], { title: "Plan the Enugu launch week", due_on: day(6) }, "in_progress"],
      [head, headTeam[0], { title: "Prepare the social calendar", due_on: day(-3) }, "todo", { late: "deprioritised" }],
      [head, headTeam[0], { title: "Design the partner pitch deck", cadence: "weekly" }, "in_progress", { steps: [["Draft the story", true], ["Pricing slide", false], ["Case studies", false]] }],
      [head, headTeam[1], { title: "Update the partner contact log", due_on: day(2) }, "in_progress"],
      [head, headTeam[2], { title: "Chase the Eko Hotels proposal", priority: "high", due_on: day(1) }, "todo", { block: ["Their legal team is reviewing", day(3)] }],
      [head, headTeam[1], { title: "Confirm venue list with MTN", priority: "urgent", due_on: day(0) }, "in_review"],
      [head, headTeam[2], { title: "Send the MOU to Lagos State Tourism", due_on: day(4) }, "todo", { waitsOn: 11 }],
      [manager, managerTeam[0], { title: "Update listings for the Enugu launch", cadence: "weekly" }, "in_progress"],
      [manager, managerTeam[1] || managerTeam[0], { title: "Shoot the Yaba studio for the site", due_on: day(5) }, "todo"],
      [manager, managerTeam[0], { title: "Edit the Ember to Remember teaser", priority: "high", due_on: day(-4) }, "in_review", { late: "waiting_on_others" }],
    ];
    const made = [];
    for (const [by, to, body, column, extra = {}] of plan) {
      const t = await set(by, to, body);
      made.push(t);
      if (!t) continue;
      for (const [title, done] of extra.steps || []) {
        const st = await tasks.addStep(by, await edit(by), t.task_id, c.tasks.TaskStepCreate.parse({ title }));
        if (done) await tasks.editStep(by, await edit(by), t.task_id, st.task_step_id, c.tasks.TaskStepEdit.parse({ done: true }));
      }
      if (extra.waitsOn !== undefined && made[extra.waitsOn])
        await tasks.addWaiting(by, await edit(by), t.task_id, c.tasks.TaskDependencyCreate.parse({ depends_on_task_id: made[extra.waitsOn].task_id }));
      if (column !== "todo") await moveTo(by, t, column);
      if (extra.late) await tasks.edit(by, await edit(by), t.task_id, c.tasks.TaskEdit.parse({ late_reason: extra.late }));
      if (extra.block)
        await tasks.block(by, await edit(by), t.task_id, c.tasks.TaskBlock.parse({ blocked_reason: extra.block[0], estimated_resolve_on: extra.block[1] }));
    }
    // The CEO watches the two tasks the launch hangs on, and asks after one of them.
    for (const i of [2, 11]) if (made[i]) await tasks.watch(ceo, await scopeOf(ceo, "view"), made[i].task_id, c.tasks.TaskWatcherAdd.parse({}));
    if (made[11] && head)
      await tasks.comment(ceo, await scopeOf(ceo, "view"), made[11].task_id, c.tasks.TaskCommentCreate.parse({ body: "Is the venue list final? MTN asked this morning." }));

    // Six weeks of finished work, so Analytics has a history: done through the service, then
    // dated back to the week it was finished (a demonstration's past, which no service writes).
    const doers = [[head, headTeam[0]], [head, headTeam[1]], [head, headTeam[2]], [manager, managerTeam[0]], [ceo, ops], [ceo, mgmt[0]]];
    const finished = [
      "Publish the Partnerships Associate vacancy", "Onboard the Abuja hub lead", "Deliver MTN campaign assets",
      "Reconcile September disbursements", "Q3 people report", "Photograph the Ikeja venues", "Write three Enugu blog posts",
      "Renew the facilities contract", "Brief the Kano partner", "Send the Filmhouse revenue model", "Clear the support inbox",
      "Collect NDPA certificates", "Shot list for the Enugu segment", "Update the brand template library",
      "Book the Lekki event space", "Review the October payroll preview", "Draft the partner newsletter", "Close the Q3 books",
    ];
    let back = 0;
    for (const [i, title] of finished.entries()) {
      const [by, to] = doers[i % doers.length];
      const t = await set(by, to, { title, priority: i % 5 === 0 ? "high" : "normal" });
      if (!t) continue;
      await moveTo(by, t, "done");
      const daysAgo = 2 + ((i * 7) % 40);
      const took = 1 + (i % 4);
      await pool.query(
        `UPDATE task SET created_at = now() - make_interval(days => $2::int + $3::int + 1),
                         started_at = now() - make_interval(days => $2::int + $3::int),
                         completed_at = now() - make_interval(days => $2::int),
                         due_at = now() - make_interval(days => $2::int + (CASE WHEN $4::boolean THEN 1 ELSE -1 END))
          WHERE task_id = $1`,
        [t.task_id, daysAgo, took, i % 6 === 0],
      );
      back += 1;
    }
    // A person's own work beside what was set for them (A24).
    let own = 0;
    for (const p of headTeam3.filter((x) => as(x)).slice(0, 2)) {
      const me = as(p);
      if (await set(me, p, { title: "Draft my notes for the team meeting", due_on: day(1), priority: "low" })) own += 1;
    }
    log(`tasks: ${made.filter(Boolean).length} set, ${back} finished in the last six weeks, ${own} of people's own`);
  });

  // Shared work (workspace.md §6): the Shared pill and Shared With on the board and the panel.
  await part(log, "shared tasks", async () => {
    if (await exists(pool, "SELECT 1 FROM task_assignee LIMIT 1")) return log("shared tasks: already there");
    let shared = 0;
    await part(log, "shared with people", async () => {
      // The head shares it with their team's first three, the first of them leading (a lead other than
      // the caller is one of the people named); with only one, the head leads it beside them.
      const picked = headTeam.slice(0, 3);
      const lead = picked.length >= 2 ? picked[0] : staff.head;
      if (!picked.length || !lead) return log("shared with people: nobody to share with");
      const t = await set(head, lead, { title: "Prepare the Q4 partner review", priority: "high", due_on: day(4), member_ids: picked.map((p) => p.employee_id) });
      if (t) shared += 1;
    });
    await part(log, "shared with a department", async () => {
      // The CEO shares it with the head's department; its lead comes from that department.
      if (!staff.head || !staff.head.department_id) return log("shared with a department: no head of department");
      const t = await set(ceo, staff.head, { title: "Collect the department's Q4 leave plans", due_on: day(5), department_id: staff.head.department_id });
      if (t) shared += 1;
    });
    log(`shared tasks: ${shared} shared`);
  });

  // A task that repeats (workspace.md §6): Repeats on the panel, the next copy made by the morning sweep.
  await part(log, "repeating task", async () => {
    if (await exists(pool, "SELECT 1 FROM task WHERE recurrence IS NOT NULL LIMIT 1")) return log("repeating task: already there");
    const [by, to] = [[manager, managerTeam[0]], [head, headTeam[0]], [ceo, staff.operations]].find(([b, t]) => b && t) || [];
    // Due on the next Friday from the run's day, the day it repeats on.
    const wd = lagos.weekday(today);
    const friday = lagos.addDays(today, wd <= 5 ? 5 - wd : 12 - wd);
    const t = await set(by, to, { title: "Send the weekly studio report", cadence: "weekly", due_on: friday, recurrence: { freq: "weekly", days: [5] } });
    log(t ? "repeating task: weekly, each Friday" : "repeating task: nobody to set it for");
  });

  // Reminders on an open task (workspace.md §6): the panel's Reminders. Set by whoever set the task,
  // on the next one due at least two days out, so both still lie ahead.
  await part(log, "reminders", async () => {
    if (await exists(pool, "SELECT 1 FROM reminder WHERE reminder_key = 'task_reminder' LIMIT 1")) return log("reminders: already there");
    const { rows } = await pool.query(
      `SELECT t.task_id, t.set_by_employee_id FROM task t
        WHERE t.status NOT IN ('done', 'cancelled') AND t.archived_at IS NULL AND t.due_at > now() + interval '2 days'
          AND t.set_by_employee_id = ANY($1::uuid[])
        ORDER BY t.due_at, t.task_id LIMIT 1`,
      [[...logins.keys()]],
    );
    const by = rows[0] && logins.get(rows[0].set_by_employee_id);
    if (!by) return log("reminders: no open task due far enough ahead");
    await tasks.setReminders(by, await edit(by), rows[0].task_id, c.tasks.TaskReminderSet.parse({ reminders: [{ minutes_before: 1440 }, { minutes_before: 60 }] }));
    log("reminders: a day and an hour before, on one task");
  });

  // This week's one line (workspace.md §6, performance.md §6.18): Support Needed on My Week and Team This Week.
  await part(log, "week", async () => {
    const { rows } = await pool.query("SELECT 1 FROM weekly_summary WHERE week_starts_on = $1 LIMIT 1", [monday]);
    if (rows.length) return log("week: already there");
    const lines = [
      [headTeam[0], "Sign-off on the MTN venue budget by Wednesday"],
      [managerTeam[0], "A second camera for Thursday's shoot"],
    ].filter(([p]) => p && as(p));
    for (const [p, line] of lines) await workspace.save(as(p), c.workspace.WeekSave.parse({ week_starts_on: monday, support_needed: line }));
    log(`week: ${lines.length} Support Needed lines`);
  });

  await part(log, "calendar", async () => {
    if (await exists(pool, "SELECT 1 FROM calendar_event LIMIT 1")) return log("calendar: already there");
    const at = (d, hhmm) => lagos.instant(d, hhmm).toISOString();
    // Monday of the run's week, so the meetings are in Your Week whatever day the seed runs.
    const meet = lagos.addDays(today, 1 - lagos.weekday(today));
    const attendees = [staff.operations, ...staff.management].filter((p) => p && as(p)).map((p) => p.employee_id);
    const add = (by, body) => (by ? calendar.create(by, c.calendar.CalendarEventCreate.parse(body)) : null);
    await add(ceo, { title: "Management Meeting", starts_at: at(meet, "10:00"), ends_at: at(meet, "11:00"), attendee_ids: attendees });
    if (head && headTeam.length) {
      const team = headTeam.map((p) => p.employee_id);
      await add(head, { title: "Partnerships Standup", starts_at: at(meet, "09:30"), ends_at: at(meet, "10:00"), attendee_ids: team });
      await add(head, { title: "MTN Venue Walkthrough", event_type: "event", location: "Victoria Island office", starts_at: at(lagos.addDays(meet, 2), "11:00"), ends_at: at(lagos.addDays(meet, 2), "12:00"), attendee_ids: team.slice(0, 2) });
      await add(head, { title: "Pipeline Review with Operations", starts_at: at(lagos.addDays(meet, 3), "14:00"), ends_at: at(lagos.addDays(meet, 3), "15:00"), attendee_ids: [staff.operations && staff.operations.employee_id].filter(Boolean) });
    }
    await add(ceo, { title: "Ember to Remember, Lagos Leg", event_type: "campaign", visibility: "everyone", all_day: true, starts_at: at(lagos.addDays(meet, 9), "00:00"), ends_at: at(lagos.addDays(meet, 10), "00:00") });
    await add(ceo, { title: "Q4 Review Cycle Opens", event_type: "deadline", visibility: "everyone", all_day: true, starts_at: at(lagos.addDays(meet, 14), "00:00"), ends_at: at(lagos.addDays(meet, 15), "00:00") });
    if (manager && managerTeam.length)
      await add(manager, { title: "Studio Planning", starts_at: at(today, "15:00"), ends_at: at(today, "15:30"), attendee_ids: managerTeam.map((p) => p.employee_id) });
    log("calendar: this week's meetings and the month's dates added");
  });

};

module.exports.M2_TABLES = M2_TABLES;
