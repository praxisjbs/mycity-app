"use strict";
/**
 * What the assistant may read and do about requisitions (docs/guides/expenses.md §9).
 *
 * The read lists the requisitions, 25 a page, to a holder of `expenses.finance` (the CEO among
 * them), as Expenses · Requisitions shows them; anyone else is answered with an empty page, as
 * the screen is closed to them. A read carries no capability of its own, so the run asks it.
 *
 * Create Requisition is a card the person confirms: up to 25 approved requests, picked from the
 * requests waiting for a requisition, through the service function the tab's own button calls.
 * The CEO approves or rejects a requisition through the approvals' own card (approvals.decide);
 * taking one request out is a press with a reason on the requisition and has no form.
 *
 * RequisitionRemove is offered no card on purpose (M8 audit F20): it is the CEO's press with a
 * reason on the requisition's own modal, one request at a time, deciding what the CEO is about to
 * approve, and is no create or edit form, so `not_offered` (which gate 23 keeps for those) cannot
 * hold it. The CEO is pointed to Expenses · Requisitions, the route below.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const { envelope } = require("../../shared/http/paged");
const { holdsCapability } = require("../../middleware/rbac");
const service = require("./requisitions.service");

module.exports = defineManifest({
  module: "expenses",
  reads: [
    {
      key: "requisitions.list",
      description: "List the requisitions: approved expense requests grouped for the CEO, with how many each holds, the total and whether the CEO decided it",
      params: c.requisitions.RequisitionListQuery,
      permission: ["expenses", "view"],
      run: async (_client, params, actor) => ((await holdsCapability(actor, "expenses.finance")) ? service.list(params, actor) : envelope([], 1, 0)),
      cite: (row) => ({ type: "requisition", id: row.requisition_id, label: row.number }),
    },
  ],
  actions: [
    {
      key: "requisitions.create",
      label: "Create Requisition",
      description: "Group approved expense requests not yet in a requisition, up to 25, into one requisition for the CEO to approve",
      input: c.requisitions.RequisitionCreate,
      permission: ["expenses", "create"],
      capability: "expenses.finance",
      risk: "standard",
      bulk: 25,
      form: "none: Create Requisition is a press on the requests ticked on Expenses · Requisitions; the card names them",
      asks: [{ field: "expense_request_ids", question: "Which approved requests?", read: "expenses.list", params: { status: "approved" } }],
      records: (values, _actor, db) => (db ? service.cardRequests(db, values.expense_request_ids) : (values.expense_request_ids || []).map((id) => ({ type: "expense", id }))),
      check: (client, values) => service.assertCardRequests(client, values.expense_request_ids),
      run: (values, actor) => service.create(actor, values),
      readback: service.readback,
      labels: { expense_request_ids: "Requests" },
    },
  ],
  routes: [{ intent: "group approved expenses for the CEO", screen: "expenses.requisitions" }],
});
