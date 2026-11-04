"use strict";
/**
 * Interviews: a round with one interview, its panel, each panelist's feedback, and the hiring
 * manager's consolidated report (docs/guides/recruitment.md §3 steps 8 to 10, §5, §6.6).
 *
 * THE CARD is MyCity's Interview Assessment Format (guide §6.6; TB, 04/11/2026): each panelist rates
 * every trait of the vacancy from 1 to 10 and decides Select, On Hold or Reject; comments are the
 * form's Others. Candidate Details are filled once for the whole panel.
 *
 * BLIND (A10, guide §6.6): while a round is open, a card is readable only by the person who wrote it,
 * the hiring manager and the CEO included. Everyone else reads who has submitted and nothing more:
 * `score`, `overall_rating`, `decision`, `comments` and `ratings` are null in a PanelSeat that is not
 * the reader's own, and `trait_averages` is empty, until the round closes. Private notes are only ever the
 * author's, in `my_feedback`, and never in `panel`.
 *
 * `:id` on every /recruitment/interviews route is an interview_id.
 */
const { z } = require("zod");
const { uuid, isoDateTime, blank, listQuery, Paged } = require("./common");
const { PersonRef } = require("./organisation");
const { VacancyRef, optionalWhole } = require("./vacancies");

/* ------------------------------------------------------------------ *
 * Code lists
 * ------------------------------------------------------------------ */

const InterviewType = z.enum(["in_person", "video", "phone"]);
const InterviewStatus = z.enum(["scheduled", "done", "cancelled"]);
const RoundStatus = z.enum(["open", "closed"]);
/** The card's final result: each panelist's own, and the consolidated report's. */
const InterviewDecision = z.enum(["select", "on_hold", "reject"]);
/** The card's Academics row. */
const Academics = z.enum(["outstanding", "very_good", "good", "average", "poor"]);

const rating = z.number().int().min(1, "1 to 10").max(10, "1 to 10");

/* ------------------------------------------------------------------ *
 * Parts
 * ------------------------------------------------------------------ */

/** A rating for one of the vacancy's interview questions. */
const QuestionRating = z
  .object({
    vacancy_question_id: uuid,
    rating,
  })
  .strict();

/** One seat on the panel. The scoring fields are null to everyone but its panelist while open. */
const PanelSeat = z
  .object({
    interview_panelist_id: uuid,
    panelist: PersonRef,
    submitted_at: isoDateTime.nullable(),
    /** The mean of their trait ratings (or their overall rating), 1 to 10. */
    score: z.number().min(1).max(10).nullable(),
    overall_rating: rating.nullable(),
    decision: InterviewDecision.nullable(),
    comments: z.string().nullable(),
    ratings: z.array(QuestionRating).max(20).nullable(),
  })
  .strict();

/** The reader's own feedback, draft or submitted, with their private notes. */
const MyFeedback = z
  .object({
    overall_rating: rating.nullable(),
    decision: InterviewDecision.nullable(),
    comments: z.string().nullable(),
    private_notes: z.string().nullable(),
    ratings: z.array(QuestionRating).max(20),
    submitted_at: isoDateTime.nullable(),
  })
  .strict();

/** The round: its state, its score once closed, and the consolidated report. */
const InterviewRound = z
  .object({
    interview_round_id: uuid,
    round_number: z.number().int().min(1),
    title: z.string(),
    status: RoundStatus,
    closed_at: isoDateTime.nullable(),
    interview_score: z.number().min(0).max(100).nullable(),
    report: z.string().nullable(),
    decision: InterviewDecision.nullable(),
    reported_by_name: z.string().nullable(),
    reported_at: isoDateTime.nullable(),
    /** Candidate Details, filled once for the panel. */
    current_employer: z.string().nullable(),
    academics: Academics.nullable(),
    total_experience_months: z.number().int().min(0).nullable(),
    relevant_experience_months: z.number().int().min(0).nullable(),
    /** The Interview Assessment Form PDF, once the report is written. */
    form_document_id: uuid.nullable(),
  })
  .strict();

