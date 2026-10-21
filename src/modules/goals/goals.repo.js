"use strict";
/**
 * Goals: the SQL for organisational_goal and its quarters (docs/guides/performance.md §4).
 * Every level lives in organisational_goal; a departmental target is a goal at the
 * `department` level (the targets module reads and writes it through goals.service).
 *
 * Goals are seen by everyone with the `performance` grant (view · all, §5); the screens'
 * actions are decided in the service. No LIMIT here: lists page through pageQuery.
 */
const { pageQuery, completeQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { personJson } = require("../../shared/db/person");

/** The goal as a one-line reference, from alias `x`. */
const goalRef = (x) => `CASE WHEN ${x}.organisational_goal_id IS NULL THEN NULL ELSE json_build_object(
    'organisational_goal_id', ${x}.organisational_goal_id, 'code', ${x}.code::text, 'level', ${x}.level,
    'title', ${x}.title, 'status', ${x}.status) END`;

const SELECT = `g.organisational_goal_id, g.code::text AS code, g.level, g.title, g.strategic_theme,
  g.success_measure, g.baseline, g.description, g.status, g.starts_on, g.ends_on,
  d.name AS department, g.department_id, g.parent_goal_id, g.owner_employee_id,
  ${personJson("o", "od")} AS owner, ${goalRef("p")} AS rolls_up_to,
  g.workflow_instance_id, g.performance_plan_id, g.created_at, g.updated_at`;

const FROM = `FROM organisational_goal g
  LEFT JOIN department d ON d.department_id = g.department_id
  JOIN employee o ON o.employee_id = g.owner_employee_id
  LEFT JOIN department od ON od.department_id = o.department_id
  LEFT JOIN organisational_goal p ON p.organisational_goal_id = g.parent_goal_id`;

/** The fields GoalListQuery and TargetListQuery allow-list for sorting. */
const SORTS = {
  code: "g.code",
  ends_on: "g.ends_on",
  title: "g.title",
  department: "d.name",
};

/**
 * One page of goals.
 * @param {{query: Function}} client
 * @param {{level?: string, levels?: string[], status?: string, year?: number, from?: string, to?: string,
 *          parent_goal_id?: string, department_id?: string, q?: string, page?: number, sort?: object}} query
 */
function list(client, query) {
  const params = [
    query.level || null,
    query.levels || null,
    query.status || null,
    query.from || null,
    query.to || null,
    query.parent_goal_id || null,
    query.department_id || null,
    query.q || null,
  ];
  return pageQuery(
    client,
    `SELECT ${SELECT}, ${TOTAL_COL}
       ${FROM}
      WHERE ($1::text IS NULL OR g.level = $1)
        AND ($2::text[] IS NULL OR g.level = ANY($2::text[]))
        AND ($3::text IS NULL OR g.status = $3)
        AND ($4::date IS NULL OR g.ends_on >= $4::date)
        AND ($5::date IS NULL OR g.starts_on <= $5::date)
        AND ($6::uuid IS NULL OR g.parent_goal_id = $6::uuid)
        AND ($7::uuid IS NULL OR g.department_id = $7::uuid)
        AND ($8::text IS NULL OR search_fold(g.title || ' ' || COALESCE(g.code::text, '') || ' '
             || COALESCE(g.strategic_theme, '')) LIKE '%' || search_fold($8) || '%')
      ORDER BY ${orderBy(query, SORTS, "g.organisational_goal_id")}`,
    params,
    query,
  );
}

/** One goal, or null. `lock` takes a row lock for a change. */
async function get(client, id, { lock = false } = {}) {
  const { rows } = await client.query(
    `SELECT ${SELECT} ${FROM} WHERE g.organisational_goal_id = $1${lock ? " FOR UPDATE OF g" : ""}`,
    [id],
  );
  return rows[0] || null;
}

async function insert(client, v) {
  const { rows } = await client.query(
    `INSERT INTO organisational_goal
       (code, level, parent_goal_id, department_id, title, strategic_theme, success_measure, baseline,
        description, status, starts_on, ends_on, owner_employee_id, performance_plan_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING organisational_goal_id`,
    [
      v.code,
      v.level,
      v.parent_goal_id || null,
      v.department_id || null,
      v.title,
      v.strategic_theme || null,
      v.success_measure || null,
      v.baseline || null,
      v.description || null,
      v.status,
      v.starts_on,
      v.ends_on,
      v.owner_employee_id,
      v.performance_plan_id || null,
    ],
  );
  return rows[0].organisational_goal_id;
}

const EDITABLE = ["title", "strategic_theme", "success_measure", "baseline", "description", "parent_goal_id"];

/** Change the fields given; the rest stay. */
async function update(client, id, patch) {
  const sets = [];
  const params = [id];
  for (const k of EDITABLE) {
    if (!(k in patch)) continue;
    params.push(patch[k]);
    sets.push(`${k} = $${params.length}`);
  }
  if (!sets.length) return;
  await client.query(`UPDATE organisational_goal SET ${sets.join(", ")} WHERE organisational_goal_id = $1`, params);
}

async function setStatus(client, id, status, { workflowInstanceId } = {}) {
  await client.query(
    `UPDATE organisational_goal
        SET status = $2, workflow_instance_id = COALESCE($3, workflow_instance_id)
      WHERE organisational_goal_id = $1`,
    [id, status, workflowInstanceId || null],
  );
}

/** The quarterly cascade of a goal, Q1 first. */
async function quarters(client, id) {
  // pagination:complete a goal's quarters
  const { rows } = await completeQuery(
    client,
    `SELECT quarter, milestone FROM organisational_goal_quarter
      WHERE organisational_goal_id = $1 ORDER BY quarter`,
    [id],
    { label: "a goal's quarters" },
  );
  return rows;
}

/** Replace the quarterly cascade with the quarters given. */
async function replaceQuarters(client, id, items) {
  await client.query("DELETE FROM organisational_goal_quarter WHERE organisational_goal_id = $1", [id]);
  for (const q of items) {
    await client.query(
      `INSERT INTO organisational_goal_quarter (organisational_goal_id, quarter, milestone)
       VALUES ($1, $2, $3)
       ON CONFLICT (organisational_goal_id, quarter) DO UPDATE SET milestone = EXCLUDED.milestone`,
      [id, q.quarter, q.milestone],
    );
  }
}

/**
 * The goal's ancestors, its parent first, up to the organisational goal.
 * A chain of at most four goals.
 */
async function ancestors(client, id) {
  // pagination:complete a goal's ancestors
  const { rows } = await completeQuery(
    client,
    `WITH RECURSIVE up AS (
       SELECT p.*, 1 AS depth FROM organisational_goal g
         JOIN organisational_goal p ON p.organisational_goal_id = g.parent_goal_id
        WHERE g.organisational_goal_id = $1
       UNION ALL
       SELECT p.*, up.depth + 1 FROM up
         JOIN organisational_goal p ON p.organisational_goal_id = up.parent_goal_id
        WHERE up.depth < 6
     )
     SELECT ${goalRef("up")} AS ref FROM up ORDER BY depth`,
    [id],
    { label: "a goal's ancestors" },
  );
  return rows.map((r) => r.ref);
}

/**
 * A goal's direct children: a goal has at most a year's months, or a
 * month's departments, below it; the detail shows them all.
 */
async function children(client, id) {
  // pagination:complete a goal's children
  const { rows } = await completeQuery(
    client,
    `SELECT ${goalRef("c")} AS ref FROM organisational_goal c
      WHERE c.parent_goal_id = $1 AND c.status <> 'cancelled'
      ORDER BY c.starts_on, c.code, c.organisational_goal_id`,
    [id],
    { label: "a goal's children" },
  );
  return rows.map((r) => r.ref);
}

/**
 * Every goal below the ones given that counts (approved), with its parent and level, and
 * for departmental targets the weighted attainment of their counted KPIs. Feeds the
 * roll-up in goals.trace.js: the tree under a page of 25 goals.
 * @param {string} attainmentSql  kpis.score ATTAINMENT_SQL("t")
 * @param {string[]} counted      kpis.score COUNTED
 */
async function subtree(client, rootIds, attainmentSql, counted) {
  if (!rootIds.length) return [];
  // pagination:complete the goals under a page of goals
  const { rows } = await completeQuery(
    client,
    `WITH RECURSIVE tree AS (
       SELECT g.organisational_goal_id, g.parent_goal_id, g.level, g.starts_on, g.ends_on, 0 AS depth
         FROM organisational_goal g WHERE g.organisational_goal_id = ANY($1::uuid[])
       UNION ALL
       SELECT c.organisational_goal_id, c.parent_goal_id, c.level, c.starts_on, c.ends_on, tree.depth + 1
         FROM tree JOIN organisational_goal c ON c.parent_goal_id = tree.organisational_goal_id
        WHERE c.status IN ('active', 'completed') AND tree.depth < 4
     )
     SELECT tree.organisational_goal_id, tree.parent_goal_id, tree.level, tree.starts_on, tree.ends_on,
            CASE WHEN tree.level = 'department' THEN (
              SELECT sum((${attainmentSql}) * t.weight) / NULLIF(sum(t.weight), 0)
                FROM employee_target t
               WHERE t.organisational_goal_id = tree.organisational_goal_id
                 AND t.status = ANY($2::text[]) AND (${attainmentSql}) IS NOT NULL
            ) END AS own_attainment
       FROM tree`,
    [rootIds, counted],
    { label: "the goals under a page of goals" },
  );
  return rows.map((r) => ({ ...r, own_attainment: r.own_attainment === null ? null : Number(r.own_attainment) }));
}

/**
 * Counts for the cascade chain: goals by level and status in a year, and KPIs.
 */
async function cascadeCounts(client, { from, to }) {
  const { rows } = await client.query(
    `SELECT level,
            count(*) FILTER (WHERE status IN ('active', 'completed'))::int AS active,
            count(*) FILTER (WHERE status = 'pending_approval')::int AS pending
       FROM organisational_goal
      WHERE starts_on <= $2::date AND ends_on >= $1::date
      GROUP BY level
     UNION ALL
     SELECT 'individual',
            count(*) FILTER (WHERE status IN ('active', 'met', 'completed'))::int,
            count(*) FILTER (WHERE status = 'pending_approval')::int
       FROM employee_target
      WHERE month BETWEEN $1::date AND $2::date`,
    [from, to],
  );
  return rows;
}

/**
 * The organisational goals live in a period, for Goal Progress: the CEO's goals for one
 * year, a handful by design (A16).
 */
async function organisationGoals(client, { from, to }) {
  // pagination:complete a year's organisational goals
  const { rows } = await completeQuery(
    client,
    `SELECT g.organisational_goal_id, g.code::text AS code, g.title, g.starts_on, g.ends_on
       FROM organisational_goal g
      WHERE g.level = 'organisation' AND g.status IN ('active', 'completed')
        AND g.starts_on <= $2::date AND g.ends_on >= $1::date
      ORDER BY g.code, g.organisational_goal_id`,
    [from, to],
    { label: "a year's organisational goals" },
  );
  return rows;
}

/** Departmental targets of a plan, for its approval and its dispatch. */
async function idsOfPlan(client, planId) {
  // pagination:complete a plan's targets
  const { rows } = await completeQuery(client, 
    "SELECT organisational_goal_id FROM organisational_goal WHERE performance_plan_id = $1",
    [planId],
    { label: "a plan's targets" },
  );
  return rows.map((r) => r.organisational_goal_id);
}

/** Set every departmental target of a plan to a status. */
async function setPlanStatus(client, planId, status) {
  await client.query(
    `UPDATE organisational_goal SET status = $2
      WHERE performance_plan_id = $1 AND status NOT IN ('cancelled', 'completed')`,
    [planId, status],
  );
}

module.exports = {
  goalRef,
  SELECT,
  FROM,
  SORTS,
  list,
  get,
  insert,
  update,
  setStatus,
  quarters,
  replaceQuarters,
  ancestors,
  children,
  subtree,
  cascadeCounts,
  organisationGoals,
  idsOfPlan,
  setPlanStatus,
};
