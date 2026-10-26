"use strict";
/**
 * Queries: the SQL (docs/guides/queries.md §4). Writes only employee_query and
 * query_response; reads the sanction a query led to. Never emits (BACKEND_GUIDE §2).
 * Every list goes through the visibility clause (queries.visibility.js).
 */
const { personJson } = require("../../shared/db/person");
const { pageQuery, orderBy, completeQuery, TOTAL_COL } = require("../../shared/http/paged");
const visibility = require("./queries.visibility");

const NAME = (alias) => `btrim(${alias}.first_name || ' ' || ${alias}.last_name)`;

/**
 * Every query with what a screen needs, and the columns filters and visibility read.
 * `sanction` is the latest sanction on the query, read with an aggregate because these
 * rows are paged and shared/http/paged.js alone may bound a query.
 */
const ROWS = `
  SELECT q.employee_query_id, q.number::text AS number,
         ${personJson("e", "d")} AS employee,
         q.employee_id, q.subject, q.details, q.evidence,
         q.raised_by, ${NAME("re")} AS raised_by_name,
         q.query_rule_id, r.name AS rule_name,
         q.status, q.outcome,
         EXISTS (SELECT 1 FROM sanction s WHERE s.employee_query_id = q.employee_query_id
                  AND s.status = 'pending_approval') AS escalated,
         q.response_due_at, q.responded_at, q.reminded_at,
         q.letter_document_id, q.workflow_instance_id,
         ${NAME("ve")} AS reviewed_by_name, q.reviewed_at,
         CASE WHEN qr.query_response_id IS NULL THEN NULL
              ELSE json_build_object('body', qr.body, 'submitted_at', qr.submitted_at) END AS response,
         (SELECT (array_agg(json_build_object(
                   'sanction_id', s.sanction_id, 'number', s.number::text,
                   'step_name', COALESCE(cs.name, s.sanction_type), 'status', s.status)
                   ORDER BY s.created_at DESC, s.sanction_id DESC))[1]
            FROM sanction s LEFT JOIN consequence_step cs ON cs.consequence_step_id = s.consequence_step_id
           WHERE s.employee_query_id = q.employee_query_id) AS sanction,
         q.created_at,
         search_fold(q.number || ' ' || e.first_name || ' ' || e.last_name || ' ' || q.subject) AS haystack
    FROM employee_query q
    JOIN employee e ON e.employee_id = q.employee_id
    LEFT JOIN department d ON d.department_id = e.department_id
    LEFT JOIN query_rule r ON r.query_rule_id = q.query_rule_id
    LEFT JOIN app_user ru ON ru.user_id = q.raised_by
    LEFT JOIN employee re ON re.employee_id = ru.employee_id
    LEFT JOIN app_user vu ON vu.user_id = q.reviewed_by
    LEFT JOIN employee ve ON ve.employee_id = vu.employee_id
    LEFT JOIN query_response qr ON qr.employee_query_id = q.employee_query_id`;

/** The keys of Query. */
const LIST_OUT = `v.employee_query_id, v.number, v.employee, v.subject, v.raised_by, v.raised_by_name,
  v.query_rule_id, v.rule_name, v.status, v.outcome, v.escalated, v.response_due_at, v.responded_at,
  v.created_at`;

/** Everything get() hands the service: QueryDetail's keys and the ids the checks need. */
const DETAIL_OUT = `${LIST_OUT}, v.employee_id, v.details, v.evidence, v.response, v.letter_document_id,
  v.reminded_at, v.reviewed_by_name, v.reviewed_at, v.workflow_instance_id, v.sanction`;

const SORTS = {
  created_at: "v.created_at",
  number: "v.number",
  response_due_at: "v.response_due_at",
};

/**
 * One page of queries the reader may see.
 * @param {{status?: string, employee_id?: string, raised?: "mine"|"rules", q?: string,
 *          page?: number, sort?: object}} query
 * @param {{all: boolean, user_id: string}} reader
 */
