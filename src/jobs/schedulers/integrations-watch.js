"use strict";
/**
 * Every 15 minutes: the connections whose test costs nothing (the system sender signs in;
 * the staff mail server's IMAP and SMTP are checked for TLS and their certificate) are
 * tested and their state moved, and each daily limit is compared with today's use, telling
 * IT once a day when one passes 80% (docs/guides/integrations.md §3 steps 10 and 11).
 * Geoapify and Gemini are never tested here: each test spends credits, and their state
 * comes from real use instead.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "integrations-watch",
  every: 15 * 60 * 1000,
  summary: "Free connection tests, and the daily limits checked",
  run: async () => require("../../modules/integrations/integrations.service").watch(),
});
