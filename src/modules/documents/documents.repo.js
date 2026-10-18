"use strict";
/**
 * Reading documents: the Vault list, its counts, a document's version chain and
 * the requests behind a Missing row.
 *
 * The vault owns writing a file (shared/documents/vault.js); this file only
 * reads, and writes the two rows that are this module's own: a document request
 * and the mark that says a document has been accepted.
 *
 * The Vault list is two kinds of row in one list: a document that is held, and a
 * document that was asked for and has not arrived. They are read in one query so
 * the list pages at 25 like every other (BACKEND_STRUCTURE §16); a list glued
 * together in JavaScript could not.
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { COLUMNS } = require("../../shared/documents/vault");

/** The status a person reads, worked out from the row rather than stored. */
const STATUS = `CASE
  WHEN d.locked_at IS NOT NULL THEN 'signed'
  WHEN d.expires_on IS NOT NULL AND d.expires_on <= CURRENT_DATE + $2::int THEN 'expiring'
  WHEN d.verified_at IS NOT NULL THEN 'verified'
  ELSE 'awaiting_verification'
END`;

/** Documents that belong to a person: current versions, nothing a scan refused. */
const MINE = `d.subject_employee_id = ANY($1::uuid[]) AND d.is_current AND d.scan_status <> 'infected'`;

/** A request still waiting for its file (alias `r`). Home's Documents Requested card reads it too. */
const REQUEST_STILL_OPEN = "r.fulfilled_at IS NULL AND r.cancelled_at IS NULL";

/** A person's requests still waiting for their file. */
const OPEN_REQUEST = `r.employee_id = ANY($1::uuid[]) AND ${REQUEST_STILL_OPEN}`;

const VAULT_ROWS = `
  SELECT 'doc:' || d.document_id::text AS row_key, d.document_id,
         NULL::uuid AS document_request_id,
         COALESCE(NULLIF(d.title, ''), d.original_name, d.doc_type) AS name,
         ${STATUS} AS status, d.created_at AS uploaded_at, d.expires_on,
         d.number, d.mime, d.bytes::int AS bytes, d.version
    FROM document d
   WHERE ${MINE}
   UNION ALL
  SELECT 'req:' || r.document_request_id::text, NULL::uuid, r.document_request_id,
         r.title, 'missing', NULL::timestamptz, NULL::date,
         NULL::text, NULL::text, NULL::int, NULL::int
    FROM document_request r
   WHERE ${OPEN_REQUEST}`;

const SORTS = { uploaded_at: "v.uploaded_at DESC", name: "v.name" };

/**
 * One page of the Vault list.
 * @param {{query: Function}} db
 * @param {string[]} employeeIds  whose documents; one id for ESS, a team or everyone for People
 * @param {{q?: string, status?: string, page?: number, sort?: object}} query
 * @param {number} expiringWithinDays
 */
function vault(db, employeeIds, query, expiringWithinDays) {
  return pageQuery(
    db,
    `SELECT v.*, ${TOTAL_COL}
       FROM (${VAULT_ROWS}) v
      WHERE ($3::text IS NULL OR search_fold(v.name) LIKE '%' || search_fold($3) || '%')
        AND ($4::text IS NULL OR v.status = $4)
      ORDER BY ${orderBy(query, SORTS, "v.row_key")}`,
    [employeeIds, expiringWithinDays, query.q || null, query.status || null],
    query,
  );
}

/**
 * The counts above the list, over every row, not the page.
 * @param {{query: Function}} db
 */
