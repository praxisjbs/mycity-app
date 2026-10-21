"use strict";
/**
 * Reading and writing faults and snapshots (migration 9100), and the performance
 * samples, routes, processes and database figures (migration 9120).
 *
 * The one rule this file keeps: a group never stores a count. Today, In All and People
 * are aggregated from `error_event` for the window asked for, in the same query as the
 * page, so a row written late by the reporter's 3 second buffer, or replayed by an
 * outbox retry, can never double count. The index that makes it cheap is
 * `error_event (fingerprint, occurred_at DESC)`.
 *
 * Days are Lagos days: "today" and the 14 day chart begin at midnight in Lagos.
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");

const TZ = "Africa/Lagos";
/** How long an occurrence is kept. Counts never reach past it, so neither does the UI. */
const KEEP_EVENT_DAYS = 90;
/** How long a snapshot is kept. */
const KEEP_SNAPSHOT_DAYS = 30;
/** Occurrences shown on a fault sheet and carried in the brief. */
const OCCURRENCES = 5;

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;
const all = async (db, sql, params) => (await db.query(sql, params)).rows;

const GROUP = `g.error_group_id, g.title, g.name, g.last_message, g.severity, g.origin, g.route, g.frame,
  g.status, g.assigned_to, g.first_seen_at, g.last_seen_at, g.first_release, g.last_release,
  g.regressions, g.regressed_at, g.spiked_at, g.escalated_at, g.fingerprint`;

/** Counts for one group, from the events still kept. One subquery, three numbers. */
const COUNTS = `(
  SELECT COALESCE(count(*) FILTER (WHERE e.occurred_at > now() - interval '24 hours'), 0)::int AS today,
         COALESCE(count(*), 0)::int AS total,
         COALESCE(count(DISTINCT e.user_id), 0)::int AS people
    FROM error_event e
   WHERE e.fingerprint = g.fingerprint
)`;

const SORTS = {
  last_seen_at: "g.last_seen_at",
  first_seen_at: "g.first_seen_at",
  today: "c.today",
};

/**
 * The WHERE for the fault list.
 * @param {{q?: string, status?: string, severity?: string, origin?: string}} f
 */
function filtersOf(f) {
  const status = f.status || "active";
  const params = [
    status === "active" || status === "all" ? null : status,
    status === "active",
    f.severity || null,
    f.origin || null,
    f.q || null,
  ];
  const sql = `($1::text IS NULL OR g.status = $1)
     AND ($2::boolean IS NOT TRUE OR g.status IN ('open', 'handling'))
     AND ($3::text IS NULL OR g.severity = $3)
     AND ($4::text IS NULL OR g.origin = $4)
     AND ($5::text IS NULL OR search_fold(
           g.title || ' ' || g.name || ' ' || COALESCE(g.route, '') || ' ' || COALESCE(g.frame, '')
         ) LIKE '%' || search_fold($5) || '%')`;
  return { sql, params };
}

/** One page of faults, latest first unless sorted otherwise. */
function page(db, query) {
  const { sql, params } = filtersOf(query);
  const sort = query.sort || { field: "last_seen_at", dir: "desc" };
  return pageQuery(
    db,
    `SELECT ${GROUP}, c.today, c.total, c.people, trim(ae.first_name || ' ' || ae.last_name) AS assigned_name, ${TOTAL_COL}
       FROM error_group g
       CROSS JOIN LATERAL ${COUNTS} c
       LEFT JOIN app_user u ON u.user_id = g.assigned_to
       LEFT JOIN employee ae ON ae.employee_id = u.employee_id
      WHERE ${sql}
      ORDER BY ${orderBy({ sort }, SORTS, "g.error_group_id")}`,
    params,
    query,
  );
}

/** One fault, with its counts and who holds it. */
function get(db, id) {
  return one(
    db,
    `SELECT ${GROUP}, c.today, c.total, c.people, trim(ae.first_name || ' ' || ae.last_name) AS assigned_name
       FROM error_group g
       CROSS JOIN LATERAL ${COUNTS} c
       LEFT JOIN app_user u ON u.user_id = g.assigned_to
       LEFT JOIN employee ae ON ae.employee_id = u.employee_id
      WHERE g.error_group_id = $1`,
    [id],
  );
}

/** Several faults, for the brief and the bulk change. Same shape as get(). */
function getMany(db, ids) {
  return all(
    db,
    `SELECT ${GROUP}, c.today, c.total, c.people, trim(ae.first_name || ' ' || ae.last_name) AS assigned_name
       FROM error_group g
       CROSS JOIN LATERAL ${COUNTS} c
       LEFT JOIN app_user u ON u.user_id = g.assigned_to
       LEFT JOIN employee ae ON ae.employee_id = u.employee_id
      WHERE g.error_group_id = ANY($1::uuid[])
      ORDER BY g.last_seen_at DESC`,
    [ids],
  );
}

