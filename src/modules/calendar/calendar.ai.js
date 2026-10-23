"use strict";
/**
 * What the assistant may read of the asker's calendar: their own month (events,
 * invitations, task deadlines, approved leave), one page of 25 at a time. It never
 * books or answers anything (A23); it sends the person to New Event.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./calendar.service");

/** What each kind of item on the month links to, as the route map names it; a performance date by its kind. */
const CITED = {
  event: "calendar_event",
  task: "task",
  leave: "leave_request",
  check_in_due: "review",
  review_due: "review",
  key_result_due: "key_result",
  pip_review: "improvement_plan",
};

module.exports = defineManifest({
  module: "workspace",
  reads: [
    {
      key: "calendar.month",
      description: "What is on my calendar in a month: meetings, invitations, task deadlines and leave",
      params: c.calendar.CalendarListQuery,
      permission: ["workspace", "view"],
      run: (_client, params, actor) => service.month(actor.scope.employee_id, params),
      cite: (row) => ({ type: CITED[row.performance_kind || row.item_kind], id: row.item_id, label: row.title }),
    },
  ],
  routes: [{ intent: "book a meeting", screen: "workspace.calendar", params: { new: "1" }, prefill: c.calendar.CalendarEventPrefill }],
});
