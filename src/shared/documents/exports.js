"use strict";
/**
 * Export files: a file somebody pressed Export or Download for, made for them in the worker and
 * downloaded on the device they pressed it on (docs/guides/foundation.md §6.12). Nothing is
 * emailed. The vault keeps each one KEPT_HOURS, long enough to download it again, and the
 * export-cleanup job then removes it; who asked for what stays on the event log and the ledger.
 *
 * A module's export is a document type marked `export: true` (shared/documents/types.js; a PDF
 * passes it to defineDocType), restricted unless it says otherwise:
 *
 *   defineDocumentType("audit_export", { label: "Audit Log export", module: "settings",
 *     sensitivity: "restricted", export: true });
 *
 * In the request, inside its transaction, beside the module's own event:
 *
 *   const doc = await exportFiles.reserve(client, {
 *     doc_type: "audit_export",
 *     entity: { type: "audit_export", id: crypto.randomUUID() },
 *     file_name: exportFilename({ base: "audit-log", env, extension: "xlsx" }),
 *     actor,
 *   });
 *   await emit(client, { key: EVENTS.AUDIT_EXPORT_REQUESTED, ..., payload: { document_id: doc.document_id } });
 *   return exportFiles.present(doc);                 // answered 202, pending
 *
 * A PDF from a template is documents.generate() in the same place instead: it is pending the
 * same way, and the pdf-render job finishes it (never locked, being an export).
 *
 * In the worker, in the module's outbox handler, after commit:
 *
 *   await exportFiles.make(documentId, ctx, () => buildWorkbook(...));   // done: downloaded
 *   await exportFiles.fail(documentId, reason);     // the person may no longer have it
 *
 * make() builds only a file still pending, fills it with what build() returns, and leaves a
 * failure to the outbox to retry until its last attempt, which fails the file instead, so the
 * waiting screen stops. A handler run twice changes nothing.
 *
 * The screen waits on GET /exports/:id (status(): the person who asked, nobody else) and
 * downloads GET /documents/:id/content once it is done; the vault lets the uploader read it.
 */
const crypto = require("node:crypto");
const path = require("node:path");
const { atomically, inTransaction } = require("../db/tx");
const { AppError } = require("../errors");
const { emit } = require("../events/emit");
const { sha256 } = require("../files/hash");
const { storageKey, displayName } = require("../files/safe-name");
const { typeForExt } = require("../files/sniff");
const storage = require("../../services/storage/storage.service");
const docTypes = require("./types");
const vault = require("./vault");

/** How long an export file stays in the vault. */
const KEPT_HOURS = 24;

const defaultDb = () => require("../../config/db").pool;

