"use strict";
/**
 * Quarter plans (docs/guides/performance.md §6.4): one per function per quarter and one for the
 * company. A plan holds the function's objectives and key results, its KPIs and the scorecards of
 * its people; Send Plan refuses while anything would be wrong once binding, and opens
 * `performance.plan`. Its completion is handled in goals.approval.js.
 */
const { completeQuery } = require("../../shared/http/paged");
const { AppError } = require("../../shared/errors");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

/** A quarter, or a 422 naming it. */
async function periodOf(db, periodId) {
  const p = await one(
    db,
    `SELECT performance_period_id, name, starts_on, ends_on, plan_year_starts_on, targets_lock_on, live_from,
            status, rules FROM performance_period WHERE performance_period_id = $1`,
    [periodId],
  );
  if (!p) throw new AppError("VALIDATION_FAILED", "Pick a quarter that exists", 422, { performance_period_id: ["Not a quarter"] });
  return p;
}

/** The plan of a function (or the company, for no department) in a quarter, or null. */
const planFor = (db, periodId, departmentId) =>
  one(
    db,
    `SELECT performance_plan_id, performance_period_id, department_id, status, workflow_instance_id
       FROM performance_plan WHERE performance_period_id = $1 AND department_id IS NOT DISTINCT FROM $2`,
    [periodId, departmentId || null],
  );

/** The plan, made when the first objective or scorecard of a function's quarter is drafted. */
async function ensurePlan(client, periodId, departmentId) {
  const found = await planFor(client, periodId, departmentId);
  if (found) return found;
  await client.query(
    `INSERT INTO performance_plan (performance_period_id, department_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [periodId, departmentId || null],
  );
  return planFor(client, periodId, departmentId);
}

/** Objectives of a plan, by count of key results (for its problems). */
async function objectiveCounts(db, planId) {
  // pagination:complete a plan's objectives, each with how many key results it holds
  const { rows } = await completeQuery(
    db,
    `SELECT o.okr_objective_id, o.code::text AS code,
            (SELECT count(*)::int FROM okr_key_result kr WHERE kr.okr_objective_id = o.okr_objective_id) AS key_results
       FROM okr_objective o WHERE o.performance_plan_id = $1 ORDER BY o.position, o.code`,
    [planId],
    { label: "a plan's objectives" },
  );
  return rows;
}

/** Lines of the plan's scorecards linked to a key result of another quarter, their own or a Team result's. */
async function foreignLinks(db, plan) {
  // pagination:complete every line that breaks the rule, to name each one
  const { rows } = await completeQuery(
    db,
    `SELECT t.employee_target_id, t.title, btrim(e.first_name || ' ' || e.last_name) AS person
       FROM scorecard s
       JOIN employee_target t ON t.scorecard_id = s.scorecard_id
       JOIN employee e ON e.employee_id = s.employee_id
       JOIN okr_key_result kr ON kr.okr_key_result_id = t.okr_key_result_id
          OR kr.okr_key_result_id IN (SELECT x.okr_key_result_id FROM employee_target_key_result x WHERE x.employee_target_id = t.employee_target_id)
       JOIN okr_objective o ON o.okr_objective_id = kr.okr_objective_id
      WHERE s.performance_period_id = $1 AND s.department_id IS NOT DISTINCT FROM $2
        AND o.performance_period_id <> s.performance_period_id
      GROUP BY t.employee_target_id, t.title, e.first_name, e.last_name
      ORDER BY person, t.title, t.employee_target_id`,
    [plan.performance_period_id, plan.department_id],
    { label: "lines linked to another quarter" },
  );
  return rows;
}

module.exports = { periodOf, planFor, ensurePlan, objectiveCounts, foreignLinks };
