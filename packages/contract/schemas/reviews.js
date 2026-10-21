"use strict";
/**
 * Reviews: review cycles, the self review first, the manager review, its second level and HR,
 * dictated answers, and Performance Analytics (A17, A18; docs/guides/performance.md §3 steps
 * 8 to 11, §6).
 *
 * Cycle statuses: draft, scheduled (opens on a later day), open, closed.
 *
 * Review statuses:
 *   draft         being written (a returned manager review is draft again, `returned`)
 *   submitted     a self review handed in; a manager review handed in and in `performance.review`
 *   second_level  waiting on the reviewer's own line manager
 *   with_hr       waiting on Operations & People
 *   closed        HR approved: the PDF is in the vault and the employee reads the manager's review
 *   returned      sent back to the reviewer with a reason
 *
 * Self first: a manager review shows no content to its reviewer until the self review is
 * submitted (409 SELF_REVIEW_FIRST), and none to the employee until it is closed.
 */
const { z } = require("zod");
const { uuid, text, isoDate, isoDateTime, listQuery, Paged } = require("./common");
const { PersonRef } = require("./organisation");
const { RouteStage, ApprovalDecision } = require("./workflow");
const { DocumentRef } = require("./documents");
const { ProgressStatus } = require("./goals");
const { Quantity } = require("./kpis");

const CycleStatus = z.enum(["draft", "scheduled", "open", "closed"]);
const ReviewType = z.enum(["self", "manager", "designated"]);
const ReviewStatus = z.enum(["draft", "submitted", "second_level", "with_hr", "closed", "returned"]);
/** A rating, 1 to 5. */
const Rating = z.number().int().min(1).max(5);

/* ------------------------------------------------------------------ *
 * Cycles
 * ------------------------------------------------------------------ */

const CycleQuestion = z
  .object({
    performance_cycle_question_id: uuid,
    position: z.number().int().min(1),
    prompt: z.string(),
  })
  .strict();

const Cycle = z
  .object({
    performance_cycle_id: uuid,
    name: z.string(),
    starts_on: isoDate,
    ends_on: isoDate,
    status: CycleStatus,
    self_review_opens_at: isoDateTime.nullable(),
    closes_at: isoDateTime.nullable(),
    questions: z.array(CycleQuestion),
    reviews: z.number().int().min(0),
    closed_reviews: z.number().int().min(0),
    created_at: isoDateTime,
  })
  .strict();

const CyclePage = Paged(Cycle);
const CycleListQuery = listQuery({ status: CycleStatus.optional() }, ["starts_on", "name"]);

/**
 * POST /performance/cycles: the period it reviews, the day it opens and the day it closes.
 * It opens at 06:00 on `opens_on` (today: at once). With no questions given, the last cycle's
 * are copied.
 */
const CycleCreate = z
  .object({
    name: text(120),
    starts_on: isoDate,
    ends_on: isoDate,
    opens_on: isoDate,
    closes_on: isoDate,
    questions: z.array(text(500)).max(12).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.ends_on < v.starts_on) ctx.addIssue({ code: "custom", path: ["ends_on"], message: "After the start" });
    if (v.closes_on < v.opens_on) ctx.addIssue({ code: "custom", path: ["closes_on"], message: "After it opens" });
  });

/* ------------------------------------------------------------------ *
 * Reviews
 * ------------------------------------------------------------------ */

/** A review as the list shows it, with the ratings of both halves. */
const Review = z
  .object({
    performance_review_id: uuid,
    performance_cycle_id: uuid,
    cycle: z.string(),
    employee: PersonRef,
    reviewer: PersonRef,
    review_type: ReviewType,
    status: ReviewStatus,
    /** The self review's overall rating, once submitted. */
    self_rating: z.number().nullable(),
    /** The manager review's overall rating, once submitted (to the employee: once closed). */
    manager_rating: z.number().nullable(),
    /** Where the manager review is: who it waits on, or Closed. */
    waiting_on: z.string().nullable(),
    submitted_at: isoDateTime.nullable(),
    closes_at: isoDateTime.nullable(),
  })
  .strict();

const ReviewPage = Paged(Review);
const ReviewListQuery = listQuery(
  {
    performance_cycle_id: uuid.optional(),
    status: ReviewStatus.optional(),
    review_type: ReviewType.optional(),
  },
  ["employee", "closes_at", "status"],
);

/** GET /performance/reviews/summary: the current cycle's figures. */
const ReviewsSummary = z
  .object({
    cycle: Cycle.nullable(),
    last_cycle: z.string().nullable(),
    average_rating: z.number().nullable(),
    self_done: z.number().int().min(0),
    manager_done: z.number().int().min(0),
    closed: z.number().int().min(0),
    total: z.number().int().min(0),
  })
  .strict();

