"use strict";
/**
 * What the reviews module records, who it tells, and what it does after a commit
 * (docs/guides/performance.md §6.12, §6.16, §6.17, §7).
 *
 *   a round opens           each person is told their check-in is due, and reminded before it
 *   a check-in comes in     the reviewer is told; a dotted manager is asked for input
 *   the reviewer submits    the approval engine tells the second level, then Operations & People
 *   the review closes       the PDF is made, the scorecard's score and rating are written, the
 *                           employee is told (and M3 reads the rating from the event)
 *   a probation is ending   a probation review opens for the person's line manager
 *   a PIP starts or closes  the employee and their reviewer are told
 *
 * The approval's outcome (performance.review) is settled here as an outbox handler: approved closes
 * the review, refused returns it to the reviewer with the reason. Its stage moving on (second level
 * to Operations & People) and an engine Request Changes (which would send it back to the second
 * level, not to the reviewer) are handled too, so the review's stage always matches its approval.
 * The services are required when a handler runs: they require this file for its event keys.
 */
const c = require("@mycity/contract");
const { defineEvents, WORKFLOW } = require("../../shared/events/catalogue");
const outbox = require("../../shared/events/outbox");
const workflow = require("../../shared/workflow/engine");
const { defineNotification } = require("../../shared/notifications/fanout");
const { defineDocumentType } = require("../../shared/documents/types");
const { defineDocType } = require("../../shared/documents/generate");
const { defineVariables } = require("../../shared/templates/variables");
const vault = require("../../shared/documents/vault");
const { formatDate } = require("../../shared/time/day-first");
const reminders = require("../notifications/notifications.reminders");
const { loginsOf } = require("../tasks/tasks.events");

const REVIEW_FLOW = "performance.review";

const EVENTS = defineEvents("performance", {
  "review_round.opened": { summary: "A month's review round opened, with a review for each binding scorecard" },
  "review_round.closed": { summary: "A month's review round was closed" },
  "review.opened": { summary: "A probation review opened" },
  "review.check_in_due": { summary: "A check-in is due" },
  "review.check_in_saved": { summary: "An employee saved their check-in" },
  "review.check_in_submitted": { summary: "An employee submitted their check-in" },
  "review.evidence_added": { summary: "A file was added as evidence to a check-in" },
  "review.dictated": { summary: "A spoken answer was recorded and transcribed" },
  "review.scores_saved": { summary: "A reviewer saved scores and corrective actions" },
  "review.review_due": { summary: "A review is waiting for its reviewer" },
  "review.input_asked": { summary: "A dotted-line manager was asked for input" },
  "review.input_given": { summary: "A dotted-line manager gave input" },
  "review.submitted": { summary: "A reviewer submitted a review" },
  "review.returned": { summary: "A review was returned: to the reviewer, or a check-in to the employee" },
  "review.advanced": { summary: "A review moved to Operations & People" },
  "review.close_due": { summary: "A review is waiting for Operations & People to close it" },
  "review.closed": { summary: "A review was closed, with its score and rating" },
  "review.conduct_marked": { summary: "A confirmed conduct breach was marked on a review" },
  "review.outcome_set": { summary: "A probation review's outcome was chosen" },
  "probation.decided": { summary: "A probation review closed with its outcome" },
  "improvement_plan.started": { summary: "An improvement plan was started" },
  "improvement_plan.changed": { summary: "An improvement plan was changed" },
  "improvement_plan.closed": { summary: "An improvement plan was closed with its outcome" },
  "improvement_plan.review_due": { summary: "An improvement plan's review date is near" },
  "key_result.report_due": { summary: "A function's key results are still to be reported for the month" },
});

/* ------------------------------------------------------------------ *
 * Notices
 * ------------------------------------------------------------------ */

const month = (e) => e.payload.round_name || "This month's";

defineNotification(EVENTS.REVIEW_ROUND_OPENED, {
  to: [{ users: (e, client) => loginsOf(client, e.payload.employee_ids || []) }],
  who: "Everyone with a review in the round",
  title: (e) => `Your ${e.payload.round_name} check-in is open`,
  body: (e) => (e.payload.check_in_due_on ? `Check in by ${formatDate(e.payload.check_in_due_on)}.` : ""),
});

