"use strict";
/**
 * ⌘K for payslips: a payslip found by its number or the person's name, by any holder of `payroll` view, within their
 * `payroll` scope, exactly as Payroll · Payslips lists them (docs/guides/payroll.md §9): a draft of a run still in the
 * approval and a published one alike, and never an amount (the title is the person, the month and the status). A
 * result opens the payslip's month on Payroll · Payslips (shared/route-map.js payslip). A person finds their own
 * payslips through My Payslips; the assistant's own reads and a search pinned to the owner come with M6 PR 6.
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "payslip",
  module: "payroll",
  label: "Payslips",
  words: ["payslip", "pay slip", "salary slip"],
  from: "payslip p JOIN payroll_run r ON r.payroll_run_id = p.payroll_run_id JOIN employee e ON e.employee_id = p.employee_id",
  key: "p.payslip_id",
  columns: ["p.number", "e.first_name", "e.last_name", "e.preferred_name"],
  select:
    "p.payslip_id AS id, p.number::text AS ref, btrim(e.first_name || ' ' || e.last_name) AS title, to_char(r.period, 'FMMonth YYYY') AS sub, p.status AS status",
  order: "r.period DESC, e.first_name, e.last_name",
  scope: { column: "p.employee_id" },
});
