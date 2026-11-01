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
const { escapeLike } = require("../../shared/search/provider");
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
            EXISTS (SELECT 1 FROM workflow_instance i WHERE i.definition_key = d.key::text) AS ever_opened,
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
              WHERE i.definition_key = d.key::text AND i.state = 'pending') AS open_requests,
            EXISTS (SELECT 1 FROM workflow_instance i WHERE i.definition_key = d.key::text) AS ever_opened
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
 * the person approves in (`modules` null for the CEO, who approves everywhere), and about a
 * record whose screen has shipped (`hidden`: the record types the delivery plan holds back).
 */
function waitingWhere(user, roleCodes, modules, moduleKey, params, hidden = []) {
  params.push(moduleKey ?? null, modules === null, modules || [], hidden);
  const n = params.length;
  const named = approvers.waitingOnClause("i", user, roleCodes, params);
  return `i.state = 'pending'
     AND ($${n - 3}::text IS NULL OR i.module_key = $${n - 3})
     AND ($${n - 2}::boolean OR i.module_key = ANY($${n - 1}::text[]))
     AND (i.entity_type IS NULL OR NOT (i.entity_type = ANY($${n}::text[])))
     AND ${named}`;
}

/** My Approvals: oldest waiting first, 25 a page; `q` finds a flow, the person it is about or who asked. */
function waiting(client, user, roleCodes, modules, query, hidden = []) {
  const params = [];
  const where = waitingWhere(user, roleCodes, modules, query.module_key, params, hidden);
  params.push(query.q ? `%${escapeLike(query.q)}%` : null);
  const q = params.length;
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
        AND ($${q}::text IS NULL OR search_fold(d.name || ' ' || coalesce(${NAME("se")}, '') || ' ' || coalesce(${NAME("oe")}, ''))
                                   LIKE search_fold($${q}::text))
      ORDER BY i.stage_entered_at, i.workflow_instance_id`,
    params,
    query,
  );
}

/** The stage a request waits at, by the name its flow gives it (an aggregate: the rows are not paged here, but LIMIT is paged.js's). */
const STAGE_NAME = `(SELECT min(s ->> 'name') FROM jsonb_array_elements(d.stages) s WHERE s ->> 'key' = i.current_stage)`;

/** How old a waiting request is, in the bands the assistant's summary names (never a row's words). */
const AGE_BAND = `CASE
    WHEN i.stage_entered_at > now() - interval '1 day' THEN '1_under_a_day'
    WHEN i.stage_entered_at > now() - interval '3 days' THEN '2_one_to_three_days'
    WHEN i.stage_entered_at > now() - interval '7 days' THEN '3_four_to_seven_days'
    ELSE '4_over_a_week' END`;

/**
 * The assistant's approvals summary (docs/guides/praxis-ai.md §6.13; foundation.md §9): the requests
 * waiting on the person, counted in one SQL over the same WHERE as My Approvals: by flow, by age band,
 * and by stage or module as asked. Figures, never a row.
 * @param {{by: string, module_key?: string|null}} query
 */
async function waitingSummary(client, user, roleCodes, modules, query, hidden = []) {
  const params = [];
  const where = waitingWhere(user, roleCodes, modules, query.module_key, params, hidden);
  const third = query.by === "stage" ? { key: `d.name || ' · ' || COALESCE(${STAGE_NAME}, i.current_stage)`, label: `d.name || ' · ' || COALESCE(${STAGE_NAME}, i.current_stage)` } : { key: "i.module_key", label: "i.module_key" };
  const { rows } = await client.query(
    `WITH w AS (
       SELECT i.workflow_instance_id, i.module_key, d.name AS flow, i.stage_entered_at, i.stage_due_at,
              (i.stage_due_at IS NOT NULL AND i.stage_due_at < now()) AS overdue,
              ${AGE_BAND} AS age_band, ${third.key} AS third_key, ${third.label} AS third_label
         FROM workflow_instance i
         JOIN workflow_definition d ON d.workflow_definition_id = i.workflow_definition_id
        WHERE ${where}
     ), figures AS (
       SELECT count(*)::int AS waiting,
              count(*) FILTER (WHERE overdue)::int AS overdue,
              COALESCE(max(extract(epoch FROM (now() - stage_entered_at)) / 86400), 0)::int AS oldest_days,
              count(DISTINCT flow)::int AS flows,
              count(*) FILTER (WHERE stage_due_at IS NOT NULL AND stage_due_at >= now() AND stage_due_at < now() + interval '1 day')::int AS due_within_a_day
         FROM w
     ), by_flow AS (
       SELECT flow, count(*)::int AS n, count(*) FILTER (WHERE overdue)::int AS o,
              row_number() OVER (ORDER BY count(*) DESC, flow) AS rank
         FROM w GROUP BY flow
     ), by_third AS (
       SELECT third_key AS key, min(third_label) AS label, count(*)::int AS n, count(*) FILTER (WHERE overdue)::int AS o,
              row_number() OVER (ORDER BY count(*) DESC, min(third_label), third_key) AS rank
         FROM w GROUP BY third_key
     )
     SELECT (SELECT row_to_json(f) FROM figures f) AS figures,
            (SELECT json_agg(json_build_object('key', flow, 'label', flow, 'value', n, 'count', o) ORDER BY rank) FROM by_flow WHERE rank <= 20) AS by_flow,
            (SELECT json_agg(json_build_object('key', age_band, 'label', age_band, 'value', n, 'count', o) ORDER BY age_band)
               FROM (SELECT age_band, count(*)::int AS n, count(*) FILTER (WHERE overdue)::int AS o FROM w GROUP BY age_band) x) AS by_age,
            (SELECT json_agg(json_build_object('key', key, 'label', label, 'value', n, 'count', o) ORDER BY rank) FROM by_third WHERE rank <= 20) AS by_third`,
    params,
  );
  const r = rows[0];
  return { figures: r.figures, by_flow: r.by_flow || [], by_age: r.by_age || [], by_third: r.by_third || [] };
}

/** How many wait on the person, and how many of those are past their time limit. */
async function waitingCount(client, user, roleCodes, modules, hidden = []) {
  const params = [];
  const where = waitingWhere(user, roleCodes, modules, null, params, hidden);
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
            subject_employee_id, current_stage, state, stage_approvers, opened_by, excluded_employee_ids
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
  waitingSummary,
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
