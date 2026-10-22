"use strict";
/**
 * My Workspace: the views built over tasks and the calendar, Today, Analytics and the week
 * (docs/guides/workspace.md §2, §6). Every write to a task is the tasks or the calendar service's;
 * the week writes only its own line and summary (workspace.week.js).
 */
const { today } = require("./workspace.today");
const { analytics } = require("./workspace.analytics");
const { week, save, teamWeeks, tidy } = require("./workspace.week");

module.exports = { today, analytics, week, save, teamWeeks, tidy };
