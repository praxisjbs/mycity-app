"use strict";
/**
 * The work that follows a committed change, run by the worker (SYSTEM_ARCHITECTURE §6).
 *
 * emit() writes an event_outbox row in the business transaction. Nothing sees it
 * until COMMIT. The worker's dispatcher then claims due rows and runs every
 * handler registered for the event's key, after commit, outside the request.
 *
 * Registering, in a module's `<module>.events.js` (loaded by the API and the worker):
 *
 *   const outbox = require("../../shared/events/outbox");
 *
 *   outbox.register("employee.created", "organisation.reindex", async (event, ctx) => {
 *     await search.reindex("employee", event.entity.id);
 *   });
 *
 *   // every event (the notification fan-out uses this)
 *   outbox.register("*", "notifications.fanout", fanout.handle);
 *
 * What a handler receives:
 *
 *   event  { event_id, key, module, entity: { type, id }, actor_user_id, payload,
 *            occurred_at, request_id }
 *   ctx    { outbox_id, attempt, max_attempts }   attempt counts from 1; on attempt ===
 *          max_attempts a failure is final, so a handler that keeps a status of its own
 *          (a report run) records the failure instead of throwing it again
 *
 * Guarantees, and what they ask of a handler:
 *
 *  - At least once. A handler can finish its side effect and the process die before
 *    that is recorded, so it runs again. Handlers are idempotent: an insert with ON
 *    CONFLICT DO NOTHING, a state check before a transition, a dedup key on a job.
 *  - Each handler is tracked by name per row. A retry runs only the handlers that
 *    have not succeeded, so one failing consumer neither blocks nor repeats the others.
 *    Names are stable: renaming a handler makes a pending retry run it again.
 *  - Failures back off exponentially (10 s, 20 s, 40 s ... capped at an hour). After
 *    max_attempts the row is `failed`, reported, and shown on /api/health/ready.
 *  - Claims use FOR UPDATE SKIP LOCKED, so two workers never run one row twice at
 *    the same moment. A row left `processing` by a crashed worker is reclaimed after
 *    ten minutes (each handler is stopped after two).
 *  - The request's id and actor ride along: every log line a handler writes carries
 *    the request that caused it.
 *
 * A dispatcher refuses to run until markReady() is called. The worker calls it after
 * loading every module's events file; a dispatcher that ran before then would find no
 * handler for an event, mark it done, and the work would be lost.
 *
 * Table (migration 0030; BACKEND_STRUCTURE §11.1):
 *   event_outbox  outbox_id, event_id, event_key, dedup_key (unique when set), status
 *                 ('pending' | 'processing' | 'done' | 'failed'), attempts, max_attempts,
 *                 next_attempt_at, completed_handlers text[], last_error, created_at,
 *                 updated_at, processed_at
 */
const { logger } = require("../../config/logger");
const requestContext = require("../../config/request-context");
const metrics = require("../observability/metrics");

const ALL = "*";
const HANDLER_NAME_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_-]*)+$/;
const STALE_PROCESSING_MINUTES = 10;
const BASE_BACKOFF_S = 10;
const MAX_BACKOFF_S = 3600;
const HANDLER_TIMEOUT_MS = 120_000;

/** key (or "*") → [{ name, fn }] */
const registry = new Map();
let ready = false;
let dispatching = false;

/**
 * Register a named handler for an event key, or "*" for every event.
 * @param {string} key
 * @param {string} name  "<module>.<what>", unique per key, stable across deploys
 * @param {(event: object, ctx: {outbox_id: string, attempt: number}) => Promise<void>} fn
 */
function register(key, name, fn) {
  if (
    key !== ALL &&
    !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(String(key))
  ) {
    throw new Error(`outbox.register: "${key}" is not an event key`);
  }
  if (!HANDLER_NAME_RE.test(String(name)))
    throw new Error(
      `outbox.register(${key}): name is "<module>.<what>", got "${name}"`,
    );
  if (typeof fn !== "function")
    throw new Error(`outbox.register(${key}, ${name}): give a function`);
  const list = registry.get(key) || [];
  const existing = list.find((h) => h.name === name);
  if (existing) {
    // The same file required twice registers the same function twice: harmless.
    if (existing.fn === fn) return;
    throw new Error(
      `outbox.register(${key}): a handler named "${name}" is already registered`,
    );
  }
  list.push({ name, fn });
  registry.set(key, list);
}

