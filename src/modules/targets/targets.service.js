"use strict";
/**
 * Targets: a department's monthly targets, and its month approved as one (A16;
 * docs/guides/performance.md §3 steps 3, 5 and 6, §6).
 *
 *   create()      a departmental target under an active monthly goal of the same month, for the
 *                 caller's own department (any department, for the CEO); it joins the
 *                 department's plan for the month, made as a draft when there is none
 *   submitPlan()  the department's month into `performance.goal`: its targets and its people's
 *                 KPIs together, each person's weights totalling 100
 *   decidePlan()  approve or return the stage; the CEO's approval makes every target and KPI in
 *                 it active and binding, and each person hears their KPIs are set
 *   settle()      the outcome of a request that ended away from Targets
 *   recount()     a tasks-sourced KPI's actual, after a linked task enters or leaves Done
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const lagos = require("../../shared/time/lagos");
const goals = require("../goals/goals.service");
const goalsRepo = require("../goals/goals.repo");
const cascade = require("../goals/goals.cascade");
const repo = require("./targets.repo");
const approval = require("./targets.approval");
const { EVENTS } = require("./targets.events");

const iso = (v) => (v instanceof Date ? v.toISOString() : v || null);

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = (what = "target") => new AppError("NOT_FOUND", `That ${what} does not exist`, 404);
const conflict = (code, message) => new AppError(code, message, 409);

/** "YYYY-MM" of today, in Lagos. */
const thisMonth = () => lagos.today().slice(0, 7);
const monthStart = (month) => `${month}-01`;
const monthBefore = (month) => lagos.addMonths(monthStart(month), -1).slice(0, 7);
const EDITABLE = new Set(["draft", "returned"]);

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

function toTarget(row, progress, canDecide = false) {
  return {
    organisational_goal_id: row.organisational_goal_id,
    code: row.code,
    title: row.title,
    success_measure: row.success_measure,
    status: row.status,
    month: row.starts_on.slice(0, 7),
    department_id: row.department_id,
    department: row.department,
    rolls_up_to: row.rolls_up_to,
    owner: row.owner,
    performance_plan_id: row.performance_plan_id,
    progress: progress || { attainment: null, progress_status: null },
    can_decide: canDecide,
    created_at: iso(row.created_at),
  };
}

async function toPlan(client, row, actor) {
  const view = await approval.view(client, row.workflow_instance_id, actor);
  const own = await isOwnDepartment(client, actor, row.department_id);
  return {
    performance_plan_id: row.performance_plan_id,
    department_id: row.department_id,
    department: row.department,
    month: row.month,
    status: row.status,
    submitted_by: row.submitted_by,
    submitted_at: iso(row.submitted_at),
    approved_at: iso(row.approved_at),
    workflow_instance_id: row.workflow_instance_id,
    waiting_on: view.waiting_on,
    targets: row.targets,
    kpis: row.kpis,
    route: view.route,
    can_submit: EDITABLE.has(row.status) && row.targets > 0 && own,
    can_decide: row.status === "pending_approval" && view.can_decide,
  };
}

const planPayload = (plan, extra = {}) => ({
  performance_plan_id: plan.performance_plan_id,
  department_id: plan.department_id,
  department: plan.department,
  month: plan.month,
  ...extra,
});

/* ------------------------------------------------------------------ *
 * Who sets a department's targets
 * ------------------------------------------------------------------ */

async function employeeDepartment(client, employeeId) {
  if (!employeeId) return null;
  const { rows } = await client.query("SELECT department_id FROM employee WHERE employee_id = $1", [employeeId]);
  return rows[0] ? rows[0].department_id : null;
}

/** May the caller set and submit this department's targets? Their own, with goals.department; any, for the CEO. */
async function isOwnDepartment(client, actor, departmentId) {
  if (!actor) return false;
  if (actor.is_ceo === true) return true;
  if (!(await cascade.mayAuthor(client, actor, "department"))) return false;
  return (await employeeDepartment(client, actor.employee_id)) === departmentId;
}

