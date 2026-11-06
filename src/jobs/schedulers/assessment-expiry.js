"use strict";
/**
 * Ends what the clock ends (docs/guides/recruitment.md §6.7, §7): every minute, a sitting past its
 * `due_at` is timed out with the answers it has (and scored at once when every question is a
 * choice), and a sitting never started by its start-by day expires and its link stops working.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "assessment-expiry",
  every: 60_000,
  summary: "Ends assessment sittings past their time and expires links never started",
  run: async () => require("../../modules/assessments/assessments.timer").sweep(),
});
