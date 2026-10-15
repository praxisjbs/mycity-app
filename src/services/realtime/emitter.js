"use strict";
/**
 * Telling a connected browser something happened, from any process
 * (SYSTEM_ARCHITECTURE §6: realtime is best effort; everything that changes state goes
 * through the outbox first).
 *
 *   const realtime = require("../../services/realtime/emitter");
 *   realtime.toUser(userId, "notification", { notification_id, title, ... });
 *
 * Who calls it: outbox handlers and jobs in the worker (the notification bell), never a
 * controller (BACKEND_GUIDE §4). In the API process the Socket.io server is used
 * directly (realtime/socket.js hands it over); in the worker, which has no server, the
 * message is published through Redis on the channel the API's adapter listens to, so
 * it reaches the socket on whichever API process holds it.
 *
 * Rooms, joined by the server on connect from the verified token, never chosen by the
 * client:
 *   user:<user_id>        everything addressed to one person
 *   session:<session_id>  one signed-in session, so ending a session closes its sockets
 *   channel:<id>          a conversation (M1 community)
 *
 * Environments: Redis pub/sub channels are shared across the server's databases, so the
 * channel key carries the environment prefix (mycity:<env>:socket.io). A staging worker
 * cannot reach a production browser.
 *
 * Every call is best effort: it returns false and logs when Redis is unavailable, and
 * never throws into the caller's work.
 */
const { logger } = require("../../config/logger");
const { createConnection, REDIS_PREFIX } = require("../../config/redis");

/** The pub/sub key shared by the adapter (API) and this emitter (worker). */
const CHANNEL_KEY = `${REDIS_PREFIX}:socket.io`;
const EVENT_RE = /^[a-z][a-z0-9_.:-]{0,63}$/;

const ROOMS = Object.freeze({
  user: (userId) => `user:${userId}`,
  session: (sessionId) => `session:${sessionId}`,
  channel: (channelId) => `channel:${channelId}`,
});

let server = null;
let redisEmitter = null;

/** realtime/socket.js registers the live server of the API process. */
function useServer(io) {
  server = io;
}

function broadcaster() {
  if (server) return server;
  if (!redisEmitter) {
    const { Emitter } = require("@socket.io/redis-emitter");
    redisEmitter = new Emitter(createConnection("realtime:emitter"), {
      key: CHANNEL_KEY,
    });
  }
  return redisEmitter;
}

function send(room, event, payload) {
  if (!EVENT_RE.test(String(event)))
    throw new Error(`realtime: "${event}" is not an event name`);
  try {
    broadcaster().to(room).emit(event, payload);
    return true;
  } catch (err) {
    logger.warn({ err, room, event }, "realtime: not delivered");
    return false;
  }
}

/** Push to every socket of one user. */
function toUser(userId, event, payload) {
  return send(ROOMS.user(userId), event, payload);
}

/** Push to a conversation's room. */
function toChannel(channelId, event, payload) {
  return send(ROOMS.channel(channelId), event, payload);
}

/** Close the sockets of an ended session (sign-out, session killed). */
function endSession(sessionId) {
  try {
    broadcaster().in(ROOMS.session(sessionId)).disconnectSockets(true);
    return true;
  } catch (err) {
    logger.warn(
      { err, session_id: sessionId },
      "realtime: could not close the session's sockets",
    );
    return false;
  }
}

/** Forget the server and the emitter (shutdown, tests). Redis connections close with closeRedis(). */
function reset() {
  server = null;
  redisEmitter = null;
}

module.exports = {
  ROOMS,
  CHANNEL_KEY,
  useServer,
  toUser,
  toChannel,
  endSession,
  reset,
};
