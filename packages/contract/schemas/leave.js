"use strict";
/**
 * Leave: the types People offer, a person's requests, and what is left of their
 * year (docs/guides/ess.md §3 step 5, §5, §6; docs/guides/foundation.md §6.5).
 *
 * The same shapes serve both screens. ESS · My Leave reads and writes the caller's
 * own requests under /ess/leave (schemas/ess.js adds its list controls); People ·
 * Leave reads everyone within the caller's `people` scope under /leave. A request
 * is decided in the approval flow (`leave.approval`, schemas/workflow.js), never by
 * a leave route of its own, so a request carries the id of the approval it waits on.
 *
 * Statuses a person reads:
 *   submitted   waiting in the approval flow
 *   approved    granted (by the flow, or recorded by People)
 *   rejected    refused in the flow
 *   cancelled   withdrawn by the person, or cancelled by People before it ended
 *
 * Lengths are working days (shared/time/working-week.js: the configured week, public
 * holidays left out), whole numbers on the wire.
 *
 * Relief and handover (docs/guides/ess.md §6, TB 17/11/2026): a request may name a relief
 * officer, the colleague who covers while the person is away, and carry a handover note, a
 * file staged through POST /documents. Each leave type says when both are required: on every
 * request, or when a request is more than a number of working days.
 */
const { z } = require("zod");
const {
  uuid,
  text,
  optionalText,
  isoDate,
  isoDateTime,
  listQuery,
  Paged,
  recordId,
  changesBeside,
  nothingOn,
  blank,
} = require("./common");
const { PersonRef } = require("./organisation");
const { DocumentRef } = require("./documents");

const LeaveStatus = z.enum(["submitted", "approved", "rejected", "cancelled"]);

/** A query-string boolean: "true" or "false". */
const flag = z.enum(["true", "false"]).transform((v) => v === "true");

/* ------------------------------------------------------------------ *
 * Leave types
 * ------------------------------------------------------------------ */

const leaveCode = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, "Use lower case letters, digits and _");

/** Working days a year; null when the type has no allowance (unpaid leave). */
const daysPerYear = z.number().int().min(0).max(366).nullable();

/**
 * A request of the type needs a relief officer and a handover note when it is more than this many
 * working days; null when its length never asks for them. A new type takes 7, a company rule with
 * no legal source (TB, 17/11/2026; docs/guides/ess.md §6), which People change per type.
 */
const HANDOVER_OVER_DAYS = 7;
const handoverOverDays = z.number().int().min(0, "0 to 366 days").max(366, "0 to 366 days").nullable();

/** One leave type as a picker or People's list shows it. */
const LeaveType = z
  .object({
    leave_type_id: uuid,
    code: z.string(),
    name: z.string(),
    days_per_year: daysPerYear,
    active: z.boolean(),
    /** Every request of the type needs a relief officer and a handover note. */
    handover_every_request: z.boolean(),
    /** Or a request more than this many working days does; null when length never asks. */
    handover_over_days: handoverOverDays,
  })
  .strict();

/** GET /leave/types */
const LeaveTypeListQuery = listQuery({ active: flag.optional() }, ["name"]);
const LeaveTypePage = Paged(LeaveType);

/** POST /leave/types: People add a type. */
const LeaveTypeCreate = z
  .object({
    code: leaveCode,
    name: text(80),
    days_per_year: daysPerYear.default(null),
    handover_every_request: z.boolean().default(false),
    handover_over_days: handoverOverDays.default(HANDOVER_OVER_DAYS),
  })
  .strict();

/** PATCH /leave/types/:id: rename it, change the allowance, retire it. */
const LeaveTypeUpdateFields = z
  .object({
    name: text(80).optional(),
    days_per_year: daysPerYear.optional(),
    active: z.boolean().optional(),
    handover_every_request: z.boolean().optional(),
    handover_over_days: handoverOverDays.optional(),
  })
  .strict();
const LeaveTypeUpdate = LeaveTypeUpdateFields.refine((v) => Object.keys(v).length > 0, "Change at least one field");

/**
 * Add Type as Praxis AI's card (docs/guides/praxis-ai.md §6.11, decision 33): the name and the
 * allowance New Leave Type's sheet asks for. The code is made from the name as the sheet makes it
 * ("Study Leave" is study_leave), on the server (leave.service.codeOf).
 */
