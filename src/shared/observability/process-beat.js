"use strict";
/**
 * Each API and worker process says it is alive, and how it is doing, once a minute, in
 * its own `process_beat` row (Settings · Performance, Processes; docs/guides/system-health.md
 * §7).
 *
 *   const stop = processBeat.start({ role: "api", extras: () => realtime.presence() });
 *   await stop();   // at shutdown
 *
 * The row is keyed on the role, the host, the pid and the moment the process started, so
 * a restart is a new row and restarts are counted from them. Each beat carries what
 * only the process itself can see: its memory and heap, its CPU, and how late its event
 * loop ran (the 99th percentile of the minute, from perf_hooks), which is what makes
 * every request slow at once when something blocks it.
 *
 * Best effort: a beat that cannot be written is logged and the next one tries again. It
 * never holds the process open and never throws.
 */
const os = require("node:os");
const { monitorEventLoopDelay } = require("node:perf_hooks");
const { logger } = require("../../config/logger");

const EVERY_MS = 60_000;
const MB = 1024 * 1024;

/**
 * @param {{role: "api"|"worker", extras?: () => {sockets?: number, people?: number}, query?: Function}} opts
 * @returns {(() => Promise<void>) & {beat: () => Promise<void>}} stop, with `beat` to beat at once
 */
function start({ role, extras, query } = {}) {
  const startedAt = new Date();
  const instance = `${role}:${os.hostname()}:${process.pid}:${startedAt.getTime()}`;
  const run = query || ((sql, params) => require("../../config/db").query(sql, params));
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  let cpuBefore = process.cpuUsage();
  let at = Date.now();

  const beat = async () => {
    try {
      const now = Date.now();
      const cpu = process.cpuUsage(cpuBefore);
      const elapsedUs = Math.max(1, (now - at) * 1000);
      cpuBefore = process.cpuUsage();
      at = now;
      const cores = Math.max(1, os.cpus().length);
      const cpuPct = Math.min(100, ((cpu.user + cpu.system) * 100) / (elapsedUs * cores));
      const mem = process.memoryUsage();
      // nanoseconds; a minute with no samples reads as no delay rather than NaN
      const p99 = loop.count > 0 ? loop.percentile(99) / 1e6 : 0;
      loop.reset();
      const extra = (extras && extras()) || {};
      await run(
        `INSERT INTO process_beat (instance, role, host, pid, release, started_at, last_beat_at,
                                   memory_mb, heap_mb, loop_delay_ms, cpu_pct, sockets, users_online)
         VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8, $9, $10, $11, $12)
         ON CONFLICT (instance) DO UPDATE SET
           last_beat_at = now(),
           memory_mb = EXCLUDED.memory_mb,
           heap_mb = EXCLUDED.heap_mb,
           loop_delay_ms = EXCLUDED.loop_delay_ms,
           cpu_pct = EXCLUDED.cpu_pct,
           sockets = EXCLUDED.sockets,
           users_online = EXCLUDED.users_online`,
        [
          instance,
          role,
          os.hostname(),
          process.pid,
          require("../../config/env").config.BUILD_SHA || null,
          startedAt.toISOString(),
          Math.round(mem.rss / MB),
          Math.round(mem.heapUsed / MB),
          Math.round(p99),
          Math.round(cpuPct * 100) / 100,
          extra.sockets ?? null,
          extra.people ?? null,
        ],
      );
    } catch (err) {
      // Missing until 9120 runs, or the database is what is wrong: the next minute tries again.
      logger.warn({ err: err.message }, "process beat not written");
    }
  };

  const first = setTimeout(beat, 5_000);
  if (first.unref) first.unref();
  const t = setInterval(beat, EVERY_MS);
  if (t.unref) t.unref();
  const stop = async () => {
    clearTimeout(first);
    clearInterval(t);
    loop.disable();
  };
  // Beat now rather than on the timer; the tests use it.
  stop.beat = beat;
  return stop;
}

module.exports = { start, EVERY_MS };
