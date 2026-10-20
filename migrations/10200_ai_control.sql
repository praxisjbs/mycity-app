-- M10 AI Control, brought forward (docs/guides/ai-control.md §4): chains, provider caps, Find
-- Prices' proposals, and what each ledger step was charged at.
--
-- ai_chain             one row per model of a job's or an action's chain, first (1) to the third
--                      fallback (4). A job or action with no rows uses the chain in code.
-- ai_provider_cap      a paid provider's monthly cap in naira; no row or null is no cap.
-- ai_price_proposal    a price Find Prices read from a provider's page, waiting for IT; one open
--                      proposal per model.
-- ai_model             gains the price of a thousand searches (Google Search, for Find Prices).
-- ai_run_step          gains the audio seconds and searches it used and the naira prices and
--                      rate it was charged at, so a new price or rate never rewrites past spend;
--                      kind gains `search` (a Find Prices request).
-- UP
CREATE TABLE IF NOT EXISTS ai_chain (
  ai_chain_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('job', 'action')),
  -- The job (default, top_tier) or the action (voice-note-transcription).
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 4),
  provider text NOT NULL CHECK (provider IN ('gemini', 'groq', 'openai', 'anthropic', 'deepseek')),
  model citext NOT NULL,
  updated_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, key, position)
);

CREATE OR REPLACE TRIGGER ai_chain_set_updated_at
  BEFORE UPDATE ON ai_chain
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS ai_chain_updated_by_idx ON ai_chain (updated_by);
CREATE INDEX IF NOT EXISTS ai_chain_model_idx ON ai_chain (provider, model);

CREATE TABLE IF NOT EXISTS ai_provider_cap (
  provider text PRIMARY KEY CHECK (provider IN ('gemini', 'groq', 'openai', 'anthropic', 'deepseek')),
  monthly_cap_ngn numeric(18,2) CHECK (monthly_cap_ngn IS NULL OR monthly_cap_ngn >= 0),
  updated_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER ai_provider_cap_set_updated_at
  BEFORE UPDATE ON ai_provider_cap
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS ai_provider_cap_updated_by_idx ON ai_provider_cap (updated_by);

ALTER TABLE ai_model ADD COLUMN IF NOT EXISTS usd_per_thousand_searches numeric(12,4);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_model_usd_per_thousand_searches_check') THEN
    ALTER TABLE ai_model
      ADD CONSTRAINT ai_model_usd_per_thousand_searches_check
      CHECK (usd_per_thousand_searches IS NULL OR usd_per_thousand_searches >= 0);
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS ai_price_proposal (
  ai_price_proposal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_model_id uuid NOT NULL REFERENCES ai_model(ai_model_id) ON DELETE CASCADE,
  input_usd_per_million numeric(12,4) CHECK (input_usd_per_million IS NULL OR input_usd_per_million >= 0),
  output_usd_per_million numeric(12,4) CHECK (output_usd_per_million IS NULL OR output_usd_per_million >= 0),
  audio_usd_per_million numeric(12,4) CHECK (audio_usd_per_million IS NULL OR audio_usd_per_million >= 0),
  usd_per_audio_hour numeric(12,4) CHECK (usd_per_audio_hour IS NULL OR usd_per_audio_hour >= 0),
  usd_per_thousand_searches numeric(12,4) CHECK (usd_per_thousand_searches IS NULL OR usd_per_thousand_searches >= 0),
  -- The pricing page it came from.
  source_url text NOT NULL CHECK (source_url ~ '^https://'),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'dismissed')),
  -- The Find Prices run that read it.
  run_id uuid REFERENCES ai_run(run_id) ON DELETE SET NULL,
  decided_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER ai_price_proposal_set_updated_at
  BEFORE UPDATE ON ai_price_proposal
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One open proposal per model: a newer one takes its place.
CREATE UNIQUE INDEX IF NOT EXISTS ai_price_proposal_open_uq ON ai_price_proposal (ai_model_id) WHERE status = 'proposed';
CREATE INDEX IF NOT EXISTS ai_price_proposal_model_idx ON ai_price_proposal (ai_model_id);
CREATE INDEX IF NOT EXISTS ai_price_proposal_run_idx ON ai_price_proposal (run_id);
CREATE INDEX IF NOT EXISTS ai_price_proposal_decided_by_idx ON ai_price_proposal (decided_by);

