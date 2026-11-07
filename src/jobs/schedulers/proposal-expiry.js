"use strict";
/**
 * Expires proposals past their validity and stops their links (docs/guides/partnerships.md §6.10 step 6,
 * §7): daily, before the working day. Its own schedule until Contracts & MOUs' `agreement-renewals` job
 * takes it in (§13.2, In PR 7).
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "proposal-expiry",
  pattern: "41 5 * * *",
  summary: "Expires proposals past their validity and stops their links",
  run: async () => require("../../modules/proposals/proposals.service").expireDue(),
});
