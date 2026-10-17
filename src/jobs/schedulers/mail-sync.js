"use strict";
/**
 * Every few minutes (MAILBOX_SYNC_EVERY_MIN): every connected mailbox synced in turn, one
 * IMAP connection at a time, then any queued message whose time has come and whose job
 * was lost. The safety net behind IMAP IDLE and the mail-send job (mailbox.md §7).
 */
const { config } = require("../../config/env");
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "mail-sync",
  every: config.MAILBOX_SYNC_EVERY_MIN * 60 * 1000,
  summary: "Every mailbox synced, and due mail sent",
  run: async () => {
    const service = require("../../modules/mailbox/mailbox.service");
    const synced = await service.syncAll();
    const sent = await service.flush();
    return { ...synced, sent: sent.length };
  },
});
