"use strict";
/**
 * Performance scoring (docs/guides/performance.md §6.8, §6.9, §6.15): the rules a quarter
 * carries and the pure arithmetic both sides of the wire use, so a score proposed on the
 * server and one previewed on a screen as a person types are the same number.
 *
 * Two rule sets, kept as MyCity's two workbooks wrote them (P6):
 *
 *   key_results  the OKR workbook's Read Me: numeric actual ÷ target capped at 1 (target ÷
 *                actual when lower is better); dated or yes/no 1 by the date, 0.7 within 14
 *                days after it, 0.3 partly done, 0 not done; a multi-part key result is the
 *                mean of its parts. Bands: 0.7 or above good, 0.4 to under 0.7 watch, under
 *                0.4 recovery (a recovery owner and date are required).
 *   lines        the scorecard workbook's Guide: numeric as above; a milestone 1.0 on time,
 *                0.5 within 10 business days after the due date, 0 later; a monthly standard
 *                1.0 met, 0.5 missed by up to 5 percentage points (or one count above a zero
 *                target), 0 otherwise; a month with no eligible cases is blank. A Results
 *                line's score is its latest month; a KPI or Accountability line's the mean of
 *                its months. Score to date = Σ(weight × score) ÷ Σ(weight of scored lines).
 *                Bands: 0.90 Exceeds, 0.75 Meets, 0.50 Partly Meets, below that Below; a
 *                confirmed conduct breach caps the rating at Partly Meets.
 *
 * Scores are 0 to 1 and travel as decimal strings (numeric(6,4) columns); the functions
 * here take strings or numbers and return numbers, or null for "no score".
 */
const { z } = require("zod");

/* ------------------------------------------------------------------ *
 * Wire values
 * ------------------------------------------------------------------ */

/** A score from 0 to 1, as a decimal string with up to four places ("0.75"). */
const ScoreValue = z
  .string()
  .regex(/^(0(\.\d{1,4})?|1(\.0{1,4})?)$/, "must be a score from 0 to 1, like 0.75");

/** A target or actual quantity: numeric(18,4) as a decimal string ("64000", "0.95"). */
const Quantity = z.string().regex(/^-?\d{1,14}(\.\d{1,4})?$/, "must be a number like 64000 or 0.95");

const Direction = z.enum(["higher", "lower"]);
const KrBand = z.enum(["good", "watch", "recovery"]);
const Rating = z.enum(["exceeds", "meets", "partly_meets", "below"]);

/* ------------------------------------------------------------------ *
 * The rules a quarter carries (performance_period.rules)
 * ------------------------------------------------------------------ */

const share = z.number().min(0).max(1);

const KeyResultRules = z
  .object({
    dated_on_time: share,
    dated_grace_days: z.number().int().min(0).max(60),
    dated_late: share,
    dated_partly: share,
    band_good: share,
    band_watch: share,
  })
  .strict()
  .refine((r) => r.band_good > r.band_watch, { message: "Good must be above Watch", path: ["band_good"] });

const LineRules = z
  .object({
    milestone_on_time: share,
    milestone_grace_business_days: z.number().int().min(0).max(60),
    milestone_late: share,
    standard_met: share,
    standard_near: share,
    standard_near_points: z.number().min(0).max(100),
  })
  .strict();

const RatingBands = z
  .object({
    exceeds: share,
    meets: share,
    partly_meets: share,
  })
  .strict()
  .refine((b) => b.exceeds > b.meets && b.meets > b.partly_meets, {
    message: "Each band must be above the next",
    path: ["exceeds"],
  });

/** The three sections of a scorecard and their weights; they total 100. */
const SectionWeights = z
  .object({
    results: z.number().int().min(0).max(100),
    kpis: z.number().int().min(0).max(100),
    accountability: z.number().int().min(0).max(100),
  })
  .strict()
  .refine((w) => w.results + w.kpis + w.accountability === 100, {
    message: "The three sections must total 100",
    path: ["results"],
  });

/**
 * Deadlines as the n-th business day of the month after the one reviewed (§6.2, G2, G3);
 * commitments and the function report are due on their n-th business day of the month
 * they are for.
 */
const DueDays = z
  .object({
    check_in: z.number().int().min(1).max(20),
    head_check_in: z.number().int().min(1).max(20),
    commitments: z.number().int().min(1).max(20),
    review: z.number().int().min(1).max(20),
    second_level: z.number().int().min(1).max(20),
    close: z.number().int().min(1).max(20),
  })
  .strict()
  .refine((d) => d.check_in <= d.review && d.review <= d.second_level && d.second_level <= d.close, {
    message: "Each deadline must fall on or after the one before it",
    path: ["review"],
  });

