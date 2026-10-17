"use strict";
/**
 * Lateness and overtime, in whole minutes. Pure, no database
 * (docs/guides/attendance.md §6.4).
 *
 *   minutesLate     (first clock-in) - (expected start + grace), floored at 0
 *   minutesOvertime (last clock-out) - (expected end), floored at 0
 *
 * Grace is subtracted, so a person who arrives inside it is not late and one who
 * arrives after it is late by the minutes past it: the figure a deduction tier is
 * later read against (M6), never money here. Times are read on the work date's
 * wall clock at the workplace (attendance.rules.minutesIntoDay), so a Lagos 09:20 is
 * 09:20 whatever the server's timezone, and a clock-out after midnight counts past
 * the end of the day instead of before its start.
 *
 * No expected start (a day off) or no punch: 0. A day's money (the daily rate over
 * the month's working days, the tiered deduction) is payroll's, in M6.
 */
const { minutesIntoDay, parseHHMM } = require("./attendance.rules");

/**
 * @param {{expectedStart: string|null, firstClockInAt: Date|string|null, graceMinutes?: number,
 *          date: string, timeZone: string}} a
 */
function minutesLate({ expectedStart, firstClockInAt, graceMinutes = 0, date, timeZone }) {
  const start = parseHHMM(expectedStart);
  if (start === null || !firstClockInAt) return 0;
  const at = minutesIntoDay(firstClockInAt, date, timeZone);
  if (at === null) return 0;
  const over = at - (start + Number(graceMinutes || 0));
  return over > 0 ? over : 0;
}

/**
 * @param {{expectedEnd: string|null, lastClockOutAt: Date|string|null, date: string, timeZone: string}} a
 */
function minutesOvertime({ expectedEnd, lastClockOutAt, date, timeZone }) {
  const end = parseHHMM(expectedEnd);
  if (end === null || !lastClockOutAt) return 0;
  const at = minutesIntoDay(lastClockOutAt, date, timeZone);
  if (at === null) return 0;
  const over = at - end;
  return over > 0 ? over : 0;
}

module.exports = { minutesLate, minutesOvertime };
