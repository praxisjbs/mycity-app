-- M10 AI Control, Find Prices in batches (docs/guides/ai-control.md decisions 29 to 31, §4).
--
-- ai_price_run                 one per Find Prices press: its progress and outcome, for the New
--                              Prices sheet. The worker's job claims it once (claimed_at), so a job
--                              delivered twice searches once. A run with no progress for 15 minutes
--                              is taken as lost.
-- ai_model.price_not_listed_at when the provider's pricing page last did not price the model; Find
--                              Prices asks about it again after 7 days.
-- The model lists already stored lose what decision 29 leaves off: -latest aliases, Gemma's open
-- models, and a dated or numbered snapshot whose base model is on the same list, unless a chain
-- uses it. Only rows the provider listed go; seeded and hand-added ones stay. The next save or
-- test of a key keeps it that way (services/ai/catalogue.js trim).
-- UP
CREATE TABLE IF NOT EXISTS ai_price_run (
  ai_price_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  batches_total integer NOT NULL DEFAULT 0 CHECK (batches_total >= 0),
  batches_done integer NOT NULL DEFAULT 0 CHECK (batches_done >= 0),
  proposals integer NOT NULL DEFAULT 0 CHECK (proposals >= 0),
  not_listed integer NOT NULL DEFAULT 0 CHECK (not_listed >= 0),
  error_code text,
  claimed_at timestamptz,
  requested_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER ai_price_run_set_updated_at
  BEFORE UPDATE ON ai_price_run
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS ai_price_run_started_idx ON ai_price_run (started_at);
-- At most one run at a time (§6.4): two presses in the same instant cannot both start one.
CREATE UNIQUE INDEX IF NOT EXISTS ai_price_run_one_running_uq ON ai_price_run ((true)) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS ai_price_run_requested_by_idx ON ai_price_run (requested_by);

ALTER TABLE ai_model ADD COLUMN IF NOT EXISTS price_not_listed_at timestamptz;

-- DESTRUCTIVE: provider-listed aliases, Gemma and repeated snapshots go; the next key test lists them again, trimmed
DELETE FROM ai_model m
 WHERE m.source = 'provider'
   AND NOT EXISTS (SELECT 1 FROM ai_chain c WHERE c.provider = m.provider AND c.model = m.model)
   AND (
     m.model ~* '-latest$'
     OR (m.provider = 'gemini' AND m.model ~* '^gemma-')
     OR EXISTS (
       SELECT 1
         FROM ai_model b
        WHERE b.provider = m.provider
          AND b.ai_model_id <> m.ai_model_id
          AND m.model ~* '(-[0-9]{2}-[0-9]{4}|-[0-9]{4}-[0-9]{2}-[0-9]{2}|-[0-9]{8}|-[0-9]{3}|-[0-9]{2}-[0-9]{2}|-exp-[0-9]{4})$'
          AND (
            lower(b.model::text) = regexp_replace(lower(m.model::text), '(-[0-9]{2}-[0-9]{4}|-[0-9]{4}-[0-9]{2}-[0-9]{2}|-[0-9]{8}|-[0-9]{3}|-[0-9]{2}-[0-9]{2}|-exp-[0-9]{4})$', '')
            OR lower(b.model::text) = regexp_replace(regexp_replace(lower(m.model::text), '(-[0-9]{2}-[0-9]{4}|-[0-9]{4}-[0-9]{2}-[0-9]{2}|-[0-9]{8}|-[0-9]{3}|-[0-9]{2}-[0-9]{2}|-exp-[0-9]{4})$', ''), '-preview$', '')
          )
     )
   );

-- DOWN
-- The rows the UP cleared are not put back: the next save or test of a key reads its list again.
ALTER TABLE ai_model DROP COLUMN IF EXISTS price_not_listed_at;
DROP INDEX IF EXISTS ai_price_run_one_running_uq;
DROP INDEX IF EXISTS ai_price_run_requested_by_idx;
DROP INDEX IF EXISTS ai_price_run_started_idx;
DROP TRIGGER IF EXISTS ai_price_run_set_updated_at ON ai_price_run;
DROP TABLE IF EXISTS ai_price_run;
