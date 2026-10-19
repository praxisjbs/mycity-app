"use strict";
/**
 * Documents: every file the system keeps, uploaded or generated, as the API
 * carries it (BACKEND_STRUCTURE §5). A module never names a path or a file; it
 * names a `document_id`, and the bytes are reached only through a route that
 * checks who is asking.
 *
 * Three shapes travel:
 *
 *   DocumentRef    what an upload answers with: the id a record stores, and
 *                  enough to draw the file in the upload tray
 *   Document       one document as a screen lists it, with its version chain
 *   DocumentRow    the Vault list on My Documents and an employee's record: a
 *                  document that is held, OR one that was asked for and not
 *                  yet given (status "missing")
 *
 * Statuses a person reads, derived rather than stored (one per row):
 *   missing                a document asked for, not yet uploaded
 *   signed                 locked: signed, sent or filed, and never replaceable
 *   expiring               its expiry is inside EXPIRING_WITHIN_DAYS
 *   verified               People have checked it
 *   awaiting_verification  uploaded, not yet checked
 */
const { z } = require("zod");
const {
  uuid,
  text,
  optionalText,
  isoDate,
  isoDateTime,
  listQuery,
  Paged,
} = require("./common");

/** A document is Expiring once its expiry is this close (foundation.md §6.9). */
const EXPIRING_WITHIN_DAYS = 60;

/** What a file is for. The same names as the size caps and the type allow-list. */
const UploadPurpose = z.enum([
  "avatar",
  "photo",
  "document",
  "voice_note",
  "video",
  "attachment",
  "signature",
  "brand",
]);

const DocumentSensitivity = z.enum(["normal", "personal", "restricted"]);
const DocumentScanStatus = z.enum(["clean", "pending", "infected", "skipped"]);
const DocumentSource = z.enum(["upload", "generated", "import"]);
const DocumentStatus = z.enum([
  "missing",
  "signed",
  "expiring",
  "verified",
  "awaiting_verification",
]);

/**
 * POST /documents, POST /ess/documents, POST /employees/:id/documents and
 * POST /documents/:id/versions: the text fields beside the file in the
 * multipart. The route fixes the purpose it will store under; the field is what
 * the upload field sent and is only read for the message when a type is refused.
 */
const DocumentUpload = z
  .object({
    purpose: UploadPurpose.optional(),
    title: optionalText(200),
    expires_on: isoDate.optional(),
  })
  .strict();

/**
 * POST /employees/:id/documents: the same, plus what only People can say — the
 * type it is filed under, and the request it answers.
 */
const EmployeeDocumentUpload = z
  .object({
    purpose: UploadPurpose.optional(),
    title: optionalText(200),
    expires_on: isoDate.optional(),
    doc_type: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,63}$/, "Pick a document type")
      .optional(),
    document_request_id: uuid.optional(),
  })
  .strict();

/** The answer to an upload: what a record stores, and what the tray draws. */
const DocumentRef = z
  .object({
    document_id: uuid,
    file_name: z.string(),
    size_bytes: z.number().int().min(0),
    mime_type: z.string(),
  })
  .strict();

/** One document. `storage_key` never crosses the wire. */
const Document = z
  .object({
    document_id: uuid,
    doc_type: z.string(),
    title: z.string().nullable(),
    original_name: z.string().nullable(),
    mime: z.string(),
    bytes: z.number().int().min(0),
    content_hash: z.string().nullable(),
    version: z.number().int().min(1),
    is_current: z.boolean(),
    entity_type: z.string().nullable(),
    entity_id: z.string().nullable(),
    subject_employee_id: uuid.nullable(),
    sensitivity: DocumentSensitivity,
    scan_status: DocumentScanStatus,
    source: DocumentSource,
    number: z.string().nullable(),
    locked_at: isoDateTime.nullable(),
    expires_on: isoDate.nullable(),
    verified_at: isoDateTime.nullable(),
    uploaded_by_name: z.string().nullable(),
    created_at: isoDateTime,
  })
  .strict();

