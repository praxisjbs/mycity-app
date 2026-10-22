"use strict";
/**
 * What the KPIs module records (docs/guides/performance.md §7). A recorded actual is recounted on
 * the scorecard lines fed by it when PR 3's automatic lines read it; nothing else follows a save
 * but the audit line and search.
 */
const { defineEvents } = require("../../shared/events/catalogue");

const EVENTS = defineEvents("performance", {
  "kpi.saved": { summary: "A KPI was set up or changed" },
  "kpi.actual_recorded": { summary: "A KPI's monthly actual was recorded" },
  "kpi.removed": { summary: "An imported KPI was taken away when its import was reverted" },
});

module.exports = { EVENTS };
