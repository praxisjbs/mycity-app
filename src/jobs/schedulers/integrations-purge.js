"use strict";
/**
 * What Settings · Integrations keeps: checks for 90 days and use for 30, cleared nightly at
 * ten past three (docs/guides/integrations.md §3 step 13). A connection's row, its saved
 * settings and its secrets are never purged.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "integrations-purge",
  pattern: "10 3 * * *",
  summary: "Clears connection checks after 90 days and their use after 30",
  run: async () => require("../../modules/integrations/integrations.service").purge(),
});
