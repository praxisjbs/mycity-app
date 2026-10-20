"use strict";
/**
 * Daily at 10:00 Lagos: remind once whoever has not acknowledged the newest version of the
 * attendance policy, 3 days after it was published (docs/guides/attendance.md §6.15). Under the
 * cron lock like every scheduler, and safe to run again: one reminder a person a version.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "attendance-policy-reminder",
  pattern: "0 10 * * *",
  summary: "Reminders to acknowledge the attendance policy sent",
  run: () => require("../../modules/attendance/attendance.policy").remind(),
});
