"use strict";
/**
 * What the M3 query rules count from performance reviews (docs/guides/queries.md §6.3). Reviews
 * answer from their own records; the rule evaluator (src/modules/query_rules) never reads these
 * tables.
 *
 *   offences(db, { source, employee_id, from, to })
 *     → [{ date, minutes, label }]   one entry per month closed rated Below, on the day it closed
 *   sourcesOf(event)                 the triggers a committed review event can set off
 *
 *   low_performance   a monthly review closed with the rating Below. A probation review is not
 *                     a month's score and never counts.
 */
const { completeQuery } = require("../../shared/http/paged");

const SOURCES = Object.freeze(["low_performance"]);

/**
 * @param {{query: Function}} db
 * @param {{source: string, employee_id: string, from: string, to: string}} q  dates as YYYY-MM-DD, inclusive
 * @returns {Promise<Array<{date: string, minutes: number, label: string}>>}
 */
async function offences(db, { source, employee_id: employeeId, from, to }) {
  if (!SOURCES.includes(source)) throw new Error(`reviews.auto-query: "${source}" is not a review offence`);
  // pagination:complete one person's closed months in a rule's window (at most 13), counted, never listed
  const { rows } = await completeQuery(
    db,
    `SELECT (pr.closed_at AT TIME ZONE 'Africa/Lagos')::date::text AS date, c.name AS round_name
       FROM performance_review pr
       LEFT JOIN performance_cycle c ON c.performance_cycle_id = pr.performance_cycle_id
      WHERE pr.employee_id = $1 AND pr.review_kind = 'monthly' AND pr.rating = 'below'
        AND pr.closed_at IS NOT NULL
        AND (pr.closed_at AT TIME ZONE 'Africa/Lagos')::date BETWEEN $2::date AND $3::date
      ORDER BY pr.closed_at, pr.performance_review_id`,
    [employeeId, from, to],
    { label: "low monthly scores", ceiling: 400 },
  );
  return rows.map((r) => ({ date: r.date, minutes: 0, label: r.round_name ? `${r.round_name} rated Below` : "Month rated Below" }));
}

/** Which rule triggers a committed review event can set off. */
function sourcesOf(event) {
  const p = event.payload || {};
  return event.key === "review.closed" && p.review_kind === "monthly" && p.rating === "below" ? ["low_performance"] : [];
}

module.exports = { SOURCES, offences, sourcesOf };
