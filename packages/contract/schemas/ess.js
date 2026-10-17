"use strict";
/**
 * Employee Self-Service: the caller's own record, nothing else. Every route is
 * for the person signed in; there is no parameter that names another employee
 * (docs/guides/ess.md §6).
 *
 * My Documents is the first tab on the real API. Its list, its counts and the
 * document it opens are the shared document shapes (`schemas/documents.js`),
 * because a document is the same record whether the employee or People is
 * looking at it; only who may see it differs. What this file adds is the one
 * thing an employee's upload carries that People's does not: the request it
 * answers.
 *
 * The rest of ESS (profile, payslips, leave, queries, performance) arrives with
 * its own milestones; its shapes belong here when they do.
 */
const { z } = require("zod");
const { uuid, optionalText, isoDate } = require("./common");
const { UploadPurpose } = require("./documents");

/**
 * POST /ess/documents: the text fields beside the file. `document_request_id`
 * answers a document People asked for, so the Missing row becomes that upload
 * instead of a second record with a similar name.
 */
const EssDocumentUpload = z
  .object({
    purpose: UploadPurpose.optional(),
    title: optionalText(200),
    expires_on: isoDate.optional(),
    document_request_id: uuid.optional(),
  })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  EssDocumentUpload: {
    table: null,
    reason:
      "the text fields beside a file when an employee uploads their own document",
  },
};

module.exports = {
  TABLES,
  EssDocumentUpload,
};