/** The latest occurrences of one fault. Never a name or an email: the reporter scrubbed them. */
function occurrences(db, fingerprint, limit = OCCURRENCES) {
  return all(
    db,
    `SELECT e.occurred_at, e.route, e.origin, e.release, e.request_id, e.message, e.stack
       FROM error_event e
      WHERE e.fingerprint = $1
      ORDER BY e.occurred_at DESC
      LIMIT $2 -- pagination:batch the fault sheet and the brief show the latest few occurrences of one fault, not a list`,
    [fingerprint, limit],
  );
}

/** The last 14 Lagos days of one fault, oldest first, with the quiet days as zeros. */
function daily(db, fingerprint, days = 14) {
  return all(
    db,
    `WITH span AS (
       SELECT generate_series(
         (date_trunc('day', now() AT TIME ZONE '${TZ}') - make_interval(days => $2 - 1))::date,
         (date_trunc('day', now() AT TIME ZONE '${TZ}'))::date,
         interval '1 day')::date AS day
     )
     SELECT to_char(s.day, 'YYYY-MM-DD') AS day,
            COALESCE(count(e.error_event_id), 0)::int AS events
       FROM span s
       LEFT JOIN error_event e
         ON e.fingerprint = $1
        AND (e.occurred_at AT TIME ZONE '${TZ}')::date = s.day
      GROUP BY s.day
      ORDER BY s.day`,
    [fingerprint, days],
  );
}

function notes(db, id) {
  return all(
    db,
    `SELECT n.error_group_note_id, n.body, n.author_user_id, trim(ne.first_name || ' ' || ne.last_name) AS author_name, n.created_at
       FROM error_group_note n
       LEFT JOIN app_user u ON u.user_id = n.author_user_id
       LEFT JOIN employee ne ON ne.employee_id = u.employee_id
      WHERE n.error_group_id = $1
      ORDER BY n.created_at`,
    [id],
  );
}

function addNote(db, { error_group_id: id, author_user_id: author, body }) {
  return one(
    db,
    `INSERT INTO error_group_note (error_group_id, author_user_id, body)
     VALUES ($1, $2, $3)
     RETURNING error_group_note_id, body, author_user_id, created_at`,
    [id, author || null, body],
  );
}

/**
 * Set a fault's status, who holds it, or both. Only the fields given change, and a status
 * that is not moving is left alone so `status_changed_at` keeps meaning what it says.
 * @returns {Promise<object|null>} the row as it now is, or null when the id is unknown
 */
function setState(db, id, { status, assigned_to: assignee, actor }) {
  return one(
    db,
    `UPDATE error_group g
        SET status = COALESCE($2, g.status),
            status_changed_at = CASE WHEN $2 IS NOT NULL AND $2 <> g.status THEN now() ELSE g.status_changed_at END,
            status_changed_by = CASE WHEN $2 IS NOT NULL AND $2 <> g.status THEN $4 ELSE g.status_changed_by END,
            assigned_to = CASE WHEN $3::boolean THEN $5 ELSE g.assigned_to END,
            -- Moving off open ends the 24 hour escalation; moving back on starts it again.
            escalated_at = CASE WHEN $2 IS NOT NULL AND $2 <> 'open' THEN NULL ELSE g.escalated_at END
      WHERE g.error_group_id = $1
      RETURNING ${GROUP}`,
    [id, status || null, assignee !== undefined, actor || null, assignee || null],
  );
}

/** Several faults to one status. Returns how many actually moved. */
async function setStatusMany(db, ids, status, actor) {
  const { rowCount } = await db.query(
    `UPDATE error_group
        SET status = $2,
            status_changed_at = now(),
            status_changed_by = $3,
            escalated_at = CASE WHEN $2 <> 'open' THEN NULL ELSE escalated_at END
      WHERE error_group_id = ANY($1::uuid[]) AND status <> $2`,
    [ids, status, actor || null],
  );
  return rowCount;
}

/**
 * Take whoever has nobody on them, for the person who downloaded a brief: the same rule
 * Ops consoles use, so two people do not fix one fault twice.
 */
async function claimUnassigned(db, ids, userId) {
  const { rowCount } = await db.query(
    `UPDATE error_group SET assigned_to = $2 WHERE error_group_id = ANY($1::uuid[]) AND assigned_to IS NULL`,
    [ids, userId],
  );
  return rowCount;
}

/** The counts above the screen, over the last 24 hours. */
function faultCounts(db) {
  return one(
    db,
    `SELECT count(*) FILTER (WHERE status IN ('open', 'handling'))::int AS faults_open,
            count(*) FILTER (WHERE first_seen_at > now() - interval '24 hours')::int AS faults_new_24h,
            count(*) FILTER (WHERE regressed_at > now() - interval '24 hours')::int AS faults_returned_24h
       FROM error_group`,
  );
}

/* ------------------------------------------------------------------ *
 * Snapshots
 * ------------------------------------------------------------------ */