const LeaveTypeAdd = z
  .object({
    name: text(80),
    days_per_year: daysPerYear.default(null),
    handover_every_request: z.boolean().default(false),
    handover_over_days: handoverOverDays.default(HANDOVER_OVER_DAYS),
  })
  .strict();

/** Save Type as a card: the type (its id, or its name matched among the types) beside LeaveTypeUpdate's fields. */
const LeaveTypeChange = LeaveTypeUpdateFields.extend({ leave_type_id: recordId("leave type") }).refine(
  changesBeside(["leave_type_id"]),
  nothingOn("leave_type_id"),
);

/* ------------------------------------------------------------------ *
 * Requests
 * ------------------------------------------------------------------ */

/** One leave request. */
const LeaveRequest = z
  .object({
    leave_request_id: uuid,
    employee: PersonRef,
    leave_type_id: uuid,
    leave_type_name: z.string(),
    starts_on: isoDate,
    ends_on: isoDate,
    days: z.number().int().min(1),
    reason: z.string().nullable(),
    status: LeaveStatus,
    workflow_instance_id: uuid.nullable(),
    waiting_on: z.string().nullable(),
    /** The one person the waiting stage names (a line manager, a login it was given to, the CEO); null when a role decides it. */
    approver_name: z.string().nullable(),
    recorded: z.boolean(),
    /** The colleague who covers while the person is away, or null. */
    relief_employee: PersonRef.nullable(),
    /** The handover note the person uploaded, or null; opened through GET /documents/:id/content. */
    handover: DocumentRef.nullable(),
    submitted_at: isoDateTime.nullable(),
    decided_at: isoDateTime.nullable(),
    created_at: isoDateTime,
  })
  .strict();

const LeavePage = Paged(LeaveRequest);

/** The dates a request asks for, checked the same way on the form and the API. */
const span = {
  leave_type_id: uuid,
  starts_on: isoDate,
  ends_on: isoDate,
  reason: optionalText(500),
};
const endsAfterStart = (v) => !v.starts_on || !v.ends_on || v.ends_on >= v.starts_on;
const ENDS_BEFORE = { message: "Ends before it starts", path: ["ends_on"] };
/** A year's allowance is counted per year, so leave over New Year is two requests. */
const oneYear = (v) =>
  !v.starts_on || !v.ends_on || v.ends_on < v.starts_on || v.ends_on.slice(0, 4) === v.starts_on.slice(0, 4);
const OTHER_YEAR = { message: "Ends in another year", path: ["ends_on"] };

/**
 * The relief officer and the handover note a request may carry (docs/guides/ess.md §6): each
 * optional here, both required by the service when the type and the days ask for them. An empty
 * pick is left out.
 */
const cover = {
  relief_employee_id: blank(uuid),
  handover_document_id: blank(uuid),
};

/** POST /ess/leave: the employee asks for leave. */
const LeaveRequestCreate = z
  .object({ ...span, ...cover })
  .strict()
  .refine(endsAfterStart, ENDS_BEFORE)
  .refine(oneYear, OTHER_YEAR);

/**
 * What a screen button may fill on Request Leave through the address (docs/guides/praxis-ai.md
 * §6.4): the form's fields, each optional and checked on its own. The person still presses Send.
 */
const LeaveRequestPrefill = z
  .object({
    leave_type_id: uuid.optional(),
    starts_on: isoDate.optional(),
    ends_on: isoDate.optional(),
    relief_employee_id: uuid.optional(),
    reason: optionalText(500),
  })
  .strict();

/**
 * GET /ess/leave/check: what Request Leave asks before Send, once the type and both days are
 * picked: the working days the span holds, and whether the type asks for a relief officer and a
 * handover note for it. `days` is null when the span is not one Send would take (it ends before it
 * starts, or crosses New Year).
 */
const LeaveRequestCheckQuery = z
  .object({ leave_type_id: uuid, starts_on: isoDate, ends_on: isoDate })
  .strict();
const LeaveRequestCheck = z
  .object({
    days: z.number().int().min(0).nullable(),
    handover_needed: z.boolean(),
  })
  .strict();

/**
 * GET /ess/leave/relief-officers: who may cover for the caller (Request Leave's Relief Officer,
 * and Praxis AI's card): active colleagues, never the caller, by name; with both days, those on
 * waiting or approved leave on any of them are left out.
 */
