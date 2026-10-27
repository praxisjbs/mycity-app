"use strict";
/**
 * ⌘K for sanctions: found by number, the person or the rung, by the rule that decides
 * who sees the query it follows (docs/guides/queries.md §6.1): People with scope all
 * find every one, anyone else only sanctions on queries they raised. A result opens
 * Queries & Sanctions · Sanctions (shared/route-map.js sanction).
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "sanction",
  module: "queries",
  label: "Sanctions",
  words: ["sanction", "sanctions", "caution", "warning", "suspension", "dismissal", "san"],
  from: `sanction x
    JOIN employee_query q ON q.employee_query_id = x.employee_query_id
    JOIN employee e ON e.employee_id = x.employee_id
    LEFT JOIN consequence_step s ON s.consequence_step_id = x.consequence_step_id`,
  key: "x.sanction_id",
  columns: ["x.number", "e.first_name", "e.last_name", "e.preferred_name", "s.name", "x.sanction_type"],
  select:
    "x.sanction_id AS id, x.number::text AS ref, btrim(e.first_name || ' ' || e.last_name) AS title, COALESCE(s.name, x.sanction_type) AS sub, x.status AS status",
  where: "x.status IN ('issued', 'pending_approval')",
  order: "x.created_at DESC",
  owner: { column: "q.raised_by", exceptAll: true },
});