function addSnapshot(db, s) {
  return one(
    db,
    `INSERT INTO health_snapshot (status, checks, outbox_backlog, worker_lag_s, faults_open, faults_new_24h, release,
                                  disk_free_pct, memory_used_pct, cpu_load, database_mb, database_connections_pct,
                                  requests, error_pct, mean_ms)
     VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING health_snapshot_id, taken_at, status`,
    [s.status, JSON.stringify(s.checks || {}), s.outbox_backlog || 0, s.worker_lag_s ?? null,
     s.faults_open || 0, s.faults_new_24h || 0, s.release || null,
     s.disk_free_pct ?? null, s.memory_used_pct ?? null, s.cpu_load ?? null,
     s.database_mb ?? null, s.database_connections_pct ?? null,
     s.requests ?? null, s.error_pct ?? null, s.mean_ms ?? null],
  );
}

/**
 * The traffic of the window just gone, from the minutes the API wrote
 * (shared/observability/request-stats.js). Null when nothing was served, which is
 * different from zero and is drawn as a gap.
 */
function trafficSince(db, minutes = 5) {
  return one(
    db,
    `SELECT COALESCE(sum(requests), 0)::bigint AS requests,
            COALESCE(sum(errors), 0)::bigint AS errors,
            COALESCE(sum(total_ms), 0)::bigint AS total_ms
       FROM request_stat
      WHERE minute > now() - make_interval(mins => $1)`,
    [minutes],
  );
}

function lastSnapshot(db) {
  return one(db, "SELECT * FROM health_snapshot ORDER BY taken_at DESC LIMIT 1");
}

/** How far back a check's history and its "since" read. The screen draws a week too. */
const HISTORY_DAYS = 7;

/** A probe's status as the screen names it: anything but up or degraded is down. */
const STATE_OF = (expr) => `CASE WHEN ${expr} IN ('up', 'degraded') THEN ${expr} ELSE 'down' END`;

/**
 * For every check, when it entered the state the newest snapshot has it in: the last
 * change in the window, or the window's first snapshot when it has not changed since.
 * @returns {Promise<Array<{key: string, state: string, since: Date}>>}
 */
function lastChanges(db) {
  return all(
    db,
    `WITH seen AS (
       SELECT s.taken_at, k.key, ${STATE_OF("k.value->>'status'")} AS state
         FROM health_snapshot s
         CROSS JOIN LATERAL jsonb_each(s.checks) k
        WHERE s.taken_at > now() - make_interval(days => $1)
     ), marked AS (
       SELECT key, taken_at, state, LAG(state) OVER (PARTITION BY key ORDER BY taken_at) AS before
         FROM seen
     )
     SELECT key,
            (array_agg(state ORDER BY taken_at DESC))[1] AS state,
            max(taken_at) FILTER (WHERE before IS NULL OR before <> state) AS since
       FROM marked
      GROUP BY key`,
    [HISTORY_DAYS],
  );
}

/**
 * One page of a check's changes of state over the window, newest first. The window's
 * first snapshot is where reading starts, not a change, so it is never a row.
 */
function changes(db, key, query) {
  return pageQuery(
    db,
    `SELECT t.at, t.before AS "from", t.state AS "to", t.value, ${TOTAL_COL}
       FROM (
         SELECT s.health_snapshot_id, s.taken_at AS at, s.checks->($1::text) AS value,
                ${STATE_OF("s.checks->($1::text)->>'status'")} AS state,
                LAG(${STATE_OF("s.checks->($1::text)->>'status'")}) OVER (ORDER BY s.taken_at) AS before
           FROM health_snapshot s
          WHERE s.taken_at > now() - make_interval(days => $2)
            AND s.checks ? ($1::text)
       ) t
      WHERE t.before IS NOT NULL AND t.before <> t.state
      ORDER BY t.at DESC, t.health_snapshot_id`,
    [key, HISTORY_DAYS],
    query,
  );
}

/** The same as changes(), for every check at once: the Status brief's table. */
function changesOfAll(db, query) {
  return pageQuery(
    db,
    `SELECT t.key, t.at, t.before AS "from", t.state AS "to", t.value, ${TOTAL_COL}
       FROM (
         SELECT s.health_snapshot_id, s.taken_at AS at, k.key, k.value,
                ${STATE_OF("k.value->>'status'")} AS state,
                LAG(${STATE_OF("k.value->>'status'")}) OVER (PARTITION BY k.key ORDER BY s.taken_at) AS before
           FROM health_snapshot s
           CROSS JOIN LATERAL jsonb_each(s.checks) k
          WHERE s.taken_at > now() - make_interval(days => $1)
       ) t
      WHERE t.before IS NOT NULL AND t.before <> t.state
      ORDER BY t.at DESC, t.key, t.health_snapshot_id`,
    [HISTORY_DAYS],
    query,
  );
}

/**
 * The snapshot nearest each moment, within ten minutes before it and five after: what
 * the system looked like when a fault fired (the Faults brief's state header).
 * @param {Date[]|string[]} moments
 * @returns {Promise<Array<{at: Date, taken_at: Date|null, checks: object|null}>>}  one row per
 *   moment, in the order given
 */
