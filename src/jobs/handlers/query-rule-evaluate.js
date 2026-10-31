"use strict";
/**
 * Queue `query-rule-evaluate`: count one person's active query rules for the triggers an
 * attendance event set off, as of that event's day, and raise one query per breach
 * (src/modules/query_rules/query_rules.evaluator.js; docs/guides/queries.md §6.3).
 * Idempotent: a breach already raised is not raised again.
 */
const { UnrecoverableError } = require("bullmq");
const lagos = require("../../shared/time/lagos");
const evaluator = require("../../modules/query_rules/query_rules.evaluator");

module.exports = async function queryRuleEvaluate(job) {
  const { sources, employee_id: employeeId, date } = job.data || {};
  if (!Array.isArray(sources) || !employeeId || !lagos.isDate(date))
    throw new UnrecoverableError("query-rule-evaluate: sources, employee_id and date (YYYY-MM-DD) are required");
  return evaluator.evaluate({ sources, employee_id: employeeId, date });
};
