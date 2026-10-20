-- M9 Settings · Performance rebuilt: the whole server a minute at a time, latency buckets for
-- real percentiles, each route a quarter hour at a time, each process's own beat, and the
-- targets Edit Targets holds.
--
-- perf_sample        one row a minute, written by the worker: the whole server (it is shared by
--                    production and staging), each systemd service's share of it, and whether
--                    the API answered ready on loopback.
-- request_stat       gains the minute's latency buckets. Bucket counts add across processes,
--                    so a percentile can be worked out where a stored p95 could not.
-- route_stat         each route a quarter hour at a time, with the same buckets. The route is
--                    the declared pattern, never the raw URL, so the rows stay bounded.
-- process_beat       one row per API or worker process, updated every minute. A new row is a
--                    start, so restarts are counted from it.
-- performance_target the one row Edit Targets writes. No row means the defaults in
--                    system_health.targets.js; nothing is seeded (A26).
-- schedule_run       gains the total and the longest run, for each job's mean and worst.
-- perf_percentile()  a percentile from bucket counts and the buckets' upper bounds, so a list
--                    can be sorted by p95 in SQL and paged at 25.
-- UP
CREATE TABLE IF NOT EXISTS perf_sample (
  minute timestamptz PRIMARY KEY,
  cores smallint,
  cpu_busy_pct numeric(5,2),
  cpu_steal_pct numeric(5,2),
  cpu_iowait_pct numeric(5,2),
  load_1m numeric(6,2),
  memory_total_mb integer,
  memory_in_use_mb integer,
  memory_cache_mb integer,
  memory_free_mb integer,
  swap_total_mb integer,
  swap_used_mb integer,
  disk_total_mb integer,
  disk_used_mb integer,
  disk_free_mb integer,
  disk_read_kb bigint,
  disk_written_kb bigint,
  disk_busy_pct numeric(5,2),
  network_in_kb bigint,
  network_out_kb bigint,
  tcp_connections integer,
  production_cpu_pct numeric(5,2),
  production_memory_mb integer,
  staging_cpu_pct numeric(5,2),
  staging_memory_mb integer,
  database_cpu_pct numeric(5,2),
  database_memory_mb integer,
  redis_cpu_pct numeric(5,2),
  redis_memory_mb integer,
  scanner_cpu_pct numeric(5,2),
  scanner_memory_mb integer,
  api_up boolean,
  users_online integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE request_stat ADD COLUMN IF NOT EXISTS buckets integer[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS route_stat (
  bucket timestamptz NOT NULL,
  method text NOT NULL,
  route text NOT NULL,
  requests integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  client_errors integer NOT NULL DEFAULT 0,
  slow integer NOT NULL DEFAULT 0,
  total_ms bigint NOT NULL DEFAULT 0,
  max_ms integer NOT NULL DEFAULT 0,
  buckets integer[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket, method, route)
);

-- The window a list reads is always "since", so the bucket alone is the index it needs; the
-- primary key's own index already leads with it.

CREATE TABLE IF NOT EXISTS process_beat (
  instance text PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('api', 'worker')),
  host text NOT NULL,
  pid integer NOT NULL,
  release text,
  started_at timestamptz NOT NULL,
  last_beat_at timestamptz NOT NULL DEFAULT now(),
  memory_mb integer,
  heap_mb integer,
  loop_delay_ms integer,
  cpu_pct numeric(5,2),
  sockets integer,
  users_online integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER process_beat_set_updated_at
  BEFORE UPDATE ON process_beat
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS process_beat_last_beat_idx ON process_beat (last_beat_at DESC);
CREATE INDEX IF NOT EXISTS process_beat_started_idx ON process_beat (role, started_at DESC);

CREATE TABLE IF NOT EXISTS performance_target (
  performance_target_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton),
  availability_pct numeric(5,2) NOT NULL DEFAULT 99.90,
  response_p95_ms integer NOT NULL DEFAULT 800,
  error_pct numeric(5,2) NOT NULL DEFAULT 1.00,
  disk_warn_free_pct smallint NOT NULL DEFAULT 10,
  disk_down_free_pct smallint NOT NULL DEFAULT 5,
  memory_warn_pct smallint NOT NULL DEFAULT 90,
  memory_down_pct smallint NOT NULL DEFAULT 95,
  cpu_warn_pct smallint NOT NULL DEFAULT 85,
  cpu_down_pct smallint NOT NULL DEFAULT 95,
  connections_warn_pct smallint NOT NULL DEFAULT 80,
  connections_down_pct smallint NOT NULL DEFAULT 90,
  updated_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER performance_target_set_updated_at
  BEFORE UPDATE ON performance_target
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS performance_target_updated_by_idx ON performance_target (updated_by);

ALTER TABLE schedule_run
  ADD COLUMN IF NOT EXISTS total_ms bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_ms integer NOT NULL DEFAULT 0;

-- The q-th percentile of a histogram: hist[i] requests took at most bounds[i] ms, and the
-- last count (one past the bounds) took longer. Straight-line inside the bucket it falls in;
-- the overflow bucket reads as the last bound. Null when the histogram is empty.
CREATE OR REPLACE FUNCTION perf_percentile(hist bigint[], bounds integer[], q numeric)
RETURNS integer
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  total bigint := 0;
  target numeric;
  running bigint := 0;
  i integer;
  n bigint;
  lower_ms numeric;
BEGIN
  IF hist IS NULL THEN RETURN NULL; END IF;
  FOR i IN 1 .. coalesce(array_length(hist, 1), 0) LOOP
    total := total + coalesce(hist[i], 0);
  END LOOP;
  IF total = 0 THEN RETURN NULL; END IF;
  target := q * total;
  FOR i IN 1 .. array_length(hist, 1) LOOP
    n := coalesce(hist[i], 0);
    IF n > 0 AND running + n >= target THEN
      IF i > coalesce(array_length(bounds, 1), 0) THEN
        RETURN bounds[array_length(bounds, 1)];
      END IF;
      lower_ms := CASE WHEN i = 1 THEN 0 ELSE bounds[i - 1] END;
      RETURN round(lower_ms + (bounds[i] - lower_ms) * (target - running) / n)::integer;
    END IF;
    running := running + n;
  END LOOP;
  RETURN bounds[array_length(bounds, 1)];
END;
$$;

-- DOWN
DROP FUNCTION IF EXISTS perf_percentile(bigint[], integer[], numeric);
ALTER TABLE schedule_run
  DROP COLUMN IF EXISTS max_ms,
  DROP COLUMN IF EXISTS total_ms;
DROP INDEX IF EXISTS performance_target_updated_by_idx;
DROP TRIGGER IF EXISTS performance_target_set_updated_at ON performance_target;
DROP TABLE IF EXISTS performance_target;
DROP INDEX IF EXISTS process_beat_started_idx;
DROP INDEX IF EXISTS process_beat_last_beat_idx;
DROP TRIGGER IF EXISTS process_beat_set_updated_at ON process_beat;
DROP TABLE IF EXISTS process_beat;
DROP TABLE IF EXISTS route_stat;
ALTER TABLE request_stat DROP COLUMN IF EXISTS buckets;
DROP TABLE IF EXISTS perf_sample;
