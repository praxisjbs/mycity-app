"use strict";
/**
 * Queue `announcement-publish`: release one scheduled announcement at its time (`release`),
 * or remind the unread of an important one 4 hours after it went out (`remind`). Both are
 * queued with a delay by announcements.events.js. Publishing is idempotent, so a job that
 * runs twice, or after the safety net, changes nothing; a reminder goes once a day at most.
 */
const { UnrecoverableError } = require("bullmq");
const service = require("../../modules/announcements/announcements.service");

module.exports = async function announcementPublish(job) {
  const id = job.data && job.data.announcement_id;
  if (!id) throw new UnrecoverableError("announcement-publish: the job needs announcement_id");
  if (job.name === "remind") return { announcement_id: id, ...(await service.remindUnread(id)) };
  const a = await service.release(id);
  return { announcement_id: id, status: a ? a.status : "missing" };
};
