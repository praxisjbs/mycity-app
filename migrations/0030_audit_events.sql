-- M0 event, audit, outbox, idempotency and error ledgers.
-- UP
CREATE TABLE IF NOT EXISTS event_log (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL,
  module_key text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  actor_user_id uuid REFERENCES app_user(user_id),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id text,
  import_batch_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_ledger (
  audit_ledger_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES event_log(event_id),
  occurred_at timestamptz NOT NULL,
  actor_user_id uuid REFERENCES app_user(user_id),
  actor_name text,
  actor_email citext,
  actor_ip inet,
  action text NOT NULL,
  module_key text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  before jsonb,
  after jsonb,
  changed_fields text[] NOT NULL DEFAULT '{}',
  is_sensitive boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id text,
  import_batch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER audit_ledger_append_only
BEFORE UPDATE OR DELETE ON audit_ledger
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

CREATE TABLE IF NOT EXISTS event_outbox (
  outbox_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES event_log(event_id),
  event_key text NOT NULL,
  dedup_key text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  completed_handlers text[] NOT NULL DEFAULT '{}',
  last_error text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS event_outbox_dedup_uq ON event_outbox (dedup_key) WHERE dedup_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_outbox_pending_idx ON event_outbox (next_attempt_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS idempotency_key (
  key text PRIMARY KEY,
  method text NOT NULL,
  path text NOT NULL,
  request_hash text NOT NULL,
  user_id uuid REFERENCES app_user(user_id),
  state text NOT NULL CHECK (state IN ('in_flight', 'completed')),
  status_code integer,
  response_body jsonb,
  completed_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS error_event (
  error_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  severity text NOT NULL,
  origin text NOT NULL,
  fingerprint text NOT NULL,
  name text NOT NULL,
  message text NOT NULL,
  stack text,
  route text,
  request_id text,
  user_id uuid REFERENCES app_user(user_id),
  release text,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- DOWN
DROP TABLE IF EXISTS error_event;
DROP TABLE IF EXISTS idempotency_key;
DROP INDEX IF EXISTS event_outbox_pending_idx;
DROP INDEX IF EXISTS event_outbox_dedup_uq;
DROP TABLE IF EXISTS event_outbox;
DROP TRIGGER IF EXISTS audit_ledger_append_only ON audit_ledger;
DROP TABLE IF EXISTS audit_ledger;
DROP TABLE IF EXISTS event_log;