const ScoringRules = z
  .object({
    key_results: KeyResultRules,
    lines: LineRules,
    bands: RatingBands,
    sections: SectionWeights,
    due_business_days: DueDays,
  })
  .strict();

/** MyCity's own rules, from the two Q4 workbooks (P6), and the guide's deadlines (G3). */
const DEFAULT_RULES = Object.freeze(
  ScoringRules.parse({
    key_results: {
      dated_on_time: 1,
      dated_grace_days: 14,
      dated_late: 0.7,
      dated_partly: 0.3,
      band_good: 0.7,
      band_watch: 0.4,
    },
    lines: {
      milestone_on_time: 1,
      milestone_grace_business_days: 10,
      milestone_late: 0.5,
      standard_met: 1,
      standard_near: 0.5,
      standard_near_points: 5,
    },
    bands: { exceeds: 0.9, meets: 0.75, partly_meets: 0.5 },
    sections: { results: 60, kpis: 25, accountability: 15 },
    due_business_days: { check_in: 2, head_check_in: 3, commitments: 3, review: 5, second_level: 7, close: 10 },
  }),
);

/* ------------------------------------------------------------------ *
 * Arithmetic
 * ------------------------------------------------------------------ */

/** A number from a decimal string or number; null for null, undefined, "" or not a number. */
function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Rounded to two places, as their sheets show a score (ROUND(x, 2)). */
function round2(n) {
  return n === null || n === undefined ? null : Math.round((n + Number.EPSILON) * 100) / 100;
}

/** A score as it travels: four places, trailing zeros kept off ("0.7", "1", "0.6667"). */
function formatScore(n) {
  if (n === null || n === undefined) return null;
  return String(Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000);
}

const clamp01 = (n) => Math.min(1, Math.max(0, n));

/**
 * Numeric attainment: actual ÷ target capped at 1; lower is better: target ÷ actual (an
 * actual of 0 scores 1). A zero target scores 1 when the actual meets it, else 0.
 * @param {{actual: number|string|null, target: number|string|null, direction?: "higher"|"lower"}} v
 */
function numericScore({ actual, target, direction = "higher" }) {
  const a = num(actual);
  const t = num(target);
  if (a === null || t === null) return null;
  if (direction === "lower") {
    if (a <= 0) return 1;
    if (t <= 0) return 0;
    return clamp01(t / a);
  }
  if (t <= 0) return a >= t ? 1 : 0;
  return clamp01(a / t);
}

/**
 * A dated or yes/no key result: 1 done by the date, `dated_late` done within the grace days
 * after it, `dated_partly` partly done, 0 not done. Null while it is not done and its date has
 * not passed (nothing to score yet).
 * @param {{done_on?: string|null, due_on: string, partly?: boolean, today: string}} v  ISO dates
 */
function datedKrScore({ done_on: doneOn = null, due_on: dueOn, partly = false, today }, rules = DEFAULT_RULES.key_results) {
  if (doneOn) {
    const late = daysBetween(dueOn, doneOn);
    if (late <= 0) return rules.dated_on_time;
    if (late <= rules.dated_grace_days) return rules.dated_late;
    return 0;
  }
  if (partly) return rules.dated_partly;
  if (today && daysBetween(dueOn, today) <= 0) return null;
  return 0;
}

/** The band a key result's score sits in. */
function krBand(score, rules = DEFAULT_RULES.key_results) {
  const s = num(score);
  if (s === null) return null;
  if (s >= rules.band_good) return "good";
  if (s >= rules.band_watch) return "watch";
  return "recovery";
}

/**
 * A milestone line: 1.0 accepted on time, `milestone_late` within the grace business days
 * after the due date, 0 later or not accepted. `late_business_days` is how many business days
 * after the due date it was accepted (0 or less: on time; null: not accepted), worked out by the
 * caller from the calendar.
 * @param {{late_business_days: number|null, due_passed?: boolean}} v
 */
function milestoneScore({ late_business_days: late, due_passed: duePassed = true }, rules = DEFAULT_RULES.lines) {
  if (late === null || late === undefined) return duePassed ? 0 : null;
  if (late <= 0) return rules.milestone_on_time;
  if (late <= rules.milestone_grace_business_days) return rules.milestone_late;
  return 0;
}

/**
 * A monthly standard (a KPI or accountability line): met, nearly met, missed.
 * Near means missed by up to `standard_near_points` percentage points for a percentage, one
 * count above a zero target, or within that share of the target for any other figure.
 * @param {{actual: number|string|null, target: number|string|null, direction?: "higher"|"lower", unit?: string|null}} v
 *   unit "%" when the figures are percentages (95, not 0.95)
 */
