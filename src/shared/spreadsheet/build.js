/**
 * The branded workbook builder. PURE: rows in → .xlsx buffer out. Everything
 * besides the rows arrives in the WorkbookContext (context.js), so unit tests
 * and production build the same way; a missing context is the default
 * MyCity context with no actor, title or filters.
 *
 * What "branded" means here, concretely:
 *   - header fill City Green, header font white, accent MyCity yellow
 *   - `wb.creator`/`lastModifiedBy`/`company` = the company name
 *   - optional Cover sheet: title, company letterhead lines, generated-at in
 *     Lagos time, actor, filters, and a STAGING stamp for exports made on
 *     staging (the filename says so too: cells.exportFilename)
 *   - money cells are raw typed numbers shown "₦#,##0.00", so a column SUMs
 *   - dates are real date cells shown day-first (dd/mm/yyyy)
 *
 *   const buffer = await buildWorkbook({
 *     sheets: [{
 *       name: "Employees",
 *       columns: [
 *         { key: "number", header: "Staff ID" },
 *         { key: "full_name", header: "Name", width: 28 },
 *         { key: "start_date", header: "Start Date", format: "date" },
 *         { key: "gross_monthly", header: "Gross Monthly", format: "money", total: true },
 *         { key: "work_pattern", header: "Work Pattern", list: ["On-site", "Hybrid", "Remote"] },
 *       ],
 *       rows,
 *     }],
 *     context: workbookContext({ actor: req.user, title: "Employees" }),
 *   });
 *
 * Rows are whatever the caller passes; this file never pages or queries. An export
 * is built from pages of 25 by the caller, or by a job for a large set (README §7).
 */
"use strict";

const ExcelJS = require("exceljs");
const { workbookContext } = require("./context");
const { sheetName, escapeFormula, hexToArgb, serialDate, formatInstant, MONEY_FORMAT } = require("./cells");

const REFERENCE_SHEET = "Reference";
// Staging stamp colour. Red is the universal "not real" signal on a document.
const STAGING_STAMP = "FFDA1E10";

/**
 * @typedef {Object} ColumnSpec
 * @property {string} header     Human header shown in row 1.
 * @property {string} key        Object key used for rows + parsed rows.
 * @property {number} [width]
 * @property {string} [note]     Cell comment on the header (guidance).
 * @property {string} [format]   money|qty|int|num|pct|date|datetime|bool|text|ref
 * @property {string[]} [list]   Inline dropdown values (small, fixed lists).
 * @property {string} [refColumn] Reference-sheet block title whose values
 *                                become this column's dropdown.
 * @property {boolean} [total]   Add a =SUM() cell for this column in a totals row.
 * @property {boolean} [wrap]    Wrap text in data cells (long reason strings).
 * @property {boolean} [emphasis] Data-cell font in the brand primary (the
 *                                "why not imported" column of an import error file).
 */

/** numFmt + coercion for one column format. */
function cellSpec(column, context) {
  switch (column.format) {
    case "money":
      return { fmt: MONEY_FORMAT, coerce: (v) => num(v), align: "right" };
    case "int":
      return { fmt: "#,##0", coerce: num, align: "right" };
    case "qty":
      // Counts or measures: show what is there, up to 3 places.
      return { fmt: "#,##0.###", coerce: num, align: "right" };
    case "num":
      return { fmt: "#,##0.00", coerce: num, align: "right" };
    case "pct":
      // Fraction in, % out (0.1925 → 19.3%).
      return { fmt: "0.0%", coerce: num, align: "right" };
    // Day-first, like every other date this product prints. These are Excel
    // NUMBER FORMATS, not the stored value: the cell still holds a real date
    // serial, so sorting, filtering and formulas are untouched. `dd/mm/yyyy`
    // is literal in Excel's format language (unlike the locale-dependent
    // `m/d/yy` shorthands), so the file renders the same for whoever opens it.
    case "date":
      return {
        fmt: "dd/mm/yyyy",
        coerce: (v) => serialDate(v, { timezone: context.timezone, hasTime: false }) ?? textOut(v),
      };
    case "datetime":
      return {
        fmt: "dd/mm/yyyy hh:mm",
        coerce: (v) => serialDate(v, { timezone: context.timezone, hasTime: true }) ?? textOut(v),
      };
    case "bool":
      return {
        coerce: (v) =>
          v === true || v === "true" || v === 1
            ? "Yes"
            : v === false || v === "false" || v === 0
              ? "No"
              : null,
        align: "left",
      };
    default:
      // text / ref / anything undeclared: string + injection lock.
      return { coerce: textOut, align: "left" };
  }
}

