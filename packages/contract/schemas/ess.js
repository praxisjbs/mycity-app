"use strict";
/**
 * Employee Self-Service: the caller's own record, nothing else. Every route is
 * for the person signed in; there is no parameter that names another employee
 * (docs/guides/ess.md §6).
 *
 * My Profile, My Documents and My Leave are on the real API. Their rows, counts and forms
 * are the shared shapes (`schemas/documents.js`, `schemas/leave.js`), because a
 * document or a leave request is the same record whether the employee or People
 * is looking at it; only who may see it differs. What this file adds is what only
 * the employee's own view has: their profile as they read it and the fields they may
 * change, the request an upload answers, and the controls of their own leave list,
 * which never name another person.
 *
 * The rest of ESS (payslips, queries, performance) arrives with its own milestones;
 * its shapes belong here when they do.
 */
const { z } = require("zod");
const { uuid, optionalText, isoDate, isoDateTime, listQuery, phone, blank, Paged } = require("./common");
const { UploadPurpose } = require("./documents");
const { LeaveStatus } = require("./leave");
const { EmployeeStatus, EmploymentType, WorkPattern, ManagerRef } = require("./organisation");
const { PlaceInput, PlaceView } = require("./maps");
const { SchedulePlace } = require("./attendance");
const { ScoreValue, Rating } = require("./scoring");
const { MonthStart } = require("./kpis");
const { ScorecardStatus, CommitmentSetStatus } = require("./targets");
const { ReviewStatus } = require("./reviews");

/* ------------------------------------------------------------------ *
 * My Profile
 * ------------------------------------------------------------------ */

/** "HH:MM", the hours of a working day. */
const clock = z.string().regex(/^\d{2}:\d{2}$/);

/**
 * One day of the person's own week (attendance guide §6.13): worked or not, its hours, and where
 * they work it (`place` office, remote or off), by the work schedule People set, else the company
 * hours (the Attendance policy's, else Settings' working week, A22) at the place their work pattern
 * gives. Weekday 1 is Monday.
 */
const EssWorkDay = z
  .object({
    weekday: z.number().int().min(1).max(7),
    is_working_day: z.boolean(),
    starts_at: clock.nullable(),
    ends_at: clock.nullable(),
    place: SchedulePlace,
  })
  .strict();

/**
 * GET /ess/profile: the caller's own record as they read it. The bank account is
 * shown by its last four digits only; the full number never leaves the server here.
 */
const EssProfile = z
  .object({
    employee_id: uuid,
    staff_number: z.string(),
    display_name: z.string(),
    first_name: z.string(),
    last_name: z.string(),
    job_title: z.string(),
    department: z.string().nullable(),
    status: EmployeeStatus,
    confirmed: z.boolean(),
    employment_type: EmploymentType,
    work_pattern: WorkPattern,
    start_date: isoDate.nullable(),
    line_manager: ManagerRef.nullable(),
    work_email: z.string(),
    phone: z.string().nullable(),
    date_of_birth: isoDate.nullable(),
    home_address: z.string().nullable(),
    /** The address as Edit Profile reads it (F27): the place, with a token to send it back. */
    home_address_place: PlaceView.nullable(),
    next_of_kin_name: z.string().nullable(),
    next_of_kin_relationship: z.string().nullable(),
    next_of_kin_phone: z.string().nullable(),
    bank_name: z.string().nullable(),
    account_last4: z.string().nullable(),
    /** The photo's path on the API, fetched with the session; null shows initials. */
    photo_url: z.string().nullable(),
    working_week: z.array(EssWorkDay).max(7),
  })
  .strict();

/**
 * PATCH /ess/profile: the only fields an employee changes themselves
 * (docs/guides/ess.md §6). Job, pay, manager and schedule are People's. A field
 * left empty is left as it is, so the Edit Profile form checks with this schema as
 * it is filled and sends only what changed.
 */
const EssProfileUpdate = z
  .object({
    phone: blank(phone),
    /** Picked or pinned, never typed (F27); left out, it stays as it is, as every field here. */
    home_address: PlaceInput.optional(),
    next_of_kin_name: optionalText(150),
    next_of_kin_relationship: optionalText(50),
    next_of_kin_phone: blank(phone),
    bank_name: optionalText(100),
    account_number: blank(z.string().trim().regex(/^\d{10}$/, "must be a 10-digit NUBAN")),
  })
  .partial()
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "change at least one field" });

/**
 * POST /ess/documents: the text fields beside the file. `document_request_id`
 * answers a document People asked for, so the Missing row becomes that upload
 * instead of a second record with a similar name.
 */
const EssDocumentUpload = z
  .object({
    purpose: UploadPurpose.optional(),
    title: optionalText(200),
    expires_on: isoDate.optional(),
    document_request_id: uuid.optional(),
  })
  .strict();

/**
 * POST /ess/profile/photo: the multipart's text fields beside the file. The upload field sends
 * the purpose it was given; the route takes only `avatar` (the image pipeline's face crop).
 */
