"use strict";
/**
 * "N of something within a rolling window": three late arrivals in 30 days
 * (M3 query rules), no contact with a partner in 60 days (M7 inactivity), five
 * failed sign-ins in 15 minutes. One definition of the window, so the rule a
 * person configures and the count the system acts on cannot disagree.
 *
 * A rule may also count over a calendar period (the Attendance policy's consequence rules,
 * docs/guides/attendance.md §6.16): a Week (Monday to Sunday), the Month, or the 30 days ending on
 * the day counted, in Lagos dates (`periodBounds`). And it may restart after each breach, with a
 * limit on a value summed per event beside the count, whichever is reached first (`breaches`):
 *
 *   breaches({ count: 3, limit: 300 }, [{ date, value: 12 }, ...], { after: lastBreachDay })
 *   → [{ dates: [...], count: 3, total: 41, reached: "count", last: "2026-10-09" }, ...]
 *
 * A rule:
 *
 *   { threshold: 3, window_days: 30 }            at least 3 events in the 30 days ending on the date
 *
 * The window is the `window_days` business days ending on (and including) the
 * evaluation date, in Lagos dates: a 30-day window evaluated on 31 October
 * covers 2 October to 31 October.
 *
 *   evaluate(rule, ["2026-10-02", "2026-10-15", "2026-10-31"], "2026-10-31")
 *   → { count: 3, triggered: true, window_from: "2026-10-02", window_to: "2026-10-31", dates: [...] }
 *
 *   // in SQL, counting a subject's events with the same window:
 *   const w = windowBounds(rule, asOf);
 *   SELECT COUNT(*)::int FROM attendance_day a
 *    WHERE a.employee_id = $1 AND a.status = 'late' AND a.day BETWEEN $2 AND $3     -- [w.from, w.to]
 *
 * Re-triggering is the caller's decision (a query rule raises one query per
 * breach, not one per extra event); `firstBreach()` names the date the threshold
 * was first reached, which is what to de-duplicate on.
 */
const { assertDate, addDays, weekday, monthBounds } = require("../time/lagos");

/** The calendar periods a rule may count over: a week (Monday to Sunday), the month, the last 30 days. */
const PERIODS = Object.freeze(["week", "month", "days_30"]);

function assertRule(rule) {
  if (!rule || !Number.isInteger(rule.threshold) || rule.threshold < 1)
    throw new TypeError(
      "window rule: threshold must be a whole number of at least 1",
    );
  if (
    !Number.isInteger(rule.window_days) ||
    rule.window_days < 1 ||
    rule.window_days > 3660
  ) {
    throw new TypeError("window rule: window_days must be 1 to 3660");
  }
}

/** The inclusive date range of the window ending on `asOf`. */
function windowBounds(rule, asOf) {
  assertRule(rule);
  assertDate(asOf, "asOf");
  return { from: addDays(asOf, -(rule.window_days - 1)), to: asOf };
}

/**
 * @param {{threshold: number, window_days: number}} rule
 * @param {string[]} dates  event dates (YYYY-MM-DD), any order, duplicates count as separate events
 * @param {string} asOf
 */
function evaluate(rule, dates, asOf) {
  const { from, to } = windowBounds(rule, asOf);
  const inside = (dates || [])
    .filter((d) => assertDate(d, "event date") >= from && d <= to)
    .sort();
  return {
    count: inside.length,
    triggered: inside.length >= rule.threshold,
    window_from: from,
    window_to: to,
    dates: inside,
  };
}

/**
 * The earliest date on which the rule was breached, scanning the events in
 * order, or null when it never was.
 */
function firstBreach(rule, dates) {
  assertRule(rule);
  const sorted = [...(dates || [])]
    .map((d) => assertDate(d, "event date"))
    .sort();
  for (let i = rule.threshold - 1; i < sorted.length; i += 1) {
    const end = sorted[i];
    const { from } = windowBounds(rule, end);
    if (sorted[i - rule.threshold + 1] >= from) return end;
  }
  return null;
}

/**
 * The inclusive dates of the period containing `asOf`: the week from its Monday to its Sunday, its
 * calendar month, or the 30 days ending on it.
 * @param {"week"|"month"|"days_30"} period
 * @param {string} asOf  YYYY-MM-DD
 * @returns {{from: string, to: string}}
 */
function periodBounds(period, asOf) {
  assertDate(asOf, "asOf");
  if (period === "week") {
    const from = addDays(asOf, 1 - weekday(asOf));
    return { from, to: addDays(from, 6) };
  }
  if (period === "month") {
    const { first, last } = monthBounds(asOf);
    return { from: first, to: last };
  }
  if (period === "days_30") return windowBounds({ threshold: 1, window_days: 30 }, asOf);
  throw new TypeError(`window rule: period is one of ${PERIODS.join(", ")}`);
}

/**
 * The breaches in a run of events, each counted from the event after the one before it: the
 * count of events reaching `count`, or the sum of their `value` reaching `limit` (when given),
 * whichever comes first. Only events dated after `after` count (the day of the last breach
 * recorded), so a breach's events are never counted again: three late arrivals give one breach,
 * the sixth the next.
 * @param {{count: number, limit?: number|null}} rule
 * @param {Array<{date: string, value?: number}>} events  any order; several on one date count apart
 * @param {{after?: string|null}} [opts]
 * @returns {Array<{dates: string[], count: number, total: number, reached: "count"|"limit", last: string}>}
 */
function breaches(rule, events, { after = null } = {}) {
  if (!rule || !Number.isInteger(rule.count) || rule.count < 1)
    throw new TypeError("window rule: count must be a whole number of at least 1");
  const limit = rule.limit === null || rule.limit === undefined ? null : Number(rule.limit);
  if (limit !== null && !(limit > 0)) throw new TypeError("window rule: limit must be above 0");
  if (after !== null) assertDate(after, "after");
  const sorted = (events || [])
    .map((e) => ({ date: assertDate(e.date, "event date"), value: Number(e.value) || 0 }))
    .filter((e) => after === null || e.date > after)
    .sort((a, b) => a.date.localeCompare(b.date));
  const out = [];
  let run = [];
  let total = 0;
  for (const e of sorted) {
    run.push(e.date);
    total += e.value;
    const byCount = run.length >= rule.count;
    const byLimit = limit !== null && total >= limit;
    if (byCount || byLimit) {
      out.push({ dates: run, count: run.length, total, reached: byCount ? "count" : "limit", last: e.date });
      run = [];
      total = 0;
    }
  }
  return out;
}

module.exports = { PERIODS, windowBounds, evaluate, firstBreach, periodBounds, breaches };
