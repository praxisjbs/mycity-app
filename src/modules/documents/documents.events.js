"use strict";
/**
 * What the documents module records, and the document types it stores under.
 *
 * The vault emits the file's own life (stored, superseded, locked, scanned); this
 * file adds the two things People and the employee do with a document: ask for one
 * and accept one. A request is a notification to the person it is about, so it
 * reaches them wherever they are rather than waiting to be noticed on a screen.
 */
const { defineEvents } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");
const { defineDocumentType } = require("../../shared/documents/types");

const EVENTS = defineEvents("people", {
  "document.requested": { summary: "A document was asked for" },
  "document.request_cancelled": { summary: "A document request was withdrawn" },
  "document.verified": { summary: "A document was accepted" },
});

/**
 * The person asked is told, so a Missing row is not something they have to notice.
 * The notice opens their own record, where they can answer it.
 */
defineNotification(EVENTS.DOCUMENT_REQUESTED, {
  to: [{ subject: true }],
  title: "A document is needed",
  body: (e) => `${e.payload.title}. Upload it from My Documents.`,
});

/**
 * The types this module stores under. A module that owns records of its own
 * registers its types beside its events; these are the ones that belong to a
 * person rather than to a record somewhere else.
 *
 * `module` decides who may open the file: an employee document follows the People
 * grant, within scope, and the employee it is about always sees their own
 * (shared/documents/vault.js canRead).
 */
const EMPLOYEE_DOC_TYPE = "employee_document";
const STAGED_DOC_TYPE = "staged_upload";

defineDocumentType(EMPLOYEE_DOC_TYPE, {
  label: "Employee document",
  module: "people",
  sensitivity: "personal",
});

defineDocumentType("employee_identification", {
  label: "Identification",
  module: "people",
  sensitivity: "restricted",
});

defineDocumentType("employee_certificate", {
  label: "Certificate",
  module: "people",
  sensitivity: "personal",
});

/**
 * A file on its way to a record that does not exist yet: a voice note before the
 * message is sent, a photograph before the form is saved. It belongs to whoever
 * uploaded it and to nobody else until the record claims it.
 */
defineDocumentType(STAGED_DOC_TYPE, {
  label: "Upload",
  module: "ess",
  sensitivity: "personal",
});

/** The types an employee document may be stored under, the first being the default. */
const EMPLOYEE_DOC_TYPES = Object.freeze([
  EMPLOYEE_DOC_TYPE,
  "employee_certificate",
  "employee_identification",
]);

module.exports = {
  EVENTS,
  EMPLOYEE_DOC_TYPE,
  EMPLOYEE_DOC_TYPES,
  STAGED_DOC_TYPE,
};
