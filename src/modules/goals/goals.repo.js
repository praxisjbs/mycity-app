"use strict";
/**
 * Goals: the SQL. Quarters (performance_period); organisational goals and their quarterly targets;
 * plans; objectives, key results, their links, monthly reports and former codes; target changes
 * (docs/guides/performance.md §4). Writes only the goals module's own rows. Never emits
 * (BACKEND_GUIDE §2).
 */
const { pageQuery, completeQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { personJson } = require("../../shared/db/person");
const { scopeClause } = require("../../shared/rbac/scope");
const { escapeLike } = require("../../shared/search/provider");
const approvers = require("../../shared/workflow/approvers");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

/** A quarter as the service turns it into PerformancePeriod. */
const PERIOD = `p.performance_period_id, p.name, p.starts_on, p.ends_on, p.plan_year_starts_on,
  p.targets_lock_on, p.live_from, p.status, p.rules, p.created_at, p.updated_at`;

const PERIOD_SORTS = { starts_on: "p.starts_on" };

/** One page of quarters, the latest first unless sorted otherwise. */
function listPeriods(db, query) {
  const sorted = query.sort ? query : { ...query, sort: { field: "starts_on", dir: "desc" } };
  return pageQuery(
    db,
    `SELECT ${PERIOD}, ${TOTAL_COL}
       FROM performance_period p
      WHERE ($1::text IS NULL OR p.status = $1)
        AND ($2::text IS NULL OR search_fold(p.name) LIKE '%' || search_fold($2) || '%')
        AND ($3::int IS NULL OR p.plan_year_starts_on = make_date($3, 1, 1))
      ORDER BY ${orderBy(sorted, PERIOD_SORTS, "p.performance_period_id")}`,
    [query.status || null, query.q || null, query.plan_year || null],
    query,
  );
}

const getPeriod = (db, id) =>
  one(db, `SELECT ${PERIOD} FROM performance_period p WHERE p.performance_period_id = $1`, [id]);

/** The active quarter, else the latest one still being planned. */
const currentPeriod = (db) =>
  one(
    db,
    `SELECT ${PERIOD} FROM performance_period p
      WHERE p.status IN ('active', 'planning')
      ORDER BY (p.status = 'active') DESC, p.starts_on DESC
      LIMIT 1`,
    [],
  );

/** The latest quarter starting before a date: the one whose rules a new quarter copies. */
const periodBefore = (db, startsOn) =>
  one(
    db,
    `SELECT ${PERIOD} FROM performance_period p WHERE p.starts_on < $1 ORDER BY p.starts_on DESC LIMIT 1`,
    [startsOn],
  );

const periodStarting = (db, startsOn) =>
  one(db, `SELECT ${PERIOD} FROM performance_period p WHERE p.starts_on = $1`, [startsOn]);

/** Another active quarter than this one, if any. */
const otherActive = (db, id) =>
  one(
    db,
    `SELECT ${PERIOD} FROM performance_period p WHERE p.status = 'active' AND p.performance_period_id IS DISTINCT FROM $1::uuid`,
    [id],
  );

function insertPeriod(client, p) {
  return one(
    client,
    `INSERT INTO performance_period
       (name, starts_on, ends_on, plan_year_starts_on, targets_lock_on, live_from, status, rules)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING performance_period_id`,
    [p.name, p.starts_on, p.ends_on, p.plan_year_starts_on, p.targets_lock_on, p.live_from, p.status || "planning", JSON.stringify(p.rules)],
  );
}

const PERIOD_WRITABLE = ["name", "targets_lock_on", "live_from", "status", "rules"];

async function updatePeriod(client, id, patch) {
  const keys = PERIOD_WRITABLE.filter((k) => patch[k] !== undefined);
  if (!keys.length) return;
  const vals = keys.map((k) => (k === "rules" ? JSON.stringify(patch[k]) : patch[k]));
  await client.query(
    `UPDATE performance_period SET ${keys.map((k, i) => `${k} = $${i + 2}${k === "rules" ? "::jsonb" : ""}`).join(", ")}
      WHERE performance_period_id = $1`,
    [id, ...vals],
  );
}

/* ------------------------------------------------------------------ *
 * Organisational goals
 * ------------------------------------------------------------------ */

const GOAL = `g.organisational_goal_id, g.code::text AS code, g.title, g.strategic_theme, g.detail, g.success_measure,
  g.reference_target, g.baseline, g.key_decisions, g.function_cascade, g.plan_year_starts_on, g.starts_on, g.ends_on,
  g.status, ${personJson("o", "od")} AS owner, g.created_at, g.updated_at`;
const GOAL_FROM = `FROM organisational_goal g
  LEFT JOIN employee o ON o.employee_id = g.owner_employee_id
  LEFT JOIN department od ON od.department_id = o.department_id`;
const GOAL_SORTS = { code: "g.code", title: "g.title", ends_on: "g.ends_on" };

function listGoals(db, query) {
  return pageQuery(
    db,
    `SELECT ${GOAL}, ${TOTAL_COL} ${GOAL_FROM}
      WHERE g.level = 'organisation'
        AND ($1::date IS NULL OR g.plan_year_starts_on = $1::date)
        AND ($2::text IS NULL OR g.status = $2)
        AND ($3::text IS NULL OR search_fold(COALESCE(g.code::text, '') || ' ' || g.title || ' ' || COALESCE(g.strategic_theme, ''))
                                 LIKE '%' || search_fold($3) || '%')
      ORDER BY ${orderBy(query, GOAL_SORTS, "g.organisational_goal_id")}`,
    [query.plan_year ? `${query.plan_year}-01-01` : null, query.status || null, query.q || null],
    query,
  );
}

const getGoal = (db, id) => one(db, `SELECT ${GOAL} ${GOAL_FROM} WHERE g.organisational_goal_id = $1 AND g.level = 'organisation'`, [id]);

async function goalTargets(db, id) {
  // pagination:complete at most one target per quarter of the plan year
  const { rows } = await completeQuery(
    db,
    `SELECT t.organisational_goal_target_id, t.performance_period_id, p.name AS period_name, t.target_text,
            trim_scale(t.target_value)::text AS target_value
       FROM organisational_goal_target t JOIN performance_period p ON p.performance_period_id = t.performance_period_id
      WHERE t.organisational_goal_id = $1 ORDER BY p.starts_on, t.organisational_goal_target_id`,
    [id],
    { label: "a goal's quarterly targets", ceiling: 20 },
  );
  return rows;
}

const GOAL_WRITABLE = [
  "code", "code_given_at", "title", "strategic_theme", "detail", "success_measure", "reference_target", "baseline", "key_decisions",
  "function_cascade", "plan_year_starts_on", "starts_on", "ends_on", "status", "owner_employee_id", "level", "weight",
];

async function insertGoal(client, row) {
  const keys = GOAL_WRITABLE.filter((k) => row[k] !== undefined);
  const { rows } = await client.query(
    `INSERT INTO organisational_goal (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})
     RETURNING organisational_goal_id`,
    keys.map((k) => row[k]),
  );
  return rows[0].organisational_goal_id;
}

async function updateGoal(client, id, patch) {
  const keys = GOAL_WRITABLE.filter((k) => patch[k] !== undefined);
  if (!keys.length) return;
  await client.query(
    `UPDATE organisational_goal SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE organisational_goal_id = $1`,
    [id, ...keys.map((k) => patch[k])],
  );
}

async function setGoalTargets(client, id, targets) {
  for (const t of targets)
    await client.query(
      `INSERT INTO organisational_goal_target (organisational_goal_id, performance_period_id, target_text, target_value)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organisational_goal_id, performance_period_id) DO UPDATE SET
         target_text = EXCLUDED.target_text, target_value = EXCLUDED.target_value`,
      [id, t.performance_period_id, t.target_text ?? null, t.target_value ?? null],
    );
}

/**
 * What keeps a goal from being deleted: the company objectives serving it, and any older row naming
 * it (a line or a goal under it, from before the OKR tree).
 */
async function goalUses(db, goalId) {
  const { rows } = await db.query(
    `SELECT (SELECT count(*) FROM okr_objective WHERE organisational_goal_id = $1 AND department_id IS NULL)::int AS objectives,
            (SELECT count(*) FROM employee_target WHERE organisational_goal_id = $1)::int
              + (SELECT count(*) FROM organisational_goal WHERE parent_goal_id = $1)::int AS other`,
    [goalId],
  );
  return rows[0];
}

/** Delete a goal; its quarterly targets go with it, and a function objective naming it lets go. */
async function deleteGoal(client, id) {
  await client.query("DELETE FROM organisational_goal WHERE organisational_goal_id = $1 AND level = 'organisation'", [id]);
}

/** The company objectives serving a goal, in quarter order. */
async function companyObjectivesOf(db, goalId) {
  // pagination:complete the company objectives under one goal: a few a quarter
  const { rows } = await completeQuery(
    db,
    `SELECT o.okr_objective_id FROM okr_objective o JOIN performance_period p ON p.performance_period_id = o.performance_period_id
      WHERE o.organisational_goal_id = $1 AND o.department_id IS NULL ORDER BY p.starts_on, o.position, o.okr_objective_id`,
    [goalId],
    { label: "a goal's company objectives" },
  );
  return rows.map((r) => r.okr_objective_id);
}

/** The person someone answers to (organogram guide §4), or null. */
const effectiveManagerOf = async (db, employeeId) =>
  (await one(db, "SELECT manager_id FROM employee_effective_manager WHERE employee_id = $1", [employeeId]))?.manager_id || null;

/** Is the employee the CEO, by their login? */
const isCeoEmployee = async (db, employeeId) =>
  Boolean(await one(db, "SELECT 1 AS x FROM app_user WHERE employee_id = $1 AND is_ceo = true LIMIT 1", [employeeId]));

/** Does one of these roles carry this code? */
const holdsRoleCode = async (db, roleIds, code) =>
  Boolean(await one(db, "SELECT 1 AS x FROM role WHERE role_id = ANY($1::uuid[]) AND code = $2 LIMIT 1", [roleIds, code]));

/* ------------------------------------------------------------------ *
 * Plans
 * ------------------------------------------------------------------ */

const PLAN = `pl.performance_plan_id, pl.performance_period_id, p.name AS period_name, pl.department_id,
  d.name AS department, d.code::text AS department_code, pl.status, pl.workflow_instance_id, pl.submitted_by,
  pl.submitted_at, pl.returned_reason, pl.binding_at, pl.created_at, pl.updated_at,
  (SELECT ${personJson("se", "sd")} FROM app_user su JOIN employee se ON se.employee_id = su.employee_id
     LEFT JOIN department sd ON sd.department_id = se.department_id WHERE su.user_id = pl.submitted_by) AS submitted_by_person,
  (SELECT count(*)::int FROM okr_objective o WHERE o.performance_plan_id = pl.performance_plan_id) AS objective_count,
  (SELECT count(*)::int FROM scorecard s
    WHERE s.performance_period_id = pl.performance_period_id AND s.department_id = pl.department_id) AS scorecard_count`;
const PLAN_FROM = `FROM performance_plan pl
  JOIN performance_period p ON p.performance_period_id = pl.performance_period_id
  LEFT JOIN department d ON d.department_id = pl.department_id`;
const PLAN_SORTS = { department: "d.name", status: "pl.status" };

function listPlans(db, query) {
  const dept = query.department_id === "company" ? null : query.department_id || null;
  return pageQuery(
    db,
    `SELECT ${PLAN}, ${TOTAL_COL} ${PLAN_FROM}
      WHERE ($1::uuid IS NULL OR pl.performance_period_id = $1)
        AND ($2::text IS NULL OR pl.status = $2)
        AND ($3::boolean IS FALSE OR pl.department_id IS NULL)
        AND ($4::uuid IS NULL OR pl.department_id = $4)
      ORDER BY ${orderBy(query, PLAN_SORTS, "pl.performance_plan_id")}`,
    [query.period_id || null, query.status || null, query.department_id === "company", dept],
    query,
  );
}

const getPlan = (db, id) => one(db, `SELECT ${PLAN} ${PLAN_FROM} WHERE pl.performance_plan_id = $1`, [id]);

/**
 * GET /performance/functions: the company first (no department), then each active function by
 * name, with its plan's status in the quarter `period_id` (none without one) and whether a request to
 * unbind it waits. Whether the reader may set each is the service's question for goals.authority,
 * never this query's.
 */
function listFunctions(db, query) {
  return pageQuery(
    db,
    `SELECT f.department_id, f.name, pl.status AS plan_status,
            EXISTS (SELECT 1 FROM plan_unbind u WHERE u.performance_plan_id = pl.performance_plan_id AND u.status = 'pending') AS unbind_pending,
            ${TOTAL_COL}
       FROM (SELECT NULL::uuid AS department_id, NULL::text AS name, 0 AS rank
             UNION ALL
             SELECT d.department_id, d.name, 1 FROM department d WHERE d.active) f
       LEFT JOIN performance_plan pl
         ON pl.performance_period_id = $1::uuid AND pl.department_id IS NOT DISTINCT FROM f.department_id
      ORDER BY f.rank, f.name, f.department_id`,
    [query.period_id || null],
    query,
  );
}

/**
 * GET /performance/departments: the departments a reader's Performance lists can be filtered by.
 * A reader with `all` gets every active one. Anyone else gets the departments of the people they
 * reach: their scope (the caller first), those whose scorecards or reviews name them (reviewer, a
 * holder of the reviewing role, dotted manager, second level), and themselves; each as the person's
 * record and their scorecards give it (a person moved mid-quarter keeps the scorecard's), and the
 * departments they head.
 */
function listDepartments(db, query, scope, reader) {
  if (scope.scope === "all")
    return pageQuery(
      db,
      `SELECT d.department_id, d.code, d.name, ${TOTAL_COL}
         FROM department d
        WHERE d.active
        ORDER BY d.name, d.department_id`,
      [],
      query,
    );
  return pageQuery(
    db,
    `WITH reach AS (
       SELECT unnest($1::uuid[]) AS employee_id
       UNION SELECT $2::uuid
       UNION SELECT s.employee_id FROM scorecard s
              WHERE s.reviewer_employee_id = $2 OR s.dotted_employee_id = $2
                 OR (s.reviewer_role_code IS NOT NULL AND s.employee_id <> $2
                     AND s.reviewer_role_code::text IN (SELECT r.code::text FROM user_role ur JOIN role r ON r.role_id = ur.role_id WHERE ur.user_id = $3))
       UNION SELECT pr.employee_id FROM performance_review pr
              WHERE pr.reviewer_employee_id = $2 OR pr.dotted_employee_id = $2 OR pr.second_level_employee_id = $2
     ), places AS (
       SELECT e.department_id FROM employee e JOIN reach USING (employee_id)
       UNION SELECT s.department_id FROM scorecard s JOIN reach USING (employee_id)
       UNION SELECT h.department_id FROM department h WHERE h.head_employee_id = $2
     )
     SELECT d.department_id, d.code, d.name, ${TOTAL_COL}
       FROM department d
      WHERE d.active AND d.department_id IN (SELECT department_id FROM places)
      ORDER BY d.name, d.department_id`,
    [Array.isArray(scope.scope_ids) ? scope.scope_ids : [], reader.employee_id || null, reader.user_id || null],
    query,
  );
}

async function updatePlan(client, id, patch) {
  const keys = ["status", "workflow_instance_id", "submitted_by", "submitted_at", "returned_reason", "binding_at"].filter(
    (k) => patch[k] !== undefined,
  );
  if (!keys.length) return;
  await client.query(
    `UPDATE performance_plan SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE performance_plan_id = $1`,
    [id, ...keys.map((k) => patch[k])],
  );
}

/* ------------------------------------------------------------------ *
 * Objectives and key results
 * ------------------------------------------------------------------ */

const OBJECTIVE = `o.okr_objective_id, o.performance_period_id, o.performance_plan_id, o.department_id, d.name AS department,
  o.code::text AS code, o.title, o.organisational_goal_id, o.position, pl.status AS plan_status`;
const OBJECTIVE_FROM = `FROM okr_objective o
  JOIN performance_plan pl ON pl.performance_plan_id = o.performance_plan_id
  LEFT JOIN department d ON d.department_id = o.department_id`;
const OBJECTIVE_SORTS = { position: "o.department_id NULLS FIRST, o.position, o.code", code: "o.code" };

function listObjectives(db, query) {
  const company = query.department_id === "company";
  const dept = company ? null : query.department_id || null;
  return pageQuery(
    db,
    `SELECT ${OBJECTIVE}, ${TOTAL_COL} ${OBJECTIVE_FROM}
      WHERE ($1::uuid IS NULL OR o.performance_period_id = $1)
        AND ($2::boolean IS FALSE OR o.department_id IS NULL)
        AND ($3::uuid IS NULL OR o.department_id = $3)
        AND ($4::text IS NULL OR pl.status = $4 OR ($4 = 'live' AND pl.status IN ('binding', 'unbound', 'revising')))
        AND ($5::text IS NULL OR search_fold(o.code || ' ' || o.title || ' ' || COALESCE((
              SELECT string_agg(kr.code || ' ' || kr.statement, ' ') FROM okr_key_result kr
               WHERE kr.okr_objective_id = o.okr_objective_id), '')) LIKE '%' || search_fold($5) || '%')
      ORDER BY ${orderBy(query, OBJECTIVE_SORTS, "o.okr_objective_id")}`,
    [query.period_id || null, company, dept, query.status || null, query.q || null],
    query,
  );
}

const getObjective = (db, id) => one(db, `SELECT ${OBJECTIVE} ${OBJECTIVE_FROM} WHERE o.okr_objective_id = $1`, [id]);

const KEY_RESULT_REF_SORTS = { code: "kr.code" };

/** A quarter's key results as a picker names them: the company's, the functions' or one function's. */
function listKeyResultRefs(db, query) {
  return pageQuery(
    db,
    `SELECT kr.okr_key_result_id, kr.code::text AS code, kr.statement, ${TOTAL_COL}
       FROM okr_key_result kr
       JOIN okr_objective o ON o.okr_objective_id = kr.okr_objective_id
      WHERE o.performance_period_id = $1
        AND ($2::text IS NULL OR ($2 = 'company') = (o.department_id IS NULL))
        AND ($3::uuid IS NULL OR o.department_id = $3)
        AND ($4::text IS NULL OR search_fold(kr.code || ' ' || kr.statement) LIKE '%' || search_fold($4) || '%')
      ORDER BY ${orderBy(query, KEY_RESULT_REF_SORTS, "kr.okr_key_result_id")}`,
    [query.period_id, query.level || null, query.department_id || null, query.q || null],
    query,
  );
}

/** A plan's objectives, in order (a plan is read whole). */
async function objectivesOfPlan(db, planId) {
  // pagination:complete a plan binds its objectives together
  const { rows } = await completeQuery(
    db,
    `SELECT ${OBJECTIVE} ${OBJECTIVE_FROM} WHERE o.performance_plan_id = $1 ORDER BY o.position, o.code, o.okr_objective_id`,
    [planId],
    { label: "a plan's objectives" },
  );
  return rows;
}

/** A quarter's objectives, for its figures (a quarter's plans hold a few dozen). */
async function objectivesOfPeriod(db, periodId) {
  // pagination:complete the Goals figures count every key result of the quarter, not a page of them
  const { rows } = await completeQuery(
    db,
    `SELECT ${OBJECTIVE} ${OBJECTIVE_FROM} WHERE o.performance_period_id = $1
      ORDER BY o.department_id NULLS FIRST, o.position, o.code, o.okr_objective_id`,
    [periodId],
    { label: "a quarter's objectives", ceiling: 1000 },
  );
  return rows;
}

const KEY_RESULT = `kr.okr_key_result_id, kr.okr_objective_id, kr.code::text AS code, kr.statement, kr.kr_type, kr.measure,
  kr.direction, kr.unit, kr.baseline_text, trim_scale(kr.target_value)::text AS target_value, kr.target_text, kr.target_provisional,
  kr.target_locked_at, kr.parts, kr.starts_on, kr.finishes_on, kr.accountable_employee_id,
  ${personJson("ae", "ad")} AS accountable, kr.co_accountable_employee_id, ${personJson("ce", "cd")} AS co_accountable,
  kr.accountable_note, kr.scored_from_key_result_id, kr.position,
  COALESCE((SELECT json_agg(json_build_object('okr_key_result_id', c.okr_key_result_id, 'code', c.code::text,
                                              'statement', c.statement) ORDER BY c.code)
              FROM okr_key_result_link l JOIN okr_key_result c ON c.okr_key_result_id = l.company_key_result_id
             WHERE l.okr_key_result_id = kr.okr_key_result_id), '[]'::json) AS linked_company_key_results`;
const KEY_RESULT_FROM = `FROM okr_key_result kr
  LEFT JOIN employee ae ON ae.employee_id = kr.accountable_employee_id
  LEFT JOIN department ad ON ad.department_id = ae.department_id
  LEFT JOIN employee ce ON ce.employee_id = kr.co_accountable_employee_id
  LEFT JOIN department cd ON cd.department_id = ce.department_id`;

/** The key results of some objectives (a page of the tree, or a plan). */
async function keyResultsOf(db, objectiveIds) {
  if (!objectiveIds.length) return [];
  // pagination:complete the key results of one page of objectives: at most four each
  const { rows } = await completeQuery(
    db,
    `SELECT ${KEY_RESULT} ${KEY_RESULT_FROM}
      WHERE kr.okr_objective_id = ANY($1::uuid[]) ORDER BY kr.okr_objective_id, kr.position, kr.code, kr.okr_key_result_id`,
    [objectiveIds],
    { label: "objectives' key results", ceiling: 1000 },
  );
  return rows;
}

const getKeyResult = (db, id) => one(db, `SELECT ${KEY_RESULT} ${KEY_RESULT_FROM} WHERE kr.okr_key_result_id = $1`, [id]);

/** A key result with its objective, plan and quarter, for the checks a write needs. */
const keyResultContext = (db, id) =>
  one(
    db,
    `SELECT kr.okr_key_result_id, kr.code::text AS code, kr.statement, kr.measure, kr.direction,
            trim_scale(kr.target_value)::text AS target_value, kr.target_text, kr.target_provisional, kr.target_locked_at,
            kr.accountable_employee_id, kr.scored_from_key_result_id, kr.parts,
            o.okr_objective_id, o.code::text AS objective_code, o.department_id, o.performance_period_id,
            pl.performance_plan_id, pl.status AS plan_status, p.targets_lock_on, p.rules, p.status AS period_status
       FROM okr_key_result kr
       JOIN okr_objective o ON o.okr_objective_id = kr.okr_objective_id
       JOIN performance_plan pl ON pl.performance_plan_id = o.performance_plan_id
       JOIN performance_period p ON p.performance_period_id = o.performance_period_id
      WHERE kr.okr_key_result_id = $1`,
    [id],
  );

const MONTH = `m.okr_key_result_month_id, m.okr_key_result_id, m.month, m.status, trim_scale(m.actual_value)::text AS actual_value,
  m.actual_text, m.actual_source, m.update_text, m.recovery_employee_id, m.recovery_due_on,
  trim_scale(m.proposed_score)::text AS proposed_score, trim_scale(m.confirmed_score)::text AS confirmed_score, m.confirmed_at`;

/** Each key result's latest month (on or before `until`). */
async function latestMonths(db, keyResultIds, until = null) {
  if (!keyResultIds.length) return [];
  // pagination:complete one row per key result of a page of objectives
  const { rows } = await completeQuery(
    db,
    `SELECT ${MONTH} FROM okr_key_result_month m
      WHERE m.okr_key_result_id = ANY($1::uuid[])
        AND m.month = (SELECT max(x.month) FROM okr_key_result_month x
                        WHERE x.okr_key_result_id = m.okr_key_result_id AND ($2::date IS NULL OR x.month <= $2::date))
      ORDER BY m.okr_key_result_id`,
    [keyResultIds, until],
    { label: "key results' latest months", ceiling: 1000 },
  );
  return rows;
}

async function monthsOf(db, keyResultId) {
  // pagination:complete one row a month
  const { rows } = await completeQuery(
    db,
    `SELECT ${MONTH} FROM okr_key_result_month m WHERE m.okr_key_result_id = $1 ORDER BY m.month, m.okr_key_result_month_id`,
    [keyResultId],
    { label: "a key result's months", ceiling: 120 },
  );
  return rows;
}

const monthOf = (db, keyResultId, month) =>
  one(db, `SELECT ${MONTH} FROM okr_key_result_month m WHERE m.okr_key_result_id = $1 AND m.month = $2`, [keyResultId, month]);

function upsertMonth(client, keyResultId, r, userId) {
  return one(
    client,
    `INSERT INTO okr_key_result_month
       (okr_key_result_id, month, status, actual_value, actual_text, actual_source, update_text,
        recovery_employee_id, recovery_due_on, proposed_score, proposed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (okr_key_result_id, month) DO UPDATE SET
       status = EXCLUDED.status, actual_value = EXCLUDED.actual_value, actual_text = EXCLUDED.actual_text,
       actual_source = EXCLUDED.actual_source, update_text = EXCLUDED.update_text,
       recovery_employee_id = EXCLUDED.recovery_employee_id, recovery_due_on = EXCLUDED.recovery_due_on,
       proposed_score = EXCLUDED.proposed_score, proposed_by = EXCLUDED.proposed_by,
       -- A month whose score is reported differently is confirmed again; the same score keeps its confirmation.
       confirmed_score = CASE WHEN okr_key_result_month.proposed_score IS DISTINCT FROM EXCLUDED.proposed_score THEN NULL ELSE okr_key_result_month.confirmed_score END,
       confirmed_by = CASE WHEN okr_key_result_month.proposed_score IS DISTINCT FROM EXCLUDED.proposed_score THEN NULL ELSE okr_key_result_month.confirmed_by END,
       confirmed_at = CASE WHEN okr_key_result_month.proposed_score IS DISTINCT FROM EXCLUDED.proposed_score THEN NULL ELSE okr_key_result_month.confirmed_at END
     RETURNING okr_key_result_month_id`,
    [
      keyResultId, r.month, r.status, r.actual_value ?? null, r.actual_text ?? null, r.actual_source ?? null,
      r.update_text ?? null, r.recovery_employee_id ?? null, r.recovery_due_on ?? null, r.proposed_score ?? null,
      userId || null,
    ],
  );
}

/** A month's proposed score worked out again (after a target change). */
const setProposedScore = (client, keyResultId, month, score) =>
  client.query("UPDATE okr_key_result_month SET proposed_score = $3 WHERE okr_key_result_id = $1 AND month = $2", [keyResultId, month, score]);

async function confirmMonth(client, keyResultId, month, score, userId) {
  const { rowCount } = await client.query(
    `UPDATE okr_key_result_month SET confirmed_score = $3, confirmed_by = $4, confirmed_at = now()
      WHERE okr_key_result_id = $1 AND month = $2`,
    [keyResultId, month, score, userId || null],
  );
  return rowCount > 0;
}

/**
 * The target a key result had in a month (§6.7): the last target change approved that applies from
 * that month or earlier, else the target before any change. Null when no change was approved (the
 * current target applies). A later decision wins, as reproposing the months after it does.
 */
async function targetIn(db, keyResultId, month) {
  const applies = await one(
    db,
    `SELECT trim_scale(to_value)::text AS value, to_text AS text FROM target_change
      WHERE okr_key_result_id = $1 AND status = 'approved' AND from_month <= $2::date
      ORDER BY decided_at DESC NULLS LAST, created_at DESC LIMIT 1`,
    [keyResultId, month],
  );
  if (applies) return applies;
  return one(
    db,
    `SELECT trim_scale(from_value)::text AS value, from_text AS text FROM target_change
      WHERE okr_key_result_id = $1 AND status = 'approved'
      ORDER BY decided_at NULLS LAST, created_at LIMIT 1`,
    [keyResultId],
  );
}

/** Is a change to this key result's or line's target already waiting for a decision? */
const changePending = async (db, { okr_key_result_id: krId = null, employee_target_id: lineId = null }) =>
  Boolean(
    await one(
      db,
      `SELECT 1 AS x FROM target_change WHERE status = 'pending'
          AND (okr_key_result_id = $1 OR employee_target_id = $2) LIMIT 1`,
      [krId, lineId],
    ),
  );

/** The function key results that link to a company key result (its Contributing list). */
async function contributing(db, companyKeyResultId) {
  // pagination:complete the function key results feeding one company key result
  const { rows } = await completeQuery(
    db,
    `SELECT kr.okr_key_result_id, kr.code::text AS code, kr.statement
       FROM okr_key_result_link l JOIN okr_key_result kr ON kr.okr_key_result_id = l.okr_key_result_id
      WHERE l.company_key_result_id = $1 ORDER BY kr.code, kr.okr_key_result_id`,
    [companyKeyResultId],
    { label: "a company key result's contributors" },
  );
  return rows;
}

/** The company key results scored from a function key result. */
async function scoredFrom(db, keyResultId) {
  // pagination:complete the company key results one function key result scores
  const { rows } = await completeQuery(
    db,
    "SELECT okr_key_result_id FROM okr_key_result WHERE scored_from_key_result_id = $1 ORDER BY okr_key_result_id",
    [keyResultId],
    { label: "company key results scored from one" },
  );
  return rows.map((r) => r.okr_key_result_id);
}

/** The tasks that carry out a key result (its initiatives). */
async function initiatives(db, keyResultId) {
  // pagination:complete a key result's initiatives, a handful each
  const { rows } = await completeQuery(
    db,
    `SELECT t.task_id, t.number::text AS number, t.title, t.status, ${personJson("e", "d")} AS assignee, t.due_at, t.completed_at
       FROM task t
       LEFT JOIN employee e ON e.employee_id = t.primary_assignee_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE t.entity_type = 'key_result' AND t.entity_id = $1 AND t.archived_at IS NULL
      ORDER BY t.due_at NULLS LAST, t.task_id`,
    [keyResultId],
    { label: "a key result's initiatives" },
  );
  return rows;
}

const OBJECTIVE_WRITABLE = ["performance_period_id", "performance_plan_id", "department_id", "code", "title", "organisational_goal_id", "position"];

async function insertObjective(client, row) {
  const keys = OBJECTIVE_WRITABLE.filter((k) => row[k] !== undefined);
  const { rows } = await client.query(
    `INSERT INTO okr_objective (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})
     RETURNING okr_objective_id`,
    keys.map((k) => row[k]),
  );
  return rows[0].okr_objective_id;
}

async function updateObjective(client, id, patch) {
  const keys = ["title", "organisational_goal_id", "position", "code"].filter((k) => patch[k] !== undefined);
  if (!keys.length) return;
  await client.query(
    `UPDATE okr_objective SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE okr_objective_id = $1`,
    [id, ...keys.map((k) => patch[k])],
  );
}

const deleteObjective = (client, id) => client.query("DELETE FROM okr_objective WHERE okr_objective_id = $1", [id]);

const KR_WRITABLE = [
  "okr_objective_id", "code", "statement", "kr_type", "measure", "direction", "unit", "baseline_text", "target_value",
  "target_text", "target_provisional", "target_locked_at", "parts", "starts_on", "finishes_on", "accountable_employee_id",
  "co_accountable_employee_id", "accountable_note", "scored_from_key_result_id", "position",
];

const krValue = (k, v) => (k === "parts" && v !== null && v !== undefined ? JSON.stringify(v) : v);

async function insertKeyResult(client, row) {
  const keys = KR_WRITABLE.filter((k) => row[k] !== undefined);
  const { rows } = await client.query(
    `INSERT INTO okr_key_result (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})
     RETURNING okr_key_result_id`,
    keys.map((k) => krValue(k, row[k])),
  );
  return rows[0].okr_key_result_id;
}

async function updateKeyResult(client, id, patch) {
  const keys = KR_WRITABLE.filter((k) => patch[k] !== undefined && k !== "okr_objective_id");
  if (!keys.length) return;
  await client.query(
    `UPDATE okr_key_result SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE okr_key_result_id = $1`,
    [id, ...keys.map((k) => krValue(k, patch[k]))],
  );
}

const deleteKeyResult = (client, id) => client.query("DELETE FROM okr_key_result WHERE okr_key_result_id = $1", [id]);

async function setLinks(client, keyResultId, companyIds) {
  await client.query("DELETE FROM okr_key_result_link WHERE okr_key_result_id = $1", [keyResultId]);
  for (const c of companyIds)
    await client.query(
      `INSERT INTO okr_key_result_link (okr_key_result_id, company_key_result_id) VALUES ($1, $2)
       ON CONFLICT (okr_key_result_id, company_key_result_id) DO NOTHING`,
      [keyResultId, c],
    );
}

/** Codes already used in a quarter (objectives) or under an objective (key results). */
async function objectiveCodes(db, periodId, prefix) {
  const { rows } = await db.query(
    "SELECT code::text AS code FROM okr_objective WHERE performance_period_id = $1 AND code ILIKE $2 || '-O%'",
    [periodId, prefix],
  );
  return rows.map((r) => r.code);
}

async function keyResultCodes(db, objectiveId) {
  const { rows } = await db.query("SELECT code::text AS code FROM okr_key_result WHERE okr_objective_id = $1", [objectiveId]);
  return rows.map((r) => r.code);
}

/** Key results whose TBC target locks on or before a day. */
async function provisionalDue(db, today) {
  // pagination:complete the lock sweeps every provisional target due, once a day
  const { rows } = await completeQuery(
    db,
    `SELECT kr.okr_key_result_id, kr.code::text AS code, o.department_id, o.performance_period_id
       FROM okr_key_result kr
       JOIN okr_objective o ON o.okr_objective_id = kr.okr_objective_id
       JOIN performance_period p ON p.performance_period_id = o.performance_period_id
      WHERE kr.target_provisional AND kr.target_locked_at IS NULL
        AND p.targets_lock_on IS NOT NULL AND p.targets_lock_on <= $1::date
      ORDER BY kr.okr_key_result_id`,
    [today],
    { label: "provisional targets due to lock", ceiling: 2000 },
  );
  return rows;
}

/** A key result found by its code or a former one, in a quarter (the importers). */
const keyResultByCode = (db, periodId, code) =>
  one(
    db,
    `SELECT kr.okr_key_result_id FROM okr_key_result kr JOIN okr_objective o ON o.okr_objective_id = kr.okr_objective_id
      WHERE o.performance_period_id = $1 AND kr.code = $2
     UNION ALL
     SELECT a.okr_key_result_id FROM okr_code_alias a
      WHERE a.performance_period_id = $1 AND a.alias_code = $2 AND a.okr_key_result_id IS NOT NULL
     LIMIT 1`,
    [periodId, code],
  );

async function addAlias(client, periodId, alias, target) {
  await client.query(
    `INSERT INTO okr_code_alias (performance_period_id, alias_code, okr_key_result_id, kpi_definition_id)
     VALUES ($1, $2, $3, $4) ON CONFLICT (performance_period_id, alias_code) DO NOTHING`,
    [periodId, alias, target.okr_key_result_id || null, target.kpi_definition_id || null],
  );
}

/* ------------------------------------------------------------------ *
 * The importers: finding what a workbook names
 * ------------------------------------------------------------------ */

/** The quarter an import writes into: the active one, else the first still in planning. */
const importPeriodId = async (db) =>
  (
    await one(
      db,
      `SELECT performance_period_id FROM performance_period WHERE status IN ('active', 'planning')
        ORDER BY (status = 'active') DESC, starts_on LIMIT 1`,
      [],
    )
  )?.performance_period_id || null;

/** An active department by its name, any case. */
const departmentByName = (db, name) =>
  one(db, "SELECT department_id, code::text AS code, name FROM department WHERE lower(name) = lower($1) AND active LIMIT 1", [name]);

/**
 * An active employee by name as a sheet writes it: letters only, any case, first and last name
 * with or without the middle one ("Oladotun Shola Adido" is Oladotun Shola-Adido).
 */
const employeeByName = (db, name) =>
  one(
    db,
    `SELECT employee_id FROM employee
      WHERE status = 'active'
        AND regexp_replace(lower($1), '[^a-z]', '', 'g') IN (
              regexp_replace(lower(first_name || last_name), '[^a-z]', '', 'g'),
              regexp_replace(lower(first_name || coalesce(middle_name, '') || last_name), '[^a-z]', '', 'g'))
      ORDER BY employee_id LIMIT 1`,
    [name],
  );

/** Active employees with this first name (letters only, any case), for a near match on the surname. */
async function employeesByFirstName(db, firstName) {
  // pagination:complete the people sharing one first name: a handful, compared by spelling
  const { rows } = await completeQuery(
    db,
    `SELECT employee_id, first_name, last_name FROM employee
      WHERE status = 'active' AND regexp_replace(lower(first_name), '[^a-z]', '', 'g') = regexp_replace(lower($1), '[^a-z]', '', 'g')
      ORDER BY employee_id`,
    [firstName],
    { label: "people with one first name", ceiling: 200 },
  );
  return rows;
}

/** The CEO's employee, by their login. */
const ceoEmployeeId = async (db) =>
  (await one(db, "SELECT employee_id FROM app_user WHERE is_ceo = true AND employee_id IS NOT NULL ORDER BY created_at LIMIT 1", []))
    ?.employee_id || null;

/** A quarter's objective by its code. */
const objectiveByCode = (db, periodId, code) =>
  one(
    db,
    "SELECT okr_objective_id, title, department_id, performance_plan_id FROM okr_objective WHERE performance_period_id = $1 AND code = $2",
    [periodId, code],
  );

/** A quarter's key result by its own code (not a former one). */
const keyResultByOwnCode = (db, periodId, code) =>
  one(
    db,
    `SELECT kr.okr_key_result_id FROM okr_key_result kr JOIN okr_objective o ON o.okr_objective_id = kr.okr_objective_id
      WHERE o.performance_period_id = $1 AND kr.code = $2`,
    [periodId, code],
  );

/** A KPI found by a former code in a quarter (the scorecards importer). */
const kpiByAlias = (db, periodId, code) =>
  one(
    db,
    `SELECT kpi_definition_id FROM okr_code_alias WHERE performance_period_id = $1 AND alias_code = $2 AND kpi_definition_id IS NOT NULL`,
    [periodId, code],
  );

/**
 * Does anything now depend on a key result: a scorecard line or a Team result, a target change,
 * or a confirmed month? Such a key result is not removed by reverting its import.
 */
const keyResultInUse = async (db, id) =>
  Boolean(
    await one(
      db,
      `SELECT 1 AS x WHERE EXISTS (SELECT 1 FROM employee_target WHERE okr_key_result_id = $1)
          OR EXISTS (SELECT 1 FROM employee_target_key_result WHERE okr_key_result_id = $1)
          OR EXISTS (SELECT 1 FROM target_change WHERE okr_key_result_id = $1)
          OR EXISTS (SELECT 1 FROM okr_key_result_month WHERE okr_key_result_id = $1 AND confirmed_at IS NOT NULL)`,
      [id],
    ),
  );

/** Is there already a task carrying out this key result under this title? */
const initiativeExists = async (db, keyResultId, title) =>
  Boolean(
    await one(db, "SELECT 1 AS x FROM task WHERE entity_type = 'key_result' AND entity_id = $1 AND title = $2 LIMIT 1", [
      keyResultId,
      title,
    ]),
  );

/* ------------------------------------------------------------------ *
 * Target changes
 * ------------------------------------------------------------------ */

const CHANGE = `tc.target_change_id, tc.okr_key_result_id, tc.employee_target_id, trim_scale(tc.from_value)::text AS from_value,
  tc.from_text, trim_scale(tc.to_value)::text AS to_value, tc.to_text, tc.from_month, tc.reason, tc.status, tc.workflow_instance_id,
  (SELECT ${personJson("re", "rd")} FROM app_user ru JOIN employee re ON re.employee_id = ru.employee_id
     LEFT JOIN department rd ON rd.department_id = re.department_id WHERE ru.user_id = tc.requested_by) AS requested_by,
  tc.decided_at, tc.created_at`;

/** Target changes: a key result's for every reader (the OKR tree is shared), a line's within the reader's scope. */
function listChanges(db, query, scope = { scope: "all" }) {
  const params = [query.status || null, query.okr_key_result_id || null, query.employee_target_id || null];
  const s = scopeClause(scope, { column: "et.employee_id" }, params);
  return pageQuery(
    db,
    `SELECT ${CHANGE}, ${TOTAL_COL} FROM target_change tc
       LEFT JOIN employee_target et ON et.employee_target_id = tc.employee_target_id
      WHERE ($1::text IS NULL OR tc.status = $1)
        AND ($2::uuid IS NULL OR tc.okr_key_result_id = $2)
        AND ($3::uuid IS NULL OR tc.employee_target_id = $3)
        ${s.and ? `AND (tc.employee_target_id IS NULL OR ${s.and.slice(4)})` : ""}
      ORDER BY ${orderBy(query, { created_at: "tc.created_at" }, "tc.target_change_id")}`,
    params,
    query,
  );
}

async function changesOf(db, keyResultId) {
  // pagination:complete a key result's target history, a few changes at most
  const { rows } = await completeQuery(
    db,
    `SELECT ${CHANGE} FROM target_change tc WHERE tc.okr_key_result_id = $1 ORDER BY tc.created_at, tc.target_change_id`,
    [keyResultId],
    { label: "a key result's target history" },
  );
  return rows;
}

const getChange = (db, id) => one(db, `SELECT ${CHANGE} FROM target_change tc WHERE tc.target_change_id = $1`, [id]);

/** One change with what it changes: the key result or the line, its function and quarter. */
const getChangeDetail = (db, id) =>
  one(
    db,
    `SELECT ${CHANGE},
            CASE WHEN kr.okr_key_result_id IS NULL THEN NULL
                 ELSE json_build_object('okr_key_result_id', kr.okr_key_result_id, 'code', kr.code::text, 'statement', kr.statement) END
              AS key_result,
            coalesce(kr.unit, et.unit) AS unit,
            CASE WHEN et.employee_target_id IS NULL THEN NULL
                 ELSE json_build_object('employee_target_id', et.employee_target_id, 'title', et.title, 'employee', ${personJson("le", "ld")}) END
              AS line,
            et.employee_id AS line_employee_id, et.scorecard_id AS line_scorecard_id, d.name AS department,
            p.name AS period_name
       FROM target_change tc
       LEFT JOIN okr_key_result kr ON kr.okr_key_result_id = tc.okr_key_result_id
       LEFT JOIN okr_objective o ON o.okr_objective_id = kr.okr_objective_id
       LEFT JOIN employee_target et ON et.employee_target_id = tc.employee_target_id
       LEFT JOIN scorecard sc ON sc.scorecard_id = et.scorecard_id
       LEFT JOIN employee le ON le.employee_id = et.employee_id
       LEFT JOIN department ld ON ld.department_id = le.department_id
       LEFT JOIN department d ON d.department_id = coalesce(o.department_id, sc.department_id)
       LEFT JOIN performance_period p ON p.performance_period_id = coalesce(o.performance_period_id, sc.performance_period_id)
      WHERE tc.target_change_id = $1`,
    [id],
  );

/* ------------------------------------------------------------------ *
 * Approvals waiting on the reader
 * ------------------------------------------------------------------ */

/**
 * Goals · Waiting On You: the pending plan stages, unbind requests and target changes whose current
 * stage names the reader (approvers.waitingOnClause), oldest first, 25 a page. `mayDecide` is false
 * for a reader without `performance` approve, whose list is then empty, as the engine would refuse them.
 */
function approvalsWaiting(db, reader, roleCodes, mayDecide, query) {
  const params = [];
  const named = approvers.waitingOnClause("wi", reader, roleCodes, params);
  params.push(mayDecide, query.q ? `%${escapeLike(query.q)}%` : null);
  const may = params.length - 1;
  const q = params.length;
  // A plan (or an unbound plan's changes), a request to unbind one, a target change, or a mid-quarter
  // scorecard sent on its own through the plan's flow (§11).
  return pageQuery(
    db,
    `SELECT v.*, ${TOTAL_COL} FROM (
       SELECT CASE wi.entity_type WHEN 'performance_plan' THEN 'plan' WHEN 'plan_unbind' THEN 'unbind' WHEN 'scorecard' THEN 'scorecard' ELSE 'target_change' END AS kind,
              coalesce(pl.performance_plan_id, ub.plan_unbind_id, tc.target_change_id, am.scorecard_id) AS record_id,
              wi.workflow_instance_id, wd.stages, wi.current_stage, wi.stage_entered_at,
              (wi.stage_due_at IS NOT NULL AND wi.stage_due_at < now()) AS overdue,
              p.name AS period_name, d.name AS department, kr.code::text AS key_result_code, et.title AS line_title,
              ${personJson("pe", "pd")} AS employee,
              ${personJson("oe", "od")} AS requested_by
         FROM workflow_instance wi
         JOIN workflow_definition wd ON wd.workflow_definition_id = wi.workflow_definition_id
         LEFT JOIN performance_plan pl ON wi.entity_type = 'performance_plan' AND pl.performance_plan_id::text = wi.entity_id
         LEFT JOIN scorecard am ON wi.entity_type = 'scorecard' AND am.scorecard_id::text = wi.entity_id
         LEFT JOIN plan_unbind ub ON wi.entity_type = 'plan_unbind' AND ub.plan_unbind_id::text = wi.entity_id
         LEFT JOIN performance_plan upl ON upl.performance_plan_id = ub.performance_plan_id
         LEFT JOIN target_change tc ON wi.entity_type = 'target_change' AND tc.target_change_id::text = wi.entity_id
         LEFT JOIN okr_key_result kr ON kr.okr_key_result_id = tc.okr_key_result_id
         LEFT JOIN okr_objective o ON o.okr_objective_id = kr.okr_objective_id
         LEFT JOIN employee_target et ON et.employee_target_id = tc.employee_target_id
         LEFT JOIN scorecard sc ON sc.scorecard_id = et.scorecard_id
         LEFT JOIN department d ON d.department_id = coalesce(pl.department_id, upl.department_id, o.department_id, sc.department_id, am.department_id)
         LEFT JOIN performance_period p
           ON p.performance_period_id = coalesce(pl.performance_period_id, upl.performance_period_id, o.performance_period_id, sc.performance_period_id, am.performance_period_id)
         LEFT JOIN employee pe ON pe.employee_id = coalesce(am.employee_id, sc.employee_id)
         LEFT JOIN department pd ON pd.department_id = pe.department_id
         LEFT JOIN app_user ou ON ou.user_id = wi.opened_by
         LEFT JOIN employee oe ON oe.employee_id = ou.employee_id
         LEFT JOIN department od ON od.department_id = oe.department_id
        WHERE wi.state = 'pending' AND $${may}::boolean
          AND ((wi.definition_key = 'performance.plan' AND (pl.performance_plan_id IS NOT NULL OR am.scorecard_id IS NOT NULL))
            OR (wi.definition_key = 'performance.plan_change' AND (pl.performance_plan_id IS NOT NULL OR ub.plan_unbind_id IS NOT NULL))
            OR (wi.definition_key = 'performance.target_change' AND tc.target_change_id IS NOT NULL))
          AND ${named}
     ) v
     WHERE ($${q}::text IS NULL
            OR search_fold(coalesce(v.department, 'Company') || ' ' || coalesce(v.key_result_code, '') || ' '
                           || coalesce(v.line_title, '') || ' ' || coalesce(v.employee->>'display_name', '') || ' '
                           || coalesce(v.requested_by->>'display_name', ''))
               LIKE search_fold($${q}::text))
     ORDER BY v.stage_entered_at, v.workflow_instance_id`,
    params,
    query,
  );
}
const getChangeRow = (db, id) => one(db, "SELECT * FROM target_change WHERE target_change_id = $1", [id]);

async function insertChange(client, row) {
  const { rows } = await client.query(
    `INSERT INTO target_change (okr_key_result_id, employee_target_id, from_value, from_text, to_value, to_text,
                                from_month, reason, requested_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING target_change_id`,
    [row.okr_key_result_id || null, row.employee_target_id || null, row.from_value ?? null, row.from_text ?? null,
      row.to_value ?? null, row.to_text ?? null, row.from_month, row.reason, row.requested_by],
  );
  return rows[0].target_change_id;
}

async function updateChange(client, id, patch) {
  const keys = ["status", "workflow_instance_id", "decided_at"].filter((k) => patch[k] !== undefined);
  if (!keys.length) return;
  await client.query(
    `UPDATE target_change SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE target_change_id = $1`,
    [id, ...keys.map((k) => patch[k])],
  );
}

/* ------------------------------------------------------------------ *
 * Requests to unbind a plan (§6.22)
 * ------------------------------------------------------------------ */

const UNBIND = `u.plan_unbind_id, u.performance_plan_id, u.reason, u.status, u.workflow_instance_id, u.decided_at,
  u.decision_reason, u.created_at,
  (SELECT ${personJson("re", "rd")} FROM app_user ru JOIN employee re ON re.employee_id = ru.employee_id
     LEFT JOIN department rd ON rd.department_id = re.department_id WHERE ru.user_id = u.requested_by) AS requested_by`;

const getUnbind = (db, id) => one(db, `SELECT ${UNBIND} FROM plan_unbind u WHERE u.plan_unbind_id = $1`, [id]);

/** The plan's latest request, waiting or decided. */
const latestUnbind = (db, planId) =>
  one(db, `SELECT ${UNBIND} FROM plan_unbind u WHERE u.performance_plan_id = $1 ORDER BY u.created_at DESC, u.plan_unbind_id LIMIT 1`, [planId]);

/** One request with the plan it is about, for its sheet. */
const getUnbindDetail = (db, id) =>
  one(
    db,
    `SELECT ${UNBIND}, pl.department_id, d.name AS department, p.name AS period_name
       FROM plan_unbind u
       JOIN performance_plan pl ON pl.performance_plan_id = u.performance_plan_id
       JOIN performance_period p ON p.performance_period_id = pl.performance_period_id
       LEFT JOIN department d ON d.department_id = pl.department_id
      WHERE u.plan_unbind_id = $1`,
    [id],
  );

const getUnbindRow = (db, id) => one(db, "SELECT * FROM plan_unbind WHERE plan_unbind_id = $1", [id]);

const unbindPending = async (db, planId) =>
  Boolean(await one(db, "SELECT 1 AS x FROM plan_unbind WHERE performance_plan_id = $1 AND status = 'pending' LIMIT 1", [planId]));

async function insertUnbind(client, row) {
  const { rows } = await client.query(
    "INSERT INTO plan_unbind (performance_plan_id, reason, requested_by) VALUES ($1, $2, $3) RETURNING plan_unbind_id",
    [row.performance_plan_id, row.reason, row.requested_by],
  );
  return rows[0].plan_unbind_id;
}

async function updateUnbind(client, id, patch) {
  const keys = ["status", "workflow_instance_id", "decided_at", "decision_reason"].filter((k) => patch[k] !== undefined);
  if (!keys.length) return;
  await client.query(
    `UPDATE plan_unbind SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE plan_unbind_id = $1`,
    [id, ...keys.map((k) => patch[k])],
  );
}

/**
 * What a key result holds that an unbound plan never deletes (§6.22): `reported`, a month has been
 * reported on it; `in_use`, a scorecard line, a Team result, a target change, an initiative task or a
 * company key result scored from it names it.
 */
const HOLDS = `EXISTS (SELECT 1 FROM okr_key_result_month m WHERE m.okr_key_result_id = kr.okr_key_result_id) AS reported,
  (EXISTS (SELECT 1 FROM employee_target t WHERE t.okr_key_result_id = kr.okr_key_result_id)
    OR EXISTS (SELECT 1 FROM employee_target_key_result x WHERE x.okr_key_result_id = kr.okr_key_result_id)
    OR EXISTS (SELECT 1 FROM target_change c WHERE c.okr_key_result_id = kr.okr_key_result_id)
    OR EXISTS (SELECT 1 FROM task k WHERE k.entity_type = 'key_result' AND k.entity_id = kr.okr_key_result_id)
    OR EXISTS (SELECT 1 FROM okr_key_result s WHERE s.scored_from_key_result_id = kr.okr_key_result_id)) AS in_use`;

const keyResultHolds = (db, id) => one(db, `SELECT ${HOLDS} FROM okr_key_result kr WHERE kr.okr_key_result_id = $1`, [id]);

/** The same over an objective's key results: whether any is reported, whether any is in use. */
const objectiveHolds = (db, id) =>
  one(
    db,
    `SELECT coalesce(bool_or(h.reported), false) AS reported, coalesce(bool_or(h.in_use), false) AS in_use
       FROM (SELECT ${HOLDS} FROM okr_key_result kr WHERE kr.okr_objective_id = $1) h`,
    [id],
  );

module.exports = {
  importPeriodId,
  departmentByName,
  employeeByName,
  employeesByFirstName,
  ceoEmployeeId,
  objectiveByCode,
  keyResultByOwnCode,
  kpiByAlias,
  keyResultInUse,
  initiativeExists,
  listGoals,
  getGoal,
  goalUses,
  deleteGoal,
  listKeyResultRefs,
  goalTargets,
  insertGoal,
  updateGoal,
  setGoalTargets,
  companyObjectivesOf,
  effectiveManagerOf,
  isCeoEmployee,
  holdsRoleCode,
  listPlans,
  listFunctions,
  listDepartments,
  getPlan,
  getChangeDetail,
  approvalsWaiting,
  updatePlan,
  listObjectives,
  getObjective,
  objectivesOfPlan,
  objectivesOfPeriod,
  keyResultsOf,
  getKeyResult,
  keyResultContext,
  latestMonths,
  monthsOf,
  monthOf,
  upsertMonth,
  confirmMonth,
  setProposedScore,
  targetIn,
  changePending,
  contributing,
  scoredFrom,
  initiatives,
  insertObjective,
  updateObjective,
  deleteObjective,
  insertKeyResult,
  updateKeyResult,
  deleteKeyResult,
  setLinks,
  objectiveCodes,
  keyResultCodes,
  provisionalDue,
  keyResultByCode,
  addAlias,
  listChanges,
  changesOf,
  getChange,
  getChangeRow,
  insertChange,
  updateChange,
  getUnbind,
  latestUnbind,
  getUnbindDetail,
  getUnbindRow,
  unbindPending,
  insertUnbind,
  updateUnbind,
  keyResultHolds,
  objectiveHolds,
  listPeriods,
  getPeriod,
  currentPeriod,
  periodBefore,
  periodStarting,
  otherActive,
  insertPeriod,
  updatePeriod,
};
