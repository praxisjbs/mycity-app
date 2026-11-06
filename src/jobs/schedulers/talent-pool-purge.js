"use strict";
/**
 * Takes people off the Talent Pool when their 24 months end (docs/guides/recruitment.md §6.9, §7):
 * daily, before the working day.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "talent-pool-purge",
  pattern: "23 5 * * *",
  summary: "Takes people off the Talent Pool when their 24 months end",
  run: async () => require("../../modules/talent_pool/talent_pool.retention").purge(),
});