async function summary(db, employeeIds, expiringWithinDays) {
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE v.document_id IS NOT NULL)::int AS documents,
            count(*) FILTER (WHERE v.status = 'signed')::int AS signed,
            count(*) FILTER (WHERE v.status = 'verified')::int AS verified,
            count(*) FILTER (WHERE v.status = 'expiring')::int AS expiring,
            count(*) FILTER (WHERE v.status = 'missing')::int AS missing
       FROM (${VAULT_ROWS}) v`,
    [employeeIds, expiringWithinDays],
  );
  return rows[0];
}

const DOCUMENT_ROW = `d.document_id, d.doc_type, d.title, d.original_name, d.mime, d.bytes::int AS bytes,
  d.content_hash, d.version, d.is_current, d.entity_type, d.entity_id, d.subject_employee_id,
  d.sensitivity, d.scan_status, d.source, d.number, d.locked_at, d.expires_on, d.verified_at,
  trim(COALESCE(e.first_name || ' ' || e.last_name, '')) AS uploaded_by_name, d.created_at`;

const DOCUMENT_FROM = `FROM document d
  LEFT JOIN app_user u ON u.user_id = d.uploaded_by
  LEFT JOIN employee e ON e.employee_id = u.employee_id`;

/** One document as a screen reads it. */
async function get(db, documentId) {
  const { rows } = await db.query(
    `SELECT ${DOCUMENT_ROW} ${DOCUMENT_FROM} WHERE d.document_id = $1`,
    [documentId],
  );
  return rows[0] || null;
}

/** The id at the head of a version chain, found from any version in it. */
async function headOf(db, documentId) {
  const { rows } = await db.query(
    `WITH RECURSIVE chain AS (
       SELECT document_id, supersedes_id, is_current FROM document WHERE document_id = $1
       UNION ALL
       SELECT d.document_id, d.supersedes_id, d.is_current
         FROM document d JOIN chain c ON d.supersedes_id = c.document_id
     )
     SELECT document_id FROM chain WHERE is_current`,
    [documentId],
  );
  return rows[0] ? rows[0].document_id : documentId;
}

/** Every version of a document, newest first. Walks back from the current one. */
function versions(db, headId, query) {
  return pageQuery(
    db,
    `WITH RECURSIVE chain AS (
       SELECT document_id, supersedes_id FROM document WHERE document_id = $1
       UNION ALL
       SELECT older.document_id, older.supersedes_id
         FROM document older JOIN chain c ON older.document_id = c.supersedes_id
     )
     SELECT ${DOCUMENT_ROW}, ${TOTAL_COL}
       ${DOCUMENT_FROM}
      WHERE d.document_id IN (SELECT document_id FROM chain)
      ORDER BY ${orderBy(query, { version: "d.version DESC" }, "d.document_id")}`,
    [headId],
    query,
  );
}

/** A request, by id. */
async function requestOf(db, requestId) {
  const { rows } = await db.query(
    `SELECT document_request_id, employee_id, doc_type, title, note, requested_by, requested_at,
            fulfilled_document_id, fulfilled_at, cancelled_at
       FROM document_request WHERE document_request_id = $1`,
    [requestId],
  );
  return rows[0] || null;
}

/** Ask an employee for a document. */
async function createRequest(client, { employee_id, doc_type, title, note, actor }) {
  const { rows } = await client.query(
    `INSERT INTO document_request (employee_id, doc_type, title, note, requested_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING document_request_id, employee_id, doc_type, title, note, requested_by, requested_at,
               fulfilled_document_id, fulfilled_at, cancelled_at`,
    [employee_id, doc_type || null, title, note || null, actor ? actor.user_id : null],
  );
  return rows[0];
}

/** Mark a request answered by a document. Returns the request, or null when it was taken already. */
async function fulfilRequest(client, requestId, documentId) {
  const { rows } = await client.query(
    `UPDATE document_request
        SET fulfilled_document_id = $2, fulfilled_at = now()
      WHERE document_request_id = $1 AND fulfilled_at IS NULL AND cancelled_at IS NULL
      RETURNING document_request_id, employee_id, doc_type, title`,
    [requestId, documentId],
  );
  return rows[0] || null;
}

/** People have looked at the file and accepted it. Marking twice changes nothing. */
async function markVerified(client, documentId, actor) {
  const { rows } = await client.query(
    `UPDATE document SET verified_at = now(), verified_by = $2
      WHERE document_id = $1 AND verified_at IS NULL
      RETURNING document_id, verified_at`,
    [documentId, actor ? actor.user_id : null],
  );
  return rows[0] || null;
}

/** The employee a document is about, and their name, for a notification. */
async function subjectOf(db, employeeId) {
  const { rows } = await db.query(
    `SELECT e.employee_id, trim(e.first_name || ' ' || e.last_name) AS display_name, e.status
       FROM employee e WHERE e.employee_id = $1`,
    [employeeId],
  );
  return rows[0] || null;
}

module.exports = {
  COLUMNS,
  REQUEST_STILL_OPEN,
  vault,
  summary,
  get,
  headOf,
  versions,
  requestOf,
  createRequest,
  fulfilRequest,
  markVerified,
  subjectOf,
};
