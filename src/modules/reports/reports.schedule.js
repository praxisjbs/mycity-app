"use strict";
/**
 * When a report's schedule fires (docs/guides/home.md §6 Reports): its recurrence rule
 * (src/shared/time/recurrence.js, never cron) counted from `starts_on`, each day it gives
 * fired at `run_time` in Lagos. `working_days_only` keeps a daily rule to the days the
 * working week works and moves a weekly or monthly day that is not worked to the next one
 * that is, as the rule's own engine does; a monthly rule on the 31st, or on the last day
 * (-1), fires on each month's last day.
 *
 *   nextSlot(schedule, after, calendar)   the first slot strictly after `after`, or null
 *   problems(rule)                        what is wrong with a rule, for the form
 *
 * Pure: the working week arrives as a calendar (shared/time/working-week loadCalendar), so
 * the same answer is reached in the request that saves a schedule, in the job that fires
 * it, and in a test.
 */
const lagos = require("../../shared/time/lagos");
const recurrence = require("../../shared/time/recurrence");

/** "18:00:00" or "18:00" → "18:00". */
const hhmm = (time) => String(time).slice(0, 5);

/**
 * The first slot of a schedule strictly after an instant.
 * @param {{recurrence: object, starts_on: string, run_time: string}} schedule
 *   recurrence  a rule recurrence.js accepts; starts_on  YYYY-MM-DD; run_time  HH:MM in Lagos
 * @param {Date} after
 * @param {import("../../shared/time/working-week").Calendar} calendar
 * @returns {Date|null}  null once the rule has no further day (a rule with an end)
 */
function nextSlot(schedule, after, calendar) {
  const { recurrence: rule, starts_on: startsOn } = schedule;
  const time = hhmm(schedule.run_time);
  const today = lagos.today(after);
  const from = today > startsOn ? today : startsOn;
  // The first day on or after `from`: nextAfter looks strictly after the day before it.
  let day = recurrence.nextAfter(rule, startsOn, lagos.addDays(from, -1), { calendar });
  while (day && lagos.instant(day, time) <= after) day = recurrence.nextAfter(rule, startsOn, day, { calendar });
  return day ? lagos.instant(day, time) : null;
}

/** What is wrong with a rule, in the shared rule's own words; empty when it is sound. */
const problems = (rule) => recurrence.validateRule(rule);

module.exports = { nextSlot, problems, hhmm };
