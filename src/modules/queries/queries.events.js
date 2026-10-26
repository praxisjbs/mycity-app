"use strict";
/**
 * What the queries module records, who it tells, and the work after commit
 * (docs/guides/queries.md §7). Loaded by the API (through the service) and the worker.
 *
 *   query.raised      a person or a rule raised a query: the employee is told (opening My
 *                     Queries); the letter, once rendered, is emailed to them as a PDF
 *   query.reminded    Send Reminder: the employee is told again
 *   query.responded   the employee answered: whoever raised it is told, People (scope all)
 *                     when a rule raised it
 *   query.closed      closed with no action: the employee is told
 *
 * Payloads carry ids, numbers and who raised it; never the details or the response.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { defineEvents } = require("../../shared/events/catalogue");
const { defineNotification, permissionHolders } = require("../../shared/notifications/fanout");
const { defineVariables } = require("../../shared/templates/variables");
const outbox = require("../../shared/events/outbox");
const vault = require("../../shared/documents/vault");
const { QUERY_LETTER } = require("../templates/templates.events");
const { defineDocumentType } = require("../../shared/documents/types");

const EVENTS = defineEvents("queries", {
  "query.raised": { summary: "A query was raised" },
  "query.reminded": { summary: "An employee was reminded to answer a query" },
  "query.responded": { summary: "An employee answered a query" },
  "query.closed": { summary: "A query was closed with no action" },
});

defineVariables("email", "query-raised", c.queries.QueryRaisedEmailVars);

defineNotification(EVENTS.QUERY_RAISED, {
  to: [{ subject: true }],
  title: "Query Raised",
  body: (e) => `${e.payload.number}: ${e.payload.subject}. Respond in My Queries.`,
});

defineNotification(EVENTS.QUERY_REMINDED, {
  to: [{ subject: true }],
  title: "Query Reminder",
  body: (e) => `${e.payload.number} is waiting for your response.`,
});

defineNotification(EVENTS.QUERY_RESPONDED, {
  // The raiser; for a query a rule raised, People with scope all (never the team above).
  to: [
    {
      users: async (e, client) =>
        e.payload.raised_by
          ? [e.payload.raised_by]
          : permissionHolders(client || pool, ["queries", "edit"], null),
    },
  ],
  title: "Query Answered",
  body: (e) => `${e.payload.number} has a response.`,
});

defineNotification(EVENTS.QUERY_CLOSED, {
  to: [{ subject: true }],
  title: "Query Closed",
  body: (e) => `${e.payload.number} is closed with no action.`,
});

/*
 * The service is required when a handler runs, not when this file loads: the service
 * requires this file for its event keys, and the worker loads this file on its own.
 */
outbox.register(vault.EVENTS.DOCUMENT_GENERATED, "queries.letter_email", async (event) => {
  if (event.payload.doc_type !== QUERY_LETTER) return;
  await require("./queries.service").emailLetter(event.payload.document_id);
});

/** A drawn signature on a query or a proposed sanction (guide §6.2, §6.4), kept in the vault. */
const SIGNATURE_DOC_TYPE = "query_signature";
defineDocumentType(SIGNATURE_DOC_TYPE, { label: "Query signature", module: "queries", sensitivity: "normal" });

module.exports = { EVENTS, SIGNATURE_DOC_TYPE };