async function tx(db, fn) {
  const client = await db.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** The registered export type, or a programming error: an export is declared before it is used. */
function exportType(docType) {
  const spec = docTypes.typeOf(docType);
  if (!spec || !spec.export)
    throw new Error(`exports: "${docType}" is not a document type marked export: true`);
  return spec;
}

/**
 * The file's document, pending, in the request's transaction: what the screen waits on.
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {{doc_type: string, entity: {type: string, id: string}, file_name: string,
 *          subject_employee_id?: string|null, title?: string, actor: {user_id: string}}} opts
 * @returns {Promise<object>} the document row, render_status "pending"
 */
async function reserve(client, { doc_type: docType, entity, file_name: fileName, subject_employee_id: subjectId = null, title, actor }) {
  if (!inTransaction(client)) throw new Error("exports.reserve must run inside atomically()");
  const spec = exportType(docType);
  if (!entity || !/^[a-z][a-z0-9_]*$/.test(String(entity.type || "")) || !entity.id)
    throw new Error("exports.reserve: entity { type, id } is required");
  if (!actor || !actor.user_id) throw new Error("exports.reserve: the person asking is required");
  const ext = path.extname(String(fileName || "")).slice(1).toLowerCase();
  const type = typeForExt(ext);
  if (type.ext !== ext) throw new Error(`exports.reserve: no file type for "${fileName}"`);
  return vault.insertRow(client, {
    document_id: crypto.randomUUID(),
    doc_type: docType,
    title: String(title || spec.label).trim().slice(0, 200),
    original_name: displayName(fileName, ext),
    storage_key: storageKey("generated", ext),
    mime: type.mime,
    bytes: 0,
    content_hash: null,
    version: 1,
    entity_type: entity.type,
    entity_id: String(entity.id),
    subject_employee_id: subjectId,
    sensitivity: spec.sensitivity,
    scan_status: "skipped",
    source: "generated",
    render_status: "pending",
    uploaded_by: actor.user_id,
  });
}

/**
 * The worker made the file: its bytes stored and the file done, so the screen waiting on it
 * downloads it. A file no longer pending (done, failed or removed) is left alone.
 * @param {string} documentId
 * @param {Buffer} buffer
 * @returns {Promise<object|null>} the done document, or null when there was nothing to fill
 */
async function fill(documentId, buffer, { db = defaultDb() } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error("exports.fill: the file is empty");
  const doc = await vault.get(db, documentId);
  if (!doc || doc.render_status !== "pending") return null;
  await storage.put(doc.storage_key, buffer, { overwrite: true });
  return tx(db, async (client) => {
    const { rows } = await client.query(
      `UPDATE document SET render_status = 'done', render_error = NULL, bytes = $2, content_hash = $3
        WHERE document_id = $1 AND render_status = 'pending'
        RETURNING ${vault.COLUMNS}`,
      [documentId, buffer.length, sha256(buffer)],
    );
    if (!rows[0]) return null;
    await emit(client, {
      key: vault.EVENTS.DOCUMENT_GENERATED,
      entity: { type: "document", id: documentId },
      module: vault.moduleFor(doc.entity_type),
      actor: null,
      payload: { document_id: documentId, doc_type: doc.doc_type, number: null, content_hash: rows[0].content_hash },
    });
    return rows[0];
  });
}

/**
 * The file cannot be made: failed, with why, so the screen waiting on it stops and says so. A
 * file no longer pending is left alone.
 * @param {string} documentId
 * @param {Error|string} reason
 */
function fail(documentId, reason, { db = defaultDb() } = {}) {
  return require("./generate").failRender(documentId, reason, { db });
}

/**
 * An outbox handler's work for one export: build() makes its bytes, which fill the file. A file
 * no longer pending is not built again. A failure is thrown back to the outbox to retry, except
 * on its last attempt, when the file is failed instead.
 * @param {string} documentId
 * @param {{attempt: number, max_attempts: number}|undefined} ctx  the outbox's
 * @param {() => Promise<Buffer>} build
 * @returns {Promise<object|null>} the done document, or null when there was nothing to make
 */
async function make(documentId, ctx, build, { db = defaultDb() } = {}) {
  const doc = await vault.get(db, documentId);
  if (!doc || doc.render_status !== "pending") return null;
  try {
    return await fill(documentId, await build(), { db });
  } catch (err) {
    if (!ctx || ctx.attempt < ctx.max_attempts) throw err;
    await fail(documentId, err, { db });
    return null;
  }
}

/**
 * The ExportFile a screen reads: the id it downloads by, the name it saves the file under,
 * and where it stands. A file stored whole, before exports were reserved, is done.
 * @param {object} doc  a document row
 */
function present(doc) {
  return {
    document_id: doc.document_id,
    file_name: doc.original_name,
    status: doc.render_status || "done",
  };
}

/**
 * GET /exports/:id: one of the caller's own export files, as the screen waiting on it reads it.
 * Anyone else's, a document that is not an export, or one already removed, is a 404.
 * @param {{user_id: string}} user
 * @param {string} documentId
 */
async function status(user, documentId, { db = defaultDb() } = {}) {
  const doc = await vault.get(db, documentId);
  if (!doc || !docTypes.isExport(doc.doc_type) || !user || doc.uploaded_by !== user.user_id)
    throw new AppError("NOT_FOUND", "Not found", 404);
  return present(doc);
}

/**
 * The export-cleanup job: every export file older than KEPT_HOURS leaves the vault, its row with
 * `document.removed` on the record, then its bytes. A report run's file is not an export: it
 * stays on Recent Runs.
 * @param {Date} [now]
 * @returns {Promise<{removed: number}>}
 */
async function purgeExpired(now = new Date(), { db = defaultDb() } = {}) {
  const types = docTypes.exportTypes();
  if (types.length === 0) return { removed: 0 };
  const { rows } = await db.query(
    `SELECT document_id FROM document
      WHERE doc_type = ANY($1::text[]) AND created_at < $2::timestamptz - make_interval(hours => $3::int)
      ORDER BY created_at, document_id`,
    [types, now.toISOString(), KEPT_HOURS],
  );
  let removed = 0;
  for (const { document_id: id } of rows) {
    const keys = await tx(db, (client) => vault.remove(client, id, { reason: `kept ${KEPT_HOURS} hours` }));
    if (!keys) continue;
    await vault.removeFiles(keys);
    removed += 1;
  }
  return { removed };
}

module.exports = { KEPT_HOURS, reserve, fill, fail, make, present, status, purgeExpired };
