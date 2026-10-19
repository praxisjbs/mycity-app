"use strict";
/**
 * Every 5 minutes: remind whoever is expected and not yet clocked in, in the first hour after the
 * start, and clock out a shift left open once it has ended and its person has been away from the
 * app for 15 minutes (docs/guides/attendance.md §6.14). Under the cron lock like every
 * scheduler, and safe to run again: one reminder a day, one automatic clock-out a shift.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "attendance-clock-watch",
  pattern: "*/5 * * * *",
  summary: "Clock-in reminders sent and open shifts clocked out automatically",
  run: () => require("../../modules/attendance/attendance.service").watchClock(),
});
