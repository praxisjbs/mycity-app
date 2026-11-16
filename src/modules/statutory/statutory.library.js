"use strict";
/**
 * The Document Centre's statutory files (docs/guides/document-centre.md §6.2): the source a statutory
 * rate cites, and a joiner's leaving certificate from their last employer, both by the vault's
 * default rule (restricted: Payroll's `edit`, the employee it is about or whoever filed it).
 */
const { librarySource, employeeName, staffNumber } = require("../../shared/documents/library");
const { SOURCE_DOC_TYPE, CERTIFICATE_DOC_TYPE } = require("./statutory.events");

const RATE = "statutory_rate sr WHERE sr.statutory_rate_id = d.entity_id::uuid";

module.exports = [
  librarySource({
    area: "payroll",
    types: { [SOURCE_DOC_TYPE]: "Statutory Source" },
    entity: "statutory_return",
    record: {
      type: "'statutory_return'",
      id: "d.entity_id",
      label: `(SELECT sr.source_title FROM ${RATE})`,
      ref: `(SELECT sr.source_section FROM ${RATE})`,
    },
    listed: `EXISTS (SELECT 1 FROM ${RATE} AND sr.source_document_id = d.document_id)`,
    default: true,
  }),
  librarySource({
    area: "payroll",
    types: { [CERTIFICATE_DOC_TYPE]: "Leaving Certificate" },
    // Stored against the person's pay record, whose id is the employee's.
    entity: "salary_structure",
    record: {
      type: "'employee'",
      id: "d.entity_id",
      label: employeeName("d.entity_id::uuid"),
      ref: staffNumber("d.entity_id::uuid"),
    },
    listed: "EXISTS (SELECT 1 FROM employee_pay_to_date t WHERE t.employee_id = d.entity_id::uuid AND t.document_id = d.document_id)",
    default: true,
  }),
];
