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
 * grant over the person each alert is about. Clearing an alert and changing a rule are the
 * person's own acts on the screen; the assistant routes them there.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./alerts.service");

/** "see attendance alerts" → the tab on that category's chip, for each category. */
const byCategory = c.alerts.HOME_ALERT_CATEGORIES.map((category) => ({
  intent: `see ${category} alerts`,
  screen: "home.alerts",
  params: { category },
}));

module.exports = defineManifest({
  module: "home",
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
