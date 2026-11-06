"use strict";
/**
 * Removes CVs left on Apply links that ended without an application (docs/guides/recruitment.md
 * §6.2, §13): nightly, a day after the link ended.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "apply-cv-purge",
  pattern: "47 2 * * *",
  summary: "Removes CVs left on Apply links that ended without an application",
  run: async () => require("../../modules/candidates/candidates.retention").purge(),
});
