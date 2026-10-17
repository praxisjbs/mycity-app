"use strict";
/**
 * Every morning at 05:00 Lagos: the day's birthday and work anniversary cards in
 * #general (MILESTONES A20; docs/guides/community.md §3 step 3). Every day of the week.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "celebrations",
  pattern: "0 5 * * *",
  summary: "Birthday and work anniversary cards posted to #general",
  run: () => require("../../modules/community/community.service").postCelebrations(),
});
