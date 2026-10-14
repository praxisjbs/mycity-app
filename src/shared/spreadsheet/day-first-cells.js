"use strict";
/**
 * Dates in spreadsheets, read and written day-first (gate 15).
 *
 * Reading, a date cell can arrive three ways, and each has a trap:
 *  - an Excel date cell: ExcelJS gives a JS Date at UTC midnight of that day (the
 *    calendar date is the UTC date; converting it to Lagos would be wrong only by
 *    accident, never on purpose);
 *  - a number: an Excel serial (days since 30 December 1899, with Excel's famous
 *    29 February 1900 that never existed), from sheets that lost their formatting;
 *  - text: typed by a person in Nigeria, so day-first. "03/07/1991" is 3 July.
 *    "13/31/1991" is an error, never a guess, and so is any ambiguous or impossible date.
 *
 * Writing: a real Excel date (so it sorts and filters) shown as dd/mm/yyyy.
 */
const dayFirst = require("../time/day-first");
const lagos = require("../time/lagos");

const DATE_FORMAT = "dd/mm/yyyy";
const DATETIME_FORMAT = "dd/mm/yyyy hh:mm";
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

const pad = (n) => String(n).padStart(2, "0");
const isoOfUtc = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Excel serial → "YYYY-MM-DD", or null when it is not a plausible date. */
function fromSerial(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n) || n < 1 || n > 2958465) return null;
  const days = Math.floor(n);
  // Serials from 61 on are one too high because of the 1900 leap-year bug.
  const d = new Date(EXCEL_EPOCH + (days >= 61 ? days : days + 1) * 86_400_000);
  return isoOfUtc(d);
}

/** "YYYY-MM-DD" → Excel serial. */
function toSerial(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const days = Math.round((Date.UTC(y, m - 1, d) - EXCEL_EPOCH) / 86_400_000);
  return days < 61 ? days - 1 : days;
}

/**
 * A cell value to a business date.
 * @param {Date|number|string|null} value  from cells.cellValue()
 * @returns {{date: string|null, error: string|null}}  date "YYYY-MM-DD"
 */
function readDate(value) {
  if (value === null || value === undefined || value === "") return { date: null, error: null };
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { date: null, error: "is not a date" };
    return { date: isoOfUtc(value), error: null };
  }
  if (typeof value === "number") {
    const iso = fromSerial(value);
    return iso ? { date: iso, error: null } : { date: null, error: "is not a date" };
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return lagos.isDate(text) ? { date: text, error: null } : { date: null, error: "is not a real date" };
  }
  if (/^\d+(\.\d+)?$/.test(text)) {
    const iso = fromSerial(Number(text));
    return iso ? { date: iso, error: null } : { date: null, error: "is not a date" };
  }
  try {
    const iso = dayFirst.parseDayFirst(text);
    return iso ? { date: iso, error: null } : { date: null, error: "should be day-first, like 03/07/1991" };
  } catch (err) {
    return { date: null, error: err.message || "is not a date" };
  }
}

/** A value to write into a date cell: a JS Date at UTC midnight of the business date. */
function writeDate(iso) {
  if (!iso) return null;
  const s = String(iso).slice(0, 10);
  if (!lagos.isDate(s)) throw new Error(`day-first-cells: "${iso}" is not a date`);
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** An instant, written as its Lagos wall-clock time (Excel has no time zones). */
function writeDateTime(instant) {
  if (!instant) return null;
  const at = instant instanceof Date ? instant : new Date(instant);
  const shifted = new Date(at.getTime() + lagos.OFFSET_MIN * 60_000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), shifted.getUTCHours(), shifted.getUTCMinutes()));
}

module.exports = { DATE_FORMAT, DATETIME_FORMAT, fromSerial, toSerial, readDate, writeDate, writeDateTime };
