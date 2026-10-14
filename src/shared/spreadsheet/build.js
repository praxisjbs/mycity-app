"use strict";
/**
 * Write .xlsx files: list exports, reports, import templates and import error files.
 *
 *   const buffer = await buildWorkbook({
 *     sheets: [{
 *       name: "Employees",
 *       columns: [
 *         { key: "number", label: "Staff ID" },
 *         { key: "full_name", label: "Name", width: 28 },
 *         { key: "start_date", label: "Start Date", type: "date" },
 *         { key: "gross_monthly", label: "Gross Monthly", type: "money" },
 *         { key: "work_pattern", label: "Work Pattern", type: "enum", options: ["On-site", "Hybrid", "Remote"] },
 *       ],
 *       rows,
 *     }],
 *     reference: [{ column: "Start Date", required: true, rule: "Day-first, like 03/07/2026", example: "03/11/2026" }],
 *   });
 *
 * House rules, so every export looks and reads the same:
 *  - Row 1 is the header: City Green, white bold text, frozen, with filters. Nothing sits
 *    above it, so an export can be edited and imported straight back.
 *  - Money is a number cell shown "₦#,##0.00" (it sums in Excel); the value comes from a
 *    decimal string, never rounded on the way.
 *  - Dates are real date cells shown dd/mm/yyyy; date-times are Lagos wall-clock time.
 *  - Text that would start a formula is escaped (cells.escapeFormula).
 *  - An enum column gets a dropdown of its options.
 *  - A Reference sheet, when given, lists each column's rules and is protected, so a
 *    template explains itself and cannot be edited by accident.
 *  - On staging, every sheet tab is red and the workbook is titled STAGING, so an export
 *    from the test system is never mistaken for live data.
 *
 * Rows are whatever the caller passes; this file never pages or queries. An export is
 * built from pages of 25 by the caller, or by a job for a large set (README §7).
 */
const ExcelJS = require("exceljs");
const { config } = require("../../config/env");
const { escapeFormula, sheetName, argb } = require("./cells");
const { writeDate, writeDateTime, DATE_FORMAT, DATETIME_FORMAT } = require("./day-first-cells");

const BRAND = { header: "#014339", headerText: "#FFFFFF", rule: "#FFDF55", staging: "#DA1E10" };
const MONEY_FORMAT = '"₦"#,##0.00;-"₦"#,##0.00';
const TYPES = new Set(["text", "number", "integer", "money", "date", "datetime", "boolean", "enum", "raw"]);
const MAX_ROWS = 100_000;

function cellFor(type, value) {
  if (value === null || value === undefined || value === "") return null;
  switch (type) {
    case "money": {
      const s = String(value);
      if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`buildWorkbook: "${s}" is not an amount`);
      return Number(s);
    }
    case "number":
    case "integer":
      return Number(value);
    case "date":
      return writeDate(value);
    case "datetime":
      return writeDateTime(value);
    case "boolean":
      return value === true ? "Yes" : value === false ? "No" : escapeFormula(String(value));
    case "raw":
      // A value as the person gave it (the import error file): numbers stay numbers.
      return typeof value === "number" && Number.isFinite(value) ? value : escapeFormula(String(value));
    default:
      return escapeFormula(typeof value === "string" ? value : String(value));
  }
}

function numFmt(type) {
  if (type === "money") return MONEY_FORMAT;
  if (type === "date") return DATE_FORMAT;
  if (type === "datetime") return DATETIME_FORMAT;
  if (type === "integer") return "0";
  return undefined;
}

function checkColumns(name, columns) {
  if (!Array.isArray(columns) || columns.length === 0) throw new Error(`buildWorkbook: sheet "${name}" needs columns`);
  for (const c of columns) {
    if (!c.key || !c.label) throw new Error(`buildWorkbook: every column needs key and label (sheet "${name}")`);
    if (c.type && !TYPES.has(c.type)) throw new Error(`buildWorkbook: column "${c.key}" has type "${c.type}"`);
    if (c.type === "enum" && (!Array.isArray(c.options) || c.options.length === 0)) throw new Error(`buildWorkbook: enum column "${c.key}" needs options`);
  }
}

