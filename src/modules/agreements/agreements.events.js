"use strict";
/**
 * What the agreements module records, and what follows (docs/guides/partnerships.md §6.8, §6.9, §7).
 * Loaded by the API (through the service) and the worker. Payloads carry ids, numbers and who to
 * tell; never a link, a code or an amount.
 *
 *   agreement.generated           Generate Agreement filled a Draft from its category's template
 *   agreement.updated             a Draft's wording, values or term changed
 *   agreement.submitted           Submit for Approval opened `partnership.agreement` (review)
 *   agreement.advanced            the first stage approved; a later one waits (approval)
 *   agreement.approved            every stage approved: it may be sent for signature
 *   agreement.returned            back to Draft: rejected, changes asked for, or the approval withdrawn
 *   agreement.sent                Send for Signature or Send Again: its signers were mailed their links
 *   agreement.viewed              its first signer opened the signing page
 *   agreement.partner_signed      the partner signed; MyCity's countersignature waits
 *   agreement.signed              the last signature, or Record Signed Copy: signed and locked
 *   agreement.sealed              the sealed copy is stored, hashed and among the partner's documents
 *   agreement.signature_ended     a signer declined, or signing lapsed: back to sent, with Send Again
 *   agreement.activated           the daily job, on its start
 *   agreement.expiring            the daily job, at its notice date
 *   agreement.renewal_due         the renewal reminder: at the notice date, then nearer its end
 *   agreement.renewed             the next agreement was signed
 *   agreement.closed              Close Agreement, with its reason
 *
 * The agreement is a doc type with wording of its own (generate.js ownWording): its PDF is its edited
 * Markdown in the letterhead, and once sealed, every signature, the certificate and the QR. It is
 * signed through the shared signatures service (defineSignable("partnership_agreement")). The
 * services are required when a handler runs, not when this file loads.
 */
const c = require("@mycity/contract");
const { defineEvents } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");
const { defineVariables } = require("../../shared/templates/variables");
const { defineDocType } = require("../../shared/documents/generate");
const outbox = require("../../shared/events/outbox");
const vault = require("../../shared/documents/vault");
const workflow = require("../../shared/workflow/engine");
const { WORKFLOW } = require("../../shared/events/catalogue");
const reminders = require("../notifications/notifications.reminders");
const signatures = require("../signatures/signatures.service");
const { EVENTS: SIGNATURE_EVENTS } = require("../signatures/signatures.events");

const EVENTS = defineEvents("partnerships", {
  "agreement.generated": { summary: "An agreement was generated from its category's template" },
  "agreement.updated": { summary: "A draft agreement was changed" },
  "agreement.submitted": { summary: "An agreement was submitted for approval" },
  "agreement.advanced": { summary: "An agreement's first approval stage approved it" },
  "agreement.approved": { summary: "An agreement was approved" },
  "agreement.returned": { summary: "An agreement came back to draft from its approval" },
  "agreement.sent": { summary: "An agreement was sent for signature" },
  "agreement.viewed": { summary: "An agreement's signing page was opened" },
  "agreement.partner_signed": { summary: "A partner signed an agreement; MyCity's signature waits" },
  "agreement.signed": { summary: "An agreement was signed" },
  "agreement.sealed": { summary: "A signed agreement was sealed and filed with the partner's documents" },
  "agreement.signature_ended": { summary: "An agreement's signing was declined or lapsed" },
  "agreement.activated": { summary: "A signed agreement's term began" },
  "agreement.expiring": { summary: "An agreement reached its renewal notice date" },
  "agreement.renewal_due": { summary: "An expiring agreement is due for renewal" },
  "agreement.renewed": { summary: "An agreement was renewed by the next one's signing" },
  "agreement.closed": { summary: "An agreement was closed" },
});

/** The approval an agreement goes through (shared/workflow/definitions.js DEFAULTS, seeded in 7190). */
const FLOW = "partnership.agreement";
/** The record type: events, the vault and the signatures service name an agreement so. */
const ENTITY = "agreement";
/** The signable (signatures.defineSignable). */
const SUBJECT = "partnership_agreement";
/** The PDF: its own wording in the letterhead (shared/documents/generate.js ownWording). */
const DOC_TYPE = "partnership_agreement";
/** A signer's link (templates/email/agreement-sign.html). */
const EMAILS = Object.freeze({ sign: "agreement-sign" });
/** The renewal reminder (§7). */
const RENEWAL_REMINDER = "agreement_renewal";

defineDocType(DOC_TYPE, {
  label: "Partnership Agreement",
  module: "partnerships",
  // Each agreement names its category's template and is rendered from its own wording.
  template: "partnership-agreement",
  templateChoice: true,
  ownWording: true,
  heading: false,
  numbering: null,
  sensitivity: "normal",
  signable: true,
  title: (d) => (d.agreement ? d.agreement.title : "Partnership Agreement"),
  sealing: (d) => d.sealing || null,
});
defineVariables("email", EMAILS.sign, c.agreements.AgreementSignEmailVars);

const service = () => require("./agreements.service");
const lifecycle = () => require("./agreements.lifecycle");
const signing = () => require("./agreements.signing");
const renewals = () => require("./agreements.renewals");

