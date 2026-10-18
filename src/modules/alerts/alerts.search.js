"use strict";
/**
 * ⌘K for Home, Alerts (docs/guides/home.md §9):
 *
 *   Alerts        an open alert the reader may see, by its title or trigger: a holder of
 *                 `alerts.clear` or `alerts.manage`, the alert's rule's grant reaching the
 *                 person it is about. A result opens the alert's sheet.
 *   Alert Rules   a rule by its name or key, for a holder of `alerts.manage`. A result opens
 *                 Edit Rule (shared/route-map.js: `?rule=`, since `?id=` on the tab is an alert).
 *
 * Every login holds `home` view, the only check the search service makes, so both decide per
 * person, through the same reads as the tab (alerts.service.js), never a table the reader
 * could not open there. Each is a page of 25, as every list.
 */
const routeMap = require("../../shared/route-map");
const service = require("./alerts.service");

const alerts = Object.freeze({
  type: "home_alert",
  module: "home",
  label: "Alerts",
  words: ["alert", "alerts", "warning", "warnings", "red flag", "red flags"],
  scoped: false,
  columns: [],
  async search(client, { term, page = 1, user }) {
    const found = await service.searchAlerts(client, user, { term, page });
    return {
      page: found.page,
      items: found.data.map((a) => ({
        id: a.home_alert_id,
        type: "home_alert",
        ref: null,
        title: a.title,
        sub: a.trigger,
        status: a.severity,
        link: routeMap.linkFor("home_alert", a.home_alert_id).path,
      })),
    };
  },
});

const rules = Object.freeze({
  type: "home_alert_rule",
  module: "home",
  label: "Alert Rules",
  words: ["alert rule", "alert rules", "alert threshold"],
  scoped: false,
  columns: [],
  async search(client, { term, page = 1, user }) {
    const found = await service.searchRules(client, user, { term, page });
    return {
      page: found.page,
      items: found.data.map((r) => ({
        id: r.home_alert_rule_id,
        type: "home_alert_rule",
        ref: r.key,
        title: r.name,
        sub: r.who_can_clear,
        status: r.enabled ? "on" : "off",
        link: routeMap.linkFor("home_alert_rule", r.home_alert_rule_id).path,
      })),
    };
  },
});

module.exports = [alerts, rules];
