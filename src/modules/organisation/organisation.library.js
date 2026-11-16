"use strict";
/**
 * The Document Centre's rent evidence (docs/guides/document-centre.md §6.2): what a person gave for
 * their declared rent, filed on their record, by the vault's default rule (restricted: People's
 * `edit`, the employee or whoever filed it).
 */
const { librarySource, employeeName, staffNumber } = require("../../shared/documents/library");
const { RENT_EVIDENCE_DOC_TYPE } = require("./organisation.events");

module.exports = librarySource({
  area: "people",
  types: { [RENT_EVIDENCE_DOC_TYPE]: "Rent Evidence" },
  entity: "employee",
  record: {
    type: "'employee'",
    id: "d.entity_id",
    label: employeeName("d.entity_id::uuid"),
    ref: staffNumber("d.entity_id::uuid"),
  },
  default: true,
});
