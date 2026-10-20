"use strict";
/**
 * Settings · Performance (docs/guides/system-health.md §5, §6): what the samples, the
 * traffic, the database, the queues and the processes say, judged against the targets
 * Edit Targets holds.
 *
 * Reads only. The samples are written by the worker (system_health.sample.js), the
 * traffic by the API (shared/observability/request-stats.js), the beats by each process
 * (shared/observability/process-beat.js), and the disk's parts by the root timer
 * (ops/monitoring/host-stats.sh). The one write here is the targets, in
 * system_health.targets.js.
 */
const { pool } = require("../../config/db");
const { buildInfo } = require("../../config/build-info");
const { BOUNDS_MS } = require("../../shared/observability/request-stats");
const { envelope } = require("../../shared/http/paged");
const repo = require("./system_health.repo");
const host = require("./system_health.host");
const targets = require("./system_health.targets");

/** A sample newer than this means the one-minute job is running (§6, Recording, not quiet). */
const RECORDING_WITHIN_MS = 3 * 60_000;
/** Disk growth under this many MB a day reads as Not Filling. */
const FILLING_MB_PER_DAY = 50;

const BOUNDS = [...BOUNDS_MS];
const num = (v) => (v === null || v === undefined ? null : Number(v));
const int = (v) => (v === null || v === undefined ? null : Math.round(Number(v)));
/** A share as the wire carries it: two places at most, no trailing zeros past one. */
const pct = (v) => {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return null;
  const n = Math.max(0, Math.min(100, Number(v)));
  return String(Math.round(n * 100) / 100);
};
const iso = (v) => (v ? new Date(v).toISOString() : null);

/** Met, missed, or nothing to judge. Higher is better for availability; lower for the rest. */
function judge(value, target, higherIsBetter) {
  if (value === null || value === undefined) return "none";
  return higherIsBetter ? (Number(value) >= Number(target) ? "met" : "missed") : Number(value) <= Number(target) ? "met" : "missed";
}

/** A level check: up, degraded or down, against a warning and a down level. */
function level(value, warn, down, higherIsWorse = true) {
  if (value === null || value === undefined) return null;
  const v = Number(value);
  if (higherIsWorse) return v >= down ? "down" : v >= warn ? "degraded" : "up";
  return v < down ? "down" : v < warn ? "degraded" : "up";
}

/** GET /system-health/performance */
async function series(query) {
  const range = query.range || "day";
  const w = repo.WINDOWS[range];
  const [points, head, t] = await Promise.all([
    repo.perfSeries(pool, range, BOUNDS),
    repo.perfHeadline(pool, range, BOUNDS),
    targets.current(),
  ]);
  const now = Date.now();
  const requests = Number(head.requests) || 0;
  const availability = head.samples ? (head.up * 100) / head.samples : null;
  const failed = requests ? (Number(head.errors) * 100) / requests : null;
  const p95 = requests ? num(head.p95_ms) : null;
  const firstMinute = head.first_minute ? new Date(head.first_minute).getTime() : null;
  const minutesServed = firstMinute ? Math.max(1, Math.ceil((now - firstMinute) / 60_000)) : null;
  // No sample ever taken: nothing has been missed yet, it has simply not started.
  const since = head.first_sample_at && head.since ? new Date(head.since).getTime() : null;
  const expected = since ? Math.floor((now - since) / 60_000) : 0;
  const last = head.last_sample_at ? new Date(head.last_sample_at) : null;

  return {
    range,
    bucket_minutes: w.bucket_minutes,
    from: new Date(now - w.minutes * 60_000).toISOString(),
    to: new Date(now).toISOString(),
    points: points.map((p) => {
      const at = new Date(p.at);
      const reqs = p.requests === null ? null : Number(p.requests);
      // The bucket still filling is divided by the minutes it has had, not its full width.
      const minutes = Math.max(1, Math.min(w.bucket_minutes, Math.ceil((now - at.getTime()) / 60_000)));
      return {
        at: at.toISOString(),
        requests: reqs,
        per_minute: reqs === null ? null : String(Math.round((reqs * 100) / minutes) / 100),
        p95_ms: reqs ? int(p.p95_ms) : null,
        mean_ms: reqs ? Math.round(Number(p.total_ms) / reqs) : null,
        error_pct: reqs ? pct((Number(p.errors) * 100) / reqs) : null,
        up_pct: p.samples ? pct((p.up * 100) / p.samples) : null,
        cpu_busy_pct: pct(p.cpu_busy_pct),
        cpu_steal_pct: pct(p.cpu_steal_pct),
        cpu_iowait_pct: pct(p.cpu_iowait_pct),
        memory_in_use_pct: pct(p.memory_in_use_pct),
        disk_used_pct: pct(p.disk_used_pct),
        disk_read_kbs: int(p.disk_read_kbs),
        disk_write_kbs: int(p.disk_write_kbs),
        network_in_kbs: int(p.network_in_kbs),
        network_out_kbs: int(p.network_out_kbs),
        users_online: int(p.users_online),
      };
    }),
    availability: {
      value: pct(availability),
      target: t.availability_pct,
      state: judge(availability, t.availability_pct, true),
    },
    down_minutes: head.down || 0,
    response_p95: {
      value: p95 === null ? null : String(p95),
      target: String(t.response_p95_ms),
      state: judge(p95, t.response_p95_ms, false),
    },
    response_mean_ms: requests ? Math.round(Number(head.total_ms) / requests) : null,
    failed: { value: pct(failed), target: t.error_pct, state: judge(failed, t.error_pct, false) },
    requests,
    per_minute: minutesServed ? String(Math.round((requests * 100) / minutesServed) / 100) : null,
    peak_per_minute: head.peak === null ? null : int(head.peak),
    // The current minute may not be sampled yet, so one missing minute is not a gap.
    gap_minutes: Math.max(0, expected - (head.recorded || 0) - 1),
    recording: Boolean(last) && now - last.getTime() < RECORDING_WITHIN_MS,
    last_sample_at: last ? last.toISOString() : null,
  };
}

