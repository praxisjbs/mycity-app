"use strict";
/**
 * Reviews: the SQL. Writes monthly rounds (performance_cycle), reviews (performance_review), their
 * items (performance_review_item) and improvement plans with their lines. Reads the scorecards,
 * people, tasks, attendance and recognitions a review shows. Never emits (BACKEND_GUIDE §2).
 */
const { pageQuery, completeQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");
const { personJson } = require("../../shared/db/person");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

const PERSON = (e, d) => personJson(e, d);

/** Is the review's employee a function's named head (their check-in falls a day later, §6.2)? */
const IS_HEAD = "EXISTS (SELECT 1 FROM department hd WHERE hd.head_employee_id = pr.employee_id)";

/** The deadline of the stage a review stands at (§6.2). */
const DUE = `CASE pr.status
    WHEN 'check_in' THEN CASE WHEN ${IS_HEAD} THEN c.head_check_in_due_on ELSE c.check_in_due_on END
    WHEN 'with_reviewer' THEN c.review_due_on
    WHEN 'returned' THEN c.review_due_on
    WHEN 'second_level' THEN c.second_level_due_on
    WHEN 'with_hr' THEN c.close_due_on
    ELSE NULL END`;

/** A review as the contract's Review and ReviewDetail need it. */
const ROW = `pr.performance_review_id, pr.performance_cycle_id, c.name AS round_name, c.month, pr.scorecard_id,
  pr.review_kind, pr.review_type, pr.status, pr.employee_id, ${PERSON("e", "ed")} AS employee,
  pr.reviewer_employee_id, ${PERSON("r", "rd")} AS reviewer, pr.check_in_submitted_at, pr.submitted_at, pr.closed_at,
  trim_scale(pr.score_month)::text AS score_month, trim_scale(pr.score_to_date)::text AS score_to_date, pr.rating,
  (${DUE}) AS due_on, pr.dotted_employee_id, ${PERSON("dm", "dd")} AS dotted, pr.dotted_input, pr.dotted_input_at,
  pr.second_level_employee_id, ${PERSON("sl", "sld")} AS second_level, pr.conduct_breach, pr.conduct_note,
  pr.probation_outcome, pr.returned_reason, pr.no_check_in_at, pr.no_check_in_reason, pr.withdrawn_at, pr.withdrawn_reason,
  pr.document_id, pr.workflow_instance_id, pr.created_at,
  s.department_id AS scorecard_department_id, e.department_id AS employee_department_id,
  COALESCE(s.performance_period_id, c.performance_period_id) AS performance_period_id,
  s.reviewer_role_code::text AS reviewer_role_code, c.check_in_due_on, c.head_check_in_due_on, c.review_due_on,
  c.second_level_due_on, c.close_due_on, c.status AS round_status, (${IS_HEAD}) AS is_head,
  p.live_from, p.rules, p.ends_on AS period_ends_on`;

const FROM = `FROM performance_review pr
  LEFT JOIN performance_cycle c ON c.performance_cycle_id = pr.performance_cycle_id
  LEFT JOIN scorecard s ON s.scorecard_id = pr.scorecard_id
  LEFT JOIN performance_period p ON p.performance_period_id = COALESCE(s.performance_period_id, c.performance_period_id)
  JOIN employee e ON e.employee_id = pr.employee_id
  LEFT JOIN department ed ON ed.department_id = e.department_id
  JOIN employee r ON r.employee_id = pr.reviewer_employee_id
  LEFT JOIN department rd ON rd.department_id = r.department_id
  LEFT JOIN employee dm ON dm.employee_id = pr.dotted_employee_id
  LEFT JOIN department dd ON dd.department_id = dm.department_id
  LEFT JOIN employee sl ON sl.employee_id = pr.second_level_employee_id
  LEFT JOIN department sld ON sld.department_id = sl.department_id`;

const SORTS = {
  due_on: `(${DUE}) NULLS LAST`,
  employee: "e.first_name, e.last_name",
  status: "pr.status",
};

/**
 * The SQL "this review waits on the reader": the reviewer to score, the dotted manager's input, a
 * holder of its reviewing role, or the approval's stage naming them. Appends to `params`.
 * @param {{employee_id: string|null, user_id: string, is_ceo?: boolean}} reader
 * @param {string[]} roleCodes  the reader's role codes
 */
function waitingClause(reader, roleCodes, params) {
  params.push(reader.employee_id || null, roleCodes || []);
  const me = `$${params.length - 1}::uuid`;
  const roles = `$${params.length}::text[]`;
  const { waitingOnClause } = require("../../shared/workflow/approvers");
  const stage = waitingOnClause("wi", { user_id: reader.user_id, employee_id: reader.employee_id, is_ceo: reader.is_ceo === true }, roleCodes || [], params);
  return `(
      (pr.status IN ('with_reviewer', 'returned')
        AND (pr.reviewer_employee_id = ${me}
          OR (s.reviewer_role_code IS NOT NULL AND s.reviewer_role_code::text = ANY(${roles}) AND pr.employee_id <> ${me})))
      OR (pr.dotted_employee_id = ${me} AND pr.check_in_submitted_at IS NOT NULL AND pr.dotted_input IS NULL
          AND pr.status IN ('with_reviewer', 'returned'))
      OR (wi.workflow_instance_id IS NOT NULL AND pr.employee_id IS DISTINCT FROM ${me} AND ${stage}))`;
}

const WI = "LEFT JOIN workflow_instance wi ON wi.workflow_instance_id = pr.workflow_instance_id AND wi.state = 'pending'";

/**
 * The reviews a reader may list: those in their `performance` scope, and those that name them
 * (reviewer, a holder of the reviewing role, dotted manager, second level). Appends to `params`.
 */
function readable(scope, reader, roleCodes, params) {
  const s = scopeClause(scope, { column: "pr.employee_id" }, params);
  if (!s.and) return "";
  params.push(reader.employee_id || null, roleCodes || []);
  const me = `$${params.length - 1}::uuid`;
  const roles = `$${params.length}::text[]`;
  return `AND (${s.and.slice(4)} OR pr.reviewer_employee_id = ${me} OR pr.dotted_employee_id = ${me}
    OR pr.second_level_employee_id = ${me}
    OR (s.reviewer_role_code IS NOT NULL AND s.reviewer_role_code::text = ANY(${roles}) AND pr.employee_id <> ${me}))`;
}

/** One page of reviews (GET /performance/reviews), each with whether it waits on the reader. */
function list(db, query, scope, reader, roleCodes) {
  const params = [
    query.round_id || null,
    query.status || null,
    query.kind || null,
    query.department_id || null,
    query.q || null,
  ];
  const waiting = waitingClause(reader, roleCodes, params);
  const who = readable(scope, reader, roleCodes, params);
  params.push(query.waiting_on_me === "true");
  const onlyWaiting = `$${params.length}::boolean`;
  return pageQuery(
    db,
    `SELECT ${ROW}, ${waiting} AS waiting_on_me, ${TOTAL_COL} ${FROM} ${WI}
      WHERE ($1::uuid IS NULL OR pr.performance_cycle_id = $1)
        AND ($2::text IS NULL OR pr.status = $2 OR ($2 = 'with_reviewer' AND pr.status = 'returned'))
        AND ($3::text IS NULL OR pr.review_kind = $3)
        AND ($4::uuid IS NULL OR COALESCE(s.department_id, e.department_id) = $4)
        AND ($5::text IS NULL OR search_fold(e.first_name || ' ' || e.last_name) LIKE '%' || search_fold($5) || '%')
        AND (NOT ${onlyWaiting} OR ${waiting})
        ${who}
      ORDER BY ${orderBy(query, SORTS, "pr.performance_review_id")}`,
    params,
    query,
  );
}

/** One review, with whether it waits on the reader when one is given. */
async function get(db, id, reader = null, roleCodes = []) {
  if (!reader) return one(db, `SELECT ${ROW}, false AS waiting_on_me ${FROM} WHERE pr.performance_review_id = $1`, [id]);
  const params = [id];
  const waiting = waitingClause(reader, roleCodes, params);
  return one(db, `SELECT ${ROW}, ${waiting} AS waiting_on_me ${FROM} ${WI} WHERE pr.performance_review_id = $1`, params);
}

/** Lock a review's row for a write. */
const lock = (client, id) => client.query("SELECT 1 FROM performance_review WHERE performance_review_id = $1 FOR UPDATE", [id]);

/** The review of a scorecard in a round. */
const ofScorecardInRound = (db, cycleId, scorecardId) =>
  one(db, `SELECT ${ROW}, false AS waiting_on_me ${FROM} WHERE pr.performance_cycle_id = $1 AND pr.scorecard_id = $2`, [cycleId, scorecardId]);

/** The caller's latest review that has not ended (closed or withdrawn): the check-in My Performance opens. */
const openOfEmployee = (db, employeeId) =>
  one(
    db,
    `SELECT ${ROW}, false AS waiting_on_me ${FROM}
      WHERE pr.employee_id = $1 AND pr.status NOT IN ('closed', 'withdrawn') AND pr.review_kind IN ('monthly', 'probation')
        AND (pr.scorecard_id IS NOT NULL OR pr.review_kind = 'probation')
      ORDER BY (pr.status = 'check_in') DESC, c.month DESC NULLS LAST, pr.created_at DESC, pr.performance_review_id
      LIMIT 1`,
    [employeeId],
  );

/** A person's reviews that have not ended, oldest first: what a leaver's leaving withdraws (§11). */
async function openIdsOf(db, employeeId) {
  // pagination:complete a person's open reviews: a month's and a probation review at most, each withdrawn
  const { rows } = await completeQuery(
    db,
    `SELECT pr.performance_review_id FROM performance_review pr
      WHERE pr.employee_id = $1 AND pr.status NOT IN ('closed', 'withdrawn')
        AND (pr.scorecard_id IS NOT NULL OR pr.review_kind = 'probation')
      ORDER BY pr.created_at, pr.performance_review_id`,
    [employeeId],
    { label: "a leaver's open reviews", ceiling: 50 },
  );
  return rows.map((r) => r.performance_review_id);
}

/** The caller's own reviews, newest first (GET /ess/performance/reviews). */
function ofEmployee(db, employeeId, query) {
  return pageQuery(
    db,
    `SELECT ${ROW}, false AS waiting_on_me, ${TOTAL_COL} ${FROM}
      WHERE pr.employee_id = $1 AND (pr.scorecard_id IS NOT NULL OR pr.review_kind = 'probation')
      ORDER BY ${orderBy(query, { month: "c.month DESC NULLS FIRST, pr.created_at DESC" }, "pr.performance_review_id")}`,
    [employeeId],
    query,
  );
}

const REVIEW_WRITABLE = [
  "performance_cycle_id", "scorecard_id", "employee_id", "reviewer_employee_id", "review_type", "review_kind",
  "status", "check_in_submitted_at", "submitted_at", "closed_at", "returned_reason", "workflow_instance_id",
  "dotted_employee_id", "dotted_input", "dotted_input_at", "second_level_employee_id", "score_month", "score_to_date",
  "rating", "conduct_breach", "conduct_note", "probation_outcome", "document_id", "no_check_in_at", "no_check_in_reason",
  "withdrawn_at", "withdrawn_reason",
];

async function insert(client, row) {
  const keys = REVIEW_WRITABLE.filter((k) => row[k] !== undefined);
  const { rows } = await client.query(
    `INSERT INTO performance_review (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})
     ON CONFLICT DO NOTHING RETURNING performance_review_id`,
    keys.map((k) => row[k]),
  );
  return rows[0] ? rows[0].performance_review_id : null;
}

async function update(client, id, patch) {
  const keys = REVIEW_WRITABLE.filter((k) => patch[k] !== undefined && !["employee_id", "scorecard_id", "performance_cycle_id"].includes(k));
  if (!keys.length) return;
  await client.query(
    `UPDATE performance_review SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE performance_review_id = $1`,
    [id, ...keys.map((k) => patch[k])],
  );
}

/* ------------------------------------------------------------------ *
 * Items
 * ------------------------------------------------------------------ */

/** An item, with the line it scores and its corrective action. */
const ITEM = `i.performance_review_item_id, i.performance_review_id, i.employee_target_id, i.kpi_definition_id, i.criterion,
  trim_scale(i.actual_value)::text AS actual_value, i.actual_text, i.achieved_on, i.evidence_kind, i.evidence_entity_type,
  i.evidence_entity_id, i.evidence_document_id, i.evidence_url, i.evidence_note, i.action_text, i.action_transcript,
  i.action_document_id, i.action_ai_run_id, trim_scale(i.proposed_score)::text AS proposed_score,
  trim_scale(i.self_score)::text AS self_score, i.self_reason, trim_scale(i.score)::text AS score, i.override_reason,
  i.comment, i.assessable, i.auto, i.corrective_title, i.corrective_owner_id, i.corrective_due_on, i.corrective_task_id,
  ${PERSON("co", "cod")} AS corrective_owner, ct.number AS task_number, ct.status AS task_status,
  CASE WHEN t.employee_target_id IS NULL THEN NULL ELSE json_build_object(
    'employee_target_id', t.employee_target_id, 'section', t.section, 'title', t.title, 'measure', t.measure,
    'source', t.source, 'target_value', trim_scale(t.target_value)::text, 'target_text', t.target_text, 'unit', t.unit,
    'weight', trim_scale(t.weight)::text) END AS line,
  t.section, t.position, t.measure, t.source, t.direction, t.unit, trim_scale(t.target_value)::text AS target_value,
  t.milestone_due_on, trim_scale(t.weight)::text AS weight`;

/** Every item of a review, in its scorecard's order (criteria in their own order). */
async function items(db, reviewId) {
  // pagination:complete a review is read whole: its score adds up every line
  const { rows } = await completeQuery(
    db,
    `SELECT ${ITEM}
       FROM performance_review_item i
       LEFT JOIN employee_target t ON t.employee_target_id = i.employee_target_id
       LEFT JOIN employee co ON co.employee_id = i.corrective_owner_id
       LEFT JOIN department cod ON cod.department_id = co.department_id
       LEFT JOIN task ct ON ct.task_id = i.corrective_task_id
      WHERE i.performance_review_id = $1
      ORDER BY CASE t.section WHEN 'results' THEN 0 WHEN 'kpis' THEN 1 WHEN 'accountability' THEN 2 ELSE 3 END,
               t.position NULLS LAST,
               array_position(ARRAY['objectives', 'quality', 'timeliness', 'attendance', 'conduct']::text[], i.criterion),
               i.performance_review_item_id`,
    [reviewId],
    { label: "a review's items", ceiling: 200 },
  );
  return rows;
}

const ITEM_WRITABLE = [
  "performance_review_id", "employee_target_id", "kpi_definition_id", "criterion", "actual_value", "actual_text",
  "achieved_on", "evidence_kind", "evidence_entity_type", "evidence_entity_id", "evidence_document_id", "evidence_url",
  "evidence_note", "action_text", "action_transcript", "action_document_id", "action_ai_run_id", "proposed_score",
  "self_score", "self_reason", "score", "override_reason", "comment", "assessable", "auto", "corrective_title",
  "corrective_owner_id", "corrective_due_on", "corrective_task_id",
];

async function insertItem(client, row) {
  const keys = ITEM_WRITABLE.filter((k) => row[k] !== undefined);
  await client.query(
    `INSERT INTO performance_review_item (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})
     ON CONFLICT DO NOTHING`,
    keys.map((k) => row[k]),
  );
}

async function updateItem(client, id, patch) {
  const keys = ITEM_WRITABLE.filter((k) => patch[k] !== undefined && !["performance_review_id"].includes(k));
  if (!keys.length) return;
  await client.query(
    `UPDATE performance_review_item SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE performance_review_item_id = $1`,
    [id, ...keys.map((k) => patch[k])],
  );
}

/* ------------------------------------------------------------------ *
 * The month around a review: tasks, attendance, recognitions
 * ------------------------------------------------------------------ */

const TASK = `t.task_id, t.number, t.title, t.status, t.due_at, t.completed_at, t.employee_target_id`;

/**
 * One bucket of the person's tasks for the month, its first 25 and the total: done in the month,
 * still open and due in it or before, or due in the month after.
 * @param {"done"|"ongoing"|"next_month"} bucket
 * @param {{from: Date, to: Date, next_to: Date}} m
 */
function taskBucket(db, employeeId, bucket, m) {
  const [where, params, order] = {
    done: ["t.status = 'done' AND t.completed_at >= $2 AND t.completed_at < $3", [m.from, m.to], "t.completed_at DESC"],
    ongoing: ["t.status NOT IN ('done', 'cancelled') AND t.due_at < $2", [m.to], "t.due_at"],
    next_month: ["t.status NOT IN ('done', 'cancelled') AND t.due_at >= $2 AND t.due_at < $3", [m.to, m.next_to], "t.due_at"],
  }[bucket];
  return pageQuery(
    db,
    `SELECT ${TASK}, '${bucket}'::text AS bucket, ${TOTAL_COL}
       FROM task t
      WHERE t.primary_assignee_id = $1 AND t.archived_at IS NULL AND ${where}
      ORDER BY ${order}, t.task_id`,
    [employeeId, ...params],
    { page: 1 },
  );
}

/** Recognitions a person received in Staff Community in the month. */
const recognitions = async (db, employeeId, m) =>
  (
    await one(
      db,
      "SELECT count(*)::int AS n FROM peer_recognition WHERE to_employee_id = $1 AND created_at >= $2 AND created_at < $3",
      [employeeId, m.from, m.to],
    )
  ).n;

/* ------------------------------------------------------------------ *
 * Rounds
 * ------------------------------------------------------------------ */

const ROUND = `c.performance_cycle_id, c.performance_period_id, c.name, c.month, c.status, c.check_in_due_on,
  c.head_check_in_due_on, c.review_due_on, c.second_level_due_on, c.close_due_on, c.closes_at`;

/** One page of rounds, newest month first by default. */
function listRounds(db, query) {
  return pageQuery(
    db,
    `SELECT ${ROUND}, ${TOTAL_COL} FROM performance_cycle c
      WHERE c.month IS NOT NULL AND c.performance_period_id IS NOT NULL
        AND ($1::uuid IS NULL OR c.performance_period_id = $1)
        AND ($2::text IS NULL OR c.status = $2)
      ORDER BY ${query.sort ? orderBy(query, { month: "c.month" }, "c.performance_cycle_id") : "c.month DESC, c.performance_cycle_id"}`,
    [query.period_id || null, query.status || null],
    query,
  );
}

const getRound = (db, id) =>
  one(db, `SELECT ${ROUND} FROM performance_cycle c WHERE c.performance_cycle_id = $1 AND c.month IS NOT NULL`, [id]);

const roundOf = (db, periodId, month) =>
  one(db, `SELECT ${ROUND} FROM performance_cycle c WHERE c.performance_period_id = $1 AND c.month = $2::date`, [periodId, month]);

/** A new round; null when it is already there. */
async function insertRound(client, row) {
  const { rows } = await client.query(
    `INSERT INTO performance_cycle (performance_period_id, name, month, starts_on, ends_on, status, check_in_due_on,
       head_check_in_due_on, review_due_on, second_level_due_on, close_due_on, closes_at)
     VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $8, $9, $10, $11)
     ON CONFLICT (performance_period_id, month) DO NOTHING
     RETURNING performance_cycle_id`,
    [
      row.performance_period_id, row.name, row.month, row.starts_on, row.ends_on, row.check_in_due_on,
      row.head_check_in_due_on, row.review_due_on, row.second_level_due_on, row.close_due_on, row.closes_at,
    ],
  );
  return rows[0] ? rows[0].performance_cycle_id : null;
}

const setRoundStatus = (client, id, status) =>
  client.query("UPDATE performance_cycle SET status = $2 WHERE performance_cycle_id = $1", [id, status]);

/** How many of each round's reviews stand at each stage, within what the reader may list. */
async function roundCounts(db, cycleIds, scope, reader, roleCodes) {
  if (!cycleIds.length) return [];
  const params = [cycleIds];
  const who = readable(scope, reader, roleCodes, params);
  // pagination:complete one row per round on the page being sent
  const { rows } = await completeQuery(
    db,
    `SELECT pr.performance_cycle_id,
            count(*)::int AS total,
            count(*) FILTER (WHERE pr.status = 'check_in')::int AS check_in,
            count(*) FILTER (WHERE pr.status IN ('with_reviewer', 'returned'))::int AS with_reviewer,
            count(*) FILTER (WHERE pr.status = 'second_level')::int AS second_level,
            count(*) FILTER (WHERE pr.status = 'with_hr')::int AS with_hr,
            count(*) FILTER (WHERE pr.status = 'closed')::int AS closed
       FROM performance_review pr
       LEFT JOIN scorecard s ON s.scorecard_id = pr.scorecard_id
      WHERE pr.performance_cycle_id = ANY($1::uuid[]) AND pr.scorecard_id IS NOT NULL ${who}
      GROUP BY pr.performance_cycle_id
      ORDER BY pr.performance_cycle_id`,
    params,
    { label: "a page of rounds' counts" },
  );
  return rows;
}

/** The quarters whose months may still need a round: any not being planned. */
async function runningPeriods(db) {
  // pagination:complete the quarters set up: four a year
  const { rows } = await completeQuery(
    db,
    `SELECT performance_period_id, name, starts_on, ends_on, live_from, status, rules
       FROM performance_period WHERE status <> 'planning' ORDER BY starts_on, performance_period_id`,
    [],
    { label: "quarters", ceiling: 200 },
  );
  return rows;
}

/**
 * A quarter's scorecards that bind (binding or agreed) and had bound before a month ended: each
 * gets a review in that month's round. A scorecard binds with its plan, or on its own amendment's
 * approval (§11); an imported one when it was made. Months before it bound are not reviewed.
 */
async function bindingScorecards(db, periodId, monthEndsBefore) {
  // pagination:complete a round opens one review for every binding scorecard of its quarter at once
  const { rows } = await completeQuery(
    db,
    `SELECT s.scorecard_id, s.employee_id, s.department_id, s.reviewer_employee_id, s.reviewer_role_code::text AS reviewer_role_code,
            s.reviewer_reason, s.dotted_employee_id, m.manager_id AS effective_manager_id,
            COALESCE((SELECT bool_or(u.is_ceo) FROM app_user u WHERE u.employee_id = s.employee_id), false) AS is_ceo
       FROM scorecard s
       JOIN employee e ON e.employee_id = s.employee_id
       LEFT JOIN employee_effective_manager m ON m.employee_id = s.employee_id
       LEFT JOIN performance_plan pl ON pl.performance_period_id = s.performance_period_id
            AND pl.department_id IS NOT DISTINCT FROM s.department_id
      WHERE s.performance_period_id = $1 AND s.status IN ('binding', 'agreed') AND e.status = 'active'
        AND COALESCE(
              (SELECT max(wi.completed_at) FROM workflow_instance wi
                WHERE wi.entity_type = 'scorecard' AND wi.entity_id = s.scorecard_id::text
                  AND wi.definition_key = 'performance.plan' AND wi.state IN ('approved', 'timeout_approved')),
              pl.binding_at, s.created_at) < $2::timestamptz
      ORDER BY e.first_name, e.last_name, s.scorecard_id`,
    [periodId, monthEndsBefore],
    { label: "a quarter's binding scorecards", ceiling: 2000 },
  );
  return rows;
}

/** A person's binding scorecard of the quarter running on a date, if any (a probation review's lines). */
const scorecardOn = (db, employeeId, date) =>
  one(
    db,
    `SELECT s.scorecard_id, s.performance_period_id FROM scorecard s JOIN performance_period p ON p.performance_period_id = s.performance_period_id
      WHERE s.employee_id = $1 AND s.status IN ('binding', 'agreed') AND p.starts_on <= $2::date AND p.ends_on >= $2::date
      ORDER BY p.starts_on DESC LIMIT 1`,
    [employeeId, date],
  );

/* ------------------------------------------------------------------ *
 * People, roles and the chain
 * ------------------------------------------------------------------ */

/** A person's effective line manager (the first person above a vacant seat), or null. */
const effectiveManagerOf = async (db, employeeId) => {
  const r = await one(db, "SELECT manager_id FROM employee_effective_manager WHERE employee_id = $1", [employeeId]);
  return r ? r.manager_id : null;
};

/** Is this employee the CEO? */
const isCeoEmployee = async (db, employeeId) =>
  Boolean(employeeId) &&
  Boolean(await one(db, "SELECT 1 AS x FROM app_user WHERE employee_id = $1 AND is_ceo LIMIT 1", [employeeId]));

/** The role codes a user holds. */
async function roleCodesOfUser(db, userId) {
  if (!userId) return [];
  // pagination:complete the roles one person holds, a handful
  const { rows } = await completeQuery(
    db,
    `SELECT DISTINCT r.code::text AS code FROM user_role ur JOIN role r ON r.role_id = ur.role_id
      WHERE ur.user_id = $1 ORDER BY code`,
    [userId],
    { label: "a person's roles", ceiling: 100 },
  );
  return rows.map((r) => r.code);
}

/** A person's name and job, for the chain and the PDF. */
const personOf = (db, employeeId) =>
  one(db, `SELECT ${PERSON("e", "d")} AS person FROM employee e LEFT JOIN department d ON d.department_id = e.department_id WHERE e.employee_id = $1`, [employeeId]);

/** The decisions on a review's approvals, oldest first, with who made them. */
async function decisions(db, reviewId) {
  // pagination:complete a review's approval decisions, a few per round of the chain
  const { rows } = await completeQuery(
    db,
    `SELECT d.stage_key, d.decision, d.reason, d.decided_at,
            COALESCE(btrim(e.first_name || ' ' || e.last_name), u.email::text) AS name
       FROM workflow_instance i
       JOIN workflow_decision d ON d.workflow_instance_id = i.workflow_instance_id
       LEFT JOIN app_user u ON u.user_id = d.actor_id
       LEFT JOIN employee e ON e.employee_id = u.employee_id
      WHERE i.entity_type = 'performance_review' AND i.entity_id = $1
      ORDER BY d.decided_at, d.workflow_decision_id`,
    [String(reviewId)],
    { label: "a review's decisions", ceiling: 200 },
  );
  return rows;
}

/** The scores a scorecard's lines took in the closed reviews of its quarter, by month. */
async function closedMonths(db, scorecardId) {
  // pagination:complete one row per line per closed month of a quarter
  const { rows } = await completeQuery(
    db,
    `SELECT i.employee_target_id, c.month, trim_scale(i.score)::text AS score
       FROM performance_review_item i
       JOIN performance_review r ON r.performance_review_id = i.performance_review_id
       JOIN performance_cycle c ON c.performance_cycle_id = r.performance_cycle_id
      WHERE r.scorecard_id = $1 AND r.status = 'closed' AND i.employee_target_id IS NOT NULL
      ORDER BY c.month, i.employee_target_id`,
    [scorecardId],
    { label: "a scorecard's closed months", ceiling: 1000 },
  );
  return rows;
}

const setScorecardScore = (client, scorecardId, { score_to_date: s, rating }) =>
  client.query("UPDATE scorecard SET score_to_date = $2, rating = $3 WHERE scorecard_id = $1", [scorecardId, s, rating]);

/** Has a person had a probation extended before (at most once, as the handbook allows)? */
const extendedBefore = async (db, employeeId, exceptId) =>
  Boolean(
    await one(
      db,
      `SELECT 1 AS x FROM performance_review WHERE employee_id = $1 AND review_kind = 'probation'
          AND probation_outcome = 'extend' AND status = 'closed' AND performance_review_id <> $2 LIMIT 1`,
      [employeeId, exceptId],
    ),
  );

/** The open probation review of a person, if any. */
const openProbationOf = (db, employeeId) =>
  one(db, `SELECT ${ROW}, false AS waiting_on_me ${FROM} WHERE pr.employee_id = $1 AND pr.review_kind = 'probation' AND pr.closed_at IS NULL`, [employeeId]);

/* ------------------------------------------------------------------ *
 * Improvement plans
 * ------------------------------------------------------------------ */

const PIP = `ip.improvement_plan_id, ip.employee_id, ${PERSON("e", "ed")} AS employee, ip.performance_review_id, ip.starts_on,
  ip.ends_on, ip.review_on, ip.summary, ip.status, ip.outcome_note, ip.decided_at, ip.created_at, ip.updated_at,
  COALESCE((SELECT json_agg(json_build_object('improvement_plan_line_id', l.improvement_plan_line_id,
              'employee_target_id', l.employee_target_id, 'text', l.text, 'target_text', l.target_text, 'position', l.position)
              ORDER BY l.position, l.improvement_plan_line_id)
              FROM improvement_plan_line l WHERE l.improvement_plan_id = ip.improvement_plan_id), '[]'::json) AS lines,
  pr.reviewer_employee_id`;
const PIP_FROM = `FROM improvement_plan ip
  JOIN employee e ON e.employee_id = ip.employee_id
  LEFT JOIN department ed ON ed.department_id = e.department_id
  LEFT JOIN performance_review pr ON pr.performance_review_id = ip.performance_review_id`;

function listPips(db, query, scope) {
  const params = [query.status || null, query.employee_id || null, query.q || null];
  const s = scopeClause(scope, { column: "ip.employee_id" }, params);
  return pageQuery(
    db,
    `SELECT ${PIP}, ${TOTAL_COL} ${PIP_FROM}
      WHERE ($1::text IS NULL OR ip.status = $1) AND ($2::uuid IS NULL OR ip.employee_id = $2)
        AND ($3::text IS NULL OR search_fold(e.first_name || ' ' || e.last_name) LIKE '%' || search_fold($3) || '%')
        ${s.and}
      ORDER BY ${orderBy(query, { review_on: "ip.review_on", created_at: "ip.created_at" }, "ip.improvement_plan_id")}`,
    params,
    query,
  );
}

const getPip = (db, id) => one(db, `SELECT ${PIP} ${PIP_FROM} WHERE ip.improvement_plan_id = $1`, [id]);

const pipOfReview = (db, reviewId) => one(db, `SELECT ${PIP} ${PIP_FROM} WHERE ip.performance_review_id = $1 ORDER BY ip.created_at DESC LIMIT 1`, [reviewId]);

const openPipOf = (db, employeeId) =>
  one(db, `SELECT ${PIP} ${PIP_FROM} WHERE ip.employee_id = $1 AND ip.status IN ('open', 'extended') ORDER BY ip.review_on LIMIT 1`, [employeeId]);

const PIP_WRITABLE = ["employee_id", "performance_review_id", "starts_on", "ends_on", "review_on", "summary", "status", "outcome_note", "created_by", "decided_by", "decided_at"];

async function insertPip(client, row) {
  const keys = PIP_WRITABLE.filter((k) => row[k] !== undefined);
  const { rows } = await client.query(
    `INSERT INTO improvement_plan (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING improvement_plan_id`,
    keys.map((k) => row[k]),
  );
  return rows[0].improvement_plan_id;
}

async function updatePip(client, id, patch) {
  const keys = PIP_WRITABLE.filter((k) => patch[k] !== undefined && !["employee_id", "performance_review_id", "created_by"].includes(k));
  if (!keys.length) return;
  await client.query(
    `UPDATE improvement_plan SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE improvement_plan_id = $1`,
    [id, ...keys.map((k) => patch[k])],
  );
}

/** Replace a plan's lines, in order. */
async function setPipLines(client, id, lines) {
  await client.query("DELETE FROM improvement_plan_line WHERE improvement_plan_id = $1", [id]);
  for (const [i, l] of lines.entries())
    await client.query(
      `INSERT INTO improvement_plan_line (improvement_plan_id, employee_target_id, text, target_text, position)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, l.employee_target_id || null, l.text, l.target_text || null, i],
    );
}

/* ------------------------------------------------------------------ *
 * What reminders look for
 * ------------------------------------------------------------------ */

/**
 * Each function's key results with no report for a month, by function: who to remind on the 2nd
 * business day (kr_report_due). Only a binding plan's, in a quarter being run.
 */
async function unreportedByFunction(db, month) {
  // pagination:complete one row per function: five
  const { rows } = await completeQuery(
    db,
    `SELECT o.department_id, d.name AS department, count(*)::int AS unreported
       FROM okr_key_result kr
       JOIN okr_objective o ON o.okr_objective_id = kr.okr_objective_id
       JOIN performance_plan pl ON pl.performance_plan_id = o.performance_plan_id AND pl.status IN ('binding', 'unbound', 'revising')
       JOIN performance_period p ON p.performance_period_id = o.performance_period_id AND p.status = 'active'
       JOIN department d ON d.department_id = o.department_id
      WHERE o.department_id IS NOT NULL AND kr.scored_from_key_result_id IS NULL
        AND $1::date BETWEEN p.starts_on AND p.ends_on
        AND NOT EXISTS (SELECT 1 FROM okr_key_result_month m WHERE m.okr_key_result_id = kr.okr_key_result_id AND m.month = $1::date
                         AND (m.actual_value IS NOT NULL OR m.actual_text IS NOT NULL OR m.proposed_score IS NOT NULL))
      GROUP BY o.department_id, d.name
      ORDER BY d.name, o.department_id`,
    [month],
    { label: "functions with unreported key results", ceiling: 200 },
  );
  return rows;
}

const unreportedOf = async (db, departmentId, month) =>
  (await unreportedByFunction(db, month)).find((r) => r.department_id === departmentId) || null;

module.exports = {
  ROW,
  FROM,
  list,
  get,
  lock,
  ofScorecardInRound,
  openOfEmployee,
  openIdsOf,
  ofEmployee,
  insert,
  update,
  items,
  insertItem,
  updateItem,
  taskBucket,
  recognitions,
  listRounds,
  getRound,
  roundOf,
  insertRound,
  setRoundStatus,
  roundCounts,
  runningPeriods,
  bindingScorecards,
  scorecardOn,
  effectiveManagerOf,
  isCeoEmployee,
  roleCodesOfUser,
  personOf,
  decisions,
  closedMonths,
  setScorecardScore,
  extendedBefore,
  openProbationOf,
  listPips,
  getPip,
  pipOfReview,
  openPipOf,
  insertPip,
  updatePip,
  setPipLines,
  unreportedByFunction,
  unreportedOf,
};
