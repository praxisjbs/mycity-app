"use strict";
/**
 * Every day at 07:30 Lagos: the next occurrence of each repeating task that is done or
 * past its due day, and, on a working day, the reminders for tasks due today and the
 * next working day (docs/guides/workspace.md §6, §7). Safe to run twice: a repeat is
 * made once, a reminder sent once a day per task.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "task-recurrence",
  pattern: "30 7 * * *",
  summary: "Repeating tasks made again, due-today and due-tomorrow reminders sent",
  run: () => require("../../modules/tasks/tasks.service").sweep(),
});
