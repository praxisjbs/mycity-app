"use strict";
/**
 * Dates as a person reads them: day first (README §7 rule 2, gate 15).
 *
 *   formatDate("2026-10-09")               "09/10/2026"
 *   formatDateTime(createdAt)              "09/10/2026 14:05"    Lagos time
 *   formatLongDate("2026-10-09")           "9 October 2026"      letters, PDFs
 *   formatMonth("2026-10-01")              "October 2026"        payroll month
 *   parseDayFirst("9/10/2026")             "2026-10-09"           a typed or imported cell
 *
 * Everything a person reads (mail, PDFs, exports, notification text) goes
 * through here. The wire and the database stay ISO. Nothing uses
 * toLocaleDateString(), whose output depends on the server's locale.
 */
const { assertDate, dateOf, timeOf, isDate } = require("./lagos");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
  "October", "November", "December"];

const toDate = (value) => (value instanceof Date ? dateOf(value) : assertDate(String(value).slice(0, 10)));

/** "dd/mm/yyyy" from a business date or an instant. */
function formatDate(value) {
  if (value === null || value === undefined || value === "") return "";
  const d = toDate(value);
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

/** "dd/mm/yyyy HH:MM" in Lagos time, from an instant. */
function formatDateTime(value) {
  if (value === null || value === undefined || value === "") return "";
  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) throw new TypeError(`formatDateTime: not a date/time: ${JSON.stringify(value)}`);
  return `${formatDate(dateOf(at))} ${timeOf(at)}`;
}

/** "9 October 2026". */
function formatLongDate(value) {
  if (value === null || value === undefined || value === "") return "";
  const d = toDate(value);
  return `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
}

/** "October 2026". */
function formatMonth(value) {
  const d = toDate(value);
  return `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
}

/**
 * Read a day-first date a person typed or a sheet held: "09/10/2026",
 * "9/10/2026", "09-10-2026", "09.10.2026". Two-digit years are refused (is 26
 * 1926 or 2026?). An ISO date passes through. Anything else, or an impossible
 * date (31/02/2026), is null: the caller reports it against the field.
 * @param {string} text
 * @returns {string|null} YYYY-MM-DD
 */
function parseDayFirst(text) {
  if (typeof text !== "string") return null;
  const s = text.trim();
  if (isDate(s)) return s;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return isDate(iso) ? iso : null;
}

module.exports = { formatDate, formatDateTime, formatLongDate, formatMonth, parseDayFirst, MONTHS };
