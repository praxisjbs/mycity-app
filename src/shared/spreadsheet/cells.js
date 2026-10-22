/**
 * Spreadsheet helpers: the pure primitives every spreadsheet artefact shares:
 * cell unwrapping, sheet naming, formula-injection locking, colour conversion,
 * the naira number format and timezone-correct date serials.
 *
 * PURE ON PURPOSE. Nothing here touches a client, a workbook context or the DB:
 * the builder (build.js), the CSV writer (csv.js), the parsers (parse.js) and
 * the import engine all call these, so a primitive shared this widely must not
 * grow opinions.
 */
"use strict";

/** Every wall-clock in this product is Lagos time (WAT, no daylight saving). */
const TIMEZONE = "Africa/Lagos";

/* ── Cell values ──────────────────────────────────────────────────────────── */

/**
 * Flatten one ExcelJS cell VALUE (not the cell) to a primitive-ish thing.
 *
 * Dates and numbers stay typed: that typing is the whole reason to prefer
 * .xlsx over CSV for machine-read files. Formulas yield their cached result,
 * rich text collapses to its runs, hyperlinks to their text. Returns null for
 * empty cells so callers can pick their own blank sentinel.
 */
function cellRawValue(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean")
    return v;
  if (typeof v === "object") {
    if (v.richText) return v.richText.map((t) => t.text).join("");
    if (v.text !== null && v.text !== undefined) return v.text; // hyperlink / rich text
    if (v.result !== undefined) return v.result; // formula's cached result
    if (v.formula !== undefined || v.sharedFormula !== undefined) return null; // a formula saved without its result: blank
    if (v.error) return ""; // #REF! etc.: an error is not a value
    if (v.hyperlink !== undefined) return v.hyperlink; // link object with no text
  }
  return String(v);
}

/**
 * Unwrap an ExcelJS CELL for the import parser: null for blanks, ISO string
 * for dates (import rows are plain, JSON-serialisable objects).
 */
