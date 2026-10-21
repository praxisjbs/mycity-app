"use strict";
/**
 * What the assistant may read about goals: the cascade from the CEO's organisational goals
 * down to departmental targets, one page of 25 at a time, and the chain any goal rolls up
 * to. It never sets, edits, submits or approves a goal (A23); it sends the person to New
 * Goal on Performance · Goals.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./goals.service");
const trace = require("./goals.trace");

module.exports = defineManifest({
  module: "performance",
  reads: [
    {
      key: "goals.list",
      description:
        "List goals by level (organisational, annual, monthly, departmental), status, year or month, with progress and what each rolls up to",
      params: c.goals.GoalListQuery,
      permission: ["performance", "view"],
      run: (_client, params) => service.list(params),
      cite: (row) => ({ type: "goal", id: row.organisational_goal_id, label: `${row.code || ""} ${row.title}`.trim() }),
    },
    {
      key: "goals.trace",
      description: "The chain of goals one goal rolls up to, up to its organisational goal",
      params: c.common.IdParams,
      permission: ["performance", "view"],
      run: (client, params) => trace.traceOf(client, params.id),
      cite: (row) => ({ type: "goal", id: row.organisational_goal_id, label: `${row.code || ""} ${row.title}`.trim() }),
    },
  ],
  routes: [
    { intent: "set a goal", screen: "performance.goals", params: { new: "1" }, prefill: c.goals.GoalCreate },
    { intent: "see the organisation's goals", screen: "performance.goals" },
  ],
});
