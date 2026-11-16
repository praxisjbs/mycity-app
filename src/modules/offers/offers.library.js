"use strict";
/**
 * The Document Centre's offer letters (docs/guides/document-centre.md §6.2): the letter an offer
 * holds now (its sealed copy once signed), by the vault's default rule.
 */
const { librarySource } = require("../../shared/documents/library");
const { DOC_TYPE } = require("./offers.events");

const OF = "offer o WHERE o.offer_id = d.entity_id::uuid";

module.exports = librarySource({
  area: "recruitment",
  types: { [DOC_TYPE]: "Offer Letter" },
  entity: "offer",
  record: {
    type: "'offer'",
    id: "d.entity_id",
    label: `(SELECT trim(c.first_name || ' ' || c.last_name) FROM offer o
               JOIN application ap ON ap.application_id = o.application_id
               JOIN candidate c ON c.candidate_id = ap.candidate_id
              WHERE o.offer_id = d.entity_id::uuid)`,
    ref: `(SELECT o.number::text FROM ${OF})`,
  },
  listed: `EXISTS (SELECT 1 FROM ${OF} AND o.document_id = d.document_id)`,
  default: true,
});