function list(db, query, reader) {
  const params = [
    query.status || null,
    query.employee_id || null,
    query.raised === "mine" ? reader.user_id : null,
    query.raised === "rules",
    query.q || null,
  ];
  const v = visibility.clause(reader, params, "v.raised_by");
  return pageQuery(
    db,
    `SELECT ${LIST_OUT}, ${TOTAL_COL}
       FROM (${ROWS}) v
      WHERE ($1::text IS NULL OR v.status = $1)
        AND ($2::uuid IS NULL OR v.employee_id = $2)
        AND ($3::uuid IS NULL OR v.raised_by = $3)
        AND (NOT $4::boolean OR v.query_rule_id IS NOT NULL)
        AND ($5::text IS NULL OR v.haystack LIKE '%' || search_fold($5) || '%')
        ${v.and}
      ORDER BY ${orderBy(query, SORTS, "v.employee_query_id")}`,
    params,
    query,
  );
}

/** One query, or null. Not filtered: the service checks visibility. */
async function get(db, id) {
  const { rows } = await db.query(`SELECT ${DETAIL_OUT} FROM (${ROWS}) v WHERE v.employee_query_id = $1`, [id]);
  return rows[0] || null;
}

/** Lock one query for a change. */
async function lock(db, id) {
  const { rows } = await db.query(
    "SELECT employee_query_id, employee_id, raised_by, status FROM employee_query WHERE employee_query_id = $1 FOR UPDATE",
    [id],
  );
  return rows[0] || null;
}

/**
 * Insert a query. A rule's breach carries `dedup_key`: a second insert with the same key
 * is a no-op and returns null (the outbox delivers at least once).
 */
async function insert(db, row) {
  const { rows } = await db.query(
    `INSERT INTO employee_query
       (number, employee_id, query_rule_id, raised_by, subject, details, evidence, status, response_due_at, dedup_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'awaiting_response', $8, $9)
     ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
     RETURNING employee_query_id`,
    [
      row.number,
      row.employee_id,
      row.query_rule_id || null,
      row.raised_by || null,
      row.subject,
      row.details,
      JSON.stringify(row.evidence || []),
      row.response_due_at,
      row.dedup_key || null,
    ],
  );
  return rows[0] ? rows[0].employee_query_id : null;
}

/** Whether a rule's breach already raised its query. */
async function dedupTaken(db, key) {
  const { rows } = await db.query("SELECT 1 FROM employee_query WHERE dedup_key = $1", [key]);
  return rows.length > 0;
}

async function setLetter(db, id, documentId) {
  await db.query("UPDATE employee_query SET letter_document_id = $2 WHERE employee_query_id = $1", [id, documentId]);
}

async function setReminded(db, id) {
  await db.query("UPDATE employee_query SET reminded_at = now() WHERE employee_query_id = $1", [id]);
}

/** Resolve a query still open. Returns false when it was already resolved. */
async function resolve(db, id, { outcome, reviewed_by }) {
  const { rowCount } = await db.query(
    `UPDATE employee_query
        SET status = 'resolved', outcome = $2, reviewed_by = $3, reviewed_at = now()
      WHERE employee_query_id = $1 AND status <> 'resolved'`,
    [id, outcome, reviewed_by],
  );
  return rowCount === 1;
}

/** Back to Under Review, with the approval it waits on (or none). */
async function setReview(db, id, workflowInstanceId) {
  await db.query(
    "UPDATE employee_query SET status = 'under_review', workflow_instance_id = $2 WHERE employee_query_id = $1 AND status <> 'resolved'",
    [id, workflowInstanceId],
  );
}

/** The employee's response: one a query, never updated (the UNIQUE key refuses a second). */
async function insertResponse(db, { employee_query_id, employee_id, body }) {
  const { rows } = await db.query(
    `INSERT INTO query_response (employee_query_id, employee_id, body)
     VALUES ($1, $2, $3)
     ON CONFLICT (employee_query_id, employee_id) DO NOTHING
     RETURNING query_response_id, submitted_at`,
    [employee_query_id, employee_id, body],
  );
  if (!rows[0]) return null;
  await db.query(
    `UPDATE employee_query SET status = 'under_review', responded_at = $2
      WHERE employee_query_id = $1 AND status = 'awaiting_response'`,
    [employee_query_id, rows[0].submitted_at],
  );
  return rows[0];
}

