"use strict";
/**
 * Monthly rounds, reviews and their items, check-ins, dictation and Tidy, and improvement plans
 * (docs/guides/performance.md §4, §5 Reviews, §6.10, §6.12, §6.14 to §6.17).
 *
 * A round ("October 2026") opens on the next month's first business day with one review per
 * binding scorecard. A review runs check_in → with_reviewer → second_level → with_hr → closed
 * (returned sends it back to the reviewer). Self first (A17): the reviewer sees nothing of the
 * check-in until it is submitted, and the employee sees the reviewer's scores only once closed.
 *
 * Scores are 0 to 1 as decimal strings (scoring.js). An item with no evidence is Not Assessable:
 * no proposed score, and it leaves the score to date's denominator.
 */
const { z } = require("zod");
const { uuid, text, optionalText, isoDate, isoDateTime, blank, listQuery, Paged } = require("./common");
const { PersonRef } = require("./organisation");
const { Link } = require("./tasks");
const { ScoreValue, Quantity, Rating } = require("./scoring");
const { MonthStart } = require("./kpis");
const { Section, LineMeasure, LineSource, Weight } = require("./targets");
const { UploadPurpose } = require("./documents");

/* ------------------------------------------------------------------ *
 * Rounds
 * ------------------------------------------------------------------ */

const RoundStatus = z.enum(["open", "closed"]);

/** How many of a round's reviews stand at each stage. */
const RoundCounts = z
  .object({
    total: z.number().int().min(0),
    check_in: z.number().int().min(0),
    with_reviewer: z.number().int().min(0),
    second_level: z.number().int().min(0),
    with_hr: z.number().int().min(0),
    closed: z.number().int().min(0),
  })
  .strict();

/** A monthly round and its deadlines (§6.2). */
const Round = z
  .object({
    performance_cycle_id: uuid,
    performance_period_id: uuid,
    name: z.string(),
    month: MonthStart,
    status: RoundStatus,
    check_in_due_on: isoDate,
    head_check_in_due_on: isoDate,
    review_due_on: isoDate,
    second_level_due_on: isoDate,
    close_due_on: isoDate,
    closes_at: isoDateTime,
    counts: RoundCounts,
  })
  .strict();

const RoundPage = Paged(Round);

/** GET /performance/rounds */
const RoundListQuery = listQuery({ period_id: uuid.optional(), status: RoundStatus.optional() }, ["month"]);

