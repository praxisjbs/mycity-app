"use strict";
/**
 * What the assistant may read about KPIs: a month's KPIs with weights and progress, and one
 * person's month, within the asker's `performance` scope, one page of 25 at a time. It never
 * sets KPIs or records a figure (A23); it sends the person to Assign KPIs.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./kpis.service");

module.exports = defineManifest({
  module: "performance",
  reads: [
    {
      key: "kpis.list",
      description: "List a month's KPIs: person, KPI, weight, progress and whether it is on track",
      params: c.kpis.KpiListQuery,
      permission: ["performance", "view"],
      run: (_client, params, actor) => service.list(params, actor.scope, actor),
      cite: (row) => ({ type: "kpi", id: row.employee_target_id, label: `${row.employee.display_name}: ${row.title}` }),
    },
    {
      key: "kpis.of_employee",
      description: "One person's KPIs for a month, their weights, total and KPI score",
      params: c.common.IdParams,
      permission: ["performance", "view"],
      run: (_client, params, actor) => service.ofEmployee(params.id, {}, actor.scope, actor),
      cite: (row) => ({ type: "kpi", id: row.employee_target_id, label: row.title }),
    },
  ],
  routes: [
    { intent: "set KPIs for someone", screen: "performance.kpis", params: { new: "1" } },
    { intent: "see this month's KPIs", screen: "performance.kpis" },
  ],
});