function snapshotsAround(db, moments) {
  if (!moments.length) return Promise.resolve([]);
  return all(
    db,
    `SELECT m.at, s.taken_at, s.checks
       FROM unnest($1::timestamptz[]) WITH ORDINALITY AS m(at, n)
       LEFT JOIN LATERAL (
         SELECT taken_at, checks
           FROM health_snapshot
          WHERE taken_at BETWEEN m.at - interval '10 minutes' AND m.at + interval '5 minutes'
          ORDER BY abs(date_part('epoch', taken_at - m.at))
          LIMIT 1
       ) s ON true
      ORDER BY m.n`,
    [moments.map((m) => new Date(m).toISOString())],
  );
}

/* ------------------------------------------------------------------ *
 * Performance (migration 9120)
 * ------------------------------------------------------------------ */

/**
 * The four windows: how far back, and how wide a bucket. Buckets start on Lagos
 * boundaries (date_bin from a Lagos midnight), so a Month bucket is a Lagos day.
 */
const WINDOWS = Object.freeze({
  hour: { minutes: 60, bucket: "1 minute", bucket_minutes: 1 },
  day: { minutes: 24 * 60, bucket: "15 minutes", bucket_minutes: 15 },
  week: { minutes: 7 * 24 * 60, bucket: "1 hour", bucket_minutes: 60 },
  month: { minutes: 30 * 24 * 60, bucket: "1 day", bucket_minutes: 24 * 60 },
});
const ORIGIN = "TIMESTAMPTZ '2000-01-01 00:00:00+01'";
const BIN = (col) => `date_bin($2::interval, ${col}, ${ORIGIN})`;

/** One minute of the server, as system_health.sample.js built it. A minute already written stays. */
function addSample(db, row) {
  const keys = Object.keys(row);
  return db.query(
    `INSERT INTO perf_sample (${keys.join(", ")})
     VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})
     ON CONFLICT (minute) DO NOTHING`,
    keys.map((k) => row[k]),
  );
}

/** People connected to a live API process now: the sum of each process's own count. */
async function usersOnline(db) {
  const r = await one(
    db,
    `SELECT COALESCE(sum(users_online), 0)::int AS n
       FROM process_beat
      WHERE role = 'api' AND last_beat_at > now() - interval '2 minutes'`,
  );
  return r ? r.n : 0;
}

/**
 * The window bucketed: the server from perf_sample, the traffic from request_stat, and
 * each bucket's 95th percentile from its summed latency buckets. A bucket with neither is
 * left out, so the screen draws a gap rather than a zero.
 */
function perfSeries(db, range, bounds) {
  const w = WINDOWS[range];
  return all(
    db,
    `WITH s AS (
       SELECT ${BIN("minute")} AS at,
              count(api_up)::int AS samples,
              count(*) FILTER (WHERE api_up)::int AS up,
              avg(cpu_busy_pct) AS cpu_busy_pct,
              avg(cpu_steal_pct) AS cpu_steal_pct,
              avg(cpu_iowait_pct) AS cpu_iowait_pct,
              avg(memory_in_use_mb::numeric * 100 / NULLIF(memory_total_mb, 0)) AS memory_in_use_pct,
              avg(disk_used_mb::numeric * 100 / NULLIF(disk_total_mb, 0)) AS disk_used_pct,
              avg(disk_read_kb) / 60 AS disk_read_kbs,
              avg(disk_written_kb) / 60 AS disk_write_kbs,
              avg(network_in_kb) / 60 AS network_in_kbs,
              avg(network_out_kb) / 60 AS network_out_kbs,
              round(avg(users_online)) AS users_online
         FROM perf_sample
        WHERE minute > now() - make_interval(mins => $1)
        GROUP BY 1),
     t AS (
       SELECT ${BIN("minute")} AS at,
              sum(requests)::bigint AS requests,
              sum(errors)::bigint AS errors,
              sum(total_ms)::bigint AS total_ms
         FROM request_stat
        WHERE minute > now() - make_interval(mins => $1)
        GROUP BY 1),
     h AS (
       SELECT ${BIN("r.minute")} AS at, u.i, sum(u.v)::bigint AS n
         FROM request_stat r, unnest(r.buckets) WITH ORDINALITY AS u(v, i)
        WHERE r.minute > now() - make_interval(mins => $1)
        GROUP BY 1, 2),
     hh AS (SELECT at, array_agg(n ORDER BY i) AS hist FROM h GROUP BY 1)
     SELECT COALESCE(s.at, t.at) AS at, s.samples, s.up,
            s.cpu_busy_pct, s.cpu_steal_pct, s.cpu_iowait_pct, s.memory_in_use_pct, s.disk_used_pct,
            s.disk_read_kbs, s.disk_write_kbs, s.network_in_kbs, s.network_out_kbs, s.users_online,
            t.requests, t.errors, t.total_ms,
            perf_percentile(hh.hist, $3::int[], 0.95) AS p95_ms
       FROM s
       FULL JOIN t ON t.at = s.at
       LEFT JOIN hh ON hh.at = COALESCE(s.at, t.at)
      ORDER BY 1`,
    [w.minutes, w.bucket, bounds],
  );
}

/**
 * The window's headline figures: availability and the minutes down, the traffic and its
 * percentile over the whole window, the busiest minute, and how much of the window has
 * no sample since the first sample ever (so a new server is not a day of gaps).
 */
