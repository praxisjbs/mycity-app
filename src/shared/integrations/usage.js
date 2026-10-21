"use strict";
/**
 * Real use of each connection, counted (docs/guides/integrations.md §3 step 11, §6.9).
 *
 *   usage.record("geoapify", "search", { ok: true });
 *   usage.record("mail_sender", "send", { ok: false, units: 3, error_code: "AUTH_FAILED" });
 *   await usage.flush();      // on the timer, and when the process stops
 *
 * Every call a provider answered (or failed to) is one call: an answer served from a cache
 * made no request and is not counted. A failure is the provider refusing or not answering
 * (a network error, a timeout, a 5xx, a refused key, a 429); an address with no match is not
 * one. `units` default to the registry's for the kind (Geoapify's tile is a quarter of a
 * credit); a message counts its recipients.
 *
 * In memory, written every 15 seconds with one upsert per connection, Lagos day and kind,
 * adding to what is there, so the API, the worker and a restart inside the same day land
 * in one row. The newest outcome of each connection moves its state (state.js). Never
 * throws and never delays a call: a write that fails is logged and dropped, because losing
 * fifteen seconds of counts matters less than holding a request. Telemetry, like
 * request_stat: no event, no audit row.
 */
const { logger } = require("../../config/logger");
const lagos = require("../time/lagos");
const providers = require("./providers");
const state = require("./state");

const FLUSH_MS = 15_000;

/** "<code>|<day>|<kind>" -> { code, day, kind, calls, failures, units } */
let counts = new Map();
/** code -> the newest outcome: { ok, error_code, at } */
let latest = new Map();
let timer = null;
let flushing = null;

const pool = () => require("../../config/db").pool;

/**
 * One call to a provider.
 * @param {string} code      the connection
 * @param {string} kind      what the call was (providers.js `units` names them)
 * @param {{ok?: boolean, units?: number, error_code?: string|null}} [outcome]
 */
function record(code, kind, { ok = true, units, error_code = null } = {}) {
  try {
    const def = providers.get(code);
    const each = def.units[kind];
    if (each === undefined) throw new Error(`integrations usage: "${kind}" is not counted for ${code}`);
    const day = lagos.today();
    const key = `${code}|${day}|${kind}`;
    let c = counts.get(key);
    if (!c) {
      c = { code, day, kind, calls: 0, failures: 0, units: 0 };
      counts.set(key, c);
    }
    c.calls += 1;
    if (!ok) c.failures += 1;
    c.units += units === undefined ? each : Math.max(0, Number(units) || 0) * each;
    latest.set(code, { ok: Boolean(ok), error_code: ok ? null : error_code || "UNAVAILABLE", at: new Date() });
    start();
  } catch (err) {
    // Counting a call must never break it; a wrong kind is a programming error, logged.
    logger.warn({ err: err.message, code, kind }, "an integration call was not counted");
  }
}

function start() {
  if (timer) return;
  timer = setInterval(() => {
    flush().catch(() => {});
  }, FLUSH_MS);
  if (timer.unref) timer.unref();
}

async function write(db, batch, outcomes) {
  for (const c of batch.values()) {
    try {
      await state.ensure(db, c.code);
      await db.query(
        `INSERT INTO integration_usage (integration_connection_id, day, kind, calls, failures, units)
         SELECT integration_connection_id, $2::date, $3, $4, $5, $6
           FROM integration_connection WHERE code = $1
         ON CONFLICT (integration_connection_id, day, kind) DO UPDATE SET
           calls = integration_usage.calls + EXCLUDED.calls,
           failures = integration_usage.failures + EXCLUDED.failures,
           units = integration_usage.units + EXCLUDED.units`,
        [c.code, c.day, c.kind, c.calls, c.failures, c.units.toFixed(2)],
      );
    } catch (err) {
      // The table is missing until 9200 runs, or the database is what is wrong.
      logger.warn({ err: err.message, code: c.code }, "a connection's use was not written");
    }
  }
  for (const [code, o] of outcomes) {
    try {
      await state.set(db, code, { ok: o.ok, error_code: o.error_code, at: o.at, checked: false });
    } catch (err) {
      logger.warn({ err: err.message, code }, "a connection's state was not written");
    }
  }
}

/**
 * Write what is counted. On the timer, and when the API or the worker stops.
 * @param {{db?: {query: Function}}} [opts]
 */
async function flush({ db } = {}) {
  if (flushing) await flushing;
  if (counts.size === 0 && latest.size === 0) return 0;
  const batch = counts;
  const outcomes = latest;
  counts = new Map();
  latest = new Map();
  flushing = write(db || pool(), batch, outcomes).finally(() => {
    flushing = null;
  });
  await flushing;
  return batch.size;
}

/** Stop the timer and write what is left. */
async function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  await flush().catch(() => {});
}

/** Tests only. */
function __reset() {
  counts = new Map();
  latest = new Map();
  if (timer) clearInterval(timer);
  timer = null;
}

/** Tests only: what is waiting to be written. */
const pending = () => [...counts.values()].map((c) => ({ ...c }));

module.exports = { record, flush, stop, __reset, pending, FLUSH_MS };
