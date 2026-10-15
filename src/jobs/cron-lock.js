"use strict";
/**
 * One run at a time for a named scheduled job, across every process that shares the
 * database (SYSTEM_ARCHITECTURE §7).
 *
 * BullMQ already starts each scheduled tick once. What it does not prevent is a tick
 * that is still running when the next one starts (a slow reconcile, two worker
 * processes during a restart overlap), and two runs of the same sweep at once mean
 * double reminders and double escalations. So every scheduler runs inside
 * withCronLock(name, fn): whichever process takes the lock runs the tick, the others
 * skip it quietly.
 *
 *   const { withCronLock } = require("../cron-lock");
 *   await withCronLock("workflow-timeout", () => workflow.sweepTimeouts());
 *
 * How:
 *  - pg_try_advisory_lock on a pooled connection: never waits, so a process that
 *    loses skips the tick instead of queueing behind it.
 *  - Session-level, not transaction-level, so `fn` is not one long transaction; it
 *    opens its own transactions on other connections. The lock's connection sits idle
 *    for the length of the run: one pool slot per running scheduler.
 *  - A process that dies mid-run drops its connection, and Postgres releases the lock.
 *  - If the unlock itself fails (a broken connection), the connection is destroyed, not
 *    returned to the pool, so a held lock can never travel with a reused connection.
 *
 * The lock is per database, and each environment has its own database, so staging and
 * production never contend.
 */
const { logger } = require("../config/logger");

/**
 * Run `fn` only if this process takes the lock for `name`.
 * @template T
 * @param {string} name  the scheduler's stable name ("workflow-timeout")
 * @param {() => Promise<T>} fn
 * @param {{db?: import("pg").Pool}} [opts]
 * @returns {Promise<T|undefined>} fn's result, or undefined when another process holds the lock
 */
async function withCronLock(
  name,
  fn,
  { db = require("../config/db").pool } = {},
) {
  const key = `mycity:cron:${name}`;
  const client = await db.connect();
  let destroyed = false;
  try {
    const { rows } = await client.query(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
      [key],
    );
    if (!rows[0].acquired) {
      logger.debug(
        { cron: name },
        "cron lock held elsewhere; skipping this tick",
      );
      return undefined;
    }
    try {
      return await fn();
    } finally {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]);
      } catch (unlockErr) {
        destroyed = true;
        client.release(unlockErr);
        logger.warn(
          { cron: name, err: unlockErr.message },
          "cron unlock failed; connection destroyed so the lock goes with it",
        );
      }
    }
  } finally {
    if (!destroyed) client.release();
  }
}

module.exports = { withCronLock };
