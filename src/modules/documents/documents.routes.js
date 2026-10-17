"use strict";
/**
 * Documents (BACKEND_STRUCTURE §5, docs/guides/foundation.md §5).
 *
 * The module mounts at the API root rather than under one prefix, because the
 * documents of a record are read where that record is: `/employees/:id/documents`
 * belongs to this module, not to People, whose module owns the employee itself
 * (track A). `/documents/:id/...` is the file; `/employees/:id/documents` is the
 * list a person sees on a record.
 *
 * Who may do what:
 *   POST /documents                    any signed-in employee, for their own upload
 *   GET  /documents/:id*               vault.canRead decides, per document; a
 *                                      document the caller may not read is a 404
 *   /employees/:id/documents           `people`, within the caller's scope
 *   POST /documents/:id/verify         `people` edit: accepting what arrived
 *
 * A route that streams bytes declares `no_content: true`, not a response schema:
 * its answer is a file, so there is no JSON shape for the generated contract to
 * describe, and the frontend reaches it by URL (an <img>, the PDF preview, a
 * download), never through the typed client.
 *
 * Reading a file is NOT a permission on this module: it follows the module that
 * owns the document, and the employee a document is about always sees their own
 * (shared/documents/vault.js). So the read routes carry `self: true` and the
 * vault answers; a grant check here would be a second, weaker rule.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const upload = require("../../middleware/upload");
const controller = require("./documents.controller");

const router = express.Router();
const peopleView = requirePermission("people", "view");
const peopleEdit = requirePermission("people", "edit");

/* The vault's own routes: one file, its sizes and its versions. */

route(router, "post", "/documents",
  { body: c.documents.DocumentUpload, response: c.documents.DocumentRef, self: true,
    summary: "Upload a file before the record that will hold it exists" },
  upload.single("file", { purpose: "attachment" }), controller.upload);

route(router, "get", "/documents/:id",
  { response: c.documents.Document, self: true, summary: "One document" },
  controller.get);

route(router, "get", "/documents/:id/content",
  { no_content: true, self: true, summary: "The file itself" },
  controller.content);

route(router, "get", "/documents/:id/variant/:kind",
  { params: c.documents.VariantParams, no_content: true, self: true,
    summary: "A derived size of an image, or a playable voice note" },
  controller.variant);

route(router, "get", "/documents/:id/versions",
  { query: c.documents.DocumentVersionQuery, response: c.documents.DocumentVersionPage, self: true,
    summary: "Every version of a document" },
  controller.versions);

route(router, "post", "/documents/:id/versions",
  { body: c.documents.DocumentUpload, response: c.documents.Document, self: true,
    summary: "Replace a document with a new version" },
  upload.single("file", { purpose: "document" }), controller.addVersion);

route(router, "post", "/documents/:id/verify",
  { body: c.common.EmptyBody, response: c.documents.Document,
    summary: "Accept a document somebody uploaded" },
  peopleEdit, controller.verify);

/* An employee's documents, as People see them on the record. */

route(router, "get", "/employees/:id/documents",
  { query: c.documents.DocumentListQuery, response: c.documents.DocumentListPage,
    summary: "An employee's documents" },
  peopleView, controller.employeeDocuments);

route(router, "get", "/employees/:id/documents/summary",
  { response: c.documents.DocumentSummary, summary: "Counts above an employee's documents" },
  peopleView, controller.employeeSummary);

route(router, "post", "/employees/:id/documents",
  { body: c.documents.EmployeeDocumentUpload, response: c.documents.DocumentRow,
    summary: "File a document on an employee's record" },
  peopleEdit, upload.single("file", { purpose: "document" }), controller.addEmployeeDocument);

route(router, "post", "/employees/:id/document-requests",
  { body: c.documents.DocumentRequestCreate, response: c.documents.DocumentRow,
    summary: "Ask an employee for a document" },
  peopleEdit, controller.requestEmployeeDocument);

module.exports = { basePath: "/", surface: "staff", router };
