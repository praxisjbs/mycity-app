"use strict";
/**
 * A line's month, worked out (docs/guides/performance.md §6.9, §6.10, §6.14): the score the system
 * proposes for what a person entered, and the figures and scores of the automatic lines.
 *
 *   own             the person's actual and its evidence: numeric actual ÷ target, a milestone by
 *                   the business days it came after its date, a monthly standard met, nearly met or
 *                   missed, a binary met or not. No evidence: Not Assessable, and no score
 *   commitments     approved commitments due in the month delivered by their original date ÷ those
 *                   due (overdue stay in, rescoped leave), scored as a standard. None due: blank
 *   update_on_time  the check-in submitted by its due date: 1 or 0; a month before the quarter went
 *                   live, or still open before its date: blank
 *   team_reviews    the person's reviews of the round's people submitted by the review date ÷ those
 *                   due or done, scored as a standard against the line's target (100% unless set)
 *   team_result     the mean of the linked key results' latest attainment: the same for everyone
 *   function_kpi    the KPI's result for the month, scored as a standard against the line; N/A blank
 *   key_result      the key result's latest actual against the line's target, numeric
 *   tasks           Done tasks counting towards the line in the month, against its target
 *
 * The functions read and return; they never write. A review stores what they give when a check-in
 * is submitted and again when the reviewer submits (reviews.service.js); the screens read them in
 * between. "The month" is the review's: from its first day to the end of its last, Lagos time.
 */
const { scoring } = require("@mycity/contract");
const { completeQuery } = require("../../shared/http/paged");
const lagos = require("../../shared/time/lagos");
const workingWeek = require("../../shared/time/working-week");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;
const day = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
const quantity = (n) => (n === null || n === undefined ? null : String(Math.round(Number(n) * 10000) / 10000));

/** The sources the system fills; `own` is the person's. */
const AUTOMATIC = Object.freeze(["commitments", "update_on_time", "team_reviews", "team_result", "function_kpi", "key_result", "tasks"]);

const isAutomatic = (source) => AUTOMATIC.includes(source);

/** The month's bounds: its first and last day, and the instants they run between in Lagos. */
function monthOf(month) {
  const first = day(month);
  const { last } = lagos.monthBounds(first);
  return { first, last, from: lagos.instant(first), to: lagos.endOfDayExclusive(last) };
}

/** Has the end of a Lagos day passed at `now`? */
const dayPassed = (date, now = new Date()) => Boolean(date) && now >= lagos.endOfDayExclusive(day(date));

/* ------------------------------------------------------------------ *
 * What a person entered
 * ------------------------------------------------------------------ */

/**
 * The proposed score of an `own` line from what the person entered, and whether it can be assessed.
 * @param {object} line  employee_target (measure, direction, unit, target_value, milestone_due_on)
 * @param {object} item  the check-in's actual_value, achieved_on and evidence_kind
 * @param {{rules: object, cal: object, month: string, now?: Date}} ctx
 * @returns {{proposed_score: string|null, assessable: boolean}}
 */
function proposeOwn(line, item, { rules, cal, month, now = new Date() }) {
  if (!item.evidence_kind) return { proposed_score: null, assessable: false };
  const r = rules.lines;
  let s = null;
  if (line.measure === "numeric") {
    s = scoring.numericScore({ actual: item.actual_value, target: line.target_value, direction: line.direction || "higher" });
  } else if (line.measure === "milestone") {
    const due = day(line.milestone_due_on);
    const done = day(item.achieved_on);
    if (due && done) {
      const late = done <= due ? 0 : workingWeek.countBusinessDays(lagos.addDays(due, 1), done, cal);
      s = scoring.milestoneScore({ late_business_days: late }, r);
    } else if (due) {
      // Not delivered: 0 once its date has gone by the end of the month reviewed, else not yet due.
      s = scoring.milestoneScore({ late_business_days: null, due_passed: due <= monthOf(month).last && dayPassed(due, now) }, r);
    }
  } else if (line.measure === "standard") {
    s = scoring.standardScore({ actual: item.actual_value, target: line.target_value, direction: line.direction || "higher", unit: line.unit }, r);
  } else if (line.measure === "binary") {
    const v = scoring.num(item.actual_value);
    s = scoring.binaryScore(v === null ? null : v >= 1);
  }
  return { proposed_score: scoring.formatScore(s), assessable: true };
}

/* ------------------------------------------------------------------ *
 * The automatic lines
 * ------------------------------------------------------------------ */

