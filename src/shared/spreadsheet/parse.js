/**
 * Workbook/xlsx parsing: the upload half of the spreadsheet service.
 *
 * Two readers over the same cell flattening (cells.cellValue), so an ExcelJS
 * rich-text or formula cell can never parse two different ways:
 *
 *   parseUpload({ buffer })   files WE HANDED OUT (templates) or files shaped
 *                             like them: row 1 is the header, by construction.
 *                             Rows come back keyed by header.
 *   readSheets({ buffer })    any sheet a person brings to the import engine:
 *                             titles, notes and merged banners may sit above the
 *                             header, so rows come back as plain grids and the
 *                             engine finds the header row (shared/import/mapping).
 */
"use strict";

const ExcelJS = require("exceljs");
const { AppError } = require("../errors");
const { sniff } = require("../files/sniff");
const { cellValue, cellRawValue } = require("./cells");
const { parseCsv, parseCsvGrid } = require("./csv");

const REFERENCE_SHEET = "Reference";

/* ── Upload ceilings ────────────────────────────────────────────────────────
 * An .xlsx is a ZIP: a small buffer can expand into an enormous document.
 * ExcelJS decompresses the whole archive on load, so the honest bounds are
 * (a) a compressed-size cap at the door and (b) sheet/row/column caps that
 * stop the materialisation into JS objects before a workbook built as a bomb
 * takes the process down. Generous against real imports (registers in the low
 * thousands of rows) and loud when tripped.
 */
const XLSX_MAX_BYTES = 10 * 1024 * 1024;
const MAX_SHEETS = 100;
const MAX_ROWS = 100000;
const MAX_COLS = 256;

const tooLarge = (what) => new AppError("SHEET_TOO_LARGE", `This file is too large to import: ${what}.`, 413);

async function loadWorkbook(buffer) {
  if (buffer && buffer.length > XLSX_MAX_BYTES) throw tooLarge(`over ${XLSX_MAX_BYTES / 1024 / 1024} MB`);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new AppError("SHEET_UNREADABLE", "This spreadsheet could not be read. Open it in Excel, save it again as .xlsx, and retry.", 422);
  }
  if (wb.worksheets.length > MAX_SHEETS) throw tooLarge(`more than ${MAX_SHEETS} sheets`);
  return wb;
}

const isGuidance = (ws) => ws.name.trim().toLowerCase() === REFERENCE_SHEET.toLowerCase();

/**
 * Parse an uploaded workbook into { sheetName: rows[] }, where each row is an
 * object keyed by the (trimmed) header cells. Blank rows are skipped; cell
 * values are coerced to primitives (rich text / formula results unwrapped).
 * The Reference sheet is skipped: it is guidance, never data.
 * @param {Buffer} buffer
 * @returns {Promise<Record<string, Object[]>>}
 */
async function parseWorkbook(buffer) {
  const wb = await loadWorkbook(buffer);
  const out = {};
  let total = 0;
  wb.eachSheet((ws) => {
    if (isGuidance(ws)) return;
    const headers = [];
    ws.getRow(1).eachCell((cell, col) => {
      if (col > MAX_COLS) return;
      headers[col] = String(cellValue(cell) ?? "").trim();
    });
    const rows = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      total += 1;
      if (total > MAX_ROWS) throw tooLarge(`more than ${MAX_ROWS.toLocaleString("en-NG")} rows`);
      const obj = {};
      let any = false;
      row.eachCell({ includeEmpty: false }, (cell, col) => {
        if (col > MAX_COLS) return;
        const key = headers[col];
        if (!key) return;
        const v = cellValue(cell);
        if (v !== null && v !== undefined && v !== "") any = true;
        obj[key] = v;
      });
      if (any) rows.push(obj);
    });
    out[ws.name] = rows;
  });
  return out;
}

/** An .xlsx is a ZIP: its first bytes are the local-file-header magic "PK". */
function looksLikeXlsx(buffer) {
  return (
    Buffer.isBuffer(buffer) &&
    buffer.length >= 2 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b
  );
}

