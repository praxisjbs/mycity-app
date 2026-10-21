"use strict";
/**
 * Documents: who may see a file, and what People and the employee do with one.
 *
 * Every byte goes through the vault (shared/documents/vault.js): the type is read
 * from the bytes, an image is re-encoded and stripped of its metadata, a voice
 * note gets a playable variant, the master is hashed as stored, and the row is
 * written inside the caller's transaction. Nothing here touches a path, and the
 * files directory is not served: a document is reached only through a route that
 * asks vault.canRead first, and a document the caller may not read is a 404.
 *
 * Three ways a file arrives:
 *
 *   POST /documents                    a file on its way to a record that does not
 *                                      exist yet. It belongs to whoever uploaded it.
 *   POST /employees/:id/documents      People file a document on someone's record
 *   POST /ess/documents                the employee files their own
 *
 * The last two answer a Vault list row. A request People made (the Missing row)
 * is answered by naming it on the upload, so the ask becomes the document rather
 * than a second record with a similar name.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const vault = require("../../shared/documents/vault");
const exportFiles = require("../../shared/documents/exports");
const { UPLOAD_CAPS, describeBytes } = require("../../shared/http/body-limits");
const docTypes = require("../../shared/documents/types");
const c = require("@mycity/contract");
const repo = require("./documents.repo");
const {
  EVENTS,
  EMPLOYEE_DOC_TYPE,
  EMPLOYEE_DOC_TYPES,
  STAGED_DOC_TYPE,
} = require("./documents.events");

const EXPIRING_DAYS = c.documents.EXPIRING_WITHIN_DAYS;

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** What an upload answers with: the id a record stores, and the tray's line. */
const refOf = (doc) => ({
  document_id: doc.document_id,
  file_name: doc.original_name || doc.title || "upload",
  size_bytes: Number(doc.bytes) || 0,
  mime_type: doc.mime,
});

const requireFile = (file) => {
  if (!file)
    throw new AppError("FILE_REQUIRED", "Choose a file to upload", 422, {
      file: ["is required"],
    });
  return file;
};

/* ------------------------------------------------------------------ *
 * Reading one document
 * ------------------------------------------------------------------ */

/** The document, or a 404 when it does not exist OR this caller may not read it. */
async function readable(user, documentId) {
  const doc = await vault.getReadable(pool, user, documentId);
  return doc;
}

/** The row a screen shows, with the same 404 rule. */
async function get(user, documentId) {
  await readable(user, documentId);
  return repo.get(pool, documentId);
}

/** GET /exports/:id: an export the caller asked for, while their screen waits for its file. */
const exportFile = (user, documentId) => exportFiles.status(user, documentId);

/** A document's versions, oldest kept, newest first. */
async function versions(user, documentId, query) {
  const doc = await readable(user, documentId);
  const head = doc.is_current ? doc.document_id : await repo.headOf(pool, documentId);
  return repo.versions(pool, head, query);
}

/* ------------------------------------------------------------------ *
 * The Vault list
 * ------------------------------------------------------------------ */

/**
 * Whose documents this caller may list on an employee's record. `all` sees
 * anyone, `team` their team, `own` only themselves, exactly as the employee
 * list behaves.
 */
function withinScope(employeeId, req) {
  if (req.scope === "all") return [employeeId];
  const ids = req.scope_ids || [];
  if (!ids.includes(employeeId))
    throw new AppError("NOT_FOUND", "That employee does not exist, or you cannot see them", 404);
  return [employeeId];
}

const listFor = (employeeIds, query) =>
  repo.vault(pool, employeeIds, query, EXPIRING_DAYS);

const summaryFor = (employeeIds) =>
  repo.summary(pool, employeeIds, EXPIRING_DAYS);

