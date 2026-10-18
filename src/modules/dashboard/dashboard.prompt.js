"use strict";
/**
 * Whether the Overview opens Attendance's clock-in panel for this session: HomeOverview
 * `prompt_clock_in` (docs/guides/home.md §6 Clock-in prompt, decision O12). Home decides
 * when the panel opens; the panel and the punch are Attendance's.
 *
 * True when all of these hold:
 *
 *   1. the session reading the Overview is the first one the person signed in with today
 *      (Lagos): the earliest user_session issued today is req.user.session_id. A session
 *      kept alive since yesterday, or a second device today, does not prompt
 *   2. Attendance's own word on where they stand today (attendance.service today(), the
 *      read behind GET /attendance/me/today) is "not clocked in": they are employed, no
 *      granted leave covers today, no clock-in counts today (accepted or in review, and not
 *      excluded by People's decision) and no shift is still open from yesterday
 *   3. today is a working day, by Attendance's shift for it (the working week and public
 *      holidays through shared/time/working-week)
 *
 * Nothing is stored: closing the panel is enough for the day, because the next Overview
 * the same session reads is still the first session's, and the client opens the panel once.
 * The session check runs first; it is one indexed read, and Attendance's read is made only
 * for the first session of the day.
 */
const attendance = require("../attendance/attendance.service");
const lagos = require("../../shared/time/lagos");

/**
 * Whether `user`'s current session is the first they signed in with on `date` (Lagos).
 * @param {{query: Function}} db
 * @param {{user_id: string, session_id?: string}} user  req.user (auth sets session_id)
 * @param {string} date  YYYY-MM-DD
 */
async function firstSessionOn(db, user, date) {
  if (!user.session_id) return false;
  const { rows } = await db.query(
    `SELECT s.session_id
       FROM user_session s
      WHERE s.user_id = $1 AND s.issued_at >= $2::timestamptz AND s.issued_at < $3::timestamptz
      ORDER BY s.issued_at, s.session_id
      LIMIT 1`,
    [user.user_id, lagos.startOfDay(date), lagos.endOfDayExclusive(date)],
  );
  return rows.length === 1 && rows[0].session_id === user.session_id;
}

/**
 * Whether to open the clock-in panel for this session.
 * @param {{query: Function}} db
 * @param {{user_id: string, employee_id: string|null, session_id?: string}} user  req.user
 * @param {{now: Date, today: string}} at  the moment read, and its Lagos date
 * @returns {Promise<boolean>}
 */
async function shouldPrompt(db, user, { now, today }) {
  if (!user.employee_id) return false;
  if (!(await firstSessionOn(db, user, today))) return false;
  const stand = await attendance.today(user, { now });
  return stand.state === "not_clocked_in" && stand.shift.working_day === true;
}

module.exports = { firstSessionOn, shouldPrompt };