/** Commitments due in the month (approved sets only), delivered by the end of their original date. */
async function commitments(db, employeeId, m) {
  return one(
    db,
    `SELECT count(*)::int AS due,
            count(*) FILTER (WHERE t.completed_at IS NOT NULL
              AND t.completed_at < ((timezone('Africa/Lagos', t.original_due_at)::date + 1)::timestamp AT TIME ZONE 'Africa/Lagos'))::int AS on_time
       FROM task t
       JOIN commitment_set cs ON cs.commitment_set_id = t.commitment_set_id AND cs.status = 'approved'
      WHERE t.is_commitment AND t.primary_assignee_id = $1 AND t.commitment_month = $2::date
        AND t.rescoped_at IS NULL AND t.status <> 'cancelled' AND t.original_due_at IS NOT NULL
        AND t.original_due_at >= $3 AND t.original_due_at < $4`,
    [employeeId, m.first, m.from, m.to],
  );
}

/** The person's reviews of the round's people: submitted by the review date, and those due or done. */
async function teamReviews(db, employeeId, cycleId, now) {
  if (!cycleId) return null;
  return one(
    db,
    `SELECT count(*) FILTER (WHERE r.submitted_at IS NOT NULL
              OR $3::timestamptz >= ((c.review_due_on + 1)::timestamp AT TIME ZONE 'Africa/Lagos'))::int AS due,
            count(*) FILTER (WHERE r.submitted_at IS NOT NULL
              AND r.submitted_at < ((c.review_due_on + 1)::timestamp AT TIME ZONE 'Africa/Lagos'))::int AS on_time
       FROM performance_review r JOIN performance_cycle c ON c.performance_cycle_id = r.performance_cycle_id
      WHERE r.performance_cycle_id = $1 AND r.reviewer_employee_id = $2 AND r.employee_id <> $2`,
    [cycleId, employeeId, now],
  );
}

/** Each key result's latest score up to the month: confirmed, else proposed. */
async function keyResultScores(db, ids, month) {
  if (!ids.length) return [];
  // pagination:complete the key results one Team result line links, a handful
  const { rows } = await completeQuery(
    db,
    `SELECT DISTINCT ON (m.okr_key_result_id) m.okr_key_result_id,
            trim_scale(COALESCE(m.confirmed_score, m.proposed_score))::text AS score
       FROM okr_key_result_month m
      WHERE m.okr_key_result_id = ANY($1::uuid[]) AND m.month <= $2::date
        AND COALESCE(m.confirmed_score, m.proposed_score) IS NOT NULL
      ORDER BY m.okr_key_result_id, m.month DESC`,
    [ids, month],
    { label: "a Team result's key results" },
  );
  return rows;
}

/** A key result's latest reported actual up to the month, with its own target and direction. */
const keyResultActual = (db, id, month) =>
  one(
    db,
    `SELECT trim_scale(m.actual_value)::text AS actual_value, m.actual_text, m.month,
            trim_scale(kr.target_value)::text AS target_value, kr.direction, kr.code::text AS code
       FROM okr_key_result kr
       LEFT JOIN LATERAL (SELECT x.actual_value, x.actual_text, x.month FROM okr_key_result_month x
                           WHERE x.okr_key_result_id = kr.okr_key_result_id AND x.month <= $2::date
                             AND (x.actual_value IS NOT NULL OR x.actual_text IS NOT NULL)
                           ORDER BY x.month DESC LIMIT 1) m ON true
      WHERE kr.okr_key_result_id = $1`,
    [id, month],
  );

/** A KPI's actual for the month, with its own target and unit. */
const kpiMonth = (db, id, month) =>
  one(
    db,
    `SELECT km.result, trim_scale(km.actual_value)::text AS actual_value, km.actual_text,
            trim_scale(k.target_value)::text AS kpi_target, k.unit AS kpi_unit, k.direction AS kpi_direction, k.code::text AS code
       FROM kpi_definition k
       LEFT JOIN kpi_month km ON km.kpi_definition_id = k.kpi_definition_id AND km.month = $2::date
      WHERE k.kpi_definition_id = $1`,
    [id, month],
  );

/** Done tasks counting towards a line, completed in the month. */
const tasksDone = async (db, lineId, m) =>
  (
    await one(
      db,
      `SELECT count(*)::int AS n FROM task t
        WHERE t.employee_target_id = $1 AND t.status = 'done' AND t.completed_at >= $2 AND t.completed_at < $3`,
      [lineId, m.from, m.to],
    )
  ).n;