function standardScore({ actual, target, direction = "higher", unit = null }, rules = DEFAULT_RULES.lines) {
  const a = num(actual);
  const t = num(target);
  if (a === null || t === null) return null;
  const met = direction === "lower" ? a <= t : a >= t;
  if (met) return rules.standard_met;
  const gap = direction === "lower" ? a - t : t - a;
  const pts = rules.standard_near_points;
  let near;
  if (unit === "%") near = gap <= pts;
  else if (direction === "lower" && t === 0) near = a <= 1;
  else near = t !== 0 && gap / Math.abs(t) <= pts / 100;
  return near ? rules.standard_near : 0;
}

/** A yes or no standard (the monthly update was on time): 1 or 0; null when not due. */
function binaryScore(met) {
  if (met === null || met === undefined) return null;
  return met ? 1 : 0;
}

/** The mean of the scores that exist, rounded to two places; null when none do. */
function meanScore(scores) {
  const s = (scores || []).map(num).filter((n) => n !== null);
  if (!s.length) return null;
  return round2(s.reduce((a, b) => a + b, 0) / s.length);
}

/**
 * A line's score over the months entered so far: a Results line takes its latest month; a KPI
 * or Accountability line the mean of its months. `months` is in month order; nulls are blanks.
 * @param {{section: "results"|"kpis"|"accountability", months: Array<number|string|null>}} v
 */
function lineScore({ section, months }) {
  const entered = (months || []).map(num).filter((n) => n !== null);
  if (!entered.length) return null;
  if (section === "results") return entered[entered.length - 1];
  return entered.reduce((a, b) => a + b, 0) / entered.length;
}

/**
 * Score to date: Σ(weight × score) ÷ Σ(weight) over the lines that have a score.
 * @param {Array<{weight: number|string, score: number|string|null}>} lines
 */
function scoreToDate(lines) {
  let sum = 0;
  let weights = 0;
  for (const l of lines || []) {
    const s = num(l.score);
    const w = num(l.weight);
    if (s === null || w === null || w <= 0) continue;
    sum += w * s;
    weights += w;
  }
  return weights > 0 ? sum / weights : null;
}

/**
 * The rating band of a score to date; a confirmed conduct breach caps it at Partly Meets.
 * @param {number|string|null} score
 * @param {{conduct_breach?: boolean}} [opts]
 */
function rating(score, { conduct_breach: breach = false } = {}, bands = DEFAULT_RULES.bands) {
  const s = num(score);
  if (s === null) return null;
  let r = "below";
  if (s >= bands.exceeds) r = "exceeds";
  else if (s >= bands.meets) r = "meets";
  else if (s >= bands.partly_meets) r = "partly_meets";
  if (breach && (r === "exceeds" || r === "meets")) return "partly_meets";
  return r;
}

/**
 * Do a scorecard's lines fill each section's weight exactly? The problems, one per section
 * that does not (empty when all do).
 * @param {Array<{section: string, weight: number|string}>} lines
 * @param {{results: number, kpis: number, accountability: number}} sections
 */
function sectionWeightProblems(lines, sections = DEFAULT_RULES.sections) {
  const out = [];
  for (const section of ["results", "kpis", "accountability"]) {
    const total = (lines || [])
      .filter((l) => l.section === section)
      .reduce((a, l) => a + (num(l.weight) || 0), 0);
    if (Math.round(total * 100) !== Math.round(sections[section] * 100))
      out.push({ section, total: round2(total), expected: sections[section] });
  }
  return out;
}

/** Whole days from a to b (ISO dates); negative when b is before a. */
function daysBetween(a, b) {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  KeyResultRules: { table: null, reason: "part of performance_period.rules (jsonb)" },
  LineRules: { table: null, reason: "part of performance_period.rules (jsonb)" },
  RatingBands: { table: null, reason: "part of performance_period.rules (jsonb)" },
  SectionWeights: { table: null, reason: "part of performance_period.rules (jsonb)" },
  DueDays: { table: null, reason: "part of performance_period.rules (jsonb)" },
  ScoringRules: { table: null, reason: "performance_period.rules (jsonb), validated whole" },
};

module.exports = {
  TABLES,
  ScoreValue,
  Quantity,
  Direction,
  KrBand,
  Rating,
  KeyResultRules,
  LineRules,
  RatingBands,
  SectionWeights,
  DueDays,
  ScoringRules,
  DEFAULT_RULES,
  num,
  round2,
  formatScore,
  numericScore,
  datedKrScore,
  krBand,
  milestoneScore,
  standardScore,
  binaryScore,
  meanScore,
  lineScore,
  scoreToDate,
  rating,
  sectionWeightProblems,
  daysBetween,
};
