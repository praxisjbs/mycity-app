"use strict";
/**
 * ⌘K for the Document Centre (docs/guides/document-centre.md §9): a document by its title, its file
 * name, its number, its type or the record it belongs to, listed for the readers the Library lists
 * it for and nobody else (shared/documents/library.js `readable`, the vault's own rule). A result
 * opens the Library on that document (shared/route-map.js library_item).
 */
const { recordProvider } = require("../../shared/search/provider");
const library = require("../../shared/documents/library");

const cols = library.columns();
const TITLE = `COALESCE(NULLIF(d.title, ''), d.original_name, ${cols.type_label})`;

module.exports = recordProvider({
  type: "library_item",
  module: "documents",
  label: "Documents",
  words: ["document", "documents", "file", "files", "doc"],
  from: "document d",
  key: "d.document_id",
  columns: [
    "COALESCE(d.title, '')",
    "COALESCE(d.original_name, '')",
    "COALESCE(d.number, '')",
    `COALESCE(${cols.type_label}, '')`,
    `COALESCE(${cols.record_label}, '')`,
    `COALESCE(${cols.record_ref}, '')`,
  ],
  select: `d.document_id AS id, COALESCE(${cols.record_ref}, d.number) AS ref, ${TITLE} AS title,
           concat_ws(' · ', ${cols.type_label}, ${cols.record_label}) AS sub`,
  order: "d.created_at DESC",
  reach: (client, user) => library.reach(client, user),
  readable: (reach, params) => library.readable(reach, params).sql,
});
