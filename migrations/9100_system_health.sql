-- M9 Settings · System Health: a fault the team can act on, and a record of how the
-- system behaved. See docs/guides/system-health.md.
--
-- error_event already holds every fault the reporter writes, fingerprinted
-- (src/shared/observability/error-reporter.js). What it has never had is a place for a
-- decision: who is on this, is it fixed, has it come back. That is error_group, keyed on
-- the same fingerprint, so the screen and the alert channel always mean the same fault.
--
-- A group holds state only. Counts are aggregated from error_event for the window asked
-- for, never incremented into a column, so a row written late or replayed by a retry can
-- never double count.
-- UP
CREATE TABLE IF NOT EXISTS error_group (
  error_group_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL UNIQUE,
  -- The message with ids and numbers already normalised, as the fingerprint sees it.
  title text NOT NULL,
  name text NOT NULL,
  last_message text,
  severity text NOT NULL DEFAULT 'error' CHECK (severity IN ('fatal', 'error', 'warning', 'notice')),
  origin text NOT NULL DEFAULT 'server' CHECK (origin IN ('server', 'worker', 'job', 'browser')),
  route text,
  -- The first stack frame: where in the code it happened.
  frame text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'handling', 'fixed', 'ignored')),
  assigned_to uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  status_changed_at timestamptz,
  status_changed_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  first_release text,
  last_release text,
  -- Times it came back after somebody marked it fixed.
  regressions integer NOT NULL DEFAULT 0,
  regressed_at timestamptz,
  -- The last time the spike rule told anybody, so it is told at most once in six hours.
  spiked_at timestamptz,
  -- The last time the 24 hour escalation fired.
  escalated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER error_group_set_updated_at
  BEFORE UPDATE ON error_group
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The list's default order and its filters.
CREATE INDEX IF NOT EXISTS error_group_status_last_seen_idx ON error_group (status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS error_group_last_seen_idx ON error_group (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS error_group_first_seen_idx ON error_group (first_seen_at DESC);
CREATE INDEX IF NOT EXISTS error_group_severity_idx ON error_group (severity);
CREATE INDEX IF NOT EXISTS error_group_origin_idx ON error_group (origin);
CREATE INDEX IF NOT EXISTS error_group_assigned_to_idx ON error_group (assigned_to);
CREATE INDEX IF NOT EXISTS error_group_status_changed_by_idx ON error_group (status_changed_by);

-- What the team worked out about a fault. A null author is the system itself,
-- writing that the fault came back or is spiking.
CREATE TABLE IF NOT EXISTS error_group_note (
  error_group_note_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  error_group_id uuid NOT NULL REFERENCES error_group(error_group_id) ON DELETE CASCADE,
  author_user_id uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER error_group_note_set_updated_at
  BEFORE UPDATE ON error_group_note
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS error_group_note_group_idx ON error_group_note (error_group_id, created_at);
CREATE INDEX IF NOT EXISTS error_group_note_author_idx ON error_group_note (author_user_id);

-- One row every 5 minutes from the worker: what every readiness check said, and the
-- few numbers worth a trend. Drawn as the Performance section, kept 30 days.
CREATE TABLE IF NOT EXISTS health_snapshot (
  health_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taken_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('ready', 'degraded', 'unavailable')),
  -- check name -> { status, latency_ms, ... }, as src/http/health.js runChecks() returns it.
  checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  outbox_backlog integer NOT NULL DEFAULT 0,
  worker_lag_s integer,
  faults_open integer NOT NULL DEFAULT 0,
  faults_new_24h integer NOT NULL DEFAULT 0,
  release text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS health_snapshot_taken_at_idx ON health_snapshot (taken_at DESC);

-- What makes the grouped list and its 24 hour and 7 day counts cheap. error_event
-- itself is unchanged: the hot path that writes a fault must not grow new work.
CREATE INDEX IF NOT EXISTS error_event_fingerprint_occurred_idx ON error_event (fingerprint, occurred_at DESC);
CREATE INDEX IF NOT EXISTS error_event_occurred_at_idx ON error_event (occurred_at DESC);

-- DOWN
DROP INDEX IF EXISTS error_event_occurred_at_idx;
DROP INDEX IF EXISTS error_event_fingerprint_occurred_idx;
DROP INDEX IF EXISTS health_snapshot_taken_at_idx;
DROP TABLE IF EXISTS health_snapshot;
DROP TRIGGER IF EXISTS error_group_note_set_updated_at ON error_group_note;
DROP INDEX IF EXISTS error_group_note_author_idx;
DROP INDEX IF EXISTS error_group_note_group_idx;
DROP TABLE IF EXISTS error_group_note;
DROP TRIGGER IF EXISTS error_group_set_updated_at ON error_group;
DROP INDEX IF EXISTS error_group_status_changed_by_idx;
DROP INDEX IF EXISTS error_group_assigned_to_idx;
DROP INDEX IF EXISTS error_group_origin_idx;
DROP INDEX IF EXISTS error_group_severity_idx;
DROP INDEX IF EXISTS error_group_first_seen_idx;
DROP INDEX IF EXISTS error_group_last_seen_idx;
DROP INDEX IF EXISTS error_group_status_last_seen_idx;
DROP TABLE IF EXISTS error_group;
