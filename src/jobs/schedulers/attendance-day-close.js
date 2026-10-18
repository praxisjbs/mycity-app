"use strict";
/**
 * Every night at 01:30 Lagos: close yesterday, and any day before it within 14 days that
 * is still open (docs/guides/attendance.md §7). An open shift becomes a missing clock-out
 * exception, a working day with no clock-in becomes absent; no clock-out time is made up.
 * Under the cron lock like every scheduler, and safe to run again.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "attendance-day-close",
  pattern: "30 1 * * *",
  summary: "Attendance days before today closed: missing clock-outs raised, absences recorded",
  run: () => require("../../modules/attendance/attendance.service").closeDays(),
});
