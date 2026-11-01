"use strict";
/**
 * What the assistant may read about policies (docs/guides/policies.md §9):
 *
 *   policies.mine    the policies that apply to the asker, To Acknowledge first, with their due dates
 *   policies.read    one version that applies to the asker: its text or its rules in sentences
 *   policies.list    every policy with its state and acknowledgements, for those who write policies
 *                    (`policies.manage`); anyone else is answered with nothing
 *
 * Every list is a page of 25 through the same service as the screen. The assistant never writes,
 * publishes, approves or acknowledges a policy (A23): it sends the person to Policy Updates or to
 * Knowledge Hub · Policies.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./policies.service");

const EMPTY = { data: [], page: { number: 1, size: 25, total: 0, pages: 0, has_next: false } };

module.exports = defineManifest({
  module: "knowledge",
  // Every Create schema of this module's contract, and why the assistant does not offer it (gate 23).
  not_offered: {
    PolicyCreate: "a policy is written and published on Knowledge Hub, Policies by those who manage policies, through its own flow",
  },
  reads: [
    {
      key: "policies.mine",
      description: "List the company policies that apply to me, those I still have to acknowledge first, with their versions and due dates",
      params: c.policies.MyPolicyListQuery,
      permission: ["ess", "view"],
      run: (_client, params, actor) => (actor.employee_id ? service.mine(actor, params) : EMPTY),
      cite: (row) => ({ type: "policy_version", id: row.policy_version_id, label: `${row.title}, Version ${row.version}` }),
    },
    {
      key: "policies.read",
      description: "Read one policy version that applies to me: its text, or its rules as sentences, what changed and when it applies",
      params: c.common.IdParams,
      permission: ["ess", "view"],
      run: async (_client, params, actor) => ({ data: [await service.myVersion(actor, params.id)], page: { ...EMPTY.page, total: 1, pages: 1 } }),
      cite: (row) => ({ type: "policy_version", id: row.policy_version_id, label: `${row.title}, Version ${row.version}` }),
    },
    {
      key: "policies.list",
      description: "List every company policy with its state, the version in force and how many have acknowledged it (for people who write policies)",
      params: c.policies.PolicyListQuery,
      permission: ["knowledge", "view"],
      run: async (_client, params, actor) => ((await service.canManage(pool, actor)) ? service.list(params) : EMPTY),
      cite: (row) => ({ type: "policy", id: row.policy_id, label: row.title }),
    },
  ],
  routes: [
    { intent: "read or acknowledge a company policy", screen: "ess.policy-updates" },
    { intent: "approve a policy waiting on me", screen: "ess.policy-updates" },
    { intent: "write or publish a policy", screen: "knowledge.policies" },
    { intent: "change the attendance policy", screen: "knowledge.policies", params: { policy: "attendance" } },
  ],
});