function perfHeadline(db, range, bounds) {
  const w = WINDOWS[range];
  return one(
    db,
    `WITH first AS (SELECT min(minute) AS at FROM perf_sample),
     since AS (SELECT GREATEST(now() - make_interval(mins => $1), (SELECT at FROM first)) AS at),
     s AS (
       SELECT count(api_up)::int AS samples,
              count(*) FILTER (WHERE api_up)::int AS up,
              count(*) FILTER (WHERE api_up = false)::int AS down,
              count(*) FILTER (WHERE minute > (SELECT at FROM since))::int AS recorded
         FROM perf_sample
        WHERE minute > now() - make_interval(mins => $1)),
     t AS (
       SELECT COALESCE(sum(requests), 0)::bigint AS requests,
              COALESCE(sum(errors), 0)::bigint AS errors,
              COALESCE(sum(total_ms), 0)::bigint AS total_ms,
              max(requests)::int AS peak,
              min(minute) AS first_minute
         FROM request_stat
        WHERE minute > now() - make_interval(mins => $1)),
     h AS (
       SELECT u.i, sum(u.v)::bigint AS n
         FROM request_stat r, unnest(r.buckets) WITH ORDINALITY AS u(v, i)
        WHERE r.minute > now() - make_interval(mins => $1)
        GROUP BY 1)
     SELECT s.samples, s.up, s.down, s.recorded,
            (SELECT at FROM first) AS first_sample_at,
            (SELECT at FROM since) AS since,
            (SELECT max(minute) FROM perf_sample) AS last_sample_at,
            t.requests, t.errors, t.total_ms, t.peak, t.first_minute,
            perf_percentile((SELECT array_agg(n ORDER BY i) FROM h), $2::int[], 0.95) AS p95_ms
       FROM s, t`,
    [w.minutes, bounds],
  );
}

/** The latest minute of the server. */
function latestSample(db) {
  return one(db, "SELECT * FROM perf_sample ORDER BY minute DESC LIMIT 1");
}

/** The busiest minute of the last 24 hours. */
function cpuPeak(db) {
  return one(
    db,
    `SELECT minute, cpu_busy_pct
       FROM perf_sample
      WHERE minute > now() - interval '24 hours' AND cpu_busy_pct IS NOT NULL
      ORDER BY cpu_busy_pct DESC, minute DESC
      LIMIT 1`,
  );
}

/** How fast the disk is filling: a least-squares line through 7 days of hourly averages, in MB a day. */
function diskTrend(db) {
  return one(
    db,
    `WITH h AS (
       SELECT date_bin('1 hour', minute, ${ORIGIN}) AS at, avg(disk_used_mb) AS used
         FROM perf_sample
        WHERE minute > now() - interval '7 days' AND disk_used_mb IS NOT NULL
        GROUP BY 1)
     SELECT regr_slope(used, date_part('epoch', at) / 86400) AS mb_per_day, count(*)::int AS hours FROM h`,
  );
}

/** Data in and out since the first of this month, Lagos time, in MB. */
function networkMonth(db) {
  return one(
    db,
    `SELECT (sum(network_in_kb) / 1024)::bigint AS in_mb, (sum(network_out_kb) / 1024)::bigint AS out_mb
       FROM perf_sample
      WHERE minute >= date_trunc('month', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}'`,
  );
}

/** Each route over the window, with its percentile, a page at a time. */
const ROUTE_SORTS = { p95_ms: "p95_ms", requests: "t.requests", errors: "t.errors", mean_ms: "mean_ms" };

function routesPage(db, query, bounds) {
  const w = WINDOWS[query.range || "day"];
  const sort = query.sort || { field: "p95_ms", dir: "desc" };
  const since = `date_bin('15 minutes', now() - make_interval(mins => $1), ${ORIGIN})`;
  return pageQuery(
    db,
    `WITH t AS (
       SELECT method, route,
              sum(requests)::bigint AS requests, sum(errors)::bigint AS errors,
              sum(client_errors)::bigint AS client_errors, sum(slow)::bigint AS slow,
              sum(total_ms)::bigint AS total_ms, max(max_ms) AS max_ms
         FROM route_stat
        WHERE bucket >= ${since}
        GROUP BY 1, 2),
     h AS (
       SELECT r.method, r.route, u.i, sum(u.v)::bigint AS n
         FROM route_stat r, unnest(r.buckets) WITH ORDINALITY AS u(v, i)
        WHERE r.bucket >= ${since}
        GROUP BY 1, 2, 3),
     hh AS (SELECT method, route, array_agg(n ORDER BY i) AS hist FROM h GROUP BY 1, 2)
     SELECT t.method, t.route, t.requests, t.errors, t.client_errors, t.slow, t.max_ms,
            (t.total_ms / NULLIF(t.requests, 0))::int AS mean_ms,
            COALESCE(perf_percentile(hh.hist, $2::int[], 0.95), 0) AS p95_ms,
            ${TOTAL_COL}
       FROM t
       LEFT JOIN hh ON hh.method = t.method AND hh.route = t.route
      ORDER BY ${orderBy({ sort }, ROUTE_SORTS, "t.method, t.route")}`,
    [w.minutes, bounds],
    query,
  );
}