/** Postgres NUMERIC arrives as a string: coerce for a typed number cell. */
function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Typed cells (number/bool/Date) pass through untouched: they cannot be
 *  formulas, and re-typing one as text is how a summable amount column quietly
 *  dies. Strings get the injection lock; objects JSON-encode so a nested cell
 *  is visible rather than silently dropped ("[object Object]"). */
function textOut(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "boolean" || v instanceof Date) return v;
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s === "" ? null : escapeFormula(s);
}

/** Effective header text. */
function headerText(column) {
  return String(column.header ?? column.key ?? "");
}

/** Header/footer text: `&` is the control character in Excel headers, so a
 *  name containing one must be doubled to render literally. */
const hfEscape = (s) => String(s ?? "").replace(/&/g, "&&");

/** Palette from the context; hexToArgb returns null for unparseable values. */
function palette(context) {
  const primary = hexToArgb(context.brand.primary) || "FF014339";
  const foreground = hexToArgb(context.brand.primaryForeground) || "FFFFFFFF";
  const accent = hexToArgb(context.brand.accent) || primary;
  return { primary, foreground, accent, muted: "FFF3F4F6", ink: "FF111827" };
}

/** Brand header row: City Green fill + white bold font, frozen below it.
 *  `freeze` overrides the split ({ x, y }): the import error file pins its
 *  leading columns as well as the header. */
function styleHeaderRow(ws, colors, freeze) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: colors.foreground } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.primary } };
  row.alignment = { vertical: "middle" };
  row.height = 20;
  ws.views = [{ state: "frozen", xSplit: (freeze && freeze.x) || 0, ySplit: freeze ? freeze.y : 1 }];
}

/** Apply a list data-validation to a column across a generous row range:
 *  people paste hundreds of rows under the sample, and a dropdown that stops
 *  at the last written row is a dropdown that does nothing. */
function applyDropdown(ws, colIndex, formulae, message, validateRows) {
  const letter = ws.getColumn(colIndex).letter;
  const last = Math.min(validateRows || 1000, 1048576);
  for (let r = 2; r <= last; r++) {
    ws.getCell(`${letter}${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae,
      showErrorMessage: true,
      errorStyle: "warning",
      error: message,
    };
  }
}

/** Freeze/autofilter/print packaging shared by every data sheet. A4, header
 *  row repeated on every printed page, company + generated-at + page numbers
 *  in the header/footer, fit-to-width so a wide sheet prints instead of
 *  spilling columns across pages. Portrait under ~7 columns, landscape above. */
function packageSheet(ws, displayTitle, context, cols) {
  ws.pageSetup = {
    paperSize: 9, // A4
    orientation: cols > 6 ? "landscape" : "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };
  ws.pageSetup.printTitlesRow = "1:1";
  const who = context.env === "staging" ? `STAGING ${context.brand.name}` : context.brand.name;
  const when = formatInstant(context.generatedAt, context.timezone);
  ws.headerFooter = {
    oddHeader: `&L${hfEscape(who)}&R${hfEscape(displayTitle)}`,
    oddFooter: `&LGenerated ${when} (Lagos)&RPage &P / &N`,
  };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols } };
}

/* ── Cover sheet ─────────────────────────────────────────────────────────── */

/**
 * The cover: identity first (who exported, when, under which environment),
 * because a downloaded sheet circulates for years without the app that made
 * it. Row 1 is the title; the company's letterhead lines follow;
 * generated-at/actor/filters close it.
 */
function addCoverSheet(wb, taken, context, colors) {
  const ws = wb.addWorksheet(
    sheetName("Cover", { fallback: "Cover", taken }),
    { properties: { tabColor: { argb: colors.accent } } },
  );
  ws.getColumn(1).width = 24;
  ws.getColumn(2).width = 46;
  ws.getColumn(3).width = 20;

  const titleCell = ws.getCell("A1");
  titleCell.value = textOut(context.title) || "Export";
  titleCell.font = { size: 20, bold: true, color: { argb: colors.ink } };
  ws.getRow(1).height = 30;

  let r = 3;
  const line = (label, value) => {
    if (value === null || value === undefined || value === "") return;
    ws.getCell(r, 1).value = label;
    ws.getCell(r, 1).font = { bold: true, color: { argb: colors.ink } };
    ws.getCell(r, 2).value = textOut(value);
    r += 1;
  };

  ws.getCell(r, 1).value = textOut(context.brand.name);
  ws.getCell(r, 1).font = { size: 14, bold: true, color: { argb: colors.primary } };
  r += 2;
  const o = context.org || {};
  line("Address", o.address);
  line("Phone", o.phone);
  line("Email", o.email);
  line("Website", o.website);
  r = Math.max(r + 1, 9);

  line("Generated", `${formatInstant(context.generatedAt, context.timezone)} (Lagos)`);
  if (context.actor && context.actor.name) line("Generated by", context.actor.name);
  if (context.filters && typeof context.filters === "object") {
    const parts = Object.entries(context.filters)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${k} = ${Array.isArray(v) ? v.join("|") : v}`);
    if (parts.length) line("Filters", parts.join(", "));
  }

  // A staging export must be identifiable with the file open AND from the
  // filename (cells.exportFilename).
  if (context.env === "staging") {
    r += 1;
    const stamp = ws.getCell(r, 1);
    stamp.value = "STAGING: NOT LIVE DATA";
    stamp.font = { bold: true, size: 16, color: { argb: STAGING_STAMP } };
    ws.getRow(r).height = 24;
  }
  return ws;
}