/** Each group's part of a whole, with Other the remainder, largest first after the named ones. */
function partsOf(sample, field, whole, toValue) {
  const keys = ["production", "staging", "database", "redis", "scanner"];
  const parts = [];
  let named = 0;
  for (const key of keys) {
    const v = num(sample[`${key}_${field}`]);
    if (v === null) continue;
    named += v;
    parts.push({ key, v });
  }
  if (!parts.length || whole === null) return [];
  parts.push({ key: "other", v: Math.max(0, whole - named) });
  return parts.map((p) => ({ key: p.key, ...toValue(p.v) }));
}

/** The disk's parts from the root timer's file: each environment's database and files, backups, logs; System is the rest. */
function diskParts(collected, usedMb) {
  if (!collected || !collected.uses || usedMb === null) return [];
  const u = collected.uses;
  const mb = (b) => (b === null || b === undefined ? null : Math.round(Number(b) / (1024 * 1024)));
  const staging = [u.staging_database, u.staging_files].some((b) => b !== null && b !== undefined)
    ? (mb(u.staging_database) || 0) + (mb(u.staging_files) || 0)
    : null;
  const named = [
    ["production_database", mb(u.production_database)],
    ["production_files", mb(u.production_files)],
    ["staging", staging],
    ["backups", mb(u.backups)],
    ["logs", mb(u.logs)],
  ].filter(([, v]) => v !== null);
  const sum = named.reduce((a, [, v]) => a + v, 0);
  return [...named, ["system", Math.max(0, usedMb - sum)]].map(([key, v]) => ({ key, mb: v }));
}

/** Postgres's and Redis's own versions. Either may be down; the card says Not Available. */
async function versions() {
  const out = { postgres: null, redis: null };
  try {
    const { rows } = await pool.query("SELECT current_setting('server_version') AS v");
    out.postgres = rows[0] ? String(rows[0].v).split(" ")[0] : null;
  } catch {
    /* the database is down; Status says so */
  }
  try {
    const redis = require("../../config/redis").tryClient();
    if (redis) {
      const info = await redis.info("server");
      const m = /redis_version:([^\r\n]+)/.exec(info);
      out.redis = m ? m[1].trim() : null;
    }
  } catch {
    /* Redis is down; Status says so */
  }
  return out;
}

