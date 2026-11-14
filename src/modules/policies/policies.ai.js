"use strict";
/**
 * What the assistant may read about policies (docs/guides/policies.md §9):
 *
 *   policies.mine    the policies that apply to the asker, To Acknowledge first, with their due dates
 *   policies.read    one version that applies to the asker: its text or its rules in sentences
 *   policies.list    every policy with its state and acknowledgements, for those who write policies
 *                    (`policies.manage`); anyone else is answered with nothing
 *
 * Every list is a page of 25 through the same service as the screen. As cards the person confirms
 * (docs/guides/praxis-ai.md §6.11, decision 33), for a holder of `policies.manage` as the routes
 * hold it: Start Policy (New Policy's sheet, its title alone) and Save Draft (the draft's settings,
 * who it applies to and a written policy's text, only what changes). Publishing, submitting and
 * approving are signed on the screen, and acknowledging is the person's own (A23): the assistant
 * sends the person to Policy Updates or to Knowledge Hub · Policies for those.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { defineManifest } = require("../../shared/ai/manifest");
const routeMap = require("../../shared/route-map");
const people = require("../organisation/organisation.cards");
const service = require("./policies.service");

const MANAGE = "policies.manage";
const policyLine = (status) => (p) => [{ type: "policy", id: p.policy_id, label: `${p.number} ${p.title}`, status, link: (routeMap.linkFor("policy", p.policy_id) || {}).path || null }];

/** The departments and people a draft's Applies To names, by name. */
async function audienceNames(values, db) {
  const departments = await Promise.all((values.department_ids || []).slice(0, 50).map((id) => people.cardDepartment(db, id)));
  return [...departments.flat(), ...(await people.peopleNamed(db, values.employee_ids || []))];
}

const EMPTY = { data: [], page: { number: 1, size: 25, total: 0, pages: 0, has_next: false } };

module.exports = defineManifest({
  module: "knowledge",
  actions: [
    {
      key: "policies.start",
      label: "Start Policy",
      description: "Start a written company policy by its title, applying to everyone and acknowledged within 7 days; its text and settings follow in its draft",
      input: c.policies.PolicyStart,
      permission: ["knowledge", "create"],
      // As the route: POST /policies asks requireCapability("policies.manage").
      capability: MANAGE,
      risk: "standard",
      asks: [{ field: "title", question: "What is the policy called?" }],
      // The same function New Policy's Start Policy calls, with the settings the sheet sends.
      run: (values, actor) => service.start(actor, values),
      readback: policyLine("started"),
      labels: { title: "Title" },
    },
    {
      key: "policies.draft",
      label: "Save Draft",
      description: "Change a policy's draft: its title, who it applies to (everyone, departments, work patterns, people), acknowledgement, approval, and a written policy's text in Markdown; only what changes",
      input: c.policies.PolicyDraftChange,
      permission: ["knowledge", "edit"],
      capability: MANAGE,
      risk: "standard",
      form: "none: the draft's page changes the policy open on Knowledge Hub, Policies, its text in the rich text editor; the card names the policy and carries Markdown",
      fields: ["policy_id", "title", "everyone", "department_ids", "work_patterns", "employee_ids", "needs_acknowledgement", "acknowledge_within_days", "needs_approval", "body"],
      picks: { department_ids: "department", employee_ids: "employee" },
      resolve: { policy_id: (value, _actor, db) => service.idOf(db, value) },
      asks: [{ field: "policy_id", question: "Which policy?", read: "policies.list" }],
      names: (values, _actor, db) => audienceNames(values, db),
      records: (values, _actor, db) => service.cardPolicy(db, values.policy_id),
      check: (client, values) => service.assertCardPolicy(client, values.policy_id),
      // Save Draft's own function: only what changes, the rest kept as the draft holds it.
      run: (values, actor) => {
        const { policy_id: id, ...changes } = values;
        return service.changeDraft(actor, id, changes);
      },
      readback: policyLine("draft saved"),
      labels: { policy_id: "Policy", title: "Title", everyone: "Everyone", department_ids: "Departments", work_patterns: "Work Patterns", employee_ids: "People", needs_acknowledgement: "Acknowledge", acknowledge_within_days: "Within Days", needs_approval: "Needs Approval", body: "Text" },
    },
  ],
  // The forms' own requests, reached through the cards (gate 23, praxis-ai.md decision 33).
  not_offered: {
    PolicyCreate: "via policies.start: New Policy's own request, the sheet asking the title and sending its start settings; the card is PolicyStart",
    PolicyDraftSave: "via policies.draft: Save Draft's own request, which never names its policy and sends every field; the card is PolicyDraftChange",
  },
  summaries: [
    {
      key: "policies.summary",
      description: "Policies in figures: in force, awaiting approval, drafts; who has acknowledged, waiting and overdue, by policy, department or state (for people who write policies)",
      params: c.policies.PolicySummaryQuery,
      permission: ["knowledge", "view"],
      run: (client, params, actor) => service.aiSummary(client, params, actor),
    },
  ],
  reads: [
    {
      key: "policies.mine",
      summary: "none: my own short list",
      description: "List the company policies that apply to me, those I still have to acknowledge first, with their versions and due dates",
      params: c.policies.MyPolicyListQuery,
      permission: ["ess", "view"],
      run: (_client, params, actor) => (actor.employee_id ? service.mine(actor, params) : EMPTY),
      cite: (row) => ({ type: "policy_version", id: row.policy_version_id, label: `${row.title}, Version ${row.version}` }),
    },
    {
      key: "policies.read",
      summary: "none: one record",
      description: "Read one policy version that applies to me: its text, or its rules as sentences, what changed and when it applies",
      params: c.common.IdParams,
      permission: ["ess", "view"],
      // One record, as a read with an id and no page returns it (shared/ai/authorise.js); a list envelope here was refused as a read of many.
      run: (_client, params, actor) => service.myVersion(actor, params.id),
      cite: (row) => ({ type: "policy_version", id: row.policy_version_id, label: `${row.title}, Version ${row.version}` }),
    },
    {
      key: "policies.list",
      summary: "policies.summary",
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
