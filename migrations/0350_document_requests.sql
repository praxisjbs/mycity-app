-- M0 documents: what People have asked an employee for, and whether a document has been checked.
--
-- Two things My Documents and an employee's Documents tab need that the vault alone cannot say
-- (docs/guides/foundation.md §6.9, docs/guides/ess.md §3 step 6):
--
--   document_request  a document People asked for. Until it is answered the Vault list shows it
--                     as Missing, with Upload Document on the row; the upload fills
--                     fulfilled_document_id and the row becomes that document. A request is
--                     cancelled, never deleted, so the ask stays on the record.
--   document.verified_at / verified_by
--                     People have looked at the uploaded file and accepted it. Until then it reads
--                     Awaiting Verification. This is a person's judgement; scan_status is the virus
--                     check and says nothing about whether the right document arrived.
--
-- A request names the document in the words People used (title) and, where it is a type the code
-- knows (shared/documents/types.js), its doc_type as well, so an upload answering it is stored
-- under the right type.
-- UP
CREATE TABLE IF NOT EXISTS document_request (
  document_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee(employee_id) ON DELETE CASCADE,
  doc_type text,
  title text NOT NULL,
  note text,
  requested_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  fulfilled_document_id uuid REFERENCES document(document_id) ON DELETE SET NULL,
  fulfilled_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((fulfilled_document_id IS NULL) = (fulfilled_at IS NULL))
);

CREATE OR REPLACE TRIGGER document_request_set_updated_at
  BEFORE UPDATE ON document_request
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS document_request_employee_idx ON document_request (employee_id);
CREATE INDEX IF NOT EXISTS document_request_open_idx ON document_request (employee_id)
  WHERE fulfilled_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS document_request_requested_by_idx ON document_request (requested_by);
CREATE INDEX IF NOT EXISTS document_request_document_idx ON document_request (fulfilled_document_id);
CREATE INDEX IF NOT EXISTS document_request_cancelled_by_idx ON document_request (cancelled_by);

ALTER TABLE document ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE document ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS document_verified_by_idx ON document (verified_by);
CREATE INDEX IF NOT EXISTS document_subject_current_idx ON document (subject_employee_id, created_at DESC)
  WHERE is_current AND subject_employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS document_expires_idx ON document (expires_on) WHERE expires_on IS NOT NULL;

-- DOWN
DROP INDEX IF EXISTS document_expires_idx;
DROP INDEX IF EXISTS document_subject_current_idx;
DROP INDEX IF EXISTS document_verified_by_idx;
ALTER TABLE document DROP COLUMN IF EXISTS verified_by;
ALTER TABLE document DROP COLUMN IF EXISTS verified_at;
DROP INDEX IF EXISTS document_request_cancelled_by_idx;
DROP INDEX IF EXISTS document_request_document_idx;
DROP INDEX IF EXISTS document_request_requested_by_idx;
DROP INDEX IF EXISTS document_request_open_idx;
DROP INDEX IF EXISTS document_request_employee_idx;
DROP TRIGGER IF EXISTS document_request_set_updated_at ON document_request;
DROP TABLE IF EXISTS document_request;