/** A rating of one KPI on a review, with the KPI's progress beside it. */
const ReviewItem = z
  .object({
    employee_target_id: uuid,
    title: z.string(),
    weight: z.string(),
    target_value: Quantity.nullable(),
    actual_value: Quantity.nullable(),
    attainment: z.number().min(0).max(1).nullable(),
    progress_status: ProgressStatus.nullable(),
    /** The manager's form: prefilled from attainment until saved. */
    score: Rating.nullable(),
    comment: z.string().nullable(),
  })
  .strict();

/** An answer to one of the cycle's questions. */
const ReviewAnswer = z
  .object({
    performance_cycle_question_id: uuid,
    prompt: z.string(),
    answer_text: z.string().nullable(),
    dictated: z.boolean(),
  })
  .strict();

/** One half of a review: what its writer put down. */
const ReviewForm = z
  .object({
    performance_review_id: uuid,
    review_type: ReviewType,
    reviewer: PersonRef,
    status: ReviewStatus,
    overall_score: Rating.nullable(),
    summary: z.string().nullable(),
    items: z.array(ReviewItem),
    answers: z.array(ReviewAnswer),
    submitted_at: isoDateTime.nullable(),
  })
  .strict();

/**
 * GET /performance/reviews/:id and the ESS review: the review the caller may act on, and the
 * other half when they may read it. `waiting_for_self` is true on a manager review whose self
 * review is not in; its `form` is then null.
 */
const ReviewDetail = z
  .object({
    performance_review_id: uuid,
    cycle: Cycle,
    employee: PersonRef,
    review_type: ReviewType,
    status: ReviewStatus,
    form: ReviewForm.nullable(),
    /** The self review beside a manager review, or the manager review beside a closed self review. */
    other: ReviewForm.nullable(),
    waiting_for_self: z.boolean(),
    route: z.array(RouteStage),
    decisions: z.array(ApprovalDecision),
    document: DocumentRef.nullable(),
    can_edit: z.boolean(),
    can_submit: z.boolean(),
    can_decide: z.boolean(),
  })
  .strict();

