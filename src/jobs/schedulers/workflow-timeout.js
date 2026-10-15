"use strict";
/**
 * Approvals past their stage's time limit get the stage's `on_timeout` (escalate,
 * approve or reject), every five minutes (SYSTEM_ARCHITECTURE §7). Each instance is its
 * own transaction inside shared/workflow/engine.sweepTimeouts.
 */
const { defineSchedule } = require("../registry");
const workflow = require("../../shared/workflow/engine");

module.exports = defineSchedule({
  name: "workflow-timeout",
  every: 5 * 60 * 1000,
  summary: "Applies the time limit of approvals nobody decided",
  run: () => workflow.sweepTimeouts(),
});
