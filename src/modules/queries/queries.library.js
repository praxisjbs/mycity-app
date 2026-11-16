"use strict";
/**
 * The Document Centre's letters (docs/guides/document-centre.md §6.2): the letter a query holds and
 * each letter a sanction issued, by the vault's default rule. Each belongs to the query or the
 * sanction, named by the employee it is about.
 */
const { librarySource, employeeName } = require("../../shared/documents/library");
const { QUERY_LETTER, SANCTION_LETTER } = require("../templates/templates.events");

const QUERY = "employee_query q WHERE q.employee_query_id = d.entity_id::uuid";
const SANCTION = "sanction s WHERE s.sanction_id = d.entity_id::uuid";

module.exports = [
  librarySource({
    area: "queries",
    types: { [QUERY_LETTER]: "Query Letter" },
    entity: "query",
    record: {
      type: "'query'",
      id: "d.entity_id",
      label: `(SELECT ${employeeName("q.employee_id")} FROM ${QUERY})`,
      ref: `(SELECT q.number::text FROM ${QUERY})`,
    },
    listed: `EXISTS (SELECT 1 FROM ${QUERY} AND q.letter_document_id = d.document_id)`,
    default: true,
  }),
  librarySource({
    area: "queries",
    types: { [SANCTION_LETTER]: "Sanction Letter" },
    entity: "sanction",
    record: {
      type: "'sanction'",
      id: "d.entity_id",
      label: `(SELECT ${employeeName("s.employee_id")} FROM ${SANCTION})`,
      ref: `(SELECT s.number::text FROM ${SANCTION})`,
    },
    listed: "EXISTS (SELECT 1 FROM sanction_letter sl WHERE sl.sanction_id = d.entity_id::uuid AND sl.document_id = d.document_id)",
    default: true,
  }),
];
