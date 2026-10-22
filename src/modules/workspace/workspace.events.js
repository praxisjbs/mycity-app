"use strict";
/**
 * What the week records (docs/guides/performance.md §6.18, §7): a person's Support Needed line
 * or an accepted summary saved. Audit only; a manager's Team This Week reads it on its next load.
 */
const { defineEvents } = require("../../shared/events/catalogue");

const EVENTS = defineEvents("workspace", {
  "week.summary_saved": { summary: "A person saved their week's Support Needed line or summary" },
});

module.exports = { EVENTS };
