"use strict";
/**
 * ⌘K for payslips, two ways (docs/guides/payroll.md §9).
 *
 * Payroll readers: a payslip found by its number or the person's name, by any holder of `payroll` view, within their
 * `payroll` scope, exactly as Payroll · Payslips lists them: a draft of a run still in the approval and a published one
 * alike, and never an amount (the title is the person, the month and the status). A result opens the payslip's month on
 * Payroll · Payslips (shared/route-map.js payslip).
 *
 * Everyone else, and a Payroll reader too for their own: a payslip found by its number or its month, pinned to the person
 * it belongs to whatever their grant says (`owner`), and only once published, as My Payslips lists them. A result opens
 * My Payslips (shared/route-map.js payroll_own_payslip); a person never finds another's through it.
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = [
  recordProvider({
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
  }),
  recordProvider({
    type: "payroll_own_payslip",
    module: "ess",
    label: "My Payslips",
    words: ["my payslips", "my payslip", "payslip", "pay slip", "salary slip"],
    from: "payslip p JOIN payroll_run r ON r.payroll_run_id = p.payroll_run_id JOIN app_user u ON u.employee_id = p.employee_id",
    key: "p.payslip_id",
    columns: ["p.number", "to_char(r.period, 'FMMonth YYYY')"],
    select: "p.payslip_id AS id, p.number::text AS ref, to_char(r.period, 'FMMonth YYYY') || ' payslip' AS title, p.status AS status",
    where: "p.status = 'published'",
    order: "r.period DESC",
    owner: { column: "u.user_id" },
  }),
];
