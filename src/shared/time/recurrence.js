"use strict";
/**
 * Repeating dates: recurring tasks (M2), reminders, scheduled reports, review
 * cycles. One small rule shape, stored as jsonb on whatever repeats:
 *
 *   { freq: "weekly", interval: 1, by_weekday: [1, 3] }            Mondays and Wednesdays
 *   { freq: "monthly", interval: 1, by_month_day: 25 }               the 25th (or the month's last day)
 *   { freq: "monthly", interval: 1, by_month_day: -1 }               the last day of the month
 *   { freq: "daily", interval: 1, working_days_only: true }         every working day
 *   { freq: "yearly", interval: 1, until: "2028-12-31" }             the start date, every year
 *   { freq: "weekly", interval: 2, count: 6 }                        fortnightly, six times
 *
 *   occurrences(rule, "2026-10-14", { from, to, calendar })   → ["2026-10-14", ...]  (at most 400)
 *   nextAfter(rule, "2026-10-14", "2026-11-02", { calendar }) → "2026-11-04" or null
 *
 * Dates are Lagos business dates (YYYY-MM-DD); the time of day, when a thing
 * has one, is stored next to the rule. A rule is validated with validateRule()
 * before it is saved, so a bad rule fails on the form, not in the scheduler.
 *
 * Deliberately not RRULE: the product needs these six shapes, and a rule a
 * person can read in the database is worth more than coverage of shapes nobody
 * uses. ICS invites (services/calendar) translate these to RRULE when sending.
 */
const {
  assertDate,
  addDays,
  addMonths,
  weekday,
  daysBetween,
} = require("./lagos");
const { isWorkingDay, nextWorkingDay } = require("./working-week");

const FREQS = ["daily", "weekly", "monthly", "yearly"];
const MAX_OCCURRENCES = 400;
const MAX_ITERATIONS = 20_000;

/**
 * @returns {string[]} problems, empty when the rule is valid
 */
function validateRule(rule) {
  const p = [];
  if (!rule || typeof rule !== "object") return ["rule must be an object"];
  if (!FREQS.includes(rule.freq))
    p.push(`freq must be one of ${FREQS.join(", ")}`);
  const interval = rule.interval === undefined ? 1 : rule.interval;
  if (!Number.isInteger(interval) || interval < 1 || interval > 366)
    p.push("interval must be a whole number from 1 to 366");
  if (rule.by_weekday !== undefined) {
    if (rule.freq !== "weekly") p.push("by_weekday is for weekly rules");
    if (
      !Array.isArray(rule.by_weekday) ||
      !rule.by_weekday.length ||
      rule.by_weekday.some((d) => !Number.isInteger(d) || d < 1 || d > 7)
    ) {
      p.push("by_weekday must list weekdays 1 (Monday) to 7 (Sunday)");
    }
  }
  if (rule.by_month_day !== undefined) {
    if (rule.freq !== "monthly") p.push("by_month_day is for monthly rules");
    const d = rule.by_month_day;
    if (!Number.isInteger(d) || d === 0 || d < -1 || d > 31)
      p.push("by_month_day must be 1 to 31, or -1 for the last day");
  }
  if (rule.until !== undefined && rule.count !== undefined)
    p.push("give until or count, not both");
  if (rule.until !== undefined) {
    try {
      assertDate(rule.until, "until");
    } catch (e) {
      p.push(e.message);
    }
  }
  if (
    rule.count !== undefined &&
    (!Number.isInteger(rule.count) ||
      rule.count < 1 ||
      rule.count > MAX_OCCURRENCES)
  ) {
    p.push(`count must be 1 to ${MAX_OCCURRENCES}`);
  }
  return p;
}

function assertRule(rule) {
  const p = validateRule(rule);
  if (p.length) throw new TypeError(`recurrence: ${p.join("; ")}`);
}

function monthDay(firstOfMonth, byMonthDay) {
  const last = +addDays(addMonths(firstOfMonth, 1), -1).slice(8, 10);
  const day = byMonthDay === -1 ? last : Math.min(byMonthDay, last);
  return `${firstOfMonth.slice(0, 8)}${String(day).padStart(2, "0")}`;
}

/** The raw candidate dates, in order, before working-day adjustment. Generator. */
function* candidates(rule, start) {
  const interval = rule.interval || 1;
  if (rule.freq === "daily") {
    for (let d = start; ; d = addDays(d, interval)) yield d;
  }
  if (rule.freq === "weekly") {
    const days = (rule.by_weekday &&
      [...rule.by_weekday].sort((a, b) => a - b)) || [weekday(start)];
    const monday = addDays(start, 1 - weekday(start));
    for (let w = monday; ; w = addDays(w, 7 * interval)) {
      for (const d of days) {
        const date = addDays(w, d - 1);
        if (date >= start) yield date;
      }
    }
  }
  if (rule.freq === "monthly") {
    const dom =
      rule.by_month_day === undefined ? +start.slice(8, 10) : rule.by_month_day;
    const first = `${start.slice(0, 8)}01`;
    for (let k = 0; ; k += interval) {
      const date = monthDay(addMonths(first, k), dom);
      if (date >= start) yield date;
    }
  }
  if (rule.freq === "yearly") {
    for (let k = 0; ; k += interval) yield addMonths(start, 12 * k);
  }
}

/**
 * Occurrences of `rule` starting at `start`, within [from, to].
 * @param {object} rule
 * @param {string} start   YYYY-MM-DD, the first possible occurrence
 * @param {{from?: string, to: string, calendar?: object}} window  calendar needed for working_days_only
 * @returns {string[]}
 */
function occurrences(rule, start, { from, to, calendar } = {}) {
  assertRule(rule);
  assertDate(start, "start");
  assertDate(to, "to");
  const lower = from ? assertDate(from, "from") : start;
  if (rule.working_days_only && !calendar)
    throw new TypeError("recurrence: working_days_only needs a calendar");

  const out = [];
  let produced = 0;
  let iterations = 0;
  let previous = null;
  for (const raw of candidates(rule, start)) {
    iterations += 1;
    if (iterations > MAX_ITERATIONS) break;
    if (rule.until && raw > rule.until) break;
    if (rule.count && produced >= rule.count) break;
    if (raw > to && (!rule.working_days_only || daysBetween(to, raw) > 14))
      break;

    let date = raw;
    if (rule.working_days_only) {
      if (rule.freq === "daily") {
        if (!isWorkingDay(raw, calendar)) continue;
      } else {
        date = nextWorkingDay(raw, calendar);
      }
    }
    if (date === previous) continue;
    previous = date;
    produced += 1;
    if (date > to) break;
    if (date >= lower) out.push(date);
    if (out.length >= MAX_OCCURRENCES) break;
  }
  return out;
}

/**
 * The first occurrence strictly after `after`, or null when the rule has ended.
 * Looks ahead at most five years.
 */
function nextAfter(rule, start, after, { calendar } = {}) {
  assertDate(after, "after");
  const from = addDays(after, 1);
  const list = occurrences(rule, start, {
    from: from < start ? start : from,
    to: addDays(after, 1830),
    calendar,
  });
  return list[0] || null;
}

module.exports = {
  FREQS,
  validateRule,
  assertRule,
  occurrences,
  nextAfter,
  MAX_OCCURRENCES,
};
