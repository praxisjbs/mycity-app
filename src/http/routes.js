"use strict";
/**
 * Every path the API answers, and what each surface runs before a module sees
 * the request (SYSTEM_ARCHITECTURE §3, §4).
 *
 *   /api/health, /api/health/ready      no auth (http/health.js)
 *   /api/metrics                        bearer METRICS_TOKEN; absent when the token is not set
 *   /api/v1/...                         staff:  CORS hub origin (credentials), per-user rate
 *                                       limit, Idempotency-Key, then the module routers
 *   /api/public/v1/...                  public: CORS go origin (no credentials), per-IP rate
 *                                       limits, then the public module routers
 *
 * The proxy also allow-lists by host (only /api/public reaches Node from go.,
 * /api/public is refused on hub.); this file does not rely on that, it repeats it.
 */
const crypto = require("node:crypto");
const express = require("express");
const cors = require("cors");
const { config } = require("../config/env");
const requestContext = require("../config/request-context");
const { healthRouter } = require("./health");
const { mountModules } = require("./module-loader");
const { idempotency } = require("../middleware/idempotency");
const rateLimit = require("../middleware/rate-limit");
const metrics = require("../shared/observability/metrics");

/** Origins one surface accepts. DEV_EXTRA_ORIGINS is emptied on servers by config/env.js. */
function originsFor(primary) {
  const extra = config.DEV_EXTRA_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [primary, ...extra];
}

function surface(name) {
  return (req, _res, next) => {
    req.surface = name;
    requestContext.set({ surface: name });
    next();
  };
}

function metricsRoute(router) {
  if (!config.METRICS_TOKEN) return;
  const expected = Buffer.from(`Bearer ${config.METRICS_TOKEN}`);
  router.get("/metrics", (req, res) => {
    const given = Buffer.from(String(req.headers.authorization || ""));
    if (
      given.length !== expected.length ||
      !crypto.timingSafeEqual(given, expected)
    ) {
      return res
        .status(404)
        .json({ error: { code: "NOT_FOUND", message: "Not found" } });
    }
    res.type("text/plain; version=0.0.4").send(metrics.render());
  });
}

/**
 * @param {{strict?: boolean, dir?: string}} [opts]
 *   strict  a module that fails to load stops the build (tests, generators)
 *   dir     the modules directory; tests point it at fixtures
 * @returns {{router: import("express").Router, report: object}}
 */
function buildRoutes(opts = {}) {
  const router = express.Router();

  router.use("/api", healthRouter());
  const api = express.Router();
  metricsRoute(api);
  router.use("/api", api);

  const staff = express.Router();
  const pub = express.Router();
  const report = mountModules(
    { staff, public: pub },
    { strict: opts.strict, dir: opts.dir || undefined },
  );

  router.use(
    "/api/v1",
    surface("staff"),
    cors({
      origin: originsFor(config.STAFF_ORIGIN),
      credentials: true,
      maxAge: 600,
    }),
    rateLimit.staffLimiter,
    idempotency,
    staff,
  );

  router.use(
    "/api/public/v1",
    surface("public"),
    cors({
      origin: originsFor(config.PUBLIC_ORIGIN),
      credentials: false,
      maxAge: 600,
    }),
    rateLimit.publicLimiter,
    rateLimit.publicWriteLimiter,
    pub,
  );

  return { router, report };
}

module.exports = { buildRoutes, originsFor };