/** This database: its size, connections by state, cache, deadlocks and the oldest transaction. */
function databaseSummary(db) {
  return one(
    db,
    `SELECT current_setting('server_version') AS version,
            pg_database_size(current_database()) AS bytes,
            current_setting('max_connections')::int AS connections_max,
            count(a.*)::int AS connections_used,
            count(a.*) FILTER (WHERE a.state = 'active')::int AS active,
            count(a.*) FILTER (WHERE a.state = 'idle')::int AS idle,
            count(a.*) FILTER (WHERE a.state LIKE 'idle in transaction%')::int AS idle_in_transaction,
            count(a.*) FILTER (WHERE a.wait_event_type = 'Lock')::int AS waiting,
            extract(epoch FROM now() - min(a.xact_start) FILTER (WHERE a.pid <> pg_backend_pid()))::int AS oldest_transaction_s,
            (SELECT blks_hit FROM pg_stat_database WHERE datname = current_database()) AS blks_hit,
            (SELECT blks_read FROM pg_stat_database WHERE datname = current_database()) AS blks_read,
            (SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()) AS deadlocks,
            (SELECT temp_bytes FROM pg_stat_database WHERE datname = current_database()) AS temp_bytes
       FROM pg_stat_activity a
      WHERE a.datname = current_database()`,
  );
}

/** How fast this database is growing, in MB a day, from the snapshots of the last 7 days. */
function databaseGrowth(db) {
  return one(
    db,
    `SELECT regr_slope(database_mb, date_part('epoch', taken_at) / 86400) AS mb_per_day, count(*)::int AS snapshots
       FROM health_snapshot
      WHERE taken_at > now() - interval '7 days' AND database_mb IS NOT NULL`,
  );
}

/** This database's tables, largest first. */
const TABLE_SORTS = {
  total_bytes: "pg_total_relation_size(s.relid)",
  rows: "s.n_live_tup",
  dead_pct: "dead_pct",
};

function tablesPage(db, query) {
  const sort = query.sort || { field: "total_bytes", dir: "desc" };
  return pageQuery(
    db,
    `SELECT s.relname AS name, s.n_live_tup AS rows,
            pg_total_relation_size(s.relid) AS total_bytes,
            pg_relation_size(s.relid) AS table_bytes,
            pg_indexes_size(s.relid) AS index_bytes,
            CASE WHEN s.n_live_tup + s.n_dead_tup > 0
                 THEN round(s.n_dead_tup * 100.0 / (s.n_live_tup + s.n_dead_tup), 2) END AS dead_pct,
            GREATEST(s.last_vacuum, s.last_autovacuum) AS last_vacuum_at,
            ${TOTAL_COL}
       FROM pg_stat_user_tables s
      ORDER BY ${orderBy({ sort }, TABLE_SORTS, "s.relid")}`,
    [],
    query,
  );
}

/**
 * Whether pg_stat_statements can be read: the extension exists in this database and the
 * server preloads its library. Either missing, and reading the view fails.
 */
async function statementsOn(db) {
  try {
    await db.query("SELECT 1 FROM pg_stat_statements LIMIT 1");
    return true;
  } catch {
    return false;
  }
}

/** The statements this environment's role ran in this database, by the time they took. */
const QUERY_SORTS = { total_ms: "p.total_exec_time", mean_ms: "p.mean_exec_time", calls: "p.calls" };

function queriesPage(db, query) {
  const sort = query.sort || { field: "total_ms", dir: "desc" };
  return pageQuery(
    db,
    `SELECT p.queryid::text AS query_id,
            left(regexp_replace(p.query, '\\s+', ' ', 'g'), 400) AS query,
            p.calls, p.total_exec_time AS total_ms, p.mean_exec_time AS mean_ms, p.max_exec_time AS max_ms, p.rows,
            p.total_exec_time * 100 / NULLIF(sum(p.total_exec_time) OVER (), 0) AS share_pct,
            ${TOTAL_COL}
       FROM pg_stat_statements p
      WHERE p.dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND p.userid = (SELECT oid FROM pg_roles WHERE rolname = current_user)
      ORDER BY ${orderBy({ sort }, QUERY_SORTS, "p.queryid")}`,
    [],
    query,
  );
}

/** The outbox: waiting, the oldest waiting, failed for good, and done in the last hour. */
function outboxFigures(db) {
  return one(
    db,
    `SELECT count(*) FILTER (WHERE status IN ('pending', 'processing'))::int AS waiting,
            extract(epoch FROM now() - min(created_at) FILTER (WHERE status = 'pending'))::int AS oldest_s,
            count(*) FILTER (WHERE status = 'failed')::int AS failed,
            count(*) FILTER (WHERE status = 'done' AND processed_at > now() - interval '1 hour')::int AS done_hour
       FROM event_outbox`,
  );
}

/** Every scheduler the code declares, with its runs; one the table has never seen has none. */
const JOB_SORTS = { name: "s.name", last_ms: "r.duration_ms", failures: "r.failures" };

