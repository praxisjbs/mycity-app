"use strict";
/**
 * Every morning at 07:00 Lagos: each budget line 90% used (committed and spent) tells its
 * department's head and Operations & People, once per line (docs/guides/expenses.md §6.6 rule 7,
 * §7). Safe to run again: a line already warned is never warned twice.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "budget-threshold",
  pattern: "0 7 * * *",
  summary: "Budget lines 90% used told to their department's head and Operations & People",
  run: () => require("../../modules/budgets/budgets.service").warnThresholds(),
});
