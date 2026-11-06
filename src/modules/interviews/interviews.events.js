"use strict";
/**
 * What the interviews module records, and what follows (docs/guides/recruitment.md §6.6, §7). Loaded
 * by the API (through the service) and the worker. Payloads carry ids and numbers; never a rating, a
 * comment or a note, so the audit and the outbox keep the panel blind too.
 *
 *   interview.scheduled, .rescheduled, .cancelled   the candidate's invitation, change or cancel, with
 *                          the .ics (interview-invite); the panelists hear through their calendar
 *                          entry (calendar.invitations). A change of panel alone is not sent to the
 *                          candidate.
 *   interview.details_saved   Candidate Details, filled once for the panel
 *   interview.feedback_submitted, interview.round_closed, interview.reported   the card, the close,
 *                          the report (the Interview Assessment Form is made in the same save)
 *   interview.feedback_due   the daily reminder to a panelist who has not submitted
 *
 * application.not_progressed (candidates): the application's scheduled interviews are cancelled and
 * everyone is told, as a cancel from Interviews would (guide §6.3).
 */
const c = require("@mycity/contract");
const { defineEvents } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");
const { defineVariables } = require("../../shared/templates/variables");
const { defineDocType } = require("../../shared/documents/generate");
const outbox = require("../../shared/events/outbox");
const vault = require("../../shared/documents/vault");
const { scopeFor } = require("../../middleware/rbac");

const EVENTS = defineEvents("recruitment", {
  "interview.scheduled": { summary: "An interview was scheduled" },
  "interview.rescheduled": { summary: "An interview was changed" },
  "interview.cancelled": { summary: "An interview was cancelled" },
  "interview.details_saved": { summary: "An interview's Candidate Details were saved" },
  "interview.feedback_submitted": { summary: "A panelist submitted their card" },
  "interview.round_closed": { summary: "An interview round was closed" },
  "interview.reported": { summary: "An interview round's report was written" },
  "interview.feedback_due": { summary: "A panelist was reminded to submit their card" },
});

/** The Interview Assessment Form (guide §6.6). */
const FORM_DOC_TYPE = "interview_assessment_form";

/**
 * Who opens an interview's file (its Interview Assessment Form): whoever may read the interview
 * itself, the panel and the role's hiring manager included, as the sheet's own read decides
 * (interviews.service `sees`), and the CEO. Without this rule only a reader of every vacancy could.
 */
vault.defineAccess("interview", async (client, user, doc) => {
  if (user.is_ceo === true) return true;
  const row = await require("./interviews.repo").get(client, doc.entity_id, user.employee_id || null);
  if (!row) return false;
  const scope = await scopeFor(user, "recruitment", "view");
  return Boolean(scope) && require("./interviews.service").sees(scope, row);
});
defineDocType(FORM_DOC_TYPE, {
  label: "Interview Assessment Form",
  module: "recruitment",
  template: "interview-assessment-form",
  numbering: null,
  sensitivity: "personal",
  title: (data) => `Interview Assessment: ${data.candidate_name}`,
});
defineVariables("document", "interview-assessment-form", c.interviews.InterviewAssessmentFormVars);

defineNotification(EVENTS.INTERVIEW_ROUND_CLOSED, {
  // The vacancy's hiring manager (payload.subject_employee_id): the report is theirs to write now.
  to: [{ subject: true }],
  title: "Round Closed",
  body: (e) => `The panel's cards for ${e.payload.application_number}, ${e.payload.vacancy_title}, are in. Write the report.`,
});

defineNotification(EVENTS.INTERVIEW_FEEDBACK_DUE, {
  // The panelist (payload.subject_employee_id).
  to: [{ subject: true }],
  title: "Interview Card Due",
  body: (e) => `Your card for ${e.payload.application_number}, ${e.payload.vacancy_title}, is not submitted yet.`,
});

const schedule = () => require("./interviews.schedule");

outbox.register(EVENTS.INTERVIEW_SCHEDULED, "interviews.mail_candidate", (event) => schedule().mailCandidate(event));
outbox.register(EVENTS.INTERVIEW_RESCHEDULED, "interviews.mail_candidate", (event) => schedule().mailCandidate(event));
outbox.register(EVENTS.INTERVIEW_CANCELLED, "interviews.mail_candidate", (event) => schedule().mailCandidate(event));
outbox.register("application.not_progressed", "interviews.cancel_for_application", (event) =>
  schedule().cancelForApplication(event.payload.application_id, event.actor_user_id || null),
);

module.exports = { EVENTS, FORM_DOC_TYPE };
