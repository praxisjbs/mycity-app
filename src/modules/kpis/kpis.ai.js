"use strict";
/**
 * What the assistant may read about KPIs: the functions' operational KPIs with their latest
 * result, 25 at a time (docs/guides/performance.md §9). It never records an actual (A23).
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./kpis.service");

module.exports = defineManifest({
  module: "performance",
  reads: [
    {
      key: "kpis.list",
      description: "List the functions' KPIs with their target and latest monthly result (Met, Not Met or N/A)",
      params: c.kpis.KpiListQuery,
      permission: ["performance", "view"],
      run: (_client, params) => service.list(params),
      cite: (row) => ({ type: "kpi", id: row.kpi_definition_id, label: `${row.code} ${row.name}` }),
    },
  ],
  routes: [{ intent: "see a function's KPIs", screen: "performance.kpis" }],
});
