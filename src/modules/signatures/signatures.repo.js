"use strict";
/**
 * SQL for signature requests and their signature rows (migrations 5000, 5020). Writes only these
 * two tables; the document they sign is the vault's, the subject (an offer, a contract, an
 * agreement) its own module's.
 */

const REQUEST_COLS = `r.signature_request_id, r.document_id, r.subject_type, r.subject_id, r.status, r.expires_at,
  r.completed_at, r.created_by, r.created_at, r.sealed_document_id, r.end_reason, r.reference, r.title,
  r.document_type, r.verify_key_hash, r.sealed_at`;

const SIGNATURE_COLS = `s.signature_id, s.signature_request_id, s.signer_type, s.signer_id, s.signer_name, s.signer_email,
  s.signer_title, s.signer_role, s.position, s.status, s.signed_at, s.method, s.signature_document_id,
  s.code_verified_at, s.viewed_at, s.content_hash, s.artifact_hash, s.code_hash, s.code_expires_at,
  s.code_attempts, s.code_sent_at, s.evidence`;

async function insertRequest(client, r) {
  const { rows } = await client.query(
    `INSERT INTO signature_request (document_id, subject_type, subject_id, status, expires_at, created_by, reference, title, document_type)
     VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8)
     RETURNING signature_request_id`,
    [r.document_id, r.subject_type, r.subject_id, r.expires_at, r.created_by, r.reference, r.title, r.document_type],
  );
  return rows[0].signature_request_id;
}

async function insertSignature(client, s) {
  const { rows } = await client.query(
    `INSERT INTO signature (signature_request_id, signer_type, signer_id, signer_name, signer_email, signer_title, signer_role, position, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
     RETURNING signature_id`,
    [s.signature_request_id, s.signer_type, s.signer_id || null, s.signer_name, s.signer_email, s.signer_title || null, s.signer_role, s.position],
  );
  return rows[0].signature_id;
}

async function request(db, id, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${REQUEST_COLS} FROM signature_request r WHERE r.signature_request_id = $1${forUpdate ? " FOR UPDATE" : ""}`,
    [id],
  );
  return rows[0] || null;
}

async function requestByReference(db, reference) {
  // The newest completed request for a reference: an offer re-issued keeps its number per offer.
  const { rows } = await db.query(
    `SELECT ${REQUEST_COLS} FROM signature_request r
      WHERE lower(r.reference) = lower($1) AND r.status = 'completed'
      ORDER BY r.completed_at DESC, r.signature_request_id
      LIMIT 1`,
    [reference],
  );
  return rows[0] || null;
}

async function requestByVerifyKey(db, keyHash) {
  const { rows } = await db.query(`SELECT ${REQUEST_COLS} FROM signature_request r WHERE r.verify_key_hash = $1`, [keyHash]);
  return rows[0] || null;
}

async function requestBySealedDocument(db, documentId) {
  const { rows } = await db.query(`SELECT ${REQUEST_COLS} FROM signature_request r WHERE r.sealed_document_id = $1`, [documentId]);
  return rows[0] || null;
}

/** The open requests for a record (to end them when it is withdrawn). */
async function openRequestsFor(client, subjectType, subjectId) {
  const { rows } = await client.query(
    `SELECT ${REQUEST_COLS} FROM signature_request r
      WHERE r.subject_type = $1 AND r.subject_id = $2 AND r.status = 'pending'
      FOR UPDATE`,
    [subjectType, subjectId],
  );
  return rows;
}

async function signature(db, id, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${SIGNATURE_COLS} FROM signature s WHERE s.signature_id = $1${forUpdate ? " FOR UPDATE" : ""}`,
    [id],
  );
  return rows[0] || null;
}

async function signaturesOf(db, requestId) {
  const { rows } = await db.query(
    `SELECT ${SIGNATURE_COLS} FROM signature s WHERE s.signature_request_id = $1 ORDER BY s.position, s.signature_id`,
    [requestId],
  );
  return rows;
}

async function markViewed(client, signatureId) {
  const { rowCount } = await client.query(
    "UPDATE signature SET viewed_at = now() WHERE signature_id = $1 AND viewed_at IS NULL",
    [signatureId],
  );
  return rowCount === 1;
}

