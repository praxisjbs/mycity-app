"use strict";
/**
 * What the M3 query rules count from attendance (docs/guides/queries.md §6.3). Attendance answers
 * from its own records; the rule evaluator (src/modules/query_rules) never reads these tables itself.
 *
 *   offences(db, { source, employee_id, from, to })
 *     → [{ date, minutes }]   one entry per day it happened, oldest first
 *
 *   unenrolled_device  a day with a punch from a device not on the person's list
 *
 * Late arrivals, absences and missing clock-outs are not here: they are the Attendance policy's
 * own rules (attendance.rules-engine.js, §6.16), which raise their query through
 * attendance.rule_breached (queries.md §6.2; AJ with GE and TB, 27/10/2026).
 *
 * An exception People accepted ("the record stands") is not an offence; one still
 * open, rejected or corrected is.
 */
const { completeQuery } = require("../../shared/http/paged");

const EXCEPTION_OF = Object.freeze({
  unenrolled_device: "unknown_device",
});

const SOURCES = Object.freeze(["unenrolled_device"]);

/**
 * @param {{query: Function}} db
 * @param {{source: string, employee_id: string, from: string, to: string}} q  dates as YYYY-MM-DD, inclusive
 * @returns {Promise<Array<{date: string, minutes: number}>>}
 */
async function offences(db, { source, employee_id: employeeId, from, to }) {
  const type = EXCEPTION_OF[source];
  if (!type) throw new Error(`attendance.auto-query: "${source}" is not an attendance offence`);
  // pagination:complete one person's days in a rule's window (at most 366), counted, never listed
  const { rows } = await completeQuery(
    db,
    `SELECT DISTINCT ad.attendance_date::text AS date
       FROM attendance_exception x
       JOIN attendance_day ad ON ad.attendance_day_id = x.attendance_day_id
      WHERE ad.employee_id = $1 AND ad.attendance_date BETWEEN $2::date AND $3::date
        AND x.exception_type = $4 AND x.outcome IS DISTINCT FROM 'accepted'
      ORDER BY 1`,
    [employeeId, from, to, type],
    { label: "attendance offences", ceiling: 400 },
  );
  return rows.map((r) => ({ date: r.date, minutes: 0 }));
}

/**
 * Which rule triggers a committed attendance event can set off, for the person and day
 * in its payload. Read by the job registry's trigger (jobs/registry.js).
 * @returns {string[]}
 */
function sourcesOf(event) {
  const p = event.payload || {};
  if (event.key === "attendance.review_required") {
    const types = Array.isArray(p.types) ? p.types : [];
    return Object.entries(EXCEPTION_OF)
      .filter(([, t]) => types.includes(t))
      .map(([source]) => source);
  }
  return [];
}

module.exports = { SOURCES, offences, sourcesOf };
