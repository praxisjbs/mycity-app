"use strict";
/**
 * What the assistant may read about reviews: their stages and scores within the asker's own
 * `performance` scope and the reviews that name them, 25 at a time (docs/guides/performance.md §9).
 * Never a check-in's actions, evidence or transcripts, a reviewer's comments, a dotted manager's
 * input, conduct or an improvement plan, and never a write (A23). reviews.summary counts the same
 * reviews by stage, rating, department or round (figures, never rows, docs/guides/praxis-ai.md §6.13).
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./reviews.service");

module.exports = defineManifest({
  module: "performance",
  // Every Create schema of this module's contract, and why the assistant does not offer it (gate 23).
  not_offered: {
    PipCreate: "an improvement plan is opened on a review by People, with the review in view",
    RoundCreate: "a review round is opened on Performance by People, for the whole company at once",
  },
  summaries: [
    {
      key: "reviews.summary",
      description: "Review counts in my scope: at check-in, with reviewers, second level, with HR, closed, withdrawn, waiting on me, by stage, rating, department or round",
      params: c.reviews.ReviewSummaryQuery,
      permission: ["performance", "view"],
      run: (client, params, actor) => service.aiSummary(client, params, actor, actor.scope),
    },
  ],
  reads: [
    {
      key: "reviews.list",
      description: "List reviews in my scope: person, reviewer, month, stage, due date, score and rating",
      params: c.reviews.ReviewListQuery,
      permission: ["performance", "view"],
      run: (_client, params, actor) => service.list(actor, params, actor.scope),
      cite: (row) => ({ type: "review", id: row.performance_review_id, label: `${row.employee.display_name}, ${row.round_name || "Probation"}` }),
    },
  ],
  routes: [
    { intent: "open a review", screen: "performance.reviews" },
    { intent: "do my check-in", screen: "ess.my-performance", params: { check_in: "1" } },
  ],
});
