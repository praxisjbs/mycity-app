"use strict";
/**
 * The Document Centre's proposals (docs/guides/document-centre.md §6.2): the PDF of a proposal as it
 * was sent, by the vault's default rule (§13, question 5: a reader whose Partnerships scope is not
 * `all` cannot open a proposal's file, so does not find it here either).
 */
const { librarySource } = require("../../shared/documents/library");
require("./proposals.events");

const OF = "partnership_proposal pp WHERE pp.partnership_proposal_id = d.entity_id::uuid";

module.exports = librarySource({
  area: "partnerships",
  types: { proposal: "Proposal" },
  entity: "partnership_proposal",
  record: {
    type: "'proposal'",
    id: "d.entity_id",
    label: `(SELECT COALESCE(p.name, l.name) FROM partnership_proposal pp
               JOIN partnership_opportunity po ON po.partnership_opportunity_id = pp.partnership_opportunity_id
               LEFT JOIN partner p ON p.partner_id = po.partner_id
               LEFT JOIN lead l ON l.lead_id = po.lead_id
              WHERE pp.partnership_proposal_id = d.entity_id::uuid)`,
    ref: `(SELECT pp.number::text FROM ${OF})`,
  },
  listed: `EXISTS (SELECT 1 FROM ${OF} AND pp.document_id = d.document_id)`,
  default: true,
});
