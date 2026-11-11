"use strict";
/**
 * Every morning at 06:45 Lagos (docs/guides/partnerships.md §6.8): signed agreements Active on their
 * start and Expiring at their notice date, live deals Completed past the later of their validity and
 * their event's end, and each partner's status kept. Safe to run twice.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "agreement-renewals",
  pattern: "45 6 * * *",
  summary: "Agreements Active on their start and Expiring at their notice date; deals past validity Completed",
  run: () => require("../../modules/agreements/agreements.renewals").sweep(),
});
