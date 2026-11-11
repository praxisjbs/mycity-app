"use strict";
/**
 * What the offers module records, and what follows (docs/guides/offers.md §3, §7). Loaded by the API
 * (through the service) and the worker. Payloads carry ids, numbers and who to tell; never an amount
 * or a link.
 *
 *   offer.created, offer.updated   a draft written or changed
 *   offer.submitted                Submit for Approval opened the `recruitment.offer` flow
 *   offer.approved                 the flow approved it: the letter is generated and its signature
 *                                  request opened (the Offer Signatory first, the candidate second);
 *                                  the signatory is told it waits for them
 *   offer.rejected                 the flow rejected it: back to draft with the reason; the owner is told
 *   offer.sent, offer.resent       Send Offer and Resend (the email is queued by the service after
 *                                  commit, with a link made then; the link never sits in the outbox)
 *   offer.accepted                 the candidate signed: the last signature of its request
 *   offer.declined, offer.expired, offer.withdrawn   ended; the application may take a new offer
 *
 * The approval's outcome (workflow.completed for `recruitment.offer`) settles the offer.
 * application.not_progressed (candidates): the application's open offer is withdrawn and its links
 * stop working.
 *
 * The offer letter is a doc type of its own, signed through the signatures service
 * (defineSignable("offer")): the standard wording, then Additional Terms and Schedule A, and once
 * sealed the signatures, the Signature Certificate and the QR.
 */
const c = require("@mycity/contract");
const { defineEvents } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");
const { defineVariables } = require("../../shared/templates/variables");
const { defineDocType } = require("../../shared/documents/generate");
const outbox = require("../../shared/events/outbox");
const workflow = require("../../shared/workflow/engine");
const signatures = require("../signatures/signatures.service");
const render = require("./offers.render");

const EVENTS = defineEvents("recruitment", {
  "offer.created": { summary: "An offer was drafted" },
  "offer.updated": { summary: "A draft offer was changed" },
  "offer.submitted": { summary: "An offer was submitted for approval" },
  "offer.approved": { summary: "An offer was approved" },
  "offer.rejected": { summary: "An offer was returned by its approval" },
  "offer.sent": { summary: "An offer was sent to the candidate" },
  "offer.resent": { summary: "An offer's link was sent again" },
  "offer.accepted": { summary: "A candidate accepted and signed an offer" },
  "offer.declined": { summary: "A candidate declined an offer" },
  "offer.expired": { summary: "An offer expired unsigned" },
  "offer.withdrawn": { summary: "An offer was withdrawn" },
});

/** The approval an offer goes through (shared/workflow/definitions.js DEFAULTS, seeded in 5299). */
const FLOW = "recruitment.offer";

/** The offer letter (guide §3 steps 3 and 5). */
const DOC_TYPE = "offer_letter";

/** The emails this module sends: worded on Candidate Emails, their variables declared by candidates.events.js. */
const EMAILS = Object.freeze({ sent: "offer-sent", signed: "offer-signed" });

defineDocType(DOC_TYPE, {
  label: "Offer Letter",
  module: "recruitment",
  template: render.TEMPLATE,
  numbering: null,
  sensitivity: "personal",
  signable: true,
  title: (d) => `Offer of Employment: ${d.candidate.full_name}`,
  letter: (d) => ({ date: d.date, to: [d.candidate.full_name, `By email: ${d.candidate.email}`] }),
  appendix: (d) => render.appendixOf(d),
  sealing: (d) => d.sealing || null,
});
defineVariables("document", render.TEMPLATE, c.offers.OfferLetterVars);

const service = () => require("./offers.service");

signatures.defineSignable("offer", {
  document_type: DOC_TYPE,
  letter: (db, offerId) => service().letterOf(db, offerId),
  contentHash: (db, offerId) => service().contentHashOf(db, offerId),
  seal: (client, ctx) => service().sealIn(client, ctx),
  onCompleted: (client, ctx) => service().acceptedIn(client, ctx),
  sealedMailFor: (db, ctx) => service().sealedMailFor(db, ctx),
  onDeclined: (client, ctx) => service().declinedIn(client, ctx),
  onEnded: (client, ctx) => service().endedIn(client, ctx),
});

const owner = (e) => (e.payload.owner_user_id ? [e.payload.owner_user_id] : []);

defineNotification(EVENTS.OFFER_APPROVED, {
  to: [{ users: (e) => [...owner(e), ...(e.payload.signatory_user_id ? [e.payload.signatory_user_id] : [])] }],
  title: "Offer Approved",
  body: (e) => `${e.payload.number} for ${e.payload.candidate_name} is approved. It waits for the company's signature.`,
});

defineNotification(EVENTS.OFFER_REJECTED, {
  to: [{ users: owner }],
  title: "Offer Returned",
  body: (e) => `${e.payload.number} for ${e.payload.candidate_name} was returned to draft.`,
});

defineNotification(EVENTS.OFFER_ACCEPTED, {
  to: [{ users: owner }],
  title: "Offer Accepted",
  body: (e) => `${e.payload.candidate_name} accepted and signed ${e.payload.number}.`,
});

defineNotification(EVENTS.OFFER_DECLINED, {
  to: [{ users: owner }],
  title: "Offer Declined",
  body: (e) => `${e.payload.candidate_name} declined ${e.payload.number}.`,
});

defineNotification(EVENTS.OFFER_EXPIRED, {
  to: [{ users: owner }],
  title: "Offer Expired",
  body: (e) => `${e.payload.number} for ${e.payload.candidate_name} expired unsigned.`,
});

workflow.onCompleted(FLOW, "offers.settle_approval", (event) =>
  service().settleApproval(event.entity.id, {
    state: event.payload.state,
    reason: event.payload.reason || null,
    instance_id: event.payload.instance_id,
    actor_user_id: event.actor_user_id || null,
  }),
);

outbox.register("application.not_progressed", "offers.withdraw_for_application", (event) =>
  service().withdrawForApplication(event.payload.application_id, event.actor_user_id || null),
);

module.exports = { EVENTS, FLOW, DOC_TYPE, EMAILS };
