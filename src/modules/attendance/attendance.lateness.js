"use strict";
/**
 * Lateness, early departure and overtime, in whole minutes. Pure, no database
 * (docs/guides/attendance.md §6.4; TB's decisions of 20/10/2026, T2, T5).
 *
 *   minutesLate      once the first clock-in is past the start plus grace, the minutes from the
 *                    START: grace 5, in at 09:12, is 12 minutes late; within grace, 0 (T2)
 *   minutesEarly     once the person's own last clock-out is before the end less the early grace,
 *                    the minutes to the END: early grace 5, out at 16:50, is 10 minutes early (T5)
 *   minutesOvertime  once the last clock-out is past the end by more than `afterMinutes`, every
 *                    minute from the END: after 30, out at 17:45, is 45 minutes; out at 17:20, none
 *
 * Times are read on the work date's wall clock at the workplace (attendance.rules.minutesIntoDay),
 * so a Lagos 09:20 is 09:20 whatever the server's timezone, and a clock-out after midnight counts
 * past the end of the day instead of before its start. No expected time (a day off) or no punch: 0.
 * What a day's minutes cost is attendance.pay.js's.
 */
const { minutesIntoDay, parseHHMM } = require("./attendance.rules");

/** Minutes between the punch and the expected time on the day's wall clock, or null. */
function offsetOf(expected, instant, date, timeZone) {
  const target = parseHHMM(expected);
  if (target === null || !instant) return null;
  const at = minutesIntoDay(instant, date, timeZone);
  return at === null ? null : at - target;
}

/**
 * @param {{expectedStart: string|null, firstClockInAt: Date|string|null, graceMinutes?: number,
 *          date: string, timeZone: string}} a
 */
function minutesLate({ expectedStart, firstClockInAt, graceMinutes = 0, date, timeZone }) {
  const after = offsetOf(expectedStart, firstClockInAt, date, timeZone);
  if (after === null) return 0;
  return after > Number(graceMinutes || 0) ? after : 0;
}

/**
 * @param {{expectedEnd: string|null, lastClockOutAt: Date|string|null, graceMinutes?: number,
 *          date: string, timeZone: string}} a
 */
function minutesEarly({ expectedEnd, lastClockOutAt, graceMinutes = 0, date, timeZone }) {
  const after = offsetOf(expectedEnd, lastClockOutAt, date, timeZone);
  if (after === null) return 0;
  const before = -after;
  return before > Number(graceMinutes || 0) ? before : 0;
}

/**
 * @param {{expectedEnd: string|null, lastClockOutAt: Date|string|null, afterMinutes?: number,
 *          date: string, timeZone: string}} a
 */
function minutesOvertime({ expectedEnd, lastClockOutAt, afterMinutes = 0, date, timeZone }) {
  const after = offsetOf(expectedEnd, lastClockOutAt, date, timeZone);
  if (after === null) return 0;
  return after > 0 && after > Number(afterMinutes || 0) ? after : 0;
}

module.exports = { minutesLate, minutesEarly, minutesOvertime };
