"use strict";
/**
 * A report's tables as its two files (docs/guides/home.md §6 Reports): the variables of the
 * PDF template (templates/documents/report.html) and the XLSX workbook.
 *
 * Both say a value the way people read it here: dates day-first, amounts in Naira, times in
 * Lagos. In the PDF each cell is written out with the house formatters (shared/time/day-first,
 * shared/money); in the workbook a date, a time, a number and a Naira amount stay typed cells
 * that sort and sum, shown day-first and in Naira by the shared builder (shared/spreadsheet).
 *
 * A table that holds the first ROW_CEILING rows of more says so: a line under it in the PDF,
 * and on the workbook's cover.
 *
 * Pure: tables in, variables or bytes out.
 */
const money = require("../../shared/money/money");
const { formatDate, formatDateTime } = require("../../shared/time/day-first");
const { buildWorkbook } = require("../../shared/spreadsheet/build");
const { workbookContext } = require("../../shared/spreadsheet/context");

/** A Naira amount as it crosses the wire ("1250000.00"). */
const WIRE_MONEY = /^-?\d{1,16}\.\d{2}$/;

const numbers = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 });

const blank = (v) => v === null || v === undefined || v === "";

/**
 * One value as the PDF prints it. A value its column's kind cannot read (an amount in another
 * currency, already written with its code) is printed as it is.
 * @param {*} value
 * @param {"text"|"date"|"datetime"|"number"|"money"} kind
 */
function cellText(value, kind) {
  if (blank(value)) return "";
  switch (kind) {
    case "date":
      return formatDate(value);
    case "datetime":
      return formatDateTime(value);
    case "number":
      return Number.isFinite(Number(value)) ? numbers.format(Number(value)) : String(value);
    case "money":
      return WIRE_MONEY.test(String(value)) ? money.formatNaira(value) : String(value);
    default:
      return String(value);
  }
}

const numeric = (kind) => kind === "number" || kind === "money";

/** "2,000" */
const count = (n) => numbers.format(n);

/** The line under a table cut short, or null. */
function noteOf(t) {
  return t.total > t.rows.length ? `Showing the first ${count(t.rows.length)} of ${count(t.total)} rows.` : null;
}

/**
 * The PDF's variables (packages/contract HomeReportDocumentVars).
 * @param {{report_name: string, run_number: string, source: string, recipient_name: string, as_at: Date,
 *          filters: Array<{label: string, value: string}>}} meta
 * @param {{lines: string[], tables: Array<{title: string, columns: object[], rows: object[], total: number}>}} gathered
 */
function documentVars(meta, { lines, tables }) {
  return {
    report_name: meta.report_name,
    run_number: meta.run_number,
    source: meta.source,
    recipient_name: meta.recipient_name,
    as_at: new Date(meta.as_at).toISOString(),
    filters: meta.filters,
    lines,
    tables: tables.map((t) => ({
      title: t.title,
      columns: t.columns.map((col) => ({ header: col.header, numeric: numeric(col.kind) })),
      rows: t.rows.map((row) => ({
        cells: t.columns.map((col) => ({ text: cellText(row[col.key], col.kind), numeric: numeric(col.kind) })),
      })),
      note: noteOf(t),
    })),
  };
}

/** The workbook format of each kind (shared/spreadsheet/build.js cellSpec). */
const FORMAT = Object.freeze({ text: "text", date: "date", datetime: "datetime", number: "qty", money: "money" });

/**
 * A table's columns as the workbook's. A money column holding an amount in another currency
 * is written as text, every amount in it said in its own currency, rather than lose that one.
 */
function sheetOf(t) {
  const columns = t.columns.map((col) => {
    const mixed = col.kind === "money" && t.rows.some((r) => !blank(r[col.key]) && !WIRE_MONEY.test(String(r[col.key])));
    return { col, format: mixed ? "text" : FORMAT[col.kind] };
  });
  const rows = t.rows.map((r) =>
    Object.fromEntries(
      columns.map(({ col, format }) => [
        col.key,
        format === "text" && col.kind === "money" ? cellText(r[col.key], "money") : r[col.key],
      ]),
    ),
  );
  return {
    name: t.title,
    columns: columns.map(({ col, format }) => ({
      key: col.key,
      header: col.header,
      format,
      width: col.kind === "text" ? 26 : 16,
    })),
    rows,
    freeze: { y: 1 },
  };
}

/**
 * The XLSX workbook: a cover naming the report, its number, who it is for, its source and its
 * filters; a Summary sheet when the report has lines above its tables (an Overview); then a
 * sheet for each table.
 * @param {object} meta  as documentVars
 * @param {object} gathered  as documentVars
 * @param {{org?: object}} [opts]  the organisation's letterhead lines for the cover
 * @returns {Promise<Buffer>}
 */
function workbook(meta, { lines, tables }, { org = null } = {}) {
  // The cover's one line of facts, labelled as the PDF's header and filters are.
  const about = { Source: meta.source, "As At": formatDateTime(meta.as_at) };
  for (const f of meta.filters) about[f.label] = f.value;
  const cut = tables.find((t) => t.total > t.rows.length);
  if (cut) about.Rows = `the first ${count(cut.rows.length)} of ${count(cut.total)}`;
  const sheets = tables.map(sheetOf);
  if (lines.length)
    sheets.unshift({
      name: "Summary",
      columns: [{ key: "line", header: "Summary", format: "text", width: 80 }],
      rows: lines.map((line) => ({ line })),
    });
  return buildWorkbook({
    sheets,
    context: workbookContext({
      actor: { name: meta.recipient_name },
      title: `${meta.report_name} (${meta.run_number})`,
      filters: about,
      org,
    }),
    cover: true,
  });
}

module.exports = { cellText, documentVars, workbook };
