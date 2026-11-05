"use strict";
/**
 * Requisitions (docs/guides/expenses.md §3 steps 4 and 5, §6.4): Operations & People's batch of
 * approved requests for the CEO. A requisition owns its requests through
 * expense_request.requisition_id; it is decided as a whole in its approval
 * (`expenses.requisition`), and before that the CEO may remove a request from it.
 *
 * Statuses: submitted (with the CEO), approved, rejected, cancelled (every request removed).
 */
const { z } = require("zod");
const { uuid, text, isoDateTime, money, listQuery, Paged } = require("./common");
const { PersonRef } = require("./organisation");
const { ExpenseRow } = require("./expenses");

const RequisitionStatus = z.enum(["submitted", "approved", "rejected", "cancelled"]);

/** One requisition as the list shows it. */
const Requisition = z
  .object({
    requisition_id: uuid,
    number: z.string(),
    status: RequisitionStatus,
    requests: z.number().int().min(0),
    total_amount: money,
    requester: PersonRef,
    workflow_instance_id: uuid.nullable(),
    submitted_at: isoDateTime.nullable(),
    approved_at: isoDateTime.nullable(),
    rejected_at: isoDateTime.nullable(),
    can_decide: z.boolean(),
  })
  .strict();

/** One requisition as its modal shows it: its first 25 requests and how many in all. */
const RequisitionDetail = Requisition.extend({
  items: z.array(ExpenseRow).max(25),
}).strict();

const RequisitionListQuery = listQuery(
  { status: RequisitionStatus.optional() },
  ["submitted_at", "total_amount", "number"],
);
const RequisitionPage = Paged(Requisition);

/** Create Requisition: the approved requests ticked, 1 to 25 at a time. */
const RequisitionCreate = z
  .object({
    expense_request_ids: z.array(uuid).min(1, "Tick a request").max(25),
  })
  .strict();

/** The CEO removes one request before deciding; it returns to Operations & People. */
const RequisitionRemove = z
  .object({
    expense_request_id: uuid,
    reason: text(500),
  })
  .strict();

const TABLES = {
  Requisition: {
    table: "requisition",
    virtual: {
      requests: "count of expense_request in it",
      requester: "who grouped it, from employee and department",
      can_decide: "the reader is the approver its approval waits on",
    },
  },
  RequisitionDetail: {
    table: "requisition",
    virtual: {
      requests: "count of expense_request in it",
      requester: "who grouped it, from employee and department",
      can_decide: "the reader is the approver its approval waits on",
      items: "its expense_request rows",
    },
  },
  RequisitionListQuery: { table: null, reason: "list controls for the requisitions" },
  RequisitionPage: { table: null, reason: "a page of requisitions" },
  RequisitionCreate: { table: null, reason: "the requests to group; sets expense_request.requisition_id" },
  RequisitionRemove: { table: null, reason: "clears expense_request.requisition_id; the reason is its history" },
};

module.exports = {
  TABLES,
  RequisitionStatus,
  Requisition,
  RequisitionDetail,
  RequisitionListQuery,
  RequisitionPage,
  RequisitionCreate,
  RequisitionRemove,
};
