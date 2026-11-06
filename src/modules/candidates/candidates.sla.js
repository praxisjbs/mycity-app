"use strict";
/**
 * Time at stage (docs/guides/recruitment.md §6.3): whole Lagos days since the card reached its
 * stage. Home's Recruitment SLA alert reads the same column (dashboard/sources/vacancies.source.js).
 */
const lagos = require("../../shared/time/lagos");

/** Whole Lagos days since `since`, never below 0. */
function daysAtStage(since, now = new Date()) {
  if (!since) return 0;
  return Math.max(0, lagos.daysBetween(lagos.dateOf(since), lagos.dateOf(now)));
}

module.exports = { daysAtStage };