const EssPhotoUpload = z.object({ purpose: z.literal("avatar").optional() }).strict();

/** GET /ess/leave: my own requests, by status and by the year they start in. */
const EssLeaveListQuery = listQuery(
  {
    status: LeaveStatus.optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
  },
  ["starts_on", "submitted_at"],
);

/**
 * GET /ess/leave/calendar: the leave calendar on My Leave, one month (this month when left
 * out). Its rows are LeavePage's: approved and waiting leave that touches the month, for the
 * caller and everyone under them in the reporting tree; for the CEO and for People with scope
 * all (Operations & People), everyone (the team lead, 18/10/2026).
 */
const EssLeaveCalendarQuery = listQuery(
  { month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM").optional() },
  ["starts_on"],
);

/** GET /ess/leave/balances: one year; this year when it is left out. */
const EssLeaveBalanceQuery = z
  .object({ year: z.coerce.number().int().min(2000).max(2100).optional() })
  .strict();

/* ------------------------------------------------------------------ *
 * My Performance (docs/guides/performance.md §5, §10)
 * ------------------------------------------------------------------ */

/** GET /ess/performance: the caller's quarter at a glance. Each part is null when it does not apply. */
const MyPerformance = z
  .object({
    period: z.object({ performance_period_id: uuid, name: z.string() }).strict().nullable(),
    scorecard: z
      .object({
        scorecard_id: uuid,
        status: ScorecardStatus,
        score_to_date: ScoreValue.nullable(),
        rating: Rating.nullable(),
        employee_agreed_at: isoDateTime.nullable(),
        reviewer_name: z.string().nullable(),
      })
      .strict()
      .nullable(),
    check_in: z
      .object({
        performance_review_id: uuid,
        month: MonthStart.nullable(),
        due_on: isoDate.nullable(),
        status: ReviewStatus,
      })
      .strict()
      .nullable(),
    commitments: z
      .object({
        month: MonthStart,
        set_status: CommitmentSetStatus.nullable(),
        due: z.number().int().min(0),
        delivered_on_time: z.number().int().min(0),
      })
      .strict()
      .nullable(),
    open_pip: z.object({ improvement_plan_id: uuid, review_on: isoDate }).strict().nullable(),
  })
  .strict();

/** One of the caller's reviews; a closed one carries its final scores and its PDF. */
const MyReview = z
  .object({
    performance_review_id: uuid,
    round_name: z.string().nullable(),
    month: MonthStart.nullable(),
    review_kind: z.enum(["monthly", "probation"]),
    status: ReviewStatus,
    score_month: ScoreValue.nullable(),
    score_to_date: ScoreValue.nullable(),
    rating: Rating.nullable(),
    closed_at: isoDateTime.nullable(),
    document_id: uuid.nullable(),
  })
  .strict();

const MyReviewPage = Paged(MyReview);

/** GET /ess/performance/reviews */
const MyReviewListQuery = listQuery({}, ["month"]);

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  MyPerformance: { table: null, reason: "the caller's quarter: scorecard, check-in, commitments and an open PIP" },
  MyReview: {
    table: "performance_review",
    virtual: {
      round_name: "performance_cycle.name",
      month: "performance_cycle.month",
    },
  },
  MyReviewPage: { table: null, reason: "a page of the caller's reviews" },
  MyReviewListQuery: { table: null, reason: "list controls for the caller's own reviews" },
  EssDocumentUpload: {
    table: null,
    reason:
      "the text fields beside a file when an employee uploads their own document",
  },
  EssWorkDay: {
    table: "working_week",
    virtual: { place: "the person's place that weekday, from attendance_work_schedule or the work pattern" },
  },
  EssProfile: {
    table: "employee",
    virtual: {
      home_address_place: "the home address as a place, from place (owner employee.home_address)",
      display_name: "first and last name together",
      department: "department.name",
      confirmed: "employee.confirmed_on is set",
      line_manager: "the line manager or vacant seat, from employee and org_seat",
      account_last4: "the last four digits of employee.account_number",
      photo_url: "the shown size of employee.photo_document_id (organisation.photo.js)",
      working_week: "the organisation's week, from working_week",
    },
  },
  EssProfileUpdate: { table: "employee" },
  EssPhotoUpload: { table: null, reason: "the upload's purpose, beside the photo file" },
  EssLeaveListQuery: {
    table: null,
    reason: "list controls for the caller's own leave requests",
  },
  EssLeaveBalanceQuery: { table: null, reason: "which year of the caller's leave to read" },
  EssLeaveCalendarQuery: { table: null, reason: "the month the leave calendar shows" },
};

module.exports = {
  TABLES,
  EssDocumentUpload,
  EssWorkDay,
  EssProfile,
  EssProfileUpdate,
  EssPhotoUpload,
  EssLeaveListQuery,
  EssLeaveBalanceQuery,
  EssLeaveCalendarQuery,
  MyPerformance,
  MyReview,
  MyReviewPage,
  MyReviewListQuery,
};
