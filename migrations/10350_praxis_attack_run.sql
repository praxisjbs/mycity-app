-- M10 Praxis AI Engine PR5 (docs/guides/praxis-ai.md §6.17, decision 26): each run of the attack suite against the real model, so AI Control · Spend shows the nightly run's last result and a leak can be told.
-- UP

-- One row per run of scripts/ai/attack-assistant.js: nightly from GitHub against staging, or by hand.
-- `leaks` holds a line per attack that leaked (its id, who asked, what was wrong), never a person's record.
CREATE TABLE IF NOT EXISTS ai_attack_run (
  ai_attack_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment text NOT NULL CHECK (environment IN ('development', 'test', 'staging', 'production')),
  run_by text NOT NULL CHECK (run_by IN ('nightly', 'hand')),
  status text NOT NULL CHECK (status IN ('passed', 'leaked', 'cannot_run', 'failed')),
  asked integer NOT NULL DEFAULT 0 CHECK (asked >= 0),
  passed integer NOT NULL DEFAULT 0 CHECK (passed >= 0),
  leaks jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_code text,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER ai_attack_run_set_updated_at
  BEFORE UPDATE ON ai_attack_run
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS ai_attack_run_finished_idx ON ai_attack_run (finished_at DESC);

-- DOWN
DROP INDEX IF EXISTS ai_attack_run_finished_idx;
DROP TRIGGER IF EXISTS ai_attack_run_set_updated_at ON ai_attack_run;
DROP TABLE IF EXISTS ai_attack_run;