/** The figures above the list, within the reader's visibility. `monthStart` is a Lagos instant. */
async function summary(db, reader, monthStart) {
  const params = [monthStart];
  const v = visibility.clause(reader, params, "q.raised_by");
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE q.status <> 'resolved')::int AS open,
            count(*) FILTER (WHERE q.status = 'awaiting_response')::int AS awaiting_response,
            count(*) FILTER (WHERE q.status = 'resolved' AND q.reviewed_at >= $1)::int AS closed_this_month,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM sanction s WHERE s.employee_query_id = q.employee_query_id
                                            AND s.status = 'pending_approval'))::int AS escalated
       FROM employee_query q
      WHERE true ${v.and}`,
    params,
  );
  // Queries by Reason this month: the rule that raised them, or a person. One bar per rule.
  // pagination:complete a chart's bars, one per rule, never listed; past 24 they fold into Other
  const reasons = await completeQuery(
    db,
    `SELECT COALESCE(r.name, 'Raised by a Person') AS label, count(*)::int AS count
       FROM employee_query q LEFT JOIN query_rule r ON r.query_rule_id = q.query_rule_id
      WHERE q.created_at >= $1 ${v.and}
      GROUP BY 1 ORDER BY 2 DESC, 1`,
    params,
    { label: "queries by reason" },
  );
  const bars = reasons.rows.slice(0, 24);
  const rest = reasons.rows.slice(24).reduce((n, r) => n + r.count, 0);
  if (rest) bars.push({ label: "Other", count: rest });
  return { ...rows[0], by_reason: bars };
}

/** ESS · My Queries: the caller's own, open (not resolved) or archived (resolved). */
function listMine(db, employeeId, query) {
  return pageQuery(
    db,
    `SELECT v.employee_query_id, v.number, v.subject, v.details, v.status, v.outcome, v.response_due_at,
            v.response, v.letter_document_id, v.sanction,
            (v.status = 'awaiting_response' AND v.response IS NULL) AS can_respond,
            v.created_at, ${TOTAL_COL}
       FROM (${ROWS}) v
      WHERE v.employee_id = $1
        AND ($2::text IS NULL
             OR ($2 = 'open' AND v.status <> 'resolved')
             OR ($2 = 'archived' AND v.status = 'resolved'))
      ORDER BY (v.status = 'resolved'), v.created_at DESC, v.employee_query_id`,
    [employeeId, query.status || null],
    query,
  );
}

/** The caller's own queries, counted for My Queries: open (not resolved) and archived. */
async function mineSummary(db, employeeId) {
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE status <> 'resolved')::int AS open,
            count(*) FILTER (WHERE status = 'resolved')::int AS archived
       FROM employee_query WHERE employee_id = $1`,
    [employeeId],
  );
  return rows[0];
}

/** One of the caller's own queries, in MyQuery's shape. */
async function getMine(db, employeeId, id) {
  const { rows } = await db.query(
    `SELECT v.employee_query_id, v.number, v.subject, v.details, v.status, v.outcome, v.response_due_at,
            v.response, v.letter_document_id, v.sanction,
            (v.status = 'awaiting_response' AND v.response IS NULL) AS can_respond, v.created_at
       FROM (${ROWS}) v WHERE v.employee_query_id = $1 AND v.employee_id = $2`,
    [id, employeeId],
  );
  return rows[0] || null;
}

/** The person a query is about, as a letter and a check need them. */
async function employeeOf(db, employeeId) {
  const { rows } = await db.query(
    `SELECT e.employee_id, e.status, e.first_name, COALESCE(e.preferred_name, e.first_name) AS called,
            ${NAME("e")} AS display_name, e.job_title, d.name AS department, e.work_email::text AS work_email
       FROM employee e LEFT JOIN department d ON d.department_id = e.department_id
      WHERE e.employee_id = $1`,
    [employeeId],
  );
  return rows[0] || null;
}

module.exports = {
  list,
  get,
  lock,
  insert,
  dedupTaken,
  setLetter,
  setReminded,
  resolve,
  setReview,
  insertResponse,
  summary,
  listMine,
  mineSummary,
  getMine,
  employeeOf,
};
