"use strict";
/**
 * The one way to open a transaction.
 *
 *   const client = await pool.connect();
 *   try {
 *     const thing = await atomically(client, async () => {
 *       const row = await repo.insert(client, data);
 *       await emit(client, "things.created", { ... });   // same transaction
 *       return row;
 *     });
 *   } finally {
 *     client.release();
 *   }
 *
 * Why it exists:
 *
 *  - Postgres has no nested transactions. A second BEGIN is a warning and a
 *    no-op, and the inner COMMIT then commits the OUTER work early while its
 *    caller still believes it can roll back. One owner of the boundary keeps a
 *    depth counter, so a nested atomically() joins the outer transaction and
 *    the outermost caller decides.
 *  - A connection already inside someone else's BEGIN is detected with a
 *    SAVEPOINT probe (legal only inside a transaction) and joined, not committed.
 *  - A failed ROLLBACK never hides the error that caused it.
 *  - The depth is always cleared, because a pooled client is reused by the
 *    next request and a stale depth would make it skip its own BEGIN.
 */

/** A Symbol, not a string key: pooled clients are long-lived and shared. */
const DEPTH = Symbol.for("mycity.tx.depth");

async function inForeignTransaction(client) {
  try {
    await client.query("SAVEPOINT mycity_tx_probe");
    await client.query("RELEASE SAVEPOINT mycity_tx_probe");
    return true;
  } catch {
    // 25P01: SAVEPOINT outside a transaction block. Not in one.
    return false;
  }
}

/**
 * Run `fn` atomically on `client`. Nested calls join the outer transaction.
 *
 * @template T
 * @param {{query: Function}} client
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function atomically(client, fn) {
  const depth = client[DEPTH] || 0;

  if (depth > 0) {
    client[DEPTH] = depth + 1;
    try {
      return await fn();
    } finally {
      client[DEPTH] = depth;
    }
  }

  if (await inForeignTransaction(client)) {
    client[DEPTH] = 1;
    try {
      return await fn();
    } finally {
      client[DEPTH] = 0;
    }
  }

  await client.query("BEGIN");
  client[DEPTH] = 1;
  try {
    const out = await fn();
    await client.query("COMMIT");
    return out;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* the connection is gone; the original error is the useful one */
    }
    throw err;
  } finally {
    client[DEPTH] = 0;
  }
}

/** True when `client` is inside a transaction opened through atomically(). */
function inTransaction(client) {
  return Boolean(client && client[DEPTH] > 0);
}

module.exports = { atomically, inTransaction, DEPTH };
