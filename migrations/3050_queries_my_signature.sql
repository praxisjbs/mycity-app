-- M3 a person's saved signature, reused on the letters they sign (docs/guides/queries.md §6.9).
--
--   letter_signature  one row a login: the signature they drew once on Letter Templates (Edit
--                     Signature), from the vault. Raise a Query and Approve Sanction start from it,
--                     and a letter preview shows it. Drawing again replaces it (the old document
--                     stays in the vault, as every letter it signed keeps its own copy).
--
-- A signature is a document like any other file; the row names it and never holds the image.
-- CASCADE on the login: the saved signature is the person's own convenience, never a record.
-- RESTRICT on the document: a saved signature is not deleted from under its row.
-- UP
CREATE TABLE IF NOT EXISTS letter_signature (
  user_id uuid PRIMARY KEY REFERENCES app_user(user_id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES document(document_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS letter_signature_document_idx ON letter_signature (document_id);
CREATE OR REPLACE TRIGGER letter_signature_set_updated_at BEFORE UPDATE ON letter_signature
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
DROP TRIGGER IF EXISTS letter_signature_set_updated_at ON letter_signature;
DROP INDEX IF EXISTS letter_signature_document_idx;
DROP TABLE IF EXISTS letter_signature; -- DESTRUCTIVE: rollback only; drops what UP added
