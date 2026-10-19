"use strict";
/**
 * Queue `task-recurrence`: the morning's task sweep run again by hand, for an operator
 * re-running a morning the scheduler missed. Safe to repeat (tasks.service sweep()).
 */
const service = require("../../modules/tasks/tasks.service");

module.exports = async function taskRecurrence() {
  return service.sweep();
};
