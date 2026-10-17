"use strict";
/**
 * What the assistant may read in Employee Self-Service: the caller's own
 * record, documents and leave, and where it sends them to add a document or ask for
 * leave (A23: it reads, it never writes). Never another person's record; every
 * read is given the caller's own employee id and nothing else.
 *
 * The rest of ESS (the latest payslip, open queries, docs/guides/ess.md §9) joins
 * this manifest as each of those tabs lands.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const documents = require("../documents/documents.service");
const leave = require("../leave/leave.service");
const profile = require("./ess.profile");

const EMPTY = { data: [], page: { number: 1, size: 25, total: 0, pages: 0, has_next: false } };

module.exports = defineManifest({
  module: "ess",
  reads: [
    {
      key: "my_profile.get",
      description: "Read my own record: job, department, line manager, contact details, next of kin, bank and the working week",
      params: c.common.EmptyBody,
      permission: ["ess", "view"],
      run: (_client, _params, actor) => (actor.employee_id ? profile.get(actor) : null),
      cite: (row) => ({ type: "employee", id: row.employee_id, label: row.display_name }),
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
    { intent: "request leave", screen: "ess.my-leave", prefill: c.leave.LeaveRequestCreate },
  ],
});
