"use strict";
/**
 * What the assistant may read and do about KPIs: the functions' operational KPIs with their latest
 * result, 25 at a time (docs/guides/performance.md §9); and, as cards the person confirms
 * (docs/guides/praxis-ai.md §6.11, decisions 33 and 40), New KPI and Edit KPI, each through the
 * service function the screen's own button calls, held to `goals.function` as their routes are. It
 * never records an actual: Record Actual and Report Month stay on KPIs and Goals.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const { quantityOf } = require("../../shared/ai/named");
const routeMap = require("../../shared/route-map");
const goals = require("../goals/goals.service");
const service = require("./kpis.service");

const kpiLine = (status) => (k) => [{ type: "kpi", id: k.kpi_definition_id, label: `${k.code} ${k.name}`, status, link: (routeMap.linkFor("kpi", k.kpi_definition_id) || {}).path || null }];
const LABELS = { name: "KPI", formula: "Formula", unit: "Unit", direction: "Direction", target_text: "Target Wording", target_value: "Target Figure", frequency: "Frequency", data_source: "Data Source" };

module.exports = defineManifest({
  module: "performance",
  actions: [
    {
      key: "kpis.create",
      label: "Set KPI",
      description: "Set a function's KPI: the function, its name, formula, unit, direction, target wording and figure, frequency, data source and first quarter; its code is given",
      input: c.kpis.KpiCreate,
      permission: ["performance", "create"],
      // As the route: POST /performance/kpis asks requireCapability("goals.function"); the head's own rule is the service's.
      capability: "goals.function",
      risk: "standard",
      fields: ["department_id", "name", "formula", "unit", "direction", "target_text", "target_value", "frequency", "data_source", "starts_period_id"],
      picks: { department_id: "department" },
      resolve: {
        department_id: (value, _actor, db) => goals.departmentIdOf(db, value),
        starts_period_id: (value, _actor, db) => goals.periodIdOf(db, value),
        // The figure as the person said it ("95%"): its number, the unit kept on its own field.
        target_value: (value) => quantityOf(value),
      },
      // What it needs, asked first when not said (praxis-ai.md decision 34): the functions the person sets KPIs for, to tap.
      asks: [
        { field: "name", question: "What is the KPI called?" },
        { field: "department_id", question: "Which function is it for?", options: ({ actor, db }) => goals.functionChoices(db, actor) },
        { field: "target_text", question: "What is the target?" },
      ],
      names: (values, _actor, db) => goals.cardNames(db, { departments: [values.department_id], periods: [values.starts_period_id] }),
      run: (values, actor) => service.create(actor, values),
      readback: kpiLine("set"),
      labels: { department_id: "Function", ...LABELS, starts_period_id: "First Quarter" },
    },
    {
      key: "kpis.edit",
      label: "Save KPI",
      description: "Change a KPI (its code such as TBO-K01, or its name): its name, formula, unit, target wording or data source; only what changes",
      input: c.kpis.KpiChange,
      permission: ["performance", "edit"],
      capability: "goals.function",
      risk: "standard",
      form: "none: Edit KPI is opened on its KPI and never names it; the card names the KPI",
      fields: ["kpi_definition_id", "name", "formula", "unit", "target_text", "data_source"],
      asks: [{ field: "kpi_definition_id", question: "Which KPI?", options: ({ actor, db }) => service.kpiChoices(db, actor) }],
      resolve: { kpi_definition_id: (value, actor, db) => service.kpiIdOf(db, value, actor) },
      records: (values, actor, db) => (db ? service.cardKpi(db, values.kpi_definition_id, actor) : []),
      check: (client, values, actor) => service.assertCardKpi(client, values.kpi_definition_id, actor),
      run: (values, actor) => {
        const { kpi_definition_id: id, ...changes } = values;
        return service.update(actor, id, changes);
      },
      readback: kpiLine("saved"),
      labels: { kpi_definition_id: "KPI", ...LABELS, name: "Name" },
    },
  ],
  // Edit KPI's own form, reached through the card that names its KPI (gate 23, praxis-ai.md decision 33).
  not_offered: {
    KpiEdit: "via kpis.edit: Edit KPI's own form, which never names its KPI; the card is KpiChange",
  },
  reads: [
    {
      key: "kpis.list",
      description: "List the functions' KPIs with their target and latest monthly result (Met, Not Met or N/A)",
      params: c.kpis.KpiListQuery,
      permission: ["performance", "view"],
      run: (_client, params, actor) => service.list(params, actor),
      cite: (row) => ({ type: "kpi", id: row.kpi_definition_id, label: `${row.code} ${row.name}` }),
    },
  ],
  routes: [{ intent: "see a function's KPIs", screen: "performance.kpis" }],
});
