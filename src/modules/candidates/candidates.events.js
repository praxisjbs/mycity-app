"use strict";
/**
 * What the candidates module records, and what follows (docs/guides/recruitment.md §6.2 to §6.8,
 * §7). Loaded by the API (through the service) and the worker. Payloads carry ids, numbers and
 * titles; never a CV, an answer or a contact detail.
 *
 *   application.received        Apply committed: application-received to the candidate, a notice to
 *                               the hiring manager
 *   application.invited         Invite to Apply: the link is made here, after commit, and mailed
 *                               (apply-invite); its token never sits in the outbox
 *   application.moved, .reopened   a pipeline move (§6.3); audit
 *   application.hired           M5's onboarding completed (candidates.hireIn); audit
 *   application.not_progressed  candidate-not-progressed to the candidate
 *   application.score_requested Score With AI or Screen With AI: the AI read, one at a time
 *   application.scored          an AI read was kept
 *   recruitment.candidate_email_saved   Candidate Emails: a new wording, or the default restored
 *
 * The service is required when a handler runs, not when this file loads: the service requires this
 * file for its event keys, and the worker loads this file on its own.
 */
const c = require("@mycity/contract");
const { defineEvents } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");
const { defineVariables } = require("../../shared/templates/variables");
const { defineDocumentType } = require("../../shared/documents/types");
const outbox = require("../../shared/events/outbox");

const EVENTS = defineEvents("recruitment", {
  "application.received": { summary: "Someone applied for a vacancy" },
  "application.invited": { summary: "Someone was invited to apply for a vacancy" },
  "application.moved": { summary: "A candidate moved stage" },
  "application.not_progressed": { summary: "A candidate was not progressed" },
  "application.reopened": { summary: "A candidate was reopened" },
  "application.hired": { summary: "A candidate was hired" },
  "application.withdrawn": { summary: "A hire withdrew before completing onboarding" },
  "application.email_corrected": { summary: "A candidate's email address was corrected" },
  "application.score_requested": { summary: "An AI read of an application was asked for" },
  "application.scored": { summary: "An application was scored with AI" },
  "recruitment.candidate_email_saved": { summary: "A candidate email's wording was saved" },
});

/** A CV sent on the Apply form: a stranger's file, quarantined until scanned (guide §6.2). */
const CV_DOC_TYPE = "candidate_cv";
defineDocumentType(CV_DOC_TYPE, { label: "CV", module: "recruitment", sensitivity: "personal" });

/** Where a CV waits between its upload and the application it belongs to (vault.adopt). */
const APPLY_LINK = "apply_link";

/** The candidate emails this module sends, by the template each is (guide §6.8). */
const EMAILS = Object.freeze({
  received: "application-received",
  invite: "apply-invite",
  notProgressed: "candidate-not-progressed",
});
/** The four M5 sends (offers, contracts and onboarding), worded on Candidate Emails with the rest. */
const M5_EMAILS = Object.freeze({
  offerSent: "offer-sent",
  offerSigned: "offer-signed",
  contractSent: "contract-sent",
  onboardingDocuments: "onboarding-documents",
});
defineVariables("email", EMAILS.received, c.candidates.ApplicationReceivedEmailVars);
defineVariables("email", EMAILS.invite, c.candidates.ApplyInviteEmailVars);
defineVariables("email", EMAILS.notProgressed, c.candidates.CandidateNotProgressedEmailVars);
// Candidate Emails edits all nine (guide §6.8), so the nine are declared here, once; the assessments
// and interviews modules, and M5's offers and onboarding, send theirs with these variables and do not
// declare them again.
defineVariables("email", "assessment-invite", c.assessments.AssessmentInviteEmailVars);
defineVariables("email", "interview-invite", c.interviews.InterviewInviteEmailVars);
defineVariables("email", M5_EMAILS.offerSent, c.candidates.OfferSentEmailVars);
defineVariables("email", M5_EMAILS.offerSigned, c.candidates.OfferSignedEmailVars);
defineVariables("email", M5_EMAILS.contractSent, c.candidates.ContractSentEmailVars);
defineVariables("email", M5_EMAILS.onboardingDocuments, c.candidates.OnboardingDocumentsEmailVars);

defineNotification(EVENTS.APPLICATION_RECEIVED, {
  // The vacancy's hiring manager (payload.subject_employee_id).
  to: [{ subject: true }],
  title: "New Application",
  body: (e) => `${e.payload.number} applied for ${e.payload.vacancy_title}.`,
});

const mail = () => require("./candidates.mail");

outbox.register(EVENTS.APPLICATION_RECEIVED, "candidates.mail_received", (event) => mail().received(event));
outbox.register(EVENTS.APPLICATION_INVITED, "candidates.mail_invite", (event) => mail().invite(event));
outbox.register(EVENTS.APPLICATION_NOT_PROGRESSED, "candidates.mail_not_progressed", (event) => mail().notProgressed(event));
outbox.register(EVENTS.APPLICATION_SCORE_REQUESTED, "candidates.score", (event) =>
  require("./candidates.score").scoreOne(event.payload.application_id, event.payload.conditions || null, event.actor_user_id || null, {
    bulk: Boolean(event.payload.bulk),
  }),
);

module.exports = { EVENTS, CV_DOC_TYPE, APPLY_LINK, EMAILS, M5_EMAILS };
