"use strict";
/**
 * ⌘K for payroll runs: a run found by its number or its month ("PAY-2026-10", "October 2026"), by any
 * holder of `payroll` view, exactly as Payroll Runs lists them (docs/guides/payroll.md §9). A run is the
 * organisation's, not one person's, so no scope narrows it; its title is the month and its status, never
 * an amount. A result opens the run (shared/route-map.js payroll_run). Payslips and deductions are found
 * with their own providers (M6 PR 6).
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "payroll_run",
  module: "payroll",
  label: "Payroll Runs",
  words: ["payroll", "payroll run", "run", "salaries", "salary"],
  from: "payroll_run r",
  key: "r.payroll_run_id",
  columns: ["r.number", "to_char(r.period, 'FMMonth YYYY')"],
  select: "r.payroll_run_id AS id, r.number AS ref, to_char(r.period, 'FMMonth YYYY') || ' payroll' AS title, r.status AS status",
  order: "r.period DESC",
});
