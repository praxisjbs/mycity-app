"use strict";
/**
 * What a disbursement records and who it tells (docs/guides/expenses.md §7): the requester is told
 * their request was paid; a reference added afterwards is an audit line only.
 */
const { defineEvents } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");
const { defineDocumentType } = require("../../shared/documents/types");

const EVENTS = defineEvents("expenses", {
  "disbursement.recorded": { summary: "A transfer for an expense request was recorded" },
  "disbursement.reference_added": { summary: "A bank reference was added to a transfer saved without one" },
});

/** A transfer's receipt, once claimed from the upload engine (shared/documents/vault claim). */
const RECEIPT_DOC_TYPE = "disbursement_receipt";
defineDocumentType(RECEIPT_DOC_TYPE, { label: "Disbursement Receipt", module: "expenses", sensitivity: "normal" });

defineNotification(EVENTS.DISBURSEMENT_RECORDED, {
  to: [{ subject: true }],
  title: (e) => `Paid: ${e.payload.request_number}`,
  body: (e) => `${e.payload.purpose} was paid.`,
});

module.exports = { EVENTS, RECEIPT_DOC_TYPE };