/** POST /performance/rounds: open a month's round late, by hand. */
const RoundCreate = z
  .object({
    performance_period_id: uuid,
    month: MonthStart,
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Reviews
 * ------------------------------------------------------------------ */

const ReviewStatus = z.enum(["check_in", "with_reviewer", "second_level", "with_hr", "closed", "returned"]);
const ReviewKind = z.enum(["monthly", "probation"]);
/** manager: the effective line manager; designated: a person or role named on the scorecard. */
const ReviewType = z.enum(["self", "manager", "designated"]);
const EvidenceKind = z.enum(["record", "document", "link", "note"]);
/** What a probation review without a scorecard assesses (§6.16). */
const Criterion = z.enum(["objectives", "quality", "timeliness", "attendance", "conduct"]);
const ProbationOutcomeCode = z.enum(["confirm", "extend", "end"]);

/** A review in a list: whose, who reviews it, where it stands, what it scored. */
const Review = z
  .object({
    performance_review_id: uuid,
    performance_cycle_id: uuid.nullable(),
    round_name: z.string().nullable(),
    month: MonthStart.nullable(),
    scorecard_id: uuid.nullable(),
    review_kind: ReviewKind,
    review_type: ReviewType,
    status: ReviewStatus,
    employee: PersonRef,
    reviewer: PersonRef,
    check_in_submitted_at: isoDateTime.nullable(),
    submitted_at: isoDateTime.nullable(),
    closed_at: isoDateTime.nullable(),
    score_month: ScoreValue.nullable(),
    score_to_date: ScoreValue.nullable(),
    rating: Rating.nullable(),
    due_on: isoDate.nullable(),
    waiting_on_me: z.boolean(),
  })
  .strict();

const ReviewPage = Paged(Review);

/** GET /performance/reviews */
const ReviewListQuery = listQuery(
  {
    round_id: uuid.optional(),
    status: ReviewStatus.optional(),
    kind: ReviewKind.optional(),
    department_id: uuid.optional(),
    waiting_on_me: z.enum(["true", "false"]).optional(),
  },
  ["employee", "status", "due_on"],
);

/** The scorecard line an item scores, as the review shows it. */
const ItemLine = z
  .object({
    employee_target_id: uuid,
    section: Section,
    title: z.string(),
    measure: LineMeasure,
    source: LineSource,
    target_value: Quantity.nullable(),
    target_text: z.string().nullable(),
    unit: z.string().nullable(),
    weight: Weight,
  })
  .strict();

/**
 * One item of a review: the check-in (actual, evidence, action, self score) and the review
 * (final score, override reason, comment). A reader is sent only the parts §6.12 allows; the
 * rest arrive as null.
 */
const ReviewItem = z
  .object({
    performance_review_item_id: uuid,
    employee_target_id: uuid.nullable(),
    criterion: Criterion.nullable(),
    line: ItemLine.nullable(),
    actual_value: Quantity.nullable(),
    actual_text: z.string().nullable(),
    achieved_on: isoDate.nullable(),
    evidence_kind: EvidenceKind.nullable(),
    evidence_entity_type: z.string().nullable(),
    evidence_entity_id: uuid.nullable(),
    evidence_document_id: uuid.nullable(),
    evidence_url: z.string().nullable(),
    evidence_note: z.string().nullable(),
    evidence_link: Link.nullable(),
    action_text: z.string().nullable(),
    action_transcript: z.string().nullable(),
    action_document_id: uuid.nullable(),
    proposed_score: ScoreValue.nullable(),
    self_score: ScoreValue.nullable(),
    self_reason: z.string().nullable(),
    score: ScoreValue.nullable(),
    override_reason: z.string().nullable(),
    comment: z.string().nullable(),
    assessable: z.boolean(),
    auto: z.boolean(),
  })
  .strict();

/** Where a task of the month stands for the check-in: done in it, still open in it, due the month after. */
const TaskBucket = z.enum(["done", "ongoing", "next_month"]);

/** A task of the review's month, as the check-in and the review list it (P15). */
const ReviewTask = z
  .object({
    task_id: uuid,
    number: z.string(),
    title: z.string(),
    status: z.string(),
    due_at: isoDateTime.nullable(),
    completed_at: isoDateTime.nullable(),
    employee_target_id: uuid.nullable(),
    bucket: TaskBucket,
  })
  .strict();

/** How many tasks each bucket holds: the lists carry the first 25 of each. */
const ReviewTaskCounts = z
  .object({
    done: z.number().int().min(0),
    ongoing: z.number().int().min(0),
    next_month: z.number().int().min(0),
  })
  .strict();

/** The month around a review, read only and never scored (G6): attendance and recognitions. */
const ReviewContext = z
  .object({
    on_time: z.number().int().min(0),
    late: z.number().int().min(0),
    absent: z.number().int().min(0),
    recognitions: z.number().int().min(0),
  })
  .strict();

/** A corrective action as the review shows it; its task is made when the reviewer submits. */
const ReviewAction = z
  .object({
    performance_review_item_id: uuid,
    title: z.string(),
    owner: PersonRef,
    due_on: isoDate,
    task_id: uuid.nullable(),
    task_number: z.string().nullable(),
    task_status: z.string().nullable(),
  })
  .strict();

/** One step of a review's chain, as the review and its PDF show it. */
const ReviewStep = z
  .object({
    key: z.enum(["check_in", "reviewer", "second_level", "hr"]),
    state: z.enum(["done", "current", "waiting", "skipped"]),
    person: z.string().nullable(),
    at: isoDateTime.nullable(),
  })
  .strict();

/** What the reader may do to a review now. */
const ReviewAllowed = z
  .object({
    check_in: z.boolean(),
    score: z.boolean(),
    submit: z.boolean(),
    return_check_in: z.boolean(),
    ask_input: z.boolean(),
    give_input: z.boolean(),
    mark_conduct: z.boolean(),
    decide_probation: z.boolean(),
    decide: z.boolean(),
    start_pip: z.boolean(),
  })
  .strict();

/** GET /performance/reviews/:id */
const ReviewDetail = Review.extend({
  dotted: PersonRef.nullable(),
  second_level: PersonRef.nullable(),
  dotted_input: z.string().nullable(),
  dotted_input_at: isoDateTime.nullable(),
  conduct_breach: z.boolean(),
  conduct_note: z.string().nullable(),
  probation_outcome: ProbationOutcomeCode.nullable(),
  returned_reason: z.string().nullable(),
  document_id: uuid.nullable(),
  workflow_instance_id: uuid.nullable(),
  items: z.array(ReviewItem),
  tasks: z.array(ReviewTask),
  task_counts: ReviewTaskCounts,
  actions: z.array(ReviewAction),
  chain: z.array(ReviewStep),
  context: ReviewContext.nullable(),
  improvement_plan_id: uuid.nullable(),
  can: ReviewAllowed,
}).strict();

/** :id and :item_id of a review's item (its dictation). */
const ReviewItemParams = z.object({ id: uuid, item_id: uuid }).strict();

/**
 * A corrective action on an item scored below its target (§6.16): kept on the item while the
 * reviewer works, and made a task for its owner, pointing at the review, when the review is submitted.
 */
const CorrectiveAction = z
  .object({
    performance_review_item_id: uuid,
    title: text(300),
    owner_employee_id: uuid,
    due_on: isoDate,
  })
  .strict();

/** One item's final score as the reviewer saves it. */
const ItemScore = z
  .object({
    performance_review_item_id: uuid,
    score: ScoreValue.nullable(),
    override_reason: optionalText(1000),
    comment: optionalText(4000),
  })
  .strict();

/** PUT /performance/reviews/:id/scores: after the check-in only (409 CHECK_IN_FIRST). */
const ReviewScoresSave = z
  .object({
    items: z.array(ItemScore).max(60),
    actions: z.array(CorrectiveAction).max(60).default([]),
  })
  .strict();

/** POST /performance/reviews/:id/input: the dotted manager's input. */
const ReviewInput = z.object({ dotted_input: text(4000) }).strict();

/** POST /performance/reviews/:id/return: the reviewer sends a check-in back, with a reason. */
const ReturnCheckIn = z.object({ returned_reason: text(1000) }).strict();

/** POST /performance/reviews/:id/conduct: caps the rating at Partly Meets (§6.15). */
const ConductMark = z
  .object({
    conduct_breach: z.boolean(),
    conduct_note: text(2000),
  })
  .strict();

/** POST /performance/reviews/:id/probation-outcome: HR's close of a probation review. */
const ProbationOutcome = z
  .object({
    probation_outcome: ProbationOutcomeCode,
    note: optionalText(2000),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Check-ins (the employee's side, through ESS)
 * ------------------------------------------------------------------ */

/** One item as the employee fills it. */
const ReviewCheckInItemSave = z
  .object({
    performance_review_item_id: uuid,
    actual_value: Quantity.nullable().optional(),
    actual_text: z.string().trim().max(2000).nullable().optional(),
    achieved_on: isoDate.nullable().optional(),
    evidence_kind: EvidenceKind.nullable().optional(),
    evidence_entity_type: z.string().trim().max(60).nullable().optional(),
    evidence_entity_id: uuid.nullable().optional(),
    evidence_document_id: uuid.nullable().optional(),
    evidence_url: z.string().trim().url().max(2000).nullable().optional(),
    evidence_note: z.string().trim().max(2000).nullable().optional(),
    action_text: z.string().trim().max(4000).nullable().optional(),
    action_transcript: z.string().trim().max(8000).nullable().optional(),
    action_document_id: uuid.nullable().optional(),
    action_ai_run_id: uuid.nullable().optional(),
    self_score: ScoreValue.nullable().optional(),
    self_reason: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

/** The open month's check-in. */
const ReviewCheckIn = z
  .object({
    performance_review_id: uuid,
    round_name: z.string().nullable(),
    month: MonthStart.nullable(),
    due_on: isoDate.nullable(),
    status: ReviewStatus,
    check_in_submitted_at: isoDateTime.nullable(),
    returned_reason: z.string().nullable(),
    reviewer: PersonRef,
    items: z.array(ReviewItem),
    tasks: z.array(ReviewTask),
    task_counts: ReviewTaskCounts,
  })
  .strict();

/**
 * POST /ess/performance/check-in/evidence: the fields beside the file, the item it is evidence for.
 * The upload engine sends the purpose too; the route's own (performance_evidence) decides.
 */
const EvidenceUpload = z.object({ purpose: UploadPurpose.optional(), performance_review_item_id: uuid }).strict();

/** PUT /ess/performance/check-in: Save Draft. */
const ReviewCheckInSave = z.object({ items: z.array(ReviewCheckInItemSave).max(60) }).strict();

/* ------------------------------------------------------------------ *
 * Dictation and Tidy (§6.17)
 * ------------------------------------------------------------------ */

/** Which text a recording is for. */
const DictationRequest = z
  .object({
    /** Sent by the upload engine; the route's own (voice_note) decides. */
    purpose: UploadPurpose.optional(),
    performance_review_item_id: blank(uuid),
    field: z.enum(["action_text", "self_reason", "comment", "dotted_input"]).default("action_text"),
  })
  .strict();

/** The transcript, kept beside the recording. */
const Dictation = z
  .object({
    transcript: z.string(),
    document_id: uuid,
    ai_run_id: uuid.nullable(),
  })
  .strict();

/** POST /performance/tidy and /workspace/week/tidy: one tidy, run only when pressed. */
const TidyRequest = z
  .object({
    kind: z.enum(["check_in", "review", "week"]),
    performance_review_item_id: blank(uuid),
    text: text(8000),
  })
  .strict();

/** The tidied text beside the original; nothing changes until the person picks. */
const TidyResult = z
  .object({
    available: z.boolean(),
    original: z.string(),
    tidied: z.string().nullable(),
    ai_run_id: uuid.nullable(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Improvement plans (§6.16)
 * ------------------------------------------------------------------ */

const PipStatus = z.enum(["open", "passed", "extended", "not_met"]);

const PipLine = z
  .object({
    improvement_plan_line_id: uuid,
    employee_target_id: uuid.nullable(),
    text: z.string(),
    target_text: z.string().nullable(),
    position: z.number().int().min(0),
  })
  .strict();

const Pip = z
  .object({
    improvement_plan_id: uuid,
    employee: PersonRef,
    performance_review_id: uuid.nullable(),
    starts_on: isoDate,
    ends_on: isoDate,
    review_on: isoDate,
    summary: z.string().nullable(),
    status: PipStatus,
    outcome_note: z.string().nullable(),
    decided_at: isoDateTime.nullable(),
    lines: z.array(PipLine),
    created_at: isoDateTime,
    updated_at: isoDateTime,
  })
  .strict();

const PipPage = Paged(Pip);

/** GET /performance/pips */
const PipListQuery = listQuery({ status: PipStatus.optional(), employee_id: uuid.optional() }, ["review_on", "created_at"]);

const PipLineInput = z
  .object({
    employee_target_id: blank(uuid),
    text: text(1000),
    target_text: optionalText(500),
  })
  .strict();

/** POST /performance/pips: from a closed review rated Below. 30 days, reviewed at its end, by default. */
const PipCreate = z
  .object({
    performance_review_id: uuid,
    starts_on: isoDate,
    ends_on: blank(isoDate),
    review_on: blank(isoDate),
    summary: optionalText(4000),
    lines: z.array(PipLineInput).min(1).max(20),
  })
  .strict();

/** PATCH /performance/pips/:id */
const PipEdit = z
  .object({
    ends_on: isoDate,
    review_on: isoDate,
    summary: z.string().trim().max(4000).nullable(),
    lines: z.array(PipLineInput).min(1).max(20),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Change at least one field" });

/** POST /performance/pips/:id/close: Passed, Extended (new dates) or Not Met, with a note. */
const PipClose = z
  .object({
    status: z.enum(["passed", "extended", "not_met"]),
    outcome_note: text(2000),
    ends_on: blank(isoDate),
    review_on: blank(isoDate),
  })
  .strict()
  .refine((v) => v.status !== "extended" || Boolean(v.ends_on && v.review_on), {
    message: "Give the new dates",
    path: ["ends_on"],
  });

/* ------------------------------------------------------------------ *
 * The closed review's PDF (templates/documents/review-summary.html, §6.12)
 * ------------------------------------------------------------------ */

/** One line of the PDF: what was aimed for, what came in, and each score. */
const ReviewSummaryLine = z
  .object({
    section: z.string(),
    title: z.string(),
    target: z.string(),
    actual: z.string(),
    evidence: z.string(),
    proposed: z.string(),
    self: z.string(),
    final: z.string(),
    auto: z.boolean(),
    note: z.string().nullable(),
    action: z.string().nullable(),
  })
  .strict();

/** The variables of templates/documents/review-summary.html, every value as it is printed. */
const ReviewSummaryVars = z
  .object({
    title: z.string(),
    employee_name: z.string(),
    job_title: z.string().nullable(),
    department: z.string().nullable(),
    reviewer_name: z.string(),
    month: z.string(),
    closed_on: z.string(),
    score_month: z.string(),
    score_to_date: z.string(),
    rating: z.string(),
    conduct_note: z.string().nullable(),
    outcome: z.string().nullable(),
    lines: z.array(ReviewSummaryLine),
    done: z.array(z.string()),
    ongoing: z.array(z.string()),
    next_month: z.array(z.string()),
    actions: z.array(z.object({ title: z.string(), owner: z.string(), due: z.string() }).strict()),
    input: z.object({ name: z.string(), text: z.string() }).strict().nullable(),
    chain: z.array(z.object({ step: z.string(), name: z.string(), at: z.string() }).strict()),
  })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const REVIEW_VIRTUAL = {
  round_name: "performance_cycle.name",
  month: "performance_cycle.month",
  employee: "the person in performance_review.employee_id",
  reviewer: "the person in performance_review.reviewer_employee_id",
  due_on: "the deadline of the stage it stands at, from the round",
  waiting_on_me: "the reader acts next",
};
const TABLES = {
  RoundCounts: { table: null, reason: "a round's reviews counted by stage" },
  Round: { table: "performance_cycle", virtual: { counts: "its reviews counted by stage" } },
  RoundPage: { table: null, reason: "a page of rounds" },
  RoundListQuery: { table: null, reason: "list controls and filters for the rounds" },
  RoundCreate: { table: "performance_cycle" },
  Review: { table: "performance_review", virtual: REVIEW_VIRTUAL },
  ReviewPage: { table: null, reason: "a page of reviews" },
  ReviewListQuery: { table: null, reason: "list controls and filters for the reviews" },
  ItemLine: { table: "employee_target" },
  ReviewItem: {
    table: "performance_review_item",
    virtual: {
      line: "the scorecard line in employee_target_id",
      evidence_link: "linkFor(evidence_entity_type, evidence_entity_id)",
    },
  },
  ReviewTask: {
    table: "task",
    virtual: { bucket: "done, ongoing or due next month, from completed_at and due_at against the review's month" },
  },
  ReviewTaskCounts: { table: null, reason: "how many tasks each bucket holds" },
  ReviewContext: { table: null, reason: "the month's attendance and recognitions, counted from their own modules" },
  ReviewAction: {
    table: "performance_review_item",
    virtual: {
      title: "performance_review_item.corrective_title",
      owner: "the person in performance_review_item.corrective_owner_id",
      due_on: "performance_review_item.corrective_due_on",
      task_id: "performance_review_item.corrective_task_id",
      task_number: "the task's number",
      task_status: "the task's status",
    },
  },
  ReviewStep: { table: null, reason: "a step of the review's chain, from the review and its approval's decisions" },
  ReviewItemParams: { table: null, reason: "path parameters" },
  EvidenceUpload: { table: null, reason: "the multipart fields beside an evidence file" },
  ReviewAllowed: { table: null, reason: "what the reader may do now, worked out" },
  ReviewDetail: {
    table: "performance_review",
    virtual: {
      ...REVIEW_VIRTUAL,
      dotted: "the person in performance_review.dotted_employee_id",
      second_level: "the person in performance_review.second_level_employee_id",
      items: "its performance_review_item rows",
      tasks: "the employee's tasks of the month: done, ongoing and due next month",
      task_counts: "how many tasks each bucket holds",
      actions: "the corrective actions on its items",
      chain: "its steps, from the review and its approval's decisions",
      context: "the month's attendance and recognitions, for the reviewer, second level, Operations & People and the CEO",
      improvement_plan_id: "the improvement plan started from it, if any",
      can: "what the reader may do now",
    },
  },
  CorrectiveAction: {
    table: "performance_review_item",
    virtual: {
      title: "written to performance_review_item.corrective_title, then task.title",
      owner_employee_id: "written to corrective_owner_id, then task.primary_assignee_id",
      due_on: "written to corrective_due_on, then task.due_at: the end of that working day, Africa/Lagos",
    },
  },
  ItemScore: { table: "performance_review_item" },
  ReviewScoresSave: { table: null, reason: "the reviewer's scores and corrective actions" },
  ReviewInput: { table: "performance_review" },
  ReturnCheckIn: { table: "performance_review" },
  ConductMark: { table: "performance_review" },
  ProbationOutcome: {
    table: "performance_review",
    virtual: { note: "recorded on the decision, with the confirmation" },
  },
  ReviewCheckInItemSave: { table: "performance_review_item" },
  ReviewCheckIn: {
    table: "performance_review",
    virtual: {
      round_name: "performance_cycle.name",
      month: "performance_cycle.month",
      due_on: "the round's check-in deadline for the person",
      reviewer: "the person in performance_review.reviewer_employee_id",
      items: "its performance_review_item rows",
      tasks: "the employee's tasks of the month: done, ongoing and due next month",
      task_counts: "how many tasks each bucket holds",
    },
  },
  ReviewCheckInSave: { table: null, reason: "the employee's check-in items" },
  DictationRequest: { table: null, reason: "which text a recording is for" },
  Dictation: { table: null, reason: "a transcript, its recording and its run" },
  TidyRequest: { table: null, reason: "a text to tidy and what it is for" },
  TidyResult: { table: null, reason: "the tidied text beside the original" },
  PipLine: { table: "improvement_plan_line" },
  Pip: {
    table: "improvement_plan",
    virtual: {
      employee: "the person in improvement_plan.employee_id",
      lines: "its improvement_plan_line rows",
    },
  },
  PipPage: { table: null, reason: "a page of improvement plans" },
  PipListQuery: { table: null, reason: "list controls and filters for improvement plans" },
  PipLineInput: { table: "improvement_plan_line" },
  PipCreate: {
    table: "improvement_plan",
    virtual: { lines: "written as improvement_plan_line rows" },
  },
  PipEdit: {
    table: "improvement_plan",
    virtual: { lines: "replaces the improvement_plan_line rows" },
  },
  PipClose: { table: "improvement_plan" },
  ReviewSummaryLine: { table: null, reason: "a line of the review's PDF, as printed" },
  ReviewSummaryVars: { table: null, reason: "the variables of templates/documents/review-summary.html, not a row" },
};

module.exports = {
  TABLES,
  RoundStatus,
  RoundCounts,
  Round,
  RoundPage,
  RoundListQuery,
  RoundCreate,
  ReviewStatus,
  ReviewKind,
  ReviewType,
  EvidenceKind,
  Criterion,
  ProbationOutcomeCode,
  Review,
  ReviewPage,
  ReviewListQuery,
  ItemLine,
  ReviewItem,
  TaskBucket,
  ReviewTask,
  ReviewTaskCounts,
  ReviewContext,
  ReviewAction,
  ReviewStep,
  ReviewAllowed,
  ReviewDetail,
  ReviewItemParams,
  EvidenceUpload,
  CorrectiveAction,
  ItemScore,
  ReviewScoresSave,
  ReviewInput,
  ReturnCheckIn,
  ConductMark,
  ProbationOutcome,
  ReviewCheckInItemSave,
  ReviewCheckIn,
  ReviewCheckInSave,
  DictationRequest,
  Dictation,
  TidyRequest,
  TidyResult,
  PipStatus,
  PipLine,
  Pip,
  PipPage,
  PipListQuery,
  PipLineInput,
  PipCreate,
  PipEdit,
  PipClose,
  ReviewSummaryLine,
  ReviewSummaryVars,
};
