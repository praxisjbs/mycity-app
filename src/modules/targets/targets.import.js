"use strict";
/**
 * The scorecards workbook importer, `scorecards` (docs/guides/performance.md §6.19): MyCity
 * uploads its individual scorecards workbook as it is; each line of each person's sheet
 * ("00005 Tobiloba Dada") is a row, written through targets.service.importLine into the active
 * quarter (or the one being planned).
 *
 * What this file knows that a form does not:
 *
 *  - **People by name.** The workbook's staff IDs are not the system's, so a person and their
 *    reviewer are matched on name. Someone the staff list does not hold is an error on their
 *    rows, for the person to skip in the preview.
 *  - **The reviewer in prose.** "Board (to be confirmed)" is nobody (the CEO's card); "Abubakar
 *    Mohammed (dotted line: Chinyere Elechi)" is a reviewer and a dotted line. A reviewer the
 *    staff list does not hold leaves the person's manager as reviewer.
 *  - **Linked codes** are found by their code or a former one (the change map's aliases, kept by
 *    the OKR workbook import, which runs first). A key result makes the line a key result line,
 *    a KPI a function KPI line. A code found nowhere (TECH-K01 to TECH-K05) is an error on the
 *    line.
 *  - **Accountability lines** are worked out by the system: commitment delivery from the
 *    commitments register, the monthly update from its date.
 *  - **Due or frequency.** A date ("30 Nov") is the line's due date, and a Results line with one
 *    is a milestone; anything else ("Monthly, per app") is its frequency.
 *  - **Imported scorecards are agreed**: they were signed in September.
 */
const c = require("@mycity/contract");
const { defineImporter } = require("../../shared/import/registry");
const { AppError } = require("../../shared/errors");
const workbook = require("../goals/goals.workbook");
const goalsRepo = require("../goals/goals.repo");
const { importPeriod, dateIn, personByName } = require("../goals/goals.import");
const kpisRepo = require("../kpis/kpis.repo");
const service = require("./targets.service");
const repo = require("./targets.repo");

const { text } = workbook;
const PERSON_SHEET = /^\d{3,6}\s+(.+)$/;
const ONLY_DATE = /^\s*\d{1,2}\s+[A-Za-z]{3,9}(\s+\d{4})?\s*$/;
const SECTIONS = [
  [/^result/i, "results"],
  [/^kpi/i, "kpis"],
  [/^accountab/i, "accountability"],
];

/** The Staff Register's reviewer and scope, by name. */
function registerOf(sheets) {
  const out = new Map();
  for (const s of sheets) {
    const at = s.rows.findIndex((r) => text((r || [])[0]) === "Staff ID" && text((r || [])[1]) === "Name");
    if (at < 0) continue;
    const col = workbook.columnsOf(s.rows[at]);
    for (const r of s.rows.slice(at + 1)) {
      const name = text((r || [])[col("Name")]);
      if (name) out.set(name, { reviewer: text(r[col("Reviewer")]), scope: text(r[col("Scope")]) });
    }
  }
  return out;
}

/** A person's sheet: its label rows (Reviewer, Scope) and its numbered lines. */
function sheetRows(sheet, name, register) {
  const label = (word) => text((sheet.rows.find((r) => text((r || [])[0]) === word) || [])[1]);
  const at = sheet.rows.findIndex((r) => text((r || [])[0]) === "#");
  if (at < 0) return [];
  const col = workbook.columnsOf(sheet.rows[at]);
  const cols = {
    section: col("Section"),
    title: col("Goal"),
    target: col("Target"),
    linked: col("Linked"),
    due: col("Due"),
    weight: col("Weight"),
  };
  const known = register.get(name) || {};
  const reviewer = label("Reviewer") || known.reviewer || null;
  const scope = label("Scope") || known.scope || null;
  const rows = [];
  for (const r of sheet.rows.slice(at + 1)) {
    const n = (r || [])[0];
    if (typeof n !== "number" && !/^\d+$/.test(text(n) || "")) continue;
    const position = Number(n);
    const section = (SECTIONS.find(([re]) => re.test(text(r[cols.section]) || "")) || [])[1];
    rows.push({
      line_key: `${name} #${position}`,
      employee: name,
      reviewer,
      scope,
      position,
      section: section || text(r[cols.section]),
      title: text(r[cols.title]),
      target: text(r[cols.target]),
      linked: text(r[cols.linked]),
      due: text(r[cols.due]),
      weight: typeof r[cols.weight] === "number" ? r[cols.weight] : Number(text(r[cols.weight])),
    });
  }
  return rows;
}

/** The importer's rows: every line of every person's sheet. */
function extract(sheets) {
  const register = registerOf(sheets);
  const people = sheets.filter((s) => PERSON_SHEET.test(s.name));
  if (!people.length)
    throw new AppError("IMPORT_NOT_SCORECARDS", "This is not the scorecards workbook: no sheet is a person's", 422);
  return { rows: people.flatMap((s) => sheetRows(s, PERSON_SHEET.exec(s.name)[1].trim(), register)), notes: [] };
}