/** The one row of the Vault list a document is, for a 201 answer. */
async function rowOf(employeeId, documentId) {
  const page = await repo.vault(
    pool,
    [employeeId],
    { page: 1, q: null },
    EXPIRING_DAYS,
  );
  const row = page.data.find((r) => r.document_id === documentId);
  if (row) return row;
  // Past the first page of a long vault: read the document and shape the row.
  const doc = await repo.get(pool, documentId);
  return {
    row_key: `doc:${doc.document_id}`,
    document_id: doc.document_id,
    document_request_id: null,
    name: doc.title || doc.original_name || doc.doc_type,
    status: doc.locked_at ? "signed" : "awaiting_verification",
    uploaded_at: doc.created_at,
    expires_on: doc.expires_on,
    number: doc.number,
    mime: doc.mime,
    bytes: doc.bytes,
    version: doc.version,
  };
}

/* ------------------------------------------------------------------ *
 * Uploading
 * ------------------------------------------------------------------ */

/**
 * What a staged file is for. The route takes the widest envelope so one upload
 * path carries a photograph, a scan and a voice note; the purpose the caller
 * names decides the type allow-list, the size cap and the pipeline the vault
 * runs, so a 20 MB "avatar" is still refused.
 */
function purposeFor(asked) {
  const purpose = asked || "document";
  if (!UPLOAD_CAPS[purpose])
    throw new AppError("UNKNOWN_PURPOSE", "Pick what the file is for", 422, {
      purpose: ["is not a kind of upload"],
    });
  return purpose;
}

/**
 * A file with no record yet. It is stored against the uploader, so only they
 * (and the CEO) can read it until something claims it.
 */
async function stage(file, body, actor) {
  requireFile(file);
  const purpose = purposeFor(body.purpose);
  if (file.size > UPLOAD_CAPS[purpose])
    throw new AppError(
      "FILE_TOO_LARGE",
      `That file is larger than ${describeBytes(UPLOAD_CAPS[purpose])}. Choose a smaller file.`,
      413,
    );
  const doc = await tx((client) =>
    vault.store(client, {
      file,
      purpose,
      doc_type: STAGED_DOC_TYPE,
      title: body.title || null,
      entity: { type: "app_user", id: actor.user_id },
      subject_employee_id: actor.employee_id || null,
      expires_on: body.expires_on || null,
      actor,
    }),
  );
  return refOf(doc);
}

/** The doc type an employee document is filed under; People may name a narrower one. */
function employeeDocType(asked) {
  if (!asked) return EMPLOYEE_DOC_TYPE;
  if (!EMPLOYEE_DOC_TYPES.includes(asked))
    throw new AppError("UNKNOWN_DOC_TYPE", "Pick a document type", 422, {
      doc_type: ["is not an employee document type"],
    });
  return asked;
}

/**
 * File a document on an employee's record. `request_id` answers a document
 * People asked for.
 * @param {{employee_id: string, file: object, body: object, actor: object, requestId?: string}} opts
 */
async function addEmployeeDocument({ employeeId, file, body, actor, requestId }) {
  requireFile(file);
  const subject = await repo.subjectOf(pool, employeeId);
  if (!subject)
    throw new AppError("NOT_FOUND", "That employee does not exist", 404);

  let request = null;
  if (requestId) {
    request = await repo.requestOf(pool, requestId);
    if (!request || request.employee_id !== employeeId)
      throw new AppError("NOT_FOUND", "That request does not exist", 404);
    if (request.fulfilled_at || request.cancelled_at)
      throw new AppError(
        "DOCUMENT_REQUEST_CLOSED",
        "That document has already been given",
        409,
      );
  }

  const doc = await tx(async (client) => {
    const stored = await vault.store(client, {
      file,
      purpose: file.purpose,
      doc_type: employeeDocType(
        body.doc_type || (request && request.doc_type) || null,
      ),
      title: body.title || (request && request.title) || null,
      entity: { type: "employee", id: employeeId },
      subject_employee_id: employeeId,
      expires_on: body.expires_on || null,
      actor,
    });
    if (request) await repo.fulfilRequest(client, request.document_request_id, stored.document_id);
    return stored;
  });
  return rowOf(employeeId, doc.document_id);
}

