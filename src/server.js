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
 *   5. realtime          Socket.io on the same server, staff host only (realtime/socket.js)
 *   6. listen
 *
 * Shutdown on SIGTERM/SIGINT: close the sockets and stop accepting, let in-flight
 * requests finish (up to 10 seconds), flush error reports, close Redis and the pool, exit.
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
const realtime = require("./realtime/socket");

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled rejection");
  report(reason, { origin: "server", route: "unhandledRejection" });
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception; exiting for a clean restart");
  report(err, {
    origin: "server",
    severity: "fatal",
    route: "uncaughtException",
  });
  flush().finally(() => setTimeout(() => process.exit(1), 500).unref());
});

async function start() {
  await checkDatabase();
  await initRedis();
  logger.info({ store: initRateLimitStore() }, "rate limits ready");

  const { app, report: mount } = buildApp();
  logger.info(
    {
      mounted: mount.mounted.length,
      routes: mount.routes.length,
      skipped: mount.skipped.length,
    },
    "modules mounted",
  );
  // AI manifests and search providers are checked now: one that declares a write, or
  // is malformed, stops the boot rather than reaching a question (A23, gates 9, 10, 19).
  // Counted through the registry's own accessors, never the shape load() returns: reading a
  // field that load() had stopped returning crashed every boot after it was reshaped.
  const ai = require("./shared/ai/registry");
  ai.load();
  const search = require("./shared/search/registry").load();
  logger.info(
    {
      ai_reads: ai.reads().length,
      ai_summaries: ai.summaries().length,
      ai_actions: ai.actions().length,
      search_providers: search.length,
    },
    "AI manifests and search providers loaded",
  );

  const server = http.createServer(app);
  // Longer than the proxy's keep-alive, so the proxy never reuses a socket Node just closed.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  realtime.attach(server);

  await new Promise((resolve) => server.listen(config.PORT, resolve));
  // Once a minute: this process's memory, event loop and the people connected to it.
  const stopBeat = require("./shared/observability/process-beat").start({
    role: "api",
    extras: () => realtime.presence(),
  });
  logger.info(
    { port: config.PORT, env: config.APP_ENV },
    "mycity api listening",
  );

  let stopping = false;
  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "shutting down");
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    const finish = async () => {
      await stopBeat().catch(() => {});
      await require("./shared/observability/request-stats").flush().catch(() => {});
      await flush().catch(() => {});
      // The connections' counted use (Settings · Integrations), before the pool closes.
      await require("./shared/integrations/usage").stop();
      await Promise.allSettled([closeRedis(), closeDb()]);
      process.exit(0);
    };
    // Socket.io closes the HTTP server it is attached to, after closing its sockets
    // (an open WebSocket would otherwise hold server.close() until the force timer).
    if (realtime.isAttached()) realtime.close().then(finish);
    else server.close(finish);
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
