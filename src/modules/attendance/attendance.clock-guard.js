"use strict";
/**
 * The clock transition guard: may this person clock in, or out, on this work date?
 * Pure and deterministic; the service runs it inside the transaction, after the
 * person's lock, on the events it has just read (docs/guides/attendance.md §6.2).
 *
 * One shift a day: one clock-in, then one clock-out. An event counts as ACTIVE when it
 * was accepted or is waiting for review: a punch under review is a real punch, and a
 * person whose clock-in is being reviewed must still be able to clock out. A REJECTED
 * attempt never counts, so it cannot leave someone clocked in or block the next try.
 *
 *   clock_in   no active clock-in              allowed
 *              an active clock-in, no out      ALREADY_CLOCKED_IN
 *              an active clock-in and out      SHIFT_DONE
 *   clock_out  no active clock-in              NOT_CLOCKED_IN
 *              an active clock-out             ALREADY_CLOCKED_OUT
 *              an active clock-in, no out      allowed
 *
 * The database backstops it: a unique index allows one active event of each type per
 * person per work date, so two transactions that both passed this check cannot both
 * write (the second gets the same refusal).
 */
const ACTIVE = new Set(["accepted", "review"]);

const MESSAGES = Object.freeze({
  ALREADY_CLOCKED_IN: "You are already clocked in.",
  SHIFT_DONE: "You have clocked out for today.",
  NOT_CLOCKED_IN: "You have not clocked in yet.",
  ALREADY_CLOCKED_OUT: "You have already clocked out.",
  INVALID_EVENT_TYPE: "That is not a clock action.",
});

const refuse = (reason) => ({ allowed: false, reason, message: MESSAGES[reason] });

/**
 * @param {{events: Array<{event_type: string, validation_state: string}>, eventType: string}} args
 *        the work date's events (any state) and the punch asked for
 * @returns {{allowed: boolean, reason: string|null, message: string|null}}
 */
function evaluateClockTransition({ events, eventType }) {
  const active = (Array.isArray(events) ? events : []).filter((e) => ACTIVE.has(e.validation_state));
  const hasIn = active.some((e) => e.event_type === "clock_in");
  const hasOut = active.some((e) => e.event_type === "clock_out");

  if (eventType === "clock_in") {
    if (hasIn) return refuse(hasOut ? "SHIFT_DONE" : "ALREADY_CLOCKED_IN");
    return { allowed: true, reason: null, message: null };
  }
  if (eventType === "clock_out") {
    if (!hasIn) return refuse("NOT_CLOCKED_IN");
    if (hasOut) return refuse("ALREADY_CLOCKED_OUT");
    return { allowed: true, reason: null, message: null };
  }
  return refuse("INVALID_EVENT_TYPE");
}

/** Is a shift open on these events: an active clock-in and no active clock-out? */
function isOpen(events) {
  const r = evaluateClockTransition({ events, eventType: "clock_out" });
  return r.allowed;
}

module.exports = { evaluateClockTransition, isOpen, MESSAGES, ACTIVE };