function addDataSheet(wb, sheet, taken, staging) {
  const name = sheetName(sheet.name, taken);
  checkColumns(name, sheet.columns);
  const rows = sheet.rows || [];
  if (rows.length > MAX_ROWS) throw new Error(`buildWorkbook: ${rows.length} rows; build exports this large in a job, in parts`);
  const ws = wb.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 1 }],
    properties: staging ? { tabColor: { argb: argb(BRAND.staging) } } : {},
  });
  ws.columns = sheet.columns.map((c) => ({
    key: c.key,
    header: c.label,
    width: c.width || Math.min(60, Math.max(12, String(c.label).length + 4)),
    style: numFmt(c.type) ? { numFmt: numFmt(c.type) } : {},
  }));
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: argb(BRAND.headerText) } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(BRAND.header) } };
  header.alignment = { vertical: "middle" };
  header.height = 20;
  for (const r of rows) {
    const values = {};
    for (const c of sheet.columns) values[c.key] = cellFor(c.type || "text", c.value ? c.value(r) : r[c.key]);
    ws.addRow(values);
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };

  const last = Math.max(rows.length + 1, sheet.validateRows || 1000);
  sheet.columns.forEach((c, i) => {
    if (c.type !== "enum") return;
    const list = c.options.map((o) => String(o).replace(/"/g, "")).join(",");
    if (list.length > 250) return; // Excel's inline list limit; the Reference sheet lists them instead
    for (let r = 2; r <= last; r += 1) {
      ws.getCell(r, i + 1).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`"${list}"`],
        showErrorMessage: true,
        errorTitle: c.label,
        error: `Choose one of: ${c.options.join(", ")}`,
      };
    }
  });
  return ws;
}

async function addReferenceSheet(wb, reference, taken) {
  const ws = wb.addWorksheet(sheetName("Reference", taken));
  ws.columns = [
    { header: "Column", key: "column", width: 26 },
    { header: "Required", key: "required", width: 10 },
    { header: "What to enter", key: "rule", width: 60 },
    { header: "Example", key: "example", width: 26 },
  ];
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: argb(BRAND.headerText) } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(BRAND.header) } };
  for (const r of reference) {
    ws.addRow({ column: escapeFormula(r.column), required: r.required ? "Yes" : "No", rule: escapeFormula(r.rule || ""), example: escapeFormula(r.example || "") });
  }
  ws.getColumn("rule").alignment = { wrapText: true, vertical: "top" };
  await ws.protect("", { selectLockedCells: true, selectUnlockedCells: true });
}

/**
 * @param {{sheets: Array<{name: string, columns: object[], rows: object[], validateRows?: number}>,
 *          reference?: Array<{column: string, required?: boolean, rule?: string, example?: string}>,
 *          title?: string}} spec
 * @returns {Promise<Buffer>}
 */
async function buildWorkbook({ sheets, reference = [], title = "MyCity App" }) {
  if (!Array.isArray(sheets) || sheets.length === 0) throw new Error("buildWorkbook: give at least one sheet");
  const staging = config.APP_ENV === "staging";
  const wb = new ExcelJS.Workbook();
  wb.creator = "MyCity App";
  wb.company = "MyCity App Ltd";
  wb.title = staging ? `STAGING ${title}` : title;
  wb.created = new Date();
  const taken = new Set(["reference"]);
  for (const s of sheets) addDataSheet(wb, s, taken, staging);
  if (reference.length) {
    taken.delete("reference");
    await addReferenceSheet(wb, reference, taken);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** "employees-2026-10-14.xlsx" (and "-staging" on staging). */
function exportFilename(base, ext = "xlsx", date = require("../time/lagos").today()) {
  const safe = String(base || "export").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "export";
  return `${safe}-${date}${config.APP_ENV === "staging" ? "-staging" : ""}.${ext}`;
}

module.exports = { buildWorkbook, exportFilename, MONEY_FORMAT, BRAND };
