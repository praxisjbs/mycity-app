"use strict";
/**
 * Dates in spreadsheets, read and written day-first (gate 15).
 *
 * What the import engine reads out of a person's sheet. A date cell can arrive three
 * ways, and each has a trap:
 *  - an Excel date cell: ExcelJS gives a JS Date at UTC midnight of that day, which
 *    cells.cellValue() hands on as its ISO string (the calendar date is the UTC date;
 *    converting it to Lagos would be wrong only by accident, never on purpose);
 *  - a number: an Excel serial (days since 30 December 1899, with Excel's famous
 *    29 February 1900 that never existed), from sheets that lost their formatting;
 *  - text: typed by a person in Nigeria, so day-first. "03/07/1991" is 3 July.
 *    "13/31/1991" is an error, never a guess, and so is any ambiguous or impossible date.
 *
 * Writing dates into a sheet is the builder's job (build.js "date" and "datetime"
 * columns, through cells.serialDate).
 */
const dayFirst = require("../time/day-first");
const lagos = require("../time/lagos");

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
  // An Excel date cell, as cells.cellValue() hands it on: midnight UTC of the day.
  if (/^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z$/.test(text)) return readDate(text.slice(0, 10));
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

module.exports = { fromSerial, toSerial, readDate };
