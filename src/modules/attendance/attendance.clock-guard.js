"use strict";
/**
 * The clock transition guard: may this person clock in, or out, on this work date?
 * Pure and deterministic; the service runs it inside the transaction, after the
 * person's lock, on the events it has just read (docs/guides/attendance.md §6.2).
 *
 * One shift a day: one clock-in, then one clock-out. An event counts when it was accepted or
 * is waiting for review (ACTIVE) and no decision excluded it: a punch under review is a real
 * punch, and a person whose clock-in is being reviewed must still be able to clock out. A
 * REJECTED attempt never counts, so it cannot leave someone clocked in or block the next try;
 * nor does a punch People rejected (`excluded`), which frees its slot: after a rejected
 * clock-in the person clocks in again, after a rejected clock-out they clock out again.
 *
 *   clock_in   no clock-in that counts         allowed
 *              a clock-in, no out              ALREADY_CLOCKED_IN
 *              a clock-out (with or without    SHIFT_DONE: a clock-out still counts after
 *              the clock-in that preceded it)  its clock-in was rejected, and the day is done
 *   clock_out  no clock-in that counts         NOT_CLOCKED_IN
 *              a clock-out that counts         ALREADY_CLOCKED_OUT
 *              a clock-in, no out              allowed
 *
 * The database backstops it: a unique index allows one event of each type that counts per
 * person per work date (a punch People rejected keeps its row but frees its place), so two
 * transactions that both passed this check cannot both write (the second gets the same refusal).
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

/** The events that count: active, and not excluded by a decision. */
const counting = (events) => (Array.isArray(events) ? events : []).filter((e) => ACTIVE.has(e.validation_state) && !e.excluded);

/**
 * @param {{events: Array<{event_type: string, validation_state: string, excluded?: boolean}>, eventType: string}} args
 *        the work date's events (any state, `excluded` when a decision took one out) and the punch asked for
 * @returns {{allowed: boolean, reason: string|null, message: string|null}}
 */
function evaluateClockTransition({ events, eventType }) {
  const active = counting(events);
  const hasIn = active.some((e) => e.event_type === "clock_in");
  const hasOut = active.some((e) => e.event_type === "clock_out");

  if (eventType === "clock_in") {
    if (hasOut) return refuse("SHIFT_DONE");
    if (hasIn) return refuse("ALREADY_CLOCKED_IN");
    return { allowed: true, reason: null, message: null };
  }
  if (eventType === "clock_out") {
    if (!hasIn) return refuse("NOT_CLOCKED_IN");
    if (hasOut) return refuse("ALREADY_CLOCKED_OUT");
    return { allowed: true, reason: null, message: null };
  }
  return refuse("INVALID_EVENT_TYPE");
}

/** Is a shift open on these events: a clock-in that counts and no clock-out that counts? */
function isOpen(events) {
  const r = evaluateClockTransition({ events, eventType: "clock_out" });
  return r.allowed;
}

module.exports = { evaluateClockTransition, isOpen, MESSAGES, ACTIVE };
