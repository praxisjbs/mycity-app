-- M1 the employee's photo (docs/guides/ess.md §3 step 1, §5, §10).
--
-- An employee uploads their own photo on ESS · My Profile. The file is a document in the vault
-- (purpose `avatar`: cropped square to the face, metadata stripped, 96, 192 and 384 px sizes),
-- stored against the record type `employee_photo`, which every signed-in colleague may read.
-- This column points at the photo in use; null shows initials. A replaced photo stays in the
-- vault with its history; deleting the document clears the column.
-- UP
ALTER TABLE employee ADD COLUMN IF NOT EXISTS photo_document_id uuid REFERENCES document(document_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS employee_photo_document_id_fk_idx ON employee (photo_document_id);

-- DOWN
DROP INDEX IF EXISTS employee_photo_document_id_fk_idx;
-- DESTRUCTIVE: rolling back forgets which photo each person uses; the files stay in the vault.
ALTER TABLE employee DROP COLUMN IF EXISTS photo_document_id;
