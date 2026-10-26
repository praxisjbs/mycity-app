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
} = require("./common");
const { PersonRef } = require("./organisation");

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

/** One leave type as a picker or People's list shows it. */
const LeaveType = z
  .object({
    leave_type_id: uuid,
    code: z.string(),
    name: z.string(),
    days_per_year: daysPerYear,
    active: z.boolean(),
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
  })
  .strict();

/** PATCH /leave/types/:id: rename it, change the allowance, retire it. */
const LeaveTypeUpdate = z
  .object({
    name: text(80).optional(),
    days_per_year: daysPerYear.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Change at least one field");

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

/** POST /ess/leave: the employee asks for leave. */
const LeaveRequestCreate = z
  .object(span)
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
    reason: optionalText(500),
  })
  .strict();

/** POST /leave/requests: People record leave on someone's behalf. It is approved at once. */
const LeaveRecordCreate = z
  .object({ employee_id: uuid, ...span })
  .strict()
  .refine(endsAfterStart, ENDS_BEFORE)
  .refine(oneYear, OTHER_YEAR);

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
  LeaveRequest: {
    table: "leave_request",
    virtual: {
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
  LeaveRecordCreate: { table: "leave_request" },
  LeaveCancel: {
    table: null,
    reason: "why a request is withdrawn; kept with the approval and the audit row",
  },
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
  LeaveRequest,
  LeavePage,
  LeaveRequestCreate,
  LeaveRequestPrefill,
  LeaveRecordCreate,
  LeaveCancel,
  LeaveListQuery,
  LeaveClashQuery,
  LeaveBalance,
  LeaveBalances,
  LeaveBalanceQuery,
  LeaveAllowanceSet,
  LeaveSummary,
};
