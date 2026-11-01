"use strict";
/**
 * What the assistant may read and do about approvals: the requests waiting on the person
 * asking, so "what is waiting on me?" is answered from the same list as My Approvals, and the
 * same queue counted (approvals.summary: by flow, age, stage or module; figures, never rows,
 * docs/guides/praxis-ai.md §6.13); and, as a card the person confirms after Confirm It's You
 * (§6.11, risk approval), approving, rejecting or returning the requests waiting on them, up to
 * 25 a press, each through the same decide() My Approvals' buttons call: the stage must name
 * them, they must hold approve on the request's module, and nobody decides their own. A request
 * decided on its own record (a sanction) is refused with that record's screen offered. Changing
 * a flow is a route to Settings, Approvals, where a person does it.
 *
 * The read and the card are the asker's own queue, so their permission is `ess` (view to read,
 * create to record a decision), which every login holds; the service narrows both to what names
 * them.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./workflow.service");

module.exports = defineManifest({
  module: "settings",
  actions: [
    {
      key: "approvals.decide",
      label: "Decide Requests",
      description: "Approve, reject or return for changes the requests waiting on me, with a note for the requester",
      input: c.workflow.ApprovalDecide,
      permission: ["ess", "create"],
      risk: "approval",
      bulk: 25,
      // My Approvals' Approve is one press; Reject and Request Changes ask their reason in a sheet (workflow.ReasonBody).
      form: "none: Approve is one press on a request and Reject or Request Changes ask a reason in a sheet; the card decides several at once",
      records: (values, actor, db) => (db ? service.cardRecords(db, values.workflow_instance_ids, actor) : (values.workflow_instance_ids || []).map((id) => ({ type: "workflow_instance", id }))),
      check: (client, values, actor) => service.assertCardInstances(client, values.workflow_instance_ids, actor),
      run: (values, actor) => service.decideMany(actor, values),
      readback: (r) => r.lines,
      labels: { workflow_instance_ids: "Requests", decision: "Decision", reason: "Reason" },
    },
  ],
  // Every other Create schema of this module's contract, and why the assistant does not offer it (gate 23).
  not_offered: {
    ApprovalFlowCreate: "an approval flow is Settings, designed stage by stage on Settings, Approvals",
  },
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
