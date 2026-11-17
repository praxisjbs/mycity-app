-- M10 Document Centre: the searchable text of the library's files (docs/guides/document-centre.md §4, §6.7).
--
--   document_text  one row a stored file whose text was read: done (text found), empty (a scanned
--                  page, a picture: found by name) or failed (to be read again by the nightly sweep).
--                  Only the library's types are read; a chat file's or a mail attachment's never is.
--                  The trigram index on its folded text keeps a search of the text inside ⌘K's
--                  two seconds, the pattern of employee_search_idx (0300).
-- UP
CREATE TABLE IF NOT EXISTS document_text (
  document_id uuid PRIMARY KEY REFERENCES document(document_id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('done', 'empty', 'failed')),
  text text,
  pages integer CHECK (pages IS NULL OR pages >= 0),
  chars integer CHECK (chars IS NULL OR chars >= 0),
  extracted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_text_search_idx ON document_text
  USING gin (search_fold(COALESCE(text, '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS document_text_status_idx ON document_text (status);
CREATE OR REPLACE TRIGGER document_text_set_updated_at BEFORE UPDATE ON document_text
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
DROP TRIGGER IF EXISTS document_text_set_updated_at ON document_text;
DROP TABLE IF EXISTS document_text;
