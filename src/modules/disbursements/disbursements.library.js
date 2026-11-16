"use strict";
/**
 * The Document Centre's disbursement receipts (docs/guides/document-centre.md §6.2): the proof of
 * payment a disbursement holds, by the vault's default rule.
 */
const { librarySource } = require("../../shared/documents/library");
const { RECEIPT_DOC_TYPE } = require("./disbursements.events");

const OF = "disbursement ds WHERE ds.disbursement_id = d.entity_id::uuid";

module.exports = librarySource({
  area: "expenses",
  types: { [RECEIPT_DOC_TYPE]: "Disbursement Receipt" },
  entity: "disbursement",
  record: {
    type: "'disbursement'",
    id: "d.entity_id",
    label: `(SELECT ds.recipient_name FROM ${OF})`,
    ref: `(SELECT ds.number::text FROM ${OF})`,
  },
  listed: `EXISTS (SELECT 1 FROM ${OF} AND ds.receipt_document_id = d.document_id)`,
  default: true,
});
