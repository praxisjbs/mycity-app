"use strict";
/**
 * The app's traffic, kept in memory and written once a minute, so Settings · Performance
 * can show how fast the app answered and what share of requests failed
 * (docs/guides/system-health.md §6).
 *
 *   requestStats.record(ms, statusCode, { method, route });  // middleware/access-log.js
 *   await requestStats.flush();                              // on the timer, and at shutdown
 *
 * Two tables, both added to rather than replaced, so several API processes and a restart
 * inside one minute land in one row:
 *
 *   request_stat  a minute of all /api/ requests
 *   route_stat    a quarter hour of one route (the route as declared, `/faults/:id`, or
 *                 `(no route)` for a 404, so the number of rows stays bounded)
 *
 * Each row carries its latency buckets: how many requests took at most each bound in
 * BOUNDS_MS, and how many took longer. Bucket counts add across processes, so the 95th
 * percentile is worked out from them at read time (perf_percentile(), migration 9120); a
 * percentile stored by each process could not be combined.
 *
 * Why this and not the Prometheus metrics that are already collected: those live in the
 * process that served the request, and the snapshot is taken in the worker, which cannot
 * read them. A row a minute is readable by anything with the database.
 *
 * Never throws, and never delays a request: recording is a few numbers in a Map, and a
 * write that fails is logged and dropped rather than retried, because losing a minute of a
 * chart matters less than holding the process open.
 */
const { logger } = require("../../config/logger");

/** A request slower than this is counted as slow. */
const SLOW_MS = 1000;
const FLUSH_MS = 60_000;
/** How long one route_stat row covers. */
const ROUTE_BUCKET_MS = 15 * 60_000;

/**
 * The latency buckets' upper bounds, in ms. 800 is the response time target's default, so
 * "under target" is read exactly rather than interpolated. One more count past the last
 * bound holds everything slower.
 */
const BOUNDS_MS = Object.freeze([25, 50, 100, 200, 300, 500, 800, 1000, 1500, 2000, 3000, 5000, 10000]);

/** key -> counters; minutes keyed by ISO minute, routes by "bucket method route". */
let minutes = new Map();
let routes = new Map();
let timer = null;
let queryFn = null;

const dbQuery = (sql, params) =>
  queryFn ? queryFn(sql, params) : require("../../config/db").query(sql, params);

const minuteOf = (at = Date.now()) => new Date(Math.floor(at / 60_000) * 60_000).toISOString();
const quarterOf = (at = Date.now()) =>
  new Date(Math.floor(at / ROUTE_BUCKET_MS) * ROUTE_BUCKET_MS).toISOString();

/** Which bucket a duration falls in: the first bound it is at or under, or the one past the last. */
function bucketOf(ms) {
  for (let i = 0; i < BOUNDS_MS.length; i += 1) if (ms <= BOUNDS_MS[i]) return i;
  return BOUNDS_MS.length;
}

const empty = () => ({
  requests: 0,
  errors: 0,
  client_errors: 0,
  slow: 0,
  total_ms: 0,
  max_ms: 0,
  buckets: new Array(BOUNDS_MS.length + 1).fill(0),
});

function add(b, took, status) {
  b.requests += 1;
  if (status >= 500) b.errors += 1;
  else if (status >= 400) b.client_errors += 1;
  if (took >= SLOW_MS) b.slow += 1;
  b.total_ms += Math.round(took);
  if (took > b.max_ms) b.max_ms = Math.round(took);
  b.buckets[bucketOf(took)] += 1;
}

/**
 * One finished /api/ request.
 * @param {number} ms  how long it took
 * @param {number} status  the status sent
 * @param {{method?: string, route?: string}} [where]  the route as declared; omitted, the minute only
 */
function record(ms, status, where) {
  try {
    const took = Number(ms) || 0;
    const now = Date.now();
    const minute = minuteOf(now);
    if (!minutes.has(minute)) minutes.set(minute, empty());
    add(minutes.get(minute), took, status);
    if (where && where.method) {
      const bucket = quarterOf(now);
      const route = String(where.route || "(no route)").slice(0, 200);
      const key = `${bucket} ${where.method} ${route}`;
      if (!routes.has(key)) routes.set(key, { bucket, method: where.method, route, ...empty() });
      add(routes.get(key), took, status);
    }
    start();
  } catch {
    /* counting a request must never break it */
  }
}

function start() {
  if (timer) return;
  timer = setInterval(() => {
    flush().catch(() => {});
  }, FLUSH_MS);
  if (timer.unref) timer.unref();
}

/** The two arrays added element by element, in SQL, so concurrent writers never lose a count. */
const MERGE_BUCKETS = (table) => `buckets = (
             SELECT COALESCE(array_agg(COALESCE(a, 0) + COALESCE(b, 0) ORDER BY i), '{}')
               FROM unnest(${table}.buckets, EXCLUDED.buckets) WITH ORDINALITY AS t(a, b, i))`;

/** Write what is buffered. Called on the timer, and by the server's shutdown. */
async function flush() {
  if (minutes.size === 0 && routes.size === 0) return 0;
  const batch = minutes;
  const routeBatch = routes;
  minutes = new Map();
  routes = new Map();
  let written = 0;
  for (const [minute, b] of batch) {
    try {
      await dbQuery(
        `INSERT INTO request_stat (minute, requests, errors, client_errors, slow, total_ms, max_ms, buckets)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (minute) DO UPDATE SET
           requests = request_stat.requests + EXCLUDED.requests,
           errors = request_stat.errors + EXCLUDED.errors,
           client_errors = request_stat.client_errors + EXCLUDED.client_errors,
           slow = request_stat.slow + EXCLUDED.slow,
           total_ms = request_stat.total_ms + EXCLUDED.total_ms,
           max_ms = GREATEST(request_stat.max_ms, EXCLUDED.max_ms),
           ${MERGE_BUCKETS("request_stat")}`,
        [minute, b.requests, b.errors, b.client_errors, b.slow, b.total_ms, b.max_ms, b.buckets],
      );
      written += 1;
    } catch (err) {
      // The table is missing until 9110 runs, or the database is the thing that is
      // wrong. Either way the minute is dropped: a chart is not worth a retry queue.
      logger.warn({ err }, "a minute of request figures was not written");
    }
  }
  for (const b of routeBatch.values()) {
    try {
      await dbQuery(
        `INSERT INTO route_stat (bucket, method, route, requests, errors, client_errors, slow, total_ms, max_ms, buckets)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (bucket, method, route) DO UPDATE SET
           requests = route_stat.requests + EXCLUDED.requests,
           errors = route_stat.errors + EXCLUDED.errors,
           client_errors = route_stat.client_errors + EXCLUDED.client_errors,
           slow = route_stat.slow + EXCLUDED.slow,
           total_ms = route_stat.total_ms + EXCLUDED.total_ms,
           max_ms = GREATEST(route_stat.max_ms, EXCLUDED.max_ms),
           ${MERGE_BUCKETS("route_stat")}`,
        [b.bucket, b.method, b.route, b.requests, b.errors, b.client_errors, b.slow, b.total_ms, b.max_ms, b.buckets],
      );
      written += 1;
    } catch (err) {
      logger.warn({ err }, "a quarter hour of route figures was not written");
    }
  }
  return written;
}

/** Tests only. */
function __reset({ query } = {}) {
  minutes = new Map();
  routes = new Map();
  queryFn = query || null;
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { record, flush, __reset, SLOW_MS, FLUSH_MS, ROUTE_BUCKET_MS, BOUNDS_MS, bucketOf, minuteOf, quarterOf };
