"use strict";
/**
 * What the assistant may read and do in Employee Self-Service: the caller's own
 * record, documents and leave, and where it sends them to add a document; and, as a card the
 * person confirms (docs/guides/praxis-ai.md §6.11), a leave request of their own through the
 * same service function Request Leave's Send calls. Never another person's record; every read
 * is given the caller's own employee id and nothing else.
 *
 * The rest of ESS (the latest payslip, open queries, docs/guides/ess.md §9) joins
 * this manifest as each of those tabs lands.
 */
const c = require("@mycity/contract");
const { AppError } = require("../../shared/errors");
const { defineManifest } = require("../../shared/ai/manifest");
const routeMap = require("../../shared/route-map");
const documents = require("../documents/documents.service");
const leave = require("../leave/leave.service");
const profile = require("./ess.profile");

const EMPTY = { data: [], page: { number: 1, size: 25, total: 0, pages: 0, has_next: false } };

/**
 * The matrix's scope probes (docs/guides/praxis-ai.md §6.17): every read here is the asker's own,
 * whatever their grant says, so their own record and request are returned and an outsider's never.
 */
const profileProbe = {
  inside: (ctx) => ({ type: "employee", id: ctx.actor.employee_id }),
  outside: (ctx) => ({ type: "employee", id: ctx.outsider.employee_id }),
};
async function requestFor(ctx, who) {
  const day = ctx.freshDay();
  const r = await leave.request(who.user, who.employee_id, { leave_type_id: ctx.leaveTypeId, starts_on: day, ends_on: day, reason: `A matrix day for ${ctx.role}` });
  return { type: "leave_request", id: r.leave_request_id };
}
const leaveProbe = {
  inside: (ctx) => requestFor(ctx, { user: ctx.actor, employee_id: ctx.actor.employee_id }),
  outside: (ctx) => requestFor(ctx, ctx.outsider),
};

module.exports = defineManifest({
  module: "ess",
  actions: [
    {
      key: "my_leave.request",
      label: "Request Leave",
      description: "Ask for leave for myself: the leave type, the first and last day, and a note for my line manager",
      input: c.leave.LeaveRequestCreate,
      permission: ["ess", "create"],
      risk: "standard",
      // The request is the person's own: the card names no other record.
      check: async (_client, _values, actor) => {
        if (!actor.employee_id) throw new AppError("FORBIDDEN", "Only an employee asks for leave", 403);
      },
      // The same function Request Leave's Send calls (ess.leave.request); the type, the days and the year's allowance are its checks.
      run: (values, actor) => leave.request(actor, actor.employee_id, values),
      readback: (r) => [{ type: "leave_request", id: r.leave_request_id, label: `${r.leave_type_name}, ${r.days} ${r.days === 1 ? "day" : "days"}`, status: "sent", link: (routeMap.linkFor("leave_request", r.leave_request_id, { self: true }) || {}).path || null }],
      labels: { leave_type_id: "Leave Type", starts_on: "First Day", ends_on: "Last Day", reason: "Note" },
    },
  ],
  reads: [
    {
      key: "my_profile.get",
      description: "Read my own record: job, department, line manager, contact details, next of kin, bank and the working week",
      params: c.common.EmptyBody,
      permission: ["ess", "view"],
      run: (_client, _params, actor) => (actor.employee_id ? profile.get(actor) : null),
      cite: (row) => ({ type: "employee", id: row.employee_id, label: row.display_name }),
      matrix: profileProbe,
    },
    {
      key: "my_documents.list",
      description:
        "List my own documents and the ones People have asked me for",
      params: c.documents.DocumentListQuery,
      permission: ["ess", "view"],
      run: (_client, params, actor) =>
        actor.employee_id
          ? documents.listFor([actor.employee_id], params)
          : EMPTY,
      cite: (row) => ({
        type: "document",
        id: row.document_id || row.document_request_id,
        label: row.name,
      }),
    },
    {
      key: "my_leave.list",
      description: "List my own leave requests, with their dates, working days and status",
      params: c.ess.EssLeaveListQuery,
      permission: ["ess", "view"],
      run: (_client, params, actor) =>
        actor.employee_id ? leave.listFor(actor.employee_id, params) : EMPTY,
      cite: (row) => ({
        type: "leave_request",
        id: row.leave_request_id,
        label: `${row.leave_type_name}, ${row.days} days`,
      }),
      matrix: leaveProbe,
    },
    {
      key: "my_leave.balances",
      description: "How many leave days I am entitled to this year, per leave type, and how many are taken, booked, waiting and left",
      params: c.ess.EssLeaveBalanceQuery,
      permission: ["ess", "view"],
      run: (_client, params, actor) =>
        actor.employee_id
          ? leave.balancesFor(actor.employee_id, params.year)
          : { year: null, balances: [] },
      cite: () => ({ type: "screen", id: "ess.my-leave", label: "My Leave" }),
    },
  ],
  routes: [
    { intent: "upload one of my documents", screen: "ess.my-documents" },
    { intent: "change my phone, address, next of kin or bank details", screen: "ess.my-profile" },
    { intent: "request leave", screen: "ess.my-leave", params: { new: "1" }, prefill: c.leave.LeaveRequestPrefill },
  ],
});