/** GET /system-health/capacity: the server now, judged at the levels Edit Targets holds. */
async function capacity() {
  const [latest, peak, trend, month, t, collected, facts, ver] = await Promise.all([
    repo.latestSample(pool),
    repo.cpuPeak(pool),
    repo.diskTrend(pool),
    repo.networkMonth(pool),
    targets.current(),
    host.collected(),
    host.facts(),
    versions(),
  ]);
  const s = latest || {};
  const build = buildInfo();
  const supported = Boolean(latest && latest.memory_total_mb);

  const busy = num(s.cpu_busy_pct);
  const memTotal = int(s.memory_total_mb);
  const inUse = int(s.memory_in_use_mb);
  const diskTotal = int(s.disk_total_mb);
  const diskUsed = int(s.disk_used_mb);
  const diskFree = int(s.disk_free_mb);
  const freePct = diskTotal ? (diskFree * 100) / diskTotal : null;
  const growth = trend && trend.hours >= 24 && trend.mb_per_day !== null ? Math.round(Number(trend.mb_per_day)) : null;
  const filling = growth !== null && growth >= FILLING_MB_PER_DAY;
  const collectedAt = collected && collected.taken_at ? new Date(collected.taken_at) : null;

  return {
    supported,
    sampled_at: iso(s.minute),
    cpu: {
      cores: int(s.cores),
      model: facts.cpu_model,
      busy_pct: pct(busy),
      steal_pct: pct(s.cpu_steal_pct),
      iowait_pct: pct(s.cpu_iowait_pct),
      load_1m: s.load_1m === null || s.load_1m === undefined ? null : String(Number(s.load_1m)),
      peak_pct: peak ? pct(peak.cpu_busy_pct) : null,
      peak_at: peak ? iso(peak.minute) : null,
      state: level(busy, t.cpu_warn_pct, t.cpu_down_pct),
      parts: partsOf(s, "cpu_pct", busy, (v) => ({ pct: pct(v) })),
    },
    memory: {
      total_mb: memTotal,
      in_use_mb: inUse,
      cache_mb: int(s.memory_cache_mb),
      free_mb: int(s.memory_free_mb),
      swap_total_mb: int(s.swap_total_mb),
      swap_used_mb: int(s.swap_used_mb),
      state: level(memTotal ? (inUse * 100) / memTotal : null, t.memory_warn_pct, t.memory_down_pct),
      parts: partsOf(s, "memory_mb", inUse, (mb) => ({ mb: Math.round(mb) })),
    },
    disk: {
      total_mb: diskTotal,
      used_mb: diskUsed,
      free_mb: diskFree,
      reserved_mb: diskTotal !== null && diskUsed !== null && diskFree !== null ? Math.max(0, diskTotal - diskUsed - diskFree) : null,
      state: level(freePct, t.disk_warn_free_pct, t.disk_down_free_pct, false),
      parts: diskParts(collected, diskUsed),
      parts_at: iso(collectedAt),
      growth_mb_per_day: growth,
      days_to_full: filling && diskFree !== null ? Math.floor(diskFree / growth) : null,
      read_kbs: s.disk_read_kb === null || s.disk_read_kb === undefined ? null : Math.round(Number(s.disk_read_kb) / 60),
      write_kbs: s.disk_written_kb === null || s.disk_written_kb === undefined ? null : Math.round(Number(s.disk_written_kb) / 60),
      busy_pct: pct(s.disk_busy_pct),
    },
    network: {
      in_kbs: s.network_in_kb === null || s.network_in_kb === undefined ? null : Math.round(Number(s.network_in_kb) / 60),
      out_kbs: s.network_out_kb === null || s.network_out_kb === undefined ? null : Math.round(Number(s.network_out_kb) / 60),
      month_in_mb: month && month.in_mb !== null ? Number(month.in_mb) : null,
      month_out_mb: month && month.out_mb !== null ? Number(month.out_mb) : null,
      connections: int(s.tcp_connections),
    },
    server: {
      os: supported ? facts.os : null,
      kernel: supported ? facts.kernel : null,
      node: process.version,
      postgres: ver.postgres,
      redis: ver.redis,
      up_since: supported ? facts.up_since : null,
      release: build.sha,
      deployed_at: build.built_at || null,
      restart_needed: collected && typeof collected.restart_needed === "boolean" ? collected.restart_needed : facts.restart_needed,
      updates_waiting: collected && collected.updates ? int(collected.updates.waiting) : null,
      security_updates: collected && collected.updates ? int(collected.updates.security) : null,
    },
  };
}

