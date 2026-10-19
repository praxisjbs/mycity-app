"use strict";
/**
 * What the assistant may read of the asker's calendar: their own month (events,
 * invitations, task deadlines, approved leave), one page of 25 at a time. It never
 * books or answers anything (A23); it sends the person to New Event.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./calendar.service");

module.exports = defineManifest({
  module: "workspace",
  reads: [
    {
      key: "calendar.month",
      description: "What is on my calendar in a month: meetings, invitations, task deadlines and leave",
      params: c.calendar.CalendarListQuery,
      permission: ["workspace", "view"],
      run: (_client, params, actor) => service.month(actor.scope.employee_id, params),
      cite: (row) => ({ type: row.item_kind === "event" ? "calendar_event" : row.item_kind === "task" ? "task" : "leave_request", id: row.item_id, label: row.title }),
    },
  ],
  routes: [{ intent: "book a meeting", screen: "workspace.calendar", params: { new: "1" }, prefill: c.calendar.CalendarEventCreate }],
});
