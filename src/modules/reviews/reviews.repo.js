"use strict";
/**
 * Reviews: the SQL for performance_cycle and its questions, performance_review and its KPI
 * ratings and answers (docs/guides/performance.md §4). Lists honour the `performance` scope on
 * the person reviewed.
 */
const { pageQuery, completeQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");
const { personJson } = require("../../shared/db/person");
const { COUNTED } = require("../kpis/kpis.score");

/* ------------------------------------------------------------------ *
 * Cycles
 * ------------------------------------------------------------------ */

const CYCLE_SELECT = `c.performance_cycle_id, c.name, c.starts_on, c.ends_on, c.status, c.self_review_opens_at,
  c.closes_at, c.created_at,
  (SELECT count(*)::int FROM performance_review r WHERE r.performance_cycle_id = c.performance_cycle_id AND r.review_type <> 'self') AS reviews,
  (SELECT count(*)::int FROM performance_review r WHERE r.performance_cycle_id = c.performance_cycle_id AND r.review_type <> 'self' AND r.status = 'closed') AS closed_reviews`;

const CYCLE_SORTS = { starts_on: "c.starts_on", name: "c.name" };

function listCycles(client, query) {
  return pageQuery(
    client,
    `SELECT ${CYCLE_SELECT}, ${TOTAL_COL}
       FROM performance_cycle c
      WHERE ($1::text IS NULL OR c.status = $1)
        AND ($2::text IS NULL OR search_fold(c.name) LIKE '%' || search_fold($2) || '%')
      ORDER BY ${orderBy(query, CYCLE_SORTS, "c.performance_cycle_id")}`,
    [query.status || null, query.q || null],
    query,
  );
}

async function getCycle(client, id, { lock = false } = {}) {
  const { rows } = await client.query(
    `SELECT ${CYCLE_SELECT} FROM performance_cycle c WHERE c.performance_cycle_id = $1${lock ? " FOR UPDATE OF c" : ""}`,
    [id],
  );
  return rows[0] || null;
}

/** The cycle Reviews shows: the open one, else the latest. */
async function currentCycle(client) {
  const { rows } = await client.query(
    `SELECT c.performance_cycle_id FROM performance_cycle c
      ORDER BY (c.status = 'open') DESC, (c.status = 'scheduled') DESC, c.starts_on DESC, c.performance_cycle_id
      LIMIT 1`,
  );
  return rows[0] ? getCycle(client, rows[0].performance_cycle_id) : null;
}

async function questions(client, cycleId) {
  // pagination:complete a cycle's questions, at most 12
  const { rows } = await completeQuery(
    client,
    `SELECT performance_cycle_question_id, position, prompt FROM performance_cycle_question
      WHERE performance_cycle_id = $1 ORDER BY position`,
    [cycleId],
    { label: "a cycle's questions" },
  );
  return rows;
}

/** The questions of the cycle before this one, to copy. */
async function lastQuestions(client) {
  const { rows } = await client.query(
    `SELECT performance_cycle_id FROM performance_cycle c
      WHERE EXISTS (SELECT 1 FROM performance_cycle_question q WHERE q.performance_cycle_id = c.performance_cycle_id)
      ORDER BY c.starts_on DESC, c.created_at DESC LIMIT 1`,
  );
  return rows[0] ? (await questions(client, rows[0].performance_cycle_id)).map((q) => q.prompt) : [];
}

async function insertCycle(client, v) {
  const { rows } = await client.query(
    `INSERT INTO performance_cycle (name, starts_on, ends_on, status, self_review_opens_at, manager_review_opens_at, closes_at, opened_by)
     VALUES ($1, $2::date, $3::date, $4, $5, $5, $6, $7)
     RETURNING performance_cycle_id`,
    [v.name, v.starts_on, v.ends_on, v.status, v.opens_at, v.closes_at, v.opened_by],
  );
  const id = rows[0].performance_cycle_id;
  for (const [i, prompt] of v.questions.entries()) {
    await client.query(
      `INSERT INTO performance_cycle_question (performance_cycle_id, position, prompt) VALUES ($1, $2, $3)
       ON CONFLICT (performance_cycle_id, position) DO NOTHING`,
      [id, i + 1, prompt],
    );
  }
  return id;
}

async function setCycleStatus(client, id, status) {
  await client.query("UPDATE performance_cycle SET status = $2 WHERE performance_cycle_id = $1", [id, status]);
}

/** Scheduled cycles whose day has come. */
async function cyclesDue(client, now) {
  // pagination:complete cycles due to open today, one or two
  const { rows } = await completeQuery(
    client,
    `SELECT performance_cycle_id FROM performance_cycle
      WHERE status = 'scheduled' AND self_review_opens_at <= $1 ORDER BY self_review_opens_at, performance_cycle_id`,
    [now],
    { label: "cycles due" },
  );
  return rows.map((r) => r.performance_cycle_id);
}

/**
 * Who a cycle reviews and who reviews them: every employee active on the opening day, with
 * their line manager that day (or the first person above a vacant seat). `manager_id` null
 * means nobody: the CEO reviews them, unless they are the CEO.
 */
async function roster(client, opensOn) {
  // pagination:complete the staff a cycle reviews: every active employee, once a cycle
  const { rows } = await completeQuery(
    client,
    `SELECT e.employee_id, m.manager_id,
            EXISTS (SELECT 1 FROM app_user u WHERE u.employee_id = e.employee_id AND u.is_ceo) AS is_ceo
       FROM employee e
       LEFT JOIN employee_effective_manager m ON m.employee_id = e.employee_id
      WHERE e.status = 'active' AND (e.start_date IS NULL OR e.start_date <= $1::date)
      ORDER BY e.employee_id`,
    [opensOn],
    { label: "a cycle's staff", ceiling: 5000 },
  );
  return rows;
}

async function ceoEmployee(client) {
  const { rows } = await client.query(
    "SELECT employee_id FROM app_user WHERE is_ceo AND employee_id IS NOT NULL AND status = 'active' ORDER BY created_at LIMIT 1",
  );
  return rows[0] ? rows[0].employee_id : null;
}

/** Make a review once; its KPI rows are the person's counted KPIs whose month falls in the period. */
async function ensureReview(client, { cycleId, employeeId, reviewerId, type, from, to }) {
  const { rows } = await client.query(
    `INSERT INTO performance_review (performance_cycle_id, employee_id, reviewer_employee_id, review_type, status)
     VALUES ($1, $2, $3, $4, 'draft')
     ON CONFLICT (performance_cycle_id, employee_id, reviewer_employee_id, review_type) DO NOTHING
     RETURNING performance_review_id`,
    [cycleId, employeeId, reviewerId, type],
  );
  if (!rows[0]) return null;
  await client.query(
    `INSERT INTO performance_review_item (performance_review_id, employee_target_id)
     SELECT $1, t.employee_target_id FROM employee_target t
      WHERE t.employee_id = $2 AND t.month BETWEEN $3::date AND $4::date AND t.status = ANY($5::text[])
     ON CONFLICT DO NOTHING`,
    [rows[0].performance_review_id, employeeId, from, to, COUNTED],
  );
  return rows[0].performance_review_id;
}

/* ------------------------------------------------------------------ *
 * Reviews
 * ------------------------------------------------------------------ */

const REVIEW_SELECT = `r.performance_review_id, r.performance_cycle_id, c.name AS cycle, r.employee_id, r.reviewer_employee_id,
  ${personJson("e", "d")} AS employee, ${personJson("rv", "rd")} AS reviewer, r.review_type, r.status,
  r.overall_score::float8 AS overall_score, r.summary, r.submitted_at, r.closed_at, r.workflow_instance_id,
  r.document_id, c.closes_at, c.starts_on, c.ends_on`;

const REVIEW_FROM = `FROM performance_review r
  JOIN performance_cycle c ON c.performance_cycle_id = r.performance_cycle_id
  JOIN employee e ON e.employee_id = r.employee_id
  LEFT JOIN department d ON d.department_id = e.department_id
  JOIN employee rv ON rv.employee_id = r.reviewer_employee_id
  LEFT JOIN department rd ON rd.department_id = rv.department_id`;

const REVIEW_SORTS = {
  employee: "e.last_name || ' ' || e.first_name",
  closes_at: "c.closes_at",
  status: "r.status",
};

/**
 * One page of reviews: one row per person per cycle, the manager review where there is one
 * (the CEO, who has none, by their self review), with the self review's rating beside it.
 */
function listReviews(client, query, scope) {
  const params = [query.performance_cycle_id || null, query.status || null, query.review_type || null, query.q || null];
  const s = scopeClause(scope, { column: "r.employee_id" }, params);
  return pageQuery(
    client,
    `SELECT ${REVIEW_SELECT},
            (SELECT sr.overall_score::float8 FROM performance_review sr
              WHERE sr.performance_cycle_id = r.performance_cycle_id AND sr.employee_id = r.employee_id
                AND sr.review_type = 'self' AND sr.submitted_at IS NOT NULL) AS self_rating,
            (SELECT wi.current_stage FROM workflow_instance wi
              WHERE wi.workflow_instance_id = r.workflow_instance_id AND wi.state = 'pending') AS current_stage,
            ${TOTAL_COL}
       ${REVIEW_FROM}
      WHERE ($1::uuid IS NULL OR r.performance_cycle_id = $1::uuid)
        AND ($2::text IS NULL OR r.status = $2)
        AND (($3::text IS NULL AND (r.review_type <> 'self' OR NOT EXISTS (
               SELECT 1 FROM performance_review mr WHERE mr.performance_cycle_id = r.performance_cycle_id
                  AND mr.employee_id = r.employee_id AND mr.review_type <> 'self')))
             OR r.review_type = $3)
        AND ($4::text IS NULL OR search_fold(e.first_name || ' ' || e.last_name) LIKE '%' || search_fold($4) || '%')
        ${s.and}
      ORDER BY ${orderBy(query, REVIEW_SORTS, "r.performance_review_id")}`,
    params,
    query,
  );
}

async function getReview(client, id, { lock = false } = {}) {
  const { rows } = await client.query(
    `SELECT ${REVIEW_SELECT} ${REVIEW_FROM} WHERE r.performance_review_id = $1${lock ? " FOR UPDATE OF r" : ""}`,
    [id],
  );
  return rows[0] || null;
}

/** The other half of a review: the self review beside a manager review, and back. */
async function counterpart(client, review) {
  const { rows } = await client.query(
    `SELECT r.performance_review_id FROM performance_review r
      WHERE r.performance_cycle_id = $1 AND r.employee_id = $2
        AND (CASE WHEN $3 = 'self' THEN r.review_type <> 'self' ELSE r.review_type = 'self' END)
      ORDER BY r.created_at LIMIT 1`,
    [review.performance_cycle_id, review.employee_id, review.review_type],
  );
  return rows[0] ? getReview(client, rows[0].performance_review_id) : null;
}

/** The open self review of a person, newest cycle first. */
async function openSelfReview(client, employeeId) {
  const { rows } = await client.query(
    `SELECT r.performance_review_id FROM performance_review r
       JOIN performance_cycle c ON c.performance_cycle_id = r.performance_cycle_id
      WHERE r.employee_id = $1 AND r.review_type = 'self' AND c.status = 'open' AND r.submitted_at IS NULL
      ORDER BY c.starts_on DESC, r.performance_review_id LIMIT 1`,
    [employeeId],
  );
  return rows[0] ? rows[0].performance_review_id : null;
}

/** A review's KPI rows with the KPI's figures. At most 20 KPIs a month over a short period. */
async function items(client, reviewId) {
  // pagination:complete one review's KPI ratings
  const { rows } = await completeQuery(
    client,
    `SELECT i.employee_target_id, t.title, t.weight::text AS weight, trim_scale(t.target_value)::text AS target_value,
            trim_scale(t.actual_value)::text AS actual_value, t.direction, t.status AS kpi_status,
            to_char(t.month, 'YYYY-MM') AS month, i.score::int AS score, i.comment
       FROM performance_review_item i JOIN employee_target t ON t.employee_target_id = i.employee_target_id
      WHERE i.performance_review_id = $1
      ORDER BY t.month, t.weight DESC, t.title, i.employee_target_id`,
    [reviewId],
    { label: "a review's KPIs", ceiling: 200 },
  );
  return rows;
}

/** A review's answers, one per question of its cycle, unanswered ones included. */
async function answers(client, review) {
  // pagination:complete one review's answers, a cycle's questions
  const { rows } = await completeQuery(
    client,
    `SELECT q.performance_cycle_question_id, q.prompt, a.answer_text, a.dictation_document_id, a.transcript, a.ai_run_id
       FROM performance_cycle_question q
       LEFT JOIN performance_review_answer a
         ON a.performance_cycle_question_id = q.performance_cycle_question_id AND a.performance_review_id = $2
      WHERE q.performance_cycle_id = $1
      ORDER BY q.position`,
    [review.performance_cycle_id, review.performance_review_id],
    { label: "a review's answers" },
  );
  return rows;
}

async function saveHeader(client, id, { overall_score: overall, summary }) {
  await client.query(
    `UPDATE performance_review
        SET overall_score = CASE WHEN $2::boolean THEN $3::numeric ELSE overall_score END,
            summary = CASE WHEN $4::boolean THEN $5 ELSE summary END
      WHERE performance_review_id = $1`,
    [id, overall !== undefined, overall === undefined ? null : overall, summary !== undefined, summary === undefined ? null : summary],
  );
}

async function saveItem(client, reviewId, { employee_target_id: kpiId, score, comment }) {
  const { rowCount } = await client.query(
    `UPDATE performance_review_item SET score = $3, comment = $4
      WHERE performance_review_id = $1 AND employee_target_id = $2`,
    [reviewId, kpiId, score, comment],
  );
  return rowCount;
}

/** Write an answer's text; a dictation is kept only when the save names it. */
async function saveAnswer(client, reviewId, { performance_cycle_question_id: qid, answer_text: text, dictation_id: dictationId }) {
  await client.query(
    `INSERT INTO performance_review_answer (performance_review_id, performance_cycle_question_id, answer_text)
     VALUES ($1, $2, $3)
     ON CONFLICT (performance_review_id, performance_cycle_question_id) DO UPDATE
       SET answer_text = EXCLUDED.answer_text,
           dictation_document_id = CASE WHEN performance_review_answer.dictation_document_id = $4::uuid
                                        THEN performance_review_answer.dictation_document_id END,
           transcript = CASE WHEN performance_review_answer.dictation_document_id = $4::uuid
                             THEN performance_review_answer.transcript END,
           ai_run_id = CASE WHEN performance_review_answer.dictation_document_id = $4::uuid
                            THEN performance_review_answer.ai_run_id END`,
    [reviewId, qid, text, dictationId || null],
  );
}

/** Keep a dictation against an answer without touching its text (A18). */
async function keepDictation(client, reviewId, qid, { documentId, transcript, aiRunId }) {
  await client.query(
    `INSERT INTO performance_review_answer (performance_review_id, performance_cycle_question_id, dictation_document_id, transcript, ai_run_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (performance_review_id, performance_cycle_question_id) DO UPDATE
       SET dictation_document_id = EXCLUDED.dictation_document_id, transcript = EXCLUDED.transcript, ai_run_id = EXCLUDED.ai_run_id`,
    [reviewId, qid, documentId, transcript, aiRunId],
  );
}

async function setReview(client, id, { status, submitted, closed, workflowInstanceId, documentId }) {
  await client.query(
    `UPDATE performance_review
        SET status = COALESCE($2, status),
            submitted_at = CASE WHEN $3 THEN now() ELSE submitted_at END,
            closed_at = CASE WHEN $4 THEN now() ELSE closed_at END,
            workflow_instance_id = COALESCE($5, workflow_instance_id),
            document_id = COALESCE($6, document_id)
      WHERE performance_review_id = $1`,
    [id, status || null, Boolean(submitted), Boolean(closed), workflowInstanceId || null, documentId || null],
  );
}

/** Figures for Reviews' cards over a cycle, within the scope. */
async function cycleFigures(client, cycleId, scope) {
  const params = [cycleId];
  const s = scopeClause(scope, { column: "r.employee_id" }, params);
  const { rows } = await client.query(
    `SELECT count(*) FILTER (WHERE r.review_type = 'self')::int AS total,
            count(*) FILTER (WHERE r.review_type = 'self' AND r.submitted_at IS NOT NULL)::int AS self_done,
            count(*) FILTER (WHERE r.review_type <> 'self' AND r.submitted_at IS NOT NULL)::int AS manager_done,
            count(*) FILTER (WHERE r.review_type <> 'self' AND r.status = 'closed')::int AS closed,
            avg(r.overall_score) FILTER (WHERE r.review_type <> 'self' AND r.status = 'closed')::float8 AS average_rating
       FROM performance_review r WHERE r.performance_cycle_id = $1 ${s.and}`,
    params,
  );
  return rows[0];
}

/** Reviews due within a window or overdue, not yet submitted, for the reminders. */
async function dueReviews(client, until) {
  // pagination:complete one reminder per open review a day, the staff of open cycles
  const { rows } = await completeQuery(
    client,
    `SELECT r.performance_review_id, r.reviewer_employee_id, r.review_type, c.name AS cycle, c.closes_at,
            btrim(e.first_name || ' ' || e.last_name) AS employee_name
       FROM performance_review r
       JOIN performance_cycle c ON c.performance_cycle_id = r.performance_cycle_id
       JOIN employee e ON e.employee_id = r.employee_id
      WHERE c.status = 'open' AND r.submitted_at IS NULL AND c.closes_at <= $1
        AND (r.review_type = 'self' OR EXISTS (
              SELECT 1 FROM performance_review sr WHERE sr.performance_cycle_id = r.performance_cycle_id
                 AND sr.employee_id = r.employee_id AND sr.review_type = 'self' AND sr.submitted_at IS NOT NULL))
      ORDER BY c.closes_at, r.performance_review_id`,
    [until],
    { label: "reviews due", ceiling: 10000 },
  );
  return rows;
}

/** A generated document as the contract's DocumentRef, or null. */
async function documentRef(client, documentId) {
  if (!documentId) return null;
  const { rows } = await client.query(
    `SELECT document_id, COALESCE(original_name, title, 'review.pdf') AS file_name, COALESCE(bytes, 0)::int AS size_bytes,
            mime AS mime_type FROM document WHERE document_id = $1`,
    [documentId],
  );
  return rows[0] || null;
}

module.exports = {
  documentRef,
  listCycles,
  getCycle,
  currentCycle,
  questions,
  lastQuestions,
  insertCycle,
  setCycleStatus,
  cyclesDue,
  roster,
  ceoEmployee,
  ensureReview,
  listReviews,
  getReview,
  counterpart,
  openSelfReview,
  items,
  answers,
  saveHeader,
  saveItem,
  saveAnswer,
  keepDictation,
  setReview,
  cycleFigures,
  dueReviews,
};
