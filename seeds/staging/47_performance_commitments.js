"use strict";
/**
 * Staging demonstration data: commitments (M2; docs/guides/performance.md §6.11, F13).
 *
 * October and November 2026 for a few of MyCity's real staff (lib/staff.js), through the tasks and
 * commitments services and the approval flow, each step as the person who would take it, so
 * numbers, approvals, events and audit are the real ones:
 *
 *   October    the head of department's first two reports mark their commitments and send the
 *              month, and their reviewer approves it. One is done before its date (On Time), one
 *              after it (Late), one is rescoped with a reason (Rescoped), one has a rescope waiting
 *              on the reviewer; the rest stay open (Due, then Missed when October closes). The line
 *              manager's first report marks theirs and has not sent them (Not Sent)
 *   November   the first report's month waits on the reviewer (Awaiting Approval), the second's
 *              came back with a reason (Returned), the head of department's own waits on the CEO
 *   recovery   once October has closed, its first missed commitment gets a Recovery task, set by
 *              the person's reviewer. A run before then leaves it to a later deploy
 *
 * A state is worked out on every read (tasks.repo COMMITMENT_STATE), so dates are set from the day
 * the seed runs: an On Time or Due commitment falls a few days after it, a Late one a few days
 * before, each kept inside its month. A step today's date or the staff list cannot give (no report
 * with a login, nothing before today in the month) is logged and left out.
 *
 * Run only by `scripts/db/seed.js --staging` (which refuses production three ways), after
 * 45_performance_plan.js and before 60_home.js. Idempotent: a month with commitments already is
 * left alone, and the recovery is set once. A part that fails is logged and the rest carry on, so
 * a demonstration gap never stops a deploy.
 */
const path = require("node:path");
const c = require("@mycity/contract");
const { realStaff } = require("./lib/staff");
const { loginsOf } = require("../lib/leave-sample");

const ROOT = path.resolve(__dirname, "..", "..");
const src = (p) => require(path.join(ROOT, "src", p));

const OCTOBER = "2026-10-01";
const NOVEMBER = "2026-11-01";
const CRITERIA = "Signed off by the reviewer, with the evidence attached to the task";

/** Each person's commitments for a month, and what becomes of each. */
const PLAN = {
  october: [
    [
      { title: "Publish the October social calendar", when: "soon", then: "done" },
      { title: "Close the Eko Hotels partnership proposal", when: "past", then: "done" },
      { title: "Launch the Enugu partner listings", when: "soon", then: "rescope", reason: "Enugu launch moved to November by the CEO" },
      { title: "Sign three new venue partners", when: "soon" },
    ],
    [
      { title: "Refresh the partner pitch deck", when: "soon", then: "rescope_asked", reason: "Waiting on the new brand guidelines" },
      { title: "Update the partner contact log", when: "soon" },
      { title: "Run two partner check-in calls", when: "past" },
    ],
  ],
  november: [
    [
      { title: "Plan the December events push", when: "soon" },
      { title: "Report October partner revenue", when: "soon" },
    ],
    [{ title: "Onboard the Abuja venue partners", when: "soon" }],
  ],
  head: [
    { title: "Agree Q1 2027 partnership targets", when: "soon" },
    { title: "Hire the partnerships associate", when: "soon" },
  ],
  notSent: [
    { title: "List twenty Enugu restaurants", when: "soon" },
    { title: "Photograph the Enugu launch venues", when: "soon" },
  ],
};

/** Run one part, logging rather than throwing. */
async function part(log, name, fn) {
  try {
    await fn();
  } catch (err) {
    log(`commitments ${name}: skipped (${err.code || err.name}: ${err.message})`);
  }
}

