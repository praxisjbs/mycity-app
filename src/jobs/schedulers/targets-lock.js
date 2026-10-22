"use strict";
/**
 * Every day at 00:15 Lagos: each quarter whose lock date has come locks its provisional (TBC) key
 * result targets (docs/guides/performance.md §6.7). After the lock a target changes only through
 * a target change to the CEO. Safe to run twice: a locked target is not provisional any more.
 */
const { defineSchedule } = require("../registry");
const lagos = require("../../shared/time/lagos");

module.exports = defineSchedule({
  name: "targets-lock",
  pattern: "15 0 * * *",
  summary: "Provisional key result targets locked on their quarter's lock date",
  run: () => require("../../modules/goals/goals.service").lockTargets(lagos.today()),
});
