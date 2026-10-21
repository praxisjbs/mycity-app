"use strict";
/**
 * Working days at 08:00 Lagos: remind each person with a review due within three days, or
 * overdue (docs/guides/performance.md §7). Runs once a day, so each review reminds once a day.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "review-reminders",
  pattern: "0 8 * * 1-6",
  summary: "Reminders for reviews due soon or overdue",
  run: () => require("../../modules/reviews/reviews.service").remind(),
});