/**
 * Every automatic line of a review, worked out for its month.
 * @param {{query: Function}} db
 * @param {object} review  employee_id, performance_cycle_id, month, check_in_submitted_at, check_in due
 *   (the person's: head_check_in_due_on for a function head), live_from of its quarter
 * @param {Array<object>} lines  the scorecard's lines (targets.repo.lines), with team_key_results
 * @param {{rules: object, now?: Date}} ctx
 * @returns {Promise<Map<string, {actual_value: string|null, actual_text: string|null, proposed_score: string|null}>>}
 */
async function automatic(db, review, lines, { rules, now = new Date() }) {
  const out = new Map();
  const month = day(review.month);
  if (!month) return out;
  const m = monthOf(month);
  const r = rules.lines;
  for (const line of lines) {
    if (!isAutomatic(line.source)) continue;
    let actualValue = null;
    let actualText = null;
    let s = null;
    if (line.source === "commitments") {
      const c = await commitments(db, review.employee_id, m);
      if (c.due > 0) {
        const pct = (100 * c.on_time) / c.due;
        actualValue = quantity(pct);
        actualText = `${c.on_time} of ${c.due} on time`;
        s = scoring.standardScore({ actual: pct, target: line.target_value ?? 80, direction: "higher", unit: "%" }, r);
      }
    } else if (line.source === "update_on_time") {
      const liveFrom = day(review.live_from);
      const due = day(review.check_in_due);
      if (!(liveFrom && m.last < liveFrom) && due) {
        const submitted = review.check_in_submitted_at ? new Date(review.check_in_submitted_at) : null;
        const onTime = submitted ? submitted < lagos.endOfDayExclusive(due) : dayPassed(due, now) ? false : null;
        if (onTime !== null) {
          s = scoring.binaryScore(onTime);
          actualText = onTime ? "On time" : "Late";
        }
      }
    } else if (line.source === "team_reviews") {
      const t = await teamReviews(db, review.employee_id, review.performance_cycle_id, now);
      if (t && t.due > 0) {
        const pct = (100 * t.on_time) / t.due;
        actualValue = quantity(pct);
        actualText = `${t.on_time} of ${t.due} on time`;
        s = scoring.standardScore({ actual: pct, target: line.target_value ?? 100, direction: "higher", unit: "%" }, r);
      }
    } else if (line.source === "team_result") {
      const ids = (line.team_key_results || []).map((k) => k.okr_key_result_id);
      const scores = await keyResultScores(db, ids, month);
      const mean = scoring.meanScore(scores.map((x) => x.score));
      if (mean !== null) {
        actualValue = quantity(mean);
        actualText = `${scores.length} of ${ids.length} key results scored`;
        s = mean;
      }
    } else if (line.source === "function_kpi" && line.kpi_definition_id) {
      const k = await kpiMonth(db, line.kpi_definition_id, month);
      if (k && k.result && k.result !== "na") {
        actualValue = k.actual_value;
        actualText = k.actual_text || (k.result === "met" ? "Met" : "Not met");
        const target = line.target_value ?? k.kpi_target;
        s =
          k.actual_value !== null && target !== null
            ? scoring.standardScore(
                { actual: k.actual_value, target, direction: line.direction || k.kpi_direction || "higher", unit: line.unit || k.kpi_unit },
                r,
              )
            : scoring.binaryScore(k.result === "met");
      }
    } else if (line.source === "key_result" && line.okr_key_result_id) {
      const k = await keyResultActual(db, line.okr_key_result_id, month);
      if (k && (k.actual_value !== null || k.actual_text !== null)) {
        actualValue = k.actual_value;
        actualText = k.actual_text;
        s = scoring.numericScore({ actual: k.actual_value, target: line.target_value ?? k.target_value, direction: k.direction || "higher" });
      }
    } else if (line.source === "tasks") {
      const n = await tasksDone(db, line.employee_target_id, m);
      actualValue = String(n);
      actualText = `${n} done`;
      s = scoring.numericScore({ actual: n, target: line.target_value, direction: "higher" });
    }
    out.set(line.employee_target_id, { actual_value: actualValue, actual_text: actualText, proposed_score: scoring.formatScore(s) });
  }
  return out;
}

module.exports = { AUTOMATIC, isAutomatic, monthOf, dayPassed, proposeOwn, automatic };
