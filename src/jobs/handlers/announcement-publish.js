"use strict";
/**
 * Queue `announcement-publish`: release one scheduled announcement at its time. Queued
 * with a delay when the announcement is written (announcements.events.js). Publishing is
 * idempotent, so a job that runs twice, or after the safety net, changes nothing.
 */
const { UnrecoverableError } = require("bullmq");
const service = require("../../modules/announcements/announcements.service");

module.exports = async function announcementPublish(job) {
  const id = job.data && job.data.announcement_id;
  if (!id) throw new UnrecoverableError("announcement-publish: the job needs announcement_id");
  const a = await service.release(id);
  return { announcement_id: id, status: a ? a.status : "missing" };
};
