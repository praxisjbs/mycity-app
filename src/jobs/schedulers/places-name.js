"use strict";
/**
 * Names the locations saved while address search was down (docs/guides/addresses.md §6.5, §7):
 * every five minutes, up to 25 a run, stopping at the first failure so an outage costs one
 * request. Each owner's readable line is rewritten by the owner's own code.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "places-name",
  pattern: "*/5 * * * *",
  summary: "Names the locations saved while address search was down",
  run: async () => require("../../modules/maps/maps.service").nameWaiting(),
});
