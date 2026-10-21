"use strict";
/**
 * What the KPIs module records (docs/guides/performance.md §7). Setting a person's KPIs tells
 * nobody: they hear once the month is approved (`kpis.dispatched`, targets.events.js). A
 * manual figure entered, like a recount from tasks, is `kpi.progress_changed` (targets.events.js).
 */
const { defineEvents } = require("../../shared/events/catalogue");

const EVENTS = defineEvents("performance", {
  "kpis.assigned": { summary: "Someone's KPIs for a month were set or changed" },
});

module.exports = { EVENTS };