function cellValue(cell) {
  const v = cellRawValue(cell ? cell.value : null);
  if (v === null) return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

/* ── Sheet names ──────────────────────────────────────────────────────────── */

/**
 * Sanitise + dedupe a sheet title: strip the characters Excel forbids in sheet
 * names ([ ] : * ? / \), collapse whitespace, cap at 31 chars.
 *
 * `taken` (optional Set of lower-cased names already used in this workbook)
 * makes the name unique by appending " (2)", " (3)"…; comparison is
 * case-insensitive because Excel resolves sheet references that way. When
 * `taken` is given the chosen name is ADDED to it, so consecutive calls for
 * one workbook cannot collide.
 */
function sheetName(name, { fallback = "Sheet", taken } = {}) {
  const clean =
    String(name ?? "")
      .replace(/[[\]:*?/\\]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 31) || fallback;
  if (!taken) return clean;
  let out = clean;
  let n = 2;
  while (taken.has(out.toLowerCase())) {
    const suffix = ` (${n})`;
    out = `${clean.slice(0, 31 - suffix.length)}${suffix}`;
    n += 1;
  }
  taken.add(out.toLowerCase());
  return out;
}

/* ── Formula-injection lock ──────────────────────────────────────────────── */

/**
 * Excel/Sheets/LibreOffice treat a value that STARTS with = + - @, tab or CR
 * as a formula when the file is opened. Cell contents in an ERP are
 * user-supplied (names, notes, reasons), so `=HYPERLINK(...)` typed into a
 * name field must not become live code on the reader's machine (OWASP "CSV
 * Injection"). One leading apostrophe neutralises it while still displaying
 * the original text; a phone number shows as '+2348031234567.
 *
 * STRINGS ONLY. A typed number/date/bool cannot be a formula, and prefixing
 * one would turn a summable amount into text.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function escapeFormula(v) {
  if (typeof v !== "string") return v;
  return FORMULA_LEAD.test(v) ? `'${v}` : v;
}

/* ── Colours ─────────────────────────────────────────────────────────────── */

/**
 * A hex colour (#RRGGBB, RRGGBB, #AARRGGBB, AARRGGBB) → Excel ARGB.
 * Anything else → null so the caller falls back to its default rather than
 * writing a fill Excel silently drops.
 */
function hexToArgb(hex) {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const body = m[1].toUpperCase();
  return body.length === 6 ? `FF${body}` : body;
}

/* ── Money format ────────────────────────────────────────────────────────── */

/**
 * The naira number format. The cell stays a raw number, so a column of amounts
 * SUMs; the sign is a quoted literal, which every Excel build renders the same
 * (unlike locale currency templates such as [$₦-...]).
 */
const MONEY_FORMAT = '"₦"#,##0.00;-"₦"#,##0.00';

/* ── Dates ───────────────────────────────────────────────────────────────── */

/**
 * Wall-clock parts of an instant in a timezone, via Intl: never the host's
 * own timezone, and never Date.toLocaleString's implicit one. A shift that
 * ends at midnight in Lagos must not print 23:00 the previous day because the
 * container runs in UTC.
 */
function wallClock(value, timezone = TIMEZONE) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/**
 * An ExcelJS-writable Date for a spreadsheet cell, in Lagos time.
 *
 * ExcelJS serialises a Date with UTC arithmetic, and an Excel serial is
 * timezone-less, so the instant must first be converted to the Lagos wall
 * clock, then rebuilt as a fake-UTC Date. Writing the raw instant would
 * silently display the container's UTC as if it were local time.
 *
 * `hasTime: false` (a calendar-date column) keeps only the wall date: a date
 * column has no instant to shift, and 2026-08-20 must survive any timezone.
 */
function serialDate(value, { timezone = TIMEZONE, hasTime = true } = {}) {
  if (value === null || value === undefined || value === "") return null;
  // A bare YYYY-MM-DD is a calendar date already: no tz conversion applies.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  if (m)
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const wall = wallClock(value, timezone);
  if (!wall) return null;
  return hasTime
    ? new Date(
        Date.UTC(
          wall.year,
          wall.month - 1,
          wall.day,
          wall.hour,
          wall.minute,
          wall.second,
        ),
      )
    : new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
}

/** "14/10/2026 15:42" in Lagos time: cover and footer text, not a cell. */
function formatInstant(value, timezone = TIMEZONE) {
  const wall = wallClock(value, timezone);
  if (!wall) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(wall.day)}/${p(wall.month)}/${wall.year} ${p(wall.hour)}:${p(wall.minute)}`;
}

/* ── Filenames ───────────────────────────────────────────────────────────── */

/**
 * Download filename with the date and, on staging, an unmistakable STAGING
 * segment: a payroll-looking file named like a live one is a hazard the moment
 * someone attaches it to a real email.
 */
function exportFilename({ base, env, extension, date = new Date() }) {
  // Bound before any regex work: `base` can be a person-chosen report name.
  const bounded = String(base || "export").slice(0, 80);
  const safe =
    bounded
      .replace(/[\\/:*?"<>|\r\n]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      // Trim the ends as two single-alternative anchored patterns (linear).
      .replace(/^[.-]+/, "")
      .replace(/[.-]+$/, "") || "export";
  // The one date in this product that stays ISO on purpose: `/` is a path
  // separator, and ISO makes a folder of exports sort into date order.
  const stamp = date instanceof Date ? serialIso(date) : String(date);
  return env === "staging"
    ? `${safe}-STAGING-${stamp}.${extension}`
    : `${safe}-${stamp}.${extension}`;
}

/** The Lagos calendar date of an instant, YYYY-MM-DD. */
function serialIso(date) {
  const w = wallClock(date);
  const p = (n) => String(n).padStart(2, "0");
  return `${w.year}-${p(w.month)}-${p(w.day)}`;
}

module.exports = {
  TIMEZONE,
  MONEY_FORMAT,
  FORMULA_LEAD,
  cellRawValue,
  cellValue,
  sheetName,
  escapeFormula,
  hexToArgb,
  serialDate,
  formatInstant,
  exportFilename,
};
