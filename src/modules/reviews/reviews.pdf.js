"use strict";
/**
 * The closed review's PDF (docs/guides/performance.md §7 `review.closed`): both halves of the
 * review, the KPIs with both ratings, each question with both answers and who approved it,
 * through documents.generate() after the review closes, kept in the vault as `review_summary`
 * (personal; read by whoever may read the review) and linked from the review.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const documents = require("../../shared/documents/generate");
const { completeQuery } = require("../../shared/http/paged");
const dayFirst = require("../../shared/time/day-first");
const score = require("../kpis/kpis.score");
const repo = require("./reviews.repo");

const REVIEW_DOC_TYPE = "review_summary";
const STAGES = { second_level: "Second Level", operations_people: "Operations & People" };

const rating = (v) => (v === null || v === undefined ? "Not given" : `${Math.round(v)} of 5`);

async function approvals(client, instanceId) {
  if (!instanceId) return [];
  // pagination:complete the decisions on one review's approval, a handful
  const { rows } = await completeQuery(
    client,
    `SELECT wd.stage_key, wd.decided_at, btrim(e.first_name || ' ' || e.last_name) AS name
       FROM workflow_decision wd
       LEFT JOIN app_user u ON u.user_id = wd.actor_id
       LEFT JOIN employee e ON e.employee_id = u.employee_id
      WHERE wd.workflow_instance_id = $1 AND wd.decision = 'approve'
      ORDER BY wd.decided_at, wd.workflow_decision_id`,
    [instanceId],
    { label: "a review's approvals" },
  );
  return rows.map((r) => ({ stage: STAGES[r.stage_key] || r.stage_key, by: r.name || "", on: dayFirst.formatDate(r.decided_at) }));
}

/** The variables of templates/documents/review-summary.html for a closed manager review. */
async function dataOf(client, review) {
  const self = await repo.counterpart(client, review);
  const items = await repo.items(client, review.performance_review_id);
  const selfItems = self ? new Map((await repo.items(client, self.performance_review_id)).map((i) => [i.employee_target_id, i])) : new Map();
  const answers = await repo.answers(client, review);
  const selfAnswers = self ? new Map((await repo.answers(client, self)).map((a) => [a.performance_cycle_question_id, a])) : new Map();
  return {
    employee: review.employee.display_name,
    job_title: review.employee.job_title || "",
    department: review.employee.department || "",
    cycle: review.cycle,
    period: `${dayFirst.formatDate(review.starts_on)} to ${dayFirst.formatDate(review.ends_on)}`,
    reviewer: review.reviewer.display_name,
    closed_on: dayFirst.formatDate(review.closed_at || new Date()),
    self_rating: rating(self ? self.overall_score : null),
    manager_rating: rating(review.overall_score),
    summary: review.summary || "",
    kpis: items.map((i) => {
      const att = score.attainment(i);
      const s = selfItems.get(i.employee_target_id);
      return {
        title: i.title,
        weight: `${Number(i.weight).toFixed(0)}%`,
        result: att === null ? "" : `${Math.round(att * 100)}%`,
        self: s && s.score ? String(s.score) : "",
        manager: i.score ? String(i.score) : "",
        comment: i.comment || "",
      };
    }),
    answers: answers.map((a) => ({
      prompt: a.prompt,
      self: (selfAnswers.get(a.performance_cycle_question_id) || {}).answer_text || "",
      manager: a.answer_text || "",
    })),
    approvals: await approvals(client, review.workflow_instance_id),
  };
}

/** After a review closes: generate its PDF once and link it. */
async function build(reviewId) {
  const client = await pool.connect();
  try {
    await atomically(client, async () => {
      const review = await repo.getReview(client, reviewId, { lock: true });
      if (!review || review.status !== "closed" || review.review_type === "self" || review.document_id) return;
      const doc = await documents.generate(client, {
        doc_type: REVIEW_DOC_TYPE,
        entity: { type: "review", id: reviewId },
        subject_employee_id: review.employee_id,
        data: await dataOf(client, review),
        actor: null,
      });
      await repo.setReview(client, reviewId, { documentId: doc.document_id });
    });
  } finally {
    client.release();
  }
}

module.exports = { REVIEW_DOC_TYPE, dataOf, build };
