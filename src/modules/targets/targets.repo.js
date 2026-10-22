"use strict";
/**
 * Scorecards: the SQL. Writes scorecard, its lines (employee_target) and their Team result links
 * (employee_target_key_result). Reads the people, key results and KPIs the lines name. Never emits
 * (BACKEND_GUIDE §2).
 */
const { pageQuery, completeQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");
const { personJson } = require("../../shared/db/person");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

const PERSON = (e, d) => personJson(e, d);

/** A scorecard as the contract's Scorecard, plus the columns the detail adds. */
const ROW = `s.scorecard_id, s.performance_period_id, p.name AS period_name, s.employee_id,
  ${PERSON("e", "ed")} AS employee, s.department_id, d.name AS department, s.status,
  s.reviewer_employee_id, ${PERSON("r", "rd")} AS reviewer, s.reviewer_role_code::text AS reviewer_role_code,
  (SELECT ro.name FROM role ro WHERE ro.code = s.reviewer_role_code) AS reviewer_role,
  s.dotted_employee_id, ${PERSON("dm", "dd")} AS dotted,
  s.employee_agreed_at, s.reviewer_agreed_at, s.disagreed_at, trim_scale(s.score_to_date)::text AS score_to_date, s.rating,
  (SELECT count(*)::int FROM employee_target t WHERE t.scorecard_id = s.scorecard_id) AS line_count,
  s.created_at, s.updated_at, s.scope_text, s.reviewer_reason, s.disagree_reason,
  s.results_weight, s.kpis_weight, s.accountability_weight, p.status AS period_status, p.starts_on AS period_starts_on,
  p.ends_on AS period_ends_on`;

const FROM = `FROM scorecard s
  JOIN performance_period p ON p.performance_period_id = s.performance_period_id
  JOIN employee e ON e.employee_id = s.employee_id
  LEFT JOIN department ed ON ed.department_id = e.department_id
  LEFT JOIN department d ON d.department_id = s.department_id
  LEFT JOIN employee r ON r.employee_id = s.reviewer_employee_id
  LEFT JOIN department rd ON rd.department_id = r.department_id
  LEFT JOIN employee dm ON dm.employee_id = s.dotted_employee_id
  LEFT JOIN department dd ON dd.department_id = dm.department_id`;

const SORTS = {
  employee: "e.first_name, e.last_name",
  score_to_date: "s.score_to_date",
};

/**
 * One page of scorecards: those in the reader's scope, and those that name the reader as
 * reviewer or dotted manager.
 */
function list(db, query, scope) {
  const params = [
    query.period_id || null,
    query.department_id || null,
    query.status || null,
    query.reviewer_id || null,
    query.rating || null,
    query.q || null,
  ];
  const s = scopeClause(scope, { column: "s.employee_id" }, params);
  let who = "";
  if (s.and) {
    // A scope with a limit also lets through the scorecards that name the reader.
    params.push(scope.employee_id || null);
    const n = params.length;
    who = `AND (${s.and.slice(4)} OR s.reviewer_employee_id = $${n}::uuid OR s.dotted_employee_id = $${n}::uuid)`;
  }
  return pageQuery(
    db,
    `SELECT ${ROW}, ${TOTAL_COL} ${FROM}
      WHERE ($1::uuid IS NULL OR s.performance_period_id = $1)
        AND ($2::uuid IS NULL OR s.department_id = $2)
        AND ($3::text IS NULL OR s.status = $3)
        AND ($4::uuid IS NULL OR s.reviewer_employee_id = $4)
        AND ($5::text IS NULL OR s.rating = $5)
        AND ($6::text IS NULL OR search_fold(e.first_name || ' ' || e.last_name) LIKE '%' || search_fold($6) || '%')
        ${who}
      ORDER BY ${orderBy(query, SORTS, "s.scorecard_id")}`,
    params,
    query,
  );
}

const get = (db, id) => one(db, `SELECT ${ROW} ${FROM} WHERE s.scorecard_id = $1`, [id]);

const ofPerson = (db, periodId, employeeId) =>
  one(db, `SELECT ${ROW} ${FROM} WHERE s.performance_period_id = $1 AND s.employee_id = $2`, [periodId, employeeId]);

/** Every scorecard of a function's people in a quarter (a plan binds them together). */
async function ofDepartment(db, periodId, departmentId) {
  // pagination:complete a plan binds every scorecard of its function at once; a function holds a few dozen people
  const { rows } = await completeQuery(
    db,
    `SELECT ${ROW} ${FROM} WHERE s.performance_period_id = $1 AND s.department_id = $2
      ORDER BY e.first_name, e.last_name, s.scorecard_id`,
    [periodId, departmentId],
    { label: "a function's scorecards" },
  );
  return rows;
}

/** A line, as the contract's ScorecardLine (months and score are added by the service). */
const LINE = `t.employee_target_id, t.scorecard_id, t.section, t.position, t.title, t.measure, t.direction, t.unit,
  trim_scale(t.target_value)::text AS target_value, t.target_text, t.milestone_due_on, t.due_on, t.frequency_text,
  trim_scale(t.weight)::text AS weight, t.source, t.okr_key_result_id,
  CASE WHEN kr.okr_key_result_id IS NULL THEN NULL ELSE json_build_object(
    'okr_key_result_id', kr.okr_key_result_id, 'code', kr.code::text, 'statement', kr.statement) END AS key_result,
  t.kpi_definition_id,
  CASE WHEN k.kpi_definition_id IS NULL THEN NULL ELSE json_build_object(
    'kpi_definition_id', k.kpi_definition_id, 'code', k.code::text, 'name', k.name) END AS kpi,
  COALESCE((SELECT json_agg(json_build_object('okr_key_result_id', tk.okr_key_result_id, 'code', x.code::text,
                                              'statement', x.statement) ORDER BY x.code)
              FROM employee_target_key_result tk JOIN okr_key_result x ON x.okr_key_result_id = tk.okr_key_result_id
             WHERE tk.employee_target_id = t.employee_target_id), '[]'::json) AS team_key_results,
  trim_scale(t.share_value)::text AS share_value, kr.okr_objective_id AS key_result_objective_id`;

async function lines(db, scorecardId) {
  // pagination:complete a scorecard is read whole: its sections must add up
  const { rows } = await completeQuery(
    db,
    `SELECT ${LINE}
       FROM employee_target t
       LEFT JOIN okr_key_result kr ON kr.okr_key_result_id = t.okr_key_result_id
       LEFT JOIN kpi_definition k ON k.kpi_definition_id = t.kpi_definition_id
      WHERE t.scorecard_id = $1
      ORDER BY CASE t.section WHEN 'results' THEN 0 WHEN 'kpis' THEN 1 ELSE 2 END, t.position, t.employee_target_id`,
    [scorecardId],
    { label: "a scorecard's lines", ceiling: 200 },
  );
  return rows;
}

/** Each line's monthly scores so far, from the reviews' items (written from PR 3 on). */
async function lineMonths(db, scorecardId) {
  // pagination:complete one row per line per month of a quarter
  const { rows } = await completeQuery(
    db,
    `SELECT i.employee_target_id, c.month, trim_scale(i.score)::text AS score
       FROM performance_review_item i
       JOIN performance_review r ON r.performance_review_id = i.performance_review_id
       JOIN performance_cycle c ON c.performance_cycle_id = r.performance_cycle_id
      WHERE r.scorecard_id = $1 AND i.employee_target_id IS NOT NULL AND c.month IS NOT NULL
      ORDER BY c.month, i.employee_target_id`,
    [scorecardId],
    { label: "a scorecard's months", ceiling: 1000 },
  );
  return rows;
}

const SCORECARD_WRITABLE = [
  "performance_period_id", "employee_id", "department_id", "scope_text", "reviewer_employee_id",
  "reviewer_role_code", "reviewer_reason", "dotted_employee_id", "status", "employee_agreed_at",
  "reviewer_agreed_at", "disagreed_at", "disagree_reason", "results_weight", "kpis_weight", "accountability_weight",
];

async function insert(client, row) {
  const keys = SCORECARD_WRITABLE.filter((k) => row[k] !== undefined);
  const { rows } = await client.query(
    `INSERT INTO scorecard (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})
     RETURNING scorecard_id`,
    keys.map((k) => row[k]),
  );
  return rows[0].scorecard_id;
}

async function update(client, id, patch) {
  const keys = SCORECARD_WRITABLE.filter((k) => patch[k] !== undefined && !["performance_period_id", "employee_id"].includes(k));
  if (!keys.length) return;
  await client.query(
    `UPDATE scorecard SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE scorecard_id = $1`,
    [id, ...keys.map((k) => patch[k])],
  );
}

const LINE_WRITABLE = [
  "scorecard_id", "employee_id", "section", "position", "title", "measure", "direction", "unit", "target_value",
  "target_text", "milestone_due_on", "due_on", "frequency_text", "weight", "source", "okr_key_result_id",
  "kpi_definition_id", "share_value", "status",
];

async function insertLine(client, row) {
  const keys = LINE_WRITABLE.filter((k) => row[k] !== undefined);
  const { rows } = await client.query(
    `INSERT INTO employee_target (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})
     RETURNING employee_target_id`,
    keys.map((k) => row[k]),
  );
  return rows[0].employee_target_id;
}

async function updateLine(client, id, row) {
  const keys = LINE_WRITABLE.filter((k) => row[k] !== undefined && !["scorecard_id", "employee_id"].includes(k));
  if (!keys.length) return;
  await client.query(
    `UPDATE employee_target SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE employee_target_id = $1`,
    [id, ...keys.map((k) => row[k])],
  );
}

/** Remove the lines of a scorecard not in `keep`. */
async function deleteLinesExcept(client, scorecardId, keep) {
  await client.query(
    "DELETE FROM employee_target WHERE scorecard_id = $1 AND NOT (employee_target_id = ANY($2::uuid[]))",
    [scorecardId, keep],
  );
}

/** A scorecard with no lines left, gone with an import that is reverted. */
const remove = (client, id) => client.query("DELETE FROM scorecard WHERE scorecard_id = $1", [id]);

/**
 * Has anything but the import being reverted touched this line's scorecard since the line was
 * written (a person, or a later import), or asked to change its target? Its scorecard's agreement,
 * binding, reviewer and lines are all scorecard events.
 */
const lineInUse = async (db, id, batchId = null) =>
  Boolean(
    await one(
      db,
      `SELECT 1 AS x FROM employee_target t
        WHERE t.employee_target_id = $1
          AND (EXISTS (SELECT 1 FROM target_change c WHERE c.employee_target_id = t.employee_target_id)
            OR EXISTS (SELECT 1 FROM event_log l WHERE l.entity_type = 'scorecard' AND l.entity_id = t.scorecard_id::text
                         AND l.import_batch_id IS DISTINCT FROM $2::uuid AND l.occurred_at > t.created_at))`,
      [id, batchId],
    ),
  );

async function setTeamKeyResults(client, lineId, ids) {
  await client.query("DELETE FROM employee_target_key_result WHERE employee_target_id = $1", [lineId]);
  for (const id of ids)
    await client.query(
      `INSERT INTO employee_target_key_result (employee_target_id, okr_key_result_id) VALUES ($1, $2)
       ON CONFLICT (employee_target_id, okr_key_result_id) DO NOTHING`,
      [lineId, id],
    );
}

/** Every scorecard of a quarter's function moves together when its plan binds. */
async function setStatusOfDepartment(client, periodId, departmentId, from, to) {
  const { rows } = await client.query(
    `UPDATE scorecard SET status = $4
      WHERE performance_period_id = $1 AND department_id IS NOT DISTINCT FROM $2 AND status = $3
      RETURNING scorecard_id, employee_id, reviewer_employee_id`,
    [periodId, departmentId, from, to],
  );
  await client.query(
    `UPDATE employee_target t SET status = 'active'
       FROM scorecard s
      WHERE t.scorecard_id = s.scorecard_id AND s.performance_period_id = $1
        AND s.department_id IS NOT DISTINCT FROM $2 AND t.status = 'draft'`,
    [periodId, departmentId],
  );
  return rows;
}

/**
 * The key results more than one line splits with a share (their Contribution Map): for a plan's
 * key results, or one key result. Each with its target and every share.
 */
const CONTRIBUTION = `SELECT kr.okr_key_result_id, kr.code::text AS code, kr.statement, trim_scale(kr.target_value)::text AS target_value, kr.unit,
            json_agg(json_build_object(
              'employee_target_id', t.employee_target_id, 'scorecard_id', t.scorecard_id,
              'employee', ${PERSON("e", "ed")}, 'share_value', trim_scale(t.share_value)::text)
              ORDER BY e.first_name, e.last_name) AS shares`;
const CONTRIBUTION_FROM = `FROM okr_key_result kr
       JOIN okr_objective o ON o.okr_objective_id = kr.okr_objective_id
       JOIN employee_target t ON t.okr_key_result_id = kr.okr_key_result_id AND t.share_value IS NOT NULL
       JOIN employee e ON e.employee_id = t.employee_id
       LEFT JOIN department ed ON ed.department_id = e.department_id
      WHERE ($1::uuid IS NULL OR o.performance_plan_id = $1) AND ($2::uuid IS NULL OR kr.okr_key_result_id = $2)
        AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM employee_target x WHERE x.scorecard_id = $3 AND x.okr_key_result_id = kr.okr_key_result_id))
      GROUP BY kr.okr_key_result_id
     HAVING count(t.employee_target_id) >= 2`;

/** The split key results of a plan, of one key result, or that one scorecard's lines share. */
async function contributions(db, { planId = null, keyResultId = null, scorecardId = null }) {
  // pagination:complete the contribution check must see every share of a key result to add them up
  const { rows } = await completeQuery(
    db,
    `${CONTRIBUTION} ${CONTRIBUTION_FROM} ORDER BY kr.code, kr.okr_key_result_id`,
    [planId, keyResultId, scorecardId],
    { label: "a plan's split key results" },
  );
  return rows;
}

/** One page of split key results (GET /performance/contributions). */
function contributionsPage(db, query) {
  return pageQuery(
    db,
    `${CONTRIBUTION}, ${TOTAL_COL} ${CONTRIBUTION_FROM} ORDER BY kr.code, kr.okr_key_result_id`,
    [query.plan_id || null, query.key_result_id || null, null],
    query,
  );
}

/** A line with the scorecard and quarter it is on (for a target change). */
const lineWithCard = (db, id) =>
  one(
    db,
    `SELECT t.employee_target_id, t.scorecard_id, t.employee_id, t.title, trim_scale(t.target_value)::text AS target_value,
            t.target_text, s.status AS scorecard_status, s.department_id, s.performance_period_id
       FROM employee_target t JOIN scorecard s ON s.scorecard_id = t.scorecard_id
      WHERE t.employee_target_id = $1`,
    [id],
  );

/** A key result's period (a line may only link to one of its own quarter). */
const keyResultPeriod = (db, id) =>
  one(
    db,
    `SELECT kr.okr_key_result_id, o.performance_period_id, o.department_id
       FROM okr_key_result kr JOIN okr_objective o ON o.okr_objective_id = kr.okr_objective_id
      WHERE kr.okr_key_result_id = $1`,
    [id],
  );

/** Who a person answers to, their dotted manager, department and whether anyone reports to them. */
const personFacts = (db, employeeId) =>
  one(
    db,
    `SELECT e.employee_id, e.department_id, e.dotted_manager_id, e.status, m.manager_id,
            EXISTS (SELECT 1 FROM employee x WHERE x.line_manager_id = e.employee_id AND x.status = 'active') AS manages,
            COALESCE((SELECT u.is_ceo FROM app_user u WHERE u.employee_id = e.employee_id LIMIT 1), false) AS is_ceo
       FROM employee e LEFT JOIN employee_effective_manager m ON m.employee_id = e.employee_id
      WHERE e.employee_id = $1`,
    [employeeId],
  );

/** The scorecard a person had in the quarter before this one. */
const previousOf = (db, employeeId, startsOn) =>
  one(
    db,
    `SELECT s.scorecard_id FROM scorecard s JOIN performance_period p ON p.performance_period_id = s.performance_period_id
      WHERE s.employee_id = $1 AND p.starts_on < $2 ORDER BY p.starts_on DESC LIMIT 1`,
    [employeeId, startsOn],
  );

/** Does a person hold a role (by code)? A role reviewer is any active holder. */
const holdsRole = async (db, employeeId, roleCode) =>
  Boolean(
    await one(
      db,
      `SELECT 1 AS x FROM app_user u JOIN user_role ur ON ur.user_id = u.user_id JOIN role r ON r.role_id = ur.role_id
        WHERE u.employee_id = $1 AND u.status = 'active' AND r.code = $2 LIMIT 1`,
      [employeeId, roleCode],
    ),
  );

/** The active employees who hold a role (a reviewing role's holders, to agree or be told). */
async function roleHolders(db, roleCode) {
  // pagination:complete everyone holding one role: a handful, each asked or told
  const { rows } = await completeQuery(
    db,
    `SELECT DISTINCT u.employee_id FROM app_user u JOIN user_role ur ON ur.user_id = u.user_id JOIN role r ON r.role_id = ur.role_id
      WHERE r.code = $1 AND u.status = 'active' AND u.employee_id IS NOT NULL
      ORDER BY u.employee_id`,
    [roleCode],
    { label: "a role's holders", ceiling: 500 },
  );
  return rows.map((r) => r.employee_id);
}

module.exports = {
  roleHolders,
  contributionsPage,
  list,
  get,
  ofPerson,
  ofDepartment,
  lines,
  lineMonths,
  insert,
  update,
  insertLine,
  updateLine,
  deleteLinesExcept,
  remove,
  lineInUse,
  setTeamKeyResults,
  setStatusOfDepartment,
  contributions,
  lineWithCard,
  keyResultPeriod,
  personFacts,
  previousOf,
  holdsRole,
};
