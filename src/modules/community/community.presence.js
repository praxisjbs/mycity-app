"use strict";
/**
 * Presence for Staff Community: who is online and when someone was last seen
 * (community.md §3 step 8, the dot on a conversation and "Last seen" in its header).
 *
 * While a person has the app open, their socket touches community_presence on connect,
 * every 30 seconds and on disconnect. Online means a touch inside the last 90 seconds
 * (community.repo.js ONLINE), so a server that dies with sockets open lets them fall
 * offline by themselves, and several API processes need no shared counter.
 */
const { logger } = require("../../config/logger");

const BEAT_MS = 30_000;

/** Start beating for one socket; returns the function that stops it. */
function track(socket, userId, touch = require("./community.service").touchPresence) {
  const beat = () =>
    Promise.resolve(touch(userId)).catch((err) => logger.warn({ err, user_id: userId }, "presence touch failed"));
  beat();
  const timer = setInterval(beat, BEAT_MS);
  if (timer.unref) timer.unref();
  socket.on("disconnect", () => {
    clearInterval(timer);
    beat();
  });
  return () => clearInterval(timer);
}

module.exports = { BEAT_MS, track };
