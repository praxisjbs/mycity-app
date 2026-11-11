"use strict";
/**
 * ⌘K for deductions: a fine accepted or an advance recorded, found by the person's name or the reason, by
 * any holder of `payroll` view, as Payroll · Deductions lists them (docs/guides/payroll.md §9). A deduction
 * belongs to the organisation's payroll, not to one person's scope; its title is the person and what it is,
 * never an amount. A fine still waiting is a sanction's, found with its query under Queries & Sanctions; it
 * joins this list once payroll accepts it. A result opens the screen (shared/route-map.js deduction).
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "deduction",
  module: "payroll",
  label: "Deductions",
  words: ["deduction", "fine", "advance", "loan", "salary advance"],
  from: "payroll_deduction dd JOIN employee e ON e.employee_id = dd.employee_id",
  key: "dd.payroll_deduction_id",
  columns: ["e.first_name", "e.last_name", "dd.reason"],
  select: `dd.payroll_deduction_id AS id,
           CASE dd.source WHEN 'sanction_fine' THEN 'Fine' ELSE 'Advance' END AS ref,
           btrim(e.first_name || ' ' || e.last_name) AS title,
           dd.reason AS sub, dd.status AS status`,
  where: "dd.status <> 'cancelled'",
  order: "dd.created_at DESC",
});
