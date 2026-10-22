"use strict";
/**
 * Quarters and their months (docs/guides/performance.md §6.2). Pure: no database, no clock.
 *
 * A quarter starts on the first day of January, April, July or October and holds three months.
 * Its name is "Q4 2026". Each month is reviewed in a round that opens on the first business day
 * of the month after; the round's deadlines are business days of that month, from the quarter's
 * rules (`due_business_days`): staff check in by the 2nd, heads by the 3rd, reviewers by the 5th,
 * the second level by the 7th, HR closes by the 10th (G3). A deadline is the end of that day in
 * Lagos. So October 2026's round opens on 2 November and its check-ins are due on 3 November.
 */
const lagos = require("../../shared/time/lagos");
const ww = require("../../shared/time/working-week");
const { DEFAULT_RULES } = require("@mycity/contract").scoring;

/** "Q4 2026" for a quarter starting 2026-10-01. */
function quarterName(startsOn) {
  const month = Number(startsOn.slice(5, 7));
  return `Q${Math.floor((month - 1) / 3) + 1} ${startsOn.slice(0, 4)}`;
}

/** The quarter's last day: three months on, less a day. */
const quarterEnd = (startsOn) => lagos.addDays(lagos.addMonths(startsOn, 3), -1);

/** The first day of each of the quarter's three months. */
const monthsOf = (startsOn) => [0, 1, 2].map((n) => lagos.addMonths(startsOn, n));

/** The plan year a quarter belongs to: the calendar year it starts in. */
const planYearOf = (startsOn) => `${startsOn.slice(0, 4)}-01-01`;

/** "2026-11" for the month after 2026-10-01. */
const nextMonthKey = (month) => lagos.addMonths(month, 1).slice(0, 7);

/**
 * The deadlines of a month's round, from the quarter's rules and the calendar.
 * @param {string} month  the month reviewed, its first day ("2026-10-01")
 * @param {object} rules  ScoringRules (the quarter's own)
 * @param {object} cal    shared/time/working-week calendar (its holidays)
 * @returns {{opens_on: string, check_in_due_on: string, head_check_in_due_on: string,
 *            review_due_on: string, second_level_due_on: string, close_due_on: string}}
 */
function roundDates(month, rules, cal) {
  const due = (rules || DEFAULT_RULES).due_business_days;
  const key = nextMonthKey(month);
  const nth = (n) => ww.nthBusinessDay(key, n, cal);
  return {
    opens_on: nth(1),
    check_in_due_on: nth(due.check_in),
    head_check_in_due_on: nth(due.head_check_in),
    review_due_on: nth(due.review),
    second_level_due_on: nth(due.second_level),
    close_due_on: nth(due.close),
  };
}

/** The month's round name: "October 2026". */
function roundName(month) {
  const names = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${names[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** The commitments and function report deadline for a month: its n-th business day (§6.11). */
const commitmentsDueOn = (month, rules, cal) =>
  ww.nthBusinessDay(month.slice(0, 7), (rules || DEFAULT_RULES).due_business_days.commitments, cal);

module.exports = {
  quarterName,
  quarterEnd,
  monthsOf,
  planYearOf,
  roundDates,
  roundName,
  commitmentsDueOn,
};
