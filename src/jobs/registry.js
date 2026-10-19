"use strict";
/**
 * Everything the worker runs, declared in one place (SYSTEM_ARCHITECTURE §7, README §5.15).
 *
 *   JOBS        one BullMQ queue per handler file, jobs/handlers/<queue>.js
 *   SCHEDULERS  one file per recurring job, jobs/schedulers/<name>.js
 *   TRIGGERS    which committed event puts which job on a queue (outbox handlers)
 *
 * A milestone that adds background work adds its line here and its file beside the
 * others. Nothing else needs to learn about it: the worker starts what this file lists.
 *
 * Handlers. `module.exports = async function (job) { ... }`. A handler is idempotent,
 * because BullMQ and the outbox both deliver at least once. It throws to be retried;
 * it throws `UnrecoverableError` (from bullmq) when retrying cannot help (the record is
 * gone, the request is invalid), which fails the job at once. isLastAttempt(job) tells
 * a handler that this failure is final, so it can record it (pdf-render marks the
 * document failed).
 *
 * Schedulers. A file exports defineSchedule({ name, every | pattern, run }):
 *   every     milliseconds between runs, or
 *   pattern   a cron expression read in Africa/Lagos (tz overrides), for "at 02:30"
 *   run       async () => summary
 *   inProcess true: polled by a timer inside every worker instead of a BullMQ tick, for
 *             work that is due every second and already safe to run from several
 *             processes at once (the outbox dispatcher's SKIP LOCKED claim)
 * A BullMQ scheduler adds one job per tick to the `schedule` queue, once across all
 * processes; the tick runs under withCronLock (jobs/cron-lock.js) so a slow run and
 * the next tick never overlap. A tick is never retried (`attempts: 1`): the next tick is
 * the retry, and every sweep here is safe to repeat.
 */
const { Worker, UnrecoverableError } = require("bullmq");
const { logger } = require("../config/logger");
const { createConnection, REDIS_PREFIX } = require("../config/redis");
const requestContext = require("../config/request-context");
const metrics = require("../shared/observability/metrics");

const SCHEDULE_QUEUE = "schedule";
const DEFAULT_TZ = "Africa/Lagos";
const NAME_RE = /^[a-z][a-z0-9-]*$/;

/** queue = handler file name. Concurrency is per worker process. */
const JOBS = Object.freeze([
  { queue: "email-send", concurrency: 3, summary: "System mail through SMTP" },
  {
    queue: "pdf-render",
    concurrency: 2,
    summary: "A generated document rendered to PDF in Chromium",
  },
  {
    queue: "notification-deliver",
    concurrency: 4,
    summary: "Notifications sent out: the bell, email and push",
  },
  {
    queue: "notification-push",
    concurrency: 4,
    summary: "One notice pushed to its person's phones and computers",
  },
  {
    queue: "media-scan",
    concurrency: 2,
    summary: "A file from outside scanned by clamd",
  },
  {
    queue: "av-transcode",
    concurrency: 1,
    summary: "A voice note or video made playable (CPU bound, one at a time)",
  },
  {
    queue: "media-derive",
    concurrency: 1,
    summary: "A stored document's derived files made again",
  },
  {
    queue: "import-validate",
    concurrency: 1,
    summary: "An import previewed in the background",
  },
  {
    queue: "import-commit",
    concurrency: 1,
    summary: "An import committed in the background",
  },
  {
    queue: "celebrations",
    concurrency: 1,
    summary: "A day's birthday and work anniversary cards posted again, by hand",
  },
  {
    queue: "announcement-publish",
    concurrency: 1,
    summary: "A scheduled announcement released at its time",
  },
  {
    queue: "mail-sync",
    concurrency: 1,
    summary: "One mailbox's new mail fetched over IMAP (one connection at a time)",
  },
  {
    queue: "mail-send",
    concurrency: 1,
    summary: "A queued message delivered through SMTP at its time",
  },
  {
    queue: "attendance-day-close",
    concurrency: 1,
    summary: "Attendance days before a date closed again, by hand",
  },
  {
    queue: "home-alert-sweeps",
    concurrency: 1,
    summary: "Home's alert rules read again for a day, by hand",
  },
  {
    queue: "scheduled-report",
    concurrency: 2,
    summary: "A report schedule's slot: a run for each recipient and format",
  },
]);

