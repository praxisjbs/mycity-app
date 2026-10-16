-- M0 governed AI ledger and module catalogue.
-- UP
CREATE TABLE IF NOT EXISTS ai_setting (
  ai_setting_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled boolean NOT NULL DEFAULT false,
  vendor text NOT NULL DEFAULT 'stub' CHECK (vendor IN ('gemini', 'stub')),
  model text NOT NULL,
  disabled_modules text[] NOT NULL DEFAULT '{}',
  monthly_cap_ngn numeric(18,2),
  input_ngn_per_million numeric(18,2),
  output_ngn_per_million numeric(18,2),
  updated_by uuid REFERENCES app_user(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (monthly_cap_ngn IS NULL OR monthly_cap_ngn >= 0)
);

CREATE TABLE IF NOT EXISTS ai_run (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL,
  module_key text NOT NULL,
  actor_user_id uuid REFERENCES app_user(user_id),
  vendor text NOT NULL,
  model text NOT NULL,
  prompt_key text NOT NULL,
  prompt_version integer NOT NULL,
  prompt_sha text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'ok', 'failed', 'refused')),
  provisional boolean NOT NULL DEFAULT true,
  error_code text,
  error text,
  request_id text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_run_step (
  ai_run_step_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES ai_run(run_id) ON DELETE CASCADE,
  step_no integer NOT NULL CHECK (step_no > 0),
  kind text NOT NULL CHECK (kind IN ('completion', 'retry', 'transcription')),
  vendor text NOT NULL,
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  input_ngn_per_million numeric(18,2),
  output_ngn_per_million numeric(18,2),
  cost_ngn numeric(18,2) NOT NULL DEFAULT 0 CHECK (cost_ngn >= 0),
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  finish_reason text,
  outcome text NOT NULL CHECK (outcome IN ('ok', 'invalid', 'failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, step_no)
);

CREATE INDEX IF NOT EXISTS ai_run_step_created_idx ON ai_run_step (created_at);

CREATE TABLE IF NOT EXISTS ai_catalogue (
  key text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('read', 'route')),
  module_key text NOT NULL,
  description text NOT NULL,
  permission text NOT NULL,
  params_schema jsonb,
  screen text,
  path text,
  build_sha text NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- DOWN
DROP TABLE IF EXISTS ai_catalogue;
DROP INDEX IF EXISTS ai_run_step_created_idx;
DROP TABLE IF EXISTS ai_run_step;
DROP TABLE IF EXISTS ai_run;
DROP TABLE IF EXISTS ai_setting;
