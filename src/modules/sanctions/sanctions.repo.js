"use strict";
/**
 * Sanctions and the chain: the SQL (docs/guides/queries.md §4, §6.5, §6.6). Writes
 * sanction, sanction_fine, sanction_letter and consequence_step; reads the query a
 * sanction follows for its visibility (a sanction is seen by whoever may see its
 * query, queries.visibility.js). Never emits.
 */
const { personJson } = require("../../shared/db/person");
const { pageQuery, orderBy, completeQuery, TOTAL_COL } = require("../../shared/http/paged");
const visibility = require("../queries/queries.visibility");
const { FINE_LETTER_KEY } = require("../templates/templates.events");

const NAME = (alias) => `btrim(${alias}.first_name || ' ' || ${alias}.last_name)`;

/* ------------------------------------------------------------------ *
 * The chain
 * ------------------------------------------------------------------ */

const STEP_COLUMNS = `s.consequence_step_id, s.code::text AS code, s.name, s.position,
  s.letter_template::text AS letter_template, s.financial_effect, s.default_days, s.valid_days,
  s.evidence_required, s.active, s.created_at, s.updated_at`;

/** One page of the chain, in ladder order. */
function listSteps(db, query) {
  return pageQuery(
    db,
    `SELECT ${STEP_COLUMNS}, ${TOTAL_COL}
       FROM consequence_step s
      WHERE ($1::boolean IS NULL OR s.active = $1)
      ORDER BY s.position, s.consequence_step_id`,
    [query.active === undefined ? null : query.active],
    query,
  );
}

/** Every rung, in order: the chain is renumbered whole when a rung moves. */
async function allSteps(db) {
  // pagination:complete the ladder is renumbered as a whole; a few rungs, never listed from here
  const { rows } = await completeQuery(
    db,
    `SELECT ${STEP_COLUMNS} FROM consequence_step s ORDER BY s.position, s.consequence_step_id`,
    [],
    { label: "consequence chain", ceiling: 100 },
  );
  return rows;
}

async function getStep(db, id) {
  const { rows } = await db.query(`SELECT ${STEP_COLUMNS} FROM consequence_step s WHERE s.consequence_step_id = $1`, [id]);
  return rows[0] || null;
}

async function codeTaken(db, code) {
  const { rows } = await db.query("SELECT 1 FROM consequence_step WHERE code = $1", [code]);
  return rows.length > 0;
}

/** Serialise every change to the chain: positions are rewritten together. */
async function lockChain(db) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext('consequence_step'))");
}

async function insertStep(db, row) {
  const { rows } = await db.query(
    `INSERT INTO consequence_step
       (code, name, position, letter_template, financial_effect, default_days, valid_days, evidence_required, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING consequence_step_id`,
    [
      row.code,
      row.name,
      row.position,
      row.letter_template,
      row.financial_effect,
      row.default_days,
      row.valid_days,
      row.evidence_required,
      row.created_by || null,
    ],
  );
  return rows[0].consequence_step_id;
}

const STEP_FIELDS = ["name", "position", "letter_template", "financial_effect", "default_days", "valid_days", "evidence_required", "active"];

async function updateStep(db, id, fields) {
  const keys = STEP_FIELDS.filter((k) => fields[k] !== undefined);
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  await db.query(`UPDATE consequence_step SET ${sets.join(", ")} WHERE consequence_step_id = $1`, [
    id,
    ...keys.map((k) => fields[k]),
  ]);
}

/** Whether a letter key is a sanction letter that exists (ready or not). */
async function isSanctionLetter(db, key) {
  const { rows } = await db.query("SELECT 1 FROM letter_template WHERE key = $1 AND purpose = 'sanction'", [key]);
  return rows.length > 0;
}

/* ------------------------------------------------------------------ *
 * Sanctions
 * ------------------------------------------------------------------ */

