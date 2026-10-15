"use strict";
/**
 * "N of something within a rolling window": three late arrivals in 30 days
 * (M3 query rules), no contact with a partner in 60 days (M7 inactivity), five
 * failed sign-ins in 15 minutes. One definition of the window, so the rule a
 * person configures and the count the system acts on cannot disagree.
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
const { assertDate, addDays } = require("../time/lagos");

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

module.exports = { windowBounds, evaluate, firstBreach };
