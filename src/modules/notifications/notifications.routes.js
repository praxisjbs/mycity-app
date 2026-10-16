"use strict";
/**
 * /api/v1/notifications: the bell. Every route is the caller's own inbox (`self`): the
 * service reads and marks only the signed-in person's rows, so no grant is involved and
 * none could widen it. Rows are written by the fan-out, never through this API.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const controller = require("./notifications.controller");

const router = express.Router();

route(router, "get", "/",
  { query: c.notifications.NotificationListQuery, response: c.notifications.NotificationPage, self: true, summary: "My notifications" },
  controller.list);

route(router, "get", "/unread-count",
  { response: c.notifications.UnreadCount, self: true, summary: "How many of my notifications are unread" },
  controller.unreadCount);

route(router, "get", "/badges",
  { response: c.notifications.NavBadges, self: true, summary: "My unread notifications per module" },
  controller.badges);

route(router, "post", "/read-all",
  { body: c.common.EmptyBody, no_content: true, self: true, summary: "Mark all my notifications read" },
  controller.markAllRead);

route(router, "post", "/:id/read",
  { body: c.common.EmptyBody, no_content: true, self: true, summary: "Mark one of my notifications read" },
  controller.markRead);

module.exports = { basePath: "/notifications", surface: "staff", router };