/** GET /documents/:id/versions: the chain, newest version first. */
const DocumentVersionQuery = listQuery({}, ["version"]);
const DocumentVersionPage = Paged(Document);

/** GET /documents/:id/variant/:kind */
const VariantParams = z
  .object({
    id: uuid,
    kind: z
      .string()
      .regex(/^[a-z][a-z0-9-]{1,31}$/, "Pick a size that exists"),
  })
  .strict();

/**
 * One row of the Vault list. A row is a document, or a document that was asked
 * for and is still missing; exactly one of the two ids is set.
 */
const DocumentRow = z
  .object({
    row_key: z.string(),
    document_id: uuid.nullable(),
    document_request_id: uuid.nullable(),
    name: z.string(),
    status: DocumentStatus,
    uploaded_at: isoDateTime.nullable(),
    expires_on: isoDate.nullable(),
    number: z.string().nullable(),
    mime: z.string().nullable(),
    bytes: z.number().int().min(0).nullable(),
    version: z.number().int().min(1).nullable(),
  })
  .strict();

const DocumentListQuery = listQuery({ status: DocumentStatus.optional() }, [
  "uploaded_at",
  "name",
]);
const DocumentListPage = Paged(DocumentRow);

/** The counts above the Vault list. */
const DocumentSummary = z
  .object({
    documents: z.number().int().min(0),
    signed: z.number().int().min(0),
    verified: z.number().int().min(0),
    expiring: z.number().int().min(0),
    missing: z.number().int().min(0),
  })
  .strict();

/** POST /employees/:id/document-requests: ask an employee for a document. */
const DocumentRequestCreate = z
  .object({
    name: text(120),
    doc_type: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,63}$/, "Pick a document type")
      .optional(),
    note: optionalText(500),
  })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  DocumentUpload: {
    table: null,
    reason: "the text fields beside a file in a multipart upload",
  },
  EmployeeDocumentUpload: {
    table: null,
    reason: "the text fields beside a file when People file an employee's document",
  },
  DocumentRef: {
    table: "document",
    virtual: {
      file_name: "document.original_name, as the upload tray shows it",
      size_bytes: "document.bytes, named as the upload field reads it",
      mime_type: "document.mime, named as the upload field reads it",
    },
  },
  Document: {
    table: "document",
    virtual: {
      uploaded_by_name: "the uploader's name, joined from app_user and employee",
    },
  },
  DocumentVersionQuery: {
    table: null,
    reason: "list controls for a document's version chain",
  },
  DocumentVersionPage: { table: null, reason: "a page of versions" },
  VariantParams: {
    table: null,
    reason: "the :id and :kind of a derived file's path",
  },
  DocumentRow: {
    table: null,
    reason:
      "one row of the Vault list: a document row, or an outstanding document_request",
  },
  DocumentListQuery: {
    table: null,
    reason: "list controls and the status filter for the Vault list",
  },
  DocumentListPage: { table: null, reason: "a page of the Vault list" },
  DocumentSummary: {
    table: null,
    reason: "the counts above the Vault list, from document and document_request",
  },
  DocumentRequestCreate: {
    table: "document_request",
    virtual: {
      name: "document_request.title, as the person types it",
    },
  },
};

module.exports = {
  TABLES,
  EXPIRING_WITHIN_DAYS,
  UploadPurpose,
  DocumentSensitivity,
  DocumentScanStatus,
  DocumentSource,
  DocumentStatus,
  DocumentUpload,
  EmployeeDocumentUpload,
  DocumentRef,
  Document,
  DocumentVersionQuery,
  DocumentVersionPage,
  VariantParams,
  DocumentRow,
  DocumentListQuery,
  DocumentListPage,
  DocumentSummary,
  DocumentRequestCreate,
};
