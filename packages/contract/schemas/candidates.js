"use strict";
/**
 * Candidates: a person who applied, and each of their applications as it moves through the
 * pipeline (docs/guides/recruitment.md §3 steps 4 to 6, 11 and 12, §5, §6.2 to §6.5, §6.8).
 *
 * The Candidates screen lists APPLICATIONS: `:id` on every /recruitment/candidates route is an
 * application_id. A person who applies to two roles is one candidate with two cards.
 *
 * Screening has two tiers (guide §6.4): `provisional_score` is the free estimate made when the
 * application arrives; `screening_score` is the AI read of the CV, made only when a person presses
 * Score With AI or Screen With AI. `score` is the one a screen shows, with `score_provisional` beside it:
 * every surface that shows a screening score shows Provisional while it is the estimate.
 *
 * The public shapes (ApplyLink, ApplicationSubmit, ApplicationReceipt) are allow-lists. An
 * application is write-only: the answer is a reference, never a score or a stage.
 */
const { z } = require("zod");
const { uuid, text, email, phone, isoDate, isoDateTime, listQuery, Paged } = require("./common");
const { DocumentRef } = require("./documents");
const { AssessmentType, SittingStatus } = require("./assessments");
const { InterviewStatus, RoundStatus } = require("./interviews");
const { ApplicationStage, ScorecardPart, VacancyRef, VacancyQuestionType, M4_STAGES } = require("./vacancies");

/* ------------------------------------------------------------------ *
 * Code lists
 * ------------------------------------------------------------------ */

/** active: in the pipeline. not_progressed: stopped with a reason (Reopen undoes it). hired: set by candidates.hireIn when M5's onboarding completes. */
const ApplicationStatus = z.enum(["active", "not_progressed", "withdrawn", "hired"]);
/** careers: the careers page. invited: Invite to Apply from Candidates. pool: Invite to Apply from the Talent Pool. */
const ApplicationSource = z.enum(["careers", "invited", "pool"]);
/** Where the CV's virus check stands; staff open a CV only when it is clean. */
const CvState = z.enum(["none", "checking", "clean", "infected"]);
/** The board's columns in M4 (decided 04/11/2026). */
const M4Stage = z.enum(M4_STAGES);

/**
 * The candidate emails Operations & People may edit (guide §6.8): M4's five, then the three M5 sends
 * (offer-sent, offer-signed, onboarding-documents), kept in the same store so one screen words them all.
 */
const CandidateEmailKey = z.enum([
  "application-received",
  "apply-invite",
  "assessment-invite",
  "interview-invite",
  "candidate-not-progressed",
  "offer-sent",
  "offer-signed",
  "onboarding-documents",
]);

/* ------------------------------------------------------------------ *
 * Staff: list, detail, summary
 * ------------------------------------------------------------------ */

/** One card on the Candidates board: an application. */
const Candidate = z
  .object({
    application_id: uuid,
    number: z.string(),
    candidate_id: uuid,
    name: z.string(),
    email: z.string(),
    vacancy: VacancyRef,
    stage: ApplicationStage,
    status: ApplicationStatus,
    source: ApplicationSource,
    applied_at: isoDateTime,
    current_stage_entered_at: isoDateTime,
    days_at_stage: z.number().int().min(0),
    score: z.number().min(0).max(100).nullable(),
    score_provisional: z.boolean(),
    weighted_total: z.number().min(0).max(100).nullable(),
    parts_scored: z.number().int().min(0).max(5),
    parts_active: z.number().int().min(1).max(5),
    cv_state: CvState,
    next_stages: z.array(M4Stage).max(5),
  })
  .strict();

const CandidatePage = Paged(Candidate);

/** An answer to one of the vacancy's Apply questions. */
const ApplicationAnswer = z
  .object({
    vacancy_question_id: uuid,
    prompt: z.string(),
    question_type: VacancyQuestionType,
    answer: z.string().nullable(),
  })
  .strict();