ALTER TABLE ai_run_step ADD COLUMN IF NOT EXISTS audio_seconds integer NOT NULL DEFAULT 0;
ALTER TABLE ai_run_step ADD COLUMN IF NOT EXISTS ngn_per_audio_hour numeric(18,2);
ALTER TABLE ai_run_step ADD COLUMN IF NOT EXISTS searches integer NOT NULL DEFAULT 0;
ALTER TABLE ai_run_step ADD COLUMN IF NOT EXISTS ngn_per_search numeric(18,2);
ALTER TABLE ai_run_step ADD COLUMN IF NOT EXISTS usd_ngn_rate numeric(24,10);
ALTER TABLE ai_run_step ADD COLUMN IF NOT EXISTS rate_day date;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_run_step_audio_seconds_check') THEN
    ALTER TABLE ai_run_step ADD CONSTRAINT ai_run_step_audio_seconds_check CHECK (audio_seconds >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_run_step_searches_check') THEN
    ALTER TABLE ai_run_step ADD CONSTRAINT ai_run_step_searches_check CHECK (searches >= 0);
  END IF;
END;
$$;

-- Widened, not narrowed: every kind 0095 allowed is still allowed.
ALTER TABLE ai_run_step DROP CONSTRAINT IF EXISTS ai_run_step_kind_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_run_step_kind_check') THEN
    ALTER TABLE ai_run_step
      ADD CONSTRAINT ai_run_step_kind_check CHECK (kind IN ('completion', 'retry', 'transcription', 'search'));
  END IF;
END;
$$;

-- Spend per provider for the month, and each action's calls today.
CREATE INDEX IF NOT EXISTS ai_run_step_vendor_created_idx ON ai_run_step (vendor, created_at);
CREATE INDEX IF NOT EXISTS ai_run_purpose_started_idx ON ai_run (purpose, started_at);

-- DOWN
DROP INDEX IF EXISTS ai_run_purpose_started_idx;
DROP INDEX IF EXISTS ai_run_step_vendor_created_idx;
-- The narrower kind comes back; a Find Prices step would break it, so those go first.
DELETE FROM ai_run_step WHERE kind = 'search';
ALTER TABLE ai_run_step DROP CONSTRAINT IF EXISTS ai_run_step_kind_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_run_step_kind_check') THEN
    ALTER TABLE ai_run_step
      ADD CONSTRAINT ai_run_step_kind_check CHECK (kind IN ('completion', 'retry', 'transcription'));
  END IF;
END;
$$;
ALTER TABLE ai_run_step DROP CONSTRAINT IF EXISTS ai_run_step_searches_check;
ALTER TABLE ai_run_step DROP CONSTRAINT IF EXISTS ai_run_step_audio_seconds_check;
ALTER TABLE ai_run_step DROP COLUMN IF EXISTS rate_day;
ALTER TABLE ai_run_step DROP COLUMN IF EXISTS usd_ngn_rate;
ALTER TABLE ai_run_step DROP COLUMN IF EXISTS ngn_per_search;
ALTER TABLE ai_run_step DROP COLUMN IF EXISTS searches;
ALTER TABLE ai_run_step DROP COLUMN IF EXISTS ngn_per_audio_hour;
ALTER TABLE ai_run_step DROP COLUMN IF EXISTS audio_seconds;
DROP INDEX IF EXISTS ai_price_proposal_decided_by_idx;
DROP INDEX IF EXISTS ai_price_proposal_run_idx;
DROP INDEX IF EXISTS ai_price_proposal_model_idx;
DROP INDEX IF EXISTS ai_price_proposal_open_uq;
DROP TRIGGER IF EXISTS ai_price_proposal_set_updated_at ON ai_price_proposal;
DROP TABLE IF EXISTS ai_price_proposal;
ALTER TABLE ai_model DROP CONSTRAINT IF EXISTS ai_model_usd_per_thousand_searches_check;
ALTER TABLE ai_model DROP COLUMN IF EXISTS usd_per_thousand_searches;
DROP INDEX IF EXISTS ai_provider_cap_updated_by_idx;
DROP TRIGGER IF EXISTS ai_provider_cap_set_updated_at ON ai_provider_cap;
DROP TABLE IF EXISTS ai_provider_cap;
DROP INDEX IF EXISTS ai_chain_model_idx;
DROP INDEX IF EXISTS ai_chain_updated_by_idx;
DROP TRIGGER IF EXISTS ai_chain_set_updated_at ON ai_chain;
DROP TABLE IF EXISTS ai_chain;