/** Handlers for a key: the key's own first, then the "*" handlers. */
function handlersFor(key) {
  return [...(registry.get(key) || []), ...(registry.get(ALL) || [])];
}

/** Every registration, for the health page and the docs. */
function registrations() {
  return [...registry.entries()].flatMap(([key, list]) =>
    list.map((h) => ({ key, name: h.name })),
  );
}

/** The worker calls this once every events file is loaded. */
function markReady() {
  ready = true;
}

function isReady() {
  return ready;
}

/** Seconds to wait before attempt `attempts + 1`. */
function backoffSeconds(attempts) {
  return Math.min(
    MAX_BACKOFF_S,
    BASE_BACKOFF_S * 2 ** Math.max(0, Math.min(attempts - 1, 16)),
  );
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () =>
          reject(new Error(`${label} did not finish within ${ms / 1000} s`)),
        ms,
      );
      if (timer.unref) timer.unref();
    }),
  ]).finally(() => clearTimeout(timer));
}

function eventOf(row) {
  return Object.freeze({
    event_id: row.event_id,
    key: row.event_key,
    module: row.module_key,
    entity: Object.freeze({ type: row.entity_type, id: row.entity_id }),
    actor_user_id: row.actor_user_id,
    payload: row.payload || {},
    occurred_at: row.occurred_at,
    request_id: row.request_id,
  });
}

async function reclaimStale(db) {
  const { rowCount } = await db.query(
    `UPDATE event_outbox
        SET status = 'pending', updated_at = now()
      WHERE status = 'processing'
        AND updated_at < now() - make_interval(mins => $1)`,
    [STALE_PROCESSING_MINUTES],
  );
  if (rowCount)
    logger.warn(
      { reclaimed: rowCount },
      "outbox: reclaimed rows left processing by a stopped worker",
    );
  return rowCount;
}

/** Claim due rows and read their events, in one statement. */
async function claim(db, limit) {
  const { rows } = await db.query(
    `WITH due AS (
       SELECT outbox_id
         FROM event_outbox
        WHERE status = 'pending' AND next_attempt_at <= now()
        ORDER BY next_attempt_at, created_at
        LIMIT $1 -- pagination:batch rows one dispatcher tick claims
        FOR UPDATE SKIP LOCKED
     ), claimed AS (
       UPDATE event_outbox o
          SET status = 'processing', attempts = o.attempts + 1, updated_at = now()
         FROM due
        WHERE o.outbox_id = due.outbox_id
       RETURNING o.outbox_id, o.event_id, o.event_key, o.attempts, o.max_attempts, o.completed_handlers, o.created_at
     )
     SELECT c.*, e.module_key, e.entity_type, e.entity_id, e.actor_user_id, e.payload, e.occurred_at, e.request_id
       FROM claimed c
       JOIN event_log e ON e.event_id = c.event_id
      ORDER BY c.created_at`,
    [limit],
  );
  return rows;
}

async function finish(db, row, completed, err) {
  if (!err) {
    await db.query(
      `UPDATE event_outbox
          SET status = 'done', processed_at = now(), updated_at = now(),
              completed_handlers = $2, last_error = NULL
        WHERE outbox_id = $1`,
      [row.outbox_id, completed],
    );
    return "done";
  }
  const exhausted = row.attempts >= row.max_attempts;
  await db.query(
    `UPDATE event_outbox
        SET status = $2, last_error = $3, completed_handlers = $4, updated_at = now(),
            next_attempt_at = now() + make_interval(secs => $5)
      WHERE outbox_id = $1`,
    [
      row.outbox_id,
      exhausted ? "failed" : "pending",
      String((err && err.message) || err).slice(0, 2000),
      completed,
      backoffSeconds(row.attempts),
    ],
  );
  if (exhausted) {
    metrics.inc(
      "mycity_outbox_failed_total",
      { key: row.event_key },
      1,
      "Outbox rows that ran out of attempts.",
    );
    require("../observability/error-reporter").report(err, {
      origin: "worker",
      severity: "error",
      route: `outbox ${row.event_key}`,
      extra: {
        outbox_id: row.outbox_id,
        event_id: row.event_id,
        attempts: row.attempts,
      },
    });
  }
  return exhausted ? "failed" : "retry";
}

