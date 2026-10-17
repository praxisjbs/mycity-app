"use strict";
/**
 * What the devices module records and who it tells (docs/guides/attendance.md §7).
 *
 * A device seen for the first time on a punch is recorded inside the punch's own
 * transaction and audited with it (`attendance.punched` carries the device), so it has
 * no event of its own. Registering and removing do. Payloads carry the attendance
 * device's id and label, never the device cookie, its hash or any other identifier.
 */
const { defineEvents } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");

const EVENTS = defineEvents("people", {
  "device.registered": { summary: "A clock-in device was registered" },
  "device.removed": { summary: "A clock-in device was removed" },
});

defineNotification(EVENTS.DEVICE_REMOVED, {
  to: [{ subject: true }],
  title: "Clock-in device removed",
  body: (e) => `${e.payload.label} was taken off your registered devices.`,
});

module.exports = { EVENTS };
