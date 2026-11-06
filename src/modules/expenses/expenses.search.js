"use strict";
/**
 * ⌘K for expense requests: a request found by its number, its purpose or its payee, within the
 * reader's `expenses` scope, exactly as Expenses lists it (a requester their own, a line manager
 * their team's, Operations & People everyone's). A draft is never found: until it is sent it is
 * its requester's alone, and My Requests lists it. A result opens the request
 * (shared/route-map.js expense).
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "expense",
  module: "expenses",
  label: "Expense Requests",
  words: ["expense", "expenses", "expense request", "claim"],
  from: `expense_request er
    JOIN employee e ON e.employee_id = er.employee_id`,
  key: "er.expense_request_id",
  columns: ["er.number", "er.purpose", "er.payee_name", "e.first_name", "e.last_name"],
  select:
    "er.expense_request_id AS id, er.number AS ref, er.purpose AS title, btrim(e.first_name || ' ' || e.last_name) AS sub, er.status AS status",
  where: "er.status <> 'draft'",
  order: "er.submitted_at DESC NULLS LAST",
  scope: { column: "er.employee_id" },
});
