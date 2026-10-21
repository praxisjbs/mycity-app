"use strict";
/**
 * Staging demonstration data: My Workspace and Performance (M2; docs/guides/workspace.md,
 * docs/guides/performance.md; F13).
 *
 * Everything goes through the M2 services as the person who would do it, on MyCity's real
 * staff found by post (lib/staff.js), so numbers, approvals, audit lines, notifications and
 * scores are the real ones:
 *
 *   tasks       the CEO sets work for Operations & People and Management, the head of
 *               department and the line manager for their teams (A24), and people add their own
 *   calendar    this week's management meeting with its attendees, and a team standup
 *   goals       the CEO's organisational goals for the year (active at once, A16); an annual and
 *               this month's goal under the first, set by Management and approved through
 *               `performance.goal` to the CEO
 *   targets     the head of department's two targets for this month, their team's KPIs with
 *               weights to 100, and the month submitted and approved, so it is binding
 *   reviews     this quarter's check-in, opened by Operations & People today, with the first
 *               two of the head's team having handed in their self review
 *
 * Home wrote rows of its own into these tables before M2 existed (lib/forward-rows.js); this
 * seed takes them away first, as lib/home-staging-rows.js asks, so Home reads M2's records.
 *
 * Run only by `scripts/db/seed.js --staging` (which refuses production three ways), after
 * 10_staff.js and before 60_home.js, so Home's sweep sees these records. Idempotent: each part
 * is left alone once it has records of its own (a numbered task, a numbered goal, a cycle).
 * A part that fails is logged and the rest carry on, so a demonstration gap never stops a
 * deploy.
 */
const path = require("node:path");
const c = require("@mycity/contract");
const { realStaff } = require("./lib/staff");
const { removeHomeStagingRows } = require("./lib/home-staging-rows");
const { loginsOf } = require("../lib/leave-sample");

const ROOT = path.resolve(__dirname, "..", "..");
const src = (p) => require(path.join(ROOT, "src", p));

/** The tables Home's forward rows filled that M2 now owns. */
const M2_TABLES = ["calendar_event", "task", "employee_target", "organisational_goal", "performance_review", "performance_cycle"];

