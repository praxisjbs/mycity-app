"use strict";
/**
 * What the assistant may read about queries: the queries the asker may see, by the
 * same rule the screen keeps (queries.visibility.js: People with scope all every
 * query, anyone else only the ones they raised), one page of 25 at a time, and one
 * query with its response. It never raises, reminds or decides (A23); it sends the
 * person to Queries.
 *
 * Someone asking about their own queries is answered from ESS.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const visibility = require("./queries.visibility");
const service = require("./queries.service");

const cite = (row) => ({
  type: "query",
  id: row.employee_query_id,
  label: `${row.number}, ${row.employee.display_name}`,
});

module.exports = defineManifest({
  module: "queries",
  reads: [
    {
      key: "queries.list",
      description: "List queries: who a query is about, its subject, who raised it, and whether it waits for a response, is under review or is closed",
      params: c.queries.QueryListQuery,
      permission: ["queries", "view"],
      run: (_client, params, actor) => service.list(params, visibility.readerOf(actor.scope, actor)),
      cite,
    },
    {
      key: "queries.get",
      description: "One query: its details, the employee's response and the decision",
      params: c.common.IdParams,
      permission: ["queries", "view"],
      run: (_client, params, actor) => service.get(params.id, actor, actor.scope),
      cite,
    },
  ],
  routes: [
    { intent: "raise a query", screen: "queries.queries", params: { new: "1" }, prefill: c.queries.QueryCreate },
    { intent: "decide a query", screen: "queries.queries" },
  ],
});
