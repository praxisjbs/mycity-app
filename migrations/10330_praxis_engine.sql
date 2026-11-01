-- M10 Praxis AI Engine (docs/guides/praxis-ai.md §4, decision 18): each read an answer made, the card an answer drew, the press that ran it; the catalogue takes summaries and actions; a question keeps the screen it was asked from.
-- UP

-- The screen a conversation was opened from, and the one each question was asked from (decision 12).
ALTER TABLE ai_conversation ADD COLUMN IF NOT EXISTS opened_from jsonb;
ALTER TABLE ai_message ADD COLUMN IF NOT EXISTS context jsonb;

-- The deployed build's catalogue now carries summaries and actions beside reads and routes (catalogue-sync.js).
ALTER TABLE ai_catalogue ADD COLUMN IF NOT EXISTS risk text;
ALTER TABLE ai_catalogue DROP CONSTRAINT IF EXISTS ai_catalogue_kind_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_catalogue_kind_check_v2') THEN
    ALTER TABLE ai_catalogue ADD CONSTRAINT ai_catalogue_kind_check_v2 CHECK (kind IN ('read', 'route', 'summary', 'action'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_catalogue_risk_check') THEN
    ALTER TABLE ai_catalogue ADD CONSTRAINT ai_catalogue_risk_check CHECK (risk IS NULL OR risk IN ('standard', 'approval', 'money', 'payroll', 'delete'));
  END IF;
END $$;

-- Each read of an answer, with the parameters it ran with: a later page, the Sources tab and an
-- Excel file are rebuilt from here with the person's rights at that moment (§6.12).
CREATE TABLE IF NOT EXISTS ai_message_read (
  ai_message_read_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_message_id uuid NOT NULL REFERENCES ai_message(ai_message_id) ON DELETE CASCADE,
  n integer NOT NULL CHECK (n >= 1 AND n <= 5),
  read_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('read', 'summary')),
  module_key text,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  page integer CHECK (page IS NULL OR page >= 1),
  rows integer NOT NULL DEFAULT 0 CHECK (rows >= 0),
  total integer CHECK (total IS NULL OR total >= 0),
  outcome text NOT NULL CHECK (outcome IN ('read', 'refused', 'invalid', 'failed')),
  masked text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ai_message_id, n)
);

CREATE OR REPLACE TRIGGER ai_message_read_set_updated_at
  BEFORE UPDATE ON ai_message_read
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS ai_message_read_message_idx ON ai_message_read (ai_message_id);
CREATE INDEX IF NOT EXISTS ai_message_read_key_idx ON ai_message_read (read_key, created_at);

-- The card an answer drew (§6.11): one per answer, the asking person's own, valid 30 minutes.
CREATE TABLE IF NOT EXISTS ai_action_draft (
  ai_action_draft_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_message_id uuid NOT NULL REFERENCES ai_message(ai_message_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  action_key text NOT NULL,
  module_key text NOT NULL,
  risk text NOT NULL CHECK (risk IN ('standard', 'approval', 'money', 'payroll', 'delete')),
  "values" jsonb NOT NULL DEFAULT '{}'::jsonb,
  problems jsonb NOT NULL DEFAULT '{}'::jsonb,
  records jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggested boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'shown' CHECK (status IN ('shown', 'confirmed', 'done', 'failed', 'cancelled', 'expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ai_message_id)
);

CREATE OR REPLACE TRIGGER ai_action_draft_set_updated_at
  BEFORE UPDATE ON ai_action_draft
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS ai_action_draft_user_status_idx ON ai_action_draft (user_id, status, created_at DESC);

-- The press (§6.11 step 5 and 6): how it was confirmed, the values as run, a line per record.
CREATE TABLE IF NOT EXISTS ai_action_run (
  ai_action_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_action_draft_id uuid NOT NULL REFERENCES ai_action_draft(ai_action_draft_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  confirmed_how text NOT NULL CHECK (confirmed_how IN ('click', 'fresh_sign_in')),
  idempotency_key text,
  "values" jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER ai_action_run_set_updated_at
  BEFORE UPDATE ON ai_action_run
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS ai_action_run_draft_idx ON ai_action_run (ai_action_draft_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ai_action_run_user_idx ON ai_action_run (user_id, started_at DESC);

-- DOWN
DROP INDEX IF EXISTS ai_action_run_user_idx;
DROP INDEX IF EXISTS ai_action_run_draft_idx;
DROP TRIGGER IF EXISTS ai_action_run_set_updated_at ON ai_action_run;
DROP TABLE IF EXISTS ai_action_run;
DROP INDEX IF EXISTS ai_action_draft_user_status_idx;
DROP TRIGGER IF EXISTS ai_action_draft_set_updated_at ON ai_action_draft;
DROP TABLE IF EXISTS ai_action_draft;
DROP INDEX IF EXISTS ai_message_read_key_idx;
DROP INDEX IF EXISTS ai_message_read_message_idx;
DROP TRIGGER IF EXISTS ai_message_read_set_updated_at ON ai_message_read;
DROP TABLE IF EXISTS ai_message_read;
ALTER TABLE ai_catalogue DROP CONSTRAINT IF EXISTS ai_catalogue_risk_check;
ALTER TABLE ai_catalogue DROP CONSTRAINT IF EXISTS ai_catalogue_kind_check_v2;
-- The narrower check comes back; rows of the new kinds would break it, so they go first.
DELETE FROM ai_catalogue WHERE kind IN ('summary', 'action');
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_catalogue_kind_check') THEN
    ALTER TABLE ai_catalogue ADD CONSTRAINT ai_catalogue_kind_check CHECK (kind IN ('read', 'route'));
  END IF;
END $$;
ALTER TABLE ai_catalogue DROP COLUMN IF EXISTS risk;
ALTER TABLE ai_message DROP COLUMN IF EXISTS context;
ALTER TABLE ai_conversation DROP COLUMN IF EXISTS opened_from;
