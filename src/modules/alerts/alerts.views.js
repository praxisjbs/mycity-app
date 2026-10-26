"use strict";
/**
 * Where alerts wait on Home · Alerts (docs/guides/notifications.md §6, Where it waits): an open
 * alert under the Category chip of its rule's metric (one kept from before has none, so All alone
 * shows it); a dismissed one on the dismissed list (`dismissed`). A cleared alert is listed nowhere:
 * it counts on the tab alone.
 */
const metrics = require("./alerts.metrics");
const repo = require("./alerts.repo");

const pathOf = (r) => {
  if (r.open) return metrics.categoryOf(r.metric) ? `open/${metrics.categoryOf(r.metric)}` : "open";
  return r.outcome === "dismissed" ? "dismissed" : null;
};

module.exports = [
  {
    module: "home",
    tab: "alerts",
    type: "home_alert",
    place: async (db, ids) => new Map((await repo.placesOf(db, ids)).flatMap((r) => (pathOf(r) ? [[r.id, pathOf(r)]] : []))),
  },
];
