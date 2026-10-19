"use strict";
/**
 * When a task is due, and when a repeating task comes round again
 * (docs/guides/workspace.md §6). Pure: a calendar in, dates out.
 *
 * A task is due at the end of a working day: that day's closing time from the working
 * week (17:00 Monday to Friday, 15:00 on Saturday at MyCity, A22), in Africa/Lagos.
 *
 * Cadence (A24). A task set Daily is due at the end of the day it is set, or of the next
 * working day when today is not one; Weekly, at the end of the last working day of that
 * week (Monday to Sunday).
 *
 * Repeats. The contract allows exactly three rules (packages/contract/schemas/tasks.js
 * Recurrence), so nothing here guesses at a rule it does not know:
 *   daily                     the next working day
 *   weekly, days [1..6]       the next of those weekdays that is a working day
 *   monthly, day_of_month     that day of the next month, moved to the next working day
 * Each step is counted from the occurrence before it, never from today, so a series
 * keeps its days whenever the sweep runs. (workingWeek.nextWorkingDay returns the day
 * itself when it is worked, so a step starts from the day after.)
 */
const lagos = require("../../shared/time/lagos");
const workingWeek = require("../../shared/time/working-week");

const FALLBACK_CLOSE = "17:00";

/** The closing time of a working day, "HH:MM". */
function closeOf(date, cal) {
  const h = cal.hours && cal.hours[lagos.weekday(date)];
  return (h && h.ends_at) || FALLBACK_CLOSE;
}

/** The instant a task due on `date` is due: that day's close, Lagos time. */
function dueInstant(date, cal) {
  return lagos.instant(date, closeOf(date, cal));
}

/** The working day a Daily task set on `today` is for: today, or the next one worked. */
function dailyDay(today, cal) {
  return workingWeek.nextWorkingDay(today, cal);
}

/**
 * The last working day of the week (Monday to Sunday) that holds `today`; when none is
 * left this week (a Sunday), the last working day of next week.
 */
function weeklyDay(today, cal, depth = 0) {
  const monday = lagos.addDays(today, 1 - lagos.weekday(today));
  for (let i = 6; i >= 0; i -= 1) {
    const d = lagos.addDays(monday, i);
    if (d >= today && workingWeek.isWorkingDay(d, cal)) return d;
  }
  if (depth > 8) return workingWeek.nextWorkingDay(today, cal);
  return weeklyDay(lagos.addDays(monday, 7), cal, depth + 1);
}

/**
 * The due instant for a new task: the day given, else its cadence's day, else none.
 * @param {{due_on?: string, cadence?: string}} task
 * @returns {Date|null}
 */
function dueFor({ due_on: dueOn, cadence }, today, cal) {
  if (dueOn) return dueInstant(dueOn, cal);
  if (cadence === "daily") return dueInstant(dailyDay(today, cal), cal);
  if (cadence === "weekly") return dueInstant(weeklyDay(today, cal), cal);
  return null;
}

/**
 * The day the next occurrence is due, after the occurrence due on `lastDay`.
 * @param {{freq: string, days?: number[], day_of_month?: number}} rule
 * @param {string} lastDay  YYYY-MM-DD, an occurrence of the series
 */
function nextDay(rule, lastDay, cal) {
  if (rule.freq === "daily") return workingWeek.nextWorkingDay(lagos.addDays(lastDay, 1), cal);
  if (rule.freq === "weekly") {
    const days = new Set(rule.days);
    let d = lastDay;
    for (let i = 0; i < 60; i += 1) {
      d = lagos.addDays(d, 1);
      if (days.has(lagos.weekday(d)) && workingWeek.isWorkingDay(d, cal)) return d;
    }
    return workingWeek.nextWorkingDay(lagos.addDays(lastDay, 1), cal);
  }
  if (rule.freq === "monthly") {
    const next = lagos.addMonths(`${lastDay.slice(0, 7)}-01`, 1);
    const day = `${next.slice(0, 7)}-${String(rule.day_of_month).padStart(2, "0")}`;
    return workingWeek.isWorkingDay(day, cal) ? day : workingWeek.nextWorkingDay(day, cal);
  }
  throw new Error(`recurrence: unknown freq "${rule.freq}"`);
}

module.exports = { closeOf, dueInstant, dailyDay, weeklyDay, dueFor, nextDay };
