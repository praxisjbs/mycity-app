"use strict";
/**
 * Every five minutes: each report schedule whose next slot has come is queued for the
 * `scheduled-report` job, which makes its runs (docs/guides/home.md §3 step 7, §7). Under the
 * cron lock like every scheduler, and safe to run again: a schedule still waiting from the
 * last tick keeps its job, and a slot is made once however often it is queued.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "scheduled-reports",
  pattern: "*/5 * * * *",
  summary: "Report schedules whose slot has come queued for their runs",
  run: () => require("../../modules/reports/reports.service").queueDue(),
});
