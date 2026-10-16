-- MyCity database identity and migration ledger.
-- UP
CREATE TABLE IF NOT EXISTS system_marker (
  system_marker_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment text NOT NULL CHECK (environment IN ('production', 'staging', 'development', 'test')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS system_marker_one_row_uq ON system_marker ((true));

CREATE TABLE IF NOT EXISTS schema_migration (
  name text PRIMARY KEY,
  sha256 text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- DOWN
DROP TABLE IF EXISTS schema_migration;
DROP TABLE IF EXISTS system_marker;
