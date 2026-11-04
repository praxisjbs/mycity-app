"use strict";
/**
 * Assessments: tests and case studies written once, sent to a candidate as a sitting, taken on the
 * public site under a server timer, and scored (docs/guides/recruitment.md §3 step 7, §5, §6.7).
 *
 * Question types (decided 04/11/2026): choice, scored by the points of the option picked (which
 * covers right or wrong answers and psychometric scales); text and file, marked by hand. An
 * option's points are kept encrypted in assessment_question.answer_key_enc and only ever sent to
 * staff; no public shape here carries them.
 *
 * A sitting (application_assessment) moves sent → in_progress → submitted or timed_out → scored;
 * a sitting never started by its start-by day is expired; one stopped by staff is cancelled.
 */
const { z } = require("zod");
const { uuid, isoDate, isoDateTime, listQuery, Paged } = require("./common");
const { DocumentRef } = require("./documents");
const { optionalWhole } = require("./vacancies");

/* ------------------------------------------------------------------ *
 * Code lists
 * ------------------------------------------------------------------ */

const AssessmentType = z.enum(["psychometric", "technical", "case_study", "practical"]);
const AssessmentQuestionType = z.enum(["choice", "text", "file"]);
/** Derived from the questions: all choice is auto, none is manual, some is mixed. */
const ScoringMethod = z.enum(["auto", "manual", "mixed"]);
const SittingStatus = z.enum(["sent", "in_progress", "submitted", "timed_out", "scored", "expired", "cancelled"]);

/* ------------------------------------------------------------------ *
 * Staff: definitions
 * ------------------------------------------------------------------ */

/** One option of a choice question, with its points (staff only). */
const AssessmentOption = z
  .object({
    id: z.string(),
    text: z.string(),
    points: z.number().min(0).max(100),
  })
  .strict();

/** One question, as staff read it. */
const AssessmentQuestion = z
  .object({
    assessment_question_id: uuid,
    question_type: AssessmentQuestionType,
    prompt: z.string(),
    options: z.array(AssessmentOption).nullable(),
    max_score: z.number().min(0).max(100),
    display_order: z.number().int().min(0),
  })
  .strict();

/** One row of Assessments. */
const Assessment = z
  .object({
    assessment_definition_id: uuid,
    code: z.string(),
    name: z.string(),
    assessment_type: AssessmentType,
    duration_minutes: z.number().int().min(1).nullable(),
    pass_score: z.number().min(0).max(100).nullable(),
    scoring_method: ScoringMethod,
    active: z.boolean(),
    question_count: z.number().int().min(0),
    sent: z.number().int().min(0),
    average_score: z.number().min(0).max(100).nullable(),
    created_at: isoDateTime,
  })
  .strict();

const AssessmentPage = Paged(Assessment);

/** One assessment with its questions. `in_use`: it has been sent, so its questions are fixed. */
const AssessmentDetail = Assessment.extend({
  instructions: z.string().nullable(),
  questions: z.array(AssessmentQuestion).max(60),
  in_use: z.boolean(),
}).strict();

/** GET /recruitment/assessments. */
const AssessmentListQuery = listQuery(
  {
    assessment_type: AssessmentType.optional(),
    active: z.enum(["true", "false"]).optional(),
  },
  ["name", "created_at"],
);

/** GET /recruitment/assessments/summary. */
const AssessmentsSummary = z
  .object({
    active: z.number().int().min(0),
    sent: z.number().int().min(0),
    awaiting_marking: z.number().int().min(0),
    average_score: z.number().min(0).max(100).nullable(),
    by_assessment: z
      .array(z.object({ label: z.string(), value: z.number().min(0).max(100) }).strict())
      .max(10),
  })
  .strict();