/* ── Reference sheet ─────────────────────────────────────────────────────── */

/**
 * The read-only guidance sheet: the REAL valid values, laid out as parallel
 * labelled blocks a person scans ("which department code goes here?"), not one
 * 900-row table. Protected (locked, no password: unprotecting is one click,
 * which is the right trade for a guidance sheet) but VISIBLE, because the
 * whole point is that people copy from it.
 *
 * Block shapes: `{ title, values }` with values either strings (one column)
 * or `[code, label]` pairs (two columns, header on the first).
 */
function addReferenceSheet(wb, colors, blocks) {
  const ws = wb.addWorksheet(REFERENCE_SHEET, {
    views: [{ state: "frozen", ySplit: 2 }],
    properties: { tabColor: { argb: colors.accent } },
  });
  ws.state = "visible";
  ws.getCell("A1").value = "Reference: the values this file accepts. Copy them into the data sheet.";
  ws.getCell("A1").font = { bold: true, size: 12, color: { argb: colors.primary } };

  const refLetters = {};
  let col = 1;
  for (const block of blocks) {
    const paired = block.values.length && Array.isArray(block.values[0]);
    const span = paired ? 2 : 1;
    ws.getColumn(col).width = 26;
    if (paired) ws.getColumn(col + 1).width = 60;
    for (let c = 0; c < span; c++) {
      const head = ws.getCell(2, col + c);
      head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.primary } };
      head.font = { bold: true, color: { argb: colors.foreground } };
    }
    ws.getCell(2, col).value = block.title;
    block.values.forEach((entry, i) => {
      const [code, label] = paired ? entry : [entry, null];
      ws.getCell(3 + i, col).value = textOut(code);
      if (paired && label !== null && label !== undefined) {
        const cell = ws.getCell(3 + i, col + 1);
        cell.value = textOut(label);
        cell.alignment = { wrapText: true, vertical: "top" };
      }
    });
    // Dropdown formulae point at the VALUES column, which starts at row 3.
    const letter = ws.getColumn(col).letter;
    refLetters[block.title] = { letter, count: block.values.length };
    col += span;
  }
  ws.protect(undefined, { selectLockedCells: true, selectUnlockedCells: true });
  return refLetters;
}

/* ── Builder ─────────────────────────────────────────────────────────────── */

/**
 * Build an .xlsx buffer.
 *
 * @param {Object} opts
 * @param {{name:string, title?:string, columns:ColumnSpec[], rows?:Object[],
 *          sample?:Object, validateRows?:number,
 *          freeze?:{x?:number, y?:number}}[]} opts.sheets
 * @param {{title:string, values:(string[]|[string,string][])[]}[]} [opts.reference]
 * @param {Object} [opts.context]  from workbookContext()
 * @param {boolean} [opts.cover]   Emit a Cover sheet first. Reports use it;
 *        import TEMPLATES must not: their row 1 is the header the parser keys on.
 * @returns {Promise<Buffer>}
 */
