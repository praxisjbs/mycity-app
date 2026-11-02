"use strict";
/**
 * What the assistant may read and do about leave for People: the requests within the
 * asker's own `people` scope (Operations & People everyone, a line manager their
 * team), one page of 25 at a time; the requests counted (leave.summary: by status,
 * type, person or department, or by month; days taken, booked and waiting; figures,
 * never rows, docs/guides/praxis-ai.md §6.13); and, as cards the person confirms after
 * Confirm It's You (§6.11, risk approval), approving or rejecting the requests waiting on
 * them, up to 25 a press, each through the same approval call People · Leave's Approve and
 * Reject make, never their own. Recording leave for someone stays on the screen.
 *
 * Someone asking about their own leave is answered by ESS (ess.ai.js), which offers the
 * request itself (my_leave.request).
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const routeMap = require("../../shared/route-map");
const service = require("./leave.service");

const requestLink = (id) => (routeMap.linkFor("leave_request", id) || {}).path || null;

/** A leave request for `who`, of the annual type the matrix names, on a fresh weekday ahead, through Request Leave's own service. */
async function requestFor(ctx, who) {
  const day = ctx.freshDay();
  const r = await service.request(who.user, who.employee_id, { leave_type_id: ctx.leaveTypeId, starts_on: day, ends_on: day, reason: `A matrix day for ${ctx.role}` });
  return { type: "leave_request", id: r.leave_request_id, values: { leave_request_ids: [r.leave_request_id], reason: "Not that week" } };
}

/**
 * The matrix's scope probes (docs/guides/praxis-ai.md §6.17): a request by someone in the asker's
 * reach (a report of theirs; nothing to assert for a person with none) and one by an outsider; the
 * list returns the first and never the second, and a card naming the second is refused.
 */
const probe = {
  inside: (ctx) => (ctx.report ? requestFor(ctx, ctx.report) : null),
  outside: (ctx) => requestFor(ctx, ctx.outsider),
};

/** What the approve and reject cards share: the requests named, the re-check, the lines read back. */
const decision = (verb) => ({
  permission: ["people", "approve"],
  risk: "approval",
  bulk: 25,
  // Approve on People · Leave and My Approvals is one press on a request; Reject asks its reason in a sheet (workflow.ReasonBody).
  form: "none: Approve is one press on a request and Reject asks its reason in a sheet; the card decides several at once",
  records: (values, actor, db) => (db ? service.cardRecords(db, values.leave_request_ids, actor.scope) : (values.leave_request_ids || []).map((id) => ({ type: "leave_request", id }))),
  check: (client, values, actor) => service.assertCardRequests(client, values.leave_request_ids, actor),
  run: (values, actor) => service.decideMany(actor, values, verb),
  readback: (r) => r.lines.map((l) => ({ ...l, link: requestLink(l.id) })),
  labels: { leave_request_ids: "Requests", reason: "Reason" },
  matrix: probe,
});

module.exports = defineManifest({
  module: "people",
  actions: [
    {
      key: "leave.approve",
      label: "Approve Leave",
      description: "Approve leave requests waiting on me, with a note for the person if I like",
      input: c.leave.LeaveApprove,
      ...decision("approve"),
    },
    {
      key: "leave.reject",
      label: "Reject Leave",
      description: "Reject leave requests waiting on me, saying why",
      input: c.leave.LeaveReject,
      ...decision("reject"),
    },
  ],
  // Every other Create schema of this module's contract, and why the assistant does not offer it (gate 23).
  not_offered: {
    LeaveTypeCreate: "a leave type is Settings, set by Operations & People on the Leave screen",
    LeaveRecordCreate: "leave recorded for someone is approved at once with no flow; People record it on the screen with the person in view",
  },
  summaries: [
    {
      key: "leave.summary",
      description: "Leave figures: requests waiting, approved, rejected and cancelled, days taken, booked and waiting, by status, type, person or department, or by month",
      params: c.leave.LeaveSummaryQuery,
      permission: ["people", "view"],
      run: (client, params, actor) => service.aiSummary(client, params, actor.scope),
    },
  ],
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
      matrix: probe,
    },
  ],
  routes: [
    { intent: "see who is on leave", screen: "people.leave" },
    { intent: "approve a leave request", screen: "people.leave" },
  ],
});
