"use strict";
/**
 * Queue `budget-threshold`: the budget-threshold sweep, for an operator re-running a morning the
 * scheduler missed. `date` is a Lagos day (YYYY-MM-DD), today when absent. A line already warned
 * about is not warned twice.
 */
const service = require("../../modules/budgets/budgets.service");

module.exports = async function budgetThreshold(job) {
  return service.warnThresholds((job.data && job.data.date) || undefined);
};
