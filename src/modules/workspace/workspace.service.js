"use strict";
/**
 * My Workspace: the views built over tasks and the calendar, Today and Analytics
 * (docs/guides/workspace.md §2, §6). Reads only; every write is the tasks or the
 * calendar service's.
 */
const { today } = require("./workspace.today");
const { analytics } = require("./workspace.analytics");

module.exports = { today, analytics };