function jobsPage(db, query, names) {
  return pageQuery(
    db,
    `SELECT s.name, r.last_run_at, r.duration_ms, r.ok, r.runs, r.failures, r.total_ms, r.max_ms,
            ${TOTAL_COL}
       FROM unnest($1::text[]) AS s(name)
       LEFT JOIN schedule_run r ON r.name = s.name
      ORDER BY ${orderBy(query, JOB_SORTS, "s.name")}`,
    [names],
    query,
  );
}

/** The processes that have beaten in the last 3 minutes: one row each, a handful at most. */
function liveProcesses(db) {
  return all(
    db,
    `SELECT * FROM process_beat
      WHERE last_beat_at > now() - interval '3 minutes'
      ORDER BY role, started_at DESC`,
  );
}

/** How many times each role started in the last 7 days. */
function startsThisWeek(db) {
  return all(
    db,
    `SELECT role, count(*)::int AS starts
       FROM process_beat
      WHERE started_at > now() - interval '7 days'
      GROUP BY role`,
  );
}

/* ------------------------------------------------------------------ *
 * The roll-up
 * ------------------------------------------------------------------ */

/**
 * Every fingerprint seen since `since`, with what the group should now say about it.
 * The worst severity wins, and the newest row gives the message, route and release.
 */
function recentFingerprints(db, since) {
  return all(
    db,
    `SELECT DISTINCT ON (e.fingerprint)
            e.fingerprint,
            e.name,
            e.message AS last_message,
            e.route,
            e.release AS last_release,
            e.origin,
            (SELECT min(x.occurred_at) FROM error_event x WHERE x.fingerprint = e.fingerprint) AS first_seen_at,
            (SELECT max(x.occurred_at) FROM error_event x WHERE x.fingerprint = e.fingerprint) AS last_seen_at,
            (SELECT x.release FROM error_event x WHERE x.fingerprint = e.fingerprint
              ORDER BY x.occurred_at LIMIT 1) AS first_release,
            (SELECT CASE WHEN bool_or(x.severity = 'fatal') THEN 'fatal'
                         WHEN bool_or(x.severity = 'error') THEN 'error'
                         WHEN bool_or(x.severity = 'warning') THEN 'warning'
                         ELSE 'notice' END
               FROM error_event x WHERE x.fingerprint = e.fingerprint) AS severity,
            -- The first "at" line: a message of several lines puts its own words on line 2.
            (SELECT COALESCE(substring(x.stack from '\\n\\s+(at [^\\n]+)'), split_part(x.stack, E'\\n', 2)) FROM error_event x
              WHERE x.fingerprint = e.fingerprint AND x.stack IS NOT NULL
              ORDER BY x.occurred_at DESC LIMIT 1) AS frame
       FROM error_event e
      WHERE e.occurred_at > $1
      ORDER BY e.fingerprint, e.occurred_at DESC`,
    [since],
  );
}

/**
 * Create the group or refresh it. Returns the row and whether it is new, so the caller
 * knows whether to tell anybody. The title is the message with its ids already
 * normalised, which is what the fingerprint was built from.
 *
 * `status` and who holds it are never touched here: a decision a person took outlives
 * the next occurrence.
 */
function upsertGroup(db, g) {
  return one(
    db,
    `INSERT INTO error_group (fingerprint, title, name, last_message, severity, origin, route, frame,
                              first_seen_at, last_seen_at, first_release, last_release)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (fingerprint) DO UPDATE SET
       title = EXCLUDED.title,
       last_message = EXCLUDED.last_message,
       severity = EXCLUDED.severity,
       route = COALESCE(EXCLUDED.route, error_group.route),
       frame = COALESCE(EXCLUDED.frame, error_group.frame),
       first_seen_at = LEAST(error_group.first_seen_at, EXCLUDED.first_seen_at),
       last_seen_at = GREATEST(error_group.last_seen_at, EXCLUDED.last_seen_at),
       last_release = COALESCE(EXCLUDED.last_release, error_group.last_release),
       updated_at = now()
     RETURNING ${GROUP.replace(/g\./g, "error_group.")}, (xmax = 0) AS is_new`,
    [g.fingerprint, g.title, g.name, g.last_message, g.severity, g.origin, g.route, g.frame,
     g.first_seen_at, g.last_seen_at, g.first_release, g.last_release],
  );
}

/**
 * A fault marked fixed that has fired since somebody marked it: back to open, counted.
 * @returns {Promise<object|null>} the row, when it had in fact come back
 */
function markReturned(db, id) {
  return one(
    db,
    `UPDATE error_group
        SET status = 'open',
            regressions = regressions + 1,
            regressed_at = now(),
            status_changed_at = now(),
            escalated_at = NULL
      WHERE error_group_id = $1
        AND status = 'fixed'
        AND last_seen_at > COALESCE(status_changed_at, first_seen_at)
      RETURNING ${GROUP.replace(/g\./g, "error_group.")}`,
    [id],
  );
}

/**
 * Is this fault firing far faster than it usually does? 10 or more in the last hour and
 * at least five times its mean hourly rate over the week before. Told at most once in
 * six hours, which `spiked_at` holds.
 */
