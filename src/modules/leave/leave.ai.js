"use strict";
/**
 * What the assistant may read and do about leave for People: the requests within the
 * asker's own `people` scope (Operations & People everyone, a line manager their
 * team), one page of 25 at a time; the requests counted (leave.summary: by status,
 * type, person or department, or by month; days taken, booked and waiting; figures,
 * never rows, docs/guides/praxis-ai.md §6.13); and, as cards the person confirms after
 * Confirm It's You (§6.11, risk approval), approving or rejecting the requests waiting on
 * them, up to 25 a press, each through the same approval call People · Leave's Approve and
 * Reject make, never their own. And People · Leave's forms as cards (decision 33): Record Leave
 * for someone in the person's scope (approved at once, so risk approval: it spends their year),
 * Add Type and Save Type (a changed allowance moves everyone's year, so Save Type is approval too),
 * each through the service function the screen's own button calls.
 *
 * Someone asking about their own leave is answered by ESS (ess.ai.js), which offers the
 * request itself (my_leave.request).
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const routeMap = require("../../shared/route-map");
const people = require("../organisation/organisation.cards");
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
/**
 * Which requests, when the person did not say (praxis-ai.md decision 34): the requests waiting for a
 * decision in their reach, as the leave list names them ("Ayo Bello, Annual"), matched by those words.
 */
const whichRequests = { field: "leave_request_ids", question: "Which requests?", read: "leave.requests", params: { status: "submitted" } };

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

/**
 * The matrix's probes for Record Leave (praxis-ai.md §6.17): a report of the asker's is in their
 * reach, the outsider never; a card naming the outsider is refused by its own check.
 */
const recordFor = (ctx, who) => {
  const day = ctx.freshDay();
  return { type: "employee", id: who.employee_id, values: { employee_id: who.employee_id, leave_type_id: ctx.leaveTypeId, starts_on: day, ends_on: day, reason: "Recorded by the matrix" } };
};
const recordProbe = {
  inside: (ctx) => (ctx.report ? recordFor(ctx, ctx.report) : null),
  outside: (ctx) => recordFor(ctx, ctx.outsider),
};

const typeLine = (status) => (t) => [{ type: "leave_type", id: t.leave_type_id, label: t.name, status, link: routeMap.screenPath("people", "leave") }];
const TYPE_LABELS = { name: "Name", days_per_year: "Days a Year" };

module.exports = defineManifest({
  module: "people",
  actions: [
    {
      key: "leave.record",
      label: "Record Leave",
      matrix: recordProbe,
      description: "Record leave for someone in my scope, approved at once with no flow: the person, the leave type (by name), the first and last day and a note",
      input: c.leave.LeaveRecordCreate,
      permission: ["people", "create"],
      // Approved at once, it spends the person's year: Confirm It's You first (JBS Praxis, 03/11/2026).
      risk: "approval",
      form: "none: Record Leave is Request Leave's own form with the person picked beside it; the card carries LeaveRecordCreate",
      fields: ["employee_id", "leave_type_id", "starts_on", "ends_on", "reason"],
      picks: { employee_id: "employee", leave_type_id: "leave_type" },
      // A type written by name is matched among the types, as Request Leave's card matches it (decision 32).
      resolve: { leave_type_id: (value, _actor, db) => service.typeIdOf(db, value) },
      names: async (values, actor, db) => [...(await people.cardEmployee(db, values.employee_id, actor.scope)), ...(await service.cardType(db, values.leave_type_id))],
      asks: [
        // Who, from People's register in the reader's scope (praxis-ai.md decision 34).
        { field: "employee_id", question: "Who is the leave for?", read: "employees.list", params: { status: "active" } },
        { field: "leave_type_id", question: "Which leave type?" },
        { field: "starts_on", question: "What is the first day?" },
        { field: "ends_on", question: "What is the last day?" },
      ],
      check: (client, values, actor) => service.assertCardRecord(client, values, actor),
      // The same function Record Leave calls: the type, the days and the year's allowance are its checks.
      run: (values, actor) => service.record(actor, actor.scope, values),
      readback: (r) => [{ type: "leave_request", id: r.leave_request_id, label: `${r.employee.display_name}, ${r.leave_type_name}, ${r.days} ${r.days === 1 ? "day" : "days"}`, status: "recorded", link: requestLink(r.leave_request_id) }],
      labels: { employee_id: "Person", leave_type_id: "Leave Type", starts_on: "First Day", ends_on: "Last Day", reason: "Note" },
    },
    {
      key: "leave_types.add",
      label: "Add Type",
      description: "Add a leave type staff may ask for: its name and the working days a year it allows (none for no set allowance)",
      input: c.leave.LeaveTypeAdd,
      permission: ["people", "create"],
      risk: "standard",
      form: "none: New Leave Type's sheet makes the code from the name as it sends; the card takes the name and the allowance (LeaveTypeAdd)",
      asks: [{ field: "name", question: "What is the leave type called?" }],
      // The same function Add Type calls, the code made from the name as the sheet makes it.
      run: (values, actor) => service.addType(actor, values),
      readback: typeLine("added"),
      labels: TYPE_LABELS,
    },
    {
      key: "leave_types.edit",
      label: "Save Type",
      description: "Change a leave type: rename it, change the working days a year it allows, or retire it (active false) or offer it again (true); only what changes",
      input: c.leave.LeaveTypeChange,
      permission: ["people", "edit"],
      // A changed allowance moves everyone's year: Confirm It's You first (JBS Praxis, 03/11/2026).
      risk: "approval",
      form: "none: Edit Leave Type's sheet changes the type open on People, Leave and never names it; the card does",
      fields: ["leave_type_id", "name", "days_per_year", "active"],
      asks: [{ field: "leave_type_id", question: "Which leave type?", options: ({ db }) => service.typeNames(db) }],
      resolve: { leave_type_id: (value, _actor, db) => service.typeIdOf(db, value) },
      records: (values, _actor, db) => service.cardType(db, values.leave_type_id),
      check: (client, values) => service.assertCardType(client, values.leave_type_id),
      run: (values, actor) => {
        const { leave_type_id: id, ...changes } = values;
        return service.updateType(actor, id, changes);
      },
      readback: typeLine("saved"),
      labels: { leave_type_id: "Leave Type", ...TYPE_LABELS, active: "Offered" },
    },
    {
      key: "leave.approve",
      label: "Approve Leave",
      description: "Approve leave requests waiting on me, with a note for the person if I like",
      input: c.leave.LeaveApprove,
      ...decision("approve"),
      asks: [whichRequests],
    },
    {
      key: "leave.reject",
      label: "Reject Leave",
      description: "Reject leave requests waiting on me, saying why",
      input: c.leave.LeaveReject,
      ...decision("reject"),
      asks: [whichRequests, { field: "reason", question: "Why are you rejecting it?" }],
    },
  ],
  // The sheets' own requests, reached through the cards that carry them (gate 23, praxis-ai.md decision 33).
  not_offered: {
    LeaveTypeCreate: "via leave_types.add: New Leave Type's own request, whose code the sheet makes from the name; the card is LeaveTypeAdd",
    LeaveTypeUpdate: "via leave_types.edit: Edit Leave Type's own request, which never names its type; the card is LeaveTypeChange",
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
      summary: "leave.summary",
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
