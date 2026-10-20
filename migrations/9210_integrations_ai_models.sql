-- M9 Settings · Integrations, AI providers (docs/guides/integrations.md §1.2, §4): each
-- connection's plan, the model list of each AI connection, and the new kinds of check and use.
--
-- integration_connection.plan   Free or Paid with the provider, set on the page; null keeps the
--                               registry's starting plan (shared/integrations/providers.js).
-- ai_model                      one row per model of an AI connection: seeded (9291), read from
--                               the provider with the key in use, or added by hand. Whether the key
--                               can use it is `available`, null until the key's list is read.
-- integration_check.kind        gains `sync`: an exchange rate fetch, by Sync Rates or the job.
-- integration_usage.kind        gains `transcribe` (seconds of audio) and `rates` (a rate fetch).
-- UP
ALTER TABLE integration_connection ADD COLUMN IF NOT EXISTS plan text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integration_connection_plan_check') THEN
    ALTER TABLE integration_connection
      ADD CONSTRAINT integration_connection_plan_check CHECK (plan IS NULL OR plan IN ('free', 'paid'));
  END IF;
END;
$$;

-- Widened, not narrowed: every value 9200 allowed is still allowed.
ALTER TABLE integration_check DROP CONSTRAINT IF EXISTS integration_check_kind_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integration_check_kind_check') THEN
    ALTER TABLE integration_check
      ADD CONSTRAINT integration_check_kind_check CHECK (kind IN ('save', 'test', 'test_email', 'watch', 'sync'));
  END IF;
END;
$$;

ALTER TABLE integration_usage DROP CONSTRAINT IF EXISTS integration_usage_kind_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integration_usage_kind_check') THEN
    ALTER TABLE integration_usage
      ADD CONSTRAINT integration_usage_kind_check
      CHECK (kind IN ('search', 'reverse', 'tile', 'call', 'transcribe', 'rates', 'send', 'sync', 'push'));
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS ai_model (
  ai_model_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('gemini', 'groq', 'openai', 'anthropic', 'deepseek')),
  -- The id the provider's API takes, as it spells it.
  model citext NOT NULL,
  display_name text NOT NULL,
  capabilities text[] NOT NULL
    CHECK (cardinality(capabilities) > 0 AND capabilities <@ ARRAY['text', 'image', 'audio', 'embeddings']::text[]),
  -- Null: the key in use has not been asked yet.
  available boolean,
  source text NOT NULL CHECK (source IN ('seed', 'provider', 'added')),
  -- A model added with its own endpoint; null is the provider's own.
  endpoint_url text CHECK (endpoint_url IS NULL OR endpoint_url ~ '^https://'),
  -- The provider's list prices in dollars: per million tokens, per million audio tokens, per hour of audio.
  input_usd_per_million numeric(12,4) CHECK (input_usd_per_million IS NULL OR input_usd_per_million >= 0),
  output_usd_per_million numeric(12,4) CHECK (output_usd_per_million IS NULL OR output_usd_per_million >= 0),
  audio_usd_per_million numeric(12,4) CHECK (audio_usd_per_million IS NULL OR audio_usd_per_million >= 0),
  usd_per_audio_hour numeric(12,4) CHECK (usd_per_audio_hour IS NULL OR usd_per_audio_hour >= 0),
  -- When the key's list last named it.
  seen_at timestamptz,
  added_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, model)
);

CREATE OR REPLACE TRIGGER ai_model_set_updated_at
  BEFORE UPDATE ON ai_model
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS ai_model_added_by_idx ON ai_model (added_by);

-- DOWN
DROP INDEX IF EXISTS ai_model_added_by_idx;
DROP TRIGGER IF EXISTS ai_model_set_updated_at ON ai_model;
DROP TABLE IF EXISTS ai_model;
-- The narrower checks come back; rows of the kinds this file added would break them, so they go
-- first (a rate fetch's check, a transcription's or a rate fetch's counted use).
DELETE FROM integration_usage WHERE kind IN ('transcribe', 'rates');
ALTER TABLE integration_usage DROP CONSTRAINT IF EXISTS integration_usage_kind_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integration_usage_kind_check') THEN
    ALTER TABLE integration_usage
      ADD CONSTRAINT integration_usage_kind_check CHECK (kind IN ('search', 'reverse', 'tile', 'call', 'send', 'sync', 'push'));
  END IF;
END;
$$;
DELETE FROM integration_check WHERE kind = 'sync';
ALTER TABLE integration_check DROP CONSTRAINT IF EXISTS integration_check_kind_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integration_check_kind_check') THEN
    ALTER TABLE integration_check
      ADD CONSTRAINT integration_check_kind_check CHECK (kind IN ('save', 'test', 'test_email', 'watch'));
  END IF;
END;
$$;
ALTER TABLE integration_connection DROP CONSTRAINT IF EXISTS integration_connection_plan_check;
ALTER TABLE integration_connection DROP COLUMN IF EXISTS plan;
