"use strict";
/**
 * Settings: the values every module reads, and the screens that change them
 * (docs/guides/foundation.md, track C).
 *
 *   organisation    the company's own profile (setting rows, entered on screen, never seeded)
 *   working week    per day, Monday 1 to Sunday 7 (A22: Monday to Friday 09:00 to 17:00,
 *                   Saturday 09:00 to 15:00, as seeded; edited here)
 *   holidays        public holidays: Nigeria's seeded for 2026 and 2027 (seeds/reference/0448,
 *                   TB 17/10/2026), the moon-dated and weekend ones as expected until confirmed;
 *                   any other entered on screen
 *   numbering       the scheme of every numbered document type (shared/numbering/schemes.js)
 *   security        session length, idle lock, password minimum and two-step by role, each
 *                   within the floor the server's .env sets: a rule may be made stricter here,
 *                   never looser
 *
 * Times of day are "HH:MM" on the wire, 24-hour.
 */
const { z } = require("zod");
const { uuid, text, isoDate, isoDateTime, email, phone, listQuery, Paged } = require("./common");
const { SignInMethod } = require("./identity");
const { RoleCode } = require("./users");

/* ------------------------------------------------------------------ *
 * Organisation
 * ------------------------------------------------------------------ */

/** Optional text a person may clear: an empty string is "not set" (null). */
const clearable = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v === "" ? null : v));

/** A typed value a person may clear: an empty string is "not set" (null). */
const clearableAs = (schema) =>
  z
    .union([z.literal("").transform(() => null), schema])
    .nullable();

/** GET /settings/organisation. Fields nobody has entered yet are null. */
const Organisation = z
  .object({
    legal_name: z.string().nullable(),
    trading_name: z.string().nullable(),
    registration_number: z.string().nullable(),
    tax_id: z.string().nullable(),
    address: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    website: z.string().nullable(),
    /** Fixed for the product (MILESTONES §1.1), shown for reference. */
    currency: z.literal("NGN"),
    time_zone: z.literal("Africa/Lagos"),
  })
  .strict();

/** PATCH /settings/organisation: only the fields sent change. */
const OrganisationPatch = z
  .object({
    legal_name: clearable(200).optional(),
    trading_name: clearable(200).optional(),
    registration_number: clearable(40).optional(),
    tax_id: clearable(40).optional(),
    address: clearable(500).optional(),
    phone: clearableAs(phone).optional(),
    email: clearableAs(email).optional(),
    website: clearableAs(z.string().trim().max(200).url("Not a web address")).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Change at least one field");

/* ------------------------------------------------------------------ *
 * The working week
 * ------------------------------------------------------------------ */

const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

/** One day of the week. A working day has its hours; a day off has none. */
const WorkingDay = z
  .object({
    weekday: z.number().int().min(1).max(7),
    is_working_day: z.boolean(),
    starts_at: TimeOfDay.nullable(),
    ends_at: TimeOfDay.nullable(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (!d.is_working_day) return;
    if (!d.starts_at) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["starts_at"], message: "Enter a start" });
    if (!d.ends_at) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ends_at"], message: "Enter an end" });
    if (d.starts_at && d.ends_at && d.ends_at <= d.starts_at)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ends_at"], message: "After the start" });
  });

/** GET /settings/working-week: Monday to Sunday. */
const WorkingWeek = z.object({ days: z.array(WorkingDay).length(7) }).strict();

/** PUT /settings/working-week: all seven days, each once, at least one worked. */
const WorkingWeekSave = z
  .object({ days: z.array(WorkingDay).length(7) })
  .strict()
  .superRefine((w, ctx) => {
    const days = w.days.map((d) => d.weekday);
    if (new Set(days).size !== 7)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["days"], message: "Each day once" });
    if (!w.days.some((d) => d.is_working_day))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["days"], message: "Work at least one day" });
  });

/* ------------------------------------------------------------------ *
 * Public holidays
 * ------------------------------------------------------------------ */

/**
 * `expected`: seeded before the Federal Government announces it (an Eid, or the working day given
 * for a holiday on a weekend). Saving the holiday, moved or not, confirms it.
 */
const Holiday = z
  .object({
    public_holiday_id: uuid,
    holiday_date: isoDate,
    name: z.string(),
    expected: z.boolean(),
    created_at: isoDateTime,
  })
  .strict();

/** GET /settings/holidays: by date, the year's first. */
const HolidayListQuery = listQuery(
  { year: z.coerce.number().int().min(2000).max(2100).optional() },
  ["holiday_date", "name"],
);
const HolidayPage = Paged(Holiday);

