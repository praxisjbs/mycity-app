"use strict";
/**
 * The rules a request's dates and length must meet, as pure functions, so they are
 * tested without a database (leave.test.js) and read the same for the employee's own
 * request and for leave People record.
 *
 *  - Both days fall in one calendar year: a year's allowance is counted per year, so a
 *    request over New Year is two requests.
 *  - The length is the working days between them, both included, on the configured
 *    week with public holidays left out (shared/time/working-week.js). A span with no
 *    working day in it is refused.
 *  - A type with an allowance is refused when the request would take the year past it,
 *    counting what is already granted and what is still waiting.
 */
const { AppError } = require("../../shared/errors");
const workingWeek = require("../../shared/time/working-week");

/** The working days a span takes, or a refusal saying which field is wrong. */
function daysOf(startsOn, endsOn, calendar) {
  if (endsOn < startsOn)
    throw new AppError("LEAVE_ENDS_BEFORE_START", "The last day is before the first", 422, {
      ends_on: ["Ends before it starts"],
    });
  if (startsOn.slice(0, 4) !== endsOn.slice(0, 4))
    throw new AppError("LEAVE_SPANS_YEARS", "Split leave over New Year into two requests", 422, {
      ends_on: ["Ends in another year"],
    });
  const days = workingWeek.countWorkingDays(startsOn, endsOn, calendar);
  if (days < 1)
    throw new AppError("LEAVE_NO_WORKING_DAYS", "Those days are not working days", 422, {
      starts_on: ["No working days"],
    });
  return days;
}

/**
 * Refuse a request the year's allowance cannot hold.
 * @param {{entitled: number|null, remaining: number|null, name: string}|undefined} balance
 * @param {number} days
 * @param {boolean} [own]  the person asking for themselves; People recording it read "they"
 */
function assertWithinAllowance(balance, days, own = true) {
  if (!balance || balance.entitled === null || balance.remaining === null) return;
  if (days > balance.remaining)
    throw new AppError(
      "LEAVE_ALLOWANCE_EXCEEDED",
      `Only ${Math.max(balance.remaining, 0)} ${balance.name} days are left this year`,
      422,
      { ends_on: [own ? "More than you have left" : "More than they have left"] },
    );
}

module.exports = { daysOf, assertWithinAllowance };
