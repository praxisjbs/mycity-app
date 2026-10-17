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
const { uuid, optionalText, isoDate, listQuery, phone, blank } = require("./common");
const { UploadPurpose } = require("./documents");
const { LeaveStatus } = require("./leave");
const { EmployeeStatus, EmploymentType, WorkPattern, ManagerRef } = require("./organisation");

/* ------------------------------------------------------------------ *
 * My Profile
 * ------------------------------------------------------------------ */

/** "HH:MM", the hours of a working day. */
const clock = z.string().regex(/^\d{2}:\d{2}$/);

/**
 * One day of the week as the organisation works it (Settings, the working week:
 * Monday to Friday 09:00 to 17:00 and Saturday 09:00 to 15:00, A22). Weekday 1 is
 * Monday. Each person's own arrangement (Office, Remote, Off, and where) comes with
 * the attendance module.
 */
const EssWorkDay = z
  .object({
    weekday: z.number().int().min(1).max(7),
    is_working_day: z.boolean(),
    starts_at: clock.nullable(),
    ends_at: clock.nullable(),
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
    next_of_kin_name: z.string().nullable(),
    next_of_kin_relationship: z.string().nullable(),
    next_of_kin_phone: z.string().nullable(),
    bank_name: z.string().nullable(),
    account_last4: z.string().nullable(),
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
    home_address: optionalText(300),
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

/** GET /ess/leave: my own requests, by status and by the year they start in. */
const EssLeaveListQuery = listQuery(
  {
    status: LeaveStatus.optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
  },
  ["starts_on", "submitted_at"],
);

/** GET /ess/leave/balances: one year; this year when it is left out. */
const EssLeaveBalanceQuery = z
  .object({ year: z.coerce.number().int().min(2000).max(2100).optional() })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  EssDocumentUpload: {
    table: null,
    reason:
      "the text fields beside a file when an employee uploads their own document",
  },
  EssWorkDay: { table: "working_week" },
  EssProfile: {
    table: "employee",
    virtual: {
      display_name: "first and last name together",
      department: "department.name",
      confirmed: "employee.confirmed_on is set",
      line_manager: "the line manager or vacant seat, from employee and org_seat",
      account_last4: "the last four digits of employee.account_number",
      working_week: "the organisation's week, from working_week",
    },
  },
  EssProfileUpdate: { table: "employee" },
  EssLeaveListQuery: {
    table: null,
    reason: "list controls for the caller's own leave requests",
  },
  EssLeaveBalanceQuery: { table: null, reason: "which year of the caller's leave to read" },
};

module.exports = {
  TABLES,
  EssDocumentUpload,
  EssWorkDay,
  EssProfile,
  EssProfileUpdate,
  EssLeaveListQuery,
  EssLeaveBalanceQuery,
};
