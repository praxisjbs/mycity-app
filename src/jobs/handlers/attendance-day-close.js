"use strict";
/**
 * Queue `attendance-day-close`: close the days before a given date, for an operator
 * re-running a night the scheduler missed. `before` is a Lagos day (YYYY-MM-DD); today
 * when absent, so the days before today are closed. A day already closed is left alone.
 */
const { UnrecoverableError } = require("bullmq");
const lagos = require("../../shared/time/lagos");
const service = require("../../modules/attendance/attendance.service");

module.exports = async function attendanceDayClose(job) {
  const before = job.data && job.data.before;
  if (before !== undefined && !lagos.isDate(before))
    throw new UnrecoverableError("attendance-day-close: before is a date as YYYY-MM-DD");
  return service.closeDays({ now: before ? lagos.instant(before, "12:00") : new Date() });
};
