"use strict";
/**
 * What the assessments module records, and what follows (docs/guides/recruitment.md §6.7, §7).
 * Loaded by the API (through the service) and the worker. Payloads carry ids, codes and names;
 * never an answer, a mark's reason or a key.
 *
 *   assessment.created, .updated, .questions_saved, .activated, .deactivated, .imported   the library
 *   assessment.sent        Send or Send to Candidates: the link is made here, after commit, and
 *                          mailed (assessment-invite); its token never sits in the outbox
 *   assessment.started     the candidate pressed Start
 *   assessment.submitted, assessment.timed_out   the sitting ended; a notice to the hiring manager
 *                          when answers wait to be marked
 *   assessment.expired, assessment.cancelled     it never started, or staff stopped it
 *   assessment.marked, assessment.scored         marks given; the sitting's score kept
 *   assessment.to_mark     a finished sitting has written or file answers to mark: a notice to the
 *                          vacancy's hiring manager (no candidate name in it)
 *
 * The assessment-invite email's variables are declared by the candidates module, which edits all
 * five candidate emails (candidates.events.js).
 */
const { defineEvents } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");
const { defineDocumentType } = require("../../shared/documents/types");
const outbox = require("../../shared/events/outbox");

const EVENTS = defineEvents("recruitment", {
  "assessment.created": { summary: "An assessment was written" },
  "assessment.updated": { summary: "An assessment was changed" },
  "assessment.questions_saved": { summary: "An assessment's questions were saved" },
  "assessment.activated": { summary: "An assessment was switched on" },
  "assessment.deactivated": { summary: "An assessment was switched off" },
  "assessment.imported": { summary: "An assessment was imported from a file" },
  "assessment.sent": { summary: "An assessment was sent to a candidate" },
  "assessment.started": { summary: "A candidate started an assessment" },
  "assessment.submitted": { summary: "A candidate submitted an assessment" },
  "assessment.timed_out": { summary: "An assessment ran out of time" },
  "assessment.expired": { summary: "An assessment was never started" },
  "assessment.cancelled": { summary: "An assessment sitting was cancelled" },
  "assessment.marked": { summary: "Answers of an assessment were marked" },
  "assessment.scored": { summary: "An assessment sitting was scored" },
  "assessment.to_mark": { summary: "A finished assessment has answers to mark" },
});

/** A candidate's file answer: a stranger's file, quarantined until scanned (guide §6.7). */
const ANSWER_DOC_TYPE = "assessment_answer";
defineDocumentType(ANSWER_DOC_TYPE, { label: "Assessment Answer", module: "recruitment", sensitivity: "personal" });

/** The one thing an assessment link does (public_token scope); its subject is the sitting. */
const SCOPE = "assessment.take";
const SUBJECT = "application_assessment";

defineNotification(EVENTS.ASSESSMENT_TO_MARK, {
  // The vacancy's hiring manager (payload.subject_employee_id).
  to: [{ subject: true }],
  title: "Answers to Mark",
  body: (e) => `${e.payload.application_number} finished ${e.payload.assessment_name}. Mark their answers.`,
});

outbox.register(EVENTS.ASSESSMENT_SENT, "assessments.mail_invite", (event) => require("./assessments.mail").invite(event));

module.exports = { EVENTS, ANSWER_DOC_TYPE, SCOPE, SUBJECT };
