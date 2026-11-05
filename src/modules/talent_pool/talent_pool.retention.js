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

async function purge() {
  let removed = 0;
  for (const { talent_pool_entry_id: id } of await repo.expired(pool)) {
    const client = await pool.connect();
    try {
      await atomically(client, async () => {
        const row = await repo.get(client, id, { lock: true });
        if (!row || new Date(row.expires_at) > new Date()) return;
        await repo.remove(client, id, REASON);
        await emit(client, {
          key: EVENTS.TALENT_POOL_EXPIRED,
          entity: { type: "talent_pool_entry", id },
          actor: null,
          payload: { talent_pool_entry_id: id, candidate_id: row.candidate_id },
        });
        removed += 1;
      });
    } catch (err) {
      logger.warn({ err: err.code || err.message, talent_pool_entry_id: id }, "talent-pool-purge: an entry could not be ended");
    } finally {
      client.release();
    }
  }
  return { removed };
}

module.exports = { purge, REASON };