/** POST /settings/holidays, PATCH /settings/holidays/:id (which also confirms an expected holiday) */
const HolidaySave = z.object({ holiday_date: isoDate, name: text(80) }).strict();

/* ------------------------------------------------------------------ *
 * Numbering
 * ------------------------------------------------------------------ */

/** The document types the code numbers (shared/numbering/schemes.js; a test holds them equal). */
const DOC_TYPES = [
  "employee",
  "document",
  "import_batch",
  "report_run",
  "location_request",
  "field_assignment",
  "query",
  "sanction",
  "letter",
  "vacancy",
  "offer",
  "contract",
  "payroll_run",
  "payslip",
  "proposal",
  "mou",
  "expense",
  "requisition",
  "disbursement",
];
const DocType = z.enum(DOC_TYPES);
const NumberingReset = z.enum(["never", "yearly", "monthly"]);

/** One document type's scheme, with what the next number would be. */
const NumberingScheme = z
  .object({
    doc_type: DocType,
    label: z.string(),
    prefix: z.string(),
    padding: z.number().int().min(0).max(10),
    separator: z.string(),
    reset: NumberingReset,
    include_period: z.boolean(),
    /** What the next number would be today; another save may take it first. */
    next: z.string(),
    /** Numbers issued in the current period. */
    issued: z.number().int().min(0),
    updated_at: isoDateTime,
  })
  .strict();

/** GET /settings/numbering */
const NumberingListQuery = listQuery({}, ["doc_type", "prefix"]);
const NumberingPage = Paged(NumberingScheme);

/** GET /settings/numbering/summary */
const NumberingSummary = z
  .object({
    types: z.number().int().min(0),
    issued: z.number().int().min(0),
    resetting: z.number().int().min(0),
  })
  .strict();

/** PUT /settings/numbering/:doc_type: applies to future numbers only. */
const NumberingSchemeSave = z
  .object({
    prefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{0,8}$/, "Up to 8 letters"),
    padding: z.number().int().min(0, "0 to 10").max(10, "0 to 10"),
    separator: z.enum(["-", "/", ".", "_", ""]),
    reset: NumberingReset,
    include_period: z.boolean(),
  })
  .strict();

const NumberingParams = z.object({ doc_type: DocType }).strict();

/* ------------------------------------------------------------------ *
 * Security rules
 * ------------------------------------------------------------------ */

/** A role and whether its people must use two-step sign-in. */
const TwoStepRole = z
  .object({
    role_id: uuid,
    code: z.string(),
    name: z.string(),
    two_step_required: z.boolean(),
    /** Active logins holding the role. */
    holders: z.number().int().min(0),
    /** Of them, how many have two-step on. */
    enrolled: z.number().int().min(0),
  })
  .strict();

/**
 * GET /settings/security. Each rule's value is the one in force; its floor is the
 * server's .env, which a rule may tighten and never loosen: a session no longer
 * and an idle lock no later than the floor, a password minimum no shorter.
 */
const SecurityPolicy = z
  .object({
    session_max_age_min: z.number().int().min(1),
    session_max_age_floor: z.number().int().min(1),
    idle_lock_min: z.number().int().min(1),
    idle_lock_floor: z.number().int().min(1),
    password_min_length: z.number().int().min(1),
    password_min_floor: z.number().int().min(1),
    two_step_roles: z.array(TwoStepRole),
    active_sessions: z.number().int().min(0),
    users: z.number().int().min(0),
    two_step_on: z.number().int().min(0),
    failed_7d: z.number().int().min(0),
  })
  .strict();

