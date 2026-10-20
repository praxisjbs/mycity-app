"use strict";
/**
 * One perf_sample a minute (jobs/schedulers/system-health-sample.js): the whole server as
 * system_health.host.js reads it, and whether the API answered ready, which is what
 * availability is counted from (docs/guides/system-health.md §6).
 *
 * Two things make the figures honest:
 *
 *  - Rates need two readings. The last one is kept in memory between ticks; after a restart,
 *    or a gap of more than 5 minutes, two readings are taken a second apart instead, and
 *    every amount is scaled to a minute, so the first row after a restart is not a 1 second
 *    trickle drawn as a quiet minute.
 *  - A database that is down cannot be written to, which would make an outage look like a
 *    gap rather than downtime. So rows that fail to write are held (up to 2 hours) and
 *    written, oldest first, once the database answers again.
 */
const { config } = require("../../config/env");
const { pool } = require("../../config/db");
const { logger } = require("../../config/logger");
const host = require("./system_health.host");
const repo = require("./system_health.repo");

/** A reading older than this is not used for rates: take two fresh ones. */
const FRESH_MS = 5 * 60_000;
/** How many minutes of rows to hold while the database is down. */
const HOLD = 120;
/** How long the API has to say it is ready. */
const PROBE_MS = 3000;

let previous = null;
let held = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const minuteOf = (d) => new Date(Math.floor(d.getTime() / 60_000) * 60_000);

/** The API answers /api/health/ready with 200 (ready or degraded) within 3 seconds. */
async function apiReady(port = config.PORT) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health/ready`, {
      signal: AbortSignal.timeout(PROBE_MS),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

/** A share scaled to two places, or null. */
const two = (n) => (n === null || n === undefined ? null : Math.round(n * 100) / 100);
/** An amount moved in `seconds`, as an amount a minute. */
const perMinute = (n, seconds) => (n === null || !(seconds > 0) ? null : Math.round((n * 60) / seconds));

/** The row for one minute, from two readings and what the API and the processes said. */
function rowOf(minute, before, now, { apiUp, usersOnline }) {
  const r = host.rates(before, now);
  const seconds = (now.at - before.at) / 1000;
  const mem = now.memory || {};
  const dsk = now.disk || {};
  // A group with no running unit has no entry: its column is null and Other carries it.
  const svc = (key, field) => (r.services[key] ? r.services[key][field] : null);
  return {
    minute,
    cores: now.cores,
    cpu_busy_pct: r.cpu_busy_pct,
    cpu_steal_pct: r.cpu_steal_pct,
    cpu_iowait_pct: r.cpu_iowait_pct,
    load_1m: two(now.load_1m),
    memory_total_mb: mem.total_mb ?? null,
    memory_in_use_mb: mem.in_use_mb ?? null,
    memory_cache_mb: mem.cache_mb ?? null,
    memory_free_mb: mem.free_mb ?? null,
    swap_total_mb: mem.swap_total_mb ?? null,
    swap_used_mb: mem.swap_used_mb ?? null,
    disk_total_mb: dsk.total_mb ?? null,
    disk_used_mb: dsk.used_mb ?? null,
    disk_free_mb: dsk.free_mb ?? null,
    disk_read_kb: perMinute(r.disk_read_kb, seconds),
    disk_written_kb: perMinute(r.disk_written_kb, seconds),
    disk_busy_pct: r.disk_busy_pct,
    network_in_kb: perMinute(r.network_in_kb, seconds),
    network_out_kb: perMinute(r.network_out_kb, seconds),
    tcp_connections: now.tcp,
    production_cpu_pct: svc("production", "cpu_pct"),
    production_memory_mb: svc("production", "memory_mb"),
    staging_cpu_pct: svc("staging", "cpu_pct"),
    staging_memory_mb: svc("staging", "memory_mb"),
    database_cpu_pct: svc("database", "cpu_pct"),
    database_memory_mb: svc("database", "memory_mb"),
    redis_cpu_pct: svc("redis", "cpu_pct"),
    redis_memory_mb: svc("redis", "memory_mb"),
    scanner_cpu_pct: svc("scanner", "cpu_pct"),
    scanner_memory_mb: svc("scanner", "memory_mb"),
    api_up: apiUp,
    users_online: usersOnline,
  };
}

/**
 * Take this minute's sample and write it, with any rows held from minutes the database
 * did not answer.
 * @param {{now?: Date, root?: string, port?: number, wait?: number}} [opts]  tests pass a fixtures root and no wait
 */
async function sample({ now = new Date(), root = "/", port, wait = 1000 } = {}) {
  let before = previous && Date.now() - previous.at < FRESH_MS ? previous : null;
  if (!before) {
    before = await host.read(root);
    if (wait) await sleep(wait);
  }
  const reading = await host.read(root);
  previous = reading;

  const [apiUp, usersOnline] = await Promise.all([
    apiReady(port),
    repo.usersOnline(pool).catch(() => null),
  ]);
  held.push(rowOf(minuteOf(now), before, reading, { apiUp, usersOnline }));
  if (held.length > HOLD) held = held.slice(held.length - HOLD);

  let written = 0;
  while (held.length) {
    try {
      await repo.addSample(pool, held[0]);
    } catch (err) {
      logger.warn({ err: err.message, held: held.length }, "performance sample held until the database answers");
      break;
    }
    held.shift();
    written += 1;
  }
  return { written, held: held.length, api_up: apiUp };
}

/** Tests only. */
function __reset() {
  previous = null;
  held = [];
}

module.exports = { sample, rowOf, apiReady, __reset, HOLD };
