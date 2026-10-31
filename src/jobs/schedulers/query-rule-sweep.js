"use strict";
/**
 * Every day at 06:20 Lagos: each person with a task due yesterday that is still open or was done
 * late has their `overdue_task` query rules counted as of yesterday (docs/guides/queries.md §6.3,
 * §7). Nothing is queued while no such rule is on. Safe to run twice: the job id is the person and
 * the day, and a breach already raised is not raised again.
 */
const { defineSchedule } = require("../registry");

async function run() {
  const { pool } = require("../../config/db");
  const lagos = require("../../shared/time/lagos");
  const rules = require("../../modules/query_rules/query_rules.repo");
  const tasks = require("../../modules/tasks/tasks.auto-query");
  const { enqueue } = require("../queues");
  if (!(await rules.activeFor(pool, tasks.SOURCES)).length) return { queued: 0 };
  const today = lagos.today();
  const date = lagos.addDays(today, -1);
  const people = await tasks.dueYesterday(pool, today);
  for (const employeeId of people) {
    await enqueue("query-rule-evaluate", "query-rule-sweep", { sources: tasks.SOURCES, employee_id: employeeId, date }, {
      jobId: `query-rule-evaluate-overdue-${employeeId}-${date}`,
    });
  }
  return { queued: people.length };
}

module.exports = defineSchedule({
  name: "query-rule-sweep",
  pattern: "20 6 * * *",
  summary: "Overdue tasks counted against the query rules, once a day",
  run,
});
