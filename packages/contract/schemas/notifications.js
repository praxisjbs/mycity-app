"use strict";
/**
 * Notifications: the inbox behind the bell (M0 notifications module) and what a
 * notification says when it goes out by email.
 *
 * The inbox is the caller's own and read-only but for the read mark: rows are written
 * by the fan-out (shared/notifications/fanout.js), never through the API. Preferences
 * and web push join this file in M6.
 */
const { z } = require("zod");
const { uuid, isoDateTime, listQuery, Paged } = require("./common");
const { ModuleKey } = require("./identity");

/** Where a notification opens: derived from its record through shared/route-map.js, never stored. */
const NotificationLink = z
  .object({
    module: ModuleKey,
    tab: z.string(),
    path: z.string(),
  })
  .strict();

/** One row of the bell. `link` is null when the record has no screen, or the reader cannot open it. */
const Notification = z
  .object({
    notification_id: uuid,
    category: z.string(),
    priority: z.enum(["normal", "high"]),
    title: z.string(),
    body: z.string().nullable(),
    entity_type: z.string().nullable(),
    entity_id: z.string().nullable(),
    link: NotificationLink.nullable(),
    read_at: isoDateTime.nullable(),
    created_at: isoDateTime,
  })
  .strict();

/** GET /notifications: newest first; `status` narrows to unread or read. */
const NotificationListQuery = listQuery({
  status: z.enum(["unread", "read"]).optional(),
});
const NotificationPage = Paged(Notification);

/** GET /notifications/unread-count: the bell's dot. */
const UnreadCount = z.object({ unread: z.number().int().min(0) }).strict();

/**
 * GET /notifications/badges: unread notifications per module, for the rail and the
 * More tiles. Only modules the reader may open, and only those with something unread.
 */
const NavBadges = z.record(ModuleKey, z.number().int().min(1));

/** Variables of templates/email/notification.html: one notification sent as an email. */
const NotificationEmailVars = z
  .object({
    title: z.string().trim().min(1).max(200),
    body: z.string().max(1000).default(""),
    link_url: z.string().url().nullable().default(null),
  })
  .strict();

/** Gate 6 (check/contract-columns.js): which table each schema's keys are the columns of. */
const TABLES = {
  NotificationLink: { table: null, reason: "a screen derived from entity_type and entity_id through shared/route-map.js" },
  Notification: {
    table: "notification",
    virtual: { link: "derived from entity_type and entity_id through shared/route-map.js when read, never stored" },
  },
  NotificationListQuery: { table: null, reason: "list controls and the read filter for the bell" },
  NotificationPage: { table: null, reason: "a page of notifications" },
  UnreadCount: { table: null, reason: "a count of the caller's unread notifications" },
  NotificationEmailVars: { table: null, reason: "the variables of templates/email/notification.html, not a row" },
};

module.exports = {
  TABLES,
  NotificationLink,
  Notification,
  NotificationListQuery,
  NotificationPage,
  UnreadCount,
  NavBadges,
  NotificationEmailVars,
};
