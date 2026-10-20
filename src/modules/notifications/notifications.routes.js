"use strict";
/**
 * /api/v1/notifications: the bell, the person's preferences, quiet hours and digest, and
 * their devices with web push on. Those routes are the caller's own (`self`): the service
 * reads and changes only the signed-in person's rows, so no grant is involved and none
 * could widen it. Rows are written by the fan-out, never through this API.
 *
 * Settings · Notifications (`/rules`, `/reminders`) is the company's: `settings` view to
 * read, `settings` edit to change (docs/guides/notifications.md §8).
 *
 * Two routes have no session (`anonymous`): a service worker renewing its subscription
 * and pressing Mark Read on a notification. Each proves itself with the device token it
 * was given when push was turned on; the service checks it, and a refused token counts
 * against the address (pushDeviceLimiter).
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const limits = require("../../middleware/rate-limit");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./notifications.controller");

const router = express.Router();

route(router, "get", "/",
  { query: c.notifications.NotificationListQuery, response: c.notifications.NotificationPage, self: true, summary: "My notifications" },
  controller.list);

route(router, "get", "/urgent",
  { query: c.notifications.UrgentNoticeQuery, response: c.notifications.NotificationPage, self: true, summary: "My open urgent notices" },
  controller.urgent);

route(router, "get", "/unread-count",
  { response: c.notifications.UnreadCount, self: true, summary: "How many of my notifications are unread" },
  controller.unreadCount);

route(router, "get", "/badges",
  { response: c.notifications.NavBadges, self: true, summary: "My unread notifications per module" },
  controller.badges);

route(router, "get", "/read-state",
  { query: c.notifications.NotificationReadStateQuery, response: c.notifications.NotificationReadState, self: true, summary: "Which of my shown notifications are read" },
  controller.readState);

route(router, "get", "/preferences",
  { response: c.notifications.NotificationPreferences, self: true, summary: "Where each kind of notice reaches me" },
  controller.preferences);

route(router, "put", "/preferences",
  { body: c.notifications.NotificationPreferenceUpdate, response: c.notifications.NotificationPreferences, self: true, summary: "Switch one channel of one kind of notice" },
  controller.setPreference);

route(router, "put", "/preferences/quiet-hours",
  { body: c.notifications.QuietHoursUpdate, response: c.notifications.NotificationPreferences, self: true, summary: "Set my quiet hours" },
  controller.setQuietHours);

route(router, "put", "/preferences/digest",
  { body: c.notifications.DigestUpdate, response: c.notifications.NotificationPreferences, self: true, summary: "Turn my daily digest on or off" },
  controller.setDigest);

route(router, "get", "/rules",
  { query: c.notifications.NotificationRuleQuery, response: c.notifications.NotificationRulePage, summary: "Every notice and the company's rule for it" },
  requirePermission("settings", "view"), controller.rules);

route(router, "put", "/rules/:key",
  { params: c.notifications.NotificationRuleParams, body: c.notifications.NotificationRuleUpdate, response: c.notifications.NotificationRule, summary: "Set the company's rule for one notice" },
  requirePermission("settings", "edit"), controller.saveRule);

route(router, "post", "/rules/:key/reset",
  { params: c.notifications.NotificationRuleParams, body: c.common.EmptyBody, response: c.notifications.NotificationRule, summary: "Put one notice back as the code declares it" },
  requirePermission("settings", "edit"), controller.resetRule);

route(router, "get", "/reminders",
  { response: c.notifications.NotificationReminders, summary: "The company's reminders" },
  requirePermission("settings", "view"), controller.reminders);

route(router, "put", "/reminders",
  { body: c.notifications.NotificationRemindersUpdate, response: c.notifications.NotificationReminders, summary: "Set the company's reminders" },
  requirePermission("settings", "edit"), controller.saveReminders);

route(router, "get", "/push/config",
  { response: c.notifications.PushConfig, self: true, summary: "The key a browser subscribes to web push with" },
  controller.pushConfig);

route(router, "post", "/push/subscriptions",
  { body: c.notifications.PushSubscriptionCreate, response: c.notifications.PushDeviceSaved, self: true, summary: "Turn on notifications for this browser, or save it again" },
  controller.savePushSubscription);

route(router, "get", "/push/devices",
  { query: c.notifications.PushDeviceListQuery, response: c.notifications.PushDevicePage, self: true, summary: "My devices with notifications on" },
  controller.pushDevices);

route(router, "post", "/push/devices/:id/remove",
  { body: c.common.EmptyBody, no_content: true, self: true, summary: "Turn off notifications for one of my devices" },
  controller.removePushDevice);

route(router, "post", "/push/test",
  { body: c.notifications.PushTestRequest, response: c.notifications.PushTestResult, self: true, summary: "Send a test notification to my devices" },
  controller.sendTestPush);

route(router, "post", "/push/renew",
  { body: c.notifications.PushRenew, no_content: true, anonymous: true, summary: "A service worker renews its push subscription" },
  limits.pushDeviceLimiter, controller.renewFromDevice);

route(router, "post", "/push/read",
  { body: c.notifications.PushDeviceRead, no_content: true, anonymous: true, summary: "Mark Read pressed on a notification a device shows" },
  limits.pushDeviceLimiter, controller.markReadFromDevice);

route(router, "post", "/read-all",
  { body: c.common.EmptyBody, no_content: true, self: true, summary: "Mark all my notifications read" },
  controller.markAllRead);

route(router, "post", "/:id/read",
  { body: c.common.EmptyBody, no_content: true, self: true, summary: "Mark one of my notifications read" },
  controller.markRead);

route(router, "post", "/:id/acknowledge",
  { body: c.common.EmptyBody, response: c.notifications.Notification, self: true, summary: "Acknowledge one of my urgent notifications" },
  controller.acknowledge);

module.exports = { basePath: "/notifications", surface: "staff", router };
