"use strict";
/**
 * What the assistant may read on Home, Alerts, and where it sends a person (docs/guides/home.md
 * §9; A23: it reads, it never writes).
 *
 *   alerts.mine   the open alerts the asker may clear, as Needs You lists them: a page of 25,
 *                 newest first, filtered by category or severity; an empty page for someone
 *                 without `alerts.clear`
 *
 * Every login holds `home` view, which is all the assistant checks, so the read asks the same
 * questions the screen does (alerts.service.js forAssistant): the capability, then the rule's
 * grant over the person each alert is about. Clearing an alert is the person's own act on the
 * screen; the assistant routes them there.
 *
 *   alert_rules.create, alert_rules.edit   New Rule and a rule's own Save, as cards the person
 *                 confirms (docs/guides/praxis-ai.md §6.11, decision 33), held to `alerts.manage`
 *                 as the routes are; a rule with no "who clears" named takes its metric's own.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const { given, asForm } = require("../../shared/ai/change");
const { oneNamed } = require("../../shared/ai/named");
const routeMap = require("../../shared/route-map");
const service = require("./alerts.service");

const alertsPath = routeMap.screenPath("home", "alerts");
const ruleLine = (status) => (rule) => [{ type: "home_alert_rule", id: rule.home_alert_rule_id, label: rule.name, status, link: alertsPath }];
/** "Which rule?" (praxis-ai.md decision 34): the rules as Alerts lists them, a rule written by name matched among them. */
const ruleChoices = async () => (await service.rules(c.alerts.HomeAlertRuleQuery.parse({}))).data.map((r) => r.name);
async function ruleIdOf(words) {
  for (const q of [words, null]) {
    const page = await service.rules(c.alerts.HomeAlertRuleQuery.parse(q ? { q } : {}));
    const found = oneNamed(page.data, words, (r) => [r.name, r.key]);
    if (found) return found.home_alert_rule_id;
  }
  return null;
}

/** "see attendance alerts" → the tab on that category's chip, for each category. */
const byCategory = c.alerts.HOME_ALERT_CATEGORIES.map((category) => ({
  intent: `see ${category} alerts`,
  screen: "home.alerts",
  params: { category },
}));

module.exports = defineManifest({
  module: "home",
  // Every Create schema of this module's contract, and why the assistant does not offer it (gate 23).
  not_offered: {
    HomeAlertRuleUpdate: "via alert_rules.edit: a rule is changed in its own sheet on Alerts, which never names it; the card does (HomeAlertRuleChange)",
  },
  actions: [
    {
      key: "alert_rules.create",
      label: "Create Alert Rule",
      description: "Set an alert rule on Home: its name, what it watches (the metric), the number that raises it, over how many days, how serious it is, and who clears it (the metric's own when not said)",
      input: c.alerts.HomeAlertRuleCreate,
      permission: ["home", "view"],
      // As the route: Home view, which every login holds, and the authority to manage the rules.
      capability: "alerts.manage",
      risk: "standard",
      form: "none: New Rule picks its metric first and shows that metric's own fields; the card carries them together",
      asks: [
        { field: "name", question: "What is the rule called?" },
        { field: "metric", question: "What should it watch?" },
        { field: "threshold", question: "At what number does it alert?" },
        { field: "severity", question: "How serious is it?", choices: ["Low", "Medium", "High"] },
        { field: "permission_key", question: "Who clears it?", choices: ["Its Own Default"] },
      ],
      // "Its own default" is the metric's own who-clears, as New Rule fills it.
      resolve: { permission_key: (value, _actor, _db, values) => (/default/i.test(value) && c.alerts.HOME_ALERT_METRICS[values.metric] ? c.alerts.HOME_ALERT_METRICS[values.metric].permission_key : null) },
      run: (values, actor) => service.createRule(actor, asForm(c.alerts.HomeAlertRuleCreate, values)),
      readback: ruleLine("created"),
      labels: { name: "Name", metric: "Watches", threshold: "Alerts At", window_days: "Over (Days)", severity: "Severity", permission_key: "Who Clears" },
    },
    {
      key: "alert_rules.edit",
      label: "Save Alert Rule",
      description: "Change an alert rule: its name, the number that raises it, its days, how serious it is, who clears it, or switch it off or on; only what changes",
      input: c.alerts.HomeAlertRuleChange,
      permission: ["home", "view"],
      capability: "alerts.manage",
      risk: "standard",
      form: "none: a rule is changed in its own sheet on Alerts, which never names it; the card does",
      asks: [{ field: "home_alert_rule_id", question: "Which rule is it?", options: ruleChoices }],
      resolve: { home_alert_rule_id: (value) => ruleIdOf(value) },
      records: async (values) => {
        const rule = values.home_alert_rule_id ? (await service.rules(c.alerts.HomeAlertRuleQuery.parse({}))).data.find((r) => r.home_alert_rule_id === values.home_alert_rule_id) : null;
        return rule ? [{ type: "home_alert_rule", id: rule.home_alert_rule_id, label: rule.name }] : [];
      },
      run: (values, actor) => {
        const { home_alert_rule_id: id, ...changes } = values;
        return service.updateRule(actor, id, given(changes));
      },
      readback: ruleLine("saved"),
      labels: { home_alert_rule_id: "Rule", name: "Name", threshold: "Alerts At", window_days: "Over (Days)", severity: "Severity", permission_key: "Who Clears", enabled: "On" },
    },
  ],
  reads: [
    {
      key: "alerts.mine",
      description: "List the open alerts I may clear, newest first, with how far past its rule each one is",
      params: c.alerts.HomeAlertQuery,
      permission: ["home", "view"],
      run: (client, params, actor) => service.forAssistant(client, actor, params),
      cite: (row) => ({ type: "home_alert", id: row.home_alert_id, label: row.title }),
    },
  ],
  routes: [
    { intent: "see open alerts", screen: "home.alerts" },
    ...byCategory,
    { intent: "change the rules that raise alerts", screen: "home.alerts" },
  ],
});
