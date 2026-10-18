"use strict";
/**
 * Queue `scheduled-report`: one slot of one report schedule, queued by the `scheduled-reports`
 * tick (docs/guides/home.md §7). Makes a numbered run for each recipient and format of the
 * slot, each built as its recipient by the outbox (`home.report_run`), and moves the schedule
 * to its next slot in Lagos.
 *
 *   { report_schedule_id, slot }   slot: the schedule's next_run_at the tick saw, ISO
 *
 * Safe to run twice: a slot holds one run per recipient and format, and a schedule that has
 * moved past the slot, or was paused, archived or removed meanwhile, makes nothing.
 */
const { UnrecoverableError } = require("bullmq");
const reports = require("../../modules/reports/reports.service");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async function scheduledReport(job) {
  const { report_schedule_id: scheduleId, slot } = job.data || {};
  const at = new Date(slot);
  if (!UUID.test(String(scheduleId)) || Number.isNaN(at.getTime()))
    throw new UnrecoverableError("scheduled-report: the job needs report_schedule_id and its slot");
  return reports.fireSlot(scheduleId, at);
};