/** GET /system-health/routes */
async function routes(query) {
  const page = await repo.routesPage(pool, query, BOUNDS);
  return {
    ...page,
    data: page.data.map((r) => ({
      method: r.method,
      route: r.route,
      requests: Number(r.requests),
      errors: Number(r.errors),
      client_errors: Number(r.client_errors),
      slow: Number(r.slow),
      mean_ms: int(r.mean_ms) || 0,
      p95_ms: int(r.p95_ms) || 0,
      max_ms: int(r.max_ms) || 0,
    })),
  };
}

/** GET /system-health/database */
async function database() {
  const [d, growth, statements] = await Promise.all([
    repo.databaseSummary(pool),
    repo.databaseGrowth(pool),
    repo.statementsOn(pool),
  ]);
  const hit = Number(d.blks_hit) || 0;
  const read = Number(d.blks_read) || 0;
  return {
    version: String(d.version).split(" ")[0],
    size_mb: Math.round(Number(d.bytes) / (1024 * 1024)),
    growth_mb_per_day: growth && growth.snapshots >= 12 && growth.mb_per_day !== null ? Math.round(Number(growth.mb_per_day)) : null,
    connections_used: d.connections_used,
    connections_max: d.connections_max,
    active: d.active,
    idle: d.idle,
    idle_in_transaction: d.idle_in_transaction,
    waiting: d.waiting,
    oldest_transaction_s: d.oldest_transaction_s === null ? null : Math.max(0, Number(d.oldest_transaction_s)),
    cache_hit_pct: hit + read ? pct((hit * 100) / (hit + read)) : null,
    deadlocks: Number(d.deadlocks) || 0,
    temp_mb: Math.round((Number(d.temp_bytes) || 0) / (1024 * 1024)),
    statements,
  };
}

/** GET /system-health/database/tables */
async function tables(query) {
  const page = await repo.tablesPage(pool, query);
  return {
    ...page,
    data: page.data.map((r) => ({
      name: r.name,
      rows: Math.max(0, Number(r.rows) || 0),
      total_bytes: Number(r.total_bytes),
      table_bytes: Number(r.table_bytes),
      index_bytes: Number(r.index_bytes),
      dead_pct: pct(r.dead_pct),
      last_vacuum_at: iso(r.last_vacuum_at),
    })),
  };
}

/** GET /system-health/database/queries: an empty page while pg_stat_statements is off. */
async function queries(query) {
  if (!(await repo.statementsOn(pool))) {
    return envelope([], 1, 0);
  }
  const page = await repo.queriesPage(pool, query);
  return {
    ...page,
    data: page.data.map((r) => ({
      query_id: r.query_id,
      query: r.query,
      calls: Number(r.calls),
      total_ms: Math.round(Number(r.total_ms)),
      mean_ms: String(Math.round(Number(r.mean_ms) * 100) / 100),
      max_ms: Math.round(Number(r.max_ms)),
      rows: Number(r.rows),
      share_pct: pct(r.share_pct) || "0",
    })),
  };
}

/** Each queue's counts, from Redis. Null when Redis does not answer. */
async function queueCounts() {
  const { JOBS } = require("../../jobs/registry");
  const queues = require("../../jobs/queues");
  try {
    return await Promise.all(
      JOBS.map(async (j) => {
        const c = await queues.getQueue(j.queue).getJobCounts("waiting", "active", "delayed", "failed");
        return { name: j.queue, waiting: c.waiting || 0, active: c.active || 0, delayed: c.delayed || 0, failed: c.failed || 0 };
      }),
    );
  } catch {
    return null;
  }
}

/** GET /system-health/background */
async function background() {
  const registry = require("../../jobs/registry");
  const [q, outbox, workers] = await Promise.all([
    queueCounts(),
    repo.outboxFigures(pool),
    registry.workerHealth().catch(() => null),
  ]);
  return {
    queues: q,
    outbox_waiting: outbox.waiting,
    outbox_oldest_s: outbox.oldest_s === null ? null : Math.max(0, outbox.oldest_s),
    outbox_failed: outbox.failed,
    outbox_done_hour: outbox.done_hour,
    workers: workers && typeof workers.workers === "number" ? workers.workers : null,
  };
}

