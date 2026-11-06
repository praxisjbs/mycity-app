"use strict";
/**
 * What an expense request records, who it tells, and how its approval reaches it
 * (docs/guides/expenses.md §7).
 *
 * A request is decided in its approval (`expenses.request`, shared/workflow). The engine already
 * tells the approvers when a request reaches them, the requester when it is decided, and the
 * requester when an approver sends it back (shared/notifications/fanout.js), so this file adds only
 * a withdrawal by an `expenses.finance` holder, which the requester did not make.
 *
 * After commit, each of the approval's moves is copied onto the request, at least once and
 * idempotently (expenses.service settle and sentBack): its end (approved, rejected, or withdrawn
 * from the approvals screen), and a Send Back, which withdraws the approval for its opener and
 * returns the request to its requester.
 */
const { defineEvents, WORKFLOW } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");
const { defineDocumentType } = require("../../shared/documents/types");
const outbox = require("../../shared/events/outbox");
const workflow = require("../../shared/workflow/engine");

const EVENTS = defineEvents("expenses", {
  "expense_request.created": { summary: "An expense request was saved as a draft" },
  "expense_request.updated": { summary: "An expense request was changed" },
  "expense_request.submitted": { summary: "An expense request was sent for approval" },
  "expense_request.approved": { summary: "An expense request was approved by Operations & People" },
  "expense_request.rejected": { summary: "An expense request was rejected" },
  "expense_request.sent_back": { summary: "An expense request was sent back to its requester" },
  "expense_request.cancelled": { summary: "An expense request was cancelled" },
  "expense_request.withdrawn": { summary: "An approved expense request was withdrawn before it was paid" },
});

/** The approval flow every request opens (seeded in 8100; DEFAULTS in shared/workflow/definitions.js). */
const DEFINITION_KEY = "expenses.request";

/** An invoice a request holds, once claimed from the upload engine (shared/documents/vault claim). */
const INVOICE_DOC_TYPE = "expense_invoice";
defineDocumentType(INVOICE_DOC_TYPE, { label: "Expense Invoice", module: "expenses", sensitivity: "normal" });

defineNotification(EVENTS.EXPENSE_REQUEST_WITHDRAWN, {
  to: [{ subject: true }],
  title: (e) => `Request withdrawn: ${e.payload.number}`,
  body: (e) => (e.payload.reason ? `Reason: ${e.payload.reason}` : "Operations & People withdrew it."),
});

/*
 * The service is required when a handler runs, not when this file loads: the service requires
 * this file for its event keys, and the worker loads this file on its own.
 */
const service = () => require("./expenses.service");
const ofRequest = (event) => event.payload && event.payload.definition_key === DEFINITION_KEY && event.entity && event.entity.type === "expense";

workflow.onCompleted(DEFINITION_KEY, "expenses.apply_decision", (event) =>
  service().settle(event.entity.id, event.payload.state, event.payload.instance_id),
);

outbox.register(WORKFLOW.WORKFLOW_CANCELLED, "expenses.apply_withdrawal", (event) =>
  ofRequest(event) ? service().settle(event.entity.id, "cancelled", event.payload.instance_id) : undefined,
);

outbox.register(WORKFLOW.WORKFLOW_CHANGES_REQUESTED, "expenses.sent_back", (event) =>
  ofRequest(event) ? service().sentBack(event.entity.id, event.payload) : undefined,
);

module.exports = { EVENTS, DEFINITION_KEY, INVOICE_DOC_TYPE };
