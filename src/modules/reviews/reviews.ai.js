"use strict";
/**
 * What the assistant may read about reviews: who is reviewed in a cycle, the ratings and where
 * each review stands, within the asker's `performance` scope, one page of 25 at a time. Never
 * the answers or comments (docs/guides/performance.md §9), and never a write (A23): it sends the
 * person to their review.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./reviews.service");

module.exports = defineManifest({
  module: "performance",
  reads: [
    {
      key: "reviews.list",
      description: "List reviews in a cycle: who, their self rating, their manager's rating, and where the review stands",
      params: c.reviews.ReviewListQuery,
      permission: ["performance", "view"],
      run: (_client, params, actor) => service.list(params, actor.scope, actor),
      cite: (row) => ({ type: "review", id: row.performance_review_id, label: `${row.employee.display_name}: ${row.cycle}` }),
    },
  ],
  routes: [
    { intent: "start my review", screen: "ess.my-performance" },
    { intent: "see reviews", screen: "performance.reviews" },
  ],
});
