"use strict";
/**
 * What the attendance module records, who it tells, and the work that follows a
 * committed punch (docs/guides/attendance.md §7). Loaded by the API and the worker.
 *
 *   attendance.punched              every punch, whatever its result: the audit line, and
 *                                   the realtime refresh of the person's clock and of the
 *                                   register for People within scope
 *   attendance.review_required      a punch or the day-close opened an exception: the
 *                                   person and People (approve, within scope) are told
 *   attendance.exception_explained  the person wrote why: People are told
 *   attendance.exception_decided    People decided: the person is told
 *   attendance.day_closed           the day-close closed a person's day
 *   attendance.export_requested     a month or the register asked for as a workbook,
 *                                   built here after commit and emailed (attendance.export.js)
 *   attendance.home_requested       a remote employee sent a home location: People
 *                                   (approve, within scope) are told
 *   attendance.home_decided         People approved or rejected it: the person is told, and
 *                                   their clock reloads
 *   location_request.submitted      a work location request was sent; its approval
 *                                   (attendance.location_request) tells the first stage
 *   location_request.approved,      its approval ended; copied onto the request after commit
 *   location_request.rejected       (the approval already told the person); the clock reloads
 *   location_request.cancelled      the person withdrew or cancelled it; the clock reloads
 *
 * Payloads carry ids, dates, results and exception types: never coordinates, an address,
 * a device identifier or the evidence itself.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { defineEvents, WORKFLOW } = require("../../shared/events/catalogue");
const outbox = require("../../shared/events/outbox");
const workflow = require("../../shared/workflow/engine");
const { defineNotification, permissionHolders } = require("../../shared/notifications/fanout");
const { defineDocumentType } = require("../../shared/documents/types");
const { defineVariables } = require("../../shared/templates/variables");
const { formatDate } = require("../../shared/time/day-first");

const EVENTS = defineEvents("people", {
  "attendance.punched": { summary: "A clock-in or clock-out was recorded" },
  "attendance.review_required": { summary: "An attendance record needs review" },
  "attendance.exception_explained": { summary: "An employee explained an attendance exception" },
  "attendance.exception_decided": { summary: "People decided an attendance exception" },
  "attendance.day_closed": { summary: "An attendance day was closed" },
  "attendance.export_requested": { summary: "An attendance export was requested" },
  "attendance.home_requested": { summary: "A remote employee asked for a home location" },
  "attendance.home_decided": { summary: "People decided a home location" },
  "location_request.submitted": { summary: "A work location request was sent" },
  "location_request.approved": { summary: "A work location request was approved" },
  "location_request.rejected": { summary: "A work location request was rejected" },
  "location_request.cancelled": { summary: "A work location request was withdrawn or cancelled" },
});

/** The approval every work location request opens (docs/guides/attendance.md §6.11). */
const REQUEST_DEFINITION_KEY = "attendance.location_request";

defineDocumentType("attendance_export", {
  label: "Attendance export",
  module: "people",
  sensitivity: "restricted",
});

defineVariables("email", "attendance-export", c.attendance.AttendanceExportEmailVars);

/** "Outside the worksite" for the notification line, by exception type. */
const WHAT = Object.freeze({
  outside_worksite: "outside the worksite",
  outside_home: "outside the approved home",
  location_unverified: "location not verified",
  unknown_device: "an unregistered device",
  suspicious_timestamp: "the device clock ahead",
  missing_clock_out: "no clock-out",
});
const whatOf = (types) => (types || []).map((t) => WHAT[t] || t).join(", ");

defineNotification(EVENTS.ATTENDANCE_REVIEW_REQUIRED, {
  to: [{ subject: true }, { permission: ["people", "approve"] }],
  title: "Attendance needs review",
  body: (e) => `${e.payload.employee_name}, ${formatDate(e.payload.work_date)}: ${whatOf(e.payload.types)}.`,
  include_actor: true,
});

