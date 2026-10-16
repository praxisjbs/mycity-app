-- M0 shared-layer tables made to accept what the shared code writes (BACKEND_STRUCTURE §11.1).
--
-- Each change below is a column the shared layer writes as NULL, or a default it relies on,
-- that 0030 to 0095 refused. Found by running tests/integration against the real migrations:
--   audit_ledger.changed_fields  emit() passes NULL for an event with no before and after
--   notification.body            fan-out stores a bell row with no body
--   document.title               vault.store() takes an optional title
--   import_batch.header_row      the import engine stores a 0-based row index, NULL if not found
--   ai_run vendor, model, prompt  a run refused before a vendor is chosen, and transcription
--   ai_catalogue permission, sha  route entries carry no permission; local builds no sha
--   ai_setting defaults          the code treats a missing value as on, Gemini, model from env
-- UP
ALTER TABLE audit_ledger ALTER COLUMN changed_fields DROP NOT NULL;

ALTER TABLE notification ALTER COLUMN body DROP NOT NULL;

ALTER TABLE document ALTER COLUMN title DROP NOT NULL;

ALTER TABLE import_batch ALTER COLUMN header_row DROP NOT NULL;
ALTER TABLE import_batch ALTER COLUMN header_row DROP DEFAULT;
ALTER TABLE import_batch DROP CONSTRAINT IF EXISTS import_batch_header_row_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_batch_header_row_index_check') THEN
    ALTER TABLE import_batch ADD CONSTRAINT import_batch_header_row_index_check CHECK (header_row IS NULL OR header_row >= 0);
  END IF;
END;
$$;

ALTER TABLE ai_run ALTER COLUMN vendor DROP NOT NULL;
ALTER TABLE ai_run ALTER COLUMN model DROP NOT NULL;
ALTER TABLE ai_run ALTER COLUMN prompt_key DROP NOT NULL;
ALTER TABLE ai_run ALTER COLUMN prompt_version DROP NOT NULL;
ALTER TABLE ai_run ALTER COLUMN prompt_sha DROP NOT NULL;

ALTER TABLE ai_catalogue ALTER COLUMN permission DROP NOT NULL;
ALTER TABLE ai_catalogue ALTER COLUMN build_sha DROP NOT NULL;

ALTER TABLE ai_setting ALTER COLUMN enabled SET DEFAULT true;
ALTER TABLE ai_setting ALTER COLUMN vendor SET DEFAULT 'gemini';
ALTER TABLE ai_setting ALTER COLUMN model DROP NOT NULL;

-- DOWN
-- Restores 0030 to 0095 as they were. Fails on a database that holds rows with these NULLs,
-- which is the point: such a database needs this file.
ALTER TABLE ai_setting ALTER COLUMN model SET NOT NULL;
ALTER TABLE ai_setting ALTER COLUMN vendor SET DEFAULT 'stub';
ALTER TABLE ai_setting ALTER COLUMN enabled SET DEFAULT false;

ALTER TABLE ai_catalogue ALTER COLUMN build_sha SET NOT NULL;
ALTER TABLE ai_catalogue ALTER COLUMN permission SET NOT NULL;

ALTER TABLE ai_run ALTER COLUMN prompt_sha SET NOT NULL;
ALTER TABLE ai_run ALTER COLUMN prompt_version SET NOT NULL;
ALTER TABLE ai_run ALTER COLUMN prompt_key SET NOT NULL;
ALTER TABLE ai_run ALTER COLUMN model SET NOT NULL;
ALTER TABLE ai_run ALTER COLUMN vendor SET NOT NULL;

ALTER TABLE import_batch DROP CONSTRAINT IF EXISTS import_batch_header_row_index_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_batch_header_row_check') THEN
    ALTER TABLE import_batch ADD CONSTRAINT import_batch_header_row_check CHECK (header_row > 0);
  END IF;
END;
$$;
ALTER TABLE import_batch ALTER COLUMN header_row SET DEFAULT 1;
ALTER TABLE import_batch ALTER COLUMN header_row SET NOT NULL;

ALTER TABLE document ALTER COLUMN title SET NOT NULL;

ALTER TABLE notification ALTER COLUMN body SET NOT NULL;

ALTER TABLE audit_ledger ALTER COLUMN changed_fields SET NOT NULL;
