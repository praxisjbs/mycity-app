"use strict";
/**
 * ⌘K for KPIs: a person's KPI found by its title or the person's name, among the people in the
 * reader's `performance` scope, as the KPIs screen lists them. A result opens Performance · KPIs
 * (shared/route-map.js kpi).
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "kpi",
  module: "performance",
  label: "KPIs",
  words: ["kpi", "kpis", "key performance indicator", "weights"],
  from: "employee_target t JOIN employee e ON e.employee_id = t.employee_id",
  key: "t.employee_target_id",
  columns: ["t.title", "e.first_name", "e.last_name"],
  select:
    "t.employee_target_id AS id, to_char(t.month, 'YYYY-MM') AS ref, t.title AS title, btrim(e.first_name || ' ' || e.last_name) AS sub, t.status AS status",
  where: "t.status <> 'cancelled'",
  order: "t.month DESC",
  scope: { column: "t.employee_id" },
});