async function processRow(db, row) {
  const event = eventOf(row);
  const done = new Set(row.completed_handlers || []);
  let firstErr = null;

  await requestContext.run(
    {
      requestId: event.request_id,
      userId: event.actor_user_id,
      surface: "worker",
    },
    async () => {
      for (const h of handlersFor(event.key)) {
        if (done.has(h.name)) continue;
        const started = Date.now();
        try {
          await withTimeout(
            Promise.resolve().then(() =>
              h.fn(event, {
                outbox_id: row.outbox_id,
                attempt: row.attempts,
                max_attempts: row.max_attempts,
              }),
            ),
            HANDLER_TIMEOUT_MS,
            `handler ${h.name}`,
          );
          done.add(h.name);
          metrics.observe(
            "mycity_outbox_handler_seconds",
            (Date.now() - started) / 1000,
            { handler: h.name },
            "Outbox handler run time.",
          );
        } catch (err) {
          if (!firstErr) firstErr = err;
          metrics.inc(
            "mycity_outbox_handler_errors_total",
            { handler: h.name },
            1,
            "Outbox handler failures.",
          );
          logger.error(
            {
              err,
              handler: h.name,
              event_key: event.key,
              outbox_id: row.outbox_id,
              attempt: row.attempts,
            },
            "outbox handler failed",
          );
        }
      }
    },
  );

  return finish(db, row, [...done], firstErr);
}

/**
 * Run due rows once. Safe from any number of processes (SKIP LOCKED); within one
 * process an overlapping tick returns 0 instead of piling up.
 * @param {{db?: {query: Function}, limit?: number}} [opts]
 * @returns {Promise<{claimed: number, done: number, retry: number, failed: number}>}
 */
async function dispatchDue({
  db = require("../../config/db").pool,
  limit = 50,
} = {}) {
  if (!ready)
    throw new Error(
      "outbox.dispatchDue: call markReady() after loading every module's events file",
    );
  const out = { claimed: 0, done: 0, retry: 0, failed: 0 };
  if (dispatching) return out;
  dispatching = true;
  try {
    await reclaimStale(db);
    const rows = await claim(db, limit);
    out.claimed = rows.length;
    for (const row of rows) {
      const result = await processRow(db, row);
      out[result] += 1;
    }
    return out;
  } finally {
    dispatching = false;
  }
}

/**
 * Readiness for /api/health/ready: pending rows older than a minute, and failed rows.
 * @param {{query: Function}} db
 */
async function health(db) {
  try {
    const { rows } = await db.query(
      `SELECT count(*) FILTER (WHERE status IN ('pending', 'processing') AND created_at < now() - interval '1 minute')::int AS backlog,
              count(*) FILTER (WHERE status = 'failed')::int AS failed
         FROM event_outbox`,
    );
    const { backlog, failed } = rows[0];
    return {
      status: failed > 0 || backlog > 500 ? "degraded" : "up",
      backlog,
      failed,
    };
  } catch (err) {
    return {
      status: "degraded",
      error: err.code === "42P01" ? "no event_outbox table" : "unreadable",
    };
  }
}

/**
 * Put failed rows back in the queue (after the cause is fixed). Handlers that
 * already succeeded on a row are not run again.
 * @param {{query: Function}} db
 * @param {{outbox_ids?: string[]}} [opts]  all failed rows when omitted
 */
async function retryFailed(db, { outbox_ids: ids = null } = {}) {
  const { rowCount } = await db.query(
    `UPDATE event_outbox
        SET status = 'pending', attempts = 0, next_attempt_at = now(), updated_at = now()
      WHERE status = 'failed' AND ($1::uuid[] IS NULL OR outbox_id = ANY($1::uuid[]))`,
    [ids],
  );
  return rowCount;
}

/**
 * Delete finished rows older than `days`. The event itself stays in event_log.
 * @param {{query: Function}} db
 */
async function prune(db, { days = 30 } = {}) {
  const { rowCount } = await db.query(
    "DELETE FROM event_outbox WHERE status = 'done' AND processed_at < now() - make_interval(days => $1)",
    [days],
  );
  return rowCount;
}

/** Tests only: forget every registration and the ready flag. */
function __reset() {
  registry.clear();
  ready = false;
  dispatching = false;
}

module.exports = {
  ALL,
  register,
  handlersFor,
  registrations,
  markReady,
  isReady,
  dispatchDue,
  health,
  retryFailed,
  prune,
  backoffSeconds,
  __reset,
};
