"use strict";
/**
 * ⌘K for KPIs: a KPI by its code or name, or a former code from the workbook's change map
 * (docs/guides/performance.md §9). Shared, not scoped, as the KPIs screen is. A result opens on
 * Performance · KPIs.
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "kpi",
  module: "performance",
  label: "KPIs",
  words: ["kpi", "kpis", "indicator"],
  from: "kpi_definition k LEFT JOIN department d ON d.department_id = k.department_id",
  key: "k.kpi_definition_id",
  columns: [
    "k.code",
    "k.name",
    `COALESCE((SELECT string_agg(a.alias_code::text, ' ') FROM okr_code_alias a
                WHERE a.kpi_definition_id = k.kpi_definition_id), '')`,
  ],
  select: "k.kpi_definition_id AS id, k.code::text AS ref, k.name AS title, d.name AS sub, CASE WHEN k.active THEN 'active' ELSE 'retired' END AS status",
  where: "k.department_id IS NOT NULL",
  order: "k.code",
});
