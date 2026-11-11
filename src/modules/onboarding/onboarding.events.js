"use strict";
/**
 * What the onboarding module records (docs/guides/offers.md §7). Loaded by the API (through the
 * service) and the worker. Payloads carry ids and who to tell; never a document, a link or the BVN.
 *
 *   onboarding.opened                  the offer was accepted: the hire's case opens at documentation
 *                                      with its checklist, in the acceptance transaction (guide §3
 *                                      step 5). The outbox then mails `onboarding-documents` with
 *                                      the Upload Documents link, made there (onboarding.upload.js)
 *   onboarding.link_sent               Send Reminder: a fresh link, every earlier one stopped
 *   onboarding.privacy_acknowledged    the hire accepted the privacy notice on the upload page
 *   onboarding.item_uploaded           the hire sent an item (a file, a typed value or both)
 *   onboarding.item_verified, .item_rejected        Operations & People checked it
 *   onboarding.guarantor_saved         the hire entered or corrected a guarantor
 *   onboarding.guarantor_checked       a guarantor's reference check was recorded Passed or Failed
 *   onboarding.bvn_entered             the hire entered their BVN (kept on the employee, masked)
 *   onboarding.documentation_completed every required item verified, both guarantors passed, the BVN
 *                                      entered and the contract signed: the case is at pre-onboarding
 *   onboarding.requirement_saved, .plan_saved       the Checklist and Plans settings
 *
 * application.not_progressed (candidates): the case's Upload Documents links stop working.
 */
const { defineEvents } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");
const outbox = require("../../shared/events/outbox");

const EVENTS = defineEvents("recruitment", {
  "onboarding.opened": { summary: "An onboarding case was opened for a hire" },
  "onboarding.link_sent": { summary: "A hire's Upload Documents link was sent again" },
  "onboarding.privacy_acknowledged": { summary: "A hire accepted the privacy notice" },
  "onboarding.item_uploaded": { summary: "A hire sent a document" },
  "onboarding.item_verified": { summary: "A hire's document was verified" },
  "onboarding.item_rejected": { summary: "A hire's document was rejected" },
  "onboarding.guarantor_saved": { summary: "A hire entered a guarantor" },
  "onboarding.guarantor_checked": { summary: "A guarantor's reference check was recorded" },
  "onboarding.bvn_entered": { summary: "A hire entered their BVN" },
  "onboarding.documentation_completed": { summary: "A hire's documentation was completed" },
  "onboarding.requirement_saved": { summary: "A document requirement was saved" },
  "onboarding.plan_saved": { summary: "An onboarding plan was saved" },
});

/** The record type a case's events are about (shared/route-map.js `onboarding`). */
const ENTITY = "onboarding";
/** The public link's one action (shared/tokens/public-token), and the record it is for. */
const SCOPE = "onboarding.upload";
const SUBJECT = "onboarding_case";

/** The Candidate Email this module sends; its variables are declared by candidates.events.js. */
const EMAILS = Object.freeze({ documents: "onboarding-documents" });

const owner = (e) => (e.payload.owner_user_id ? [e.payload.owner_user_id] : []);

defineNotification(EVENTS.ONBOARDING_OPENED, {
  to: [{ users: owner }],
  title: "Onboarding Opened",
  body: (e) => `${e.payload.employee_name} accepted their offer. Their documents are now due.`,
});

defineNotification(EVENTS.ONBOARDING_ITEM_UPLOADED, {
  to: [{ users: owner }],
  title: "Document Received",
  body: (e) => `${e.payload.employee_name} sent ${e.payload.title}.`,
});

defineNotification(EVENTS.ONBOARDING_GUARANTOR_SAVED, {
  to: [{ users: owner }],
  title: "Guarantor Entered",
  body: (e) => `${e.payload.employee_name} entered a guarantor to check.`,
});

defineNotification(EVENTS.ONBOARDING_DOCUMENTATION_COMPLETED, {
  to: [{ users: owner }],
  title: "Documentation Complete",
  body: (e) => `${e.payload.employee_name} is ready for pre-onboarding.`,
});

outbox.register(EVENTS.ONBOARDING_OPENED, "onboarding.mail_documents", (event) =>
  require("./onboarding.upload").sendLink(event.payload.onboarding_case_id, event.actor_user_id || null),
);

outbox.register("application.not_progressed", "onboarding.stop_links", (event) =>
  require("./onboarding.upload").stopLinks(event.payload.application_id),
);

module.exports = { EVENTS, ENTITY, SCOPE, SUBJECT, EMAILS };