/** Every sanction with what a screen needs, and the columns filters and visibility read. */
const ROWS = `
  SELECT x.sanction_id, x.number::text AS number,
         ${personJson("e", "d")} AS employee,
         x.employee_id, x.employee_query_id, q.number::text AS query_number, q.raised_by,
         q.subject AS query_subject, q.details AS query_details, q.created_at AS query_raised_at,
         x.consequence_step_id, x.sanction_type, COALESCE(s.name, x.sanction_type) AS step_name,
         s.position, s.valid_days, COALESCE(x.letter_template, s.letter_template)::text AS letter_template, s.financial_effect,
         x.reason, x.decided_by, ${NAME("de")} AS decided_by_name, de.job_title AS decided_by_title,
         x.signature_document_id, x.signed_by, ${NAME("se")} AS signed_by_name, se.job_title AS signed_by_title,
         q.policy_version_id AS query_policy_version_id, q.policy_clause AS query_policy_clause,
         x.effective_on, x.ends_on, x.status, x.evidence, x.workflow_instance_id,
         CASE WHEN f.sanction_fine_id IS NULL THEN NULL
              ELSE json_build_object('amount_ngn', f.amount_ngn::text, 'settlement_status', f.settlement_status,
                                     'settled_at', f.settled_at) END AS fine,
         f.amount_ngn::text AS fine_amount,
         l.document_id AS letter_document_id,
         fl.document_id AS fine_letter_document_id,
         CASE WHEN wi.state = 'pending' THEN (
           SELECT min(st ->> 'name') FROM workflow_definition wd, jsonb_array_elements(wd.stages) st
            WHERE wd.workflow_definition_id = wi.workflow_definition_id AND st ->> 'key' = wi.current_stage
         ) END AS waiting_on,
         x.created_at,
         search_fold(COALESCE(x.number, '') || ' ' || q.number || ' ' || e.first_name || ' ' || e.last_name
                     || ' ' || COALESCE(s.name, x.sanction_type) || ' ' || x.reason) AS haystack
    FROM sanction x
    JOIN employee_query q ON q.employee_query_id = x.employee_query_id
    JOIN employee e ON e.employee_id = x.employee_id
    LEFT JOIN department d ON d.department_id = e.department_id
    LEFT JOIN consequence_step s ON s.consequence_step_id = x.consequence_step_id
    LEFT JOIN app_user du ON du.user_id = x.decided_by
    LEFT JOIN employee de ON de.employee_id = du.employee_id
    LEFT JOIN app_user su ON su.user_id = x.signed_by
    LEFT JOIN employee se ON se.employee_id = su.employee_id
    LEFT JOIN sanction_fine f ON f.sanction_id = x.sanction_id
    LEFT JOIN sanction_letter l ON l.sanction_id = x.sanction_id AND l.letter_type <> '${FINE_LETTER_KEY}'
    LEFT JOIN sanction_letter fl ON fl.sanction_id = x.sanction_id AND fl.letter_type = '${FINE_LETTER_KEY}'
    LEFT JOIN workflow_instance wi ON wi.workflow_instance_id = x.workflow_instance_id`;

/** The keys of Sanction. */
const LIST_OUT = `v.sanction_id, v.number, v.employee, v.employee_query_id, v.query_number, v.consequence_step_id,
  v.sanction_type, v.step_name, v.reason, v.decided_by, v.decided_by_name, v.effective_on, v.ends_on,
  v.status, v.fine, v.created_at`;

/** SanctionDetail's keys and what the service needs beside them. */
const DETAIL_OUT = `${LIST_OUT}, v.evidence, v.letter_document_id, v.fine_letter_document_id, v.workflow_instance_id, v.waiting_on,
  v.employee_id, v.raised_by, v.query_subject, v.query_details, v.query_raised_at, v.position,
  v.letter_template, v.financial_effect, v.fine_amount, v.signature_document_id, v.decided_by_title,
  v.signed_by, v.signed_by_name, v.signed_by_title,
  v.query_policy_version_id, v.query_policy_clause`;

const SORTS = { effective_on: "v.effective_on", created_at: "v.created_at" };

/** One page of sanctions whose query the reader may see. */
function list(db, query, reader) {
  const params = [query.status || null, query.employee_id || null, query.consequence_step_id || null, query.q || null];
  const v = visibility.clause(reader, params, "v.raised_by");
  return pageQuery(
    db,
    `SELECT ${LIST_OUT}, ${TOTAL_COL}
       FROM (${ROWS}) v
      WHERE ($1::text IS NULL OR v.status = $1)
        AND ($2::uuid IS NULL OR v.employee_id = $2)
        AND ($3::uuid IS NULL OR v.consequence_step_id = $3)
        AND ($4::text IS NULL OR v.haystack LIKE '%' || search_fold($4) || '%')
        ${v.and}
      ORDER BY ${orderBy(query, SORTS, "v.sanction_id")}`,
    params,
    query,
  );
}

