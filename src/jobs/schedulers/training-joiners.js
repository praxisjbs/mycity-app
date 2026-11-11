"use strict";
/**
 * Every morning at 06:00 Lagos (docs/guides/knowledge.md §6.7): each open training assignment that
 * keeps assigning enrols those who have joined, or moved into a department or role it names, since
 * the events did; then every assigned place still without its task gets it. A backstop to
 * training.enrol_joiners; safe to run twice.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "training-joiners",
  pattern: "0 6 * * *",
  summary: "New joiners enrolled on open training assignments; tasks still to set are set",
  run: () => require("../../modules/training/training.service").sweep(),
});
