/**
 * CSV half of the spreadsheet service: same header text, same cell semantics
 * as the xlsx builder (Yes/No bools, Lagos dates, formula-injection lock),
 * because a report exported as csv and as xlsx is ONE export in two formats,
 * not two exports that happen to share a name. What CSV cannot carry (brand
 * colours, typed cells, dropdowns) is a format limit, not a divergence:
 * numbers are written raw so they land as numbers.
 *
 * UTF-8 WITH BOM, always: Windows Excel reads a BOM-less CSV in the legacy
 * code page, which turns "Adébáyọ̀" into mojibake.
 *
 * Reading: RFC 4180 (quoted fields, "" escapes, CRLF/LF/CR, BOM). The
 * delimiter is whichever of "," ";" or tab splits the first line most, since
 * Excel in some locales saves with ";". parseCsvGrid returns rows of strings
 * (the import engine finds the header row itself); parseCsv keys each row by
 * the first row.
 */
"use strict";

const { workbookContext } = require("./context");
const { cellSpec, headerText } = require("./build");

/** Upload ceiling: the parse loop is linear in the text, which a person controls. */
const CSV_MAX_CHARS = 5 * 1024 * 1024;

/** Quote a CSV cell per RFC 4180 (escape embedded quotes, wrap if needed). */
function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",;\t\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serial dates become day-first text, matching the number format the xlsx
 *  sibling puts on the same column.
 *
 *  UTC getters: the fake-UTC Date built by serialDate carries the Lagos wall
 *  clock in its UTC fields. Reading it with local getters would undo that and
 *  move the day. A datetime column keeps its minutes; a date column stops at
 *  the day. */
function csvText(v, fmt) {
  if (v instanceof Date) {
    const pad = (n) => String(n).padStart(2, "0");
    const day = `${pad(v.getUTCDate())}/${pad(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
    return fmt && fmt.includes("hh")
      ? `${day} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`
      : day;
  }
  return v;
}

/**
 * Build a CSV buffer. `columns` is the same ColumnSpec list the xlsx builder
 * takes; only the presentation differs (no numFmt, no colours).
 * @param {{columns:import("./build").ColumnSpec[], rows?:Object[], context?:Object}} opts
 * @returns {Buffer}
 */
function buildCsv({ columns, rows = [], context } = {}) {
  const ctx = context || workbookContext();
  const specs = columns.map((c) => cellSpec(c, ctx));
  const headers = columns.map((c) => csvCell(headerText(c)));
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      columns
        .map((c, i) => csvCell(csvText(specs[i].coerce(row[c.key]), specs[i].fmt)))
        .join(","),
    );
  }
  return Buffer.from(`\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
}

function tooLarge() {
  const e = new Error("Spreadsheet is too large. The limit is 5 MB");
  e.status = 413;
  e.code = "SHEET_TOO_LARGE";
  return e;
}

/** The delimiter that splits the first line most, outside quotes. */
function detectDelimiter(text) {
  const end = text.search(/\r|\n/);
  const first = end === -1 ? text : text.slice(0, end);
  let best = ",";
  let bestCount = 0;
  for (const d of [",", ";", "\t"]) {
    let count = 0;
    let quoted = false;
    for (const ch of first) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) count += 1;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Parse CSV text into rows of strings. Trailing fully blank rows are dropped.
 * @param {string|Buffer} input
 * @param {{delimiter?: string}} [opts]
 * @returns {string[][]}
 */
function parseCsvGrid(input, { delimiter } = {}) {
  let text = Buffer.isBuffer(input) ? input.toString("utf8") : String(input ?? "");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  if (text.length > CSV_MAX_CHARS) throw tooLarge();
  const d = delimiter || detectDelimiter(text);

  const grid = [];
  let row = [];
  let field = "";
  let quoted = false;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    grid.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === d) {
      endField();
    } else if (ch === "\n") {
      endRow();
    } else if (ch === "\r") {
      if (text[i + 1] !== "\n") endRow(); // lone CR = EOL; CRLF handled by \n
    } else field += ch;
  }
  if (field !== "" || row.length) endRow(); // flush trailing field/row
  while (grid.length && grid[grid.length - 1].every((c) => String(c ?? "").trim() === "")) grid.pop();
  return grid;
}

/**
 * Parse CSV text into an array of objects keyed by the trimmed header row.
 * Fully blank rows skipped.
 * @param {string|Buffer} input
 * @returns {Object[]}
 */
function parseCsv(input) {
  const grid = parseCsvGrid(input);
  if (!grid.length) return [];
  const headers = grid[0].map((h) => String(h ?? "").trim());
  const out = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    if (cells.every((c) => String(c ?? "").trim() === "")) continue;
    const obj = {};
    headers.forEach((h, idx) => {
      if (h) obj[h] = cells[idx] ?? "";
    });
    out.push(obj);
  }
  return out;
}

module.exports = { buildCsv, parseCsv, parseCsvGrid, detectDelimiter, CSV_MAX_CHARS };
