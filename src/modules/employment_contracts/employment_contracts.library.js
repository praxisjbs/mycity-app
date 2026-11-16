"use strict";
/**
 * The Document Centre's employment contracts (docs/guides/document-centre.md §6.2): the contract a
 * hire holds now (its sealed copy once signed), by the vault's default rule. It belongs to the
 * employee it made.
 */
const { librarySource, employeeName } = require("../../shared/documents/library");
const { DOC_TYPE } = require("./employment_contracts.events");

const OF = "employment_contract ct WHERE ct.employment_contract_id = d.entity_id::uuid";

module.exports = librarySource({
  area: "recruitment",
  types: { [DOC_TYPE]: "Employment Contract" },
  entity: "employment_contract",
  record: {
    type: "'employee'",
    id: `(SELECT ct.employee_id FROM ${OF})`,
    label: `(SELECT COALESCE(${employeeName("ct.employee_id")}, ct.hire_name) FROM ${OF})`,
    ref: `(SELECT ct.number::text FROM ${OF})`,
  },
  listed: `EXISTS (SELECT 1 FROM ${OF} AND ct.document_id = d.document_id)`,
  default: true,
});
