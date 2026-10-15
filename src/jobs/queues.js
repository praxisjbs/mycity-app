"use strict";
/**
 * Putting work on a queue, from any process (SYSTEM_ARCHITECTURE §7).
 *
 *   const queues = require("../../jobs/queues");
 *   await queues.enqueue("email-send", "invite", { to, template: "user-invite", data });
 *
 * The worker owns the consumers (jobs/registry.js); the API, a scheduler or an outbox
 * handler only adds jobs. A queue is created on first use over the shared Redis
 * client and kept.
 *
 * Isolation between environments: every queue carries the BullMQ `prefix`
 * `mycity:<env>` (REDIS_PREFIX), on top of each environment having its own Redis
 * database. Two environments on one Redis server without distinct prefixes would let a
 * staging worker take a production job (MILESTONES §2).
 *
 * Defaults: five attempts with exponential backoff from 5 seconds, the last 1,000
 * finished jobs and 5,000 failed ones kept for inspection. A caller overrides any of it;
 * a sweep that is safe to repeat passes `attempts: 1`, since the next tick is its retry.
 *
 * The request that caused the job rides along (`__ctx`: request id and user), and the
 * worker restores it, so a failed job's log lines name the action that started it.
 *
 * Only queues the registry declares can be used: a typo is an error at the call, not a
 * job that waits in Redis for a consumer that does not exist.
 */
const { Queue } = require("bullmq");
const { getClient, REDIS_PREFIX } = require("../config/redis");
const requestContext = require("../config/request-context");

const DEFAULTS = Object.freeze({
  attempts: 5,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
});

const queues = new Map();

function assertQueue(name) {
  if (!require("./registry").isQueue(name)) {
    throw new Error(
      `queues: "${name}" is not a queue (declare it in jobs/registry.js)`,
    );
  }
}

/**
 * The queue called `name`, created on first use.
 * @param {string} name
 * @returns {import("bullmq").Queue}
 */
function getQueue(name) {
  assertQueue(name);
  if (!queues.has(name)) {
    queues.set(
      name,
      new Queue(name, { connection: getClient(), prefix: REDIS_PREFIX }),
    );
  }
  return queues.get(name);
}

/**
 * Add a job.
 * @param {string} name     a queue declared in jobs/registry.js
 * @param {string} jobName  what this job is, for logs ("invite", "render")
 * @param {object} data     JSON only: ids, not rows or buffers
 * @param {import("bullmq").JobsOptions & {replaceFinished?: boolean}} [opts]
 *   jobId           dedup: a job with the same id already waiting or running is not added again
 *   replaceFinished with a jobId, a finished job holding that id is removed first, so a
 *                   recurring job id does not block the next run
 * @returns {Promise<import("bullmq").Job>}
 */
async function enqueue(name, jobName, data = {}, opts = {}) {
  const { replaceFinished = false, ...jobOpts } = opts;
  const queue = getQueue(name);
  const ctx = requestContext.get();
  const payload =
    ctx && (ctx.requestId || ctx.userId)
      ? {
          ...data,
          __ctx: {
            request_id: ctx.requestId || null,
            user_id: ctx.userId || null,
          },
        }
      : data;

  if (replaceFinished && jobOpts.jobId) {
    const existing = await queue.getJob(jobOpts.jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "completed" || state === "failed") await existing.remove();
    }
  }

  return queue.add(jobName, payload, { ...DEFAULTS, ...jobOpts });
}

/** Close every queue this process opened (shutdown, tests). The shared Redis client stays open. */
async function closeQueues() {
  const open = [...queues.values()];
  queues.clear();
  await Promise.allSettled(open.map((q) => q.close()));
}

module.exports = { enqueue, getQueue, closeQueues, DEFAULTS };
