"use strict";
/**
 * Queue `review-cycle-open`: open the review rounds due on a day, for an operator re-running a
 * morning the scheduler missed. `date` is a Lagos day (YYYY-MM-DD), today when absent. A round
 * already open is not opened twice.
 */
const cycle = require("../../modules/reviews/reviews.cycle");

module.exports = async function reviewCycleOpen(job) {
  return cycle.openDueRounds((job.data && job.data.date) || undefined);
};
