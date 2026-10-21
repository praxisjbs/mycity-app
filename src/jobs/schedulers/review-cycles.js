"use strict";
/**
 * Every day at 06:00 Lagos: open the review cycles whose day has come, making each person's
 * self review and their manager's review (docs/guides/performance.md §7). Safe to run twice:
 * a cycle opens once and a review is made once.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "review-cycles",
  pattern: "0 6 * * *",
  summary: "Review cycles opened on their day",
  run: () => require("../../modules/reviews/reviews.service").openDue(),
});
