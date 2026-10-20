"use strict";
/**
 * Health (SYSTEM_ARCHITECTURE §11).
 *
 *   GET /api/health         liveness. Cannot fail: the process is up and answering.
 *   GET /api/health/ready   readiness. Postgres, Redis, every module mounted,
 *                           the migration head, numbering schemes, the outbox backlog,
 *                           a live worker (its heartbeat), and the media and mail tools
 *                           (storage, Chromium, ffmpeg, clamd, SMTP). 503 when Postgres is down;
 *                           200 "degraded" when something else is. Deploys gate on this.
 *
 * Neither route needs a token: the proxy and the uptime probe call them. Neither
 * returns anything sensitive: statuses, counts and the build.
 *
 * registerCheck(): a subsystem built later adds its own probe here instead of
 * this file learning about it.
 *
 *   registerCheck("outbox", async () => ({ status: backlog > 500 ? "degraded" : "up", backlog }));
 */
const express = require("express");
const { buildInfo } = require("../config/build-info");
const { mountReport } = require("./module-loader");

const PROBE_TIMEOUT_MS = 2000;
const checks = new Map();

function withTimeout(promise, label) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      t = setTimeout(
        () =>
          reject(
            new Error(`${label} did not answer within ${PROBE_TIMEOUT_MS} ms`),
          ),
        PROBE_TIMEOUT_MS,
      );
      if (t.unref) t.unref();
    }),
  ]).finally(() => clearTimeout(t));
}

/**
 * Add a readiness probe. It resolves to an object with `status` ("up",
 * "degraded" or "down"); throwing or timing out counts as "down".
 * @param {string} name
 * @param {() => Promise<{status: string}>} fn
 * @param {{fatal?: boolean}} [opts]  fatal: down makes the whole service 503
 */
function registerCheck(name, fn, { fatal = false } = {}) {
  checks.set(name, { fn, fatal });
}

async function timed(fn) {
  const started = Date.now();
  const out = await fn();
  return { status: "up", latency_ms: Date.now() - started, ...out };
}

registerCheck(
  "postgres",
  () =>
    timed(async () => {
      await require("../config/db").pool.query("SELECT 1");
      return {};
    }),
  { fatal: true },
);

registerCheck("redis", () =>
  timed(async () => {
    const client = require("../config/redis").tryClient();
    if (!client) return { status: "down", error: "not connected" };
    await client.ping();
    return {};
  }),
);

registerCheck("modules", async () => {
  const r = mountReport();
  return {
    status: r.skipped.length ? "degraded" : "up",
    mounted: r.mounted.length,
    routes: r.routes.length,
    skipped: r.skipped.map((s) => s.module),
  };
});

registerCheck("numbering", () =>
  require("../shared/numbering/numbering").checkSchemes(
    require("../config/db").pool,
  ),
);

registerCheck("outbox", () =>
  require("../shared/events/outbox").health(require("../config/db").pool),
);

// The worker runs every follow-on job; without one, mail, PDFs and notifications wait.
registerCheck("worker", () => require("../jobs/registry").workerHealth());

// Media and mail: degraded, never fatal. The API serves everything else without them,
// and the operator sees exactly which tool is missing.
registerCheck("storage", () =>
  require("../services/storage/storage.service").health(),
);
registerCheck("chromium", async () =>
  require("../services/pdf/chromium").health(),
);
registerCheck("ffmpeg", () =>
  require("../services/media/av-pipeline").health(),
);
registerCheck("clamd", () => require("../services/media/scan").health());
registerCheck("mail", () =>
  require("../services/mail/system-mail.service").health(),
);
// Which AI vendor answers (Gemini or the stub), from configuration only: no call out.
registerCheck("ai", () =>
  require("../services/ai/governance").health(require("../config/db").pool),
);

// What a person asks first when something is slow: how much room is left.
// Degraded, never fatal: the app still answers on a full disk, it just cannot write.
registerCheck("disk", async () => {
  const fs = require("node:fs/promises");
  const { config } = require("../config/env");
  const where = config.MEDIA_ROOT || process.cwd();
  const st = await fs.statfs(where);
  const total = st.blocks * st.bsize;
  const free = st.bavail * st.bsize;
  const freePct = total > 0 ? Math.round((free * 100) / total) : null;
  return {
    status: freePct === null ? "degraded" : freePct < 5 ? "down" : freePct < 10 ? "degraded" : "up",
    free_pct: freePct,
    free_gb: Math.round((free / 1024 ** 3) * 10) / 10,
    total_gb: Math.round((total / 1024 ** 3) * 10) / 10,
    path: where,
  };
});

registerCheck("memory", async () => {
  const os = require("node:os");
  const total = os.totalmem();
  const used = total - os.freemem();
  const usedPct = total > 0 ? Math.round((used * 100) / total) : null;
  return {
    status: usedPct === null ? "degraded" : usedPct >= 95 ? "down" : usedPct >= 90 ? "degraded" : "up",
    used_pct: usedPct,
    used_gb: Math.round((used / 1024 ** 3) * 10) / 10,
    total_gb: Math.round((total / 1024 ** 3) * 10) / 10,
    process_mb: Math.round(process.memoryUsage().rss / 1024 ** 2),
  };
});