const assessmentFields = {
  name: z.string().trim().min(3, "Name the assessment").max(120, "At most 120 characters"),
  assessment_type: AssessmentType,
  /** Minutes for a timed test; left empty, it is an untimed take-home brief due by a day (guide §6.7). */
  duration_minutes: optionalWhole(5, 240, "At most 240 minutes"),
  instructions: z.string().trim().min(10, "Tell candidates what to do").max(3000, "At most 3000 characters"),
  pass_score: optionalWhole(0, 100, "At most 100"),
};

/** POST /recruitment/assessments: a new assessment, inactive until it has questions. */
const AssessmentCreate = z.object(assessmentFields).strict();

/** PATCH /recruitment/assessments/:id. */
const AssessmentEdit = z
  .object(Object.fromEntries(Object.entries(assessmentFields).map(([k, s]) => [k, s.optional()])))
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to change", path: ["name"] });

/** One question as the Questions form sends it. A choice's best option sets its max_score. */
const AssessmentQuestionInput = z
  .object({
    question_type: AssessmentQuestionType,
    prompt: z.string().trim().min(5, "Write the question").max(4000, "At most 4000 characters"),
    options: z
      .array(
        z
          .object({
            text: z.string().trim().min(1, "Write the option").max(300, "At most 300 characters"),
            points: z.coerce.number().min(0, "0 or more").max(100, "At most 100"),
          })
          .strict(),
      )
      .min(2, "At least two options")
      .max(8, "At most eight options")
      .optional(),
    max_score: z.coerce.number().min(1, "At least 1").max(100, "At most 100").optional(),
  })
  .strict()
  .refine((q) => (q.question_type === "choice") === Boolean(q.options), {
    message: "Only a choice has options",
    path: ["options"],
  })
  .refine((q) => q.question_type === "choice" || q.max_score !== undefined, {
    message: "Give the most it can score",
    path: ["max_score"],
  })
  .refine((q) => !q.options || q.options.some((o) => o.points > 0), {
    message: "One option must score",
    path: ["options"],
  });

/** PUT /recruitment/assessments/:id/questions: the whole set, in order. Refused once it is in use. */
const AssessmentQuestionsSave = z
  .object({ questions: z.array(AssessmentQuestionInput).min(1, "Add a question").max(60, "At most 60 questions") })
  .strict();

/* ------------------------------------------------------------------ *
 * Suggest With AI (assessment-questions, Default): nothing here is kept
 * ------------------------------------------------------------------ */

/** POST /recruitment/assessments/assist. */
const AssessmentDraftRequest = z
  .object({
    assessment_type: AssessmentType,
    vacancy_id: uuid.optional(),
    instruction: z.string().trim().min(10, "Say what it should test").max(2000, "At most 2000 characters"),
    count: z.coerce.number().int().min(3, "At least 3").max(15, "At most 15").default(8),
  })
  .strict();

/** A suggested question, in the shape the Questions form takes. */
const SuggestedAssessmentQuestion = z
  .object({
    question_type: AssessmentQuestionType,
    prompt: z.string().trim().min(5).max(4000),
    options: z
      .array(z.object({ text: z.string().trim().min(1).max(300), points: z.number().min(0).max(100) }).strict())
      .min(2)
      .max(8)
      .nullable(),
    max_score: z.number().min(1).max(100).nullable(),
  })
  .strict();

const AssessmentDraft = z
  .object({
    available: z.boolean(),
    reason: z.enum(["off", "limit"]).nullable(),
    questions: z.array(SuggestedAssessmentQuestion).max(15),
    ai_run_id: uuid.nullable(),
  })
  .strict();

/** The model's answer for `assessment-questions`. */
const AssessmentDraftOutput = z
  .object({ questions: z.array(SuggestedAssessmentQuestion).min(1).max(15) })
  .strict();

/* ------------------------------------------------------------------ *
 * Staff: sittings
 * ------------------------------------------------------------------ */

