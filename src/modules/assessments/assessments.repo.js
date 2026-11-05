"use strict";
/**
 * Assessments: the SQL (docs/guides/recruitment.md §4, §6.7). Writes assessment_definition,
 * assessment_question, application_assessment (a sitting) and assessment_response; reads the
 * application, candidate and vacancy a sitting belongs to. Never emits (BACKEND_GUIDE §2).
 *
 * Definitions are the module's library: any `recruitment` view reads them. A sitting's scope is
 * its vacancy's hiring manager (guide §8), as on Candidates.
 *
 * answer_key_enc is read only by the functions that score (keysOf); no read a screen or the
 * public site makes selects it.
 */
const { pageQuery, orderBy, completeQuery, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");

/* ------------------------------------------------------------------ *
 * Definitions
 * ------------------------------------------------------------------ */

const DEFINITIONS = `
  SELECT d.assessment_definition_id, d.code::text AS code, d.name, d.assessment_type, d.duration_minutes,
         d.pass_score, d.scoring_method, d.active, d.instructions, d.created_at,
         (SELECT count(*)::int FROM assessment_question q WHERE q.assessment_definition_id = d.assessment_definition_id) AS question_count,
         (SELECT count(*)::int FROM application_assessment s WHERE s.assessment_definition_id = d.assessment_definition_id) AS sent,
         (SELECT round(avg(s.score), 1) FROM application_assessment s
           WHERE s.assessment_definition_id = d.assessment_definition_id AND s.status = 'scored') AS average_score,
         search_fold(d.code || ' ' || d.name) AS haystack
    FROM assessment_definition d`;

const DEF_SORTS = { created_at: "x.created_at", name: "x.name" };

function list(db, query) {
  const params = [query.assessment_type || null, query.active === undefined ? null : query.active === "true", query.q || null];
  return pageQuery(
    db,
    `SELECT x.*, ${TOTAL_COL}
       FROM (${DEFINITIONS}) x
      WHERE ($1::text IS NULL OR x.assessment_type = $1)
        AND ($2::boolean IS NULL OR x.active = $2)
        AND ($3::text IS NULL OR x.haystack LIKE '%' || search_fold($3) || '%')
      ORDER BY ${orderBy(query, DEF_SORTS, "x.assessment_definition_id")}`,
    params,
    query,
  );
}

async function get(db, id, { lock = false } = {}) {
  if (lock) await db.query("SELECT 1 FROM assessment_definition WHERE assessment_definition_id = $1 FOR UPDATE", [id]);
  const { rows } = await db.query(`SELECT * FROM (${DEFINITIONS}) x WHERE x.assessment_definition_id = $1`, [id]);
  return rows[0] || null;
}

/** The next code, ASM-0001, made while holding the codes so two saves cannot take the same one. */
async function nextCode(client) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('assessment_definition.code'))");
  const { rows } = await client.query(
    `SELECT COALESCE(max(substring(code::text from '^ASM-(\\d+)$')::int), 0) + 1 AS n FROM assessment_definition`,
  );
  return `ASM-${String(rows[0].n).padStart(4, "0")}`;
}

async function insert(client, d) {
  const { rows } = await client.query(
    `INSERT INTO assessment_definition (code, name, assessment_type, instructions, duration_minutes, pass_score,
                                        scoring_method, active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'manual', false, $7)
     RETURNING assessment_definition_id`,
    [d.code, d.name, d.assessment_type, d.instructions, d.duration_minutes ?? null, d.pass_score ?? null, d.created_by],
  );
  return rows[0].assessment_definition_id;
}

const WRITABLE = ["name", "assessment_type", "instructions", "duration_minutes", "pass_score", "scoring_method", "active"];

/** Change the WRITABLE columns given; null clears one. */
async function update(client, id, fields) {
  const keys = WRITABLE.filter((k) => fields[k] !== undefined);
  if (!keys.length) return;
  await client.query(
    `UPDATE assessment_definition SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE assessment_definition_id = $1`,
    [id, ...keys.map((k) => fields[k])],
  );
}

