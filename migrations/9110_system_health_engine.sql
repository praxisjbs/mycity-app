-- M9 Settings · System Health: what the screen was missing.
--
-- schedule_run   when each background job last ran. Without it a job that stops
--                is invisible: the first release of this module shipped with its
--                own schedulers unregistered and nothing said so for an hour.
-- request_stat   one row a minute per process, so the Performance chart can show
--                how fast the app answered and what share of requests failed.
--                Counts are added, never replaced, so several API processes and
--                a restart inside the same minute all land in one row.
-- health_snapshot gains the resources a person asks about first: disk, memory,
--                CPU and the database's own size and connections.
-- UP
CREATE TABLE IF NOT EXISTS schedule_run (
  name text PRIMARY KEY,
  last_run_at timestamptz,
  duration_ms integer,
  ok boolean,
  note text,
  runs bigint NOT NULL DEFAULT 0,
  failures bigint NOT NULL DEFAULT 0,
  last_failure_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER schedule_run_set_updated_at
  BEFORE UPDATE ON schedule_run
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS schedule_run_last_run_idx ON schedule_run (last_run_at DESC);

-- A minute of traffic. `total_ms` over `requests` is the mean, which adds across
-- processes; a percentile does not, which is why this keeps sums and a slow count
-- rather than a p95 that could not be combined.
CREATE TABLE IF NOT EXISTS request_stat (
  minute timestamptz PRIMARY KEY,
  requests bigint NOT NULL DEFAULT 0,
  errors bigint NOT NULL DEFAULT 0,
  client_errors bigint NOT NULL DEFAULT 0,
  slow bigint NOT NULL DEFAULT 0,
  total_ms bigint NOT NULL DEFAULT 0,
  max_ms integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS request_stat_minute_idx ON request_stat (minute DESC);

ALTER TABLE health_snapshot
  ADD COLUMN IF NOT EXISTS disk_free_pct smallint,
  ADD COLUMN IF NOT EXISTS memory_used_pct smallint,
  ADD COLUMN IF NOT EXISTS cpu_load numeric(6,2),
  ADD COLUMN IF NOT EXISTS database_mb integer,
  ADD COLUMN IF NOT EXISTS database_connections_pct smallint,
  ADD COLUMN IF NOT EXISTS requests bigint,
  ADD COLUMN IF NOT EXISTS error_pct numeric(5,2),
  ADD COLUMN IF NOT EXISTS mean_ms integer;

-- DOWN
ALTER TABLE health_snapshot
  DROP COLUMN IF EXISTS mean_ms,
  DROP COLUMN IF EXISTS error_pct,
  DROP COLUMN IF EXISTS requests,
  DROP COLUMN IF EXISTS database_connections_pct,
  DROP COLUMN IF EXISTS database_mb,
  DROP COLUMN IF EXISTS cpu_load,
  DROP COLUMN IF EXISTS memory_used_pct,
  DROP COLUMN IF EXISTS disk_free_pct;
DROP INDEX IF EXISTS request_stat_minute_idx;
DROP TABLE IF EXISTS request_stat;
DROP TRIGGER IF EXISTS schedule_run_set_updated_at ON schedule_run;
DROP INDEX IF EXISTS schedule_run_last_run_idx;
DROP TABLE IF EXISTS schedule_run;