/** One move in the application's history (entity_state_history), with the time it spent there. */
const StageMove = z
  .object({
    from_state: z.string().nullable(),
    to_state: z.string(),
    changed_at: isoDateTime,
    actor_name: z.string().nullable(),
    reason: z.string().nullable(),
    days: z.number().int().min(0),
  })
  .strict();

/** An assessment sitting as a candidate's sheet lists it. */
const CandidateSitting = z
  .object({
    application_assessment_id: uuid,
    name: z.string(),
    assessment_type: AssessmentType,
    status: SittingStatus,
    score: z.number().min(0).max(100).nullable(),
    submitted_at: isoDateTime.nullable(),
  })
  .strict();

/** An interview as a candidate's sheet lists it; its score only once the round is closed. */
const CandidateInterview = z
  .object({
    interview_id: uuid,
    scheduled_start: isoDateTime,
    status: InterviewStatus,
    round_status: RoundStatus,
    interview_score: z.number().min(0).max(100).nullable(),
  })
  .strict();

/** One application, as its sheet shows it. */
const CandidateDetail = Candidate.extend({
  first_name: z.string(),
  last_name: z.string(),
  phone: z.string().nullable(),
  years_experience: z.number().int().min(0).nullable(),
  cover_letter: z.string().nullable(),
  cv: DocumentRef.nullable(),
  answers: z.array(ApplicationAnswer).max(20),
  provisional_score: z.number().min(0).max(100).nullable(),
  screening_score: z.number().min(0).max(100).nullable(),
  screening_summary: z.string().nullable(),
  screened_at: isoDateTime.nullable(),
  rejection_reason: z.string().nullable(),
  scorecard: z.array(ScorecardPart).length(5),
  assessments: z.array(CandidateSitting).max(20),
  interviews: z.array(CandidateInterview).max(20),
  history: z.array(StageMove).max(50),
  next_stages: z.array(M4Stage).max(5),
  can_edit: z.boolean(),
  can_not_progress: z.boolean(),
}).strict();

/** GET /recruitment/candidates. `sort=-weighted_total` ranks by the scorecard. */
const CandidateListQuery = listQuery(
  {
    stage: ApplicationStage.optional(),
    vacancy_id: uuid.optional(),
    status: ApplicationStatus.optional(),
  },
  ["weighted_total", "score", "applied_at", "current_stage_entered_at"],
);

/** GET /recruitment/candidates/summary. */
const CandidateSummaryQuery = z.object({ vacancy_id: uuid.optional() }).strict();

