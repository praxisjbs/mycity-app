"use strict";
/**
 * A minute of traffic, kept in memory and written once a minute, so Settings ·
 * System Health can show how fast the app answered and what share of requests failed.
 *
 *   requestStats.record(ms, statusCode);    // middleware/access-log.js, every request
 *   await requestStats.flush();             // on the timer, and at shutdown
 *
 * Why this and not the Prometheus metrics that are already collected: those live in
 * the process that served the request, and the snapshot is taken in the worker, which
 * cannot read them. A row a minute is readable by anything with the database.
 *
 * Counts are added rather than replaced, so two API processes and a restart inside the
 * same minute all land in one row. It keeps sums, not a percentile: a mean adds across
 * processes and a p95 does not.
 *
 * Never throws, and never delays a request: recording is three numbers in a Map, and a
 * write that fails is logged and dropped rather than retried, because losing a minute
 * of a chart matters less than holding the process open.
 */
const { logger } = require("../../config/logger");

/** A request slower than this is counted as slow. */
const SLOW_MS = 1000;
const FLUSH_MS = 60_000;

/** minute (ISO) -> counters */
let buckets = new Map();
let timer = null;
let queryFn = null;

const dbQuery = (sql, params) =>
  queryFn ? queryFn(sql, params) : require("../../config/db").query(sql, params);

const minuteOf = (at = Date.now()) => new Date(Math.floor(at / 60_000) * 60_000).toISOString();

/**
 * One finished request.
 * @param {number} ms  how long it took
 * @param {number} status  the status sent
 */
function record(ms, status) {
  try {
    const key = minuteOf();
    let b = buckets.get(key);
    if (!b) {
      b = { requests: 0, errors: 0, client_errors: 0, slow: 0, total_ms: 0, max_ms: 0 };
      buckets.set(key, b);
    }
    const took = Number(ms) || 0;
    b.requests += 1;
    if (status >= 500) b.errors += 1;
    else if (status >= 400) b.client_errors += 1;
    if (took >= SLOW_MS) b.slow += 1;
    b.total_ms += Math.round(took);
    if (took > b.max_ms) b.max_ms = Math.round(took);
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

/** Write what is buffered. Called on the timer, and by the server's shutdown. */
async function flush() {
  if (buckets.size === 0) return 0;
  const batch = buckets;
  buckets = new Map();
  let written = 0;
  for (const [minute, b] of batch) {
    try {
      await dbQuery(
        `INSERT INTO request_stat (minute, requests, errors, client_errors, slow, total_ms, max_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (minute) DO UPDATE SET
           requests = request_stat.requests + EXCLUDED.requests,
           errors = request_stat.errors + EXCLUDED.errors,
           client_errors = request_stat.client_errors + EXCLUDED.client_errors,
           slow = request_stat.slow + EXCLUDED.slow,
           total_ms = request_stat.total_ms + EXCLUDED.total_ms,
           max_ms = GREATEST(request_stat.max_ms, EXCLUDED.max_ms)`,
        [minute, b.requests, b.errors, b.client_errors, b.slow, b.total_ms, b.max_ms],
      );
      written += 1;
    } catch (err) {
      // The table is missing until 9110 runs, or the database is the thing that is
      // wrong. Either way the minute is dropped: a chart is not worth a retry queue.
      logger.warn({ err }, "a minute of request figures was not written");
    }
  }
  return written;
}

/** Tests only. */
function __reset({ query } = {}) {
  buckets = new Map();
  queryFn = query || null;
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { record, flush, __reset, SLOW_MS, FLUSH_MS, minuteOf };
