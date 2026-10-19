"use strict";
/**
 * What the sanctions module records, who it tells, and how an approval's outcome reaches
 * a sanction (docs/guides/queries.md §3 steps 4 to 6, §7). Loaded by the API (through the
 * service) and the worker.
 *
 *   sanction.proposed          a rung was proposed from a query's decision; its approval
 *                              (queries.consequence) tells the first approvers
 *   sanction.issued            the approval approved it: numbered, its letter generated (and
 *                              emailed with the PDF once rendered), any fine pending for
 *                              payroll, the query resolved; the employee is told
 *   sanction.rejected          the approval refused it: the query is back under review; the
 *                              proposer is told
 *   sanction.withdrawn         the approval was withdrawn before a decision
 *   consequence_step.saved     a rung added, moved, changed or retired on Chain Settings
 *   sanction_fine.accepted,    payroll took a fine into a run, settled it, or waived it (M6)
 *   sanction_fine.settled,
 *   sanction_fine.waived
 *
 * After commit the approval's outcome is copied onto the sanction (`settle`), at least once
 * and idempotently: it changes only a sanction still pending.
 */
const c = require("@mycity/contract");
const { defineEvents, WORKFLOW } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");
const { defineVariables } = require("../../shared/templates/variables");
const outbox = require("../../shared/events/outbox");
const vault = require("../../shared/documents/vault");
const workflow = require("../../shared/workflow/engine");
const { SANCTION_LETTER } = require("../templates/templates.events");

const EVENTS = defineEvents("queries", {
  "sanction.proposed": { summary: "A sanction was proposed for approval" },
  "sanction.issued": { summary: "A sanction was issued" },
  "sanction.rejected": { summary: "A proposed sanction was refused" },
  "sanction.withdrawn": { summary: "A proposed sanction was withdrawn" },
  "consequence_step.saved": { summary: "The consequence chain was changed" },
  "sanction_fine.accepted": { summary: "Payroll accepted a fine into a run" },
  "sanction_fine.settled": { summary: "A fine was deducted from pay" },
  "sanction_fine.waived": { summary: "A fine was waived" },
});

/** Who approves a proposed sanction (shared/workflow/definitions.js, seeded in 3190). */
const DEFINITION_KEY = "queries.consequence";

defineVariables("email", "sanction-issued", c.sanctions.SanctionIssuedEmailVars);

defineNotification(EVENTS.SANCTION_ISSUED, {
  to: [{ subject: true }],
  title: "Sanction Issued",
  body: (e) => `${e.payload.step_name}, following ${e.payload.query_number}. The letter is in My Queries.`,
});

defineNotification(EVENTS.SANCTION_REJECTED, {
  to: [{ users: (e) => (e.payload.decided_by ? [e.payload.decided_by] : []) }],
  title: "Sanction Not Approved",
  body: (e) => `${e.payload.step_name} on ${e.payload.query_number} was not approved.`,
});

/** The sanction outcome an approval's end state means. */
const OUTCOME = Object.freeze({
  approved: "issued",
  timeout_approved: "issued",
  rejected: "rejected",
  timeout_rejected: "rejected",
  cancelled: "withdrawn",
});

/*
 * The service is required when a handler runs, not when this file loads: the service
 * requires this file for its event keys, and the worker loads this file on its own.
 */
const settle = (id, outcome) => require("./sanctions.service").settle(id, outcome);

workflow.onCompleted(DEFINITION_KEY, "sanctions.apply_decision", (event) =>
  settle(event.entity.id, OUTCOME[event.payload.state] || null),
);

outbox.register(WORKFLOW.WORKFLOW_CANCELLED, "sanctions.apply_withdrawal", async (event) => {
  if (event.payload.definition_key !== DEFINITION_KEY) return;
  await settle(event.entity.id, "withdrawn");
});

outbox.register(vault.EVENTS.DOCUMENT_GENERATED, "sanctions.letter_email", async (event) => {
  if (event.payload.doc_type !== SANCTION_LETTER) return;
  await require("./sanctions.letters").emailLetter(event.payload.document_id);
});

module.exports = { EVENTS, DEFINITION_KEY, OUTCOME };
