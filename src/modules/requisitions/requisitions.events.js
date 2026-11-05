"use strict";
/**
 * What a requisition records, who it tells, and how the CEO's decision reaches it
 * (docs/guides/expenses.md §7).
 *
 * A requisition is decided in its approval (`expenses.requisition`, the CEO). The engine tells the
 * CEO when it arrives and whoever grouped it when it is decided; this file adds the CEO taking a
 * request out of it, which the request's requester and whoever grouped it are told of.
 *
 * After commit the CEO's decision is copied onto the requisition and every request it holds
 * (requisitions.service settle), at least once and idempotently.
 */
const { defineEvents, WORKFLOW } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");
const outbox = require("../../shared/events/outbox");
const workflow = require("../../shared/workflow/engine");

const EVENTS = defineEvents("expenses", {
  "requisition.submitted": { summary: "Approved expense requests were grouped into a requisition for the CEO" },
  "requisition.request_removed": { summary: "The CEO took a request out of a requisition" },
  "requisition.approved": { summary: "The CEO approved a requisition" },
  "requisition.rejected": { summary: "The CEO rejected a requisition" },
  "requisition.cancelled": { summary: "A requisition was cancelled: no request was left in it" },
});

/** The approval every requisition opens (seeded in 8100; DEFAULTS in shared/workflow/definitions.js). */
const DEFINITION_KEY = "expenses.requisition";

defineNotification(EVENTS.REQUISITION_REQUEST_REMOVED, {
  to: [{ subject: true }, { users: (e) => [e.payload.grouped_by].filter(Boolean) }],
  title: (e) => `Removed from requisition: ${e.payload.request_number}`,
  body: (e) => `Reason: ${e.payload.reason}`,
});

const service = () => require("./requisitions.service");

workflow.onCompleted(DEFINITION_KEY, "requisitions.apply_decision", (event) =>
  service().settle(event.entity.id, event.payload.state),
);

outbox.register(WORKFLOW.WORKFLOW_CANCELLED, "requisitions.apply_withdrawal", (event) =>
  event.payload.definition_key === DEFINITION_KEY ? service().settle(event.entity.id, "cancelled") : undefined,
);

module.exports = { EVENTS, DEFINITION_KEY };