const QUESTIONS = [
  "What went well this quarter?",
  "What got in the way, and what would help?",
  "What will you focus on next quarter?",
];

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
  const goals = src("modules/goals/goals.service");
  const targets = src("modules/targets/targets.service");
  const kpis = src("modules/kpis/kpis.service");
  const reviews = src("modules/reviews/reviews.service");

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
  const ops = as(staff.operations);
  const head = as(staff.head);
  const manager = as(staff.manager);
  const mgmt = as(staff.management[0]) || ceo;
  const headTeam = staff.reportsOf(staff.head).filter((p) => as(p));
  const managerTeam = staff.reportsOf(staff.manager).filter((p) => as(p));
  if (!ceo) {
    log("productivity: no CEO login yet (10_staff.js gives one), nothing added");
    return;
  }

  const today = lagos.today();
  const month = today.slice(0, 7);
  const year = Number(today.slice(0, 4));
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

  /* ---------------- Goals, targets and KPIs ---------------- */

  await part(log, "goals", async () => {
    if (await exists(pool, "SELECT 1 FROM organisational_goal WHERE code IS NOT NULL LIMIT 1")) return log("goals: already there");
    const approveAll = async (decide) => {
      for (let i = 0; i < 3; i += 1) {
        const r = await decide();
        if (r.status === "active") return r;
      }
      throw new Error("not approved after three stages");
    };
    const org = [];
    for (const g of [
      { title: "Reach 2 million active residents", strategic_theme: "Growth", success_measure: "Monthly active residents", baseline: "1.2 million" },
      { title: "Partnership revenue of ₦180M", strategic_theme: "Revenue", success_measure: "Signed partnership revenue", baseline: "₦95M" },
      { title: "Operate in 12 Nigerian cities", strategic_theme: "Expansion", success_measure: "Cities live", baseline: "7 cities" },
    ]) {
      org.push(
        await goals.create(
          ceo,
          c.goals.GoalCreate.parse({
            level: "organisation",
            year,
            ...g,
            quarters: [1, 2, 3, 4].map((q) => ({ quarter: q, milestone: `${g.success_measure}, quarter ${q} step` })),
          }),
        ),
      );
    }
    const annual = await goals.create(
      mgmt,
      c.goals.GoalCreate.parse({ level: "annual", year, title: "Grow active residents in the five launch cities", parent_goal_id: org[0].organisational_goal_id }),
    );
    await goals.submit(mgmt, annual.organisational_goal_id);
    await approveAll(() => goals.decide(ceo, annual.organisational_goal_id, { decision: "approve" }));
    const monthly = await goals.create(
      mgmt,
      c.goals.GoalCreate.parse({ level: "monthly", month, title: "Launch content and listings for Enugu", parent_goal_id: annual.organisational_goal_id }),
    );
    await goals.submit(mgmt, monthly.organisational_goal_id);
    await approveAll(() => goals.decide(ceo, monthly.organisational_goal_id, { decision: "approve" }));
    log(`goals: ${org.length} organisational, one annual and this month's, approved`);

    if (!head || !staff.head.department_id || !headTeam.length) return log("targets: no head of department with a team, none added");
    const t1 = await targets.create(head, c.targets.TargetCreate.parse({ title: "Publish 24 pieces for the Enugu launch", success_measure: "Pieces published", month, parent_goal_id: monthly.organisational_goal_id }));
    const t2 = await targets.create(head, c.targets.TargetCreate.parse({ title: "Sign 3 Enugu partners", success_measure: "Partners signed", month, parent_goal_id: monthly.organisational_goal_id }));
    const scope = await scopeFor(head, "performance", "create");
    let assigned = 0;
    for (const p of headTeam.filter((x) => x.department_id === staff.head.department_id).slice(0, 3)) {
      await kpis.assign(
        head,
        scope,
        p.employee_id,
        c.kpis.KpiAssign.parse({
          month,
          items: [
            { organisational_goal_id: t1.organisational_goal_id, title: "Publish launch pieces", target_value: "8", unit: "pieces", progress_source: "tasks", weight: "60" },
            { organisational_goal_id: t2.organisational_goal_id, title: "Partner meetings held", target_value: "6", unit: "meetings", progress_source: "manual", weight: "40" },
          ],
        }),
      );
      assigned += 1;
    }
    const plan = await targets.submitPlan(head, staff.head.department_id, month);
    for (let i = 0; i < 3; i += 1) {
      const id = plan.performance_plan_id;
      const r = await targets.decidePlan(ceo, id, { decision: "approve" });
      if ((r.status || (r.plan && r.plan.status)) === "active") break;
    }
    log(`targets: two for this month, KPIs for ${assigned} people, the month approved`);
  });

  /* ---------------- Reviews ---------------- */

  await part(log, "reviews", async () => {
    if (await exists(pool, "SELECT 1 FROM performance_cycle WHERE opened_by IS NOT NULL LIMIT 1")) return log("reviews: already there");
    const by = ops || ceo;
    const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
    const from = `${year}-${String(q * 3 + 1).padStart(2, "0")}-01`;
    const to = lagos.addDays(lagos.addMonths(from, 3), -1);
    await reviews.createCycle(
      by,
      c.reviews.CycleCreate.parse({ name: `Q${q + 1} ${year} Check-In`, starts_on: from, ends_on: to, opens_on: today, closes_on: day(14), questions: QUESTIONS }),
    );
    let handed = 0;
    for (const p of headTeam.slice(0, 2)) {
      const me = as(p);
      const review = await reviews.openSelf(me);
      if (!review || !review.form) continue;
      await reviews.save(review.performance_review_id, me, {
        overall_score: 4,
        items: review.form.items.map((i) => ({ employee_target_id: i.employee_target_id, score: 4, comment: "On course for the month." })),
        answers: review.form.answers.map((a) => ({ performance_cycle_question_id: a.performance_cycle_question_id, answer_text: "The Enugu launch content is on schedule." })),
      });
      await reviews.submit(review.performance_review_id, me);
      handed += 1;
    }
    log(`reviews: this quarter's check-in open, ${handed} self reviews handed in`);
  });
};

module.exports.M2_TABLES = M2_TABLES;
