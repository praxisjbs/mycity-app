"use strict";
/**
 * Attendance arithmetic: the workplace's wall clock, the device's time against the
 * server's, and what a day comes to. Pure: no database, no host clock, so every rule
 * is unit-tested with explicit instants (docs/guides/attendance.md §6.4).
 *
 * The workplace timezone, never the host's. Reading `getHours()` on a punch reads the
 * SERVER's clock: on a UTC host a Lagos clock-in at 08:30 reads as 07:30, nobody is
 * ever late, and a punch between 00:00 and 01:00 lands on the day before. Every time
 * here is read in the zone it belongs to through Intl, used only for formatToParts
 * (it renders nothing a person reads).
 *
 * A day, in this order, because the order is the policy:
 *   approved leave        leave, whatever was punched
 *   a clock-in            late when its late minutes are above 0, else present
 *   closed, expected      absent: a working day that ended with no clock-in
 *   anything else         no status yet (an open day with no punch, or a day off)
 */
const workingWeek = require("../../shared/time/working-week");
const { weekday } = require("../../shared/time/lagos");

/** Seconds a device clock may run ahead of the server before the punch is held for review. */
const FUTURE_TOLERANCE_S = 120;
/** Seconds behind after which a punch counts as a delayed submission (evidence only). */
const DELAY_FLAG_S = 300;
const DEFAULT_TZ = "Africa/Lagos";

/**
 * The defaults when MyCity has entered no policy (MILESTONES §6.2; A26). The location check has a
 * mode for each kind of place (guide §6.1); `geofence_mode` is the one for the place a date is
 * matched to, the office's until attendance.calendar.js contextFor knows the place.
 */
const DEFAULT_POLICY = Object.freeze({
  attendance_policy_id: null,
  name: null,
  version: null,
  grace_minutes: 0,
  latest_clock_out_minutes: 240,
  office_geofence_mode: "warn",
  home_geofence_mode: "warn",
  site_geofence_mode: "warn",
  geofence_mode: "warn",
  device_mode: "off",
  max_accuracy_m: 100,
  home_radius_m: 100,
});

/** The kinds of place a date is matched to, each with its own location mode (guide §6.1). */
const PLACES = Object.freeze(["office", "home", "site"]);

/** The policy with `geofence_mode` set to the mode of the place: office, home or site. Pure. */
function forPlace(policy, place) {
  if (!PLACES.includes(place)) throw new Error(`attendance: "${place}" is not a place`);
  return { ...policy, geofence_mode: policy[`${place}_geofence_mode`] || DEFAULT_POLICY.geofence_mode };
}

/** Accuracy at or under this many metres is a good reading (the guide's §6.5). */
const GOOD_ACCURACY_M = 50;

const formatters = new Map();

/** One formatter per zone. It renders nothing: formatToParts reads the wall clock. */
function partsFormatter(timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    // @date-format:parts read as named parts by wallClock(), never shown to a person
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** True for a timezone the runtime knows. */
function isTimeZone(timeZone) {
  try {
    partsFormatter(String(timeZone));
    return true;
  } catch {
    return false;
  }
}

/**
 * The wall clock at an instant in a named zone.
 * @returns {{y: number, m: number, d: number, minutes: number, seconds: number}|null}
 *          minutes since local midnight; null for an unusable instant. A bad zone falls
 *          back to the default, so a mistyped setting cannot stop a punch.
 */
function wallClock(instant, timeZone = DEFAULT_TZ) {
  const at = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(at.getTime())) return null;
  let parts;
  try {
    parts = partsFormatter(timeZone).formatToParts(at);
  } catch {
    if (timeZone === DEFAULT_TZ) return null;
    return wallClock(at, DEFAULT_TZ);
  }
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  // Some runtimes still write midnight as 24 under h23; read it as 0.
  const hour = get("hour") % 24;
  return {
    y: get("year"),
    m: get("month"),
    d: get("day"),
    minutes: hour * 60 + get("minute"),
    seconds: get("second"),
  };
}

