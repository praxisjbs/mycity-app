"use strict";
/**
 * What the assistant may read about goals: the OKR tree (a function's or the company's objectives
 * and key results with their latest status and score), what a key result rolls up to, 25 at a
 * time, and a quarter's Performance Analytics in the asker's scope, scores and counts only
 * (docs/guides/performance.md §8, §9). It reads only what the asker reads on Goals (§6.23): their
 * department's, what is shared with them, the key results they own; the whole plan for the CEO and Management.
 * It never reports a month or confirms a score (A23); it sends the head to Report Month.
 *
 * goals.summary counts the quarter (docs/guides/praxis-ai.md §6.13): key results by status, the
 * scores by function and month, the ratings at the latest closed round; figures, never rows, within
 * the same reach and scope as Analytics.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const okrs = require("./goals.okrs");
const analytics = require("./goals.analytics");

module.exports = defineManifest({
  module: "performance",
  summaries: [
    {
      key: "goals.summary",
      description: "A quarter's performance figures: key results by status, the company's and each function's score by month, ratings at the latest closed round",
      params: c.goals.PerformanceSummaryQuery,
      permission: ["performance", "view"],
      run: (client, params, actor) => analytics.aiSummary(params, actor.scope, { db: client, actor }),
    },
  ],
  reads: [
    {
      key: "goals.okrs",
      description: "List a quarter's objectives with their key results, owners, latest status and score; the company's or a function's",
      params: c.goals.OkrListQuery,
      permission: ["performance", "view"],
      run: (_client, params, actor) => okrs.listOkrs(params, actor),
      cite: (row) => ({ type: "objective", id: row.okr_objective_id, label: `${row.code} ${row.title}` }),
    },
    {
      key: "goals.trace",
      description: "What a key result rolls up to: the company key result, the objective and the organisational goal",
      params: c.goals.TraceQuery,
      permission: ["performance", "view"],
      run: async (_client, params, actor) => {
        const t = await okrs.trace(params.okr_key_result_id, actor);
        return { data: t.steps, page: { number: 1, size: 25, total: t.steps.length, pages: 1, has_next: false } };
      },
      cite: (row) => ({ type: row.kind === "organisational_goal" ? "organisational_goal" : row.kind === "objective" ? "objective" : "key_result", id: row.id, label: `${row.code || ""} ${row.title}`.trim() }),
    },
    {
      key: "goals.analytics",
      description:
        "A quarter's analytics: function scores by month, key results by status, ratings, on-time check-ins, reviews and commitments, self against final",
      params: c.goals.PerformanceAnalyticsQuery,
      permission: ["performance", "view"],
      run: (client, params, actor) => analytics.figures(params, actor.scope, { db: client, actor }),
      // Aggregates: nothing to open. The people behind them are scorecards.list (targets.ai.js).
      cite: () => null,
    },
  ],
  routes: [
    { intent: "see the quarter's OKRs", screen: "performance.goals" },
    { intent: "report the month", screen: "performance.goals", params: { report: "1" } },
    { intent: "see performance analytics", screen: "performance.analytics" },
  ],
});
