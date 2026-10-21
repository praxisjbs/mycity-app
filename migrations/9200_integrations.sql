-- M9 Settings · Integrations (docs/guides/integrations.md §4): each connection's saved
-- settings and state, its checks, and its use per day.
--
-- integration_connection   one row per connection of the registry (shared/integrations/
--                          providers.js), made the first time it is saved, checked or used.
--                          Gains who saved it and when, its daily limit, and its state.
-- integration_secret       gains the hint a person may see (the last four characters of a
--                          key, never any part of a password) and who set it.
-- integration_check        every test: before a save, a Test, a test email, the worker's watch.
-- integration_usage        real calls to each provider, per Lagos day and kind; telemetry, like
--                          request_stat, written by counters that flush every 15 seconds.
--
-- DESTRUCTIVE: integration_connection.integration_secret_id is dropped. Nothing ever wrote or
-- read it (9000 made it ahead of M9), and a connection may hold more than one secret, so its
-- secrets are found by (provider, key) in integration_secret instead. No data is lost: every
-- row of 9000's table was empty until this migration.
-- UP
ALTER TABLE integration_connection
  ADD COLUMN IF NOT EXISTS saved_at timestamptz,
  ADD COLUMN IF NOT EXISTS saved_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS daily_limit integer,
  ADD COLUMN IF NOT EXISTS state_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_ok_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD COLUMN IF NOT EXISTS quota_warned_on date;

-- DESTRUCTIVE: never written or read (see the header).
ALTER TABLE integration_connection DROP COLUMN IF EXISTS integration_secret_id;

ALTER TABLE integration_connection ALTER COLUMN status SET DEFAULT 'unchecked';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integration_connection_status_check') THEN
    ALTER TABLE integration_connection
      ADD CONSTRAINT integration_connection_status_check CHECK (status IN ('ok', 'failing', 'unchecked'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integration_connection_daily_limit_check') THEN
    ALTER TABLE integration_connection
      ADD CONSTRAINT integration_connection_daily_limit_check CHECK (daily_limit IS NULL OR daily_limit > 0);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS integration_connection_saved_by_idx ON integration_connection (saved_by);

ALTER TABLE integration_secret
  ADD COLUMN IF NOT EXISTS hint text,
  ADD COLUMN IF NOT EXISTS set_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integration_secret_hint_check') THEN
    ALTER TABLE integration_secret
      ADD CONSTRAINT integration_secret_hint_check CHECK (hint IS NULL OR length(hint) <= 16);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS integration_secret_set_by_idx ON integration_secret (set_by);

-- Append-only: a check is never changed, and the nightly purge deletes those past 90 days.
CREATE TABLE IF NOT EXISTS integration_check (
  integration_check_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_connection_id uuid NOT NULL REFERENCES integration_connection(integration_connection_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('save', 'test', 'test_email', 'watch')),
  ok boolean NOT NULL,
  -- Each step's key, result, time and code, as the provider's test returned them.
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_code text,
  checked_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integration_check_connection_created_idx ON integration_check (integration_connection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS integration_check_checked_by_idx ON integration_check (checked_by);
CREATE INDEX IF NOT EXISTS integration_check_created_idx ON integration_check (created_at);

-- Counts are added, never replaced, so the API and the worker, and a restart inside the
-- same day, all land in one row per connection, day and kind.
CREATE TABLE IF NOT EXISTS integration_usage (
  integration_usage_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_connection_id uuid NOT NULL REFERENCES integration_connection(integration_connection_id) ON DELETE CASCADE,
  day date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('search', 'reverse', 'tile', 'call', 'send', 'sync', 'push')),
  calls integer NOT NULL DEFAULT 0 CHECK (calls >= 0),
  failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
  units numeric(12,2) NOT NULL DEFAULT 0 CHECK (units >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_connection_id, day, kind)
);

CREATE OR REPLACE TRIGGER integration_usage_set_updated_at
  BEFORE UPDATE ON integration_usage
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS integration_usage_day_idx ON integration_usage (day);

-- DOWN
DROP INDEX IF EXISTS integration_usage_day_idx;
DROP TRIGGER IF EXISTS integration_usage_set_updated_at ON integration_usage;
DROP TABLE IF EXISTS integration_usage;
DROP INDEX IF EXISTS integration_check_created_idx;
DROP INDEX IF EXISTS integration_check_checked_by_idx;
DROP INDEX IF EXISTS integration_check_connection_created_idx;
DROP TABLE IF EXISTS integration_check;
DROP INDEX IF EXISTS integration_secret_set_by_idx;
ALTER TABLE integration_secret DROP CONSTRAINT IF EXISTS integration_secret_hint_check;
ALTER TABLE integration_secret
  DROP COLUMN IF EXISTS set_by,
  DROP COLUMN IF EXISTS hint;
DROP INDEX IF EXISTS integration_connection_saved_by_idx;
ALTER TABLE integration_connection DROP CONSTRAINT IF EXISTS integration_connection_daily_limit_check;
ALTER TABLE integration_connection DROP CONSTRAINT IF EXISTS integration_connection_status_check;
ALTER TABLE integration_connection ALTER COLUMN status SET DEFAULT 'inactive';
ALTER TABLE integration_connection
  ADD COLUMN IF NOT EXISTS integration_secret_id uuid REFERENCES integration_secret(integration_secret_id);
ALTER TABLE integration_connection
  DROP COLUMN IF EXISTS quota_warned_on,
  DROP COLUMN IF EXISTS last_error_code,
  DROP COLUMN IF EXISTS last_ok_at,
  DROP COLUMN IF EXISTS state_at,
  DROP COLUMN IF EXISTS daily_limit,
  DROP COLUMN IF EXISTS saved_by,
  DROP COLUMN IF EXISTS saved_at;
