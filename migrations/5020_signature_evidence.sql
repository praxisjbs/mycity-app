-- M5 signatures (shared with M7): both hashes on every signature row (A12), the signer's evidence and the sealed copy.
-- UP
ALTER TABLE signature_request ADD COLUMN IF NOT EXISTS sealed_document_id uuid REFERENCES document(document_id) ON DELETE RESTRICT;
ALTER TABLE signature_request ADD COLUMN IF NOT EXISTS end_reason text;

ALTER TABLE signature ADD COLUMN IF NOT EXISTS signer_title text;
ALTER TABLE signature ADD COLUMN IF NOT EXISTS method text;
ALTER TABLE signature ADD COLUMN IF NOT EXISTS signature_document_id uuid REFERENCES document(document_id) ON DELETE RESTRICT;
ALTER TABLE signature ADD COLUMN IF NOT EXISTS code_verified_at timestamptz;
ALTER TABLE signature ADD COLUMN IF NOT EXISTS viewed_at timestamptz;
ALTER TABLE signature ADD COLUMN IF NOT EXISTS content_hash text;
ALTER TABLE signature ADD COLUMN IF NOT EXISTS artifact_hash text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signature_request_status_check') THEN
    ALTER TABLE signature_request ADD CONSTRAINT signature_request_status_check
      CHECK (status IN ('pending', 'completed', 'declined', 'expired', 'revoked'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signature_status_check') THEN
    ALTER TABLE signature ADD CONSTRAINT signature_status_check
      CHECK (status IN ('pending', 'signed', 'declined', 'expired'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signature_method_check') THEN
    ALTER TABLE signature ADD CONSTRAINT signature_method_check
      CHECK (method IS NULL OR method IN ('draw', 'type', 'paper'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signature_content_hash_check') THEN
    ALTER TABLE signature ADD CONSTRAINT signature_content_hash_check
      CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signature_artifact_hash_check') THEN
    ALTER TABLE signature ADD CONSTRAINT signature_artifact_hash_check
      CHECK (artifact_hash IS NULL OR artifact_hash ~ '^[0-9a-f]{64}$');
  END IF;
  -- A signed row carries its evidence and the content it signed (A12).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signature_signed_has_hash_check') THEN
    ALTER TABLE signature ADD CONSTRAINT signature_signed_has_hash_check
      CHECK (status <> 'signed' OR (signed_at IS NOT NULL AND content_hash IS NOT NULL AND method IS NOT NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS signature_request_document_id_idx ON signature_request (document_id);
CREATE INDEX IF NOT EXISTS signature_request_subject_idx ON signature_request (subject_type, subject_id);
CREATE INDEX IF NOT EXISTS signature_request_status_idx ON signature_request (status);
CREATE INDEX IF NOT EXISTS signature_request_created_by_idx ON signature_request (created_by);
CREATE INDEX IF NOT EXISTS signature_request_sealed_document_id_idx ON signature_request (sealed_document_id);
CREATE INDEX IF NOT EXISTS signature_signature_document_id_idx ON signature (signature_document_id);
CREATE INDEX IF NOT EXISTS signature_signer_idx ON signature (signer_type, signer_id);

-- DOWN
DROP INDEX IF EXISTS signature_signer_idx;
DROP INDEX IF EXISTS signature_signature_document_id_idx;
DROP INDEX IF EXISTS signature_request_sealed_document_id_idx;
DROP INDEX IF EXISTS signature_request_created_by_idx;
DROP INDEX IF EXISTS signature_request_status_idx;
DROP INDEX IF EXISTS signature_request_subject_idx;
DROP INDEX IF EXISTS signature_request_document_id_idx;
ALTER TABLE signature DROP CONSTRAINT IF EXISTS signature_signed_has_hash_check;
ALTER TABLE signature DROP CONSTRAINT IF EXISTS signature_artifact_hash_check;
ALTER TABLE signature DROP CONSTRAINT IF EXISTS signature_content_hash_check;
ALTER TABLE signature DROP CONSTRAINT IF EXISTS signature_method_check;
ALTER TABLE signature DROP CONSTRAINT IF EXISTS signature_status_check;
ALTER TABLE signature_request DROP CONSTRAINT IF EXISTS signature_request_status_check;
ALTER TABLE signature DROP COLUMN IF EXISTS artifact_hash;
ALTER TABLE signature DROP COLUMN IF EXISTS content_hash;
ALTER TABLE signature DROP COLUMN IF EXISTS viewed_at;
ALTER TABLE signature DROP COLUMN IF EXISTS code_verified_at;
ALTER TABLE signature DROP COLUMN IF EXISTS signature_document_id;
ALTER TABLE signature DROP COLUMN IF EXISTS method;
ALTER TABLE signature DROP COLUMN IF EXISTS signer_title;
ALTER TABLE signature_request DROP COLUMN IF EXISTS end_reason;
ALTER TABLE signature_request DROP COLUMN IF EXISTS sealed_document_id;
