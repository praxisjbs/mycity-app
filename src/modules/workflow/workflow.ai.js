"use strict";
/**
 * What the assistant may read about approvals: the requests waiting on the person
 * asking, so "what is waiting on me?" is answered from the same list as My
 * Approvals, and the same queue counted (approvals.summary: by flow, age, stage or
 * module; figures, never rows, docs/guides/praxis-ai.md §6.13). It never decides one
 * (A23); changing a flow is a route to Settings, Approvals, where a person does it.
 *
 * The read is the asker's own queue, so its permission is `ess` view, which every
 * login holds; the service narrows it to what names them.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./workflow.service");

module.exports = defineManifest({
  module: "settings",
  summaries: [
    {
      key: "approvals.summary",
      description: "How many requests wait on me for a decision, how many are past their time and how old the oldest is, by flow, age, stage or module",
      params: c.workflow.ApprovalSummaryQuery,
      permission: ["ess", "view"],
      run: (client, params, actor) => service.aiSummary(client, params, actor),
    },
  ],
  reads: [
    {
      key: "approvals.mine",
      description: "List the requests waiting on me for a decision, oldest first, with the stage each one is at",
      params: c.workflow.ApprovalMineQuery,
      permission: ["ess", "view"],
      run: (_client, params, actor) => service.mine(actor, params),
      cite: (row) => ({ type: row.entity_type, id: row.entity_id, label: row.definition_name }),
    },
  ],
  routes: [{ intent: "change who approves a request", screen: "settings.approvals" }],
});
