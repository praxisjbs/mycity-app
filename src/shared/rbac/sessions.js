"use strict";
/**
 * Fast index of live sign-in sessions, so "end this session" takes effect on
 * the caller's NEXT request, not when their access token expires
 * (SYSTEM_ARCHITECTURE §8).
 *
 *   identity service, on sign-in:   await sessions.indexSession(session_id, { userId, expiresAt })
 *   identity service, on sign-out:  await sessions.removeSession(session_id, userId)
 *   middleware/auth.js, every call: await sessions.isSessionActive(sid)   → true | false | null
 *
 * `user_session` in Postgres is the record (killed_at); this index is a cache in
 * front of it. So the answer is three-valued, and the difference matters:
 *
 *   true   indexed, live
 *   false  Redis answered and the session is not there: ASK POSTGRES, do not reject.
 *          A Redis restart empties the index while every session in it is valid;
 *          reading "absent" as "revoked" would sign everyone out.
 *   null   Redis unreachable: ask Postgres.
 */
const { tryClient, rkey } = require("../../config/redis");

const sessionKey = (sid) => rkey("session", sid);
const userKey = (userId) => rkey("session", "user", userId);

/** Seconds until `expiresAt`, never below a minute. */
function ttlFor(expiresAt) {
  const s = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000);
  return Number.isFinite(s) ? Math.max(s, 60) : 60;
}

/**
 * @param {string} sessionId
 * @param {{userId: string, expiresAt: Date|string}} meta  expiresAt is the refresh token's expiry
 */
async function indexSession(sessionId, { userId, expiresAt }) {
  const redis = tryClient();
  if (!redis) return;
  const ttl = ttlFor(expiresAt);
  await Promise.allSettled([
    redis.set(sessionKey(sessionId), userId, "EX", ttl),
    redis.sadd(userKey(userId), sessionId),
    redis.expire(userKey(userId), ttl),
  ]);
}

/** @returns {Promise<true|false|null>} see the header */
async function isSessionActive(sessionId) {
  const redis = tryClient();
  if (!redis || !sessionId) return null;
  try {
    return (await redis.exists(sessionKey(sessionId))) === 1;
  } catch {
    return null;
  }
}

async function removeSession(sessionId, userId) {
  const redis = tryClient();
  if (!redis) return;
  await Promise.allSettled([
    redis.del(sessionKey(sessionId)),
    userId ? redis.srem(userKey(userId), sessionId) : Promise.resolve(),
  ]);
}

/** Ids of the user's indexed sessions, or null when Redis is unreachable (read user_session instead). */
async function listSessionIds(userId) {
  const redis = tryClient();
  if (!redis) return null;
  return redis.smembers(userKey(userId)).catch(() => null);
}

/** Every session of a user: on deactivation, password change, or "sign out everywhere". */
async function removeAllSessions(userId) {
  const ids = (await listSessionIds(userId)) || [];
  await Promise.allSettled(ids.map((sid) => removeSession(sid, userId)));
  const redis = tryClient();
  if (redis) await redis.del(userKey(userId)).catch(() => {});
}

module.exports = {
  indexSession,
  isSessionActive,
  removeSession,
  listSessionIds,
  removeAllSessions,
};