/** The reviewer cell: the reviewer (undefined to leave the manager), and a dotted line. */
async function reviewerOf(client, cell) {
  if (!cell) return { reviewer_employee_id: undefined, dotted_employee_id: null };
  const dottedName = (/dotted line:\s*([^)]+)/i.exec(cell) || [])[1];
  const name = cell.replace(/\([^)]*\)/g, "").trim();
  if (/^board\b/i.test(name)) return { reviewer_employee_id: null, dotted_employee_id: null };
  const reviewer = await personByName(client, name);
  const dotted = dottedName ? await personByName(client, dottedName.trim()) : null;
  return { reviewer_employee_id: reviewer ? reviewer.employee_id : undefined, dotted_employee_id: dotted ? dotted.employee_id : null };
}

/** The KPI a code or a former one names, in the quarter. */
async function kpiByCode(client, periodId, code) {
  return (await kpisRepo.findByCode(client, code)) || (await goalsRepo.kpiByAlias(client, periodId, code));
}

/** The line's link and the source it takes: a key result, a KPI, or worked out by the system. */
async function linkOf(client, period, values) {
  if (values.section === "accountability") {
    if (/commitment/i.test(values.title)) return { source: "commitments" };
    if (/update/i.test(values.title)) return { source: "update_on_time" };
    if (/review/i.test(values.title)) return { source: "team_reviews" };
  }
  const code = workbook.codesIn(values.linked)[0];
  if (!code) return { source: "own" };
  if (/-KR/.test(code)) {
    const kr = await goalsRepo.keyResultByCode(client, period.performance_period_id, code);
    if (kr) return { source: "key_result", okr_key_result_id: kr.okr_key_result_id };
  }
  const kpi = await kpiByCode(client, period.performance_period_id, code);
  if (kpi) return { source: "function_kpi", kpi_definition_id: kpi.kpi_definition_id };
  const message = `${code} is not a key result or KPI of this quarter`;
  throw new AppError("VALIDATION_FAILED", message, 422, { linked: [message] });
}

/** The number a standard's target names ("≥98% — …" → "98"). */
const percentOf = (target) => (/^[^\d]*(\d+(?:\.\d+)?)\s*%/.exec(target || "") || [])[1] || null;

const FIELDS = [
  { key: "line_key", label: "Line", required: true, example: "Tobiloba Dada #3" },
  { key: "employee", label: "Employee", required: true },
  { key: "reviewer", label: "Reviewer" },
  { key: "scope", label: "Scope", max: 2000 },
  { key: "position", label: "Line Number", type: "int", required: true },
  { key: "section", label: "Section", type: "enum", options: ["results", "kpis", "accountability"], required: true },
  { key: "title", label: "Goal or KPI", required: true },
  { key: "target", label: "Target", max: 1000 },
  { key: "linked", label: "Linked KR or KPI" },
  { key: "due", label: "Due or Frequency" },
  { key: "weight", label: "Weight", type: "number", required: true },
];

defineImporter({
  key: "scorecards",
  label: "Scorecards Workbook",
  permission: ["performance", "create"],
  capability: "performance.manage",
  entity: "scorecard",
  schema: c.targets.ScorecardImportRow,
  matchKeys: ["line_key"],
  fields: FIELDS,
  extract,

  async find(client, { value }) {
    const m = /^(.+) #(\d+)$/.exec(value);
    const id = m && (await goalsRepo.importPeriodId(client));
    const person = id && (await personByName(client, m[1]));
    const card = person && (await repo.ofPerson(client, id, person.employee_id));
    const line = card && (await repo.lines(client, card.scorecard_id)).find((l) => l.position === Number(m[2]) - 1);
    return line ? { id: line.employee_target_id, values: { line_key: value } } : null;
  },

  async write(client, values, ctx) {
    const period = await importPeriod(client);
    const person = await personByName(client, values.employee);
    if (!person) {
      const message = `${values.employee} is not on the staff list`;
      throw new AppError("VALIDATION_FAILED", message, 422, { employee: [message] });
    }
    const due = ONLY_DATE.test(values.due || "") ? dateIn(values.due, period) : null;
    const link = await linkOf(client, period, values);
    const results = values.section === "results";
    const measure = results ? (due ? "milestone" : "numeric") : link.source === "update_on_time" ? "binary" : "standard";
    return service.importLine(client, ctx.actor, {
      performance_period_id: period.performance_period_id,
      employee_id: person.employee_id,
      ...(await reviewerOf(client, values.reviewer)),
      scope_text: values.scope || null,
      position: values.position,
      section: values.section,
      title: values.title,
      measure,
      target_text: values.target || null,
      target_value: measure === "standard" ? percentOf(values.target) : null,
      due_on: due,
      milestone_due_on: measure === "milestone" ? due : null,
      frequency_text: due ? null : values.due || null,
      weight: String(values.weight),
      okr_key_result_id: link.okr_key_result_id || null,
      kpi_definition_id: link.kpi_definition_id || null,
      source: link.source,
    });
  },

  // A line whose scorecard has been agreed, bound, reassigned or edited since, or whose target a
  // change names, stays.
  isReferenced: (client, id, { batch }) => repo.lineInUse(client, id, batch.import_batch_id),
  archive: (client, id, ctx) => service.removeImportedLine(client, ctx.actor, id),
  // A line an import changed stays as it is now: the workbook holds no before-image to put back.
  restore: async () => undefined,
});

module.exports = { FIELDS, extract, reviewerOf, percentOf };
