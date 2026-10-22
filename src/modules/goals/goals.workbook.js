"use strict";
/**
 * MyCity's OKR workbook as it is kept (docs/guides/performance.md §6.19): the Company OKRs sheet,
 * one sheet per function named after its department, each with a key result table and an
 * Operational KPIs table, and the change map's former IDs. The okr_workbook and okr_kpis importers
 * read it through here, so both agree on where a table starts and what a code looks like.
 *
 * A key result table starts at the row whose first cell is "KR ID"; an objective row's first cell
 * is its code and title ("CO-O1   Build one trusted view…"); a key result row's is its code
 * ("BM-KR1.2"). The KPI table starts at "KPI ID". Columns are found by their header, so a column
 * moved or added in a later version of the workbook is still read.
 */
const { AppError } = require("../../shared/errors");

const COMPANY_SHEET = "Company OKRs";
const COMPANY = "Company";
const OBJECTIVE_ROW = /^([A-Z]+-O\d+)\s+(.+)$/s;
const KEY_RESULT_CODE = /^[A-Z]+-KR\d+\.\d+$/;
const KPI_CODE = /^[A-Z]+-K\d+$/;
const ANY_CODE = /\b[A-Z]{2,5}-(?:KR\d+\.\d+|K\d+|O\d+)\b/g;

/** A cell as trimmed text, or null. */
function text(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const t = String(v).replace(/\u00A0/g, " ").trim();
  return t === "" ? null : t;
}

/** A score cell (0 to 1) as a number to the four places a score is held to, or undefined. */
function score(v) {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) && n >= 0 && n <= 1 ? Math.round(n * 10000) / 10000 : undefined;
}