defineNotification(EVENTS.REVIEW_OPENED, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.employee_id, e.payload.reviewer_employee_id].filter(Boolean)) }],
  who: "The employee and their reviewer",
  title: (e) => `Probation review: ${e.payload.employee_name}`,
  body: (e) => (e.payload.confirmation_due_on ? `Confirmation is due on ${formatDate(e.payload.confirmation_due_on)}.` : ""),
  copy: true,
});

defineNotification(EVENTS.REVIEW_CHECK_IN_DUE, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.employee_id]) }],
  who: "The employee",
  title: "Check in for the month",
  body: (e) => `Your ${month(e)} check-in is due ${formatDate(e.payload.due_on)}.`,
});

defineNotification(EVENTS.REVIEW_CHECK_IN_SUBMITTED, {
  to: [{ users: (e, client) => loginsOf(client, e.payload.reviewer_employee_ids || []) }],
  who: "The reviewer",
  title: (e) => `${e.payload.employee_name}'s check-in is in`,
  body: (e) => `${month(e)} review is ready to score.`,
});

defineNotification(EVENTS.REVIEW_REVIEW_DUE, {
  to: [{ users: (e, client) => loginsOf(client, e.payload.reviewer_employee_ids || []) }],
  who: "The reviewer",
  title: (e) => `Review ${e.payload.employee_name}`,
  body: (e) => (e.payload.due_on ? `Due ${formatDate(e.payload.due_on)}.` : ""),
});

defineNotification(EVENTS.REVIEW_INPUT_ASKED, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.dotted_employee_id]) }],
  who: "The dotted-line manager",
  title: (e) => `Input asked: ${e.payload.employee_name}`,
  body: (e) => `${month(e)} review is waiting for your input.`,
});

defineNotification(EVENTS.REVIEW_INPUT_GIVEN, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.reviewer_employee_id]) }],
  who: "The reviewer",
  title: (e) => `Input given: ${e.payload.employee_name}`,
  body: (e) => `${e.payload.dotted_name || "The dotted-line manager"} added input.`,
});

defineNotification(EVENTS.REVIEW_RETURNED, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.to === "employee" ? e.payload.employee_id : e.payload.reviewer_employee_id]) }],
  who: "The reviewer, or the employee for a returned check-in",
  title: (e) => (e.payload.to === "employee" ? "Your check-in was returned" : `Review returned: ${e.payload.employee_name}`),
  body: (e) => (e.payload.reason ? `Reason: ${e.payload.reason}` : ""),
});

defineNotification(EVENTS.REVIEW_CLOSE_DUE, {
  to: [{ users: (e, client) => loginsOf(client, e.payload.hr_employee_ids || []) }],
  who: "Operations & People",
  title: (e) => `Close ${e.payload.employee_name}'s review`,
  body: (e) => (e.payload.due_on ? `Due ${formatDate(e.payload.due_on)}.` : ""),
});

defineNotification(EVENTS.REVIEW_CLOSED, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.employee_id]) }],
  who: "The employee",
  title: (e) => `Your ${e.payload.round_name || "probation"} review is closed`,
  body: (e) => (e.payload.rating_label ? `Rating: ${e.payload.rating_label}.` : ""),
});

defineNotification(EVENTS.PROBATION_DECIDED, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.employee_id]) }],
  who: "The employee",
  title: "Your probation review is decided",
  body: (e) => e.payload.outcome_label || "",
});

defineNotification(EVENTS.IMPROVEMENT_PLAN_STARTED, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.employee_id, e.payload.reviewer_employee_id].filter(Boolean)) }],
  who: "The employee and their reviewer",
  title: "An improvement plan has started",
  body: (e) => `Reviewed on ${formatDate(e.payload.review_on)}.`,
});

defineNotification(EVENTS.IMPROVEMENT_PLAN_CLOSED, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.employee_id, e.payload.reviewer_employee_id].filter(Boolean)) }],
  who: "The employee and their reviewer",
  title: "An improvement plan was closed",
  body: (e) => e.payload.outcome_label || "",
});

defineNotification(EVENTS.IMPROVEMENT_PLAN_REVIEW_DUE, {
  to: [{ users: (e, client) => loginsOf(client, e.payload.remind_employee_ids || []) }],
  who: "Operations & People and the reviewer",
  title: "Improvement plan review due",
  body: (e) => `${e.payload.employee_name}'s plan is reviewed on ${formatDate(e.payload.review_on)}.`,
});

