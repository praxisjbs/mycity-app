"use strict";
/**
 * Queue `reminders`: one person's daily digest (`digest`), queued once a Lagos day by the
 * reminders scheduler (docs/guides/notifications.md §6). Paced like all system mail: when the
 * hourly limit is reached the job goes back in the queue. Sending twice is prevented by the job
 * id (`digest-<user>-<day>`); a retry after the mail went cannot happen, as nothing follows it.
 * Paused system mail drops the day's digest, and an address the mail server refuses for good
 * finishes the job without a retry (docs/guides/integrations.md §6.15, §6.16).
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
    if (err && err.code === "MAIL_PAUSED") return { sent: false, reason: "mail_paused" };
    if (err && err.code === "MAIL_REFUSED") {
      require("../../services/mail/system-mail.service").reportRefused(err, { queue: "reminders", template: "digest" });
      return { sent: false, reason: "refused" };
    }
    throw err;
  }
};