// Load per core over one minute: 1.0 means the machine is exactly busy.
registerCheck("cpu", async () => {
  const os = require("node:os");
  const cores = Math.max(1, os.cpus().length);
  const load = os.loadavg()[0] / cores;
  return {
    status: load >= 4 ? "down" : load >= 2 ? "degraded" : "up",
    load: Math.round(load * 100) / 100,
    cores,
  };
});

// Size and connections in one query rather than two checks: /health/ready already
// asks the pool for several things at once, and every extra round trip here is a
// connection this endpoint holds while the app is trying to serve people.
registerCheck("database_usage", async () => {
  const { rows } = await require("../config/db").pool.query(
    `SELECT pg_database_size(current_database()) AS bytes,
            (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::int AS used,
            current_setting('max_connections')::int AS allowed`,
  );
  const { bytes, used, allowed } = rows[0];
  const pct = allowed > 0 ? Math.round((used * 100) / allowed) : null;
  return {
    status: pct === null ? "degraded" : pct >= 90 ? "down" : pct >= 80 ? "degraded" : "up",
    size_mb: Math.round(Number(bytes) / 1024 ** 2),
    connections_used: used,
    connections_allowed: allowed,
    connections_pct: pct,
  };
});

/**
 * Has every background job actually run? Without this a scheduler that is never
 * started is invisible: the first release of System Health shipped with its own three
 * unregistered, and nothing said so. Degraded, never fatal: the API serves without them.
 * Whether a job is on time is jobs/report.js's judgement, so this probe, the check
 * sheet and the brief can never disagree. Only names leave here: the reasons and the
 * errors are behind the System Health permission.
 */
registerCheck("schedulers", async () => {
  const { jobs, db_error: error } = await require("../jobs/report").schedulers({
    db: require("../config/db").pool,
  });
  const named = (state) => jobs.filter((j) => j.state === state).map((j) => j.name);
  if (error) return { status: "degraded", schedulers: jobs.length, error };
  const late = named("late");
  const failing = named("failing");
  return {
    status: late.length || failing.length ? "degraded" : "up",
    schedulers: jobs.length,
    late,
    failing,
    waiting: named("waiting"),
  };
});

registerCheck("migrations", async () => {
  try {
    const { rows } = await require("../config/db").pool.query(
      // By the leading number, as migrate.js applies them: as text "9099_" sorts after "10099_".
      "SELECT name, applied_at FROM schema_migration ORDER BY substring(name from '^[0-9]+')::int DESC, name DESC LIMIT 1",
    );
    return {
      status: rows[0] ? "up" : "degraded",
      head: rows[0] ? rows[0].name : null,
    };
  } catch (err) {
    return {
      status: "degraded",
      head: null,
      error: err.code === "42P01" ? "no schema_migration table" : "unreadable",
    };
  }
});

/** The names of every probe, in the order they were registered. */
function checkNames() {
  return [...checks.keys()];
}

/**
 * One probe, run now, with the same timeout and the same reading of a throw as runChecks().
 * @param {string} name
 * @returns {Promise<{status: string}|null>}  null for a name no probe has
 */
async function runCheck(name) {
  const check = checks.get(name);
  if (!check) return null;
  try {
    return await withTimeout(Promise.resolve().then(check.fn), name);
  } catch (err) {
    return { status: "down", error: err && err.message };
  }
}

/**
 * ready, degraded or unavailable for a set of results, by runChecks()'s own rule: a
 * fatal check down makes it unavailable, anything else not up makes it degraded.
 * @param {Record<string, {status: string}>} results
 */
function serviceState(results) {
  let fatal = false;
  let degraded = false;
  for (const [name, value] of Object.entries(results || {})) {
    const check = checks.get(name);
    if (value && value.status === "down" && check && check.fatal) fatal = true;
    else if (!value || value.status !== "up") degraded = true;
  }
  return fatal ? "unavailable" : degraded ? "degraded" : "ready";
}

async function runChecks() {
  const names = [...checks.keys()];
  const results = await Promise.allSettled(
    names.map((n) => withTimeout(Promise.resolve().then(checks.get(n).fn), n)),
  );
  const out = {};
  let fatal = false;
  let degraded = false;
  results.forEach((r, i) => {
    const name = names[i];
    const value =
      r.status === "fulfilled"
        ? r.value
        : { status: "down", error: r.reason && r.reason.message };
    out[name] = value;
    if (value.status === "down" && checks.get(name).fatal) fatal = true;
    else if (value.status !== "up") degraded = true;
  });
  return { checks: out, fatal, degraded };
}

function healthRouter() {
  const router = express.Router();

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      status: "alive",
      uptime_s: Math.floor(process.uptime()),
      build: buildInfo(),
    });
  });

  router.get("/health/ready", async (_req, res) => {
    const { checks: results, fatal, degraded } = await runChecks();
    res.status(fatal ? 503 : 200).json({
      ok: !fatal,
      status: fatal ? "unavailable" : degraded ? "degraded" : "ready",
      build: buildInfo(),
      checks: results,
    });
  });

  return router;
}

module.exports = { healthRouter, registerCheck, runChecks, runCheck, checkNames, serviceState };
