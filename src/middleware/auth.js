"use strict";
/**
 * Who is calling. Runs on every staff route (http/route.js puts it there; a
 * route opts out only with `anonymous: true`, which only sign-in uses).
 *
 *   Authorization: Bearer <access token>
 *
 * On success:
 *
 *   req.user = { user_id, employee_id, email, display_name, role_ids, is_ceo, session_id }
 *
 * and the request context carries the user id, so every log line and audit row
 * names the actor.
 *
 * Rules, each of which closes a real hole:
 *
 *  - The token must be an ACCESS token (`typ: "access"`). Refresh tokens are
 *    signed with a different secret here as well, but the type check stays.
 *  - The user is re-read (30-second cache), so a deactivated user is out within
 *    30 seconds even with a valid token. "No login without an employee" holds:
 *    the read joins employee, so a login whose employee row is gone is refused.
 *  - Session revocation is checked on every request: the session index in Redis
 *    first, Postgres (user_session.killed_at) when Redis does not know. Ending a
 *    session works on the next request, not after the token's 15 minutes.
 *  - If BOTH Redis and Postgres are unreachable for the revocation check, the
 *    request is allowed and the failure logged and counted. Refusing would turn
 *    a cache outage into signing everyone out; the window is 15 minutes at most.
 */
const jwt = require("jsonwebtoken");
const { config } = require("../config/env");
const { logger } = require("../config/logger");
const { pool } = require("../config/db");
const requestContext = require("../config/request-context");
const { AppError } = require("../shared/errors");
const grantsCache = require("../shared/rbac/grants-cache");
const sessions = require("../shared/rbac/sessions");
const metrics = require("../shared/observability/metrics");

const ACCESS_TYP = "access";

function denied(reason, code, message) {
  metrics.inc("mycity_auth_failures_total", { reason }, 1, "Authentication failures by reason.");
  return new AppError(code, message, 401);
}

/**
 * Verify an access token without touching the database. Also used by the rate
 * limiter and idempotency to key by user before the route runs.
 * @param {string} token
 * @returns {{sub: string, sid?: string, typ: string, iat: number, exp: number}}  throws on any failure
 */
function verifyAccessToken(token) {
  const payload = jwt.verify(token, config.JWT_ACCESS_SECRET, { algorithms: ["HS256"] });
  if (payload.typ !== ACCESS_TYP) throw new Error("not an access token");
  return payload;
}

/** The bearer token from the request, or null. */
function bearerOf(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

/** The verified user id behind the request's token, or null. Never throws. */
function userIdFromRequest(req) {
  const token = bearerOf(req);
  if (!token) return null;
  try {
    return verifyAccessToken(token).sub || null;
  } catch {
    return null;
  }
}

async function sessionLive(db, sid) {
  const indexed = await sessions.isSessionActive(sid);
  if (indexed === true) return true;
  try {
    const { rows } = await db.query("SELECT killed_at, expires_at FROM user_session WHERE session_id = $1", [sid]);
    // A sid is only ever minted with its user_session row, so no row means gone.
    if (!rows[0]) return false;
    return rows[0].killed_at === null && new Date(rows[0].expires_at) > new Date();
  } catch (err) {
    metrics.inc("mycity_auth_failures_total", { reason: "session_check_unavailable" }, 1,
      "Authentication failures by reason.");
    logger.error({ err, sid }, "session revocation check unavailable; allowing the request");
    return true;
  }
}

async function auth(req, _res, next) {
  const token = bearerOf(req);
  if (!token) throw denied("missing", "AUTH_REQUIRED", "Sign in to continue");

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    if (err && err.name === "TokenExpiredError") throw denied("expired", "TOKEN_EXPIRED", "Your session has expired");
    throw denied("invalid", "INVALID_TOKEN", "Sign in to continue");
  }

  const user = await grantsCache.getAuthUser(pool, payload.sub);
  if (!user || user.status !== "active") {
    logger.warn({ sub: payload.sub, reason: user ? user.status : "not_found" }, "authentication refused");
    throw denied("inactive", "USER_INACTIVE", "This account is not active");
  }

  if (!payload.sid || !(await sessionLive(pool, payload.sid))) {
    logger.warn({ sub: payload.sub, sid: payload.sid || null }, "authentication refused: session ended");
    throw denied("session_ended", "SESSION_ENDED", "This session has ended. Sign in again.");
  }

  req.user = {
    user_id: user.user_id,
    employee_id: user.employee_id,
    email: user.email,
    display_name: user.display_name,
    role_ids: user.role_ids || [],
    is_ceo: user.is_ceo === true,
    session_id: payload.sid,
  };
  requestContext.set({ userId: user.user_id });
  return next();
}

module.exports = { auth, verifyAccessToken, bearerOf, userIdFromRequest, ACCESS_TYP };
