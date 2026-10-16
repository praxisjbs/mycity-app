"use strict";
/**
 * Socket.io for the staff app: the bell today, chat and presence from M1
 * (SYSTEM_ARCHITECTURE §1, §6). Attached to the API's HTTP server by server.js.
 *
 * What it does, and nothing more:
 *
 *  - Staff host only. A handshake on the public host (go.) is refused, as the HTTP host
 *    guard refuses /socket.io there; on a server, a host that is neither is refused too.
 *    CORS allows STAFF_ORIGIN only.
 *  - The same sign-in check as an HTTP request (middleware/auth.js): an access token
 *    (handshake `auth.token`, or an Authorization header), an active user who is an
 *    employee, and a live session (Redis index, then user_session).
 *  - On connect the socket joins `user:<user_id>` and `session:<session_id>`, from the
 *    verified token. The client cannot join or leave rooms; it only listens.
 *  - When the access token expires the socket is closed, so the client reconnects with
 *    a fresh token and the session is checked again. Ending a session closes its
 *    sockets at once (services/realtime/emitter.endSession).
 *  - The Redis adapter, on connections of its own, carries an emit from any API process
 *    or the worker to the process holding the socket. Its channel key carries the
 *    environment prefix, because Redis pub/sub is shared across databases.
 *
 * Messages are small (64 KB cap): anything larger goes over HTTP.
 */
const { config, isServer } = require("../config/env");
const { logger } = require("../config/logger");
const { pool } = require("../config/db");
const { createConnection } = require("../config/redis");
const { verifyAccessToken, sessionLive } = require("../middleware/auth");
const grantsCache = require("../shared/rbac/grants-cache");
const metrics = require("../shared/observability/metrics");
const { originsFor } = require("../http/routes");
const { sites } = require("../http/static");
const emitter = require("../services/realtime/emitter");

const MAX_MESSAGE_BYTES = 64 * 1024;

let io = null;

/** Allow the handshake only on the staff host (any host when one host serves both, locally). */
function hostAllowed(req, s = sites()) {
  const host = String((req.headers && req.headers.host) || "")
    .toLowerCase()
    .replace(/:\d+$/, "");
  if (!s.split) return true;
  if (host === s.staff.host) return true;
  if (host === s.public.host) return false;
  return !isServer;
}

function refuse(code) {
  const err = new Error(code);
  err.data = { code };
  metrics.inc(
    "mycity_socket_refused_total",
    { reason: code },
    1,
    "Socket handshakes refused, by reason.",
  );
  return err;
}

function tokenOf(socket) {
  const auth = socket.handshake.auth || {};
  if (typeof auth.token === "string" && auth.token) return auth.token;
  const header = String(
    (socket.handshake.headers && socket.handshake.headers.authorization) || "",
  );
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

/** io.use(): who is connecting. */
async function authenticate(socket, next) {
  try {
    const token = tokenOf(socket);
    if (!token) return next(refuse("AUTH_REQUIRED"));
    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (err) {
      return next(
        refuse(
          err && err.name === "TokenExpiredError"
            ? "TOKEN_EXPIRED"
            : "INVALID_TOKEN",
        ),
      );
    }
    const user = await grantsCache.getAuthUser(pool, payload.sub);
    if (!user || user.status !== "active") return next(refuse("USER_INACTIVE"));
    if (!payload.sid || !(await sessionLive(pool, payload.sid)))
      return next(refuse("SESSION_ENDED"));
    socket.data.user = {
      user_id: user.user_id,
      employee_id: user.employee_id,
      session_id: payload.sid,
    };
    socket.data.expires_at = payload.exp * 1000;
    return next();
  } catch (err) {
    logger.error({ err }, "socket sign-in check failed");
    return next(refuse("AUTH_FAILED"));
  }
}

function onConnection(socket) {
  const { user_id: userId, session_id: sessionId } = socket.data.user;
  socket.join(emitter.ROOMS.user(userId));
  socket.join(emitter.ROOMS.session(sessionId));
  metrics.inc(
    "mycity_socket_connections_total",
    {},
    1,
    "Socket connections accepted.",
  );

  // Close at token expiry; the client reconnects with a fresh token.
  const ms = Math.max(0, socket.data.expires_at - Date.now());
  const timer = setTimeout(() => socket.disconnect(true), ms);
  if (timer.unref) timer.unref();
  socket.on("disconnect", () => clearTimeout(timer));
}

/**
 * Engine.IO answers every /socket.io request itself, ahead of the app. A request from a host
 * that may not use realtime (the public site) goes back to the app instead, so the host guard
 * answers it with the same JSON 404 as any other wrong-host path (docs/runbooks/proxy.md §5);
 * an upgrade from such a host is refused with a 404 and closed.
 */
function routeByHost(httpServer, appListeners, allowed) {
  const engineRequest = httpServer.listeners("request").slice();
  httpServer.removeAllListeners("request");
  httpServer.on("request", (req, res) => {
    for (const listener of allowed(req) ? engineRequest : appListeners) listener.call(httpServer, req, res);
  });
  const engineUpgrade = httpServer.listeners("upgrade").slice();
  httpServer.removeAllListeners("upgrade");
  httpServer.on("upgrade", (req, socket, head) => {
    if (allowed(req)) {
      for (const listener of engineUpgrade) listener.call(httpServer, req, socket, head);
      return;
    }
    socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  });
}

/**
 * Attach Socket.io to the API's HTTP server.
 * @param {import("node:http").Server} httpServer
 * @param {{sites?: object}} [opts]  the hosts to tell apart (tests); the configured ones otherwise
 * @returns {import("socket.io").Server}
 */
function attach(httpServer, opts = {}) {
  if (io) return io;
  const { Server } = require("socket.io");
  const { createAdapter } = require("@socket.io/redis-adapter");
  const allowed = (req) => hostAllowed(req, opts.sites || sites());
  const appListeners = httpServer.listeners("request").slice();
  io = new Server(httpServer, {
    path: "/socket.io",
    serveClient: false,
    cors: { origin: originsFor(config.STAFF_ORIGIN), credentials: true },
    maxHttpBufferSize: MAX_MESSAGE_BYTES,
    allowRequest: (req, cb) => {
      const ok = allowed(req);
      cb(ok ? null : "WRONG_HOST", ok);
    },
  });
  routeByHost(httpServer, appListeners, allowed);
  io.adapter(
    createAdapter(
      createConnection("realtime:pub"),
      createConnection("realtime:sub"),
      { key: emitter.CHANNEL_KEY },
    ),
  );
  io.use(authenticate);
  io.on("connection", onConnection);
  emitter.useServer(io);
  logger.info("realtime ready");
  return io;
}

function isAttached() {
  return io !== null;
}

/**
 * Close every socket and stop accepting. Socket.io also closes the HTTP server it is
 * attached to; the promise settles when that has finished.
 */
function close() {
  if (!io) return Promise.resolve();
  const server = io;
  io = null;
  emitter.reset();
  return new Promise((resolve) => server.close(() => resolve()));
}

module.exports = {
  attach,
  close,
  isAttached,
  authenticate,
  hostAllowed,
  MAX_MESSAGE_BYTES,
};
