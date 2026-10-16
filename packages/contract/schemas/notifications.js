"use strict";
/**
 * Notifications: the inbox (M0 notifications module) and what a notification says when
 * it goes out by email.
 *
 * First cut, written with the worker (jobs/handlers/notification-deliver.js). The inbox
 * list and read schemas join this file with the notifications module.
 */
const { z } = require("zod");

/** Variables of templates/email/notification.html: one notification sent as an email. */
const NotificationEmailVars = z
  .object({
    title: z.string().trim().min(1).max(200),
    body: z.string().max(1000).default(""),
    link_url: z.string().url().nullable().default(null),
  })
  .strict();

/** Gate 6 (check/contract-columns.js): template variables, not a row. */
const TABLES = {
  NotificationEmailVars: { table: null, reason: "the variables of templates/email/notification.html, not a row" },
};

module.exports = { TABLES, NotificationEmailVars };
