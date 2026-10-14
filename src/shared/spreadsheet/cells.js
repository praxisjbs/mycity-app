"use strict";
/**
 * Cell values in and out of spreadsheets, flattened one way everywhere, so a cell
 * cannot read two different ways in two places.
 *
 * In (reading a sheet): ExcelJS gives rich text, formulas, hyperlinks, errors and
 * dates as objects; cellValue() turns each into a plain value:
 *   rich text   → its text            formula     → its cached result
 *   hyperlink   → its display text    error (#N/A) → null
 *   date        → a JS Date (day-first-cells.js decides what date it is)
 *
 * Out (writing a sheet or a CSV): escapeFormula() stops spreadsheet formula injection.
 * A value a person typed ("=HYPERLINK(...)", "+234...", "@SUM") would run as a formula
 * when the export is opened in Excel; it is written with a leading apostrophe instead,
 * which Excel shows as text. Phone numbers stay readable ('+2348031234567).
 */

/** The plain value of an ExcelJS cell value. */
function plain(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v !== "object") return v;
  if (Array.isArray(v.richText)) return v.richText.map((r) => r.text || "").join("");
  if (Object.prototype.hasOwnProperty.call(v, "result")) return plain(v.result);
  if (Object.prototype.hasOwnProperty.call(v, "text") && Object.prototype.hasOwnProperty.call(v, "hyperlink")) return plain(v.text);
  if (Object.prototype.hasOwnProperty.call(v, "error")) return null;
  if (Object.prototype.hasOwnProperty.call(v, "sharedFormula")) return null;
  return null;
}

/**
 * The plain value of an ExcelJS cell's `value` (cell.value: the getter lives on the
 * prototype, so pass the value, not the cell). Strings trimmed; empty → null.
 */
function cellValue(value) {
  const v = plain(value);
  if (typeof v === "string") {
    const t = v.replace(/\u00a0/g, " ").trim();
    return t === "" ? null : t;
  }
  return v;
}

const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** A value safe to write into a cell: a string that would start a formula is quoted. */
function escapeFormula(v) {
  if (typeof v !== "string") return v;
  return FORMULA_LEAD.test(v) ? `'${v}` : v;
}

/**
 * A worksheet name Excel accepts: no []:*?/\, at most 31 characters, unique in `taken`.
 * @param {string} name
 * @param {Set<string>} [taken]  lower-cased names already used
 */
function sheetName(name, taken = new Set()) {
  let base = String(name || "Sheet").replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet";
  if (base.toLowerCase() === "history") base = "History 1";
  let candidate = base;
  for (let i = 2; taken.has(candidate.toLowerCase()); i += 1) {
    const suffix = ` (${i})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/** "#RRGGBB" → "FFRRGGBB" (ExcelJS colours). */
function argb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) throw new Error(`cells: "${hex}" is not a colour`);
  return `FF${m[1].toUpperCase()}`;
}

module.exports = { cellValue, escapeFormula, sheetName, argb, FORMULA_LEAD };