/** Replace a document with a new version. A locked document is refused by the vault. */
async function addVersion(user, documentId, file, body) {
  requireFile(file);
  const current = await readable(user, documentId);
  if (!current.is_current)
    throw new AppError(
      "DOCUMENT_SUPERSEDED",
      "A newer version of this document already exists",
      409,
    );
  const next = await tx((client) =>
    vault.supersede(client, {
      document_id: documentId,
      file,
      purpose: file.purpose,
      title: body.title || current.title,
      actor: user,
    }),
  );
  return repo.get(pool, next.document_id);
}

/* ------------------------------------------------------------------ *
 * Asking for one, and accepting one
 * ------------------------------------------------------------------ */

/** People ask an employee for a document; it shows as Missing until it arrives. */
async function requestDocument(employeeId, body, actor) {
  const subject = await repo.subjectOf(pool, employeeId);
  if (!subject)
    throw new AppError("NOT_FOUND", "That employee does not exist", 404);
  if (body.doc_type && !docTypes.typeOf(body.doc_type))
    throw new AppError("UNKNOWN_DOC_TYPE", "Pick a document type", 422, {
      doc_type: ["is not a document type"],
    });

  const request = await tx(async (client) => {
    const row = await repo.createRequest(client, {
      employee_id: employeeId,
      doc_type: body.doc_type || null,
      title: body.name,
      note: body.note || null,
      actor,
    });
    await emit(client, {
      key: EVENTS.DOCUMENT_REQUESTED,
      entity: { type: "employee", id: employeeId },
      module: "people",
      actor,
      after: row,
      payload: {
        document_request_id: row.document_request_id,
        employee_id: employeeId,
        subject_employee_id: employeeId,
        title: row.title,
      },
    });
    return row;
  });
  return {
    row_key: `req:${request.document_request_id}`,
    document_id: null,
    document_request_id: request.document_request_id,
    name: request.title,
    status: "missing",
    uploaded_at: null,
    expires_on: null,
    number: null,
    mime: null,
    bytes: null,
    version: null,
  };
}

/** People accept a document that was uploaded. */
async function verify(user, documentId) {
  const doc = await readable(user, documentId);
  if (!doc.subject_employee_id)
    throw new AppError(
      "NOT_AN_EMPLOYEE_DOCUMENT",
      "Only a document that belongs to an employee is verified here",
      422,
    );
  await tx(async (client) => {
    const marked = await repo.markVerified(client, documentId, user);
    if (!marked) return;
    await emit(client, {
      key: EVENTS.DOCUMENT_VERIFIED,
      entity: { type: "employee", id: doc.subject_employee_id },
      module: "people",
      actor: user,
      payload: {
        document_id: documentId,
        employee_id: doc.subject_employee_id,
        subject_employee_id: doc.subject_employee_id,
      },
    });
  });
  return repo.get(pool, documentId);
}

/* ------------------------------------------------------------------ *
 * Serving the bytes
 * ------------------------------------------------------------------ */

/** Stream a document, or one of its derived sizes, to a caller who may read it. */
async function serve(req, res, { documentId, variantKind = null, inline = false }) {
  const doc = await vault.getReadable(pool, req.user, documentId);
  let variant = null;
  if (variantKind) {
    variant = await vault.variantOf(pool, documentId, variantKind);
    if (!variant)
      throw new AppError("NOT_FOUND", "That size does not exist", 404);
  }
  return vault.serve(req, res, doc, { variant, inline });
}

module.exports = {
  EXPIRING_DAYS,
  purposeFor,
  refOf,
  get,
  exportFile,
  versions,
  withinScope,
  listFor,
  summaryFor,
  rowOf,
  stage,
  addEmployeeDocument,
  addVersion,
  requestDocument,
  verify,
  serve,
};