/** The four figures above the board, and the spread of screening scores, in the reader's scope. */
const CandidatesSummary = z
  .object({
    candidates: z.number().int().min(0),
    to_screen: z.number().int().min(0),
    in_interview: z.number().int().min(0),
    shortlisted: z.number().int().min(0),
    distribution: z
      .array(z.object({ label: z.string(), count: z.number().int().min(0) }).strict())
      .max(10),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Staff: writes
 * ------------------------------------------------------------------ */

/** POST /recruitment/candidates/:id/move: to a stage ahead, or one back (guide §6.3). */
const CandidateMove = z
  .object({
    stage: M4Stage,
    reason: z.string().trim().max(500, "At most 500 characters").optional(),
  })
  .strict();

/** POST /recruitment/candidates/:id/not-progressed. */
const CandidateNotProgressed = z
  .object({
    rejection_reason: z.string().trim().min(10, "Give a reason").max(1000, "At most 1000 characters"),
  })
  .strict();

/**
 * POST /recruitment/candidates/score-all (Screen With AI): the one to three must-meet conditions are
 * kept on the vacancy, then every active, unscored application of it is read in the background
 * (guide §6.4). Left out, the vacancy's kept conditions are used again.
 */
const ScoreAll = z
  .object({
    vacancy_id: uuid,
    screening_conditions: z
      .array(z.string().trim().min(3, "Write the condition").max(200, "At most 200 characters"))
      .min(1, "Give one condition")
      .max(3, "At most three conditions")
      .optional(),
  })
  .strict();
const ScoreAllQueued = z.object({ queued: z.number().int().min(0) }).strict();

/** POST /recruitment/candidates/invitations: email a person an Apply link for one vacancy. */
const ApplyInvite = z
  .object({
    first_name: text(80),
    last_name: text(80),
    email,
    vacancy_id: uuid,
  })
  .strict();

const ApplyInviteSent = z
  .object({
    email: z.string(),
    expires_at: isoDateTime,
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Candidate emails (guide §6.8): template_version, kind email
 * ------------------------------------------------------------------ */

/** One candidate email as Candidate Emails lists and edits it. `body` is Markdown. */
const CandidateEmail = z
  .object({
    key: CandidateEmailKey,
    name: z.string(),
    subject: z.string(),
    body: z.string(),
    version: z.number().int().min(0),
    is_default: z.boolean(),
    variables: z.array(z.string()).max(20),
    updated_at: isoDateTime.nullable(),
    can_edit: z.boolean(),
  })
  .strict();

const CandidateEmailPage = Paged(CandidateEmail);
const CandidateEmailListQuery = listQuery({});

/** Path of /recruitment/candidates/emails/:key. */
const CandidateEmailParams = z.object({ key: CandidateEmailKey }).strict();

/** PUT /recruitment/candidates/emails/:key: saved as the next version. */
const CandidateEmailSave = z
  .object({
    subject: z.string().trim().min(3, "Write the subject").max(200, "At most 200 characters"),
    body: z.string().trim().min(20, "Write the email").max(20000, "Too long"),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Score With AI (cv-screen, guide §6.4)
 * ------------------------------------------------------------------ */

/** The model's answer for `cv-screen`: a score and what it could not verify. */
const CvScreenOutput = z
  .object({
    score: z.number().int().min(0).max(100),
    summary: z.string().trim().min(10).max(2000),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Public: go.mycityapp.io/apply/<token> (allow-lists, guide §6.2)
 * ------------------------------------------------------------------ */

/** One of the vacancy's Apply questions, as the form asks it. */
const ApplyQuestion = z
  .object({
    vacancy_question_id: uuid,
    question_type: VacancyQuestionType,
    prompt: z.string(),
    options: z.array(z.string()).nullable(),
    required: z.boolean(),
  })
  .strict();

/** GET /api/public/v1/apply/:token: the role as the form's pane names it, its questions, and when the link lapses. */
const ApplyLink = z
  .object({
    vacancy_title: z.string(),
    vacancy_department: z.string().nullable(),
    /** The role's place line; null for a remote role. */
    vacancy_location: z.string().nullable(),
    expires_at: isoDateTime,
    questions: z.array(ApplyQuestion).max(10),
  })
  .strict();

/** POST /api/public/v1/apply/:token. `full_name` is split into first and last name. */
const ApplicationSubmit = z
  .object({
    full_name: z
      .string()
      .trim()
      .max(160, "At most 160 characters")
      .refine((v) => v.split(/\s+/).filter(Boolean).length >= 2, "First and last name"),
    email,
    phone,
    years_experience: z
      .number({ invalid_type_error: "A whole number of years" })
      .int("A whole number of years")
      .min(0, "A whole number of years")
      .max(60, "At most 60"),
    cv_document_id: uuid,
    cover_letter: z
      .string()
      .trim()
      .min(20, "At least 20 characters")
      .max(3000, "At most 3000 characters"),
    answers: z.record(uuid, z.string().trim().max(2000, "At most 2000 characters")).default({}),
    consent: z.literal(true, { errorMap: () => ({ message: "Tick to agree" }) }),
  })
  .strict();

/**
 * POST /api/public/v1/apply/:token/cv: the text field beside the CV in the multipart. The page's one
 * upload engine sends the purpose it uploads under; the route fixes `cv` whatever is sent, so only
 * that purpose is accepted, and leaving it out is fine.
 */
const CvUpload = z.object({ purpose: z.literal("cv").optional() }).strict();

/**
 * What applying answers: a reference to quote, never the row. `already_applied`: this email had
 * applied for this role before, so nothing new was made; `reference` and `submitted_at` are the
 * first application's, and Apply says so instead of Application Sent (GE, 08/11/2026).
 */
const ApplicationReceipt = z
  .object({
    reference: z.string(),
    submitted_at: isoDateTime,
    already_applied: z.boolean(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Email variables (templates/email/*.html, P7)
 * ------------------------------------------------------------------ */

/** application-received: sent to the candidate when an application commits. */
const ApplicationReceivedEmailVars = z
  .object({ vacancy_title: z.string(), reference: z.string() })
  .strict();

/** apply-invite: Invite to Apply. */
const ApplyInviteEmailVars = z
  .object({ vacancy_title: z.string(), apply_url: z.string(), expires_at: isoDateTime })
  .strict();

/** candidate-not-progressed: Not Progressing. The reason is kept on the record, not sent. `careers_url`: the public /jobs page. */
const CandidateNotProgressedEmailVars = z.object({ vacancy_title: z.string(), careers_url: z.string() }).strict();

/**
 * offer-sent (M5 sends it): the offer is ready to sign. `reference`: the offer's number (OFF-0018);
 * `sign_url`: the public /sign/<token> link; `expires_at`: when the link and the offer lapse.
 */
const OfferSentEmailVars = z
  .object({ vacancy_title: z.string(), reference: z.string(), sign_url: z.string(), expires_at: isoDateTime })
  .strict();

/**
 * offer-signed (M5): the candidate signed. `verify_url`: the public /verify/<number> page for the
 * signed letter; `start_on`: the agreed first day, when it is set.
 */
const OfferSignedEmailVars = z
  .object({ vacancy_title: z.string(), reference: z.string(), verify_url: z.string(), start_on: isoDate.nullable() })
  .strict();

/**
 * onboarding-documents (M5): the documents to send before the first day. `documents_url`: the public
 * page that takes them; `due_on`: the day they are needed by, when it is set.
 */
const OnboardingDocumentsEmailVars = z
  .object({ vacancy_title: z.string(), documents_url: z.string(), due_on: isoDate.nullable() })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  Candidate: {
    table: "application",
    virtual: {
      name: "the candidate's first and last name",
      email: "candidate.email",
      vacancy: "the vacancy's id, number and title",
      days_at_stage: "whole Lagos days since current_stage_entered_at",
      score: "screening_score, or provisional_score while there is none",
      score_provisional: "true while score is provisional_score",
      weighted_total: "the scorecard over the parts scored (guide §6.5)",
      parts_scored: "how many of the parts switched on have a score",
      parts_active: "how many of the vacancy's five parts are switched on",
      cv_state: "from the CV document's scan_status",
      next_stages: "the stages it may move to now on its role's board (guide §6.3)",
    },
  },
  CandidatePage: { table: null, reason: "a page of applications" },
  ApplicationAnswer: { table: null, reason: "one answer of application.answers (jsonb) beside its question" },
  StageMove: { table: null, reason: "one entity_state_history row of the application, with its days" },
  CandidateSitting: { table: null, reason: "an application_assessment as the candidate's sheet lists it" },
  CandidateInterview: { table: null, reason: "an interview and its round as the candidate's sheet lists it" },
  CandidateDetail: {
    table: "application",
    virtual: {
      name: "the candidate's first and last name",
      email: "candidate.email",
      vacancy: "the vacancy's id, number and title",
      days_at_stage: "whole Lagos days since current_stage_entered_at",
      score: "screening_score, or provisional_score while there is none",
      score_provisional: "true while score is provisional_score",
      weighted_total: "the scorecard over the parts scored (guide §6.5)",
      parts_scored: "how many of the parts switched on have a score",
      parts_active: "how many of the vacancy's five parts are switched on",
      cv_state: "from the CV document's scan_status",
      first_name: "candidate.first_name",
      last_name: "candidate.last_name",
      phone: "candidate.phone",
      cv: "the CV document",
      answers: "application.answers beside the vacancy's Apply questions",
      scorecard: "the five parts (guide §6.5)",
      assessments: "the application's sittings",
      interviews: "the application's interviews",
      history: "entity_state_history for the application",
      next_stages: "the stages it may move to now (guide §6.3)",
      can_edit: "the reader may move it: in scope with recruitment edit, and active",
      can_not_progress: "the reader may mark it Not Progressing: in scope with recruitment edit and in progress, the role open or closed",
    },
  },
  CandidateListQuery: { table: null, reason: "list controls and filters for Candidates" },
  CandidateSummaryQuery: { table: null, reason: "the vacancy filter of the summary" },
  CandidatesSummary: { table: null, reason: "counts over application within the reader's scope" },
  CandidateMove: {
    table: "application",
    virtual: { reason: "kept on the entity_state_history row of the move" },
  },
  CandidateNotProgressed: { table: "application" },
  ScoreAll: {
    table: "application",
    virtual: { screening_conditions: "kept on vacancy.screening_conditions before the reads are queued" },
  },
  ScoreAllQueued: { table: null, reason: "how many AI reads were queued" },
  ApplyInvite: {
    table: "candidate",
    virtual: { vacancy_id: "the vacancy the Apply link is for" },
  },
  ApplyInviteSent: { table: null, reason: "where the invitation went and when its link lapses" },
  CandidateEmail: {
    table: "template_version",
    virtual: {
      name: "the email's name on Candidate Emails",
      is_default: "version 0, the shipped file",
      variables: "the names the email may use, from its declared variables",
      updated_at: "template_version.created_at of the current version",
      can_edit: "the reader may word it: recruitment edit over every vacancy",
    },
  },
  CandidateEmailPage: { table: null, reason: "the five candidate emails" },
  CandidateEmailListQuery: { table: null, reason: "list controls for Candidate Emails" },
  CandidateEmailParams: { table: null, reason: "the :key path parameter" },
  CandidateEmailSave: { table: "template_version" },
  CvScreenOutput: { table: null, reason: "the model's answer, checked before it is kept" },
  ApplyQuestion: { table: "vacancy_question" },
  ApplyLink: { table: null, reason: "the allow-list an Apply link reads" },
  ApplicationSubmit: {
    table: "application",
    virtual: {
      full_name: "split into candidate.first_name and last_name",
      email: "candidate.email",
      phone: "candidate.phone",
      consent: "stamped as consented_at",
    },
  },
  ApplicationReceipt: { table: null, reason: "the reference a candidate is given; nothing else is read back" },
  CvUpload: { table: null, reason: "the upload's purpose, beside the CV file" },
  ApplicationReceivedEmailVars: { table: null, reason: "the variables of templates/email/application-received.html" },
  ApplyInviteEmailVars: { table: null, reason: "the variables of templates/email/apply-invite.html" },
  CandidateNotProgressedEmailVars: { table: null, reason: "the variables of templates/email/candidate-not-progressed.html" },
  OfferSentEmailVars: { table: null, reason: "the variables of templates/email/offer-sent.html" },
  OfferSignedEmailVars: { table: null, reason: "the variables of templates/email/offer-signed.html" },
  OnboardingDocumentsEmailVars: { table: null, reason: "the variables of templates/email/onboarding-documents.html" },
};

module.exports = {
  TABLES,
  ApplicationStatus,
  ApplicationSource,
  CvState,
  M4Stage,
  CandidateEmailKey,
  Candidate,
  CandidatePage,
  ApplicationAnswer,
  StageMove,
  CandidateSitting,
  CandidateInterview,
  CandidateDetail,
  CandidateListQuery,
  CandidateSummaryQuery,
  CandidatesSummary,
  CandidateMove,
  CandidateNotProgressed,
  ScoreAll,
  ScoreAllQueued,
  ApplyInvite,
  ApplyInviteSent,
  CandidateEmail,
  CandidateEmailPage,
  CandidateEmailListQuery,
  CandidateEmailParams,
  CandidateEmailSave,
  CvScreenOutput,
  ApplyQuestion,
  ApplyLink,
  ApplicationSubmit,
  ApplicationReceipt,
  CvUpload,
  ApplicationReceivedEmailVars,
  ApplyInviteEmailVars,
  CandidateNotProgressedEmailVars,
  OfferSentEmailVars,
  OfferSignedEmailVars,
  OnboardingDocumentsEmailVars,
};
