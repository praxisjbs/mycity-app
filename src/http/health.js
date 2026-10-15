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

registerCheck("migrations", async () => {
  try {
    const { rows } = await require("../config/db").pool.query(
      "SELECT name, applied_at FROM schema_migration ORDER BY name DESC LIMIT 1",
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

module.exports = { healthRouter, registerCheck, runChecks };
