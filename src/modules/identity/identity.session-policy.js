"use strict";
/**
 * How long a session lives, and how long each token it issues may live.
 *
 * THE RULE. A session lives SESSION_MAX_AGE_MIN (default 120) minutes from sign-in,
 * and not a second longer, whatever the person is doing. Then the screen locks and
 * whoever is at it proves who they are again. In a product full of approvals and
 * pay, a person who walks away from an open tab must not leave a working session
 * for whoever sits down next.
 *
 * Enforced on the server, in two places, so a client that ignores its own timer
 * still cannot outlive the session:
 *
 *   1. refresh refuses a session past its age, or idle past SESSION_INACTIVITY_MIN
 *      (default 30) minutes, and ends it;
 *   2. every token is minted with its expiry capped at the session's end: an access
 *      token issued five minutes before the end lives five minutes, not fifteen.
 *
 * There is no "keep me signed in". A long-lived session is exactly the
 * unattended-desk hole the lock closes; unlocking costs one password.
 *
 * Times are relative seconds on the wire (session_expires_in), never a timestamp:
 * a laptop whose clock is five minutes out would otherwise lock five minutes early,
 * or late.
 */
const { config } = require("../../config/env");

/** The session's full length, in seconds. */
function maxAgeSeconds() {
  return Math.max(60, Number(config.SESSION_MAX_AGE_MIN) * 60);
}

/** How long a session may go without a refresh, in seconds. */
function idleSeconds() {
  return Math.max(60, Number(config.SESSION_INACTIVITY_MIN) * 60);
}

/**
 * Seconds a session of this age has left, never negative. An unknown age (a value
 * that is not a number) counts as a brand-new session, so a missing value can never
 * become a mass sign-out.
 * @param {number|string|null} ageSeconds
 */
function remainingSeconds(ageSeconds) {
  const age = Number(ageSeconds);
  if (ageSeconds === null || !Number.isFinite(age) || age < 0)
    return maxAgeSeconds();
  return Math.max(0, Math.floor(maxAgeSeconds() - age));
}

/** Access token life: its own limit (ACCESS_TOKEN_MIN), or what is left of the session if shorter. */
function accessTtlFor(remaining) {
  return Math.max(
    1,
    Math.min(Number(config.ACCESS_TOKEN_MIN) * 60, Math.floor(remaining)),
  );
}

/** Refresh token life: exactly what is left of the session. */
function refreshTtlFor(remaining) {
  return Math.max(1, Math.floor(remaining));
}

/** What the client needs to lock on time. */
function clock(remaining) {
  return {
    expires_in: accessTtlFor(remaining),
    session_expires_in: Math.max(0, Math.floor(remaining)),
    session_max_age: maxAgeSeconds(),
    session_idle_limit: idleSeconds(),
  };
}

/**
 * Why a session that is being refreshed has to end, or null when it may go on.
 * The ceiling is checked first: a session at its limit is over however busy it is.
 * @param {{age_seconds: number|string, idle_seconds: number|string}} s
 * @returns {"session_max_age"|"inactivity_timeout"|null}
 */
function endReason(s) {
  if (remainingSeconds(s.age_seconds) <= 0) return "session_max_age";
  const idle = Number(s.idle_seconds);
  if (Number.isFinite(idle) && idle > idleSeconds()) return "inactivity_timeout";
  return null;
}

module.exports = {
  maxAgeSeconds,
  idleSeconds,
  remainingSeconds,
  accessTtlFor,
  refreshTtlFor,
  clock,
  endReason,
};
