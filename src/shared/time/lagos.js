"use strict";
/**
 * The business clock. MyCity works on Africa/Lagos time, which is UTC+1 all
 * year (Nigeria has no daylight saving), so a fixed offset is exact and these
 * helpers stay pure: no time-zone database, no dependency on the server's TZ.
 *
 *   lagos.today()                          "2026-10-14"   the date in Lagos now
 *   lagos.dateOf(instant)                  "2026-10-14"   the Lagos date of a timestamp
 *   lagos.timeOf(instant)                  "07:05"
 *   lagos.instant("2026-10-14", "09:00")   Date for 09:00 in Lagos (08:00Z)
 *   lagos.startOfDay("2026-10-14")         Date for 00:00 in Lagos
 *   lagos.addDays("2026-10-14", 1)         "2026-10-15"
 *
 * Two kinds of time, never mixed:
 *   a business date   "YYYY-MM-DD", a `date` column, a calendar day (leave, payroll month,
 *                     attendance day). Arithmetic on it is date-only.
 *   an instant        a `timestamptz`, a JS Date (clock-in, created_at). Turned into a
 *                     business date only through dateOf(), never with toISOString().slice(0, 10),
 *                     which gives the UTC date and is wrong between 00:00 and 01:00 in Lagos.
 */
const OFFSET_MIN = 60;
const OFFSET_MS = OFFSET_MIN * 60_000;
const TIME_ZONE = "Africa/Lagos";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/** A Lagos wall-clock view of an instant, as a UTC Date (read with getUTC*). */
const shifted = (at) => new Date(new Date(at).getTime() + OFFSET_MS);

/** True for a real calendar date in YYYY-MM-DD form. */
function isDate(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function assertDate(s, label = "date") {
  if (!isDate(s)) throw new TypeError(`${label} must be a real date as YYYY-MM-DD, got ${JSON.stringify(s)}`);
  return s;
}

/** The Lagos business date of an instant. */
function dateOf(at = new Date()) {
  return shifted(at).toISOString().slice(0, 10);
}

/** Today in Lagos. */
function today(now = new Date()) {
  return dateOf(now);
}

/** "HH:MM" in Lagos for an instant. */
function timeOf(at) {
  return shifted(at).toISOString().slice(11, 16);
}

/**
 * The instant at a Lagos wall-clock time on a business date.
 * @param {string} date  YYYY-MM-DD
 * @param {string} [time] HH:MM or HH:MM:SS, default 00:00
 */
function instant(date, time = "00:00") {
  assertDate(date);
  const m = TIME_RE.exec(time);
  if (!m) throw new TypeError(`time must be HH:MM, got ${JSON.stringify(time)}`);
  const utc = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), +m[1], +m[2], +(m[3] || 0));
  return new Date(utc - OFFSET_MS);
}

const startOfDay = (date) => instant(date, "00:00");

/** The first instant of the NEXT Lagos day: use as an exclusive upper bound in SQL. */
const endOfDayExclusive = (date) => instant(addDays(date, 1), "00:00");

/** Date-only arithmetic. */
function addDays(date, n) {
  assertDate(date);
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Add calendar months, clamping to the month's last day (31 Jan + 1 month = 28 or 29 Feb).
 */
function addMonths(date, n) {
  assertDate(date);
  const y = +date.slice(0, 4);
  const m = +date.slice(5, 7) - 1 + n;
  const day = +date.slice(8, 10);
  const first = new Date(Date.UTC(y, m, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return first.toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a). */
function daysBetween(a, b) {
  assertDate(a, "from");
  assertDate(b, "to");
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** ISO weekday: 1 Monday … 7 Sunday. */
function weekday(date) {
  assertDate(date);
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** { year, month } of a business date. */
function yearMonth(date) {
  assertDate(date);
  return { year: +date.slice(0, 4), month: +date.slice(5, 7) };
}

/** First and last day of the date's month. */
function monthBounds(date) {
  const { year, month } = yearMonth(date);
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  return { first, last: addDays(addMonths(first, 1), -1) };
}

module.exports = {
  TIME_ZONE,
  OFFSET_MIN,
  isDate,
  assertDate,
  dateOf,
  today,
  timeOf,
  instant,
  startOfDay,
  endOfDayExclusive,
  addDays,
  addMonths,
  daysBetween,
  weekday,
  yearMonth,
  monthBounds,
};
