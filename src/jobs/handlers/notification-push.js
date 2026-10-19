"use strict";
/**
 * Queue `notification-push`: one notice pushed to its person's phones and computers, or a
 * test (docs/guides/notifications.md §3, §6). Queued by notification-deliver, one job per
 * row carrying push (`jobId` push-<notification_id>); by the urgent repeats, one per repeat
 * (`round`, `jobId` push-<notification_id>-r<round>); and by Send Test.
 *
 * Idempotent per device (push_delivery): a retry sends only to the devices still owed. A
 * push service that is busy or down fails the job, so it is tried again with backoff; a
 * subscription refused for good is revoked and never retried.
 */
const sender = require("../../modules/notifications/notifications.push");

module.exports = async function notificationPush(job) {
  const d = job.data || {};
  const out = d.test
    ? await sender.pushTest(d.user_id, d.push_subscription_id || null)
    : await sender.pushNotice(d.notification_id, d.push || null, Number(d.round) || 0);
  if (out.retry) throw new Error(`notification-push: ${out.retry} device(s) to try again`);
  return out;
};
