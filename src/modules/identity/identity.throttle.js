"use strict";
/**
 * The wait after repeated wrong passwords on one account: a decaying cooldown, not
 * a lockout.
 *
 * A lockout is a lever for anyone: knowing a colleague's email is enough to lock
 * them out by failing on purpose, and if unlocking needs an administrator, one
 * person can take out a team before lunch. So nothing here ever latches:
 *
 *  - the first 5 failures cost nothing; an ordinary mistyped password is unaffected;
 *  - after that the wait doubles with each failure (6th 2 s, 7th 4 s, 8th 8 s ...),
 *    capped at 15 minutes, counted from the last failure, so it expires on its own;
 *  - a successful sign-in clears it. Nothing needs an administrator.
 *
 * The per-address limit (10 failures in 15 minutes, middleware/rate-limit.js) stops
 * one machine hammering; this stops a spread-out attack on one account, which a
 * per-address limit cannot see. Suspending an account is the deliberate lock, and is
 * a person's decision (Settings, Users).
 */

const FREE_ATTEMPTS = 5;
const MAX_WAIT_SECONDS = 15 * 60;

/**
 * Seconds this account must wait before another attempt; 0 when it need not.
 * @param {{failed_login_count?: number, last_failed_login_at?: Date|string|null}} user
 * @param {number} [now]  ms, for tests
 */
function waitSeconds(user, now = Date.now()) {
  const failures = Number(user && user.failed_login_count) || 0;
  if (failures <= FREE_ATTEMPTS || !user.last_failed_login_at) return 0;
  const required = Math.min(2 ** (failures - FREE_ATTEMPTS), MAX_WAIT_SECONDS);
  const elapsed = (now - new Date(user.last_failed_login_at).getTime()) / 1000;
  const remaining = Math.ceil(required - elapsed);
  return remaining > 0 ? remaining : 0;
}

/** "2 seconds", "3 minutes": how a wait is said to a person. */
function sayWait(secondsLeft) {
  if (secondsLeft < 60)
    return `${secondsLeft} second${secondsLeft === 1 ? "" : "s"}`;
  const minutes = Math.ceil(secondsLeft / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** The failure count at which the waiting starts, and the person is told. */
const FIRST_THROTTLED = FREE_ATTEMPTS + 1;

module.exports = {
  waitSeconds,
  sayWait,
  FREE_ATTEMPTS,
  FIRST_THROTTLED,
  MAX_WAIT_SECONDS,
};
