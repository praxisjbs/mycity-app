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
 *   attendance.export_requested     a month or the register asked for as a workbook, made
 *                                   after commit into the file the screen that asked is
 *                                   waiting on, and downloaded there (attendance.export.js)
 *   attendance.home_requested       a remote employee sent a home location: People
 *                                   (approve, within scope) are told
 *   attendance.home_decided         People approved or rejected it: the person is told, and
 *                                   their clock reloads
 *   location_request.submitted      a work location request was sent; its approval
 *                                   (attendance.location_request) tells the first stage
 *   location_request.approved,      its approval ended; copied onto the request after commit
 *   location_request.rejected       (the approval already told the person); the clock reloads
 *   location_request.cancelled      the person withdrew or cancelled it; the clock reloads
 *   field_assignment.assigned       a line manager or People sent someone out (one event a
 *                                   person): they are told, and their clock reloads
 *   field_assignment.cancelled      it was cancelled (one a person still on it): they are told
 *                                   why, and their clock reloads
 *   field_assignment.member_removed someone was taken off it: they are told why
 *   attendance.schedule_set         People set a hybrid employee's office days: they are told,
 *                                   and their clock reloads; audited on the employee
 *   attendance.clock_in_due         the clock watch found someone expected and not clocked in,
 *                                   in the first hour after the start: they are reminded (the bell,
 *                                   and push as their preference allows); clocking in reads it
 *   attendance.clocked_out_automatically
 *                                   the clock watch closed a shift left open once it ended and
 *                                   the person was away from the app: they are told when
 *   temporary_site.submitted        Add Work Site sent a site for approval (attendance.temporary_site
 *                                   tells its approvers): the others on it are told they are on it
 *   temporary_site.approved         its approval ended approved, or People added it directly: the
 *                                   others on it are told, and the location flags it covers clear
 *   temporary_site.rejected,        its approval ended rejected, or it was withdrawn: the others on
 *   temporary_site.withdrawn        it are told (the approval tells the submitter of a decision)
 *   temporary_site.cancelled        People cancelled it: everyone still on it is told why
 *   temporary_site.member_removed   People took someone off it: they are told why
 *   attendance.checked_in           a check-in at a stop on a site's day: the clock reloads; a
 *                                   flagged one also emits attendance.review_required
 *   The Attendance policy's versions, approvals and acknowledgements are policies' events
 *   (src/modules/policies/policies.events.js); its rules are this module's (guide §6.15).
 *
 * Payloads carry ids, dates, results and exception types (a field assignment's number and
 * name too): never coordinates, an address, a device identifier or the evidence itself.
 */
const { pool } = require("../../config/db");
const { defineEvents, WORKFLOW } = require("../../shared/events/catalogue");
const places = require("../../shared/places/owners");
const outbox = require("../../shared/events/outbox");
const workflow = require("../../shared/workflow/engine");
const { defineNotification, permissionHolders } = require("../../shared/notifications/fanout");
const { defineDocumentType } = require("../../shared/documents/types");
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
  "field_assignment.assigned": { summary: "Someone was sent out on a field assignment" },
  "field_assignment.cancelled": { summary: "A field assignment was cancelled" },
  "field_assignment.member_removed": { summary: "Someone was taken off a field assignment" },
  "attendance.schedule_set": { summary: "A hybrid employee's work schedule was set" },
  "attendance.clock_in_due": { summary: "An employee was reminded to clock in" },
  "attendance.clocked_out_automatically": { summary: "An open shift was clocked out automatically" },
  "temporary_site.submitted": { summary: "A temporary site was sent for approval" },
  "temporary_site.approved": { summary: "A temporary site was approved" },
  "temporary_site.rejected": { summary: "A temporary site was rejected" },
  "temporary_site.withdrawn": { summary: "A temporary site was withdrawn" },
  "temporary_site.cancelled": { summary: "A temporary site was cancelled" },
  "temporary_site.member_removed": { summary: "Someone was taken off a temporary site" },
  "attendance.checked_in": { summary: "A check-in was recorded at a stop" },
});

/** The approval every work location request opens (docs/guides/attendance.md §6.11). */
const REQUEST_DEFINITION_KEY = "attendance.location_request";
/** The approval every temporary site sent from Add Work Site opens (§6.11). */
const SITE_DEFINITION_KEY = "attendance.temporary_site";

defineDocumentType("attendance_export", {
  label: "Attendance export",
  module: "people",
  sensitivity: "restricted",
  export: true,
});

