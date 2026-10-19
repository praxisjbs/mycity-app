"use strict";
/**
 * What the M3 query rules count from attendance (docs/guides/queries.md §6.3;
 * docs/guides/attendance.md §13: the late-arrival query is M3's). Attendance answers
 * from its own records; the rule evaluator (src/modules/query_rules) never reads
 * these tables itself.
 *
 *   offences(db, { source, employee_id, from, to })
 *     → [{ date, minutes }]   one entry per day it happened, oldest first
 *
 *   lateness           a day the register says was late; minutes are its late minutes
 *   absence            a working day closed as absent
 *   missing_clock_out  a day the day-close opened a missing clock-out on
 *   unenrolled_device  a day with a punch from a device not on the person's list
 *
 * An exception People accepted ("the record stands") is not an offence; one still
 * open, rejected or corrected is.
 */
const { completeQuery } = require("../../shared/http/paged");

const EXCEPTION_OF = Object.freeze({
  missing_clock_out: "missing_clock_out",
  unenrolled_device: "unknown_device",
});

const SOURCES = Object.freeze(["lateness", "absence", "missing_clock_out", "unenrolled_device"]);

/**
 * @param {{query: Function}} db
 * @param {{source: string, employee_id: string, from: string, to: string}} q  dates as YYYY-MM-DD, inclusive
 * @returns {Promise<Array<{date: string, minutes: number}>>}
 */
async function offences(db, { source, employee_id: employeeId, from, to }) {
  if (source === "lateness" || source === "absence") {
    // pagination:complete one person's days in a rule's window (at most 366), counted, never listed
    const { rows } = await completeQuery(
      db,
      `SELECT ad.attendance_date::text AS date, ad.late_minutes AS minutes
         FROM attendance_day ad
        WHERE ad.employee_id = $1 AND ad.attendance_date BETWEEN $2::date AND $3::date AND ad.status = $4
        ORDER BY ad.attendance_date`,
      [employeeId, from, to, source === "lateness" ? "late" : "absent"],
      { label: "attendance offences", ceiling: 400 },
    );
    return rows.map((r) => ({ date: r.date, minutes: source === "lateness" ? Number(r.minutes) : 0 }));
  }
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
  if (event.key === "attendance.punched") return p.event_type === "clock_in" ? ["lateness"] : [];
  if (event.key === "attendance.day_closed") return p.status === "absent" ? ["absence"] : [];
  if (event.key === "attendance.review_required") {
    const types = Array.isArray(p.types) ? p.types : [];
    return Object.entries(EXCEPTION_OF)
      .filter(([, t]) => types.includes(t))
      .map(([source]) => source);
  }
  return [];
}

module.exports = { SOURCES, offences, sourcesOf };
