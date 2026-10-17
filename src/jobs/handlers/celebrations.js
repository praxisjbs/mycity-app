"use strict";
/**
 * Queue `celebrations`: post a day's birthday and work anniversary cards to #general, for
 * an operator re-running a morning the scheduler missed. `date` is a Lagos day
 * (YYYY-MM-DD), today when absent. A card already posted is not posted twice.
 */
const service = require("../../modules/community/community.service");

module.exports = async function celebrations(job) {
  return service.postCelebrations((job.data && job.data.date) || undefined);
};