const LeaveReliefQuery = listQuery(
  {
    starts_on: isoDate.optional(),
    ends_on: isoDate.optional(),
  },
  ["display_name"],
);
const LeaveReliefPage = Paged(PersonRef);

/** POST /leave/requests: People record leave on someone's behalf. It is approved at once. */
const LeaveRecordCreate = z
  .object({ employee_id: uuid, ...span })
  .strict()
  .refine(endsAfterStart, ENDS_BEFORE)
  .refine(oneYear, OTHER_YEAR);

/**
 * Praxis AI's cards on People · Leave (docs/guides/praxis-ai.md §6.11): the requests waiting on
 * the person, decided together, up to 25 a press; a rejection always says why, as the screen's
 * own form does (workflow.ReasonBody). Each request is decided on its approval's current stage.
 */
const LeaveApprove = z
  .object({
    leave_request_ids: z.array(uuid).min(1, "Pick a request").max(25, "At most 25"),
    reason: optionalText(1000),
  })
  .strict();

const LeaveReject = z
  .object({
    leave_request_ids: z.array(uuid).min(1, "Pick a request").max(25, "At most 25"),
    reason: text(1000),
  })
  .strict();

/** POST /ess/leave/:id/cancel and POST /leave/requests/:id/cancel */
const LeaveCancel = z.object({ reason: optionalText(500) }).strict();

/**
 * GET /leave/requests: People's list. `from` and `to` keep the requests that
 * overlap those days (the leave calendar reads a month this way).
 */
const LeaveListQuery = listQuery(
  {
    status: LeaveStatus.optional(),
    leave_type_id: uuid.optional(),
    employee_id: uuid.optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    /** Waiting or approved only: the Leave Calendar's requests. */
    live: flag.optional(),
  },
  ["starts_on", "submitted_at", "created_at"],
);

/** GET /leave/requests/:id/clashes: who else in the department is away on those days. */
const LeaveClashQuery = listQuery({}, ["starts_on"]);

/**
 * The assistant's leave summary (docs/guides/praxis-ai.md §6.13; ess.md §9): requests by status, type,
 * person or department, days taken, booked and waiting, or a series by month. Figures, never rows; no
 * page. `from` and `to` keep the requests that overlap those days; `year` the requests starting in it;
 * with neither, this year in Lagos.
 */
