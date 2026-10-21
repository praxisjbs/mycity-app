"use strict";
/**
 * Exchange rates, daily (docs/guides/integrations.md §1.2 decision 10): at one minute past each
 * hour, Lagos, today's table is fetched if it is not kept yet. The first tick after midnight
 * fetches it; a failure is tried again the next hour; once today's table is in, a tick spends
 * nothing, so the free plan's 1,500 requests a month see about 31.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "exchange-rates",
  pattern: "1 * * * *",
  summary: "Fetches today's exchange rates after midnight, and again within the hour if that failed",
  run: async () => require("../../modules/integrations/integrations.service").syncRates(null),
});