/** One row of Assessments · Sittings. `to_mark`: written and file answers still without a mark. */
const Sitting = z
  .object({
    due_days: z.number().int().min(1).max(14).nullable(),
    application_assessment_id: uuid,
    application_id: uuid,
    candidate_name: z.string(),
    vacancy_title: z.string(),
    assessment_definition_id: uuid,
    assessment_name: z.string(),
    assessment_type: AssessmentType,
    status: SittingStatus,
    start_by: isoDate,
    started_at: isoDateTime.nullable(),
    due_at: isoDateTime.nullable(),
    submitted_at: isoDateTime.nullable(),
    score: z.number().min(0).max(100).nullable(),
    to_mark: z.number().int().min(0),
  })
  .strict();

const SittingPage = Paged(Sitting);

/** One answer in a sitting, beside its question and what it scored. */
const SittingAnswer = z
  .object({
    assessment_question_id: uuid,
    question_type: AssessmentQuestionType,
    prompt: z.string(),
    options: z.array(AssessmentOption).nullable(),
    max_score: z.number().min(0).max(100),
    response: z.string().nullable(),
    document: DocumentRef.nullable(),
    awarded_score: z.number().min(0).max(100).nullable(),
    reviewer_comment: z.string().nullable(),
    marked_at: isoDateTime.nullable(),
  })
  .strict();

const SittingDetail = Sitting.extend({
  answers: z.array(SittingAnswer).max(60),
  can_mark: z.boolean(),
  can_cancel: z.boolean(),
}).strict();

/** GET /recruitment/assessments/sittings. `marking=true` keeps those with answers to mark. */
const SittingListQuery = listQuery(
  {
    status: SittingStatus.optional(),
    application_id: uuid.optional(),
    marking: z.enum(["true"]).optional(),
  },
  ["submitted_at", "start_by", "created_at"],
);

/** POST /recruitment/assessments/sittings: send an active assessment to a candidate. */
const SittingSend = z
  .object({
    application_id: uuid,
    assessment_definition_id: uuid,
    /** Days the candidate has to start it; the link lapses at 23:59 Lagos time on the last. */
    start_within_days: z.coerce.number().int().min(1, "At least 1 day").max(14, "At most 14 days").default(3),
    /** An untimed assessment only: days after Start it is due, at 23:59 Lagos time. */
    due_days: optionalWhole(1, 14, "At most 14 days"),
  })
  .strict();

/**
 * POST /recruitment/assessments/sittings/bulk (Send to Candidates): one assessment to every active
 * candidate of a vacancy at a stage who has no live sitting of it.
 */
const SittingSendBulk = z
  .object({
    vacancy_id: uuid,
    assessment_definition_id: uuid,
    stage: z.enum(["application", "screening", "assessment", "interview", "shortlist"]).default("assessment"),
    start_within_days: z.coerce.number().int().min(1, "At least 1 day").max(14, "At most 14 days").default(3),
    due_days: optionalWhole(1, 14, "At most 14 days"),
  })
  .strict();

