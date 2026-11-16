"use strict";
/**
 * The Document Centre's staff record documents (docs/guides/document-centre.md §6.2): what is filed
 * on an employee's record (a document, an identification, a certificate), by the vault's default
 * rule: the employee, whoever filed it, and People within their scope; an identification also
 * needs People's `edit`.
 */
const { librarySource, employeeName, staffNumber } = require("../../shared/documents/library");
require("./documents.events");

module.exports = librarySource({
  area: "people",
  types: {
    employee_document: "Employee Document",
    employee_identification: "Identification",
    employee_certificate: "Certificate",
  },
  entity: "employee",
  record: {
    type: "'employee'",
    id: "d.entity_id",
    label: employeeName("d.entity_id::uuid"),
    ref: staffNumber("d.entity_id::uuid"),
  },
  default: true,
});
