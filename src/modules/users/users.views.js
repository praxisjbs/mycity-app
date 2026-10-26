"use strict";
/**
 * Where logins wait on Settings · Users (docs/guides/notifications.md §6, Where it waits): under the
 * Status chip of their status (Active, Invited, Suspended); a login that has left shows under
 * Everyone alone.
 */
const repo = require("./users.repo");

module.exports = [
  {
    module: "settings",
    tab: "users",
    type: "app_user",
    place: async (db, ids) => new Map((await repo.statusesOf(db, ids)).map((r) => [r.id, r.status])),
  },
];
