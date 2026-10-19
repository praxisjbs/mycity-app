"use strict";
/**
 * Who is in front of the app right now: an app of theirs is on screen and was touched in
 * the last few minutes. The page says so on its socket (`presence:active` when it comes to
 * the front and every 30 seconds while it stays there and is used, `presence:idle` when it
 * goes behind or is left alone); the API keeps one Redis hash per person
 * (`<prefix>:active:<user_id>`: field the socket's id, value when its word runs out).
 *
 * The worker asks isActive() before sending a push: someone looking at the app sees the
 * banner there, and the push to their devices waits a minute (docs/guides/notifications.md
 * §6, TB 19/10/2026). Best effort like all realtime: without Redis nobody is active, so
 * pushes go at once.
 *
 * Every word also stamps when the person was last in front of the app
 * (`<prefix>:active-at:<user_id>`, kept for three days). The attendance clock watch reads it
 * through activity() to clock out a shift left open at the time the person stopped using the
 * app (docs/guides/attendance.md §6.14). activity() says `known: false` when Redis cannot
 * answer, so a caller that must not guess (an automatic clock-out) does nothing then.
 */
const { tryClient, rkey } = require("../../config/redis");
const { logger } = require("../../config/logger");

/** How long one word lasts; the page repeats it every 30 seconds. */
const WINDOW_MS = 75_000;
/** A socket's words closer together than this are ignored. */
const MIN_GAP_MS = 10_000;
/** How long the last moment in front of the app is kept. */
const LAST_KEPT_MS = 3 * 24 * 60 * 60_000;

const keyOf = (userId) => rkey("active", userId);
const lastKeyOf = (userId) => rkey("active-at", userId);

async function markActive(userId, socketId, now = Date.now()) {
  const r = tryClient();
  if (!r) return false;
  try {
    const key = keyOf(userId);
    await r
      .multi()
      .hset(key, socketId, String(now + WINDOW_MS))
      .pexpire(key, WINDOW_MS)
      .set(lastKeyOf(userId), String(now), "PX", LAST_KEPT_MS)
      .exec();
    return true;
  } catch (err) {
    logger.warn({ err: err.message, user_id: userId }, "active presence not recorded");
    return false;
  }
}

async function markIdle(userId, socketId) {
  const r = tryClient();
  if (!r) return false;
  try {
    await r.hdel(keyOf(userId), socketId);
    return true;
  } catch (err) {
    logger.warn({ err: err.message, user_id: userId }, "active presence not cleared");
    return false;
  }
}

/** Is any app of this person on screen and in use? False when Redis cannot say. */
async function isActive(userId, now = Date.now()) {
  const r = tryClient();
  if (!r) return false;
  try {
    const values = await r.hvals(keyOf(userId));
    return values.some((v) => Number(v) > now);
  } catch (err) {
    logger.warn({ err: err.message, user_id: userId }, "active presence not read");
    return false;
  }
}

/**
 * Whether a person is in front of the app now, on any of their logins, and the last moment any
 * of them was.
 * @param {string[]} userIds  the person's logins
 * @returns {Promise<{known: boolean, active: boolean, last_active_at: Date|null}>}  known is
 *          false when Redis cannot answer; then active is false and last_active_at null
 */
async function activity(userIds, now = Date.now()) {
  const unknown = { known: false, active: false, last_active_at: null };
  const r = tryClient();
  if (!r) return unknown;
  try {
    let active = false;
    let last = null;
    for (const userId of userIds) {
      const values = await r.hvals(keyOf(userId));
      if (values.some((v) => Number(v) > now)) active = true;
      const at = Number(await r.get(lastKeyOf(userId)));
      if (Number.isFinite(at) && at > 0 && (last === null || at > last)) last = at;
    }
    return { known: true, active, last_active_at: last === null ? null : new Date(last) };
  } catch (err) {
    logger.warn({ err: err.message }, "active presence not read");
    return unknown;
  }
}

/** Listen to one socket's words (realtime/socket.js, on connect). */
function track(socket, userId) {
  let last = 0;
  socket.on("presence:active", () => {
    const now = Date.now();
    if (now - last < MIN_GAP_MS) return;
    last = now;
    markActive(userId, socket.id, now);
  });
  socket.on("presence:idle", () => {
    last = 0;
    markIdle(userId, socket.id);
  });
  socket.on("disconnect", () => markIdle(userId, socket.id));
}

module.exports = { markActive, markIdle, isActive, activity, track, WINDOW_MS };