/** The workplace's calendar date of an instant, YYYY-MM-DD. */
function localDate(instant, timeZone = DEFAULT_TZ) {
  const w = wallClock(instant, timeZone);
  if (!w) return null;
  return `${w.y}-${String(w.m).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
}

/** "HH:MM" at the workplace. */
function localTime(instant, timeZone = DEFAULT_TZ) {
  const w = wallClock(instant, timeZone);
  if (!w) return null;
  return `${String(Math.floor(w.minutes / 60)).padStart(2, "0")}:${String(w.minutes % 60).padStart(2, "0")}`;
}

/** "08:30" → 510. Anything unparseable → null. */
function parseHHMM(value) {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Whole days from date a to date b. */
const daysBetween = (a, b) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * Minutes from the start of `workDate` at the workplace to `instant`: a clock-out
 * after midnight on a late shift reads as 1440 and more, not as early the same day.
 */
function minutesIntoDay(instant, workDate, timeZone = DEFAULT_TZ) {
  const w = wallClock(instant, timeZone);
  if (!w) return null;
  return daysBetween(workDate, localDate(instant, timeZone)) * 1440 + w.minutes;
}

/**
 * The instant of a wall-clock time on a date at the workplace. The zone's offset is
 * read at that moment, so it is right on either side of a clock change.
 */
function zonedInstant(date, hhmm, timeZone = DEFAULT_TZ) {
  const mins = parseHHMM(hhmm);
  if (mins === null) throw new TypeError(`zonedInstant: not a time: ${JSON.stringify(hhmm)}`);
  const asUtc = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), Math.floor(mins / 60), mins % 60);
  let guess = asUtc;
  for (let i = 0; i < 2; i += 1) {
    const seen = minutesIntoDay(new Date(guess), date, timeZone);
    guess += (mins - seen) * 60_000;
  }
  return new Date(guess);
}

/**
 * The device's time against the server's. The server's time is the punch's; the
 * device's is evidence, kept with the gap, never put in its place.
 * @returns {{skew_seconds: number|null, future: boolean, delayed: boolean}}
 */
function timeCheck({ server_at: serverAt, device_at: deviceAt }) {
  if (!deviceAt) return { skew_seconds: null, future: false, delayed: false };
  const skew = Math.round((new Date(serverAt).getTime() - new Date(deviceAt).getTime()) / 1000);
  return {
    skew_seconds: skew,
    future: skew < -FUTURE_TOLERANCE_S,
    delayed: skew > DELAY_FLAG_S,
  };
}

const ORDER = { accepted: 0, review: 1, rejected: 2 };

/** The strictest of several results. */
function strictest(...results) {
  return results.reduce((a, b) => (ORDER[b] > ORDER[a] ? b : a), "accepted");
}

/**
 * The shift on a date: the working week's hours for that weekday (Settings ·
 * Organisation, A22), unless the day is not worked (a weekend, a public holiday).
 * @param {string} date
 * @param {object} cal  shared/time/working-week loadCalendar()
 * @param {{grace_minutes: number}} policy
 */
function shiftFor(date, cal, policy) {
  const working = workingWeek.isWorkingDay(date, cal);
  const hours = (cal.hours && cal.hours[weekday(date)]) || null;
  const pick = (value, fallback) => (working ? (parseHHMM(value) !== null ? String(value).slice(0, 5) : fallback) : null);
  return {
    working_day: working,
    starts_at: pick(hours && hours.starts_at, workingWeek.DEFAULT_WEEK.starts_at),
    ends_at: pick(hours && hours.ends_at, workingWeek.DEFAULT_WEEK.ends_at),
    grace_minutes: Number(policy.grace_minutes) || 0,
    off_reason: working ? null : workingWeek.whyNotWorking(date, cal),
  };
}

/**
 * What a day comes to, from its counted punches.
 * @param {object} input
 * @param {Array<{event_type: string, occurred_at: string|Date}>} input.events  counted: accepted
 *        or review, not excluded by a decision
 * @param {{working_day: boolean, starts_at: string|null, ends_at: string|null, grace_minutes: number}} input.shift
 * @param {string} input.date
 * @param {string} input.timeZone
 * @param {boolean} input.onLeave
 * @param {boolean} input.closed
 * @param {(a: object) => number} input.late       minutes late (attendance.lateness.js)
 * @param {(a: object) => number} input.overtime   minutes over (attendance.lateness.js)
 * @returns {{status: string|null, first_clock_in_at: Date|null, last_clock_out_at: Date|null,
 *            worked_minutes: number, late_minutes: number, overtime_minutes: number}}
 */
function projectDay({ events, shift, date, timeZone, onLeave, closed, late, overtime }) {
  const at = (e) => new Date(e.occurred_at);
  const ins = events.filter((e) => e.event_type === "clock_in").map(at).sort((a, b) => a - b);
  const outs = events.filter((e) => e.event_type === "clock_out").map(at).sort((a, b) => a - b);
  const firstIn = ins[0] || null;
  const lastOut = outs.length ? outs[outs.length - 1] : null;
  const worked = firstIn && lastOut && lastOut > firstIn ? Math.floor((lastOut - firstIn) / 60_000) : 0;
  const lateMinutes = firstIn && shift.working_day
    ? late({ expectedStart: shift.starts_at, firstClockInAt: firstIn, graceMinutes: shift.grace_minutes, date, timeZone })
    : 0;
  const overtimeMinutes = lastOut && shift.working_day
    ? overtime({ expectedEnd: shift.ends_at, lastClockOutAt: lastOut, date, timeZone })
    : 0;
  let status = null;
  if (onLeave) status = "leave";
  else if (firstIn) status = lateMinutes > 0 ? "late" : "present";
  else if (closed && shift.working_day) status = "absent";
  return {
    status,
    first_clock_in_at: firstIn,
    last_clock_out_at: lastOut,
    worked_minutes: worked,
    late_minutes: onLeave ? 0 : lateMinutes,
    overtime_minutes: onLeave ? 0 : overtimeMinutes,
  };
}

module.exports = {
  FUTURE_TOLERANCE_S,
  DELAY_FLAG_S,
  DEFAULT_TZ,
  DEFAULT_POLICY,
  PLACES,
  forPlace,
  GOOD_ACCURACY_M,
  isTimeZone,
  wallClock,
  localDate,
  localTime,
  parseHHMM,
  daysBetween,
  minutesIntoDay,
  zonedInstant,
  timeCheck,
  strictest,
  shiftFor,
  projectDay,
};
