"use strict";
/**
 * What the inbox records, and the work that follows (loaded by the API and the worker).
 *
 * Rows reach the inbox through the fan-out (shared/notifications/fanout.js), never
 * through this module. The changes a person makes here are the read mark, their
 * preferences and their devices with web push on, each recorded like every other write.
 * After a read mark commits, the person's other tabs and devices are told, so the bell's
 * dot clears everywhere and not only where they clicked.
 *
 * A device stops receiving pushes when its person does (docs/guides/notifications.md §6):
 * suspended, left (record archived), signed out everywhere by an administrator, or Sign
 * Out Others (every device but the one it was pressed on). A session ending, or a plain
 * Sign Out, leaves the device's notifications on.
 */
const { pool } = require("../../config/db");
const { defineEvents } = require("../../shared/events/catalogue");
const outbox = require("../../shared/events/outbox");
const queues = require("../../jobs/queues");
const realtime = require("../../services/realtime/emitter");

const EVENTS = defineEvents("settings", {
  "notification.read": { summary: "A notification was marked read" },
  "notification.read_all": { summary: "Every notification was marked read" },
  "notification.acknowledged": { summary: "An urgent notification was acknowledged" },
  "notification.preference_changed": { summary: "A person changed where a kind of notice reaches them" },
  "push_subscription.saved": { summary: "Notifications were turned on for a device" },
  "push_subscription.removed": { summary: "Notifications were turned off for one or more devices" },
  "push_subscription.renewed": { summary: "A device's browser renewed its push subscription" },
  "push.test_requested": { summary: "A test notification was sent to a person's devices" },
  "notification_setting.changed": { summary: "A person changed their quiet hours or daily digest" },
  "notification_rule.changed": { summary: "A notice's company rule was changed in Settings" },
  "notification_reminder.changed": { summary: "The company's reminders were changed in Settings" },
});

/** The realtime event the bell reloads on, besides a new `notification`. */
const READ_EVENT = "notification_read";

function tellTheirTabs(event) {
  const userId = event.payload && event.payload.user_id;
  if (userId) realtime.toUser(userId, READ_EVENT, { notification_id: event.payload.notification_id || null });
}

outbox.register(EVENTS.NOTIFICATION_READ, "notifications.sync_read", async (event) => tellTheirTabs(event));
outbox.register(EVENTS.NOTIFICATION_READ_ALL, "notifications.sync_read_all", async (event) => tellTheirTabs(event));
// Acknowledge closes the urgent bar on every other tab and device too.
outbox.register(EVENTS.NOTIFICATION_ACKNOWLEDGED, "notifications.sync_acknowledged", async (event) =>
  tellTheirTabs(event),
);

/** Send Test: the worker pushes to the device asked for, or every device of the person. */
outbox.register(EVENTS.PUSH_TEST_REQUESTED, "notifications.send_test_push", (event) =>
  queues.enqueue(
    "notification-push",
    "test",
    {
      test: true,
      user_id: event.payload.user_id,
      push_subscription_id: event.payload.push_subscription_id || null,
    },
    { jobId: `push-test-${event.event_id}` },
  ),
);

const revoke = (...args) => require("./notifications.service").revokeDevicesOf(...args);

outbox.register("app_user.suspended", "notifications.stop_push_suspended", (event) =>
  revoke(event.entity && event.entity.id, "suspended"),
);

outbox.register("employee.archived", "notifications.stop_push_left", async (event) => {
  const { rows } = await pool.query("SELECT user_id FROM app_user WHERE employee_id = $1", [
    event.entity && event.entity.id,
  ]);
  for (const r of rows) await revoke(r.user_id, "left");
});

outbox.register("auth.session_ended", "notifications.stop_push_signed_out", async (event) => {
  const p = event.payload || {};
  if (!p.count) return; // one session ended: its device keeps its notifications
  const userId = event.entity && event.entity.id;
  if (p.by === "admin") return revoke(userId, "signed_out");
  if (p.by === "self") {
    const repo = require("./notifications.repo");
    const kept = await repo.sessionDevice(pool, p.kept_session_id);
    return revoke(userId, "signed_out", { exceptKnownDeviceId: kept });
  }
});

module.exports = { EVENTS, READ_EVENT };

// The reminder engine and the company's reminders, declared in the API and the worker alike.
require("./notifications.reminders");
