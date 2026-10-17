"use strict";
/**
 * Queue `mail-sync`: fetch one mailbox's new mail now (a mailbox just connected,
 * Refresh pressed, or IMAP IDLE saw new mail). One at a time per worker, so a sync holds
 * one IMAP connection against the host's limit (docs/guides/mailbox.md §6).
 */
const { UnrecoverableError } = require("bullmq");
const service = require("../../modules/mailbox/mailbox.service");

module.exports = async function mailSync(job) {
  const id = job.data && job.data.mail_account_id;
  if (!id) throw new UnrecoverableError("mail-sync: the job needs mail_account_id");
  return service.sync(id);
};
