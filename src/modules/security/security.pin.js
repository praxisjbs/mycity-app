"use strict";
/**
 * The PIN's rules on wrong tries (docs/guides/identity.md §6). Pure: the service
 * counts in the database and asks these what follows.
 *
 * Four digits are 10,000 codes, so a wrong PIN is counted like a wrong password and
 * then some:
 *
 *  - the same doubling wait as the password (identity.throttle.js): the first 5
 *    cost nothing, then 2, 4, 8 ... seconds, at most 15 minutes, counted from the
 *    last wrong try. Never a lockout of the account;
 *  - 10 wrong in a row switch the PIN off. The password still works, and the
 *    person sets a new PIN; nothing needs an administrator;
 *  - 20 wrong in any 30 days switch it off too. The right PIN ends a run but not
 *    the 30 days, so someone who keeps under ten while the owner's own sign-ins
 *    reset the run still runs out, at twenty guesses a month.
 *
 * Ten tries at 10,000 codes, with the common shapes refused when it is set
 * (security contract, weakPinReason), is about a one in a thousand chance.
 */
const throttle = require("../identity/identity.throttle");

const OFF_IN_A_ROW = 10;
const OFF_IN_WINDOW = 20;
const WINDOW_DAYS = 30;

/** Seconds before this person may try the PIN again; 0 when they need not wait. */
function waitSeconds(row, now = Date.now()) {
  return throttle.waitSeconds(
    { failed_login_count: row && row.pin_failed_count, last_failed_login_at: row && row.pin_last_failed_at },
    now,
  );
}

/** After a wrong try counted to these totals, is the PIN switched off? */
const switchesOff = ({ pin_failed_count, pin_window_failures }) =>
  Number(pin_failed_count) >= OFF_IN_A_ROW || Number(pin_window_failures) >= OFF_IN_WINDOW;

/** Wrong tries left before it switches off, the nearer of the two limits. */
const triesLeft = ({ pin_failed_count, pin_window_failures }) =>
  Math.max(0, Math.min(OFF_IN_A_ROW - Number(pin_failed_count), OFF_IN_WINDOW - Number(pin_window_failures)));

module.exports = {
  OFF_IN_A_ROW,
  OFF_IN_WINDOW,
  WINDOW_DAYS,
  FIRST_THROTTLED: throttle.FIRST_THROTTLED,
  waitSeconds,
  switchesOff,
  triesLeft,
  sayWait: throttle.sayWait,
};
