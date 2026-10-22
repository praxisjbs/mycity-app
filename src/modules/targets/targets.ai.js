"use strict";
/**
 * What the assistant may read about scorecards and commitments: score to date and rating, and a
 * month's commitments with their states, within the asker's own `performance` scope, 25 at a time
 * (docs/guides/performance.md §9). Never a line's evidence or a review's comments, and never a
 * write (A23).
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./targets.service");
const commitments = require("./targets.commitments");

module.exports = defineManifest({
  module: "performance",
  reads: [
    {
      key: "scorecards.list",
      description: "List scorecards in my scope: person, department, reviewer, status, score to date and rating",
      params: c.targets.ScorecardListQuery,
      permission: ["performance", "view"],
      run: (_client, params, actor) => service.list(params, actor.scope),
      cite: (row) => ({ type: "scorecard", id: row.scorecard_id, label: `${row.employee.display_name}, ${row.period_name}` }),
    },
    {
      key: "commitments.list",
      description: "List a month's commitments in my scope: who, what, original date, date now and state (due, on time, late, missed, rescoped)",
      params: c.targets.CommitmentListQuery,
      permission: ["performance", "view"],
      run: (_client, params, actor) => commitments.list({ ...params, waiting_on_me: undefined }, actor.scope),
      cite: (row) => ({ type: "task", id: row.task_id, label: `${row.number} ${row.title}` }),
    },
  ],
  routes: [
    { intent: "open a scorecard", screen: "performance.targets" },
    { intent: "draft a scorecard", screen: "performance.targets", params: { new: "1" } },
  ],
});