/** "Every 5 minutes", "Daily at 08:00", "Hourly at :10": a scheduler's interval in words. */
function everyOf(spec) {
  if (spec.every) {
    const minutes = spec.every / 60_000;
    if (spec.every < 60_000) {
      const seconds = Math.round(spec.every / 1000);
      return seconds === 1 ? "Every second" : `Every ${seconds} seconds`;
    }
    if (minutes === 1) return "Every minute";
    if (minutes < 60) return `Every ${Math.round(minutes)} minutes`;
    return minutes === 60 ? "Hourly" : `Every ${Math.round(minutes / 60)} hours`;
  }
  const [m, h, dom, mon, dow] = String(spec.pattern).trim().split(/\s+/);
  const daily = dom === "*" && mon === "*" && dow === "*";
  const two = (n) => String(n).padStart(2, "0");
  if (daily && /^\d+$/.test(m) && /^\d+$/.test(h)) return `Daily at ${two(h)}:${two(m)}`;
  if (daily && /^\d+$/.test(m) && h === "*") return `Hourly at :${two(m)}`;
  const step = /^\*\/(\d+)$/.exec(m);
  if (daily && step && h === "*") return `Every ${step[1]} minutes`;
  const hours = /^(\d+)-(\d+)$/.exec(h);
  if (daily && step && hours) return `Every ${step[1]} minutes, ${two(hours[1])}:00 to ${two(Number(hours[2]) + 1)}:00`;
  return spec.pattern;
}

/** GET /system-health/background/jobs */
async function jobs(query) {
  const registry = require("../../jobs/registry");
  const { staleAfterMs } = require("../../http/health");
  const specs = registry.schedules();
  const byName = new Map(specs.map((s) => [s.name, s]));
  const page = await repo.jobsPage(pool, query, specs.map((s) => s.name));
  const now = Date.now();
  return {
    ...page,
    data: page.data.map((r) => {
      const spec = byName.get(r.name);
      const at = r.last_run_at ? new Date(r.last_run_at).getTime() : null;
      const runs = Number(r.runs) || 0;
      let state = "on_time";
      if (at === null) state = "never";
      else if (now - at > staleAfterMs(spec)) state = "late";
      else if (r.ok === false) state = "failing";
      return {
        name: r.name,
        summary: (spec && spec.summary) || null,
        every: spec ? everyOf(spec) : "",
        last_run_at: iso(r.last_run_at),
        last_ms: int(r.duration_ms),
        mean_ms: runs && r.total_ms !== null ? Math.round(Number(r.total_ms) / runs) : null,
        max_ms: r.max_ms === null || r.max_ms === undefined || !runs ? null : int(r.max_ms),
        runs,
        failures: Number(r.failures) || 0,
        state,
      };
    }),
  };
}

/** GET /system-health/processes */
async function processes() {
  const [live, starts] = await Promise.all([repo.liveProcesses(pool), repo.startsThisWeek(pool)]);
  const startsOf = (role) => (starts.find((s) => s.role === role) || { starts: 0 }).starts;
  const api = live.filter((p) => p.role === "api");
  return {
    people_online: api.reduce((a, p) => a + (p.users_online || 0), 0),
    sockets: api.reduce((a, p) => a + (p.sockets || 0), 0),
    processes: live.map((p) => ({
      instance: p.instance,
      role: p.role,
      host: p.host,
      pid: p.pid,
      release: p.release || null,
      started_at: iso(p.started_at),
      last_beat_at: iso(p.last_beat_at),
      memory_mb: int(p.memory_mb),
      heap_mb: int(p.heap_mb),
      loop_delay_ms: int(p.loop_delay_ms),
      cpu_pct: pct(p.cpu_pct),
      sockets: p.role === "api" ? int(p.sockets) : null,
    })),
    api_starts_7d: startsOf("api"),
    worker_starts_7d: startsOf("worker"),
  };
}

module.exports = {
  series,
  capacity,
  routes,
  database,
  tables,
  queries,
  background,
  jobs,
  processes,
  RECORDING_WITHIN_MS,
  everyOf,
  judge,
  level,
  partsOf,
  diskParts,
};
