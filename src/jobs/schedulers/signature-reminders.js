"use strict";
/**
 * Ends signature requests whose signing period has passed (docs/guides/offers.md §7): daily, before
 * the working day. Each ended request's links stop working and its module hears of it (onEnded).
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "signature-reminders",
  pattern: "17 6 * * *",
  summary: "Ends signature requests whose signing period has passed",
  run: async () => require("../../modules/signatures/signatures.service").expireLapsed(),
});