/** PATCH /settings/security: the rules sent change; `two_step_roles` is the whole list of role codes. */
const SecurityPolicyPatch = z
  .object({
    session_max_age_min: z.number().int().min(5, "At least 5 minutes").max(24 * 60).optional(),
    idle_lock_min: z.number().int().min(5, "At least 5 minutes").max(24 * 60).optional(),
    password_min_length: z.number().int().min(8, "At least 8").max(64, "At most 64").optional(),
    two_step_roles: z.array(RoleCode).max(50).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Change at least one rule");

/** A wrong or refused sign-in, from the audit ledger. */
const FailedSignIn = z
  .object({
    audit_ledger_id: uuid,
    occurred_at: isoDateTime,
    /** The email typed, or the account's own when the email matched one. */
    email: z.string().nullable(),
    display_name: z.string().nullable(),
    ip_address: z.string().nullable(),
    reason: z.enum(["bad_password", "bad_code", "no_such_account", "throttled", "suspended", "closed", "other"]),
  })
  .strict();

/** GET /settings/security/failed-logins: newest first. */
const FailedSignInListQuery = listQuery({ days: z.coerce.number().int().min(1).max(365).optional() }, [
  "occurred_at",
]);
const FailedSignInPage = Paged(FailedSignIn);

/** A live session of anyone, for an administrator to see and end. */
const LiveSession = z
  .object({
    session_id: uuid,
    user_id: uuid,
    display_name: z.string(),
    email: z.string(),
    device_label: z.string(),
    ip_address: z.string().nullable(),
    method: SignInMethod,
    issued_at: isoDateTime,
    last_seen_at: isoDateTime,
    /** The session this request came from. */
    current: z.boolean(),
  })
  .strict();

/** GET /settings/security/sessions: most recently used first. */
const LiveSessionListQuery = listQuery({}, ["last_seen_at", "issued_at"]);
const LiveSessionPage = Paged(LiveSession);

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  Organisation: {
    table: null,
    reason: "the organisation profile, one setting row per field (organisation.*), with the product's fixed currency and time zone",
  },
  OrganisationPatch: { table: null, reason: "profile fields written as setting rows (organisation.*)" },
  WorkingDay: { table: "working_week" },
  WorkingWeek: { table: null, reason: "the seven working_week rows" },
  WorkingWeekSave: { table: null, reason: "the seven working_week rows, written together" },
  Holiday: { table: "public_holiday" },
  HolidayListQuery: { table: null, reason: "list controls and the year filter for the holiday list" },
  HolidayPage: { table: null, reason: "a page of public holidays" },
  HolidaySave: { table: "public_holiday" },
  NumberingScheme: {
    table: "numbering_scheme",
    virtual: {
      label: "the document type's name, from the settings module's labels",
      next: "the next number, formatted from the scheme and numbering_counter",
      issued: "numbering_counter.last_value for the current period",
    },
  },
  NumberingListQuery: { table: null, reason: "list controls for the numbering list" },
  NumberingPage: { table: null, reason: "a page of numbering schemes" },
  NumberingSummary: { table: null, reason: "counts over numbering_scheme and numbering_counter" },
  NumberingSchemeSave: { table: "numbering_scheme" },
  NumberingParams: { table: null, reason: "the :doc_type path parameter" },
  TwoStepRole: {
    table: "role",
    virtual: {
      holders: "active logins holding the role, from user_role",
      enrolled: "of them, logins with app_user.mfa_enrolled_at set",
    },
  },
  SecurityPolicy: {
    table: null,
    reason: "the security setting rows (security.*) against the .env floors, two-step by role, and counts from user_session, app_user and audit_ledger",
  },
  SecurityPolicyPatch: { table: null, reason: "security rules written as setting rows, and role.two_step_required" },
  FailedSignIn: {
    table: "audit_ledger",
    virtual: {
      email: "the email typed (event_log.payload) or the account's (app_user)",
      display_name: "the account holder's name, from employee",
      ip_address: "audit_ledger.actor_ip",
      reason: "event_log.payload.reason, grouped",
    },
  },
  FailedSignInListQuery: { table: null, reason: "list controls and the days filter for failed sign-ins" },
  FailedSignInPage: { table: null, reason: "a page of failed sign-ins" },
  LiveSession: {
    table: "user_session",
    virtual: {
      display_name: "the login's employee name",
      email: "the login's email, from app_user",
      current: "whether this is the session making the request",
    },
  },
  LiveSessionListQuery: { table: null, reason: "list controls for live sessions" },
  LiveSessionPage: { table: null, reason: "a page of live sessions" },
};

module.exports = {
  TABLES,
  Organisation,
  OrganisationPatch,
  TimeOfDay,
  WorkingDay,
  WorkingWeek,
  WorkingWeekSave,
  Holiday,
  HolidayListQuery,
  HolidayPage,
  HolidaySave,
  DOC_TYPES,
  DocType,
  NumberingReset,
  NumberingScheme,
  NumberingListQuery,
  NumberingPage,
  NumberingSummary,
  NumberingSchemeSave,
  NumberingParams,
  TwoStepRole,
  SecurityPolicy,
  SecurityPolicyPatch,
  FailedSignIn,
  FailedSignInListQuery,
  FailedSignInPage,
  LiveSession,
  LiveSessionListQuery,
  LiveSessionPage,
};
