"use strict";
/**
 * What the reviews module records, and who it tells (docs/guides/performance.md §7).
 *
 * A cycle opening tells everyone it reviews and everyone who reviews; a self review handed in
 * tells the manager; the approval engine tells the second level and Operations & People when
 * the manager review reaches them; a return tells the manager why; a closed review tells the
 * employee their manager's review is ready.
 */
const { defineEvents, WORKFLOW } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");
const workflow = require("../../shared/workflow/engine");
const outbox = require("../../shared/events/outbox");
const vault = require("../../shared/documents/vault");
const { defineDocumentType } = require("../../shared/documents/types");
const { defineDocType } = require("../../shared/documents/generate");
const { defineVariables } = require("../../shared/templates/variables");
const c = require("@mycity/contract");

const DEFINITION_KEY = "performance.review";

/** A dictated answer's recording (A18): personal, read by whoever may read the review. */
const DICTATION_DOC_TYPE = "review_dictation";
defineDocumentType(DICTATION_DOC_TYPE, { label: "Dictated review answer", module: "performance", sensitivity: "personal" });
vault.defineAccess("review", async (client, user, doc) => {
  const repo = require("./reviews.repo");
  const sequence = require("./reviews.sequence");
  const review = await repo.getReview(client, doc.entity_id);
  return Boolean(review && (await sequence.standing(client, review, user)));
});

const EVENTS = defineEvents("performance", {
  "review.cycle_opened": { summary: "A review cycle opened" },
  "review.cycle_closed": { summary: "A review cycle closed" },
  "review.saved": { summary: "A review was saved as a draft" },
  "review.self_submitted": { summary: "Someone handed in their self review" },
  "review.submitted": { summary: "A manager handed in a review" },
  "review.decided": { summary: "A review moved on its approval" },
  "review.returned": { summary: "A review was returned to its reviewer" },
  "review.closed": { summary: "A review closed with Operations & People" },
  "review.reminder": { summary: "A review is due soon or overdue" },
  "review.dictated": { summary: "An answer was dictated, transcribed and tidied" },
});

async function loginsOf(client, employeeIds) {
  const ids = [...new Set((employeeIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const { rows } = await client.query(
    "SELECT user_id FROM app_user WHERE employee_id = ANY($1::uuid[]) AND status = 'active'",
    [ids],
  );
  return rows.map((r) => r.user_id);
}

/** Everyone a cycle reviews, and everyone reviewing. */
async function cyclePeople(e, client) {
  const { rows } = await client.query(
    `SELECT DISTINCT u.user_id FROM performance_review r
       JOIN app_user u ON u.employee_id = r.reviewer_employee_id AND u.status = 'active'
      WHERE r.performance_cycle_id = $1`,
    [e.entity.id],
  );
  return rows.map((r) => r.user_id);
}

defineNotification(EVENTS.REVIEW_CYCLE_OPENED, {
  to: [{ users: cyclePeople }],
  title: (e) => `${e.payload.name} is open`,
  body: () => "Start with your self review",
  include_actor: true,
});

defineNotification(EVENTS.REVIEW_SELF_SUBMITTED, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.manager_reviewer_id]) }],
  title: (e) => `${e.payload.employee_name}'s self review is in`,
  body: (e) => e.payload.cycle,
});

defineNotification(EVENTS.REVIEW_RETURNED, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.reviewer_employee_id]) }],
  title: (e) => `Returned: ${e.payload.employee_name}'s review`,
  body: (e) => e.payload.reason || "",
});

defineNotification(EVENTS.REVIEW_CLOSED, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.employee_id]) }],
  title: () => "Your manager's review is ready",
  body: (e) => e.payload.cycle,
  include_actor: true,
});

defineNotification(EVENTS.REVIEW_REMINDER, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.reviewer_employee_id]) }],
  title: (e) => (e.payload.overdue ? "Review overdue" : "Review due soon"),
  body: (e) => (e.payload.review_type === "self" ? `Your self review: ${e.payload.cycle}` : `${e.payload.employee_name}: ${e.payload.cycle}`),
  include_actor: true,
});

/** The closed review as a PDF (reviews.pdf.js), read like the review itself. */
defineDocType("review_summary", {
  label: "Performance review",
  module: "performance",
  template: "review-summary",
  numbering: null,
  sensitivity: "personal",
  title: (d) => `Performance Review: ${d.employee}, ${d.cycle}`,
});
defineVariables("document", "review-summary", c.reviews.ReviewSummaryVars);

outbox.register(EVENTS.REVIEW_CLOSED, "reviews.render_summary", (event) =>
  require("./reviews.pdf").build(event.entity.id),
);

const service = () => require("./reviews.service");

workflow.onCompleted(DEFINITION_KEY, "reviews.apply_decision", async (event) => {
  await service().settle(event.entity.id, event.payload.state);
});

outbox.register(WORKFLOW.WORKFLOW_ADVANCED, "reviews.apply_stage", async (event) => {
  if (event.payload.definition_key !== DEFINITION_KEY) return;
  await service().settle(event.entity.id, "pending");
});

outbox.register(WORKFLOW.WORKFLOW_CANCELLED, "reviews.apply_withdrawal", async (event) => {
  if (event.payload.definition_key !== DEFINITION_KEY) return;
  await service().settle(event.entity.id, "cancelled");
});

module.exports = { EVENTS, DEFINITION_KEY, DICTATION_DOC_TYPE, loginsOf };
