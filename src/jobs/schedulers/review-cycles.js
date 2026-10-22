"use strict";
/**
 * Every day at 06:00 Lagos: a month's review round opens on the first business day after the month
 * ends, with one review for each scorecard binding then (docs/guides/performance.md §3.3, §6.2).
 * A round already open is left alone, so a day the worker missed is made up the next morning.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "review-cycles",
  pattern: "0 6 * * *",
  summary: "Monthly review rounds opened on the first business day after each month",
  run: () => require("../../modules/reviews/reviews.cycle").openDueRounds(),
});
