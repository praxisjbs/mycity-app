-- M3 the drawn signatures on a query and a proposed sanction (docs/guides/queries.md §6.2, §6.4).
--
--   employee_query  + signature_document_id: the raiser's drawn signature, from the vault;
--                     null for a query a rule raised
--   sanction        + signature_document_id: the proposer's drawn signature, printed on its letters
--
-- A signature is a document like any other file (the upload engine and the vault keep it); a
-- column names it and never holds the image. RESTRICT: a signature on a record is never deleted
-- from under it.
-- UP
ALTER TABLE employee_query ADD COLUMN IF NOT EXISTS signature_document_id uuid REFERENCES document(document_id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS employee_query_signature_idx ON employee_query (signature_document_id);

ALTER TABLE sanction ADD COLUMN IF NOT EXISTS signature_document_id uuid REFERENCES document(document_id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS sanction_signature_idx ON sanction (signature_document_id);

-- DOWN
DROP INDEX IF EXISTS sanction_signature_idx;
ALTER TABLE sanction DROP COLUMN IF EXISTS signature_document_id;
DROP INDEX IF EXISTS employee_query_signature_idx;
ALTER TABLE employee_query DROP COLUMN IF EXISTS signature_document_id;
