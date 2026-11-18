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
 *  - A request needs a relief officer and a handover note when its type says every request,
 *    or when its working days are more than the type's number (docs/guides/ess.md §6).
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
 * Refuse a request the year's allowance cannot hold. The Last Day's mark gives both figures,
 * the working days asked for and the days left ("32 working days, 19 left"), in the form's
 * four words, so the person sees by how much to shorten it. It reads the same whoever asks.
 * @param {{entitled: number|null, remaining: number|null, name: string}|undefined} balance
 * @param {number} days
 */
function assertWithinAllowance(balance, days) {
  if (!balance || balance.entitled === null || balance.remaining === null) return;
  if (days > balance.remaining) {
    const left = Math.max(balance.remaining, 0);
    throw new AppError(
      "LEAVE_ALLOWANCE_EXCEEDED",
      `Only ${left} ${balance.name} ${left === 1 ? "day is" : "days are"} left this year`,
      422,
      { ends_on: [`${days} working ${days === 1 ? "day" : "days"}, ${left} left`] },
    );
  }
}

/**
 * Whether a request of `type` that takes `days` working days needs a relief officer and a
 * handover note: the type asks on every request, or the request is longer than its number.
 * @param {{handover_every_request?: boolean, handover_over_days?: number|null}} type
 * @param {number} days
 */
function needsCover(type, days) {
  if (!type) return false;
  if (type.handover_every_request === true) return true;
  const over = type.handover_over_days;
  return over !== null && over !== undefined && days > Number(over);
}

/**
 * Refuse a request that needs cover and lacks it, each missing field marked on itself, both at
 * once so the person fills them together. A request that needs none passes whatever it carries.
 */
function assertCover(type, days, body) {
  if (!needsCover(type, days)) return;
  const fields = {};
  if (!body.relief_employee_id) fields.relief_employee_id = ["Required"];
  if (!body.handover_document_id) fields.handover_document_id = ["Required"];
  if (Object.keys(fields).length)
    throw new AppError("LEAVE_COVER_NEEDED", "This leave needs a relief officer and a handover note", 422, fields);
}

module.exports = { daysOf, assertWithinAllowance, needsCover, assertCover };
