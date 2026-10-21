"use strict";
/**
 * Queue `review-cycle-open`: the morning's cycle opening run again by hand, for an operator
 * re-running a morning the scheduler missed. Safe to repeat (reviews.service openDue()).
 */
const service = require("../../modules/reviews/reviews.service");

module.exports = async function reviewCycleOpen() {
  return service.openDue();
};