/** An assessment's questions as staff read them (no key), in order. */
async function questions(db, id) {
  // pagination:complete an assessment's questions are one form, at most 60 by the contract
  const { rows } = await completeQuery(
    db,
    `SELECT q.assessment_question_id, q.question_type, q.prompt, q.options, q.max_score::float AS max_score, q.display_order
       FROM assessment_question q
      WHERE q.assessment_definition_id = $1
      ORDER BY q.display_order, q.assessment_question_id`,
    [id],
  );
  return rows;
}

/** The encrypted keys of an assessment's questions, by question id: only scoring and staff reads use them. */
async function keysOf(db, id) {
  // pagination:complete one key a question, at most 60 by the contract
  const { rows } = await completeQuery(
    db,
    "SELECT q.assessment_question_id, q.answer_key_enc FROM assessment_question q WHERE q.assessment_definition_id = $1",
    [id],
  );
  return new Map(rows.map((r) => [r.assessment_question_id, r.answer_key_enc]));
}

/** Replace the whole set (only while nothing has been sent). */
async function replaceQuestions(client, id, rows) {
  await client.query("DELETE FROM assessment_question WHERE assessment_definition_id = $1", [id]);
  for (const r of rows) {
    await client.query(
      `INSERT INTO assessment_question (assessment_question_id, assessment_definition_id, question_type, prompt, options,
                                        answer_key_enc, max_score, display_order)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      [r.assessment_question_id, id, r.question_type, r.prompt, r.options ? JSON.stringify(r.options) : null, r.answer_key_enc, r.max_score, r.display_order],
    );
  }
}

/** The figures above Assessments. Sittings counted in the reader's scope. */
async function summary(db, scope) {
  const params = [];
  const s = scopeClause(scope, { column: "v.hiring_manager_id" }, params);
  const { rows } = await db.query(
    `SELECT (SELECT count(*)::int FROM assessment_definition WHERE active) AS active,
            count(s.*)::int AS sent,
            count(*) FILTER (WHERE s.status IN ('submitted', 'timed_out'))::int AS awaiting_marking,
            round(avg(s.score) FILTER (WHERE s.status = 'scored'), 1) AS average_score
       FROM application_assessment s
       JOIN application a ON a.application_id = s.application_id
       JOIN vacancy v ON v.vacancy_id = a.vacancy_id
      WHERE true ${s.and}`,
    params,
  );
  const p2 = [];
  const s2 = scopeClause(scope, { column: "v.hiring_manager_id" }, p2);
  // pagination:complete the ten assessments most sat, for the summary chart
  const by = await completeQuery(
    db,
    `SELECT x.label, x.value FROM (
       SELECT d.name AS label, round(avg(s.score), 1)::float AS value,
              row_number() OVER (ORDER BY count(*) DESC, d.name) AS n
         FROM application_assessment s
         JOIN assessment_definition d ON d.assessment_definition_id = s.assessment_definition_id
         JOIN application a ON a.application_id = s.application_id
         JOIN vacancy v ON v.vacancy_id = a.vacancy_id
        WHERE s.status = 'scored' ${s2.and}
        GROUP BY d.assessment_definition_id, d.name
     ) x
     WHERE x.n <= 10
     ORDER BY x.n`,
    p2,
  );
  return { ...rows[0], by_assessment: by.rows };
}

/* ------------------------------------------------------------------ *
 * Sittings
 * ------------------------------------------------------------------ */

const SITTINGS = `
  SELECT s.application_assessment_id, s.application_id, s.assessment_definition_id, s.public_token_id, s.status,
         s.start_by::text AS start_by, s.started_at, s.due_at, s.submitted_at, s.scored_at, s.score::float AS score,
         s.current_question, s.due_days, s.assigned_at, s.created_at,
         d.name AS assessment_name, d.assessment_type, d.duration_minutes, d.instructions,
         a.status AS application_status, a.vacancy_id, a.number::text AS application_number,
         btrim(k.first_name || ' ' || k.last_name) AS candidate_name, k.first_name AS candidate_first_name,
         k.last_name AS candidate_last_name, k.email::text AS candidate_email,
         v.title AS vacancy_title, v.hiring_manager_id,
         (SELECT count(*)::int FROM assessment_question q WHERE q.assessment_definition_id = d.assessment_definition_id) AS question_count,
         (SELECT count(*)::int FROM assessment_response r
            JOIN assessment_question q ON q.assessment_question_id = r.assessment_question_id
           WHERE r.application_assessment_id = s.application_assessment_id
             AND q.question_type <> 'choice' AND r.awarded_score IS NULL
             AND (r.response IS NOT NULL OR r.document_id IS NOT NULL)) AS to_mark
    FROM application_assessment s
    JOIN assessment_definition d ON d.assessment_definition_id = s.assessment_definition_id
    JOIN application a ON a.application_id = s.application_id
    JOIN candidate k ON k.candidate_id = a.candidate_id
    JOIN vacancy v ON v.vacancy_id = a.vacancy_id`;

const SITTING_SORTS = { created_at: "x.created_at", submitted_at: "x.submitted_at", start_by: "x.start_by" };

function sittings(db, query, scope) {
  const params = [query.status || null, query.application_id || null, query.marking === "true", query.q || null];
  const s = scopeClause(scope, { column: "x.hiring_manager_id" }, params);
  return pageQuery(
    db,
    `SELECT x.*, ${TOTAL_COL}
       FROM (${SITTINGS}) x
      WHERE ($1::text IS NULL OR x.status = $1)
        AND ($2::uuid IS NULL OR x.application_id = $2)
        AND (NOT $3 OR (x.status IN ('submitted', 'timed_out') AND x.to_mark > 0))
        AND ($4::text IS NULL OR search_fold(x.candidate_name || ' ' || x.assessment_name || ' ' || x.vacancy_title) LIKE '%' || search_fold($4) || '%')
        ${s.and}
      ORDER BY ${orderBy(query, SITTING_SORTS, "x.application_assessment_id")}`,
    params,
    query,
  );
}

async function sitting(db, id, { lock = false } = {}) {
  if (lock) await db.query("SELECT 1 FROM application_assessment WHERE application_assessment_id = $1 FOR UPDATE", [id]);
  const { rows } = await db.query(`SELECT * FROM (${SITTINGS}) x WHERE x.application_assessment_id = $1`, [id]);
  return rows[0] || null;
}

/** The live sitting of this assessment for this application, if there is one. */
async function liveSitting(db, applicationId, definitionId) {
  const { rows } = await db.query(
    `SELECT application_assessment_id FROM application_assessment
      WHERE application_id = $1 AND assessment_definition_id = $2 AND status NOT IN ('cancelled', 'expired')`,
    [applicationId, definitionId],
  );
  return rows[0] || null;
}

async function insertSitting(client, s) {
  const { rows } = await client.query(
    `INSERT INTO application_assessment (application_id, assessment_definition_id, status, start_by, due_days, sent_by)
     VALUES ($1, $2, 'sent', $3, $4, $5)
     RETURNING application_assessment_id`,
    [s.application_id, s.assessment_definition_id, s.start_by, s.due_days ?? null, s.sent_by],
  );
  return rows[0].application_assessment_id;
}

/** The link a sitting was sent with (the mail handler makes it after commit). */
async function setLink(client, id, publicTokenId) {
  await client.query("UPDATE application_assessment SET public_token_id = $2 WHERE application_assessment_id = $1", [id, publicTokenId]);
}

async function start(client, id, dueAt) {
  await client.query(
    "UPDATE application_assessment SET status = 'in_progress', started_at = now(), due_at = $2 WHERE application_assessment_id = $1",
    [id, dueAt],
  );
}

/** End a sitting: submitted, timed_out, expired or cancelled. */
async function end(client, id, status) {
  await client.query(
    `UPDATE application_assessment
        SET status = $2, submitted_at = CASE WHEN $2 IN ('submitted', 'timed_out') THEN now() ELSE submitted_at END
      WHERE application_assessment_id = $1`,
    [id, status],
  );
}

async function setScore(client, id, score) {
  await client.query(
    "UPDATE application_assessment SET status = 'scored', score = $2, scored_at = now() WHERE application_assessment_id = $1",
    [id, score],
  );
}

async function setPosition(client, id, n) {
  await client.query("UPDATE application_assessment SET current_question = $2 WHERE application_assessment_id = $1", [id, n]);
}

/** The answers of a sitting, by question. */
async function responses(db, id) {
  // pagination:complete one answer a question, at most 60 by the contract
  const { rows } = await completeQuery(
    db,
    `SELECT r.assessment_question_id, r.response, r.document_id, r.awarded_score::float AS awarded_score,
            r.reviewer_comment, r.marked_at, d.original_name AS file_name, d.bytes AS file_bytes, d.mime AS file_mime
       FROM assessment_response r
       LEFT JOIN document d ON d.document_id = r.document_id
      WHERE r.application_assessment_id = $1`,
    [id],
  );
  return new Map(rows.map((r) => [r.assessment_question_id, r]));
}

/** Keep an answer: the text or option id, or a file; a choice is awarded its points at once. */
async function saveResponse(client, id, questionId, { response = null, document_id: documentId = null, awarded = null }) {
  await client.query(
    `INSERT INTO assessment_response (application_assessment_id, assessment_question_id, response, document_id, awarded_score, answered_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, now())
     ON CONFLICT (application_assessment_id, assessment_question_id)
     DO UPDATE SET response = EXCLUDED.response, document_id = EXCLUDED.document_id,
                   awarded_score = EXCLUDED.awarded_score, answered_at = now()`,
    [id, questionId, response === null ? null : JSON.stringify(response), documentId, awarded],
  );
}

async function mark(client, id, questionId, { awarded, comment, by }) {
  const { rowCount } = await client.query(
    `UPDATE assessment_response SET awarded_score = $3, reviewer_comment = $4, marked_by = $5, marked_at = now()
      WHERE application_assessment_id = $1 AND assessment_question_id = $2`,
    [id, questionId, awarded, comment ?? null, by],
  );
  return rowCount === 1;
}

/** The active applications of a vacancy at a stage, for Send to Candidates. */
async function applicationsAt(db, vacancyId, stage) {
  // pagination:complete Send to Candidates makes one sitting for each, in one transaction
  const { rows } = await completeQuery(
    db,
    `SELECT a.application_id FROM application a
      WHERE a.vacancy_id = $1 AND a.stage = $2 AND a.status = 'active'
      ORDER BY a.applied_at, a.application_id`,
    [vacancyId, stage],
  );
  return rows.map((r) => r.application_id);
}

/** Sittings running past their time, and links never started by their day (the clock). */
async function due(db, today) {
  const { rows } = await db.query(
    `SELECT application_assessment_id, status FROM application_assessment
      WHERE (status = 'in_progress' AND due_at <= now()) OR (status = 'sent' AND start_by < $1::date)
      ORDER BY application_assessment_id
      LIMIT 200 -- pagination:batch the clock ends at most 200 a minute; the rest wait for the next tick`,
    [today],
  );
  return rows;
}

module.exports = {
  list,
  get,
  nextCode,
  insert,
  update,
  questions,
  keysOf,
  replaceQuestions,
  summary,
  sittings,
  sitting,
  liveSitting,
  insertSitting,
  setLink,
  start,
  end,
  setScore,
  setPosition,
  responses,
  saveResponse,
  mark,
  applicationsAt,
  due,
};