async function get(db, id) {
  const { rows } = await db.query(`SELECT ${DETAIL_OUT} FROM (${ROWS}) v WHERE v.sanction_id = $1`, [id]);
  return rows[0] || null;
}

async function lock(db, id) {
  const { rows } = await db.query("SELECT sanction_id, status FROM sanction WHERE sanction_id = $1 FOR UPDATE", [id]);
  return rows[0] || null;
}

/** A proposal already waiting on this query. */
async function pendingOn(db, queryId) {
  const { rows } = await db.query(
    "SELECT sanction_id FROM sanction WHERE employee_query_id = $1 AND status = 'pending_approval'",
    [queryId],
  );
  return rows[0] || null;
}

async function insert(db, row) {
  const { rows } = await db.query(
    `INSERT INTO sanction
       (employee_query_id, employee_id, consequence_step_id, sanction_type, reason, evidence, decided_by,
        effective_on, ends_on, letter_template, status)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, 'pending_approval')
     RETURNING sanction_id`,
    [
      row.employee_query_id,
      row.employee_id,
      row.consequence_step_id,
      row.sanction_type,
      row.reason,
      JSON.stringify(row.evidence || []),
      row.decided_by,
      row.effective_on,
      row.ends_on,
      row.letter_template,
    ],
  );
  return rows[0].sanction_id;
}

async function insertFine(db, sanctionId, amount) {
  await db.query("INSERT INTO sanction_fine (sanction_id, amount_ngn) VALUES ($1, $2::numeric)", [sanctionId, amount]);
}

async function setWorkflow(db, id, instanceId) {
  await db.query("UPDATE sanction SET workflow_instance_id = $2 WHERE sanction_id = $1", [id, instanceId]);
}

/** Issue a sanction still pending: its number and status. */
async function issue(db, id, number) {
  const { rowCount } = await db.query(
    "UPDATE sanction SET status = 'issued', number = $2 WHERE sanction_id = $1 AND status = 'pending_approval'",
    [id, number],
  );
  return rowCount === 1;
}

/** End a proposal still pending: rejected or withdrawn. */
async function close(db, id, status) {
  const { rowCount } = await db.query(
    "UPDATE sanction SET status = $2 WHERE sanction_id = $1 AND status = 'pending_approval'",
    [id, status],
  );
  return rowCount === 1;
}

async function setSignature(db, id, documentId, signedBy = null) {
  await db.query("UPDATE sanction SET signature_document_id = $2, signed_by = $3 WHERE sanction_id = $1", [id, documentId, signedBy]);
}

async function insertLetter(db, { sanction_id, document_id, letter_type }) {
  await db.query(
    `INSERT INTO sanction_letter (sanction_id, document_id, letter_type) VALUES ($1, $2, $3)
     ON CONFLICT (sanction_id, letter_type) DO NOTHING`,
    [sanction_id, document_id, letter_type],
  );
}

/**
 * The rungs in force for a person on `today`: issued sanctions whose rung counts for
 * escalation (no valid_days, or still inside them), highest first.
 */
/**
 * One person's sanctions in force. With a reader, only those on queries the reader may see
 * (queries.visibility): a next rung offered never hints at a sanction they cannot read.
 */
async function inForce(db, employeeId, today, reader = null) {
  const params = [employeeId, today];
  const v = reader ? visibility.clause(reader, params, "q.raised_by") : { and: "" };
  // pagination:complete one person's standing on the ladder: a handful of rungs, never listed
  const { rows } = await completeQuery(
    db,
    `SELECT x.sanction_id, x.number::text AS number, COALESCE(s.name, x.sanction_type) AS step_name,
            s.position, x.effective_on,
            CASE WHEN s.valid_days IS NULL THEN NULL ELSE x.effective_on + (s.valid_days - 1) END AS in_force_until
       FROM sanction x JOIN consequence_step s ON s.consequence_step_id = x.consequence_step_id
       JOIN employee_query q ON q.employee_query_id = x.employee_query_id
      WHERE x.employee_id = $1 AND x.status = 'issued'
        AND (s.valid_days IS NULL OR x.effective_on + (s.valid_days - 1) >= $2::date)
        ${v.and}
      ORDER BY s.position DESC, x.effective_on DESC, x.sanction_id`,
    params,
    { label: "sanctions in force", ceiling: 25 },
  );
  return rows;
}

