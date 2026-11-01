"use strict";
/**
 * The shape of a summary read's result (docs/guides/praxis-ai.md §6.13), built the same way by every
 * module: figures (key, label, value, unit), groups (a grouping of up to 20 rows), series (up to 60
 * points), and the total. A module's repo computes the numbers in one SQL with the reader's scope;
 * this file only names them for the model and the pane, so no module invents its own words for a
 * count. authorise.runSummary parses what comes out with the contract's AiSummaryResult.
 *
 *   const { figure, group, series, periodOf, cut } = require("../../shared/ai/summary");
 *   return {
 *     figures: [figure("late", "Late days", 12, "count"), figure("late_minutes", "Minutes late", 340, "minutes")],
 *     groups: [group("late_days", "Late days by department", rows)],
 *     series: [series("late_days", "Late days by day", points)],
 *     total: 12,
 *   };
 */
const lagos = require("../time/lagos");

/** The most rows a grouping carries, a top list, and the most points a series carries (decision 14). */
const GROUP_ROWS = 20;
const TOP_ROWS = 10;
const SERIES_POINTS = 60;
/** The longest period a summary covers in one read: a year. */
const PERIOD_DAYS = 366;

const num = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** A whole-number string from the database is a count; a score or an amount keeps its places as a string. */
const value = (v) => (typeof v === "string" ? (/^-?\d+$/.test(v) ? Number(v) : v) : num(v));

/** One figure. */
function figure(key, label, v, unit = "count") {
  return { key, label, value: value(v), unit };
}

/**
 * One grouping of at most `max` rows, each { key, label, value, count }. Rows arrive from the repo's
 * json_agg as { key, label, value, count? }; a missing count is null.
 */
function group(by, label, rows, max = GROUP_ROWS) {
  return {
    by,
    label,
    rows: (rows || []).slice(0, max).map((r) => ({
      key: String(r.key ?? r.label ?? ""),
      label: String(r.label ?? r.key ?? "").slice(0, 120) || "(none)",
      value: value(r.value),
      count: r.count === null || r.count === undefined ? null : num(r.count),
    })),
  };
}

/** One series of at most SERIES_POINTS points, each { at, value }, oldest first as given. */
function series(key, label, points) {
  return {
    key,
    label,
    points: (points || []).slice(-SERIES_POINTS).map((p) => ({ at: String(p.at), value: value(p.value) })),
  };
}

/** A top list: the first TOP_ROWS rows of a grouping. */
const top = (by, label, rows) => group(by, label, rows, TOP_ROWS);

/**
 * The period a summary covers, from what was asked: `from` and `to`, or a `month`, else this month in
 * Lagos up to today. An open end is closed at today (from alone) or a month before (to alone), and a
 * period longer than a year is cut to the year ending at `to`.
 * @param {{from?: string, to?: string, month?: string}} q
 * @param {Date} [now]
 * @returns {{from: string, to: string}}
 */
function periodOf(q, now = new Date()) {
  const today = lagos.today(now);
  let from = q.from || null;
  let to = q.to || null;
  if (!from && !to && q.month) ({ first: from, last: to } = lagos.monthBounds(`${q.month}-01`));
  if (!from && !to) ({ first: from } = lagos.monthBounds(today)), (to = today);
  if (from && !to) to = from > today ? from : today;
  if (!from && to) from = lagos.addDays(to, -30);
  if (from > to) [from, to] = [to, from];
  if (lagos.daysBetween(from, to) > PERIOD_DAYS) from = lagos.addDays(to, -PERIOD_DAYS);
  return { from, to };
}

/** Rows cut to a grouping's most, after the repo ranked them. */
const cut = (rows, max = GROUP_ROWS) => (rows || []).slice(0, max);

module.exports = { GROUP_ROWS, TOP_ROWS, SERIES_POINTS, PERIOD_DAYS, figure, group, top, series, periodOf, cut, num, value };