defineNotification(EVENTS.ATTENDANCE_EXCEPTION_EXPLAINED, {
  to: [{ permission: ["people", "approve"] }],
  title: "Attendance explanation",
  body: (e) => `${e.payload.employee_name} explained ${formatDate(e.payload.work_date)}.`,
});

defineNotification(EVENTS.ATTENDANCE_EXCEPTION_DECIDED, {
  to: [{ subject: true }],
  title: "Attendance reviewed",
  body: (e) => `${formatDate(e.payload.work_date)}: ${e.payload.outcome_text}.`,
});

defineNotification(EVENTS.ATTENDANCE_HOME_REQUESTED, {
  to: [{ permission: ["people", "approve"] }],
  title: "Home location to approve",
  body: (e) => `${e.payload.employee_name} sent a home location.`,
});

defineNotification(EVENTS.ATTENDANCE_HOME_DECIDED, {
  to: [{ subject: true }],
  title: (e) => (e.payload.status === "approved" ? "Home location approved" : "Home location rejected"),
  body: (e) =>
    e.payload.status === "approved"
      ? "Your clock-ins are now checked against it."
      : "Send it again from My Attendance.",
});

/*
 * After commit: tell the screens that show this person's attendance to reload. The
 * person's own sockets, and the sockets of everyone whose `people` view reaches them
 * (all-scope holders, and the managers above them). Best effort, like all realtime.
 */
async function pushUpdated(event) {
  const realtime = require("../../services/realtime/emitter");
  const p = event.payload || {};
  if (!p.employee_id) return;
  const { rows } = await pool.query(
    "SELECT user_id FROM app_user WHERE employee_id = $1 AND status = 'active'",
    [p.employee_id],
  );
  const watchers = await permissionHolders(pool, ["people", "view"], p.employee_id);
  const users = new Set([...rows.map((r) => r.user_id), ...watchers]);
  for (const userId of users)
    realtime.toUser(userId, "attendance.updated", { employee_id: p.employee_id, work_date: p.work_date || null });
}

for (const key of [
  EVENTS.ATTENDANCE_PUNCHED,
  EVENTS.ATTENDANCE_EXCEPTION_DECIDED,
  EVENTS.ATTENDANCE_EXCEPTION_EXPLAINED,
  EVENTS.ATTENDANCE_DAY_CLOSED,
  EVENTS.ATTENDANCE_HOME_REQUESTED,
  EVENTS.ATTENDANCE_HOME_DECIDED,
  EVENTS.LOCATION_REQUEST_APPROVED,
  EVENTS.LOCATION_REQUEST_REJECTED,
  EVENTS.LOCATION_REQUEST_CANCELLED,
])
  outbox.register(key, "attendance.push_updated", pushUpdated);

/* The service and the export are required when a handler runs: they require this file. */
outbox.register(EVENTS.ATTENDANCE_EXPORT_REQUESTED, "attendance.send_export", (event) =>
  require("./attendance.export").sendExport(event),
);

/** The request status an approval's end state means. */
const OUTCOME = Object.freeze({
  approved: "approved",
  timeout_approved: "approved",
  rejected: "rejected",
  timeout_rejected: "rejected",
  cancelled: "cancelled",
});

/*
 * After an approval ends, its outcome is copied onto the request. The service is required when a
 * handler runs: it requires this file for its event keys, and the worker loads this file alone.
 */
const settleRequest = (id, status) => require("./attendance.requests").settle(id, status);

workflow.onCompleted(REQUEST_DEFINITION_KEY, "attendance.apply_request_decision", (event) =>
  settleRequest(event.entity.id, OUTCOME[event.payload.state] || null),
);

outbox.register(WORKFLOW.WORKFLOW_CANCELLED, "attendance.apply_request_withdrawal", async (event) => {
  if (event.payload.definition_key !== REQUEST_DEFINITION_KEY) return;
  await settleRequest(event.entity.id, "cancelled");
});

module.exports = { EVENTS, WHAT, REQUEST_DEFINITION_KEY, pushUpdated };
