"use strict";
/**
 * What the goals module records (docs/guides/performance.md §7). PR 1 records quarters; the
 * organisational goals, objectives, key results, reports, plans and target changes join in PR 2.
 * Nothing follows a quarter's save but the audit line: Home and Analytics read the quarter as
 * it stands.
 */
const { defineEvents } = require("../../shared/events/catalogue");

const EVENTS = defineEvents("performance", {
  "period.created": { summary: "A quarter was set up, with the last quarter's rules" },
  "period.changed": { summary: "A quarter's dates, rules or status were changed" },
});

module.exports = { EVENTS };
