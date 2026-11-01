"use strict";
/**
 * The summary cache (docs/guides/praxis-ai.md §6.13; the handoff's decision 14): a summary read asked
 * again with the same key, the same parameters and the same scope within a minute is served from Redis
 * instead of the database. A summary is a handful of figures, so a question that reads it twice (the
 * model paging, a Try Again, the Overview redrawn) costs one scan.
 *
 *   const result = await summaryCache.cached(actor, "attendance.summary", params, scope, () => run());
 *
 * Never across people: the key carries the asking person's login and the scope they hold, so a
 * manager's figures are never handed to someone else, and a grant that changed gives a new key.
 * Without Redis (unit tests, a laptop in describe mode) every call runs the summary.
 */
const crypto = require("node:crypto");
const { tryClient, rkey } = require("../../config/redis");

/** How long a summary's figures are kept. */
const TTL_S = 60;

/** Parameters in one order, so the same summary asked with its keys in another order is the same. */
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

/**
 * The cache key of one summary for one person.
 * @param {{user_id: string}} actor
 * @param {string} key      the summary key ("attendance.summary")
 * @param {object} params   the parsed parameters
 * @param {{scope: string, scope_ids: string[]|null}} scope  the scope the person's grant gives
 */
function keyOf(actor, key, params, scope) {
  const ids = Array.isArray(scope && scope.scope_ids) ? [...scope.scope_ids].sort() : null;
  const digest = crypto
    .createHash("sha256")
    .update(stable({ key, params: params || {}, scope: scope ? scope.scope : null, ids }))
    .digest("hex")
    .slice(0, 32);
  return rkey("ai", "summary", actor.user_id, digest);
}

/**
 * The summary's result from the cache, else from `load()`, kept TTL_S seconds.
 * @param {{user_id: string}} actor
 * @param {string} key
 * @param {object} params
 * @param {{scope: string, scope_ids: string[]|null}} scope
 * @param {() => Promise<object>} load   runs the summary
 * @param {{redis?: object|null, ttl?: number}} [opts]   tests hand a client in
 * @returns {Promise<{result: object, cached: boolean}>}
 */
async function cached(actor, key, params, scope, load, { redis = tryClient(), ttl = TTL_S } = {}) {
  const k = redis && actor && actor.user_id ? keyOf(actor, key, params, scope) : null;
  if (k) {
    const hit = await redis.get(k).catch(() => null);
    if (hit) {
      try {
        return { result: JSON.parse(hit), cached: true };
      } catch {
        /* an entry that will not parse is computed again below */
      }
    }
  }
  const result = await load();
  if (k && result !== undefined) await redis.set(k, JSON.stringify(result), "EX", ttl).catch(() => {});
  return { result, cached: false };
}

module.exports = { TTL_S, keyOf, cached, stable };