const LeaveSummaryBy = z.enum(["status", "type", "month", "person", "department"]);
const LeaveSummaryQuery = z
  .object({
    status: LeaveStatus.optional(),
    leave_type_id: uuid.optional(),
    employee_id: uuid.optional(),
    department_id: uuid.optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    by: LeaveSummaryBy.default("status"),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * What is left of a year
 * ------------------------------------------------------------------ */

/**
 * One type's year. `entitled` is the allowance (People's figure for this person and
 * year when they set one, otherwise the type's days_per_year); null means the type
 * has no allowance and `remaining` is null too.
 *   taken      approved days already started
 *   booked     approved days still to come
 *   pending    days waiting in the approval flow
 *   remaining  entitled − taken − booked − pending
 */
const LeaveBalance = z
  .object({
    leave_type_id: uuid,
    code: z.string(),
    name: z.string(),
    entitled: z.number().nullable(),
    taken: z.number().min(0),
    booked: z.number().min(0),
    pending: z.number().min(0),
    remaining: z.number().nullable(),
  })
  .strict();

/** GET /ess/leave/balances: every active type, for one year. */
const LeaveBalances = z
  .object({
    year: z.number().int(),
    balances: z.array(LeaveBalance).max(25),
  })
  .strict();

/** GET /leave/balances: one person's year, for People within their scope. */
const LeaveBalanceQuery = z
  .object({
    employee_id: uuid,
    year: z.coerce.number().int().min(2000).max(2100).optional(),
  })
  .strict();

/**
 * PUT /leave/balances: People set one person's allowance of one type for one year,
 * in place of the type's days a year. `days: null` goes back to the type's figure.
 */
const LeaveAllowanceSet = z
  .object({
    employee_id: uuid,
    leave_type_id: uuid,
    year: z.number().int().min(2000).max(2100),
    days: z.number().int().min(0).max(366).nullable(),
  })
  .strict();

/** GET /leave/summary: the figures above People · Leave, within the caller's scope. */
const LeaveSummary = z
  .object({
    pending: z.number().int().min(0),
    on_leave_today: z.number().int().min(0),
    starting_soon: z.number().int().min(0),
    approved_this_year: z.number().int().min(0),
  })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  LeaveType: {
    table: "leave_type",
    virtual: { days_per_year: "leave_type.policy ->> 'days_per_year'" },
  },
  LeaveTypeListQuery: { table: null, reason: "list controls for the leave types" },
  LeaveTypePage: { table: null, reason: "a page of leave types" },
  LeaveTypeCreate: {
    table: "leave_type",
    virtual: { days_per_year: "written to leave_type.policy" },
  },
  LeaveTypeUpdate: {
    table: "leave_type",
    virtual: { days_per_year: "written to leave_type.policy" },
  },
  LeaveTypeAdd: {
    table: "leave_type",
    virtual: { days_per_year: "written to leave_type.policy" },
  },
  LeaveTypeChange: {
    table: "leave_type",
    virtual: { days_per_year: "written to leave_type.policy" },
  },
  LeaveRequest: {
    table: "leave_request",
    virtual: {
      relief_employee: "the employee behind leave_request.relief_employee_id, with their photo_url",
      handover: "the document behind leave_request.handover_document_id",
      employee: "the person, from employee and department, with their photo_url",
      leave_type_name: "leave_type.name",
      days: "leave_request.amount, in working days",
      waiting_on: "the name of the approval stage it waits at, from workflow_instance",
      approver_name: "the one person the waiting stage names, from workflow_instance.stage_approvers",
      recorded: "leave_request.recorded_by is set: People recorded it",
    },
  },
  LeavePage: { table: null, reason: "a page of leave requests" },
  LeaveRequestCreate: { table: "leave_request" },
  LeaveRequestPrefill: { table: "leave_request" },
  LeaveRequestCheckQuery: { table: null, reason: "the type and the days Request Leave asks about before Send" },
  LeaveRequestCheck: { table: null, reason: "the working days a span holds and whether its type asks for cover, worked out, never kept" },
  LeaveReliefQuery: { table: null, reason: "the search and the days of the relief officer list" },
  LeaveReliefPage: { table: null, reason: "a page of people who may cover" },
  LeaveRecordCreate: { table: "leave_request" },
  LeaveCancel: {
    table: null,
    reason: "why a request is withdrawn; kept with the approval and the audit row",
  },
  LeaveApprove: {
    table: "workflow_decision",
    virtual: { leave_request_ids: "each request's approval, decided on its current stage" },
  },
  LeaveReject: {
    table: "workflow_decision",
    virtual: { leave_request_ids: "each request's approval, decided on its current stage" },
  },
  LeaveSummaryQuery: { table: null, reason: "the filters and grouping of the assistant's leave summary; figures, never a row" },
  LeaveListQuery: {
    table: null,
    reason: "list controls and filters for People's leave list",
  },
  LeaveClashQuery: { table: null, reason: "list controls for the clash list" },
  LeaveBalance: {
    table: null,
    reason: "one type's year, worked out from leave_type, leave_balance and leave_request",
  },
  LeaveBalances: { table: null, reason: "a person's year, one entry per active type" },
  LeaveBalanceQuery: { table: null, reason: "whose year People read, and which" },
  LeaveAllowanceSet: {
    table: "leave_balance",
    virtual: {
      year: "leave_balance.period_start and period_end, 1 January to 31 December",
      days: "leave_balance.opening for that year; null removes the row",
    },
  },
  LeaveSummary: { table: null, reason: "counts over leave_request" },
};

module.exports = {
  TABLES,
  LeaveStatus,
  LeaveType,
  LeaveTypeListQuery,
  LeaveTypePage,
  LeaveTypeCreate,
  LeaveTypeUpdate,
  LeaveTypeAdd,
  LeaveTypeChange,
  LeaveRequest,
  LeavePage,
  LeaveRequestCreate,
  LeaveRequestPrefill,
  LeaveRequestCheckQuery,
  LeaveRequestCheck,
  LeaveReliefQuery,
  LeaveReliefPage,
  HANDOVER_OVER_DAYS,
  LeaveRecordCreate,
  LeaveCancel,
  LeaveApprove,
  LeaveReject,
  LeaveListQuery,
  LeaveSummaryQuery,
  LeaveClashQuery,
  LeaveBalance,
  LeaveBalances,
  LeaveBalanceQuery,
  LeaveAllowanceSet,
  LeaveSummary,
};