async function setCode(client, signatureId, { code_hash: hash, minutes }) {
  const { rows } = await client.query(
    `UPDATE signature
        SET code_hash = $2, code_expires_at = now() + make_interval(mins => $3), code_attempts = 0,
            code_sent_at = now(), code_verified_at = NULL
      WHERE signature_id = $1
      RETURNING code_sent_at, code_expires_at`,
    [signatureId, hash, minutes],
  );
  return rows[0];
}

async function countWrongCode(client, signatureId) {
  await client.query("UPDATE signature SET code_attempts = code_attempts + 1 WHERE signature_id = $1", [signatureId]);
}

async function markCodeVerified(client, signatureId) {
  await client.query(
    "UPDATE signature SET code_verified_at = now(), code_hash = NULL, code_attempts = 0 WHERE signature_id = $1",
    [signatureId],
  );
}

async function markSigned(client, signatureId, s) {
  const { rowCount } = await client.query(
    `UPDATE signature
        SET status = 'signed', signed_at = now(), signer_name = $2, signer_title = $3, method = $4,
            signature_document_id = $5, content_hash = $6, evidence = $7::jsonb
      WHERE signature_id = $1 AND status = 'pending'`,
    [signatureId, s.signer_name, s.signer_title || null, s.method, s.signature_document_id || null, s.content_hash, JSON.stringify(s.evidence)],
  );
  return rowCount === 1;
}

async function markSignatureEnded(client, requestId, status) {
  await client.query(
    "UPDATE signature SET status = $2 WHERE signature_request_id = $1 AND status = 'pending'",
    [requestId, status],
  );
}

async function markDeclined(client, signatureId) {
  await client.query("UPDATE signature SET status = 'declined' WHERE signature_id = $1 AND status = 'pending'", [signatureId]);
}

async function endRequest(client, requestId, status, reason) {
  const { rowCount } = await client.query(
    `UPDATE signature_request SET status = $2, end_reason = $3
      WHERE signature_request_id = $1 AND status = 'pending'`,
    [requestId, status, reason || null],
  );
  return rowCount === 1;
}

/** A pending request's end, set when the document is sent (an offer's expiry starts at Send Offer). */
async function setExpiry(client, requestId, expiresAt) {
  const { rowCount } = await client.query(
    "UPDATE signature_request SET expires_at = $2 WHERE signature_request_id = $1 AND status = 'pending'",
    [requestId, expiresAt],
  );
  return rowCount === 1;
}

async function completeRequest(client, requestId) {
  const { rowCount } = await client.query(
    "UPDATE signature_request SET status = 'completed', completed_at = now() WHERE signature_request_id = $1 AND status = 'pending'",
    [requestId],
  );
  return rowCount === 1;
}

async function setSealing(client, requestId, { sealed_document_id: docId, verify_key_hash: keyHash }) {
  await client.query(
    "UPDATE signature_request SET sealed_document_id = $2, verify_key_hash = $3 WHERE signature_request_id = $1",
    [requestId, docId, keyHash],
  );
}

async function setSealed(client, requestId, artifactHash) {
  const { rowCount } = await client.query(
    "UPDATE signature_request SET sealed_at = now() WHERE signature_request_id = $1 AND sealed_at IS NULL",
    [requestId],
  );
  await client.query(
    "UPDATE signature SET artifact_hash = $2 WHERE signature_request_id = $1 AND status = 'signed'",
    [requestId, artifactHash],
  );
  return rowCount === 1;
}

/** Pending requests past their end (signature-reminders ends them). */
async function lapsed(db) {
  const { rows } = await db.query(
    `SELECT r.signature_request_id FROM signature_request r
      WHERE r.status = 'pending' AND r.expires_at IS NOT NULL AND r.expires_at <= now()
      ORDER BY r.expires_at, r.signature_request_id
      LIMIT 200 -- pagination:batch the sweep ends at most 200 a run; the rest wait for the next`,
  );
  return rows.map((r) => r.signature_request_id);
}

module.exports = {
  insertRequest,
  insertSignature,
  request,
  requestByReference,
  requestByVerifyKey,
  requestBySealedDocument,
  openRequestsFor,
  signature,
  signaturesOf,
  markViewed,
  setCode,
  countWrongCode,
  markCodeVerified,
  markSigned,
  markSignatureEnded,
  markDeclined,
  endRequest,
  setExpiry,
  completeRequest,
  setSealing,
  setSealed,
  lapsed,
};