/** PUT a review: the whole form, saved as a draft. */
const ReviewSave = z
  .object({
    overall_score: Rating.nullable().optional(),
    summary: z.string().trim().max(5000).nullable().optional(),
    items: z
      .array(
        z
          .object({
            employee_target_id: uuid,
            score: Rating.nullable(),
            comment: z.string().trim().max(2000).nullable(),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    answers: z
      .array(
        z
          .object({
            performance_cycle_question_id: uuid,
            answer_text: z.string().trim().max(5000).nullable(),
            /**
             * The dictation this answer came from (Dictation.dictation_id). Absent or different:
             * the answer was typed, and the dictation kept against it is cleared.
             */
            dictation_id: uuid.nullable().optional(),
          })
          .strict(),
      )
      .max(12)
      .optional(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Dictation (A18)
 * ------------------------------------------------------------------ */

/** POST …/dictation: the multipart's text fields beside the `file`, the recording (3 min, 10 MB). */
const DictationRequest = z
  .object({
    performance_cycle_question_id: uuid,
    duration_s: z.coerce.number().int().min(1).max(180),
  })
  .strict();

/**
 * What was said, and the same tidied (wording, grammar, filler) without a fact, figure, name,
 * judgement or tone changed. `tidied` is null when tidying is unavailable.
 *
 * The audio, the transcript and the AI run are kept against the answer at once, but the
 * answer's text is not touched: the person chooses Use Tidied, Use As Spoken or keeps typing,
 * and the save that names `dictation_id` (the audio's document_id) is what keeps it.
 */
const Dictation = z
  .object({
    dictation_id: uuid,
    transcript: z.string(),
    tidied: z.string().nullable(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Analytics
 * ------------------------------------------------------------------ */

const PerformanceAnalyticsQuery = z
  .object({
    performance_cycle_id: uuid.optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
  })
  .strict();

const PerformanceAnalytics = z
  .object({
    cycle: z.string().nullable(),
    year: z.number().int(),
    goals_on_track: z.number().int().min(0),
    goals_total: z.number().int().min(0),
    reviews_completed: z.number().int().min(0),
    reviews_total: z.number().int().min(0),
    average_self: z.number().nullable(),
    average_manager: z.number().nullable(),
    /** Goal Completion by Month: the mean attainment of the month's active KPIs, January first. */
    completion: z.array(
      z.object({ month: z.string(), attainment: z.number().min(0).max(1).nullable() }).strict(),
    ),
    by_department: z.array(
      z
        .object({
          department_id: uuid,
          department: z.string(),
          attainment: z.number().min(0).max(1).nullable(),
        })
        .strict(),
    ),
    /** Self vs Manager Rating; `gap` is manager minus self. */
    gap: z.array(
      z
        .object({
          department_id: uuid,
          department: z.string(),
          self: z.number().nullable(),
          manager: z.number().nullable(),
          gap: z.number().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * The closed review's PDF
 * ------------------------------------------------------------------ */

/** The variables of templates/documents/review-summary.html. Dates are day-first, ready to print. */
const ReviewSummaryVars = z
  .object({
    employee: z.string(),
    job_title: z.string(),
    department: z.string(),
    cycle: z.string(),
    period: z.string(),
    reviewer: z.string(),
    closed_on: z.string(),
    self_rating: z.string(),
    manager_rating: z.string(),
    summary: z.string(),
    kpis: z.array(
      z
        .object({
          title: z.string(),
          weight: z.string(),
          result: z.string(),
          self: z.string(),
          manager: z.string(),
          comment: z.string(),
        })
        .strict(),
    ),
    answers: z.array(z.object({ prompt: z.string(), self: z.string(), manager: z.string() }).strict()),
    approvals: z.array(z.object({ stage: z.string(), by: z.string(), on: z.string() }).strict()),
  })
  .strict();

const TABLES = {
  CycleQuestion: { table: "performance_cycle_question" },
  Cycle: {
    table: "performance_cycle",
    virtual: {
      questions: "performance_cycle_question rows of the cycle",
      reviews: "count of the cycle's performance_review rows",
      closed_reviews: "count of them closed",
    },
  },
  CyclePage: { table: null, reason: "a page of cycles" },
  CycleListQuery: { table: null, reason: "list controls for cycles" },
  CycleCreate: {
    table: "performance_cycle",
    virtual: {
      opens_on: "written to self_review_opens_at and manager_review_opens_at, 06:00 Lagos",
      closes_on: "written to closes_at, 17:00 Lagos",
      questions: "written to performance_cycle_question",
    },
  },
  Review: {
    table: "performance_review",
    virtual: {
      cycle: "performance_cycle.name",
      employee: "the person in performance_review.employee_id",
      reviewer: "the person in performance_review.reviewer_employee_id",
      self_rating: "overall_score of the cycle's self review for the employee",
      manager_rating: "overall_score of the manager review, hidden from the employee until closed",
      waiting_on: "the current stage's name, from workflow_instance",
      closes_at: "performance_cycle.closes_at",
    },
  },
  ReviewPage: { table: null, reason: "a page of reviews" },
  ReviewListQuery: { table: null, reason: "list controls and filters for reviews" },
  ReviewsSummary: { table: null, reason: "counts and averages over a cycle's reviews" },
  ReviewItem: {
    table: "performance_review_item",
    virtual: {
      title: "employee_target.title",
      weight: "employee_target.weight",
      target_value: "employee_target.target_value",
      actual_value: "employee_target.actual_value",
      attainment: "worked out (§6)",
      progress_status: "worked out (§6)",
    },
  },
  ReviewAnswer: {
    table: "performance_review_answer",
    virtual: {
      prompt: "performance_cycle_question.prompt",
      dictated: "performance_review_answer.dictation_document_id is set",
    },
  },
  ReviewForm: {
    table: "performance_review",
    virtual: {
      reviewer: "the person in performance_review.reviewer_employee_id",
      items: "performance_review_item rows",
      answers: "performance_review_answer rows",
    },
  },
  ReviewDetail: {
    table: "performance_review",
    virtual: {
      cycle: "the review's performance_cycle",
      employee: "the person in performance_review.employee_id",
      form: "the half the caller may act on or read",
      other: "the other half, when the caller may read it",
      waiting_for_self: "a manager review whose self review is not submitted",
      route: "the stages of the review's workflow_instance",
      decisions: "workflow_decision rows of the review's workflow_instance",
      document: "the closed review's PDF in performance_review.document_id",
      can_edit: "draft or returned, and the caller is the reviewer",
      can_submit: "as can_edit, and the self review is in for a manager review",
      can_decide: "the review waits at a stage the caller may decide",
    },
  },
  ReviewSave: { table: null, reason: "a review's form, written to performance_review, _item and _answer" },
  DictationRequest: { table: null, reason: "the text fields beside the audio in a multipart upload" },
  Dictation: {
    table: null,
    reason: "the audio's document_id, its transcript and the tidied text from the AI run",
  },
  PerformanceAnalyticsQuery: { table: null, reason: "which cycle and year" },
  PerformanceAnalytics: { table: null, reason: "figures over goals, KPIs and reviews" },
  ReviewSummaryVars: { table: null, reason: "the variables of templates/documents/review-summary.html, not a row" },
};

module.exports = {
  TABLES,
  CycleStatus,
  ReviewType,
  ReviewStatus,
  Rating,
  CycleQuestion,
  Cycle,
  CyclePage,
  CycleListQuery,
  CycleCreate,
  Review,
  ReviewPage,
  ReviewListQuery,
  ReviewsSummary,
  ReviewItem,
  ReviewAnswer,
  ReviewForm,
  ReviewDetail,
  ReviewSave,
  DictationRequest,
  Dictation,
  PerformanceAnalyticsQuery,
  PerformanceAnalytics,
  ReviewSummaryVars,
};
