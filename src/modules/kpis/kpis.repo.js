"use strict";
/**
 * KPIs: the SQL for employee_target, a person's individual monthly KPI
 * (docs/guides/performance.md §4). Lists honour the `performance` scope on the person.
 */
const { pageQuery, completeQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");
const { personJson } = require("../../shared/db/person");
const { goalRef } = require("../goals/goals.repo");
const { ATTAINMENT_SQL, COUNTED } = require("./kpis.score");

const SELECT = `t.employee_target_id, ${personJson("e", "d")} AS employee, t.employee_id, t.title,
  to_char(t.month, 'YYYY-MM') AS month, trim_scale(t.target_value)::text AS target_value,
  trim_scale(t.actual_value)::text AS actual_value, t.unit, t.direction, t.progress_source,
  t.weight::text AS weight, t.status, t.due_on, ${personJson("s", "sd")} AS set_by, t.set_by_employee_id,
  ${goalRef("g")} AS target, t.organisational_goal_id, t.performance_plan_id, t.updated_at`;

const FROM = `FROM employee_target t
  JOIN employee e ON e.employee_id = t.employee_id
  LEFT JOIN department d ON d.department_id = e.department_id
  LEFT JOIN employee s ON s.employee_id = t.set_by_employee_id
  LEFT JOIN department sd ON sd.department_id = s.department_id
  LEFT JOIN organisational_goal g ON g.organisational_goal_id = t.organisational_goal_id`;

/** The fields KpiListQuery allow-lists for sorting. */
const SORTS = {
  employee: "e.last_name || ' ' || e.first_name",
  title: "t.title",
  weight: "t.weight",
};

/**
 * progress_status in SQL for a filter, given the share of the month gone ($n). Kept equal to
 * kpis.score statusOf().
 */
const STATUS_SQL = (share) => `CASE
    WHEN (${ATTAINMENT_SQL("t")}) IS NULL THEN NULL
    WHEN (${ATTAINMENT_SQL("t")}) >= 1 THEN 'met'
    WHEN (${ATTAINMENT_SQL("t")}) >= ${share} - 0.1 THEN 'on_track'
    WHEN (${ATTAINMENT_SQL("t")}) >= ${share} - 0.35 THEN 'at_risk'
    ELSE 'behind' END`;

/**
 * One page of KPIs for a month, within the scope.
 * @param {{month_start: string, share: number, department_id?: string, employee_id?: string,
 *          status?: string, progress_status?: string, q?: string}} query
 */
function list(client, query, scope) {
  const params = [
    query.month_start,
    query.department_id || null,
    query.employee_id || null,
    query.status || null,
    query.progress_status || null,
    query.q || null,
    query.share,
  ];
  const s = scopeClause(scope, { column: "t.employee_id" }, params);
  return pageQuery(
    client,
    `SELECT ${SELECT}, ${TOTAL_COL}
       ${FROM}
      WHERE t.month = $1::date
        AND ($2::uuid IS NULL OR e.department_id = $2::uuid)
        AND ($3::uuid IS NULL OR t.employee_id = $3::uuid)
        AND (($4::text IS NULL AND t.status <> 'cancelled') OR t.status = $4)
        AND ($5::text IS NULL OR (t.status = ANY('{${COUNTED.join(",")}}'::text[]) AND ${STATUS_SQL("$7::numeric")} = $5))
        AND ($6::text IS NULL OR search_fold(t.title || ' ' || e.first_name || ' ' || e.last_name) LIKE '%' || search_fold($6) || '%')
        ${s.and}
      ORDER BY ${orderBy(query, SORTS, "t.employee_target_id")}`,
    params,
    query,
  );
}

async function get(client, id, { lock = false } = {}) {
  const { rows } = await client.query(`SELECT ${SELECT} ${FROM} WHERE t.employee_target_id = $1${lock ? " FOR UPDATE OF t" : ""}`, [id]);
  return rows[0] || null;
}

/** One person's KPIs for a month, cancelled left out. A month holds at most 20 (KpiAssign). */
async function ofEmployee(client, employeeId, monthStart) {
  // pagination:complete one person's KPIs for one month, at most 20
  const { rows } = await completeQuery(
    client,
    `SELECT ${SELECT} ${FROM}
      WHERE t.employee_id = $1 AND t.month = $2::date AND t.status <> 'cancelled'
      ORDER BY t.weight DESC, t.title, t.employee_target_id`,
    [employeeId, monthStart],
    { label: "a person's KPIs", ceiling: 40 },
  );
  return rows;
}

/** Departmental targets of a department for a month a KPI may roll up to. */
async function targetsFor(client, departmentId, from, to) {
  // pagination:complete a department's targets for one month
  const { rows } = await completeQuery(
    client,
    `SELECT ${goalRef("g")} AS ref, g.performance_plan_id FROM organisational_goal g
      WHERE g.level = 'department' AND g.department_id = $1
        AND g.starts_on <= $3::date AND g.ends_on >= $2::date
        AND g.status IN ('draft', 'returned', 'pending_approval', 'active')
      ORDER BY g.code, g.organisational_goal_id`,
    [departmentId, from, to],
    { label: "a department's targets" },
  );
  return rows;
}

async function insert(client, v) {
  const { rows } = await client.query(
    `INSERT INTO employee_target
       (organisational_goal_id, employee_id, title, month, target_value, unit, direction, progress_source,
        weight, status, due_on, set_by_employee_id, performance_plan_id)
     VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, 'draft', $10::date, $11, $12)
     RETURNING employee_target_id`,
    [
      v.organisational_goal_id,
      v.employee_id,
      v.title,
      v.month_start,
      v.target_value,
      v.unit || null,
      v.direction,
      v.progress_source,
      v.weight,
      v.due_on,
      v.set_by_employee_id,
      v.performance_plan_id,
    ],
  );
  return rows[0].employee_target_id;
}

async function update(client, id, v) {
  await client.query(
    `UPDATE employee_target
        SET organisational_goal_id = $2, title = $3, target_value = $4, unit = $5, direction = $6,
            progress_source = $7, weight = $8, status = 'draft', set_by_employee_id = $9
      WHERE employee_target_id = $1`,
    [id, v.organisational_goal_id, v.title, v.target_value, v.unit || null, v.direction, v.progress_source, v.weight, v.set_by_employee_id],
  );
}

/** Take away a draft KPI the new list leaves out. Linked tasks keep going, unlinked. */
async function remove(client, id) {
  await client.query("DELETE FROM employee_target WHERE employee_target_id = $1", [id]);
}

async function setActual(client, id, actual) {
  await client.query("UPDATE employee_target SET actual_value = $2 WHERE employee_target_id = $1", [id, actual]);
}

/** Counts for the KPIs screen's cards, in a month, within the scope. */
async function summary(client, { month_start: monthStart, department_id: departmentId, share }, scope) {
  const params = [monthStart, departmentId || null, share];
  const sKpi = scopeClause(scope, { column: "t.employee_id" }, params);
  const sStaff = scopeClause(scope, { column: "e.employee_id" }, params);
  const { rows } = await client.query(
    `WITH k AS (
       SELECT t.*, (${STATUS_SQL("$3::numeric")}) AS ps
         FROM employee_target t JOIN employee e ON e.employee_id = t.employee_id
        WHERE t.month = $1::date AND t.status <> 'cancelled'
          AND ($2::uuid IS NULL OR e.department_id = $2::uuid) ${sKpi.and}
     ), people AS (
       SELECT employee_id, sum(weight) AS total FROM k GROUP BY employee_id
     )
     SELECT
       (SELECT count(*)::int FROM employee e
         WHERE e.status = 'active' AND ($2::uuid IS NULL OR e.department_id = $2::uuid) ${sStaff.and}) AS staff,
       (SELECT count(*)::int FROM people) AS with_kpis,
       (SELECT count(*)::int FROM people WHERE total <> 100) AS weights_off,
       (SELECT count(*)::int FROM k WHERE k.status = ANY($${params.length + 1}::text[]) AND ps IN ('on_track', 'met')) AS on_track,
       (SELECT count(*)::int FROM k WHERE k.status = ANY($${params.length + 1}::text[]) AND ps IN ('at_risk', 'behind')) AS behind_or_at_risk,
       (SELECT count(*)::int FROM k WHERE progress_source = 'manual') AS manual,
       (SELECT count(*)::int FROM k WHERE progress_source = 'tasks') AS tasks`,
    [...params, COUNTED],
  );
  return rows[0];
}

module.exports = { SELECT, FROM, SORTS, list, get, ofEmployee, targetsFor, insert, update, remove, setActual, summary };