/** How many were sent, and how many already had a live sitting of it. */
const SittingSendBulkResult = z
  .object({
    sent: z.number().int().min(0),
    skipped: z.number().int().min(0),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Export and import (guide §6.7): an assessment approved on staging carried to production
 * ------------------------------------------------------------------ */

/** GET /recruitment/assessments/:id/export, and the body of POST /recruitment/assessments/import. */
const AssessmentExport = z
  .object({
    format: z.literal("mycity-assessment-1"),
    name: assessmentFields.name,
    assessment_type: AssessmentType,
    duration_minutes: z.number().int().min(5).max(240).nullable(),
    instructions: assessmentFields.instructions,
    pass_score: z.number().min(0).max(100).nullable(),
    questions: z.array(AssessmentQuestionInput).min(1).max(60),
  })
  .strict();

/** PUT /recruitment/assessments/sittings/:id/marks: marks for written and file answers. */
const SittingMarks = z
  .object({
    marks: z
      .array(
        z
          .object({
            assessment_question_id: uuid,
            awarded_score: z.coerce.number().min(0, "0 or more").max(100, "At most 100"),
            reviewer_comment: z.string().trim().max(1000, "At most 1000 characters").optional(),
          })
          .strict(),
      )
      .min(1, "Give a mark")
      .max(60),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Public: go.mycityapp.io/assess/<token> (allow-lists)
 * ------------------------------------------------------------------ */

/** A question as the candidate sees it: no points, no key. */
const PublicQuestion = z
  .object({
    assessment_question_id: uuid,
    n: z.number().int().min(1),
    question_type: AssessmentQuestionType,
    prompt: z.string(),
    options: z.array(z.object({ id: z.string(), text: z.string() }).strict()).nullable(),
    /** The saved answer, so a reopened link resumes as it was: a choice id or the text. */
    answer: z.string().nullable(),
    /** A file answer's name, once one is uploaded. */
    file_name: z.string().nullable(),
  })
  .strict();

/**
 * GET /api/public/v1/assess/:token. The timer runs on the server: `ends_at` and `server_now` let the
 * page count down from the server's clock, never the device's. `questions` is null until started.
 */
const AssessmentSession = z
  .object({
    candidate_first_name: z.string(),
    vacancy_title: z.string(),
    assessment: z
      .object({
        name: z.string(),
        assessment_type: AssessmentType,
        /** Null for an untimed take-home brief, due by a day instead. */
        duration_minutes: z.number().int().min(1).nullable(),
        question_count: z.number().int().min(0),
        instructions: z.string().nullable(),
      })
      .strict(),
    state: z.enum(["not_started", "in_progress", "submitted", "timed_out"]),
    /** False for a take-home brief: `ends_at` is then the due day's 23:59, shown as a day, not a clock. */
    timed: z.boolean(),
    start_by: isoDate,
    ends_at: isoDateTime.nullable(),
    server_now: isoDateTime,
    current_question: z.number().int().min(0),
    questions: z.array(PublicQuestion).max(60).nullable(),
    submitted_at: isoDateTime.nullable(),
  })
  .strict();

/** Path of /assess/:token/answers/:question_id. */
const AnswerParams = z.object({ token: z.string().min(1).max(100), question_id: uuid }).strict();

/** PUT /api/public/v1/assess/:token/answers/:question_id. `current_question` is where to resume. */
const AnswerSave = z
  .object({
    answer: z.string().max(20000, "Too long"),
    current_question: z.number().int().min(0).max(59),
  })
  .strict();

/** What saving an answer (or a file answer) says back. */
const AnswerSaved = z
  .object({
    saved_at: isoDateTime,
    file_name: z.string().nullable(),
  })
  .strict();

/** assessment-invite: sent with the link. */
const AssessmentInviteEmailVars = z
  .object({
    vacancy_title: z.string(),
    assessment_name: z.string(),
    duration_minutes: z.number().int(),
    start_by: isoDate,
    assess_url: z.string(),
  })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  AssessmentOption: { table: null, reason: "one option of assessment_question.options, its points from answer_key_enc" },
  AssessmentQuestion: {
    table: "assessment_question",
    virtual: { options: "options beside the points decrypted from answer_key_enc" },
  },
  Assessment: {
    table: "assessment_definition",
    virtual: {
      question_count: "count of its questions",
      sent: "count of its sittings",
      average_score: "the mean score of its scored sittings",
    },
  },
  AssessmentPage: { table: null, reason: "a page of assessments" },
  AssessmentDetail: {
    table: "assessment_definition",
    virtual: {
      question_count: "count of its questions",
      sent: "count of its sittings",
      average_score: "the mean score of its scored sittings",
      questions: "the assessment_question rows",
      in_use: "it has at least one sitting",
    },
  },
  AssessmentListQuery: { table: null, reason: "list controls and filters for Assessments" },
  AssessmentsSummary: { table: null, reason: "counts over assessment_definition and application_assessment" },
  AssessmentCreate: { table: "assessment_definition" },
  AssessmentEdit: { table: "assessment_definition" },
  AssessmentQuestionInput: {
    table: "assessment_question",
    virtual: { options: "texts kept in options, points encrypted in answer_key_enc" },
  },
  AssessmentQuestionsSave: { table: null, reason: "the whole set of an assessment's questions" },
  AssessmentDraftRequest: {
    table: null,
    reason: "what the person asks Suggest With AI for; nothing is kept",
  },
  SuggestedAssessmentQuestion: { table: null, reason: "a question the model suggests; nothing is kept" },
  AssessmentDraft: { table: null, reason: "suggested questions shown before anything changes" },
  AssessmentDraftOutput: { table: null, reason: "the model's answer, checked before anyone sees it" },
  Sitting: {
    table: "application_assessment",
    virtual: {
      candidate_name: "the candidate's first and last name",
      vacancy_title: "vacancy.title",
      assessment_name: "assessment_definition.name",
      assessment_type: "assessment_definition.assessment_type",
      to_mark: "text and file answers with no awarded_score",
    },
  },
  SittingPage: { table: null, reason: "a page of sittings" },
  SittingAnswer: { table: null, reason: "an assessment_response beside its question" },
  SittingDetail: {
    table: "application_assessment",
    virtual: {
      candidate_name: "the candidate's first and last name",
      vacancy_title: "vacancy.title",
      assessment_name: "assessment_definition.name",
      assessment_type: "assessment_definition.assessment_type",
      to_mark: "text and file answers with no awarded_score",
      answers: "every question of the assessment beside its response",
      can_mark: "submitted or timed out, and the reader may edit it",
      can_cancel: "not yet submitted, and the reader may edit it",
    },
  },
  SittingListQuery: { table: null, reason: "list controls and filters for Sittings" },
  SittingSend: {
    table: "application_assessment",
    virtual: { start_within_days: "kept as start_by, that many Lagos days from today" },
  },
  SittingSendBulk: { table: null, reason: "one sitting for each matching application" },
  SittingSendBulkResult: { table: null, reason: "how many sittings were sent and skipped" },
  AssessmentExport: { table: null, reason: "an assessment and its questions as one file, for import elsewhere" },
  SittingMarks: { table: null, reason: "marks for several assessment_response rows" },
  PublicQuestion: { table: null, reason: "the allow-list of a question a candidate may read" },
  AssessmentSession: { table: null, reason: "the allow-list of a sitting a candidate may read" },
  AnswerParams: { table: null, reason: "the :token and :question_id path parameters" },
  AnswerSave: {
    table: null,
    reason: "one answer (assessment_response.response) and where to resume (application_assessment.current_question)",
  },
  AnswerSaved: { table: null, reason: "when an answer was saved" },
  AssessmentInviteEmailVars: { table: null, reason: "the variables of templates/email/assessment-invite.html" },
};

module.exports = {
  TABLES,
  AssessmentType,
  AssessmentQuestionType,
  ScoringMethod,
  SittingStatus,
  AssessmentOption,
  AssessmentQuestion,
  Assessment,
  AssessmentPage,
  AssessmentDetail,
  AssessmentListQuery,
  AssessmentsSummary,
  AssessmentCreate,
  AssessmentEdit,
  AssessmentQuestionInput,
  AssessmentQuestionsSave,
  AssessmentDraftRequest,
  SuggestedAssessmentQuestion,
  AssessmentDraft,
  AssessmentDraftOutput,
  Sitting,
  SittingPage,
  SittingAnswer,
  SittingDetail,
  SittingListQuery,
  SittingSend,
  SittingMarks,
  SittingSendBulk,
  SittingSendBulkResult,
  AssessmentExport,
  PublicQuestion,
  AssessmentSession,
  AnswerParams,
  AnswerSave,
  AnswerSaved,
  AssessmentInviteEmailVars,
};
