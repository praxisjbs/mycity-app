"use strict";
/**
 * What the policies module records, who it tells, and the work that follows a commit
 * (docs/guides/policies.md §7). Loaded by the API and the worker.
 *
 *   policy.created             HR started a written policy
 *   policy.draft_saved,        a draft saved or discarded: the audit line with before and after;
 *   policy.draft_discarded     nobody is told
 *   policy.submitted           a draft sent for approval: the approval (policy.approval) tells
 *                              its first stage
 *   policy.recalled            a submission taken back before it was decided
 *   policy.rejected            an approver rejected it: the submitter is told why
 *   policy.published           a version published (directly, or on the last approval): everyone
 *                              it applies to is told
 *   policy.withdrawn           a version waiting to start withdrawn: the same people are told
 *   policy.archived            a written policy stopped applying
 *   policy.acknowledged        someone acknowledged a version; their notices about it are read
 *   policy.reminder_due        the reminder engine's policy_unacknowledged found someone who had
 *                              not acknowledged a version 3 days after it was published
 *   policy.pdf_requested       Download PDF: queued through documents.generate, rendered after
 *                              commit and downloaded on the device that asked
 *
 * Payloads carry ids, the number, the version, the title and the first day: never a policy's text.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { defineEvents } = require("../../shared/events/catalogue");
const workflow = require("../../shared/workflow/engine");
const { defineNotification } = require("../../shared/notifications/fanout");
const reminders = require("../notifications/notifications.reminders");
const { defineDocumentType } = require("../../shared/documents/types");
const { defineDocType } = require("../../shared/documents/generate");
const { defineVariables } = require("../../shared/templates/variables");
const vault = require("../../shared/documents/vault");
const { formatDate } = require("../../shared/time/day-first");

const EVENTS = defineEvents("knowledge", {
  "policy.created": { summary: "A written policy was started" },
  "policy.draft_saved": { summary: "A policy's draft was saved" },
  "policy.draft_discarded": { summary: "A policy's draft was discarded" },
  "policy.submitted": { summary: "A policy version was sent for approval" },
  "policy.recalled": { summary: "A policy version was taken back from approval" },
  "policy.rejected": { summary: "A policy version was rejected" },
  "policy.published": { summary: "A policy version was published" },
  "policy.withdrawn": { summary: "A policy version was withdrawn before its first day" },
  "policy.archived": { summary: "A policy was archived" },
  "policy.acknowledged": { summary: "Someone acknowledged a policy version" },
  "policy.reminder_due": { summary: "Someone was reminded to acknowledge a policy" },
  "policy.pdf_requested": { summary: "A policy version's PDF was asked for" },
});

/** The approval a version with Needs Approval on goes through (seeded in 1396). */
const APPROVAL_KEY = "policy.approval";
/** The record a version is, in notices, approvals, search and links. */
const VERSION_ENTITY = "policy_version";
/** A drawn signature, kept in the vault for the version it signs. */
const SIGNATURE_DOC_TYPE = "policy_signature";
/** Download PDF's file: made on demand, kept a day like every export. */
const PDF_DOC_TYPE = "policy_pdf";

defineDocumentType(SIGNATURE_DOC_TYPE, { label: "Policy signature", module: "knowledge", sensitivity: "normal" });
defineDocType(PDF_DOC_TYPE, {
  label: "Policy",
  module: "knowledge",
  template: "policy",
  numbering: null,
  sensitivity: "normal",
  title: (data) => `${data.title}, Version ${data.version}`,
  export: true,
});
defineVariables("document", "policy", c.policies.PolicyDocumentVars);

/** A PDF is for the person who asked for it, and the CEO. */
vault.defineAccess("policy_pdf_request", async (_client, user, doc) =>
  user.is_ceo === true || (Boolean(doc.uploaded_by) && doc.uploaded_by === user.user_id),
);

/*
 * A version is for the people it applies to: they are told when it is published or withdrawn.
 * The repo is required when a notice is written: the worker loads this file first.
 */
const everyoneAsked = (event, client) =>
  require("./policies.repo").askedUsers(
    client || pool,
    event.payload.policy_version_id,
    require("../../shared/time/lagos").today(),
  );

defineNotification(EVENTS.POLICY_PUBLISHED, {
  to: [{ users: everyoneAsked }],
  who: "Everyone the policy applies to",
  title: (e) => (e.payload.version > 1 ? "Policy updated" : "New policy"),
  body: (e) =>
    `${e.payload.title}, Version ${e.payload.version}, applies from ${formatDate(e.payload.effective_from)}.` +
    (e.payload.needs_acknowledgement ? " Read and acknowledge it." : ""),
});

defineNotification(EVENTS.POLICY_WITHDRAWN, {
  to: [{ users: everyoneAsked }],
  who: "Everyone the policy applies to",
  title: "Policy version withdrawn",
  body: (e) => `${e.payload.title}, Version ${e.payload.version}, will not apply from ${formatDate(e.payload.effective_from)}.`,
});

defineNotification(EVENTS.POLICY_REJECTED, {
  to: [{ users: (e) => (e.payload.submitted_by ? [e.payload.submitted_by] : []) }],
  who: "Whoever submitted the version",
  title: "Policy not approved",
  body: (e) => `${e.payload.title}: ${e.payload.reason}`,
});

defineNotification(EVENTS.POLICY_REMINDER_DUE, {
  to: [{ subject: true }],
  title: "Acknowledge a policy",
  body: (e) => `${e.payload.title}, Version ${e.payload.version}, is waiting for your acknowledgement.`,
});

/*
 * The reminder (guide §6.7) runs on the one reminder engine (docs/guides/notifications.md §7.1):
 * from 3 days after a version is published, once a person, in the working day. The service is
 * required when the engine calls it: it requires this file for its event keys.
 */
reminders.defineReminder("policy_unacknowledged", {
  event: EVENTS.POLICY_REMINDER_DUE,
  module: "knowledge",
  find: (db, ctx) => require("./policies.service").remindersDue(db, ctx),
  check: (client, row, ctx) => require("./policies.service").reminderCheck(client, row, ctx),
});

/*
 * When an approval ends, its outcome is applied to the submission: approved publishes it,
 * rejected or timed out returns it to the draft. The service requires this file for its keys.
 */
workflow.onCompleted(APPROVAL_KEY, "policies.apply_approval", (event) =>
  require("./policies.service").settleApproval(event),
);

module.exports = { EVENTS, APPROVAL_KEY, VERSION_ENTITY, SIGNATURE_DOC_TYPE, PDF_DOC_TYPE };
