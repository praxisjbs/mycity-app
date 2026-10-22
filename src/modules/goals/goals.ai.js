"use strict";
/**
 * What the assistant may read about goals: the OKR tree (a function's or the company's objectives
 * and key results with their latest status and score) and what a key result rolls up to, 25 at a
 * time (docs/guides/performance.md §9). It never reports a month or confirms a score (A23); it
 * sends the head to Report Month.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const okrs = require("./goals.okrs");

module.exports = defineManifest({
  module: "performance",
  reads: [
    {
      key: "goals.okrs",
      description: "List a quarter's objectives with their key results, owners, latest status and score; the company's or a function's",
      params: c.goals.OkrListQuery,
      permission: ["performance", "view"],
      run: (_client, params) => okrs.listOkrs(params),
      cite: (row) => ({ type: "objective", id: row.okr_objective_id, label: `${row.code} ${row.title}` }),
    },
    {
      key: "goals.trace",
      description: "What a key result rolls up to: the company key result, the objective and the organisational goal",
      params: c.goals.TraceQuery,
      permission: ["performance", "view"],
      run: async (_client, params) => {
        const t = await okrs.trace(params.okr_key_result_id);
        return { data: t.steps, page: { number: 1, size: 25, total: t.steps.length, pages: 1, has_next: false } };
      },
      cite: (row) => ({ type: row.kind === "organisational_goal" ? "organisational_goal" : row.kind === "objective" ? "objective" : "key_result", id: row.id, label: `${row.code || ""} ${row.title}`.trim() }),
    },
  ],
  routes: [
    { intent: "see the quarter's OKRs", screen: "performance.goals" },
    { intent: "report the month", screen: "performance.goals", params: { report: "1" } },
  ],
});
