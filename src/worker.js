"use strict";
// Named before config is read: the pool, the log lines and pg_stat_activity say "mycity-worker".
process.env.MYCITY_PROCESS = process.env.MYCITY_PROCESS || "mycity-worker";
/**
 * The worker process (systemd unit mycity-worker-<env>; SYSTEM_ARCHITECTURE §2). Runs
 * everything that must not sit on a request: the outbox dispatcher, the BullMQ
 * consumers (mail, PDFs, notifications, media, imports) and the schedulers. Serves no
 * HTTP.
 *
 *   npm run worker        node src/worker.js
 *   npm run dev:worker    the same, restarted on change
 *
 * Boot, in order, and why the order matters:
 *
 *   1. config/env.js     refuses an unsafe or incomplete environment (on require)
 *   2. Postgres, Redis   reachable, or the boot stops
 *   3. every handler     the shared layer's events (notifications fan-out, workflow,
 *                        alerts, documents, imports), then each module's
 *                        <module>.events.js and *.import.js. A file that fails to load
 *                        stops the boot: a worker missing a handler would mark that
 *                        event's work done without doing it
 *   4. triggers          committed events that put jobs on queues (jobs/registry.js),
 *                        and the hand-over of notifications to notification-deliver
 *   5. markReady()       only now may the outbox dispatcher run (it refuses before)
 *   6. consumers, schedules, heartbeat
 *
 * Shutdown on SIGTERM/SIGINT: stop the schedules, let running jobs finish (BullMQ waits
 * for them; forced after 30 seconds, and an unfinished job is picked up again by the next
 * worker), close Chromium, flush error reports, close Redis and the pool.
 *
 * An uncaught exception exits so systemd restarts a clean process. An unhandled
 * rejection is reported and the process kept.
 */
const fs = require("node:fs");
const path = require("node:path");
require("./config/env"); // refuses an unsafe or incomplete environment before anything else loads
const { logger } = require("./config/logger");
const { checkDatabase, closeDb } = require("./config/db");
const { initRedis, closeRedis } = require("./config/redis");
const { report, flush } = require("./shared/observability/error-reporter");

const MODULES_DIR = path.resolve(__dirname, "modules");
const NAME_RE = /^[a-z][a-z0-9_]*$/;
const FORCE_EXIT_MS = 30_000;

/** Shared files that declare events and register outbox handlers. */
const SHARED_HANDLER_FILES = Object.freeze([
  "./shared/notifications/fanout",
  "./shared/workflow/engine",
  "./shared/alerts/alerts",
  "./shared/documents/vault",
  "./shared/documents/generate",
  "./shared/import/engine",
]);

const nonEmpty = (file) => fs.existsSync(file) && fs.statSync(file).size > 0;

/**
 * Every module file the worker needs: <module>.events.js (event keys, outbox handlers,
 * notifications, document types) and *.import.js (importers the import jobs run).
 * Files the repository map created but nobody has written yet are skipped.
 * @param {string} [dir]
 * @returns {string[]} repo-relative paths, in load order
 */
function moduleHandlerFiles(dir = MODULES_DIR) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isDirectory() || !NAME_RE.test(e.name)) continue;
    const folder = path.join(dir, e.name);
    const events = path.join(folder, `${e.name}.events.js`);
    if (nonEmpty(events)) out.push(events);
    for (const f of fs.readdirSync(folder).sort()) {
      if (f.endsWith(".import.js") && nonEmpty(path.join(folder, f)))
        out.push(path.join(folder, f));
    }
  }
  return out;
}

/** Steps 3 to 5 of the boot. Exposed for tests. */
function loadHandlers({ dir = MODULES_DIR } = {}) {
  for (const f of SHARED_HANDLER_FILES) require(f);
  const files = moduleHandlerFiles(dir);
  for (const f of files) require(f);
  const registry = require("./jobs/registry");
  registry.registerTriggers();
  registry.registerDelivery();
  const outbox = require("./shared/events/outbox");
  outbox.markReady();
  return {
    modules: files.map((f) =>
      path.relative(path.resolve(__dirname, ".."), f).split(path.sep).join("/"),
    ),
    handlers: outbox.registrations().length,
  };
}

function installProcessHandlers() {
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "unhandled rejection (worker)");
    report(reason, { origin: "worker", route: "unhandledRejection" });
  });
  process.on("uncaughtException", (err) => {
    logger.fatal(
      { err },
      "uncaught exception (worker); exiting for a clean restart",
    );
    report(err, {
      origin: "worker",
      severity: "fatal",
      route: "uncaughtException",
    });
    flush().finally(() => setTimeout(() => process.exit(1), 500).unref());
  });
}

async function start() {
  await checkDatabase();
  await initRedis();

  const loaded = loadHandlers();
  require("./shared/ai/registry").load();
  require("./shared/search/registry").load();
  // The assistant's catalogue follows the code that is running. deploy-gate runs the
  // same sync; doing it here too means a worker restart can never leave it stale.
  require("./shared/ai/catalogue-sync")
    .sync(require("./config/db").pool)
    .then((r) => logger.info(r, "AI catalogue synced"))
    .catch((err) =>
      logger.warn(
        { err: err.message },
        "AI catalogue not synced (ai_catalogue arrives with migration 0095)",
      ),
    );
  const registry = require("./jobs/registry");
  const workers = registry.startConsumers();
  const schedules = await registry.startSchedules();
  const stopHeartbeat = registry.startHeartbeat();
  // Mailbox: IMAP IDLE on up to MAILBOX_IDLE_MAX inboxes (none on staging and laptops).
  const mailIdle = require("./jobs/loops/mail-idle").start();
  logger.info(
    {
      queues: workers.map((w) => w.name),
      schedules: [...schedules.scheduled, ...schedules.in_process],
      ...loaded,
    },
    "mycity worker ready",
  );

  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "worker shutting down");
    const force = setTimeout(() => process.exit(1), FORCE_EXIT_MS);
    force.unref();
    schedules.stop();
    await mailIdle.stop();
    await Promise.allSettled(workers.map((w) => w.close()));
    await stopHeartbeat();
    await require("./jobs/queues").closeQueues();
    await require("./services/pdf/chromium")
      .close()
      .catch(() => {});
    await flush().catch(() => {});
    await Promise.allSettled([closeRedis(), closeDb()]);
    process.exit(0);
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
  return { workers, schedules, stop };
}

if (require.main === module) {
  installProcessHandlers();
  start().catch((err) => {
    logger.fatal({ err }, "the worker did not start");
    flush().finally(() => process.exit(1));
  });
}

module.exports = {
  start,
  loadHandlers,
  moduleHandlerFiles,
  SHARED_HANDLER_FILES,
};
