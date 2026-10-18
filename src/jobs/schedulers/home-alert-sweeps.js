"use strict";
/**
 * Every morning at 06:00 Lagos: every switched-on alert rule on Home is read, and each breach
 * raises an alert or refreshes the open one (docs/guides/home.md §3 step 5, §7). One scheduler
 * for every time-based metric, under the cron lock like every scheduler, and safe to run again.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "home-alert-sweeps",
  pattern: "0 6 * * *",
  summary: "Alert rules read every morning: breaches raised, open alerts refreshed",
  run: () => require("../../modules/alerts/alerts.sweeps").sweep(),
});
