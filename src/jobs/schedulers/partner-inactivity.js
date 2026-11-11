"use strict";
/**
 * Every morning at 06:30 Lagos, after Home's alert sweep (06:00) has raised Partner Inactivity: each
 * newly quiet partner's and lead's follow-up, its deals set to Follow-Up Required and one task for its
 * owner (docs/guides/partnerships.md §6.12). Safe to run twice: one follow-up a quiet spell.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "partner-inactivity",
  pattern: "30 6 * * *",
  summary: "Quiet partners and leads followed up: deals Follow-Up Required, a task for the owner",
  run: () => require("../../modules/partner_pipeline/partner_pipeline.inactivity").sweep(),
});
