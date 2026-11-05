"use strict";
/**
 * What the assistant may read and do about disbursements (docs/guides/expenses.md §9).
 *
 * The read lists the transfers within the reader's `expenses` scope (a requester sees their own
 * request paid), 25 a page; a reader without `expenses.finance` is answered with an empty page, as
 * the screen is closed to them. Bank details are masked by the engine for a reader without
 * `employee.bank`.
 *
 * Cards a holder of `expenses.finance` confirms, through the service functions the tab's own
 * buttons call: Record Disbursement (money: Confirm It's You first) for one authorised request,
 * and Add Reference on a transfer saved without one. A receipt is a file and stays on the form.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const { envelope } = require("../../shared/http/paged");
const { holdsCapability } = require("../../middleware/rbac");
const service = require("./disbursements.service");

module.exports = defineManifest({
  module: "expenses",
  reads: [
    {
      key: "disbursements.list",
      description: "List the transfers that paid expense requests: the payee, amount, day paid and bank reference, or that the reference is missing",
      params: c.disbursements.DisbursementListQuery,
      permission: ["expenses", "view"],
      run: async (_client, params, actor) => ((await holdsCapability(actor, "expenses.finance")) ? service.list(params, actor.scope) : envelope([], 1, 0)),
      cite: (row) => ({ type: "disbursement", id: row.disbursement_id, label: `${row.number}, ${row.request_number}` }),
    },
  ],
  actions: [
    {
      key: "disbursements.create",
      label: "Record Disbursement",
      description: "Record the bank transfer that paid an authorised expense request: the bank's transaction reference and the day paid; without a reference it is saved as Reference Missing only when I confirm",
      input: c.disbursements.DisbursementCreate,
      permission: ["expenses", "create"],
      capability: "expenses.finance",
      risk: "money",
      form: "none: Record Disbursement's form is on INTERIM rules until the screens move onto the contract (docs/handoff/m8-expenses.md PR 7); the card carries DisbursementCreate without its receipt",
      fields: ["expense_request_id", "payment_reference", "paid_on", "confirm_without_reference"],
      asks: [
        { field: "expense_request_id", question: "Which request was paid?", read: "expenses.list", params: { status: "authorised" } },
        { field: "paid_on", question: "When was it paid?" },
      ],
      records: (values, _actor, db) => service.cardRequest(db, values.expense_request_id),
      check: (client, values) => service.assertCardPayable(client, values.expense_request_id),
      run: (values, actor) => service.create(actor, values),
      readback: service.readback("recorded"),
      labels: { expense_request_id: "Request", payment_reference: "Bank Reference", paid_on: "Paid On", confirm_without_reference: "Save Without Reference" },
    },
    {
      key: "disbursements.add_reference",
      label: "Add Reference",
      description: "Add the bank's transaction reference to a transfer saved without one",
      input: c.disbursements.DisbursementReferenceAdd,
      permission: ["expenses", "edit"],
      capability: "expenses.finance",
      risk: "standard",
      form: "none: Add Reference's form fills the reference of the transfer open on Expenses · Disbursements and never names it; the card does",
      asks: [
        { field: "disbursement_id", question: "Which transfer?", read: "disbursements.list", params: { reference_missing: "true" } },
        { field: "payment_reference", question: "What is the bank reference?" },
      ],
      records: (values, _actor, db) => service.cardDisbursement(db, values.disbursement_id),
      check: (client, values, actor) => service.assertCardMissing(client, values.disbursement_id, actor),
      run: (values, actor) => service.addReference(actor, actor.scope, values.disbursement_id, { payment_reference: values.payment_reference }),
      readback: service.readback("reference added"),
      labels: { disbursement_id: "Transfer", payment_reference: "Bank Reference" },
    },
  ],
  routes: [{ intent: "record an expense payment", screen: "expenses.disbursements" }],
});