async function buildWorkbook({ sheets, reference = [], context, cover = false } = {}) {
  if (!Array.isArray(sheets) || sheets.length === 0) throw new Error("buildWorkbook: give at least one sheet");
  const ctx = context || workbookContext();
  const colors = palette(ctx);
  const wb = new ExcelJS.Workbook();
  wb.creator = ctx.brand.name;
  wb.lastModifiedBy = ctx.brand.name;
  wb.company = ctx.brand.name;
  if (ctx.title) wb.title = ctx.env === "staging" ? `STAGING ${ctx.title}` : ctx.title;
  const createdAt = ctx.generatedAt instanceof Date ? ctx.generatedAt : new Date(ctx.generatedAt);
  wb.created = Number.isNaN(createdAt.getTime()) ? new Date() : createdAt;

  // Uniqueness across the whole workbook, cover + reference included. The
  // Reference name is reserved whenever the sheet will exist: a data sheet
  // stealing it would be skipped by the parser (which treats "Reference" as
  // guidance) and would collide at addWorksheet anyway.
  const taken = new Set();
  if (reference.length) taken.add(REFERENCE_SHEET.toLowerCase());
  if (cover) addCoverSheet(wb, taken, ctx, colors);

  // Data sheets FIRST, reference last: an import reads the first data sheet.
  const created = [];
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheetName(sheet.name, { taken }), {
      properties: ctx.env === "staging" ? { tabColor: { argb: STAGING_STAMP } } : {},
    });
    created.push(ws);
    const specs = sheet.columns.map((c) => cellSpec(c, ctx));

    ws.columns = sheet.columns.map((c, i) => ({
      header: headerText(c),
      key: c.key,
      width: c.width ?? 20,
      style: specs[i].fmt ? { numFmt: specs[i].fmt } : undefined,
    }));
    styleHeaderRow(ws, colors, sheet.freeze);

    const writeRow = (values, { muted = false } = {}) => {
      const out = {};
      sheet.columns.forEach((c, i) => {
        out[c.key] = specs[i].coerce(values[c.key]);
      });
      const row = ws.addRow(out);
      sheet.columns.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        if (specs[i].align) cell.alignment = { horizontal: specs[i].align };
        if (c.wrap) cell.alignment = { ...(cell.alignment || {}), wrapText: true, vertical: "top" };
        if (c.emphasis) cell.font = { color: { argb: colors.primary } };
        if (muted) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.muted } };
        }
      });
      return row;
    };

    for (const row of sheet.rows ?? []) writeRow(row);
    // One worked example in the muted fill: reads as a sample, deletes as a
    // one-row delete. Guessing the shape of 27 columns is not a workflow.
    if (sheet.sample) writeRow(sheet.sample, { muted: true });

    // Header comments + dropdowns.
    sheet.columns.forEach((c, idx) => {
      const colIndex = idx + 1;
      if (c.note) ws.getCell(`${ws.getColumn(colIndex).letter}1`).note = c.note;
      if (c.list && c.list.length) {
        const inline = c.list.map((v) => String(v).replace(/"/g, "")).join(",");
        // Excel's inline list limit is 255 characters; longer lists belong on
        // the Reference sheet (refColumn).
        if (inline.length <= 250) applyDropdown(ws, colIndex, [`"${inline}"`], "Pick a value from the list.", sheet.validateRows);
      }
    });

    // Totals row: live SUM formulas, never pre-baked numbers: a total that
    // is a constant keeps looking right after someone edits a row above it.
    const totalIdx = sheet.columns.map((c, i) => (c.total ? i : -1)).filter((i) => i >= 0);
    const dataRows = (sheet.rows ?? []).length + (sheet.sample ? 1 : 0);
    if (totalIdx.length && dataRows > 0) {
      const row = ws.addRow({});
      row.getCell(1).value = "Total";
      row.font = { bold: true };
      for (const i of totalIdx) {
        const letter = ws.getColumn(i + 1).letter;
        const cell = row.getCell(i + 1);
        cell.value = { formula: `SUM(${letter}2:${letter}${dataRows + 1})` };
        if (specs[i].fmt) cell.numFmt = specs[i].fmt;
        cell.border = { top: { style: "thin", color: { argb: colors.primary } } };
      }
    }

    packageSheet(ws, sheet.title || sheet.name, ctx, sheet.columns.length);
  }

  // refColumn dropdowns last: they need the Reference sheet's letters. Kept
  // separate from the inline-list pass so a column can never get both.
  if (reference.length) {
    const refLetters = addReferenceSheet(wb, colors, reference);
    sheets.forEach((sheet, s) => {
      const ws = created[s];
      sheet.columns.forEach((c, idx) => {
        if (!c.refColumn || !refLetters[c.refColumn]) return;
        const { letter, count } = refLetters[c.refColumn];
        const last = Math.max(count + 2, 3); // values start at row 3
        applyDropdown(ws, idx + 1, [`${REFERENCE_SHEET}!$${letter}$3:$${letter}$${last}`],
          "Pick a value from the Reference sheet.", sheet.validateRows);
      });
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/* Exported for csv.js, which must emit the SAME header text and cell
   semantics (Yes/No bools, Lagos dates, injection lock): a csv/xlsx pair
   that disagrees on headers is two different exports. */
module.exports = {
  buildWorkbook,
  cellSpec,
  headerText,
  num,
  textOut,
  REFERENCE_SHEET,
};
