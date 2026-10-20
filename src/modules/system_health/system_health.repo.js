"use strict";
/**
 * Reading and writing faults and snapshots (migration 9100).
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

/**
 * The chart: snapshots bucketed into hours over a day, or days over a week. A bucket with
 * no snapshot is left out, so the screen can draw the gap rather than a flat line.
 */
function series(db, range) {
  const hours = range === "7d" ? 24 * 7 : 24;
  const bucket = range === "7d" ? "day" : "hour";
  return all(
    db,
    `SELECT date_trunc('${bucket}', taken_at) AS at,
            CASE WHEN bool_or(status = 'unavailable') THEN 'unavailable'
                 WHEN bool_or(status = 'degraded') THEN 'degraded'
                 ELSE 'ready' END AS state,
            max(faults_open)::int AS faults,
            max(outbox_backlog)::int AS outbox_backlog,
            max(worker_lag_s)::int AS worker_lag_s,
            min(disk_free_pct)::int AS disk_free_pct,
            max(memory_used_pct)::int AS memory_used_pct,
            max(cpu_load)::numeric AS cpu_load,
            max(database_mb)::int AS database_mb,
            max(database_connections_pct)::int AS database_connections_pct,
            sum(requests)::bigint AS requests,
            max(error_pct)::numeric AS error_pct,
            round(avg(mean_ms))::int AS mean_ms,
            count(*)::int AS snapshots
       FROM health_snapshot
      WHERE taken_at > now() - make_interval(hours => $1)
      GROUP BY 1
      ORDER BY 1`,
    [hours],
  );
}

/** How much of the window every check was up, and how many minutes have no snapshot at all. */
function uptime(db, range) {
  const hours = range === "7d" ? 24 * 7 : 24;
  return one(
    db,
    `SELECT count(*)::int AS snapshots,
            count(*) FILTER (WHERE status = 'ready')::int AS ready
       FROM health_snapshot
      WHERE taken_at > now() - make_interval(hours => $1)`,
    [hours],
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
            (SELECT split_part(x.stack, E'\\n', 2) FROM error_event x
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
 * Nightly: occurrences past KEEP_EVENT_DAYS, snapshots and the minutes of traffic past
 * KEEP_SNAPSHOT_DAYS. `schedule_run` is one row per job and is never purged.
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
  return { events: events.rowCount, snapshots: snapshots.rowCount, minutes: minutes.rowCount };
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
  trafficSince,
  series,
  uptime,
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
