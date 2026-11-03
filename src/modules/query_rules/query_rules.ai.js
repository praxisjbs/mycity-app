"use strict";
/**
 * What the assistant may do about query rules (docs/guides/queries.md §6.3, §9): as cards the
 * person confirms (docs/guides/praxis-ai.md §6.11, decision 33), New Rule's Save Rule and Edit
 * Rule's, each through the function the screen's own button calls, for a holder of
 * `queries.configure` as the routes hold it. A rule is saved as a draft and fires only once
 * Activate is pressed on Rules; its trigger is fixed once it has fired. The queries rules raise are
 * read through queries.ai.js.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const { oneNamed } = require("../../shared/ai/named");
const routeMap = require("../../shared/route-map");
const policies = require("../policies/policies.service");
const templates = require("../templates/templates.service");
const service = require("./query_rules.service");

const CONFIGURE = "queries.configure";

/** A policy a rule cites, by its title or number, among those with a version in force; null when none or several. */
async function citedIdOf(words) {
  const page = await policies.citable({ page: 1, q: String(words).slice(0, 100) });
  const found = oneNamed(page.data || [], words, (p) => [p.title, p.number]);
  return found ? found.policy_id : null;
}

/** The policy a rule cites, by its title. */
async function citedNames(db, policyId) {
  if (!db || !policyId) return [];
  return (await policies.namesOf(db, [policyId])).map((p) => ({ type: "policy", id: p.policy_id, label: `${p.title} (${p.number})` }));
}

/** A query letter written by its name is the active letter's key, as the form's Letter list offers it. */
const RESOLVE = {
  letter_template: (value, _actor, db) => templates.keyOf(db, value, "query"),
  policy_id: (value) => citedIdOf(value),
};

const ruleLine = (status) => (r) => [{ type: "query_rule", id: r.query_rule_id, label: r.name, status, link: routeMap.screenPath("queries", "rules") }];
const LABELS = { name: "Name", source_event: "Counts", threshold: "Threshold", window_days: "Days", letter_template: "Letter", policy_id: "Policy", policy_clause: "Clause" };

module.exports = defineManifest({
  module: "queries",
  actions: [
    {
      key: "query_rules.create",
      label: "Save Rule",
      description: "Add a query rule, saved as a draft: what it counts, how many times in how many days raises one query, the letter it sends, and the policy and clause it cites",
      input: c.query_rules.QueryRuleCreate,
      permission: ["queries", "create"],
      // As the route: POST /query-rules asks requireCapability("queries.configure").
      capability: CONFIGURE,
      risk: "standard",
      form: "none: New Rule's form validates field by field and sends numbers from its boxes; the card is its own request",
      fields: ["name", "source_event", "threshold", "window_days", "letter_template", "policy_id", "policy_clause"],
      picks: { policy_id: "policy" },
      resolve: RESOLVE,
      names: (values, _actor, db) => citedNames(db, values.policy_id),
      asks: [
        { field: "name", question: "What is the rule called?" },
        { field: "source_event", question: "What does it count?", choices: ["Overdue Tasks", "Low Performance", "Unregistered Device", "Missed Target"] },
        { field: "threshold", question: "How many times raises a query?" },
        { field: "window_days", question: "Within how many days?", choices: ["7", "30", "90"] },
      ],
      // The same function Save Rule calls on New Rule: a draft, its code made from its name.
      run: (values, actor) => service.create(actor, values),
      readback: ruleLine("saved as a draft"),
      labels: LABELS,
    },
    {
      key: "query_rules.edit",
      label: "Save Rule",
      description: "Change a query rule: its name, threshold, days, letter, policy or clause, or what it counts until it first fires; only what changes",
      input: c.query_rules.QueryRuleChange,
      permission: ["queries", "edit"],
      capability: CONFIGURE,
      risk: "standard",
      form: "none: Edit Rule changes the rule open on Rules and never names it; the card does",
      fields: ["query_rule_id", "name", "source_event", "threshold", "window_days", "letter_template", "policy_id", "policy_clause"],
      picks: { policy_id: "policy" },
      resolve: { query_rule_id: (value, _actor, db) => service.idOf(db, value), ...RESOLVE },
      asks: [{ field: "query_rule_id", question: "Which rule?", options: ({ db }) => service.ruleNames(db) }],
      names: (values, _actor, db) => citedNames(db, values.policy_id),
      records: (values, _actor, db) => service.cardRule(db, values.query_rule_id),
      check: (client, values) => service.assertCardRule(client, values.query_rule_id),
      // The same function Edit Rule's Save Rule calls: the trigger refused once the rule has fired.
      run: (values, actor) => {
        const { query_rule_id: id, ...changes } = values;
        return service.update(actor, id, changes);
      },
      readback: ruleLine("saved"),
      labels: { query_rule_id: "Rule", ...LABELS },
    },
  ],
  // Edit Rule's own request, reached through the card that names its rule (gate 23, praxis-ai.md decision 33).
  not_offered: {
    QueryRuleUpdate: "via query_rules.edit: Edit Rule's own request, which never names its rule; the card is QueryRuleChange",
  },
  routes: [{ intent: "switch a query rule on or pause it", screen: "queries.rules" }],
});
