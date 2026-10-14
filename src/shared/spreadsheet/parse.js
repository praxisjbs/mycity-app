"use strict";
/**
 * Read an uploaded sheet (.xlsx or .csv) into plain grids of cell values.
 *
 *   const book = await parseUpload({ buffer, filename });
 *   // { format: "xlsx", sheets: [{ name: "Staff", rows: [[...], [...]] }] }
 *
 * Rows are arrays (column 0 first), not objects: real sheets have titles, notes and
 * merged banners above their header, so finding the header row is the import engine's
 * job (shared/import/mapping.js), not this file's. Empty trailing rows and columns are
 * trimmed; a "Reference" sheet (the guidance sheet our templates carry) is skipped.
 *
 * An .xlsx is a ZIP: a small file can expand into an enormous workbook. So the bounds
 * are hard and loud: 10 MB of file, 100 sheets, 100,000 rows in total, 256 columns.
 * Past any of them the upload is refused with a 413 saying which, before the process
 * runs out of memory.
 */
const ExcelJS = require("exceljs");
const { AppError } = require("../errors");
const { sniff } = require("../files/sniff");
const { cellValue } = require("./cells");
const { parseCsv } = require("./csv");

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_SHEETS = 100;
const MAX_ROWS = 100_000;
const MAX_COLS = 256;
const REFERENCE_SHEET = "reference";

const tooLarge = (what) => new AppError("SHEET_TOO_LARGE", `This file is too large to import: ${what}.`, 413);

function trimGrid(rows) {
  const out = rows.map((r) => {
    let end = r.length;
    while (end > 0 && (r[end - 1] === null || r[end - 1] === undefined || r[end - 1] === "")) end -= 1;
    return r.slice(0, end);
  });
  while (out.length && out[out.length - 1].length === 0) out.pop();
  return out;
}

async function parseXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new AppError("SHEET_UNREADABLE", "This spreadsheet could not be read. Open it in Excel, save it again as .xlsx, and retry.", 422);
  }
  if (wb.worksheets.length > MAX_SHEETS) throw tooLarge(`more than ${MAX_SHEETS} sheets`);
  const sheets = [];
  let total = 0;
  for (const ws of wb.worksheets) {
    if (ws.state && ws.state !== "visible") continue;
    if (ws.name.trim().toLowerCase() === REFERENCE_SHEET) continue;
    if (ws.columnCount > MAX_COLS) throw tooLarge(`more than ${MAX_COLS} columns on "${ws.name}"`);
    const rows = [];
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      total += 1;
      if (total > MAX_ROWS) throw tooLarge(`more than ${MAX_ROWS.toLocaleString("en-NG")} rows`);
      const cells = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        if (col <= MAX_COLS) cells[col - 1] = cellValue(cell.value);
      });
      rows[rowNumber - 1] = Array.from(cells, (v) => (v === undefined ? null : v));
    });
    sheets.push({ name: ws.name, rows: trimGrid(Array.from(rows, (r) => r || [])) });
  }
  return sheets;
}

/**
 * @param {{buffer: Buffer, filename?: string}} file
 * @returns {Promise<{format: "xlsx"|"csv", sheets: Array<{name: string, rows: Array<Array<*>>}>}>}
 */
async function parseUpload({ buffer, filename = "" }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new AppError("FILE_REQUIRED", "The file is empty", 422);
  if (buffer.length > MAX_BYTES) throw tooLarge(`over ${MAX_BYTES / 1024 / 1024} MB`);
  const type = sniff(buffer, filename);
  if (type.ext === "xlsx") return { format: "xlsx", sheets: await parseXlsx(buffer) };
  if (type.ext === "csv" || (type.kind === "text" && /\.csv$/i.test(filename))) {
    const rows = parseCsv(buffer);
    if (rows.length > MAX_ROWS) throw tooLarge(`more than ${MAX_ROWS.toLocaleString("en-NG")} rows`);
    if (rows.some((r) => r.length > MAX_COLS)) throw tooLarge(`more than ${MAX_COLS} columns`);
    return { format: "csv", sheets: [{ name: "CSV", rows: trimGrid(rows.map((r) => r.map((c) => (c.trim() === "" ? null : c.trim())))) }] };
  }
  if (type.kind === "legacy_office") throw new AppError("SHEET_OLD_FORMAT", "This is an old .xls file. Save it as .xlsx and upload it again.", 415);
  throw new AppError("SHEET_TYPE", "Upload an .xlsx or .csv file.", 415);
}

module.exports = { parseUpload, MAX_BYTES, MAX_SHEETS, MAX_ROWS, MAX_COLS };
