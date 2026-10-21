"use strict";
/**
 * How a KPI, a person's month and a goal are scored (docs/guides/performance.md §6). One
 * place, so the KPIs screen, My Performance, Goals, Analytics and the review's prefilled
 * ratings all say the same thing.
 *
 *   attainment   higher: actual ÷ target, capped at 1. lower: target ÷ actual, capped at 1,
 *                and 1 when nothing has happened yet (0 actual). Null without a target.
 *   status       met at attainment 1; otherwise on_track when attainment is at least the
 *                share of the period's working days gone less 10 points, at_risk within 25
 *                points below that, behind below.
 *   kpi score    Σ(attainment × weight) ÷ 100 over a person's KPIs for the month.
 *   rating       the manager's prefilled rating, 1 to 5, from attainment.
 *
 * Quantities and weights arrive as the database's decimal strings; the arithmetic here is
 * a ratio for display, never stored, so plain numbers are enough.
 */
const lagos = require("../../shared/time/lagos");
const workingWeek = require("../../shared/time/working-week");

/** attainment in SQL, from employee_target alias `t`. Kept equal to attainment() below. */
const ATTAINMENT_SQL = (t = "t") => `CASE
    WHEN ${t}.target_value IS NULL OR ${t}.target_value = 0 THEN NULL
    WHEN ${t}.direction = 'lower' THEN
      CASE WHEN COALESCE(${t}.actual_value, 0) = 0 THEN 1
           ELSE LEAST(1, ${t}.target_value / ${t}.actual_value) END
    ELSE LEAST(1, COALESCE(${t}.actual_value, 0) / ${t}.target_value)
  END`;

/** The statuses whose KPIs count: approved, and on. */
const COUNTED = Object.freeze(["active", "met", "completed"]);

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

/** 0 to 1, or null when there is no target. */
function attainment({ target_value: target, actual_value: actual, direction }) {
  const t = num(target);
  const a = num(actual) || 0;
  if (!t) return null;
  if (direction === "lower") return a === 0 ? 1 : Math.min(1, t / a);
  return Math.min(1, a / t);
}

/**
 * The share of a period's working days gone by `today`, 0 to 1.
 * @param {string} from  YYYY-MM-DD
 * @param {string} to    YYYY-MM-DD
 * @param {string} today YYYY-MM-DD
 * @param {object} cal   working-week calendar
 */
function elapsed(from, to, today, cal) {
  if (today < from) return 0;
  if (today >= to) return 1;
  const total = workingWeek.countWorkingDays(from, to, cal);
  if (!total) return 1;
  return workingWeek.countWorkingDays(from, today, cal) / total;
}

/** on_track, at_risk, behind or met; null without an attainment. */
function statusOf(att, share) {
  if (att === null || att === undefined) return null;
  if (att >= 1) return "met";
  const bar = share - 0.1;
  if (att >= bar) return "on_track";
  if (att >= bar - 0.25) return "at_risk";
  return "behind";
}

/** Σ(attainment × weight) ÷ 100 over KPIs with an attainment; null when none has one. */
function kpiScore(kpis) {
  const scored = kpis.filter((k) => attainment(k) !== null);
  if (!scored.length) return null;
  const sum = scored.reduce((acc, k) => acc + attainment(k) * Number(k.weight), 0);
  return Math.min(1, sum / 100);
}

/** The weights' total as a decimal string with two places, without float drift. */
function totalWeight(kpis) {
  const cents = kpis.reduce((acc, k) => acc + Math.round(Number(k.weight) * 100), 0);
  return (cents / 100).toFixed(2);
}

/** The manager's prefilled rating from attainment (§6 Review sequence). */
function ratingOf(att) {
  if (att === null || att === undefined) return null;
  if (att >= 1) return 5;
  if (att >= 0.85) return 4;
  if (att >= 0.7) return 3;
  if (att >= 0.5) return 2;
  return 1;
}

/** First and last day of a "YYYY-MM" month. */
function monthRange(month) {
  return lagos.monthBounds(`${month}-01`);
}

module.exports = {
  ATTAINMENT_SQL,
  COUNTED,
  attainment,
  elapsed,
  statusOf,
  kpiScore,
  totalWeight,
  ratingOf,
  monthRange,
};