defineNotification(EVENTS.KEY_RESULT_REPORT_DUE, {
  to: [{ users: (e, client) => loginsOf(client, e.payload.head_employee_ids || []) }],
  who: "The function's head",
  title: (e) => `Report ${e.payload.department}'s month`,
  body: (e) => `${e.payload.unreported} key results are not reported yet.`,
});

/* ------------------------------------------------------------------ *
 * Reminders (docs/guides/notifications.md §7.1)
 * ------------------------------------------------------------------ */

const CHECK_IN_REMINDER = "check_in_due";
const REVIEW_REMINDER = "review_due";
const CLOSE_REMINDER = "review_close_due";
const PIP_REMINDER = "pip_review_due";
const KR_REPORT_REMINDER = "kr_report_due";

reminders.defineReminder(CHECK_IN_REMINDER, {
  event: EVENTS.REVIEW_CHECK_IN_DUE,
  module: "performance",
  check: (client, row) => require("./reviews.cycle").checkInReminder(client, row),
});

reminders.defineReminder(REVIEW_REMINDER, {
  event: EVENTS.REVIEW_REVIEW_DUE,
  module: "performance",
  check: (client, row) => require("./reviews.cycle").reviewReminder(client, row),
});

reminders.defineReminder(CLOSE_REMINDER, {
  event: EVENTS.REVIEW_CLOSE_DUE,
  module: "performance",
  check: (client, row) => require("./reviews.cycle").closeReminder(client, row),
});

reminders.defineReminder(PIP_REMINDER, {
  event: EVENTS.IMPROVEMENT_PLAN_REVIEW_DUE,
  module: "performance",
  check: (client, row) => require("./reviews.pip").reviewReminder(client, row),
});

reminders.defineReminder(KR_REPORT_REMINDER, {
  event: EVENTS.KEY_RESULT_REPORT_DUE,
  module: "performance",
  // On the 2nd business day of each month, from 09:00: each function with key results unreported.
  find: (client, { now }) => require("./reviews.cycle").reportsDue(client, now),
  check: (client, row) => require("./reviews.cycle").reportReminder(client, row),
});

/* ------------------------------------------------------------------ *
 * Files: evidence, dictation and the closed review's PDF
 * ------------------------------------------------------------------ */

const PDF_DOC_TYPE = "review_summary";

defineDocumentType("performance_evidence", { label: "Performance Evidence", module: "performance", sensitivity: "personal" });
defineDocumentType("review_dictation", { label: "Review Dictation", module: "performance", sensitivity: "personal" });
defineDocType(PDF_DOC_TYPE, {
  label: "Review",
  module: "performance",
  template: "review-summary",
  numbering: null,
  sensitivity: "personal",
  title: (data) => data.title,
});
defineVariables("document", "review-summary", c.reviews.ReviewSummaryVars);

/** A review's files are read by the people the review names, Operations & People and the CEO. */
vault.defineAccess("performance_review", (client, user, doc) => require("./reviews.sequence").mayOpenFile(client, user, doc));

/* ------------------------------------------------------------------ *
 * After commit
 * ------------------------------------------------------------------ */

const ofReview = (event) => event.entity && event.entity.type === "performance_review" && event.payload.definition_key === REVIEW_FLOW;

workflow.onCompleted(REVIEW_FLOW, "reviews.settle", (event) =>
  require("./reviews.service").settle(event.entity.id, { state: event.payload.state, reason: event.payload.reason || null }),
);

outbox.register(WORKFLOW.WORKFLOW_ADVANCED, "reviews.stage", (event) =>
  ofReview(event) ? require("./reviews.service").stageMoved(event.entity.id, event.payload.stage) : undefined,
);

outbox.register(WORKFLOW.WORKFLOW_CHANGES_REQUESTED, "reviews.changes_requested", (event) =>
  ofReview(event) ? require("./reviews.service").changesRequested(event.entity.id, event.payload) : undefined,
);

outbox.register(reminders.PEOPLE_EVENTS.EMPLOYEE_PROBATION_ENDING, "reviews.probation", (event) =>
  require("./reviews.service").openProbation(event.payload.employee_id, event.payload.confirmation_due_on || null),
);

module.exports = {
  EVENTS,
  REVIEW_FLOW,
  PDF_DOC_TYPE,
  CHECK_IN_REMINDER,
  REVIEW_REMINDER,
  CLOSE_REMINDER,
  PIP_REMINDER,
  KR_REPORT_REMINDER,
};
