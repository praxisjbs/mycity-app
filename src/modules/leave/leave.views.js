"use strict";
/**
 * Where leave requests wait on People · Leave (docs/guides/notifications.md §6, Where it waits):
 * under the chip of their status, as the list's own filter reads it, so Pending, Approved and the
 * rest carry their share of the tab's count.
 */
const repo = require("./leave.repo");

module.exports = [
  {
    module: "people",
    tab: "leave",
    type: "leave_request",
    place: async (db, ids) => new Map((await repo.statusesOf(db, ids)).map((r) => [r.id, r.status])),
  },
];
