"use strict";
/**
 * ⌘K for queries: a query found by its number, the person or its subject, by the same
 * rule the Queries list keeps (docs/guides/queries.md §6.1): People with scope all find
 * every one, anyone else only the queries they raised. A result opens the query on
 * Queries & Sanctions · Queries (shared/route-map.js query).
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "query",
  module: "queries",
  label: "Queries",
  words: ["query", "queries", "qry"],
  from: "employee_query q JOIN employee e ON e.employee_id = q.employee_id",
  key: "q.employee_query_id",
  columns: ["q.number", "e.first_name", "e.last_name", "e.preferred_name", "q.subject"],
  select:
    "q.employee_query_id AS id, q.number::text AS ref, btrim(e.first_name || ' ' || e.last_name) AS title, q.subject AS sub, q.status AS status",
  order: "q.created_at DESC",
  owner: { column: "q.raised_by", exceptAll: true },
});