/** Files in jobs/schedulers/. */
const SCHEDULERS = Object.freeze([
  "outbox-dispatch",
  "workflow-timeout",
  "alert-ageing",
  "media-reconcile",
  "import-cleanup",
  "celebrations",
  "announcement-release",
  "mail-sync",
  "attendance-day-close",
  "attendance-clock-watch",
  "home-alert-sweeps",
  "scheduled-reports",
  "export-cleanup",
  "urgent-repeats",
]);

/** Ticks of different schedulers may run side by side; one scheduler never overlaps itself (cron-lock). */
const SCHEDULE_CONCURRENCY = 2;

const documentIdOf = (e) => (e.payload && e.payload.document_id) || e.entity.id;
const needs = (what) => (e) =>
  Array.isArray(e.payload && e.payload.needs) && e.payload.needs.includes(what);

/**
 * Committed event → job. The outbox runs these in the worker after commit, and the job
 * id is the event id, so an outbox retry never queues the same work twice.
 */
const TRIGGERS = Object.freeze([
  {
    event: "document.render_requested",
    name: "jobs.pdf-render",
    queue: "pdf-render",
    data: (e) => ({ document_id: documentIdOf(e) }),
  },
  // clamd down is the usual failure: ten tries, 30 s doubling, about four hours before giving up.
  {
    event: "document.stored",
    name: "jobs.media-scan",
    queue: "media-scan",
    when: needs("scan"),
    data: (e) => ({ document_id: documentIdOf(e) }),
    opts: { attempts: 10, backoff: { type: "exponential", delay: 30_000 } },
  },
  {
    event: "document.stored",
    name: "jobs.av-transcode",
    queue: "av-transcode",
    when: needs("av"),
    data: (e) => ({ document_id: documentIdOf(e) }),
  },
]);

/* ------------------------------------------------------------------ *
 * Declarations
 * ------------------------------------------------------------------ */

function isQueue(name) {
  return name === SCHEDULE_QUEUE || JOBS.some((j) => j.queue === name);
}

/** The handler for a queue (jobs/handlers/<queue>.js). */
function handlerOf(queue) {
  const fn = require(`./handlers/${queue}`);
  if (typeof fn !== "function")
    throw new Error(
      `jobs/handlers/${queue}.js must export an async function (job) => result`,
    );
  return fn;
}

/**
 * Declare a recurring job. Used by every file in jobs/schedulers/.
 * @param {{name: string, every?: number, pattern?: string, tz?: string, inProcess?: boolean,
 *          run: () => Promise<object|void>, summary?: string}} spec
 */
function defineSchedule(spec) {
  const where = `defineSchedule(${spec && spec.name})`;
  if (!spec || !NAME_RE.test(String(spec.name || "")))
    throw new Error(`${where}: name is kebab-case`);
  if (typeof spec.run !== "function")
    throw new Error(`${where}: run is an async function`);
  const hasEvery = spec.every !== undefined;
  const hasPattern = spec.pattern !== undefined;
  if (hasEvery === hasPattern)
    throw new Error(`${where}: give every (ms) or pattern (cron), not both`);
  if (hasEvery && (!Number.isInteger(spec.every) || spec.every < 1000))
    throw new Error(`${where}: every is whole milliseconds, at least 1000`);
  if (hasPattern && String(spec.pattern).trim().split(/\s+/).length !== 5)
    throw new Error(`${where}: pattern is a five-field cron expression`);
  if (spec.inProcess && !hasEvery)
    throw new Error(`${where}: an in-process schedule uses every`);
  return Object.freeze({ tz: DEFAULT_TZ, inProcess: false, ...spec });
}

