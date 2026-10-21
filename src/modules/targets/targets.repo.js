"use strict";
/**
 * Targets: the SQL for a department's month (performance_plan) and its departmental targets
 * (organisational_goal at the `department` level), and the KPI recount
 * (docs/guides/performance.md §4).
 */
const { pageQuery, completeQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { personJson } = require("../../shared/db/person");
const goalsRepo = require("../goals/goals.repo");

/* ------------------------------------------------------------------ *
 * Departmental targets
 * ------------------------------------------------------------------ */

/**
 * One page of a month's departmental targets. `departments` narrows to the departments of
 * the people in a team or own scope; null for all.
 */
function listTargets(client, query, departments) {
  const params = [query.from, query.to, query.department_id || null, query.status || null, query.q || null, departments];
  return pageQuery(
    client,
    `SELECT ${goalsRepo.SELECT}, ${TOTAL_COL}
       ${goalsRepo.FROM}
      WHERE g.level = 'department'
        AND g.starts_on <= $2::date AND g.ends_on >= $1::date
        AND ($3::uuid IS NULL OR g.department_id = $3::uuid)
        AND ($4::text IS NULL OR g.status = $4)
        AND ($5::text IS NULL OR search_fold(g.title || ' ' || COALESCE(g.code::text, '') || ' ' || d.name)
             LIKE '%' || search_fold($5) || '%')
        AND ($6::uuid[] IS NULL OR g.department_id = ANY($6::uuid[]))
      ORDER BY ${orderBy(query, goalsRepo.SORTS, "g.organisational_goal_id")}`,
    params,
    query,
  );
}

/** A month's approved departmental targets, for Last Month's Results. */
async function activeTargetsOfMonth(client, from, to) {
  // pagination:complete one month's departmental targets, worked into a bar per department
  const { rows } = await completeQuery(
    client,
    `SELECT g.organisational_goal_id, g.level, g.department_id, d.name AS department, g.starts_on, g.ends_on
       FROM organisational_goal g JOIN department d ON d.department_id = g.department_id
      WHERE g.level = 'department' AND g.status IN ('active', 'completed')
        AND g.starts_on <= $2::date AND g.ends_on >= $1::date
      ORDER BY d.name, g.organisational_goal_id`,
    [from, to],
    { label: "a month's targets", ceiling: 1000 },
  );
  return rows;
}

/** The departments of the people in a scope; null for all. */
async function departmentsOf(client, scope) {
  if (scope.scope === "all") return null;
  // pagination:complete the departments of a reporting line, a handful
  const { rows } = await completeQuery(
    client,
    `SELECT DISTINCT department_id FROM employee
      WHERE employee_id = ANY($1::uuid[]) AND department_id IS NOT NULL
      ORDER BY department_id`,
    [scope.scope_ids || []],
    { label: "departments in scope" },
  );
  return rows.map((r) => r.department_id);
}

/* ------------------------------------------------------------------ *
 * Plans
 * ------------------------------------------------------------------ */

const PLAN_SELECT = `p.performance_plan_id, p.department_id, d.name AS department, to_char(p.month, 'YYYY-MM') AS month,
  p.status, ${personJson("se", "sd")} AS submitted_by, p.submitted_at, p.approved_at, p.workflow_instance_id,
  (SELECT count(*)::int FROM organisational_goal g WHERE g.performance_plan_id = p.performance_plan_id) AS targets,
  (SELECT count(*)::int FROM employee_target t WHERE t.performance_plan_id = p.performance_plan_id) AS kpis`;

const PLAN_FROM = `FROM performance_plan p
  JOIN department d ON d.department_id = p.department_id
  LEFT JOIN app_user su ON su.user_id = p.submitted_by
  LEFT JOIN employee se ON se.employee_id = su.employee_id
  LEFT JOIN department sd ON sd.department_id = se.department_id`;

async function getPlan(client, id, { lock = false } = {}) {
  const { rows } = await client.query(
    `SELECT ${PLAN_SELECT} ${PLAN_FROM} WHERE p.performance_plan_id = $1${lock ? " FOR UPDATE OF p" : ""}`,
    [id],
  );
  return rows[0] || null;
}

async function planOf(client, departmentId, monthStart, { lock = false } = {}) {
  const { rows } = await client.query(
    `SELECT ${PLAN_SELECT} ${PLAN_FROM}
      WHERE p.department_id = $1 AND p.month = $2::date${lock ? " FOR UPDATE OF p" : ""}`,
    [departmentId, monthStart],
  );
  return rows[0] || null;
}

/** The department's plan for the month, made as a draft when there is none. */
async function ensurePlan(client, departmentId, monthStart) {
  await client.query(
    `INSERT INTO performance_plan (department_id, month) VALUES ($1, $2::date)
     ON CONFLICT (department_id, month) DO NOTHING`,
    [departmentId, monthStart],
  );
  return planOf(client, departmentId, monthStart, { lock: true });
}

/** Every plan of a month, by department. pagination:complete one per department */
async function plansOfMonth(client, monthStart) {
  // pagination:complete one plan per department for a month
  const { rows } = await completeQuery(
    client,
    `SELECT ${PLAN_SELECT} ${PLAN_FROM} WHERE p.month = $1::date ORDER BY d.name, p.performance_plan_id`,
    [monthStart],
    { label: "a month's plans" },
  );
  return rows;
}

async function setPlan(client, id, { status, submittedBy, workflowInstanceId, approved }) {
  await client.query(
    `UPDATE performance_plan
        SET status = $2,
            submitted_by = COALESCE($3, submitted_by),
            submitted_at = CASE WHEN $3::uuid IS NULL THEN submitted_at ELSE now() END,
            workflow_instance_id = COALESCE($4, workflow_instance_id),
            approved_at = CASE WHEN $5 THEN now() ELSE approved_at END
      WHERE performance_plan_id = $1`,
    [id, status, submittedBy || null, workflowInstanceId || null, Boolean(approved)],
  );
}

/** A plan's people whose KPI weights do not total 100.00, with their total. */
async function weightsOff(client, planId) {
  // pagination:complete the people of one department's month
  const { rows } = await completeQuery(
    client,
    `SELECT t.employee_id, btrim(e.first_name || ' ' || e.last_name) AS name, sum(t.weight)::text AS total
       FROM employee_target t JOIN employee e ON e.employee_id = t.employee_id
      WHERE t.performance_plan_id = $1 AND t.status <> 'cancelled'
      GROUP BY t.employee_id, e.first_name, e.last_name
     HAVING sum(t.weight) <> 100
      ORDER BY name, t.employee_id`,
    [planId],
    { label: "a plan's people" },
  );
  return rows;
}

/** Move a plan's KPIs to a status; on approval, record who approved. */
async function setPlanKpis(client, planId, status, approverUserId = null) {
  await client.query(
    `UPDATE employee_target
        SET status = $2,
            approved_by = CASE WHEN $2 = 'active' THEN $3::uuid ELSE approved_by END,
            approved_at = CASE WHEN $2 = 'active' THEN now() ELSE approved_at END
      WHERE performance_plan_id = $1 AND status NOT IN ('cancelled', 'completed', 'met')`,
    [planId, status, approverUserId],
  );
}

/** The people of a plan with active KPIs, for "Your KPIs are set". */
async function peopleOfPlan(client, planId) {
  // pagination:complete the people of one department's month
  const { rows } = await completeQuery(
    client,
    `SELECT DISTINCT t.employee_id FROM employee_target t
      WHERE t.performance_plan_id = $1 AND t.status = 'active' ORDER BY t.employee_id`,
    [planId],
    { label: "a plan's people" },
  );
  return rows.map((r) => r.employee_id);
}

/**
 * The month's Approval Trail: every decision on its plans, newest first.
 * pagination:complete three stages per department per month at most a few rounds
 */
async function trailOfMonth(client, monthStart) {
  // pagination:complete the decisions on a month's plans
  const { rows } = await completeQuery(
    client,
    `SELECT wd.workflow_decision_id, wd.stage_key, wd.actor_id, wd.decision, wd.reason, wd.decided_at,
            p.performance_plan_id, d.name AS department,
            btrim(ae.first_name || ' ' || ae.last_name) AS actor_name
       FROM performance_plan p
       JOIN department d ON d.department_id = p.department_id
       JOIN workflow_instance wi ON wi.entity_type = 'performance_plan' AND wi.entity_id = p.performance_plan_id::text
       JOIN workflow_decision wd ON wd.workflow_instance_id = wi.workflow_instance_id
       LEFT JOIN app_user au ON au.user_id = wd.actor_id
       LEFT JOIN employee ae ON ae.employee_id = au.employee_id
      WHERE p.month = $1::date
      ORDER BY wd.decided_at DESC, wd.workflow_decision_id`,
    [monthStart],
    { label: "a month's approval trail", ceiling: 500 },
  );
  return rows;
}

/* ------------------------------------------------------------------ *
 * Progress from tasks
 * ------------------------------------------------------------------ */

/** Recount a tasks-sourced KPI: its done tasks. Returns the KPI's new actual, or null. */
async function recountFromTasks(client, employeeTargetId) {
  const { rows } = await client.query(
    `UPDATE employee_target t
        SET actual_value = (
              SELECT count(*) FROM task k
               WHERE k.employee_target_id = t.employee_target_id AND k.status = 'done'
                 AND k.primary_assignee_id = t.employee_id AND k.archived_at IS NULL)
      WHERE t.employee_target_id = $1 AND t.progress_source = 'tasks'
      RETURNING t.employee_target_id, t.employee_id, t.actual_value::text AS actual_value`,
    [employeeTargetId],
  );
  return rows[0] || null;
}

module.exports = {
  listTargets,
  activeTargetsOfMonth,
  departmentsOf,
  getPlan,
  planOf,
  ensurePlan,
  plansOfMonth,
  setPlan,
  weightsOff,
  setPlanKpis,
  peopleOfPlan,
  trailOfMonth,
  recountFromTasks,
};
