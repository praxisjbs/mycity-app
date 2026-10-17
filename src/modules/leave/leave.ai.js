"use strict";
/**
 * What the assistant may read about leave for People: the requests within the
 * asker's own `people` scope (Operations & People everyone, a line manager their
 * team), one page of 25 at a time, and the figures above the list. It never approves,
 * records or cancels (A23); it sends the person to the screen that does.
 *
 * Someone asking about their own leave is answered by ESS (ess.ai.js).
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./leave.service");

module.exports = defineManifest({
  module: "people",
  reads: [
    {
      key: "leave.requests",
      description: "List leave requests: who is away, when, and whether each is waiting, approved, rejected or cancelled",
      params: c.leave.LeaveListQuery,
      permission: ["people", "view"],
      run: (_client, params, actor) => service.list(params, actor.scope),
      cite: (row) => ({
        type: "leave_request",
        id: row.leave_request_id,
        label: `${row.employee.display_name}, ${row.leave_type_name}`,
      }),
    },
  ],
  routes: [
    { intent: "see who is on leave", screen: "people.leave" },
    { intent: "approve a leave request", screen: "people.leave" },
  ],
});
