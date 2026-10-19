"use strict";
/**
 * Every 5 minutes: the reminder engine's tick (docs/guides/notifications.md §7.1). Finds what
 * has come due (approvals still waiting, probations about to end, whatever a module scheduled),
 * fires each due occurrence in its own transaction, and from the digest's time queues each
 * person's daily digest once. Under the cron lock like every scheduler, and safe to run again.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "reminders",
  every: 5 * 60 * 1000,
  summary: "Reminders fired as they come due, and each person's daily digest queued",
  run: () => require("../../modules/notifications/notifications.reminders").tick(),
});