/** "Outside the worksite" for the notification line, by exception type. */
const WHAT = Object.freeze({
  outside_worksite: "outside the worksite",
  outside_home: "outside the approved home",
  location_unverified: "location not verified",
  unknown_device: "an unregistered device",
  suspicious_timestamp: "the device clock ahead",
  missing_clock_out: "no clock-out",
  automatic_clock_out: "the automatic clock-out's time",
});
const whatOf = (types) => (types || []).map((t) => WHAT[t] || t).join(", ");

defineNotification(EVENTS.ATTENDANCE_REVIEW_REQUIRED, {
  to: [{ subject: true }, { permission: ["people", "approve"] }],
  title: "Attendance needs review",
  body: (e) => `${e.payload.employee_name}, ${formatDate(e.payload.work_date)}: ${whatOf(e.payload.types)}.`,
  include_actor: true,
  copy: true,
});

defineNotification(EVENTS.ATTENDANCE_EXCEPTION_EXPLAINED, {
  to: [{ permission: ["people", "approve"] }],
  title: "Attendance explanation",
  body: (e) => `${e.payload.employee_name} explained ${formatDate(e.payload.work_date)}.`,
  copy: true,
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
  copy: true,
});

defineNotification(EVENTS.ATTENDANCE_HOME_DECIDED, {
  to: [{ subject: true }],
  title: (e) => (e.payload.status === "approved" ? "Home location approved" : "Home location rejected"),
  body: (e) =>
    e.payload.status === "approved"
      ? "Your clock-ins are now checked against it."
      : "Send it again from My Attendance.",
});

/** "FA-0001 · Venue Setup" */
const assignmentOf = (p) => `${p.number} · ${p.name}`;
const daysOf = (p) =>
  p.starts_on === p.ends_on ? formatDate(p.starts_on) : `${formatDate(p.starts_on)} to ${formatDate(p.ends_on)}`;

defineNotification(EVENTS.FIELD_ASSIGNMENT_ASSIGNED, {
  to: [{ subject: true }],
  title: "Field assignment",
  body: (e) => `${assignmentOf(e.payload)}, ${daysOf(e.payload)}.`,
});

defineNotification(EVENTS.FIELD_ASSIGNMENT_CANCELLED, {
  to: [{ subject: true }],
  title: "Field assignment cancelled",
  body: (e) => `${assignmentOf(e.payload)}: ${e.payload.reason}`,
});

defineNotification(EVENTS.FIELD_ASSIGNMENT_MEMBER_REMOVED, {
  to: [{ subject: true }],
  title: "Taken off a field assignment",
  body: (e) => `${assignmentOf(e.payload)}: ${e.payload.reason}`,
});

defineNotification(EVENTS.ATTENDANCE_CLOCK_IN_DUE, {
  to: [{ subject: true }],
  title: "Time to clock in",
  body: (e) => `Your shift started at ${e.payload.starts_at}.`,
});

defineNotification(EVENTS.ATTENDANCE_CLOCKED_OUT_AUTOMATICALLY, {
  to: [{ subject: true }],
  title: "Clocked out automatically",
  body: (e) => `${formatDate(e.payload.work_date)}: clocked out at ${e.payload.clock_out_time}.`,
});

/** "TS-0001 · Gaborone Partner Training" */
const siteOf = (p) => `${p.number} · ${p.name}`;

/**
 * The people on a temporary site, as logins. `butSubmitter` leaves out whoever sent it, whom the
 * approval already tells of its decision (workflow.completed goes to opened_by). The person who
 * acted is never told of their own action (shared/notifications/fanout.js).
 */
const siteMembers = ({ butSubmitter = false } = {}) => async (event, client) => {
  const p = event.payload || {};
  const ids = Array.isArray(p.employee_ids) ? p.employee_ids : [];
  if (!ids.length) return [];
  const { rows } = await client.query(
    `SELECT user_id FROM app_user
      WHERE employee_id = ANY($1::uuid[]) AND status = 'active' AND user_id IS DISTINCT FROM $2::uuid
      ORDER BY user_id`,
    [ids, butSubmitter && !p.direct ? p.submitted_by || null : null],
  );
  return rows.map((r) => r.user_id);
};

defineNotification(EVENTS.TEMPORARY_SITE_SUBMITTED, {
  to: [{ users: siteMembers() }],
  title: "Put on a Temporary Site",
  body: (e) => `${siteOf(e.payload)}, ${daysOf(e.payload)}. Waiting on approval.`,
  who: "The people on it",
});

defineNotification(EVENTS.TEMPORARY_SITE_APPROVED, {
  to: [{ users: siteMembers({ butSubmitter: true }) }],
  title: (e) => (e.payload.direct ? "Added to a Temporary Site" : "Temporary Site Approved"),
  body: (e) => `${siteOf(e.payload)}, ${daysOf(e.payload)}.`,
  who: "The people on it",
});