/** Every scheduler, loaded and checked. */
function schedules() {
  return SCHEDULERS.map((file) => {
    const spec = require(`./schedulers/${file}`);
    if (!spec || spec.name !== file)
      throw new Error(
        `jobs/schedulers/${file}.js must export defineSchedule({ name: "${file}", ... })`,
      );
    return spec;
  });
}

/** True when this attempt is the job's last: a failure now is final. */
function isLastAttempt(job) {
  const attempts = (job.opts && job.opts.attempts) || 1;
  return (job.attemptsMade || 0) + 1 >= attempts;
}

/* ------------------------------------------------------------------ *
 * Triggers and delivery (registered in the worker only)
 * ------------------------------------------------------------------ */

let triggersRegistered = false;

/** Register every TRIGGERS entry as an outbox handler. Call before outbox.markReady(). */
function registerTriggers() {
  if (triggersRegistered) return;
  const outbox = require("../shared/events/outbox");
  const catalogue = require("../shared/events/catalogue");
  require("../shared/documents/vault"); // declares the document events
  const queues = require("./queues");
  for (const t of TRIGGERS) {
    if (!catalogue.has(t.event))
      throw new Error(
        `jobs/registry: trigger ${t.name} listens to "${t.event}", which no events file declares`,
      );
    if (!isQueue(t.queue))
      throw new Error(
        `jobs/registry: trigger ${t.name} names an unknown queue "${t.queue}"`,
      );
    outbox.register(t.event, t.name, async (event) => {
      if (t.when && !t.when(event)) return;
      await queues.enqueue(t.queue, event.key, t.data(event), {
        ...(t.opts || {}),
        jobId: `${t.queue}-${event.event_id}`,
      });
    });
  }
  triggersRegistered = true;
}

let deliveryRegistered = false;

/**
 * Hand new notifications to the notification-deliver queue. The fan-out writes the rows
 * after commit; this queues their sending (bell, email, push) as one job per event.
 */
function registerDelivery() {
  if (deliveryRegistered) return;
  const fanout = require("../shared/notifications/fanout");
  const queues = require("./queues");
  fanout.onDelivery(async (rows, event) => {
    await queues.enqueue(
      "notification-deliver",
      event.key,
      {
        event: {
          event_id: event.event_id,
          key: event.key,
          entity: event.entity,
          actor_user_id: event.actor_user_id,
        },
        notifications: rows,
        push: fanout.pushStyleOf(event),
      },
      { jobId: `notification-deliver-${event.event_id}` },
    );
  });
  deliveryRegistered = true;
}

/* ------------------------------------------------------------------ *
 * Running
 * ------------------------------------------------------------------ */

/** Wrap a handler with the request context it was queued under, timing, logs and metrics. */
function instrument(queue, fn) {
  return async (job, token) => {
    const started = Date.now();
    const ctx = (job.data && job.data.__ctx) || {};
    const scope = {
      requestId: ctx.request_id || null,
      userId: ctx.user_id || null,
      surface: "worker",
    };
    logger.debug(
      {
        queue,
        job: job.name,
        id: job.id,
        attempt: (job.attemptsMade || 0) + 1,
      },
      "job start",
    );
    try {
      const result = await requestContext.run(scope, () => fn(job, token));
      const ms = Date.now() - started;
      metrics.observe(
        "mycity_job_duration_seconds",
        ms / 1000,
        { queue },
        "Background job run time.",
      );
      metrics.inc(
        "mycity_jobs_total",
        { queue, outcome: "ok" },
        1,
        "Background jobs by queue and outcome.",
      );
      logger.info({ queue, job: job.name, id: job.id, ms }, "job done");
      return result;
    } catch (err) {
      const ms = Date.now() - started;
      metrics.observe(
        "mycity_job_duration_seconds",
        ms / 1000,
        { queue },
        "Background job run time.",
      );
      if (err && err.name === "DelayedError") {
        // Not a failure: the job put itself back for later (mail pacing).
        metrics.inc("mycity_jobs_total", { queue, outcome: "postponed" }, 1, "Background jobs by queue and outcome.");
        logger.info({ queue, job: job.name, id: job.id, ms, reason: err.message }, "job postponed");
        throw err;
      }
      logger.warn({ queue, job: job.name, id: job.id, ms, err }, "job threw");
      throw err;
    }
  };
}

