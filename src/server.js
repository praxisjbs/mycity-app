"use strict";
/**
 * The API process (systemd unit mycity-api-<env>). HTTP for both surfaces.
 *
 *   npm start            node src/server.js
 *   npm run dev          the same, restarted on change
 *
 * Boot, in order, and why each step stops the boot when it fails:
 *
 *   1. config/env.js     refuses an unsafe or incomplete environment (on require)
 *   2. Postgres          reachable, and not a superuser on a server
 *   3. Redis             reachable; then rate limits move from memory to Redis
 *   4. app               every module mounted (a module that fails is skipped and
 *                        reported by /api/health/ready, which the deploy gates on)
 *   5. listen
 *
 * Shutdown on SIGTERM/SIGINT: stop accepting, let in-flight requests finish (up
 * to 10 seconds), flush error reports, close Redis and the pool, exit.
 *
 * An uncaught exception exits so systemd restarts a clean process; carrying on in
 * an unknown state is how a half-broken API serves wrong answers for hours. An
 * unhandled rejection is reported and the process kept: async-safe routes request
 * errors to the handler, so one reaching here is a stray background promise.
 */
const http = require("node:http");
const { config } = require("./config/env");
const { logger } = require("./config/logger");
const { checkDatabase, closeDb } = require("./config/db");
const { initRedis, closeRedis } = require("./config/redis");
const { initRateLimitStore } = require("./middleware/rate-limit");
const { report, flush } = require("./shared/observability/error-reporter");
const { buildApp } = require("./app");

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled rejection");
  report(reason, { origin: "server", route: "unhandledRejection" });
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception; exiting for a clean restart");
  report(err, { origin: "server", severity: "fatal", route: "uncaughtException" });
  flush().finally(() => setTimeout(() => process.exit(1), 500).unref());
});

async function start() {
  await checkDatabase();
  await initRedis();
  logger.info({ store: initRateLimitStore() }, "rate limits ready");

  const { app, report: mount } = buildApp();
  logger.info({ mounted: mount.mounted.length, routes: mount.routes.length, skipped: mount.skipped.length }, "modules mounted");

  const server = http.createServer(app);
  // Longer than the proxy's keep-alive, so the proxy never reuses a socket Node just closed.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  await new Promise((resolve) => server.listen(config.PORT, resolve));
  logger.info({ port: config.PORT, env: config.APP_ENV }, "mycity api listening");

  let stopping = false;
  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "shutting down");
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    server.close(async () => {
      await flush().catch(() => {});
      await Promise.allSettled([closeRedis(), closeDb()]);
      process.exit(0);
    });
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
  return server;
}

if (require.main === module) {
  start().catch((err) => {
    logger.fatal({ err }, "the API did not start");
    process.exit(1);
  });
}

module.exports = { start };