async function spiking(db, fingerprint) {
  const r = await one(
    db,
    `SELECT count(*) FILTER (WHERE occurred_at > now() - interval '1 hour')::int AS last_hour,
            (count(*) FILTER (WHERE occurred_at <= now() - interval '1 hour'
                                AND occurred_at > now() - interval '8 days')::numeric / (24 * 7)) AS mean_hourly
       FROM error_event WHERE fingerprint = $1`,
    [fingerprint],
  );
  if (!r) return false;
  const mean = Number(r.mean_hourly || 0);
  return r.last_hour >= 10 && r.last_hour >= Math.max(5 * mean, 10);
}

function markSpiked(db, id) {
  return db.query(
    `UPDATE error_group SET spiked_at = now()
      WHERE error_group_id = $1 AND (spiked_at IS NULL OR spiked_at < now() - interval '6 hours')`,
    [id],
  );
}

/** Faults open 24 hours or more since they were first seen, not escalated in the last day. */
function unattended(db) {
  return all(
    db,
    `SELECT ${GROUP}
       FROM error_group g
      WHERE g.status = 'open'
        AND g.severity IN ('fatal', 'error')
        AND g.first_seen_at < now() - interval '24 hours'
        AND (g.escalated_at IS NULL OR g.escalated_at < now() - interval '24 hours')
      ORDER BY g.first_seen_at
      LIMIT 25 -- pagination:batch how many escalations one tick sends; the next tick takes the rest`,
  );
}

function markEscalated(db, ids) {
  return db.query("UPDATE error_group SET escalated_at = now() WHERE error_group_id = ANY($1::uuid[])", [ids]);
}

/** The 08:00 digest's figures. */
function digestFigures(db) {
  return one(
    db,
    `SELECT count(*) FILTER (WHERE status IN ('open', 'handling'))::int AS open,
            count(*) FILTER (WHERE status = 'open' AND severity IN ('fatal', 'error'))::int AS serious,
            count(*) FILTER (WHERE first_seen_at > now() - interval '24 hours')::int AS new_today,
            count(*) FILTER (WHERE regressed_at > now() - interval '24 hours')::int AS came_back,
            count(*) FILTER (WHERE status = 'open' AND first_seen_at < now() - interval '24 hours'
                             AND severity IN ('fatal', 'error'))::int AS unattended
       FROM error_group`,
  );
}

/**
 * Nightly: occurrences past KEEP_EVENT_DAYS; snapshots, the minutes of traffic, the
 * server's samples, the routes' quarter hours and silent processes past KEEP_SNAPSHOT_DAYS.
 * `schedule_run` is one row per job and is never purged.
 */
async function purge(db) {
  const events = await db.query(
    `DELETE FROM error_event WHERE occurred_at < now() - make_interval(days => $1)`,
    [KEEP_EVENT_DAYS],
  );
  const snapshots = await db.query(
    `DELETE FROM health_snapshot WHERE taken_at < now() - make_interval(days => $1)`,
    [KEEP_SNAPSHOT_DAYS],
  );
  const minutes = await db.query(
    `DELETE FROM request_stat WHERE minute < now() - make_interval(days => $1)`,
    [KEEP_SNAPSHOT_DAYS],
  );
  const samples = await db.query(
    `DELETE FROM perf_sample WHERE minute < now() - make_interval(days => $1)`,
    [KEEP_SNAPSHOT_DAYS],
  );
  const routes = await db.query(
    `DELETE FROM route_stat WHERE bucket < now() - make_interval(days => $1)`,
    [KEEP_SNAPSHOT_DAYS],
  );
  const beats = await db.query(
    `DELETE FROM process_beat WHERE last_beat_at < now() - make_interval(days => $1)`,
    [KEEP_SNAPSHOT_DAYS],
  );
  return {
    events: events.rowCount,
    snapshots: snapshots.rowCount,
    minutes: minutes.rowCount,
    samples: samples.rowCount,
    routes: routes.rowCount,
    beats: beats.rowCount,
  };
}

module.exports = {
  KEEP_EVENT_DAYS,
  KEEP_SNAPSHOT_DAYS,
  OCCURRENCES,
  filtersOf,
  page,
  get,
  getMany,
  occurrences,
  daily,
  notes,
  addNote,
  setState,
  setStatusMany,
  claimUnassigned,
  faultCounts,
  addSnapshot,
  lastSnapshot,
  HISTORY_DAYS,
  lastChanges,
  changes,
  changesOfAll,
  snapshotsAround,
  trafficSince,
  WINDOWS,
  addSample,
  usersOnline,
  perfSeries,
  perfHeadline,
  latestSample,
  cpuPeak,
  diskTrend,
  networkMonth,
  routesPage,
  databaseSummary,
  databaseGrowth,
  tablesPage,
  statementsOn,
  queriesPage,
  outboxFigures,
  jobsPage,
  liveProcesses,
  startsThisWeek,
  recentFingerprints,
  upsertGroup,
  markReturned,
  spiking,
  markSpiked,
  unattended,
  markEscalated,
  digestFigures,
  purge,
};
