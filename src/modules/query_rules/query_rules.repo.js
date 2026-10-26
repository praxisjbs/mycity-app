"use strict";
/**
 * Query rules: the SQL (docs/guides/queries.md §4, §6.3). Writes only query_rule;
 * reads the queries a rule raised (its firings). Never emits.
 *
 * A rule's state as a person reads it: draft (never activated), active, or paused.
 */
const { personJson } = require("../../shared/db/person");
const { pageQuery, orderBy, completeQuery, TOTAL_COL } = require("../../shared/http/paged");
const visibility = require("../queries/queries.visibility");

const STATE = `CASE WHEN r.active THEN 'active' WHEN r.activated_at IS NULL THEN 'draft' ELSE 'paused' END`;

/** $1 is the start of this month (a Lagos instant). */
const ROWS = `
  SELECT r.query_rule_id, r.code::text AS code, r.name, r.source_event, r.measure,
         r.threshold::int AS threshold, r.window_days, r.letter_template::text AS letter_template,
         r.policy_id, r.policy_clause,
         ${STATE} AS state, r.active, r.activated_at,
         (SELECT count(*)::int FROM employee_query q WHERE q.query_rule_id = r.query_rule_id AND q.created_at >= $1)
           AS fired_this_month,
         r.created_at, r.updated_at,
         search_fold(r.name || ' ' || r.code) AS haystack
    FROM query_rule r`;

const OUT = `v.query_rule_id, v.code, v.name, v.source_event, v.measure, v.threshold, v.window_days,
  v.letter_template, v.policy_id, v.policy_clause, v.state, v.active, v.activated_at, v.fired_this_month,
  v.created_at, v.updated_at`;

const SORTS = { name: "v.name", created_at: "v.created_at" };

function list(db, query, monthStart) {
  return pageQuery(
    db,
    `SELECT ${OUT}, ${TOTAL_COL}
       FROM (${ROWS}) v
      WHERE ($2::text IS NULL OR v.state = $2)
        AND ($3::text IS NULL OR v.source_event = $3)
        AND ($4::text IS NULL OR v.haystack LIKE '%' || search_fold($4) || '%')
      ORDER BY ${orderBy(query, SORTS, "v.query_rule_id")}`,
    [monthStart, query.state || null, query.source_event || null, query.q || null],
    query,
  );
}

async function get(db, id, monthStart) {
  const { rows } = await db.query(`SELECT ${OUT} FROM (${ROWS}) v WHERE v.query_rule_id = $2`, [monthStart, id]);
  return rows[0] || null;
}

async function codeTaken(db, code) {
  const { rows } = await db.query("SELECT 1 FROM query_rule WHERE code = $1", [code]);
  return rows.length > 0;
}

async function hasFired(db, id) {
  const { rows } = await db.query("SELECT 1 FROM employee_query WHERE query_rule_id = $1", [id]);
  return rows.length > 0;
}

async function isQueryLetter(db, key) {
  const { rows } = await db.query("SELECT 1 FROM letter_template WHERE key = $1 AND purpose = 'query'", [key]);
  return rows.length > 0;
}

async function insert(db, row) {
  const { rows } = await db.query(
    `INSERT INTO query_rule (code, name, source_event, measure, threshold, window_days, letter_template, active, created_by,
                             policy_id, policy_clause)
     VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, $9, $10)
     RETURNING query_rule_id`,
    [
      row.code,
      row.name,
      row.source_event,
      row.measure,
      row.threshold,
      row.window_days,
      row.letter_template || null,
      row.created_by,
      row.policy_id || null,
      row.policy_clause || null,
    ],
  );
  return rows[0].query_rule_id;
}

const FIELDS = ["name", "source_event", "measure", "threshold", "window_days", "letter_template", "policy_id", "policy_clause"];

async function update(db, id, fields) {
  const keys = FIELDS.filter((k) => fields[k] !== undefined);
  if (!keys.length) return;
  await db.query(
    `UPDATE query_rule SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE query_rule_id = $1`,
    [id, ...keys.map((k) => fields[k])],
  );
}

/** Switch a rule on (first activation recorded) or off. */
async function setActive(db, id, on) {
  await db.query(
    `UPDATE query_rule SET active = $2, activated_at = CASE WHEN $2 THEN COALESCE(activated_at, now()) ELSE activated_at END
      WHERE query_rule_id = $1`,
    [id, on],
  );
}

async function summary(db, monthStart) {
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE r.active)::int AS active,
            count(*) FILTER (WHERE NOT r.active AND r.activated_at IS NULL)::int AS draft,
            (SELECT count(*)::int FROM employee_query q WHERE q.query_rule_id IS NOT NULL AND q.created_at >= $1) AS fired_this_month,
            (SELECT count(*)::int FROM employee_query q WHERE q.query_rule_id IS NOT NULL) AS queries_raised
       FROM query_rule r`,
    [monthStart],
  );
  return rows[0];
}

/** Recent Firings: the queries rules raised that the reader may see, newest first. */
function firings(db, query, reader) {
  const params = [query.query_rule_id || null];
  const v = visibility.clause(reader, params, "q.raised_by");
  return pageQuery(
    db,
    `SELECT q.employee_query_id, q.number::text AS number, q.query_rule_id, r.name AS rule_name,
            ${personJson("e", "d")} AS employee,
            q.status, q.created_at, ${TOTAL_COL}
       FROM employee_query q
       JOIN query_rule r ON r.query_rule_id = q.query_rule_id
       JOIN employee e ON e.employee_id = q.employee_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE ($1::uuid IS NULL OR q.query_rule_id = $1) ${v.and}
      ORDER BY q.created_at DESC, q.employee_query_id`,
    params,
    query,
  );
}

/* ------------------------------------------------------------------ *
 * For the evaluator
 * ------------------------------------------------------------------ */

/** The active rules for some triggers. */
async function activeFor(db, sources) {
  // pagination:complete the rules one event can set off: a handful, evaluated, never listed
  const { rows } = await completeQuery(
    db,
    `SELECT query_rule_id, code::text AS code, name, source_event, measure, threshold::int AS threshold,
            window_days, letter_template::text AS letter_template, policy_id, policy_clause, activated_at
       FROM query_rule WHERE active AND source_event = ANY($1::text[])
      ORDER BY created_at, query_rule_id`,
    [sources],
    { label: "active query rules", ceiling: 200 },
  );
  return rows;
}

/** The last breach this rule raised a query for, for this person (YYYY-MM-DD), or null. */
async function lastBreach(db, ruleId, employeeId) {
  const { rows } = await db.query(
    `SELECT max(split_part(dedup_key, ':', 3))::text AS day
       FROM employee_query WHERE query_rule_id = $1 AND employee_id = $2 AND dedup_key IS NOT NULL`,
    [ruleId, employeeId],
  );
  return rows[0] ? rows[0].day : null;
}

/** One rule and one person at a time: two events of the same day never count twice. */
async function lockPerson(db, ruleId, employeeId) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext('query_rule:' || $1 || ':' || $2))", [ruleId, employeeId]);
}

module.exports = {
  list,
  get,
  codeTaken,
  hasFired,
  isQueryLetter,
  insert,
  update,
  setActive,
  summary,
  firings,
  activeFor,
  lastBreach,
  lockPerson,
};
