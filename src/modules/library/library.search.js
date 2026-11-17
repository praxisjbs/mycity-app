"use strict";
/**
 * ⌘K for the Document Centre (docs/guides/document-centre.md §9).
 *
 *   library_item        a document by its title, its file name, its number, its type, the record it
 *                       belongs to, its tags or a word inside the file (§6.7), listed for the readers
 *                       the Library lists it for and nobody else (shared/documents/library.js
 *                       `readable`, the vault's own rule); an archived company document is not found.
 *                       A result opens the Library on that document (shared/route-map.js).
 *   document_category   a category by its name, for those who keep the library (documents.manage);
 *                       it opens Categories on it.
 */
const { recordProvider } = require("../../shared/search/provider");
const library = require("../../shared/documents/library");

const cols = library.columns();
const TITLE = `COALESCE(NULLIF(d.title, ''), d.original_name, ${cols.type_label})`;
const TAGS = `(SELECT array_to_string(cd.tags, ' ') FROM company_document cd
                WHERE d.entity_type = 'company_document' AND cd.document_id = d.document_id)`;
const TEXT = "(SELECT dt.text FROM document_text dt WHERE dt.document_id = d.document_id AND dt.status = 'done')";

const documents = recordProvider({
  type: "library_item",
  module: "documents",
  label: "Documents",
  words: ["document", "documents", "file", "files", "doc"],
  from: "document d",
  key: "d.document_id",
  columns: [
    "COALESCE(d.title, '')",
    "COALESCE(d.original_name, '')",
    `COALESCE(${cols.number}, '')`,
    `COALESCE(${cols.type_label}, '')`,
    `COALESCE(${cols.record_label}, '')`,
    `COALESCE(${cols.record_ref}, '')`,
    `COALESCE(${TAGS}, '')`,
    `COALESCE(${TEXT}, '')`,
  ],
  select: `d.document_id AS id, COALESCE(${cols.record_ref}, ${cols.number}) AS ref, ${TITLE} AS title,
           concat_ws(' · ', ${cols.type_label}, ${cols.record_label}) AS sub`,
  order: "d.created_at DESC",
  reach: (client, user) => library.reach(client, user),
  readable: (reach, params) => `${library.readable(reach, params).sql} AND ${cols.archived_at} IS NULL`,
});

const categories = recordProvider({
  type: "document_category",
  module: "documents",
  label: "Document Categories",
  words: ["document category", "document categories"],
  capability: "documents.manage",
  from: "document_category dc",
  key: "dc.document_category_id",
  columns: ["dc.name::text"],
  select: `dc.document_category_id AS id, NULL::text AS ref, dc.name::text AS title,
           CASE WHEN dc.archived_at IS NOT NULL THEN 'Archived' WHEN dc.audience = 'everyone' THEN 'Everyone' ELSE 'Named roles' END AS sub`,
  order: "dc.name",
});

module.exports = [documents, categories];