/** The department a new target is for: the caller's own; the CEO may name another. */
async function departmentFor(client, actor, asked) {
  if (actor.is_ceo === true && asked) return asked;
  const own = await employeeDepartment(client, actor.employee_id);
  if (!own) throw new AppError("NO_DEPARTMENT", "You are not in a department", 422);
  if (asked && asked !== own) throw new AppError("PERMISSION_DENIED", "Set targets for your own department", 403);
  return own;
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

async function list(query, scope, actor) {
  const month = query.month || thisMonth();
  const { first, last } = lagos.monthBounds(monthStart(month));
  const departments = await repo.departmentsOf(pool, scope);
  const page = await repo.listTargets(pool, { ...query, from: first, to: last }, departments);
  const progress = await goals.progressFor(pool, page.data);
  const plans = new Map();
  for (const row of page.data) {
    if (row.performance_plan_id && !plans.has(row.performance_plan_id)) {
      const plan = await repo.getPlan(pool, row.performance_plan_id);
      const view = plan ? await approval.view(pool, plan.workflow_instance_id, actor) : null;
      plans.set(row.performance_plan_id, Boolean(plan && plan.status === "pending_approval" && view && view.can_decide));
    }
  }
  return {
    ...page,
    data: page.data.map((r) =>
      toTarget(r, progress.get(r.organisational_goal_id), plans.get(r.performance_plan_id) || false),
    ),
  };
}

/** Last Month's Results: each department's mean attainment over its targets of the month. */
async function results(client, month) {
  const { first, last } = lagos.monthBounds(monthStart(month));
  const rows = await repo.activeTargetsOfMonth(client, first, last);
  const progress = await goals.progressFor(client, rows);
  const byDept = new Map();
  for (const r of rows) {
    const a = progress.get(r.organisational_goal_id);
    if (!byDept.has(r.department_id)) byDept.set(r.department_id, { department: r.department, values: [] });
    if (a && a.attainment !== null) byDept.get(r.department_id).values.push(a.attainment);
  }
  return [...byDept.entries()].map(([id, v]) => ({
    department_id: id,
    department: v.department,
    attainment: v.values.length ? v.values.reduce((x, y) => x + y, 0) / v.values.length : null,
  }));
}

const STAGES = [
  { key: "management", name: "Management" },
  { key: "operations_people", name: "Operations & People" },
  { key: "ceo", name: "CEO" },
];

async function summary(query, actor) {
  const month = query.month || thisMonth();
  const rows = await repo.plansOfMonth(pool, monthStart(month));
  const plans = [];
  for (const r of rows) plans.push(await toPlan(pool, r, actor));
  const waitingAt = (key) =>
    plans.filter((p) => p.status === "pending_approval" && p.route.some((s) => s.key === key && s.state === "now")).length;
  const ownDepartment = await employeeDepartment(pool, actor.employee_id);
  const trail = await repo.trailOfMonth(pool, monthStart(month));
  return {
    month,
    departments: plans.length,
    approved: plans.filter((p) => p.status === "active").length,
    awaiting: plans.filter((p) => p.status === "pending_approval").length,
    chain: STAGES.map((s) => ({ ...s, waiting: waitingAt(s.key) })),
    my_plan: plans.find((p) => p.department_id === ownDepartment) || null,
    plans,
    last_month: await results(pool, monthBefore(month)),
    trail: trail.map((d) => ({
      workflow_decision_id: d.workflow_decision_id,
      stage_key: d.stage_key,
      stage_name: (STAGES.find((s) => s.key === d.stage_key) || {}).name || null,
      actor_id: d.actor_id,
      actor_name: d.actor_name,
      decision: d.decision,
      reason: d.reason,
      decided_at: iso(d.decided_at),
      performance_plan_id: d.performance_plan_id,
      department: d.department,
    })),
  };
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

async function create(actor, body) {
  const id = await tx(async (client) => {
    const departmentId = await departmentFor(client, actor, body.department_id);
    const period = cascade.periodOf({ level: "department", month: body.month });
    const parent = await goalsRepo.get(client, body.parent_goal_id);
    cascade.assertParent("department", parent, period);
    const plan = await repo.ensurePlan(client, departmentId, monthStart(body.month));
    if (!EDITABLE.has(plan.status))
      throw conflict("PLAN_LOCKED", "This month is already sent for approval");
    return goals.insertGoal(client, actor, {
      level: "department",
      parent_goal_id: body.parent_goal_id,
      department_id: departmentId,
      title: body.title,
      success_measure: body.success_measure,
      description: body.description,
      status: "draft",
      performance_plan_id: plan.performance_plan_id,
      ...period,
    });
  });
  const row = await goalsRepo.get(pool, id);
  return toTarget(row, (await goals.progressFor(pool, [row])).get(id));
}

async function submitPlan(actor, departmentId, month) {
  const planId = await tx(async (client) => {
    if (!(await isOwnDepartment(client, actor, departmentId)))
      throw new AppError("PERMISSION_DENIED", "Submit your own department's month", 403);
    const plan = await repo.planOf(client, departmentId, monthStart(month), { lock: true });
    if (!plan || plan.targets === 0) throw new AppError("PLAN_EMPTY", "Set at least one target first", 422);
    if (!EDITABLE.has(plan.status)) throw conflict("PLAN_LOCKED", "This month is already sent for approval");
    const off = await repo.weightsOff(client, plan.performance_plan_id);
    if (off.length) {
      throw new AppError("WEIGHTS_NOT_100", "Each person's KPI weights must total 100%", 422, {
        weights: off.map((p) => `${p.name}: ${Number(p.total).toFixed(2)}%`),
      });
    }
    const instance = await approval.submit(client, plan.performance_plan_id, actor);
    const status = approval.statusFor(instance.state);
    await repo.setPlan(client, plan.performance_plan_id, {
      status,
      submittedBy: actor.user_id,
      workflowInstanceId: instance.workflow_instance_id,
      approved: status === "active",
    });
    await goalsRepo.setPlanStatus(client, plan.performance_plan_id, status);
    await repo.setPlanKpis(client, plan.performance_plan_id, status, status === "active" ? actor.user_id : null);
    await emit(client, {
      key: EVENTS.PLAN_SUBMITTED,
      entity: { type: "performance_plan", id: plan.performance_plan_id },
      actor,
      before: { status: plan.status },
      after: { status },
      payload: planPayload(plan, { submitted_by: actor.user_id }),
    });
    return plan.performance_plan_id;
  });
  return planView(planId, actor);
}

async function decidePlan(actor, planId, { decision, reason = null }) {
  await tx(async (client) => {
    const plan = await repo.getPlan(client, planId, { lock: true });
    if (!plan) throw notFound("month");
    if (plan.status !== "pending_approval" || !plan.workflow_instance_id)
      throw conflict("PLAN_NOT_PENDING", "This month is not waiting for approval");
    const instance = await approval.decide(client, {
      instance_id: plan.workflow_instance_id,
      actor,
      decision,
      reason,
    });
    await apply(client, plan, instance.state, actor, reason);
  });
  return planView(planId, actor);
}

/** Write what a request's state means to the plan, its targets and its KPIs. */
async function apply(client, plan, state, actor, reason = null) {
  const status = approval.statusFor(state);
  if (!status || status === plan.status) return;
  await repo.setPlan(client, plan.performance_plan_id, { status, approved: status === "active" });
  await goalsRepo.setPlanStatus(client, plan.performance_plan_id, status);
  await repo.setPlanKpis(client, plan.performance_plan_id, status, actor && status === "active" ? actor.user_id : null);
  const key = status === "active" ? EVENTS.PLAN_APPROVED : status === "returned" ? EVENTS.PLAN_RETURNED : null;
  if (!key) return;
  const fresh = await repo.getPlan(client, plan.performance_plan_id);
  await emit(client, {
    key,
    entity: { type: "performance_plan", id: plan.performance_plan_id },
    actor,
    before: { status: plan.status },
    after: { status },
    payload: planPayload(plan, {
      reason,
      submitted_by: fresh && fresh.submitted_by ? await userOf(client, fresh.submitted_by.employee_id) : null,
    }),
  });
}

async function userOf(client, employeeId) {
  const { rows } = await client.query("SELECT user_id FROM app_user WHERE employee_id = $1", [employeeId]);
  return rows[0] ? rows[0].user_id : null;
}

async function settle(planId, state) {
  await tx(async (client) => {
    const plan = await repo.getPlan(client, planId, { lock: true });
    if (!plan || plan.status !== "pending_approval") return;
    await apply(client, plan, state, null);
  });
}

/** After the month is approved: tell each person their KPIs are set. */
async function dispatch(planId) {
  await tx(async (client) => {
    const plan = await repo.getPlan(client, planId);
    if (!plan || plan.status !== "active") return;
    for (const employeeId of await repo.peopleOfPlan(client, planId)) {
      const { rows } = await client.query(
        "SELECT count(*)::int AS n FROM employee_target WHERE performance_plan_id = $1 AND employee_id = $2 AND status = 'active'",
        [planId, employeeId],
      );
      await emit(client, {
        key: EVENTS.KPIS_DISPATCHED,
        entity: { type: "performance_plan", id: planId },
        actor: null,
        payload: { ...planPayload(plan), employee_id: employeeId, subject_employee_id: employeeId, kpis: rows[0].n },
      });
    }
  });
}

/** A linked task entered or left Done: recount its KPI when progress comes from Tasks. */
async function recount(employeeTargetId) {
  await tx(async (client) => {
    const row = await repo.recountFromTasks(client, employeeTargetId);
    if (!row) return;
    await emit(client, {
      key: EVENTS.KPI_PROGRESS_CHANGED,
      entity: { type: "kpi", id: employeeTargetId },
      actor: null,
      payload: { employee_target_id: employeeTargetId, employee_id: row.employee_id, actual_value: row.actual_value },
    });
  });
}

async function planView(planId, actor) {
  const row = await repo.getPlan(pool, planId);
  if (!row) throw notFound("month");
  return toPlan(pool, row, actor);
}

module.exports = {
  list,
  summary,
  create,
  submitPlan,
  decidePlan,
  settle,
  dispatch,
  recount,
  planView,
  isOwnDepartment,
};
