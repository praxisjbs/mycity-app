"use strict";
/**
 * High alerts left uncleared too long are escalated to the CEO, once each, every hour at
 * ten past (shared/alerts.escalateAged).
 *
 * The alert tables arrive with Home in M1. Until then the tick reports that there is
 * nothing to age rather than failing every hour.
 */
const { defineSchedule } = require("../registry");
const alerts = require("../../shared/alerts/alerts");

async function run() {
  try {
    return await alerts.escalateAged();
  } catch (err) {
    if (err && err.code === "42P01")
      return { skipped: "no home_alert table yet" };
    throw err;
  }
}

module.exports = defineSchedule({
  name: "alert-ageing",
  pattern: "10 * * * *",
  summary: "Escalates high alerts nobody cleared",
  run,
});
