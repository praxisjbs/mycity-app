"use strict";
/**
 * CSV in and out (RFC 4180).
 *
 * Reading: a UTF-8 byte-order mark is dropped; the delimiter is the one of ",", ";" or
 * tab that splits the first line most (Excel in some locales saves with ";"); quoted
 * fields may hold delimiters, quotes ("") and line breaks. Returns rows of strings, the
 * same grid shape parse.js returns for an .xlsx, so the import engine does not care
 * which it was.
 *
 * Writing: every field quoted when it needs to be, CRLF line ends, a byte-order mark so
 * Excel opens accents correctly, and formula-looking text escaped (cells.escapeFormula).
 */
const { escapeFormula } = require("./cells");

const MAX_CELLS = 100_000 * 256;

function detectDelimiter(text) {
  const first = text.split(/\r?\n/, 1)[0] || "";
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
 * @param {string|Buffer} input
 * @param {{delimiter?: string}} [opts]
 * @returns {string[][]} rows of cells; trailing empty rows dropped
 */
function parseCsv(input, { delimiter } = {}) {
  let text = Buffer.isBuffer(input) ? input.toString("utf8") : String(input || "");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const d = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let cells = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === d) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      cells += row.length;
      if (cells > MAX_CELLS) throw Object.assign(new Error("This CSV is too large to read"), { status: 413 });
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === "")) rows.pop();
  return rows;
}

function csvField(v) {
  if (v === null || v === undefined) return "";
  const s = String(escapeFormula(typeof v === "string" ? v : String(v)));
  return /[",;\t\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * @param {Array<{key: string, label: string, format?: (v) => string}>} columns
 * @param {Array<object>} rows
 * @returns {Buffer} UTF-8 with a byte-order mark
 */
function buildCsv(columns, rows) {
  const lines = [columns.map((c) => csvField(c.label)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvField(c.format ? c.format(r[c.key], r) : r[c.key])).join(","));
  return Buffer.from(`\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
}

module.exports = { parseCsv, buildCsv, detectDelimiter };
