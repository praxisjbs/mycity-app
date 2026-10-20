"use strict";
/**
 * Skip until reset (docs/guides/integrations.md §1.2 decision 7): once a provider says its quota
 * or rate limit is used up, every request goes straight past it until the time it gave, then
 * back to it on its own. Kept in Redis so the API and the worker skip the same provider; without
 * Redis each process keeps its own.
 *
 *   await skips.mark("groq", 3_600_000, "OVER_QUOTA");   // for an hour, as Groq's retry-after said
 *   await skips.until("groq");                           // → Date, or null when it may be asked
 */
const { tryClient, rkey } = require("../../config/redis");

/** When a provider refuses for quota without saying how long: try it again after this. */
const DEFAULT_MS = 60_000;
/** Never longer than a day: a wrong header must not switch a provider off for good. */
const MAX_MS = 24 * 3_600_000;

const memory = new Map();
const keyOf = (provider) => rkey("ai", "skip", provider);

/**
 * Skip `provider` for `ms` (the vendor's retry-after), or DEFAULT_MS when it did not say.
 * @param {string} provider
 * @param {number|null} ms
 * @param {string} [reason]
 * @returns {Promise<Date>} until when
 */
async function mark(provider, ms, reason = "OVER_QUOTA") {
  const wait = Math.min(MAX_MS, Math.max(1000, Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_MS));
  const at = new Date(Date.now() + wait);
  memory.set(provider, { at, reason });
  const redis = tryClient();
  if (redis) {
    try {
      await redis.set(keyOf(provider), JSON.stringify({ at: at.toISOString(), reason }), "PX", wait);
    } catch {
      /* this process still skips it */
    }
  }
  return at;
}

/**
 * Until when `provider` is skipped, or null.
 * @param {string} provider
 */
async function until(provider) {
  const redis = tryClient();
  if (redis) {
    try {
      const raw = await redis.get(keyOf(provider));
      if (raw) {
        const at = new Date(JSON.parse(raw).at);
        if (at.getTime() > Date.now()) return at;
      }
      return null;
    } catch {
      /* fall back to what this process knows */
    }
  }
  const m = memory.get(provider);
  if (m && m.at.getTime() > Date.now()) return m.at;
  memory.delete(provider);
  return null;
}

/** Tests, and a key replaced on the page: ask the provider again at once. */
async function clear(provider) {
  memory.delete(provider);
  const redis = tryClient();
  if (redis) await redis.del(keyOf(provider)).catch(() => undefined);
}

module.exports = { mark, until, clear, DEFAULT_MS, MAX_MS };