/**
 * Parse an uploaded file (CSV or .xlsx) into a single array of header-keyed
 * rows. Format is detected by content, so the same endpoint accepts either;
 * the filename is advisory only.
 * @param {{buffer:Buffer, filename?:string}} opts
 * @returns {Promise<Object[]>}
 */
async function parseUpload({ buffer, filename = "" }) {
  if (looksLikeXlsx(buffer)) {
    const sheets = await parseWorkbook(buffer);
    const names = Object.keys(sheets);
    return names.length ? sheets[names[0]] : [];
  }
  void filename;
  return parseCsv(buffer);
}

/* ── Grids for the import engine ─────────────────────────────────────────── */

/** Drop empty trailing cells and rows. */
function trimGrid(rows) {
  const out = rows.map((r) => {
    let end = r.length;
    while (end > 0 && (r[end - 1] === null || r[end - 1] === undefined || r[end - 1] === "")) end -= 1;
    return r.slice(0, end);
  });
  while (out.length && out[out.length - 1].length === 0) out.pop();
  return out;
}

/** A grid cell: strings trimmed (non-breaking spaces too), blank → null. Dates stay
 *  Date objects here: the import engine tells a date cell from text a person typed. */
function gridCell(v) {
  if (typeof v !== "string") return v === undefined ? null : v;
  const t = v.replace(/\u00A0/g, " ").trim();
  return t === "" ? null : t;
}

async function xlsxGrids(buffer) {
  const wb = await loadWorkbook(buffer);
  const sheets = [];
  let total = 0;
  for (const ws of wb.worksheets) {
    if (ws.state && ws.state !== "visible") continue;
    if (isGuidance(ws)) continue;
    if (ws.columnCount > MAX_COLS) throw tooLarge(`more than ${MAX_COLS} columns on "${ws.name}"`);
    const rows = [];
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      total += 1;
      if (total > MAX_ROWS) throw tooLarge(`more than ${MAX_ROWS.toLocaleString("en-NG")} rows`);
      const cells = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        if (col <= MAX_COLS) cells[col - 1] = gridCell(cellRawValue(cell.value));
      });
      rows[rowNumber - 1] = Array.from(cells, (v) => (v === undefined ? null : v));
    });
    sheets.push({ name: ws.name, rows: trimGrid(Array.from(rows, (r) => r || [])) });
  }
  return sheets;
}

/**
 * Every visible data sheet of an upload as a grid.
 * @param {{buffer: Buffer, filename?: string}} file
 * @returns {Promise<{format: "xlsx"|"csv", sheets: Array<{name: string, rows: Array<Array<*>>}>}>}
 */
async function readSheets({ buffer, filename = "" }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new AppError("FILE_REQUIRED", "The file is empty", 422);
  if (buffer.length > XLSX_MAX_BYTES) throw tooLarge(`over ${XLSX_MAX_BYTES / 1024 / 1024} MB`);
  const type = sniff(buffer, filename);
  if (type.ext === "xlsx") return { format: "xlsx", sheets: await xlsxGrids(buffer) };
  if (type.ext === "csv" || (type.kind === "text" && /\.csv$/i.test(filename))) {
    let rows;
    try {
      rows = parseCsvGrid(buffer);
    } catch (err) {
      if (err.code === "SHEET_TOO_LARGE") throw tooLarge("over 5 MB of text");
      throw err;
    }
    if (rows.length > MAX_ROWS) throw tooLarge(`more than ${MAX_ROWS.toLocaleString("en-NG")} rows`);
    if (rows.some((r) => r.length > MAX_COLS)) throw tooLarge(`more than ${MAX_COLS} columns`);
    return { format: "csv", sheets: [{ name: "CSV", rows: trimGrid(rows.map((r) => r.map(gridCell))) }] };
  }
  if (type.kind === "legacy_office") throw new AppError("SHEET_OLD_FORMAT", "This is an old .xls file. Save it as .xlsx and upload it again.", 415);
  throw new AppError("SHEET_TYPE", "Upload an .xlsx or .csv file.", 415);
}

module.exports = {
  parseWorkbook,
  parseUpload,
  readSheets,
  looksLikeXlsx,
  XLSX_MAX_BYTES,
  MAX_SHEETS,
  MAX_ROWS,
  MAX_COLS,
};
