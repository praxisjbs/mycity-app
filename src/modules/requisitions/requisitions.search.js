"use strict";
/**
 * ⌘K for requisitions: one found by its number, for holders of `expenses.finance` (the CEO among
 * them), as Expenses · Requisitions lists them. A result opens Expenses · Requisitions
 * (shared/route-map.js requisition).
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "requisition",
  module: "expenses",
  label: "Requisitions",
  words: ["requisition", "requisitions"],
  capability: "expenses.finance",
  from: "requisition r",
  key: "r.requisition_id",
  columns: ["r.number"],
  select: "r.requisition_id AS id, r.number AS ref, r.number AS title, NULL::text AS sub, r.status AS status",
  order: "r.submitted_at DESC NULLS LAST",
});
