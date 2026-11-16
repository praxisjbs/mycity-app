"use strict";
/**
 * The Document Centre's expense invoices (docs/guides/document-centre.md §6.2): the invoice a request
 * holds, by the vault's default rule.
 */
const { librarySource } = require("../../shared/documents/library");
const { INVOICE_DOC_TYPE } = require("./expenses.events");

const OF = "expense_request er WHERE er.expense_request_id = d.entity_id::uuid";

module.exports = librarySource({
  area: "expenses",
  types: { [INVOICE_DOC_TYPE]: "Expense Invoice" },
  entity: "expense",
  record: {
    type: "'expense'",
    id: "d.entity_id",
    label: `(SELECT left(er.purpose, 80) FROM ${OF})`,
    ref: `(SELECT er.number::text FROM ${OF})`,
  },
  listed: `EXISTS (SELECT 1 FROM ${OF} AND er.invoice_document_id = d.document_id)`,
  default: true,
});