// An agreement's file opens for whoever sees the agreement: it follows its deal (§6.1).
vault.defineAccess(ENTITY, (client, user, doc) => service().mayOpenFile(client, user, doc));

signatures.defineSignable(SUBJECT, {
  document_type: "agreement",
  letter: (db, id) => signing().letterOf(db, id),
  blocks: (db, id) => signing().blocksOf(db, id),
  contentHash: (db, id) => signing().contentHashOf(db, id),
  seal: (client, ctx) => signing().sealIn(client, ctx),
  onSigned: (client, ctx) => signing().signedOneIn(client, ctx),
  onCompleted: (client, ctx) => signing().completedIn(client, ctx),
  onDeclined: (client, ctx) => signing().endedIn(client, { ...ctx, status: "declined" }),
  onEnded: (client, ctx) => signing().endedIn(client, ctx),
  recordStatus: (db, id) => signing().recordStatusOf(db, id),
  sealedTo: (db, id) => signing().sealedTo(db, id),
});

/* ------------------------------------------------------------------ *
 * Who is told
 * ------------------------------------------------------------------ */

const owner = (e) => (e.payload.owner_user_id ? [e.payload.owner_user_id] : []);

defineNotification(EVENTS.AGREEMENT_APPROVED, {
  to: [{ users: owner }],
  title: "Agreement Approved",
  body: (e) => `${e.payload.number} for ${e.payload.record_name} is approved. Send it for signature.`,
});

defineNotification(EVENTS.AGREEMENT_RETURNED, {
  to: [{ users: owner }],
  title: "Agreement Returned",
  body: (e) => `${e.payload.number} for ${e.payload.record_name} came back to draft.`,
});

defineNotification(EVENTS.AGREEMENT_PARTNER_SIGNED, {
  to: [{ users: owner }],
  title: "Partner Signed",
  body: (e) => `${e.payload.record_name} signed ${e.payload.number}. MyCity's signature waits.`,
});

defineNotification(EVENTS.AGREEMENT_SIGNED, {
  to: [{ users: owner }],
  title: "Agreement Signed",
  body: (e) => `${e.payload.number} for ${e.payload.record_name} is signed by everyone.`,
});

defineNotification(EVENTS.AGREEMENT_SIGNATURE_ENDED, {
  to: [{ users: owner }],
  title: (e) => (e.payload.status === "declined" ? "Signature Declined" : "Signing Lapsed"),
  body: (e) =>
    e.payload.status === "declined"
      ? `${e.payload.number} for ${e.payload.record_name} was declined. Send it again when it is corrected.`
      : `${e.payload.number} for ${e.payload.record_name} was not signed in time. Send it again.`,
});

defineNotification(EVENTS.AGREEMENT_RENEWAL_DUE, {
  to: [{ users: owner }],
  title: "Renewal Due",
  body: (e) => `${e.payload.number} for ${e.payload.record_name} ends on ${e.payload.ends_on_day}. Renew it or close it.`,
  priority: "high",
});

/* ------------------------------------------------------------------ *
 * The approval, the signing page and the seal
 * ------------------------------------------------------------------ */

const ofAgreement = (event) => event.payload && event.payload.definition_key === FLOW && event.entity && event.entity.type === ENTITY;

workflow.onCompleted(FLOW, "agreements.settle_approval", (event) =>
  lifecycle().settleApproval(event.entity.id, {
    state: event.payload.state,
    reason: event.payload.reason || null,
    instance_id: event.payload.instance_id,
  }),
);

outbox.register(WORKFLOW.WORKFLOW_ADVANCED, "agreements.approval_advanced", (event) =>
  ofAgreement(event) ? lifecycle().advanced(event.entity.id, event.payload.instance_id) : undefined,
);

outbox.register(WORKFLOW.WORKFLOW_CHANGES_REQUESTED, "agreements.sent_back", (event) =>
  ofAgreement(event) ? lifecycle().sentBack(event.entity.id, event.payload) : undefined,
);

outbox.register(WORKFLOW.WORKFLOW_CANCELLED, "agreements.approval_withdrawn", (event) =>
  ofAgreement(event) ? lifecycle().settleApproval(event.entity.id, { state: "cancelled", reason: event.payload.reason || null, instance_id: event.payload.instance_id }) : undefined,
);

// The first opening of a signing link: Viewed (never by hand).
outbox.register(SIGNATURE_EVENTS.SIGNATURE_VIEWED, "agreements.viewed", (event) => signing().viewed(event.payload.signature_request_id));

// The sealed copy is stored and hashed: kept as the signed document, and among the partner's documents.
outbox.register(SIGNATURE_EVENTS.SIGNATURE_SEALED, "agreements.sealed", (event) =>
  event.payload.subject_type === SUBJECT ? signing().sealed(event.payload.subject_id, event.payload.document_id) : undefined,
);

reminders.defineReminder(RENEWAL_REMINDER, {
  event: EVENTS.AGREEMENT_RENEWAL_DUE,
  module: "partnerships",
  find: (db, ctx) => renewals().remindersDue(db, ctx),
  check: (client, row, ctx) => renewals().reminderCheck(client, row, ctx),
});

module.exports = { EVENTS, FLOW, ENTITY, SUBJECT, DOC_TYPE, EMAILS, RENEWAL_REMINDER };
