"use strict";
/**
 * Interviews: a round with one interview, its panel, each panelist's feedback, and the hiring
 * manager's consolidated report (docs/guides/recruitment.md §3 steps 8 to 10, §5, §6.6).
 *
 * BLIND (A10, guide §6.6): while a round is open, a feedback row is readable only by the person who
 * wrote it, the hiring manager and the CEO included. Everyone else reads who has submitted and
 * nothing more: `overall_rating`, `recommendation`, `comments` and `ratings` are null in a
 * PanelSeat that is not the reader's own until the round closes. Private notes are only ever the
 * author's, in `my_feedback`, and never in `panel`.
 *
 * `:id` on every /recruitment/interviews route is an interview_id.
 */
const { z } = require("zod");
const { uuid, isoDateTime, listQuery, Paged } = require("./common");
const { PersonRef } = require("./organisation");
const { VacancyRef } = require("./vacancies");

/* ------------------------------------------------------------------ *
 * Code lists
 * ------------------------------------------------------------------ */

const InterviewType = z.enum(["in_person", "video", "phone"]);
const InterviewStatus = z.enum(["scheduled", "done", "cancelled"]);
const RoundStatus = z.enum(["open", "closed"]);
/** A panelist's own call. */
const PanelRecommendation = z.enum(["strong_yes", "yes", "no", "strong_no"]);
/** The consolidated report's call. */
const RoundRecommendation = z.enum(["advance", "hold", "not_progress"]);

const rating = z.number().int().min(1, "1 to 5").max(5, "1 to 5");

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
    overall_rating: rating.nullable(),
    recommendation: PanelRecommendation.nullable(),
    comments: z.string().nullable(),
    ratings: z.array(QuestionRating).max(20).nullable(),
  })
  .strict();

/** The reader's own feedback, draft or submitted, with their private notes. */
const MyFeedback = z
  .object({
    overall_rating: rating.nullable(),
    recommendation: PanelRecommendation.nullable(),
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
    recommendation: RoundRecommendation.nullable(),
    reported_by_name: z.string().nullable(),
    reported_at: isoDateTime.nullable(),
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
 * PUT /recruitment/interviews/:id/feedback: the reader's own draft. Submit asks for an overall
 * rating and a recommendation; until then any of these may be empty.
 */
const FeedbackSave = z
  .object({
    overall_rating: rating.nullable().optional(),
    recommendation: PanelRecommendation.nullable().optional(),
    comments: z.string().trim().max(5000, "At most 5000 characters").optional(),
    private_notes: z.string().trim().max(5000, "At most 5000 characters").optional(),
    ratings: z.array(QuestionRating).max(20).optional(),
  })
  .strict();

/** PUT /recruitment/interviews/:id/report: the consolidated report, once the round is closed. */
const RoundReport = z
  .object({
    report: z.string().trim().min(40, "At least 40 characters").max(10000, "At most 10000 characters"),
    recommendation: RoundRecommendation,
  })
  .strict();

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
      overall_rating: "interview_feedback.overall_rating, once the reader may see it",
      recommendation: "interview_feedback.recommendation, once the reader may see it",
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
      questions: "the vacancy's active interview questions",
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
  PanelRecommendation,
  RoundRecommendation,
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