defineNotification(EVENTS.TEMPORARY_SITE_REJECTED, {
  to: [{ users: siteMembers({ butSubmitter: true }) }],
  title: "Temporary Site Rejected",
  body: (e) => (e.payload.reason ? `${siteOf(e.payload)}: ${e.payload.reason}` : `${siteOf(e.payload)}.`),
  who: "The people on it",
});

defineNotification(EVENTS.TEMPORARY_SITE_WITHDRAWN, {
  to: [{ users: siteMembers() }],
  title: "Temporary Site Withdrawn",
  body: (e) => `${siteOf(e.payload)}, ${daysOf(e.payload)}.`,
  who: "The people on it",
});

defineNotification(EVENTS.TEMPORARY_SITE_CANCELLED, {
  to: [{ users: siteMembers() }],
  title: "Temporary Site Cancelled",
  body: (e) => `${siteOf(e.payload)}: ${e.payload.reason}`,
  who: "The people on it",
});

defineNotification(EVENTS.TEMPORARY_SITE_MEMBER_REMOVED, {
  to: [{ subject: true }],
  title: "Taken off a Temporary Site",
  body: (e) => `${siteOf(e.payload)}: ${e.payload.reason}`,
});

defineNotification(EVENTS.ATTENDANCE_SCHEDULE_SET, {
  to: [{ subject: true }],
  title: "Work schedule set",
  body: (e) => `Office ${e.payload.office_days_text} from ${formatDate(e.payload.effective_from)}.`,
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
  EVENTS.FIELD_ASSIGNMENT_ASSIGNED,
  EVENTS.FIELD_ASSIGNMENT_CANCELLED,
  EVENTS.FIELD_ASSIGNMENT_MEMBER_REMOVED,
  EVENTS.ATTENDANCE_SCHEDULE_SET,
  EVENTS.ATTENDANCE_CHECKED_IN,
])
  outbox.register(key, "attendance.push_updated", pushUpdated);

/** A site's change reloads the clock and the screens of everyone on it. */
async function pushSiteUpdated(event) {
  for (const employeeId of (event.payload && event.payload.employee_ids) || [])
    await pushUpdated({ payload: { employee_id: employeeId, work_date: null } });
}

for (const key of [
  EVENTS.TEMPORARY_SITE_SUBMITTED,
  EVENTS.TEMPORARY_SITE_APPROVED,
  EVENTS.TEMPORARY_SITE_REJECTED,
  EVENTS.TEMPORARY_SITE_WITHDRAWN,
  EVENTS.TEMPORARY_SITE_CANCELLED,
  EVENTS.TEMPORARY_SITE_MEMBER_REMOVED,
])
  outbox.register(key, "attendance.push_site_updated", pushSiteUpdated);

/* The service and the export are required when a handler runs: they require this file. */
outbox.register(EVENTS.ATTENDANCE_EXPORT_REQUESTED, "attendance.build_export", (event, ctx) =>
  require("./attendance.export").buildExport(event, ctx),
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

/*
 * A temporary site's approval, the same way: its outcome copied onto the site once, after commit; a
 * withdrawal made by the submitter has already closed it. An approved site then clears the location
 * flags it covers (§6.11).
 */
const sites = () => require("./attendance.sites");

workflow.onCompleted(SITE_DEFINITION_KEY, "attendance.apply_temporary_site_decision", (event) =>
  sites().settle(event.entity.id, OUTCOME[event.payload.state] || null, { reason: event.payload.reason || null }),
);

outbox.register(WORKFLOW.WORKFLOW_CANCELLED, "attendance.apply_temporary_site_withdrawal", async (event) => {
  if (event.payload.definition_key !== SITE_DEFINITION_KEY) return;
  await sites().settle(event.entity.id, "cancelled");
});

outbox.register(EVENTS.TEMPORARY_SITE_APPROVED, "attendance.resolve_covered_exceptions", (event) =>
  sites().cover(event.entity.id),
);

/** Attendance addresses saved while search was down are named by the places-name job (F27). */
for (const owner of Object.keys(require("./attendance.repo").ADDRESS_LINE))
  places.owner(owner, { rename: (client, key, line) => require("./attendance.repo").renameAddress(client, owner, key, line) });
for (const owner of Object.keys(require("./attendance.sites.repo").ADDRESS_LINE))
  places.owner(owner, { rename: (client, key, line) => require("./attendance.sites.repo").renameAddress(client, owner, key, line) });

module.exports = { EVENTS, WHAT, REQUEST_DEFINITION_KEY, SITE_DEFINITION_KEY, pushUpdated };
