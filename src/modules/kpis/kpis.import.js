"use strict";
/**
 * The OKR workbook's KPIs, `okr_kpis` (docs/guides/performance.md §6.19): each function sheet's
 * Operational KPIs table, read from the workbook as it is and written through
 * kpis.service.importKpi into the function the sheet is named after.
 *
 * What this file knows that a form does not: "Higher is better" is the direction; the target as
 * written ("≥95%") stays the target's wording, and its number ("95") the target where there is
 * one; a frequency in words ("Weekly check; monthly minimum") is the first of weekly, monthly or
 * quarterly it names, else monthly; a Result of Met, Not Met or N/A records the month just ended
 * (within the quarter). Former
 * IDs from the change map are kept as aliases, so a scorecard naming OP-K01 finds TBO-K08.
 */
const c = require("@mycity/contract");
const { defineImporter } = require("../../shared/import/registry");
const { AppError } = require("../../shared/errors");
const workbook = require("../goals/goals.workbook");
const goalsRepo = require("../goals/goals.repo");
const { importPeriod, reportingMonth } = require("../goals/goals.import");
const service = require("./kpis.service");
const repo = require("./kpis.repo");

const directionOf = (text) => (/lower/i.test(text || "") ? "lower" : "higher");
const frequencyOf = (text) => (/weekly/i.test(text || "") ? "weekly" : /quarterly/i.test(text || "") ? "quarterly" : "monthly");
const resultOf = (text) => (/^n\/?a\b/i.test(text || "") ? "na" : /^not met/i.test(text || "") ? "not_met" : /^met/i.test(text || "") ? "met" : null);

/** The number a target names ("≥95%" → "95", "≤3 from 1 Nov" → "3"), or null when it is words. */
function targetNumber(text) {
  if (!text || /\[TBC\]/i.test(text)) return null;
  const m = /^[^\d-]*(-?\d[\d,]*(?:\.\d+)?)/.exec(text);
  return m ? String(Number(m[1].replace(/,/g, ""))) : null;
}

const FIELDS = [
  { key: "function", label: "Function", required: true, example: "Branding & Marketing" },
  { key: "code", label: "KPI ID", required: true, example: "BM-K01" },
  { key: "name", label: "KPI", required: true },
  { key: "formula", label: "Formula", max: 1000 },
  { key: "unit", label: "Unit" },
  { key: "direction", label: "Direction" },
  { key: "target", label: "Target" },
  { key: "frequency", label: "Frequency" },
  { key: "data_source", label: "Data Source" },
  { key: "result", label: "Result" },
  { key: "actual", label: "Actual" },
  { key: "comment", label: "Comment", max: 2000 },
  { key: "former_codes", label: "Former IDs" },
];

defineImporter({
  key: "okr_kpis",
  label: "OKR Workbook KPIs",
  permission: ["performance", "create"],
  capability: "performance.manage",
  entity: "kpi",
  schema: c.kpis.KpiImportRow,
  matchKeys: ["code"],
  fields: FIELDS,
  extract: workbook.extractKpis,

  async find(client, { value }) {
    const hit = await repo.findByCode(client, value);
    return hit ? { id: hit.kpi_definition_id, values: { code: value } } : null;
  },

  async write(client, values, ctx) {
    const period = await importPeriod(client);
    const dept = await goalsRepo.departmentByName(client, values.function);
    if (!dept) throw new AppError("VALIDATION_FAILED", `No function is called ${values.function}`, 422, { function: ["Not a function"] });
    const result = resultOf(values.result);
    const month = reportingMonth(period);
    return service.importKpi(client, ctx.actor, {
      department_id: dept.department_id,
      code: values.code,
      name: values.name,
      formula: values.formula || null,
      unit: values.unit || null,
      direction: directionOf(values.direction),
      target_text: values.target || null,
      target_value: targetNumber(values.target),
      frequency: frequencyOf(values.frequency),
      data_source: values.data_source || null,
      starts_period_id: period.performance_period_id,
      former_codes: workbook.codesIn(values.former_codes),
      month: result && month ? { month, result, actual_text: values.actual || null, comment: values.comment || null } : null,
    });
  },

  // A KPI a scorecard line scores from stays.
  isReferenced: (client, id) => repo.inUse(client, id),
  archive: (client, id, ctx) => service.removeImported(client, ctx.actor, id),
  // A KPI an import changed stays as it is now: the workbook holds no before-image to put back.
  restore: async () => undefined,
});

module.exports = { FIELDS, directionOf, frequencyOf, resultOf, targetNumber };
