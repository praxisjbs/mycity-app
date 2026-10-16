"use strict";
/**
 * What the inbox records, and the work that follows (loaded by the API and the worker).
 *
 * Rows reach the inbox through the fan-out (shared/notifications/fanout.js), never
 * through this module. The one change a person makes here is the read mark, and it is
 * recorded like every other write. After it commits, the person's other tabs and
 * devices are told, so the bell's dot clears everywhere and not only where they clicked.
 */
const { defineEvents } = require("../../shared/events/catalogue");
const outbox = require("../../shared/events/outbox");
const realtime = require("../../services/realtime/emitter");

const EVENTS = defineEvents("settings", {
  "notification.read": { summary: "A notification was marked read" },
  "notification.read_all": { summary: "Every notification was marked read" },
});

/** The realtime event the bell reloads on, besides a new `notification`. */
const READ_EVENT = "notification_read";

function tellTheirTabs(event) {
  const userId = event.payload && event.payload.user_id;
  if (userId) realtime.toUser(userId, READ_EVENT, { notification_id: event.payload.notification_id || null });
}

outbox.register(EVENTS.NOTIFICATION_READ, "notifications.sync_read", async (event) => tellTheirTabs(event));
outbox.register(EVENTS.NOTIFICATION_READ_ALL, "notifications.sync_read_all", async (event) => tellTheirTabs(event));

module.exports = { EVENTS, READ_EVENT };