module.exports = async function seed({ pool, log = () => {}, now = new Date() }) {
  const lagos = src("shared/time/lagos");
  const { scopeFor } = src("middleware/rbac");
  const tasks = src("modules/tasks/tasks.service");
  const commitments = src("modules/targets/targets.commitments");
  const workflowService = src("modules/workflow/workflow.service");
  const grantsCache = src("shared/rbac/grants-cache");

  const staff = await realStaff(pool);
  const reports = staff.reportsOf(staff.head);
  const people = [staff.ceo, staff.head, staff.manager, staff.operations, ...staff.management, ...staff.everyone].filter(Boolean);
  const logins = await loginsOf(pool, [...new Set(people.map((p) => p.employee_id))]);
  const as = (p) => (p ? logins.get(p.employee_id) || null : null);
  const ceo = as(staff.ceo);
  const head = as(staff.head);
  if (!ceo || !head || reports.length < 2) {
    log("commitments: no CEO, head of department or two of their reports yet, nothing added");
    return;
  }
  // The head of department's first two reports send October and November; the line manager's first
  // report marks October's and does not send them.
  const [first, second] = reports;
  const unsent = staff.reportsOf(staff.manager).find((p) => p.employee_id !== first.employee_id && p.employee_id !== second.employee_id) || null;

  const today = lagos.today(now);
  /** A day four days after today, or before it, kept inside the month and never a Sunday. */
  const dayIn = (month, when) => {
    const { first: start, last } = lagos.monthBounds(month);
    let d = lagos.addDays(today, when === "past" ? -4 : 4);
    if (d < start) d = start;
    if (d > last) d = last;
    if (lagos.weekday(d) === 7) d = lagos.addDays(d, d === last ? -1 : 1);
    return d;
  };

  /** A month's commitments for a person, set by them when they have a login, else by the head. */
  const mark = async (person, month, list) => {
    const by = as(person) || head;
    const scope = await scopeFor(by, "workspace", "create");
    const made = [];
    for (const item of list) {
      const body = c.tasks.TaskCreate.parse({
        title: item.title,
        primary_assignee_id: person.employee_id,
        is_commitment: true,
        acceptance_criteria: CRITERIA,
        commitment_month: month,
        due_on: dayIn(month, item.when),
      });
      made.push({ ...item, task: await tasks.create(by, scope, body) });
    }
    return made;
  };

  /** Send a person's month, as them when they have a login, else as the head. */
  const send = async (person, month) => {
    const by = as(person) || head;
    return commitments.submit(by, await scopeFor(by, "workspace", "edit"), { employee_id: person.employee_id, month: month.slice(0, 7) });
  };

  /** Whoever the approval waits on, from the logins that could be asked. */
  const deciderOf = async (instanceId) => {
    for (const login of [head, ceo, as(staff.manager), as(staff.operations)].filter(Boolean)) {
      const user = await grantsCache.getAuthUser(pool, login.user_id);
      try {
        if ((await workflowService.getInstance(user, instanceId)).can_decide) return user;
      } catch {
        // Not theirs to read: the next one.
      }
    }
    return null;
  };

  /** Decide an approval as the person it waits on, and settle what it was over. */
  const decide = async (entity, instanceId, decision, reason = null) => {
    const user = await deciderOf(instanceId);
    if (!user) return false;
    const done = await workflowService.decide(user, instanceId, decision, reason);
    // The flow's handler settles it after commit too; settling here lets the next step follow.
    await commitments.settle(entity, { state: done.state, reason, instance_id: instanceId });
    return true;
  };

  const exists = async (month) => {
    const { rows } = await pool.query("SELECT 1 FROM task WHERE is_commitment AND commitment_month = $1 LIMIT 1", [month]);
    return rows.length > 0;
  };

  /* ---------------- October ---------------- */

  await part(log, "october", async () => {
    if (await exists(OCTOBER)) return log("commitments october: already there");
    let n = 0;
    for (const [i, person] of [first, second].entries()) {
      const made = await mark(person, OCTOBER, PLAN.october[i]);
      n += made.length;
      const set = await send(person, OCTOBER);
      if (set.status !== "approved" && !(await decide({ type: "commitment_set", id: set.commitment_set_id }, set.workflow_instance_id, "approve")))
        log(`commitments october: nobody to approve ${person.first_name}'s month, left waiting`);
      const by = as(person) || head;
      for (const item of made) {
        const id = item.task.task_id;
        if (item.then === "done") {
          if (item.when === "past" && dayIn(OCTOBER, "past") >= today) log("commitments october: no day before today in October, the late one is left open");
          else await tasks.move(by, await scopeFor(by, "workspace", "edit"), id, { status: "done" });
        }
        if (item.then === "rescope" || item.then === "rescope_asked") {
          const r = await commitments.rescope(by, await scopeFor(by, "workspace", "edit"), id, c.targets.CommitmentRescope.parse({ reason: item.reason }));
          const instance = (await pool.query(
            "SELECT workflow_instance_id FROM workflow_instance WHERE entity_type = 'task' AND entity_id = $1 AND state = 'pending'",
            [id],
          )).rows[0];
          if (item.then === "rescope" && instance && r.state !== "rescoped")
            await decide({ type: "task", id }, instance.workflow_instance_id, "approve");
        }
      }
    }
    if (unsent) n += (await mark(unsent, OCTOBER, PLAN.notSent)).length;
    log(`commitments october: ${n} added`);
  });

  /* ---------------- November ---------------- */

  await part(log, "november", async () => {
    if (await exists(NOVEMBER)) return log("commitments november: already there");
    let n = 0;
    for (const [i, person] of [first, second].entries()) {
      n += (await mark(person, NOVEMBER, PLAN.november[i])).length;
      const set = await send(person, NOVEMBER);
      if (i === 1 && set.status === "submitted")
        await decide({ type: "commitment_set", id: set.commitment_set_id }, set.workflow_instance_id, "reject", "Add the Abuja launch dates to each one");
    }
    // The head of department's own month goes to the CEO.
    n += (await mark(staff.head, NOVEMBER, PLAN.head)).length;
    await send(staff.head, NOVEMBER);
    log(`commitments november: ${n} added`);
  });

  /* ---------------- Recovery ---------------- */

  await part(log, "recovery", async () => {
    const { rows } = await pool.query(
      "SELECT 1 FROM task r JOIN task t ON r.entity_type = 'task' AND r.entity_id = t.task_id WHERE t.commitment_month = $1 LIMIT 1",
      [OCTOBER],
    );
    if (rows.length) return log("commitments recovery: already there");
    const scope = await scopeFor(ceo, "performance", "view");
    let missed = null;
    for (const person of [second, first]) {
      const query = c.targets.CommitmentListQuery.parse({ month: OCTOBER.slice(0, 7), employee_id: person.employee_id, state: "missed" });
      missed = missed || (await commitments.list(query, scope)).data[0] || null;
    }
    if (!missed) return log("commitments recovery: nothing missed yet (October has not closed)");
    await commitments.recovery(head, await scopeFor(head, "workspace", "create"), missed.task_id, {
      primary_assignee_id: missed.employee.employee_id,
      due_on: dayIn(today, "soon"),
    });
    log("commitments recovery: one set");
  });
};

module.exports.MONTHS = [OCTOBER, NOVEMBER];
