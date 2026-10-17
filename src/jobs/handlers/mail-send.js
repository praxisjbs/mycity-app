"use strict";
/**
 * Queue `mail-send`: deliver one queued message at its time (queued with a delay when it
 * is sent or scheduled). Retrying is the send queue's own (30 seconds, 2 minutes, 8
 * minutes, never for a permanent refusal), so the job itself is not retried.
 */
const { UnrecoverableError } = require("bullmq");
const service = require("../../modules/mailbox/mailbox.service");

module.exports = async function mailSend(job) {
  const id = job.data && job.data.mail_send_queue_id;
  if (!id) throw new UnrecoverableError("mail-send: the job needs mail_send_queue_id");
  return { results: await service.flush(id) };
};
