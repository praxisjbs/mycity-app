"use strict";
/**
 * ⌘K for disbursements: a transfer found by its number, its request's number or its bank
 * reference, for holders of `expenses.finance`, as Expenses · Disbursements lists them. A result
 * opens Expenses · Disbursements (shared/route-map.js disbursement).
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "disbursement",
  module: "expenses",
  label: "Disbursements",
  words: ["disbursement", "payment", "transfer"],
  capability: "expenses.finance",
  from: `disbursement ds
    JOIN expense_request er ON er.expense_request_id = ds.expense_request_id`,
  key: "ds.disbursement_id",
  columns: ["ds.number", "er.number", "ds.payment_reference", "ds.recipient_name"],
  select:
    "ds.disbursement_id AS id, ds.number AS ref, er.purpose AS title, ds.recipient_name AS sub, CASE WHEN ds.payment_reference IS NULL THEN 'reference_missing' ELSE 'paid' END AS status",
  order: "ds.paid_at DESC",
  scope: { column: "er.employee_id" },
});