const norm = (v) => (text(v) || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The columns of a header row: the index of the first header that starts with one of the names. */
function columnsOf(header) {
  const heads = (header || []).map(norm);
  return (...names) => {
    for (const n of names.map(norm)) {
      const i = heads.findIndex((h) => h === n || h.startsWith(`${n} `));
      if (i >= 0) return i;
    }
    return -1;
  };
}

const cell = (row, i) => (i >= 0 ? (row || [])[i] : null);

/** The codes a cell names ("TBO-KR1.1; TBO-KR2.2" → both), in order, once each. */
const codesIn = (v) => [...new Set((text(v) || "").match(ANY_CODE) || [])];

/** The key result sheets: the company's first, then each function's, in the workbook's order. */
function okrSheets(sheets) {
  const out = [];
  for (const s of sheets) {
    const at = s.rows.findIndex((r) => text((r || [])[0]) === "KR ID");
    if (at < 0) continue;
    const title = text((s.rows[0] || [])[0]) || s.name;
    const fn = s.name === COMPANY_SHEET ? COMPANY : s.name;
    if (s.name !== COMPANY_SHEET && !/OKRs$/i.test(title)) continue;
    out.push({ function: fn, sheet: s, header: at });
  }
  if (!out.length)
    throw new AppError("IMPORT_NOT_OKR_WORKBOOK", "This is not the OKR workbook: no sheet has a KR ID table", 422);
  return out.sort((a, b) => (a.function === COMPANY ? -1 : b.function === COMPANY ? 1 : 0));
}

/** The change map's former IDs: new ID → former IDs, from the "Former ID → new ID" table. */
function changeMap(sheets) {
  const out = new Map();
  for (const s of sheets) {
    const at = s.rows.findIndex((r) => norm((r || [])[0]) === "former id" && norm((r || [])[1]) === "new id");
    if (at < 0) continue;
    for (const r of s.rows.slice(at + 1)) {
      const former = text((r || [])[0]);
      const now = text((r || [])[1]);
      if (!former || !now || !/^[A-Z]+-/.test(former) || !/^[A-Z]+-/.test(now)) continue;
      for (const code of codesIn(now)) out.set(code, [...(out.get(code) || []), former]);
    }
  }
  return out;
}

/** The function a sheet's title names its head ("· Function head: Bode Oluwasanmi (CTO)"). */
function headOf(sheet) {
  const sub = text((sheet.rows[1] || [])[0]) || "";
  const m = /Function head:\s*([^(·]+)/i.exec(sub);
  return m ? m[1].trim() : null;
}

/**
 * Each key result of a key result sheet with its objective and cells, keyed by the importer's
 * fields.
 */
function keyResultRows(entry, former) {
  const { sheet, header } = entry;
  const col = columnsOf(sheet.rows[header]);
  const c = {
    statement: col("Key result"),
    type: col("Type"),
    initiatives: col("Initiatives"),
    accountable: col("Accountable owner", "Accountable"),
    linked: col("Linked company KR", "Contributing function KRs"),
    baseline: col("Baseline"),
    start: col("Start"),
    finish: col("Finish"),
    scored: col("Scored from"),
    status: col("Status"),
    actual: col("Actual"),
    update: col("Update"),
    oct: col("October"),
    nov: col("November"),
    dec: col("December"),
  };
  const rows = [];
  let objective = null;
  for (const r of sheet.rows.slice(header + 1)) {
    const first = text((r || [])[0]);
    if (!first) continue;
    if (/^Operational KPIs$/i.test(first) || first === "KPI ID") break;
    const o = OBJECTIVE_ROW.exec(first);
    if (o) {
      objective = { code: o[1], title: o[2].replace(/\s+/g, " ").trim() };
      continue;
    }
    if (!KEY_RESULT_CODE.test(first) || !objective) continue;
    const date = (i) => {
      const v = cell(r, i);
      return v instanceof Date ? v : text(v);
    };
    rows.push({
      function: entry.function,
      objective_code: objective.code,
      objective: objective.title,
      code: first,
      statement: text(cell(r, c.statement)),
      kr_type: text(cell(r, c.type)),
      accountable: text(cell(r, c.accountable)),
      linked: text(cell(r, c.linked)),
      baseline: text(cell(r, c.baseline)),
      starts_on: date(c.start),
      finishes_on: date(c.finish),
      initiatives: text(cell(r, c.initiatives)),
      scored_from: codesIn(cell(r, c.scored))[0] || null,
      status: text(cell(r, c.status)),
      actual: text(cell(r, c.actual)),
      update: text(cell(r, c.update)),
      october: score(cell(r, c.oct)),
      november: score(cell(r, c.nov)),
      december: score(cell(r, c.dec)),
      former_codes: (former.get(first) || []).join("; ") || null,
    });
  }
  return rows;
}

/** Each KPI of a function sheet's Operational KPIs table, keyed by the importer's fields. */
function kpiRows(entry, former) {
  const { sheet } = entry;
  const at = sheet.rows.findIndex((r) => text((r || [])[0]) === "KPI ID");
  if (at < 0) return [];
  const col = columnsOf(sheet.rows[at]);
  const c = {
    name: col("KPI"),
    formula: col("Formula"),
    unit: col("Unit"),
    direction: col("Direction"),
    target: col("Target"),
    frequency: col("Frequency"),
    source: col("Data source"),
    result: col("Result"),
    actual: col("Actual"),
    comment: col("Comment"),
  };
  const rows = [];
  for (const r of sheet.rows.slice(at + 1)) {
    const code = text((r || [])[0]);
    if (!code || !KPI_CODE.test(code)) continue;
    rows.push({
      function: entry.function,
      code,
      name: text(cell(r, c.name)),
      formula: text(cell(r, c.formula)),
      unit: text(cell(r, c.unit)),
      direction: text(cell(r, c.direction)),
      target: text(cell(r, c.target)),
      frequency: text(cell(r, c.frequency)),
      data_source: text(cell(r, c.source)),
      result: text(cell(r, c.result)),
      actual: text(cell(r, c.actual)),
      comment: text(cell(r, c.comment)),
      former_codes: (former.get(code) || []).join("; ") || null,
    });
  }
  return rows;
}

/** The okr_workbook importer's rows: every key result, the company's first. */
function extractKeyResults(sheets) {
  const former = changeMap(sheets);
  const entries = okrSheets(sheets);
  const rows = entries.flatMap((e) => keyResultRows(e, former));
  const notes = entries
    .filter((e) => e.function !== COMPANY)
    .map((e) => (headOf(e.sheet) ? `${e.function}: head ${headOf(e.sheet)}` : null))
    .filter(Boolean);
  return { rows, notes };
}

/** The okr_kpis importer's rows: every function's KPIs. */
function extractKpis(sheets) {
  const former = changeMap(sheets);
  const rows = okrSheets(sheets)
    .filter((e) => e.function !== COMPANY)
    .flatMap((e) => kpiRows(e, former));
  return { rows, notes: [] };
}

module.exports = {
  COMPANY,
  KEY_RESULT_CODE,
  KPI_CODE,
  text,
  score,
  codesIn,
  columnsOf,
  okrSheets,
  changeMap,
  extractKeyResults,
  extractKpis,
};