/** One trait's mean across the panel, once the round is closed. */
const TraitAverage = z
  .object({
    vacancy_question_id: uuid,
    prompt: z.string(),
    average: z.number().min(1).max(10).nullable(),
  })
  .strict();

/** Where an in-person interview is: a worksite, never a typed address. */
const InterviewPlace = z
  .object({
    worksite_id: uuid,
    name: z.string(),
    address: z.string().nullable(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Staff: list and detail
 * ------------------------------------------------------------------ */

/** One row of Interviews. */
const Interview = z
  .object({
    interview_id: uuid,
    interview_round_id: uuid,
    application_id: uuid,
    candidate_name: z.string(),
    vacancy: VacancyRef,
    interview_type: InterviewType,
    scheduled_start: isoDateTime,
    scheduled_end: isoDateTime,
    status: InterviewStatus,
    round_status: RoundStatus,
    panel_size: z.number().int().min(0),
    submitted_count: z.number().int().min(0),
    on_panel: z.boolean(),
    my_submitted: z.boolean(),
  })
  .strict();

const InterviewPage = Paged(Interview);

/** One interview, as its sheet shows it to the reader. */
const InterviewDetail = Interview.extend({
  worksite: InterviewPlace.nullable(),
  meeting_url: z.string().nullable(),
  round: InterviewRound,
  panel: z.array(PanelSeat).max(8),
  questions: z.array(z.object({ vacancy_question_id: uuid, prompt: z.string() }).strict()).max(20),
  trait_averages: z.array(TraitAverage).max(20),
  /** The candidate's CV, which the panel may open. */
  cv_document_id: uuid.nullable(),
  my_feedback: MyFeedback.nullable(),
  can_edit: z.boolean(),
  can_close: z.boolean(),
  can_report: z.boolean(),
}).strict();

/** GET /recruitment/interviews. `mine=true` keeps the interviews the reader sits on. */
const InterviewListQuery = listQuery(
  {
    when: z.enum(["upcoming", "past"]).optional(),
    mine: z.enum(["true"]).optional(),
    application_id: uuid.optional(),
    status: InterviewStatus.optional(),
  },
  ["scheduled_start"],
);

/* ------------------------------------------------------------------ *
 * Staff: writes
 * ------------------------------------------------------------------ */

const httpsUrl = z
  .string()
  .trim()
  .max(500, "At most 500 characters")
  .url("A link starting https://")
  .refine((v) => v.startsWith("https://"), "A link starting https://");

const scheduleFields = {
  title: z.string().trim().max(120, "At most 120 characters").optional(),
  interview_type: InterviewType,
  scheduled_start: isoDateTime,
  scheduled_end: isoDateTime,
  worksite_id: uuid.optional(),
  meeting_url: httpsUrl.optional(),
  /** People who hold Recruitment (decided 04/11/2026); 1 to 8. */
  panel_employee_ids: z
    .array(uuid)
    .min(1, "Add at least one panelist")
    .max(8, "At most 8 panelists")
    .refine((ids) => new Set(ids).size === ids.length, "A person is on the panel twice"),
};

const endsAfterStart = (v) => !v.scheduled_start || !v.scheduled_end || v.scheduled_end > v.scheduled_start;
const placeForType = (v) => v.interview_type !== "in_person" || Boolean(v.worksite_id);
const linkForVideo = (v) => v.interview_type !== "video" || Boolean(v.meeting_url);

/** POST /recruitment/interviews: a new round with its interview and panel. */
const InterviewSchedule = z
  .object({ application_id: uuid, ...scheduleFields })
  .strict()
  .refine(endsAfterStart, { message: "Ends before it starts", path: ["scheduled_end"] })
  .refine(placeForType, { message: "Pick the worksite", path: ["worksite_id"] })
  .refine(linkForVideo, { message: "Add the meeting link", path: ["meeting_url"] });

/** PATCH /recruitment/interviews/:id: a new time, place or panel; everyone is sent the change. */
const InterviewReschedule = z
  .object(Object.fromEntries(Object.entries(scheduleFields).map(([k, s]) => [k, s.optional()])))
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Nothing to change",
    path: ["scheduled_start"],
  })
  .refine(endsAfterStart, { message: "Ends before it starts", path: ["scheduled_end"] });

/** POST /recruitment/interviews/:id/cancel. */
const InterviewCancel = z
  .object({ reason: z.string().trim().min(5, "Give a reason").max(500, "At most 500 characters") })
  .strict();

/**
 * PUT /recruitment/interviews/:id/feedback: the reader's own card, as a draft. Submit asks for every
 * trait rated (or the overall rating, for a vacancy with no traits) and a decision; until then any of
 * these may be empty. `comments` is the form's Others.
 */
const FeedbackSave = z
  .object({
    overall_rating: rating.nullable().optional(),
    decision: InterviewDecision.nullable().optional(),
    comments: z.string().trim().max(5000, "At most 5000 characters").optional(),
    private_notes: z.string().trim().max(5000, "At most 5000 characters").optional(),
    ratings: z.array(QuestionRating).max(20).optional(),
  })
  .strict();

/** PUT /recruitment/interviews/:id/report: the consolidated report and the decision, once closed. */
const RoundReport = z
  .object({
    report: z.string().trim().min(40, "At least 40 characters").max(10000, "At most 10000 characters"),
    decision: InterviewDecision,
  })
  .strict();

/** PUT /recruitment/interviews/:id/details: the card's Candidate Details, filled once for the panel. */
const RoundDetailsSave = z
  .object({
    current_employer: blank(z.string().trim().max(160, "At most 160 characters")),
    academics: Academics.optional(),
    total_experience_months: optionalWhole(0, 720, "At most 720 months"),
    relevant_experience_months: optionalWhole(0, 720, "At most 720 months"),
  })
  .strict()
  .refine(
    (v) =>
      v.total_experience_months === undefined ||
      v.relevant_experience_months === undefined ||
      v.relevant_experience_months <= v.total_experience_months,
    { message: "More than the total", path: ["relevant_experience_months"] },
  );

/* ------------------------------------------------------------------ *
 * Tidy With AI (interview-notes-cleanup, Default): nothing here is kept
 * ------------------------------------------------------------------ */

/** POST /recruitment/interviews/assist: the comments as written. */
const NotesTidyRequest = z
  .object({ text: z.string().trim().min(20, "Write a little more first").max(5000, "At most 5000 characters") })
  .strict();

/** The tidied text beside nothing else: the original stays on the screen until Use Tidied. */
const NotesTidy = z
  .object({
    available: z.boolean(),
    reason: z.enum(["off", "limit"]).nullable(),
    text: z.string().nullable(),
    ai_run_id: uuid.nullable(),
  })
  .strict();

/** The model's answer for `interview-notes-cleanup`. */
const NotesTidyOutput = z.object({ text: z.string().trim().min(1).max(6000) }).strict();

/** interview-invite: the candidate's invitation; the `.ics` rides as an attachment. */
const InterviewInviteEmailVars = z
  .object({
    vacancy_title: z.string(),
    interview_type: InterviewType,
    scheduled_start: isoDateTime,
    scheduled_end: isoDateTime,
    place: z.string().nullable(),
    meeting_url: z.string().nullable(),
    cancelled: z.boolean(),
  })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  QuestionRating: { table: "interview_rating" },
  PanelSeat: {
    table: "interview_panelist",
    virtual: {
      panelist: "the panelist, from employee and department",
      score: "the mean of their trait ratings, or their overall rating, once the reader may see it",
      overall_rating: "interview_feedback.overall_rating, once the reader may see it",
      decision: "interview_feedback.decision, once the reader may see it",
      comments: "interview_feedback.comments, once the reader may see it",
      ratings: "the feedback's interview_rating rows, once the reader may see them",
    },
  },
  MyFeedback: {
    table: "interview_feedback",
    virtual: { ratings: "the feedback's interview_rating rows" },
  },
  InterviewRound: {
    table: "interview_round",
    virtual: { reported_by_name: "the reporter's display name" },
  },
  InterviewPlace: {
    table: null,
    reason: "the worksite an in-person interview is at, from worksite",
  },
  Interview: {
    table: "interview",
    virtual: {
      application_id: "interview_round.application_id",
      candidate_name: "the candidate's first and last name",
      vacancy: "the vacancy's id, number and title",
      round_status: "interview_round.status",
      panel_size: "count of its panelists",
      submitted_count: "count of its panelists who submitted",
      on_panel: "the reader sits on its panel",
      my_submitted: "the reader is on its panel and has submitted",
    },
  },
  InterviewPage: { table: null, reason: "a page of interviews" },
  InterviewDetail: {
    table: "interview",
    virtual: {
      application_id: "interview_round.application_id",
      candidate_name: "the candidate's first and last name",
      vacancy: "the vacancy's id, number and title",
      round_status: "interview_round.status",
      panel_size: "count of its panelists",
      submitted_count: "count of its panelists who submitted",
      on_panel: "the reader sits on its panel",
      my_submitted: "the reader is on its panel and has submitted",
      worksite: "the worksite, for an interview in person",
      round: "the interview_round",
      panel: "its panelists, blind while the round is open (guide §6.6)",
      questions: "the vacancy's active traits",
      trait_averages: "each trait's mean across the submitted cards, once the round is closed",
      cv_document_id: "the application's CV, which the panel may open",
      my_feedback: "the reader's own interview_feedback, when they sit on the panel",
      can_edit: "the reader may reschedule or cancel it",
      can_close: "the round is open and the reader may edit it",
      can_report: "the round is closed and the reader is the hiring manager or may edit it",
    },
  },
  InterviewListQuery: { table: null, reason: "list controls and filters for Interviews" },
  InterviewSchedule: {
    table: "interview",
    virtual: {
      application_id: "the application the new interview_round is for",
      title: "interview_round.title",
      panel_employee_ids: "one interview_panelist row each",
    },
  },
  InterviewReschedule: {
    table: "interview",
    virtual: {
      title: "interview_round.title",
      panel_employee_ids: "the interview_panelist rows, replaced",
    },
  },
  InterviewCancel: { table: "interview", virtual: { reason: "kept on the audit row of the cancel" } },
  FeedbackSave: {
    table: "interview_feedback",
    virtual: { ratings: "the feedback's interview_rating rows, replaced" },
  },
  RoundReport: { table: "interview_round" },
  RoundDetailsSave: { table: "interview_round" },
  TraitAverage: { table: null, reason: "one trait's mean over interview_rating, once the round is closed" },
  NotesTidyRequest: { table: null, reason: "the comments as written; nothing is kept" },
  NotesTidy: { table: null, reason: "a tidied text shown before anything changes" },
  NotesTidyOutput: { table: null, reason: "the model's answer, checked before anyone sees it" },
  InterviewInviteEmailVars: { table: null, reason: "the variables of templates/email/interview-invite.html" },
};

module.exports = {
  TABLES,
  InterviewType,
  InterviewStatus,
  RoundStatus,
  InterviewDecision,
  Academics,
  TraitAverage,
  RoundDetailsSave,
  QuestionRating,
  PanelSeat,
  MyFeedback,
  InterviewRound,
  InterviewPlace,
  Interview,
  InterviewPage,
  InterviewDetail,
  InterviewListQuery,
  InterviewSchedule,
  InterviewReschedule,
  InterviewCancel,
  FeedbackSave,
  RoundReport,
  NotesTidyRequest,
  NotesTidy,
  NotesTidyOutput,
  InterviewInviteEmailVars,
};
