-- M10 Document Centre: the two indexes its Library reads the vault by (docs/guides/document-centre.md §4).
--
--   document_library_idx   a type's current files, newest first: the Library lists by type and date
--   document_entity_idx    a record's files: every source names the record a file belongs to by
--                          (entity_type, entity_id), which had no index
--
-- No table, column or row changes: the Library reads `document` where it is.
-- UP
CREATE INDEX IF NOT EXISTS document_library_idx ON document (doc_type, created_at DESC) WHERE is_current;
CREATE INDEX IF NOT EXISTS document_entity_idx ON document (entity_type, entity_id);

-- DOWN
DROP INDEX IF EXISTS document_entity_idx;
DROP INDEX IF EXISTS document_library_idx;