/**
 * BullMQ reports `failed` once per attempt. Retries are counted; only a final failure
 * (attempts used up, or an UnrecoverableError) is reported, because an alert that fires
 * on every retry is an alert people mute.
 */
function onFailed(queue) {
  return (job, err) => {
    const attempts = (job && job.attemptsMade) || 0;
    const max = (job && job.opts && job.opts.attempts) || 1;
    const terminal =
      attempts >= max || (err && err.name === "UnrecoverableError");
    metrics.inc(
      "mycity_jobs_total",
      { queue, outcome: terminal ? "dead" : "retry" },
      1,
      "Background jobs by queue and outcome.",
    );
    const line = {
      queue,
      job: job && job.name,
      id: job && job.id,
      attempts,
      max,
      err,
    };
    if (!terminal) {
      logger.warn(line, "job attempt failed; it will be retried");
      return;
    }
    logger.error(line, "job failed for good");
    require("../shared/observability/error-reporter").report(err, {
      origin: "worker",
      severity: "error",
      route: `job ${queue}`,
      extra: { queue, job: job && job.name, job_id: job && job.id, attempts },
    });
  };
}

function consumer(queue, processor, concurrency) {
  // A connection of its own: a consumer blocks on Redis while it waits for work, and a
  // shared connection would stall everything else queued behind that read.
  const worker = new Worker(queue, instrument(queue, processor), {
    connection: createConnection(`worker:${queue}`),
    prefix: REDIS_PREFIX,
    concurrency,
  });
  worker.on("failed", onFailed(queue));
  worker.on("error", (err) => logger.error({ queue, err }, "worker error"));
  return worker;
}

/**
 * Start a consumer for every queue in JOBS and for the schedule queue.
 * @param {{only?: string[]}} [opts]  only these queues (tests)
 * @returns {import("bullmq").Worker[]}
 */
function startConsumers({ only = null } = {}) {
  const workers = [];
  for (const j of JOBS) {
    if (only && !only.includes(j.queue)) continue;
    workers.push(consumer(j.queue, handlerOf(j.queue), j.concurrency));
  }
  if (!only || only.includes(SCHEDULE_QUEUE)) {
    const byName = new Map(schedules().map((s) => [s.name, s]));
    const { withCronLock } = require("./cron-lock");
    workers.push(
      consumer(
        SCHEDULE_QUEUE,
        async (job) => {
          const spec = byName.get(job.name);
          if (!spec) {
            logger.warn(
              { scheduler: job.name },
              "a tick for a scheduler this build does not have; ignored",
            );
            return { skipped: "unknown scheduler" };
          }
          const out = await withCronLock(spec.name, () => spec.run());
          return out === undefined ? { skipped: "locked" } : out;
        },
        SCHEDULE_CONCURRENCY,
      ),
    );
  }
  for (const w of workers)
    logger.info(
      { queue: w.name, concurrency: w.opts.concurrency },
      "consumer started",
    );
  return workers;
}

/**
 * Put every BullMQ-ticked scheduler on the schedule queue (idempotent: an unchanged
 * scheduler is left as it is, a changed one is updated) and remove ticks for schedulers
 * this build no longer has. Start the in-process ones.
 * @returns {Promise<{stop: () => void, scheduled: string[], in_process: string[]}>}
 */
