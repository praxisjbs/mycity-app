"use strict";
/**
 * The outbox dispatcher (SYSTEM_ARCHITECTURE §6): every second, run the handlers of
 * committed events (shared/events/outbox.js).
 *
 * In-process, in every worker, rather than a BullMQ tick: it is due every second, and the
 * claim already uses FOR UPDATE SKIP LOCKED, so two workers share the rows instead of
 * running one twice. A burst is drained in up to ten claims per tick.
 *
 * Once a day it also deletes finished outbox rows older than 30 days (the event itself
 * stays in event_log), under the cron lock so only one worker does it.
 */
const { defineSchedule } = require("../registry");
const { withCronLock } = require("../cron-lock");
const outbox = require("../../shared/events/outbox");

const CLAIM = 50;
const MAX_CLAIMS_PER_TICK = 10;
const PRUNE_EVERY_MS = 24 * 60 * 60 * 1000;
const KEEP_DAYS = 30;

let lastPrune = 0;

async function run() {
  const total = { claimed: 0, done: 0, retry: 0, failed: 0 };
  for (let i = 0; i < MAX_CLAIMS_PER_TICK; i += 1) {
    const r = await outbox.dispatchDue({ limit: CLAIM });
    for (const k of Object.keys(total)) total[k] += r[k];
    if (r.claimed < CLAIM) break;
  }
  if (Date.now() - lastPrune >= PRUNE_EVERY_MS) {
    lastPrune = Date.now();
    const pruned = await withCronLock("outbox-prune", () =>
      outbox.prune(require("../../config/db").pool, { days: KEEP_DAYS }),
    );
    if (pruned) total.pruned = pruned;
  }
  return total;
}

module.exports = defineSchedule({
  name: "outbox-dispatch",
  every: 1000,
  inProcess: true,
  summary: "Runs the follow-on work of committed changes",
  run,
});
