"use strict";
/**
 * Queue `home-alert-sweeps`: read every switched-on alert rule again, for an operator
 * re-running a morning the scheduler missed. `date` is a Lagos day (YYYY-MM-DD), each rule's
 * window ending on it; today when absent. Under the scheduler's own cron lock, so it never runs
 * beside the morning sweep, and safe to run twice: an open alert is refreshed, never doubled.
 */
const { UnrecoverableError } = require("bullmq");
const lagos = require("../../shared/time/lagos");
const { withCronLock } = require("../cron-lock");
const sweeps = require("../../modules/alerts/alerts.sweeps");

module.exports = async function homeAlertSweeps(job) {
  const date = job.data && job.data.date;
  if (date !== undefined && !lagos.isDate(date))
    throw new UnrecoverableError("home-alert-sweeps: date is a day as YYYY-MM-DD");
  const out = await withCronLock("home-alert-sweeps", () =>
    sweeps.sweep({ now: date ? lagos.instant(date, "06:00") : new Date() }),
  );
  return out === undefined ? { skipped: "locked" } : out;
};
