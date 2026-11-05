"use strict";
/**
 * The pool's 24 months (docs/guides/recruitment.md §6.9): talent-pool-purge takes off everyone whose
 * time has ended, one transaction each, so one that cannot be ended stops nobody else. Nothing is
 * deleted: the entry stays, removed, with why (data retention: guide §13).
 */
const { pool } = require("../../config/db");
const { logger } = require("../../config/logger");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const repo = require("./talent_pool.repo");
const { EVENTS } = require("./talent_pool.events");

const REASON = "Kept 24 months";

/** How long one run may keep going, batch after batch, before it leaves the rest to tomorrow. */
const BUDGET_MS = 5 * 60_000;

async function purge() {
  let removed = 0;
  const until = Date.now() + BUDGET_MS;
  for (;;) {
    const batch = await repo.expired(pool);
    const before = removed;
    await purgeBatch(batch, () => {
      removed += 1;
    });
    // Caught up, or nothing could be ended this time (each failure is logged), or out of time.
    if (batch.length < 200 || removed === before || Date.now() > until) break;
  }
  return { removed };
}

async function purgeBatch(batch, done) {
  for (const { talent_pool_entry_id: id } of batch) {
    const client = await pool.connect();
    try {
      await atomically(client, async () => {
        const row = await repo.lockLive(client, id);
        if (!row || new Date(row.expires_at) > new Date()) return;
        await repo.remove(client, id, REASON);
        await emit(client, {
          key: EVENTS.TALENT_POOL_EXPIRED,
          entity: { type: "talent_pool_entry", id },
          actor: null,
          payload: { talent_pool_entry_id: id, candidate_id: row.candidate_id },
        });
        done();
      });
    } catch (err) {
      logger.warn({ err: err.code || err.message, talent_pool_entry_id: id }, "talent-pool-purge: an entry could not be ended");
    } finally {
      client.release();
    }
  }
}

module.exports = { purge, REASON };
