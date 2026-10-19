"use strict";
/**
 * Every 5 minutes of the working day: each open urgent notice whose last alert is 30 minutes old
 * is alerted again on every device and in the open app, at most 8 times on one Lagos day, until
 * it is acknowledged or opened (docs/guides/notifications.md §6). Under the cron lock like every
 * scheduler, and safe to run again: a repeat is counted once, by the row it updates.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "urgent-repeats",
  pattern: "*/5 8-17 * * *",
  summary: "Open urgent notices alerted again every 30 minutes of the working day",
  run: () => require("../../modules/notifications/notifications.service").repeatUrgent(),
});
