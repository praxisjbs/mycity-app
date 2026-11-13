"use strict";
/**
 * What the assistant may read and do about disbursements (docs/guides/expenses.md §9).
 *
 * The read lists the transfers within the reader's `expenses` scope (a requester sees their own
 * request paid), 25 a page; a reader without `expenses.finance` is answered with an empty page, as
 * the screen is closed to them. Bank details are masked by the engine for a reader without
 * `employee.bank`.
 *
 * Its summary gives the transfers in figures to the same readers within the same scope (praxis-ai.md
 * §6.13, Finance and pay); anyone else is given no figures.
 *
 * Cards a holder of `expenses.finance` confirms, through the service functions the tab's own
 * buttons call: Record Disbursement (money: Confirm It's You first) for one authorised request,
 * and Add Reference on a transfer saved without one.
 *
 * A payment receipt attached on Praxis AI · Ask by a holder of `expenses.finance` (praxis-ai.md §6.18,
 * decision 46) is read on `disbursement-receipt-read` (`files`) and draws Record Disbursement's card:
 * the request it paid matched here in SQL, the reference and the day from the receipt, the receipt
 * itself claimed by the press.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const { envelope } = require("../../shared/http/paged");
const { holdsCapability } = require("../../middleware/rbac");
const service = require("./disbursements.service");
const receiptAi = require("./disbursements.receipt-ai");

module.exports = defineManifest({
  module: "expenses",
  reads: [
    {
      key: "disbursements.list",
      summary: "disbursements.summary",
      description: "List the transfers that paid expense requests: the payee, amount, day paid and bank reference, or that the reference is missing",
      params: c.disbursements.DisbursementListQuery,
      permission: ["expenses", "view"],
      run: async (_client, params, actor) => ((await holdsCapability(actor, "expenses.finance")) ? service.list(params, actor.scope) : envelope([], 1, 0)),
      cite: (row) => ({ type: "disbursement", id: row.disbursement_id, label: `${row.number}, ${row.request_number}` }),
    },
  ],
  summaries: [
    {
      key: "disbursements.summary",
      description:
        "Disbursements in figures: transfers, amount paid, references missing, authorised and not yet paid, days to pay, by category, department or payee type, and paid by day, week or month",
      params: c.disbursements.DisbursementSummaryQuery,
      permission: ["expenses", "view"],
      // The figures are only for a holder of `expenses.finance`, as the read's rows are; the service answers anyone else with none.
      run: (client, params, actor) => service.aiSummary(client, params, actor),
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
      fields: ["expense_request_id", "payment_reference", "paid_on", "receipt_document_id", "confirm_without_reference"],
      asks: [
        { field: "expense_request_id", question: "Which request was paid?", read: "expenses.list", params: { status: "authorised" } },
        { field: "paid_on", question: "When was it paid?" },
      ],
      records: (values, _actor, db) => service.cardRequest(db, values.expense_request_id),
      // The receipt a card carries reads by its file's name, never its id (decision 32).
      names: (values, actor, db) => service.cardNames(db, values, actor),
      check: (client, values) => service.assertCardPayable(client, values.expense_request_id),
      run: (values, actor) => service.create(actor, values),
      readback: service.readback("recorded"),
      labels: { expense_request_id: "Request", payment_reference: "Bank Reference", paid_on: "Paid On", receipt_document_id: "Receipt", confirm_without_reference: "Save Without Reference" },
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
  files: [
    {
      kind: "payment_receipt",
      label: "Payment Receipt",
      permission: ["expenses", "create"],
      capability: "expenses.finance",
      question: "Record the payment on this receipt",
      read: (actor, doc, db) => receiptAi.readForChat(actor, doc, db),
      actions: ["disbursements.create"],
    },
  ],
  routes: [{ intent: "record an expense payment", screen: "expenses.disbursements" }],
});
