"use strict";
/**
 * Where tasks wait on My Workspace · Tasks (docs/guides/notifications.md §6, Where it waits), for
 * the reader: `mine/<status>` for their own (led, set or shared with them, as Mine reads it), else
 * `others/<status>`, which My Team shows beside their own. The status is the board's column, or
 * Show Cancelled's list for a cancelled task.
 */
const repo = require("./tasks.repo");

module.exports = [
  {
    module: "workspace",
    tab: "tasks",
    type: "task",
    place: async (db, ids, { user }) =>
      new Map((await repo.placesOf(db, ids, user && user.employee_id)).map((r) => [r.id, `${r.mine ? "mine" : "others"}/${r.status}`])),
  },
];
