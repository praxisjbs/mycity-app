"use strict";
/**
 * Working days. Which days of the week are worked, and which dates are public
 * holidays, are SETTINGS (Settings → Attendance Policy), never a hard-coded
 * Monday to Friday (BACKEND_GUIDE §4).
 *
 *   const cal = await workingWeek.loadCalendar(client);        // once per request or job
 *   workingWeek.isWorkingDay("2026-10-01", cal)                // false: Independence Day
 *   workingWeek.addWorkingDays("2026-10-14", 5, cal)           // SLA due dates, leave end dates
 *   workingWeek.countWorkingDays("2026-10-01", "2026-10-31", cal)   // payroll proration, leave days
 *
 * The calculations are pure (a calendar object in, dates out) so they are
 * tested without a database. loadCalendar() reads the two settings tables and
 * caches the result for a minute per process; a settings change calls
 * invalidateCalendar().
 *
 * Tables read (migration 0050):
 *   working_week     weekday (1 Monday … 7 Sunday), is_working_day, starts_at, ends_at
 *   public_holiday   holiday_date, name
 *
 * With no working_week rows (a fresh database) the week is Monday to Friday,
 * 09:00 to 17:00, so nothing divides by zero before Settings is filled in.
 */
const { assertDate, addDays, weekday, daysBetween } = require("./lagos");

const DEFAULT_WEEK = Object.freeze({ days: [1, 2, 3, 4, 5], starts_at: "09:00", ends_at: "17:00" });
const CACHE_MS = 60_000;
const MAX_SCAN_DAYS = 3660;

/**
 * @typedef {object} Calendar
 * @property {Set<number>} days         ISO weekdays that are worked
 * @property {Set<string>} holidays     YYYY-MM-DD
 * @property {Map<string,string>} holidayNames
 * @property {Record<number,{starts_at:string, ends_at:string}>} hours
 */

/** Build a calendar from plain values (tests, and loadCalendar). */
function makeCalendar({ days = DEFAULT_WEEK.days, holidays = [], hours = {} } = {}) {
  const names = new Map();
  for (const h of holidays) {
    if (typeof h === "string") names.set(assertDate(h, "holiday"), "");
    else names.set(assertDate(h.holiday_date, "holiday"), h.name || "");
  }
  const set = new Set(days.map(Number));
  if (set.size === 0) throw new Error("working week: at least one day must be worked");
  return { days: set, holidays: new Set(names.keys()), holidayNames: names, hours };
}

function isWorkingDay(date, cal) {
  return cal.days.has(weekday(date)) && !cal.holidays.has(date);
}

/** Why a date is not worked: "weekend", the holiday's name, or null when it is worked. */
function whyNotWorking(date, cal) {
  if (cal.holidays.has(date)) return cal.holidayNames.get(date) || "public holiday";
  if (!cal.days.has(weekday(date))) return "weekend";
  return null;
}

/** The date itself when worked, otherwise the next worked date. */
function nextWorkingDay(date, cal) {
  let d = assertDate(date);
  for (let i = 0; i < MAX_SCAN_DAYS; i += 1) {
    if (isWorkingDay(d, cal)) return d;
    d = addDays(d, 1);
  }
  throw new Error("working week: no working day within ten years");
}

/**
 * Move n working days from `date` (n may be negative). Day 0 is `date` itself
 * whether or not it is worked; "5 working days from Friday" counts Monday as day 1.
 */
function addWorkingDays(date, n, cal) {
  let d = assertDate(date);
  const step = n >= 0 ? 1 : -1;
  let left = Math.abs(n);
  for (let guard = 0; left > 0; guard += 1) {
    if (guard > MAX_SCAN_DAYS) throw new Error("working week: no working day within ten years");
    d = addDays(d, step);
    if (isWorkingDay(d, cal)) left -= 1;
  }
  return d;
}

/** Worked days from `from` to `to`, both included. Zero when to is before from. */
function countWorkingDays(from, to, cal) {
  const span = daysBetween(from, to);
  if (span < 0) return 0;
  if (span > MAX_SCAN_DAYS) throw new Error("working week: range longer than ten years");
  let n = 0;
  for (let i = 0, d = from; i <= span; i += 1, d = addDays(d, 1)) if (isWorkingDay(d, cal)) n += 1;
  return n;
}

/* ---------------- loading ---------------- */

let cached = null;

/**
 * The calendar from Settings, cached for a minute.
 * @param {{query: Function}} client
 */
async function loadCalendar(client, { now = Date.now() } = {}) {
  if (cached && now - cached.at < CACHE_MS) return cached.cal;
  const { rows: week } = await client.query(
    "SELECT weekday, is_working_day, starts_at, ends_at FROM working_week ORDER BY weekday",
  );
  const { rows: hols } = await client.query(
    "SELECT holiday_date, name FROM public_holiday ORDER BY holiday_date",
  );
  const hours = {};
  for (const r of week) hours[r.weekday] = { starts_at: String(r.starts_at).slice(0, 5), ends_at: String(r.ends_at).slice(0, 5) };
  const days = week.length ? week.filter((r) => r.is_working_day).map((r) => r.weekday) : DEFAULT_WEEK.days;
  const cal = makeCalendar({ days, holidays: hols.map((h) => ({ holiday_date: String(h.holiday_date).slice(0, 10), name: h.name })), hours });
  cached = { at: now, cal };
  return cal;
}

/** After a working-week or holiday change. */
function invalidateCalendar() {
  cached = null;
}

module.exports = {
  DEFAULT_WEEK,
  makeCalendar,
  isWorkingDay,
  whyNotWorking,
  nextWorkingDay,
  addWorkingDays,
  countWorkingDays,
  loadCalendar,
  invalidateCalendar,
};
