"use strict";
/**
 * Queue `reminders`: one person's daily digest (`digest`), queued once a Lagos day by the
 * reminders scheduler (docs/guides/notifications.md §6). Paced like all system mail: when the
 * hourly limit is reached the job goes back in the queue. Sending twice is prevented by the job
 * id (`digest-<user>-<day>`); a retry after the mail went cannot happen, as nothing follows it.
 */
const { UnrecoverableError } = require("bullmq");
const pace = require("../../services/mail/pace");
const reminders = require("../../modules/notifications/notifications.reminders");

module.exports = async function remindersJob(job, token) {
  if (job.name !== "digest") throw new UnrecoverableError(`reminders: no job called "${job.name}"`);
  if (!job.data || !job.data.user_id) throw new UnrecoverableError("reminders: the digest needs user_id");
  try {
    return await reminders.sendDigest(job.data);
  } catch (err) {
    if (err && err.code === "MAIL_PACED") throw await pace.postpone(job, token, err.retryAfterMs);
    throw err;
  }
};
