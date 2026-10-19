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
 */
const { tryClient, rkey } = require("../../config/redis");
const { logger } = require("../../config/logger");

/** How long one word lasts; the page repeats it every 30 seconds. */
const WINDOW_MS = 75_000;
/** A socket's words closer together than this are ignored. */
const MIN_GAP_MS = 10_000;

const keyOf = (userId) => rkey("active", userId);

async function markActive(userId, socketId, now = Date.now()) {
  const r = tryClient();
  if (!r) return false;
  try {
    const key = keyOf(userId);
    await r.multi().hset(key, socketId, String(now + WINDOW_MS)).pexpire(key, WINDOW_MS).exec();
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

module.exports = { markActive, markIdle, isActive, track, WINDOW_MS };
