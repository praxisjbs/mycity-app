"use strict";
/**
 * Workflow reads for the screens: flows with what is open on them, the requests
 * waiting on a person, and the names a request shows. The engine's own moves
 * (open, decide, withdraw, time limits) stay in shared/workflow/engine.js; the one
 * move written here is a reassignment, which the engine does not make.
 *
 * Tables (migration 0070, 0450): workflow_definition, workflow_instance, workflow_decision.
 */
const { pageQuery, orderBy, completeQuery, TOTAL_COL } = require("../../shared/http/paged");
const approvers = require("../../shared/workflow/approvers");

const NAME = (alias) => `NULLIF(btrim(${alias}.first_name || ' ' || ${alias}.last_name), '')`;

/** The fields ApprovalFlowListQuery allow-lists, and their SQL. The first is the default. */
const FLOW_SORTS = { name: "d.name", key: "d.key" };

/* ------------------------------------------------------------------ *
 * Flows
 * ------------------------------------------------------------------ */

/** The active version of every flow, 25 a page, with how many requests are open on it. */
function listFlows(client, query) {
  const params = [query.module_key ?? null, query.q ?? null];
  return pageQuery(
    client,
    `SELECT d.workflow_definition_id, d.key::text AS key, d.version, d.module_key, d.name, d.description,
            d.context_types, d.stages, d.created_at, ${NAME("ce")} AS created_by_name,
            (SELECT count(*)::int FROM workflow_instance i
              WHERE i.definition_key = d.key::text AND i.state = 'pending') AS open_requests,
            ${TOTAL_COL}
       FROM workflow_definition d
       LEFT JOIN app_user cu ON cu.user_id = d.created_by
       LEFT JOIN employee ce ON ce.employee_id = cu.employee_id
      WHERE d.active
        AND ($1::text IS NULL OR d.module_key = $1)
        AND ($2::text IS NULL OR search_fold(d.name || ' ' || d.key::text || ' ' || coalesce(d.description, ''))
                                 LIKE '%' || search_fold($2) || '%')
      ORDER BY ${orderBy(query, FLOW_SORTS, "d.workflow_definition_id")}`,
    params,
    query,
  );
}

/** One stored version with its open count, by id (the screen edits the version it shows). */
async function flowById(client, id) {
  const { rows } = await client.query(
    `SELECT d.workflow_definition_id, d.key::text AS key, d.version, d.module_key, d.name, d.description,
            d.context_types, d.stages, d.active, d.created_at, ${NAME("ce")} AS created_by_name,
            (SELECT count(*)::int FROM workflow_instance i
              WHERE i.definition_key = d.key::text AND i.state = 'pending') AS open_requests
       FROM workflow_definition d
       LEFT JOIN app_user cu ON cu.user_id = d.created_by
       LEFT JOIN employee ce ON ce.employee_id = cu.employee_id
      WHERE d.workflow_definition_id = $1`,
    [id],
  );
  return rows[0] || null;
}

/** The counts above the flows. */
async function summaryCounts(client) {
  const { rows } = await client.query(
    `SELECT (SELECT count(*)::int FROM workflow_definition WHERE active) AS flows,
            (SELECT count(*)::int FROM workflow_instance WHERE state = 'pending') AS open_requests,
            (SELECT count(*)::int FROM workflow_instance
              WHERE state = 'pending' AND stage_due_at < now()) AS overdue`,
  );
  return rows[0];
}

/** Every active flow's definition, to count the ones the rules would refuse. */
async function activeDefinitions(client) {
  // pagination:complete every active flow, to count those that would be refused; a handful, never listed
  const { rows } = await completeQuery(
    client,
    `SELECT key::text AS key, module_key, name, context_types, stages
       FROM workflow_definition WHERE active ORDER BY key, workflow_definition_id`,
    [],
    { label: "active approval flows", ceiling: 500 },
  );
  return rows;
}

/* ------------------------------------------------------------------ *
 * Requests waiting on a person
 * ------------------------------------------------------------------ */

/**
 * The WHERE clause of My Approvals: pending, named on the current stage, in a module
 * the person approves in (`modules` null for the CEO, who approves everywhere).
 */
function waitingWhere(user, roleCodes, modules, moduleKey, params) {
  params.push(moduleKey ?? null, modules === null, modules || []);
  const n = params.length;
  const named = approvers.waitingOnClause("i", user, roleCodes, params);
  return `i.state = 'pending'
     AND ($${n - 2}::text IS NULL OR i.module_key = $${n - 2})
     AND ($${n - 1}::boolean OR i.module_key = ANY($${n}::text[]))
     AND ${named}`;
}

/** My Approvals: oldest waiting first, 25 a page. */
function waiting(client, user, roleCodes, modules, query) {
  const params = [];
  const where = waitingWhere(user, roleCodes, modules, query.module_key, params);
  return pageQuery(
    client,
    `SELECT i.workflow_instance_id, i.definition_key, d.name AS definition_name, d.stages, i.module_key,
            i.entity_type, i.entity_id, i.subject_employee_id, ${NAME("se")} AS subject_name,
            i.current_stage, i.context, i.stage_entered_at, i.stage_due_at,
            (i.stage_due_at IS NOT NULL AND i.stage_due_at < now()) AS overdue,
            i.opened_by, ${NAME("oe")} AS opened_by_name, i.opened_at, ${TOTAL_COL}
       FROM workflow_instance i
       JOIN workflow_definition d ON d.workflow_definition_id = i.workflow_definition_id
       LEFT JOIN employee se ON se.employee_id = i.subject_employee_id
       LEFT JOIN app_user ou ON ou.user_id = i.opened_by
       LEFT JOIN employee oe ON oe.employee_id = ou.employee_id
      WHERE ${where}
      ORDER BY i.stage_entered_at, i.workflow_instance_id`,
    params,
    query,
  );
}

