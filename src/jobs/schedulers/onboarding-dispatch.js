"use strict";
/**
 * Onboarding on the start date (docs/guides/offers.md §3 step 8, §7): daily, before the working day.
 * Every case at pre-onboarding whose start date has come moves to onboarding with its plan's steps,
 * each owner named, and the application to Onboarding; then the owner of each step past its due day is
 * reminded, once a step. Safe to run twice.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "onboarding-dispatch",
  pattern: "43 6 * * *",
  summary: "Hires starting today begin onboarding; owners of overdue steps are reminded",
  run: () => require("../../modules/onboarding/onboarding.service").dispatch(),
});