/** The first active rung above `position` (0: the first rung). */
async function stepAbove(db, position) {
  const { rows } = await db.query(
    `SELECT consequence_step_id, name, position FROM consequence_step
      WHERE active AND position > $1 ORDER BY position LIMIT 1`,
    [position],
  );
  return rows[0] || null;
}

/** The figures above Sanctions. Money in Naira, as strings. */
async function summary(db, reader, { today, yearStart }) {
  const params = [today, yearStart];
  const v = visibility.clause(reader, params, "q.raised_by");
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE x.status = 'issued' AND (x.ends_on IS NULL OR x.ends_on >= $1::date))::int AS active,
            count(*) FILTER (WHERE x.status = 'pending_approval')::int AS pending_approval,
            COALESCE(sum(f.amount_ngn) FILTER (WHERE x.status = 'issued' AND x.effective_on >= $2::date), 0)::numeric(18,2)::text
              AS fines_this_year,
            COALESCE(sum(f.amount_ngn) FILTER (WHERE x.status = 'issued' AND f.settlement_status = 'settled'), 0)::numeric(18,2)::text
              AS fines_recovered
       FROM sanction x
       JOIN employee_query q ON q.employee_query_id = x.employee_query_id
       LEFT JOIN sanction_fine f ON f.sanction_id = x.sanction_id
      WHERE true ${v.and}`,
    params,
  );
  return rows[0];
}

/** ESS: the caller's own issued sanctions, newest first. */
function listMine(db, employeeId, query) {
  return pageQuery(
    db,
    `SELECT v.sanction_id, v.number, v.step_name, v.reason, v.query_number, v.effective_on, v.ends_on,
            v.fine, v.letter_document_id, v.fine_letter_document_id, ${TOTAL_COL}
       FROM (${ROWS}) v
      WHERE v.employee_id = $1 AND v.status = 'issued'
      ORDER BY v.effective_on DESC, v.created_at DESC, v.sanction_id`,
    [employeeId],
    query,
  );
}

/** ESS: how many issued sanctions the caller has, and the date of the latest. */
async function mineSummary(db, employeeId) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS sanctions, max(effective_on)::text AS last_sanction
       FROM sanction WHERE employee_id = $1 AND status = 'issued'`,
    [employeeId],
  );
  return rows[0];
}

/* ------------------------------------------------------------------ *
 * Fines, for payroll (M6)
 * ------------------------------------------------------------------ */

/** Fines of issued sanctions waiting for payroll to accept or waive them. */
function pendingFines(db, query) {
  return pageQuery(
    db,
    `SELECT f.sanction_fine_id, f.sanction_id, x.number::text AS sanction_number, x.employee_id,
            f.amount_ngn::text AS amount_ngn, f.settlement_status, x.effective_on, ${TOTAL_COL}
       FROM sanction_fine f JOIN sanction x ON x.sanction_id = f.sanction_id
      WHERE x.status = 'issued' AND f.settlement_status = 'pending'
        AND ($1::uuid IS NULL OR x.employee_id = $1)
      ORDER BY x.effective_on, f.sanction_fine_id`,
    [query.employee_id || null],
    query,
  );
}

/** Move a fine on: pending → accepted or waived, accepted → settled. Returns false otherwise. */
async function settleFine(db, fineId, from, to) {
  const { rowCount } = await db.query(
    `UPDATE sanction_fine SET settlement_status = $3, settled_at = CASE WHEN $3 = 'settled' THEN now() ELSE settled_at END
      WHERE sanction_fine_id = $1 AND settlement_status = $2`,
    [fineId, from, to],
  );
  return rowCount === 1;
}

module.exports = {
  listSteps,
  allSteps,
  getStep,
  codeTaken,
  lockChain,
  insertStep,
  updateStep,
  isSanctionLetter,
  list,
  get,
  lock,
  pendingOn,
  insert,
  insertFine,
  setWorkflow,
  issue,
  close,
  insertLetter,
  setSignature,
  inForce,
  stepAbove,
  summary,
  listMine,
  mineSummary,
  pendingFines,
  settleFine,
};
