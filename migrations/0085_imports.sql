-- M0 spreadsheet import staging and reusable mappings.
-- UP
CREATE TABLE IF NOT EXISTS import_batch (
  import_batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,
  importer_key text NOT NULL,
  document_id uuid NOT NULL REFERENCES document(document_id),
  file_name text NOT NULL,
  sheet text,
  header_row integer NOT NULL DEFAULT 1 CHECK (header_row > 0),
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'mapped', 'previewed', 'committed', 'reverted', 'failed')),
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES app_user(user_id),
  previewed_at timestamptz,
  committed_at timestamptz,
  committed_by uuid REFERENCES app_user(user_id),
  reverted_at timestamptz,
  reverted_by uuid REFERENCES app_user(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS import_row (
  import_row_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id uuid NOT NULL REFERENCES import_batch(import_batch_id) ON DELETE CASCADE,
  row_number integer NOT NULL CHECK (row_number > 0),
  raw jsonb NOT NULL,
  values jsonb,
  status text NOT NULL CHECK (status IN ('ok', 'warning', 'error', 'duplicate', 'unchanged', 'skipped')),
  problems jsonb NOT NULL DEFAULT '[]'::jsonb,
  action text CHECK (action IS NULL OR action IN ('create', 'update', 'none')),
  target_id text,
  before jsonb,
  diff jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_batch_id, row_number)
);

CREATE TABLE IF NOT EXISTS import_mapping_profile (
  import_mapping_profile_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  importer_key text NOT NULL,
  name text NOT NULL,
  header_signature text NOT NULL,
  mapping jsonb NOT NULL,
  created_by uuid REFERENCES app_user(user_id),
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (importer_key, header_signature)
);

-- DOWN
DROP TABLE IF EXISTS import_mapping_profile;
DROP TABLE IF EXISTS import_row;
DROP TABLE IF EXISTS import_batch;
