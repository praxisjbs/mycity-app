"use strict";
/**
 * Where clock-in devices wait on People · Devices (docs/guides/notifications.md §6, Where it
 * waits): under the chip of their status (Registered, New, Removed).
 */
const repo = require("./devices.repo");

module.exports = [
  {
    module: "people",
    tab: "devices",
    type: "device",
    place: async (db, ids) => new Map((await repo.statusesOf(db, ids)).map((r) => [r.id, r.status])),
  },
];