/** How many wait on the person, and how many of those are past their time limit. */
async function waitingCount(client, user, roleCodes, modules) {
  const params = [];
  const where = waitingWhere(user, roleCodes, modules, null, params);
  const { rows } = await client.query(
    `SELECT count(*)::int AS waiting,
            count(*) FILTER (WHERE i.stage_due_at IS NOT NULL AND i.stage_due_at < now())::int AS overdue
       FROM workflow_instance i
      WHERE ${where}`,
    params,
  );
  return rows[0];
}

/* ------------------------------------------------------------------ *
 * One request
 * ------------------------------------------------------------------ */

/** The names a request shows: its subject and whoever opened it. */
async function instanceNames(client, instance) {
  const { rows } = await client.query(
    `SELECT (SELECT ${NAME("e")} FROM employee e WHERE e.employee_id = $1) AS subject_name,
            (SELECT ${NAME("e")} FROM app_user u JOIN employee e ON e.employee_id = u.employee_id
              WHERE u.user_id = $2) AS opened_by_name`,
    [instance.subject_employee_id, instance.opened_by],
  );
  return rows[0];
}

/** Login id → name, for the people who decided. A request has a handful of decisions. */
async function namesOfUsers(client, ids) {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (wanted.length === 0) return new Map();
  const { rows } = await client.query(
    `SELECT u.user_id, ${NAME("e")} AS name
       FROM app_user u JOIN employee e ON e.employee_id = u.employee_id
      WHERE u.user_id = ANY($1::uuid[])
      ORDER BY u.user_id`,
    [wanted],
  );
  return new Map(rows.map((r) => [r.user_id, r.name]));
}

/** Role code → role name, for a stage that names a role. */
async function roleNames(client, codes) {
  const wanted = [...new Set(codes.filter(Boolean))];
  if (wanted.length === 0) return new Map();
  const { rows } = await client.query(
    "SELECT code::text AS code, name FROM role WHERE code::text = ANY($1::text[]) ORDER BY code",
    [wanted],
  );
  return new Map(rows.map((r) => [r.code, r.name]));
}

/** Employee id → name, for a stage resolved to a line manager. */
async function employeeNames(client, ids) {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (wanted.length === 0) return new Map();
  const { rows } = await client.query(
    `SELECT e.employee_id, ${NAME("e")} AS name FROM employee e
      WHERE e.employee_id = ANY($1::uuid[]) ORDER BY e.employee_id`,
    [wanted],
  );
  return new Map(rows.map((r) => [r.employee_id, r.name]));
}

/** The instance's module, without a lock (it never changes), or null. */
async function moduleOfInstance(client, id) {
  const { rows } = await client.query(
    "SELECT module_key FROM workflow_instance WHERE workflow_instance_id = $1",
    [id],
  );
  return rows[0] ? rows[0].module_key : null;
}

/* ------------------------------------------------------------------ *
 * Reassigning
 * ------------------------------------------------------------------ */

/** The pending instance, locked for the reassignment, or null. */
async function lockPending(client, id) {
  const { rows } = await client.query(
    `SELECT workflow_instance_id, workflow_definition_id, definition_key, module_key, entity_type, entity_id,
            subject_employee_id, current_stage, state, stage_approvers, opened_by
       FROM workflow_instance WHERE workflow_instance_id = $1 FOR UPDATE`,
    [id],
  );
  return rows[0] || null;
}

/** An active login, with its employee, roles and CEO flag, or null. */
async function activeUser(client, userId) {
  const { rows } = await client.query(
    `SELECT u.user_id, u.employee_id, u.is_ceo, ${NAME("e")} AS name,
            COALESCE((SELECT array_agg(ur.role_id ORDER BY ur.role_id) FROM user_role ur
                       WHERE ur.user_id = u.user_id), '{}'::uuid[]) AS role_ids
       FROM app_user u JOIN employee e ON e.employee_id = u.employee_id
      WHERE u.user_id = $1 AND u.status = 'active'`,
    [userId],
  );
  return rows[0] || null;
}

/** Give the current stage to new approvers and start its time limit again. */
async function setStageApprovers(client, id, snapshot, slaHours) {
  const { rows } = await client.query(
    `UPDATE workflow_instance
        SET stage_approvers = $2::jsonb, stage_due_at = now() + make_interval(hours => $3), updated_at = now()
      WHERE workflow_instance_id = $1
      RETURNING workflow_instance_id, stage_approvers`,
    [id, JSON.stringify(snapshot), slaHours],
  );
  return rows[0];
}

async function insertDecision(client, { instance_id: id, stage_key: stageKey, actor_id: actorId, decision, reason }) {
  await client.query(
    `INSERT INTO workflow_decision (workflow_instance_id, stage_key, actor_id, decision, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, stageKey, actorId, decision, reason],
  );
}

module.exports = {
  FLOW_SORTS,
  listFlows,
  flowById,
  summaryCounts,
  activeDefinitions,
  waiting,
  waitingCount,
  instanceNames,
  namesOfUsers,
  roleNames,
  employeeNames,
  moduleOfInstance,
  lockPending,
  activeUser,
  setStageApprovers,
  insertDecision,
};