async function startSchedules() {
  const queues = require("./queues");
  const queue = queues.getQueue(SCHEDULE_QUEUE);
  const specs = schedules();
  const ticked = specs.filter((s) => !s.inProcess);

  for (const s of ticked) {
    const repeat = s.every
      ? { every: s.every }
      : { pattern: s.pattern, tz: s.tz };
    await queue.upsertJobScheduler(s.name, repeat, {
      name: s.name,
      data: {},
      opts: { attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
    });
  }
  const wanted = new Set(ticked.map((s) => s.name));
  for (const existing of await queue.getJobSchedulers(0, -1)) {
    const id = existing.key || existing.id;
    if (id && !wanted.has(id)) {
      await queue.removeJobScheduler(id);
      logger.info(
        { scheduler: id },
        "removed a scheduler this build no longer has",
      );
    }
  }

  const timers = [];
  for (const s of specs.filter((x) => x.inProcess)) {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await s.run();
      } catch (err) {
        logger.error(
          { err, scheduler: s.name },
          "in-process scheduler tick failed",
        );
      } finally {
        running = false;
      }
    };
    const t = setInterval(tick, s.every);
    if (t.unref) t.unref();
    timers.push(t);
  }

  logger.info(
    {
      scheduled: [...wanted],
      in_process: specs.filter((x) => x.inProcess).map((x) => x.name),
    },
    "schedules started",
  );
  return {
    stop: () => timers.forEach((t) => clearInterval(t)),
    scheduled: [...wanted],
    in_process: specs.filter((x) => x.inProcess).map((x) => x.name),
  };
}

/* ------------------------------------------------------------------ *
 * Liveness: the worker says it is alive, the API's readiness reads it
 * ------------------------------------------------------------------ */

const HEARTBEAT_EVERY_MS = 30_000;
const HEARTBEAT_TTL_S = 90;

/**
 * Write this worker's heartbeat now and every 30 seconds (a key that expires after 90).
 * A worker that has died stops writing, and /api/health/ready reports it within 90 s.
 * @returns {() => Promise<void>} stop, which also removes the key
 */
function startHeartbeat() {
  const { getClient, rkey } = require("../config/redis");
  const os = require("node:os");
  const key = rkey("worker", `${os.hostname()}-${process.pid}`);
  const value = JSON.stringify({
    host: os.hostname(),
    pid: process.pid,
    started_at: new Date().toISOString(),
  });
  const beat = () =>
    getClient()
      .set(key, value, "EX", HEARTBEAT_TTL_S)
      .catch((err) => logger.warn({ err }, "worker heartbeat not written"));
  beat();
  const t = setInterval(beat, HEARTBEAT_EVERY_MS);
  if (t.unref) t.unref();
  return async () => {
    clearInterval(t);
    await getClient()
      .del(key)
      .catch(() => {});
  };
}

/** Readiness probe (http/health.js): how many workers wrote a heartbeat in the last 90 seconds. */
async function workerHealth() {
  const { tryClient, rkey } = require("../config/redis");
  const redis = tryClient();
  if (!redis)
    return { status: "degraded", workers: 0, error: "redis not connected" };
  const keys = [];
  let cursor = "0";
  do {
    const [next, found] = await redis.scan(
      cursor,
      "MATCH",
      rkey("worker", "*"),
      "COUNT",
      100,
    );
    keys.push(...found);
    cursor = next;
  } while (cursor !== "0" && keys.length < 100);
  return { status: keys.length ? "up" : "degraded", workers: keys.length };
}

module.exports = {
  JOBS,
  SCHEDULERS,
  TRIGGERS,
  SCHEDULE_QUEUE,
  UnrecoverableError,
  isQueue,
  handlerOf,
  defineSchedule,
  schedules,
  isLastAttempt,
  registerTriggers,
  registerDelivery,
  startConsumers,
  startSchedules,
  startHeartbeat,
  workerHealth,
};
