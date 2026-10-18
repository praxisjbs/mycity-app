"use strict";
/**
 * Attendance: the person's clock, their days, People's register and the exceptions
 * a punch or the day-close opens (docs/guides/attendance.md §4 to §6).
 *
 * The person is always the session's. A punch names no employee, and every route
 * under /attendance/me answers for the caller alone; People read within their
 * `people` scope under /attendance/register, /events and /exceptions.
 *
 * A punch carries the device's own time (`device_at`) beside the server's, the
 * reading the browser gave (or why it gave none), and never a distance, an
 * inside flag or a device verdict: the server works those out. The device is the
 * session's, so it is not in the body either.
 *
 * Results a person reads:
 *   accepted   the punch stands
 *   review     recorded, waiting on People (an exception is open)
 *   rejected   recorded as an attempt; it does not count, and the person punches again
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
const { PersonRef, WorkPattern } = require("./organisation");

const EventType = z.enum(["clock_in", "clock_out"]);
const PunchState = z.enum(["accepted", "review", "rejected"]);
const PolicyMode = z.enum(["off", "warn", "block"]);
const DayStatus = z.enum(["present", "late", "absent", "leave"]);
/** The register's status: a day's own, or what a day with no row means. */
const RegisterStatus = z.enum(["present", "late", "absent", "leave", "not_in", "off"]);
const ExceptionType = z.enum([
  "outside_worksite",
  "location_unverified",
  "unknown_device",
  "suspicious_timestamp",
  "missing_clock_out",
]);
const ExceptionStatus = z.enum(["open", "resolved"]);
const ExceptionOutcome = z.enum(["accepted", "rejected", "corrected"]);
/** Why the browser gave no reading. */
const LocationError = z.enum(["denied", "unavailable", "timeout", "unsupported"]);
const GeofenceVerdict = z.enum(["inside", "outside", "unverified", "not_applied"]);
const DeviceState = z.enum(["registered", "observed", "removed", "none"]);
const TodayState = z.enum(["not_clocked_in", "clocked_in", "clocked_out", "unavailable"]);
const Severity = z.enum(["low", "medium", "high"]);

/** A month, YYYY-MM. */
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "must be a month as YYYY-MM");
/** A wall-clock time, HH:MM, 24 hour. */
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be a time as HH:MM");
const minutes = z.number().int().min(0);

/* ------------------------------------------------------------------ *
 * The clock
 * ------------------------------------------------------------------ */

/** What the clock panel and the floating button show; the server's word on the state. */
const AttendanceToday = z
  .object({
    date: isoDate,
    timezone: z.string(),
    server_time: isoDateTime,
    state: TodayState,
    unavailable_reason: z.enum(["leave", "not_employed"]).nullable(),
    leave: z
      .object({ starts_on: isoDate, ends_on: isoDate, leave_type_name: z.string() })
      .strict()
      .nullable(),
    clock_in_at: isoDateTime.nullable(),
    clock_out_at: isoDateTime.nullable(),
    review: z.boolean(),
    shift: z
      .object({
        working_day: z.boolean(),
        starts_at: clockTime.nullable(),
        ends_at: clockTime.nullable(),
        grace_minutes: minutes,
        off_reason: z.string().nullable(),
      })
      .strict(),
    work_pattern: WorkPattern,
    location: z
      .object({
        kind: z.enum(["worksite", "none", "remote"]),
        name: z.string().nullable(),
        radius_m: z.number().int().nullable(),
      })
      .strict(),
    policy: z
      .object({ geofence_mode: PolicyMode, device_mode: PolicyMode, max_accuracy_m: z.number().int().min(1) })
      .strict(),
    device: z
      .object({
        state: DeviceState,
        label: z.string().nullable(),
        registered_count: z.number().int().min(0),
        can_register: z.boolean(),
      })
      .strict(),
  })
  .strict();

/** POST /attendance/punches. Latitude and longitude come together or not at all. */
const PunchCreate = z
  .object({
    event_type: EventType,
    device_at: isoDateTime,
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    accuracy_m: z.number().min(0).max(100000).nullable(),
    location_error: LocationError.nullable().optional(),
    note: optionalText(500),
  })
  .strict()
  .refine((v) => (v.latitude === null) === (v.longitude === null), {
    message: "Send both coordinates or neither",
    path: ["longitude"],
  });

/** What a punch did, and the state after it. */
const PunchResult = z
  .object({
    attendance_event_id: uuid,
    event_type: EventType,
    validation_state: PunchState,
    occurred_at: isoDateTime,
    device_at: isoDateTime.nullable(),
    work_date: isoDate,
    reasons: z.array(ExceptionType).max(5),
    distance_m: z.number().nullable(),
    worksite_name: z.string().nullable(),
    message: z.string(),
    replayed: z.boolean(),
    today: AttendanceToday,
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Days and punches
 * ------------------------------------------------------------------ */

/** One person's day. */
const AttendanceDay = z
  .object({
    attendance_day_id: uuid,
    attendance_date: isoDate,
    status: DayStatus.nullable(),
    first_clock_in_at: isoDateTime.nullable(),
    last_clock_out_at: isoDateTime.nullable(),
    worked_minutes: minutes,
    late_minutes: minutes,
    overtime_minutes: minutes,
    closed_at: isoDateTime.nullable(),
    open_exceptions: z.number().int().min(0),
  })
  .strict();
const AttendanceDayPage = Paged(AttendanceDay);

/**
 * GET /attendance/me: the days of a month (this month when absent), newest first. `status`
 * keeps the days behind one of My Attendance's figures; `present` is a day present or late,
 * as Days Present counts it.
 */
const MyDayListQuery = listQuery({ month: month.optional(), status: DayStatus.optional() }, ["attendance_date"]);

/** GET /attendance/me/summary */
const MySummaryQuery = z.object({ month: month.optional() }).strict();
const MyAttendanceSummary = z
  .object({
    month,
    days_present: z.number().int().min(0),
    late_days: z.number().int().min(0),
    absent_days: z.number().int().min(0),
    leave_days: z.number().int().min(0),
    worked_minutes: minutes,
    late_minutes: minutes,
    open_exceptions: z.number().int().min(0),
  })
  .strict();

/**
 * One punch with its evidence. The coordinates are null unless the reader holds
 * `people` with scope all; the person's own screens and team scope get the
 * verdict, the distance and the worksite's name.
 */
const AttendanceEvent = z
  .object({
    attendance_event_id: uuid,
    event_type: EventType,
    work_date: isoDate,
    occurred_at: isoDateTime,
    device_at: isoDateTime.nullable(),
    skew_seconds: z.number().int().nullable(),
    validation_state: PunchState,
    source: z.enum(["pwa", "admin", "import", "system"]),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    accuracy_m: z.number().nullable(),
    distance_m: z.number().nullable(),
    worksite_name: z.string().nullable(),
    geofence: GeofenceVerdict,
    location_reason: z.string().nullable(),
    device_label: z.string().nullable(),
    device_state: DeviceState,
    reasons: z.array(ExceptionType).max(5),
    note: z.string().nullable(),
    excluded: z.boolean(),
    recorded_by_name: z.string().nullable(),
    reason: z.string().nullable(),
  })
  .strict();
const AttendanceEventPage = Paged(AttendanceEvent);

/** GET /attendance/me/events: one of my days' punches. */
const MyEventListQuery = listQuery({ date: isoDate });
/** GET /attendance/events: one person's day, for People. */
const EventListQuery = listQuery({ employee_id: uuid, date: isoDate });

/* ------------------------------------------------------------------ *
 * Exceptions
 * ------------------------------------------------------------------ */

const AttendanceException = z
  .object({
    attendance_exception_id: uuid,
    attendance_day_id: uuid,
    attendance_event_id: uuid.nullable(),
    employee: PersonRef,
    work_date: isoDate,
    exception_type: ExceptionType,
    severity: Severity,
    status: ExceptionStatus,
    outcome: ExceptionOutcome.nullable(),
    detail: z.string(),
    employee_note: z.string().nullable(),
    employee_noted_at: isoDateTime.nullable(),
    resolution: z.string().nullable(),
    reviewed_at: isoDateTime.nullable(),
    reviewed_by_name: z.string().nullable(),
    created_at: isoDateTime,
  })
  .strict();
const AttendanceExceptionPage = Paged(AttendanceException);

const MyExceptionListQuery = listQuery({ status: ExceptionStatus.optional() }, ["created_at"]);
const ExceptionListQuery = listQuery(
  {
    status: ExceptionStatus.optional(),
    exception_type: ExceptionType.optional(),
    date: isoDate.optional(),
    employee_id: uuid.optional(),
  },
  ["created_at"],
);

/** POST /attendance/me/exceptions/:id/explanation */
const ExceptionExplanation = z.object({ employee_note: text(1000) }).strict();

/** POST /attendance/exceptions/:id/decision. A correction names the missing clock-out's time. */
const ExceptionDecision = z
  .object({
    decision: z.enum(["accept", "reject", "add_clock_out"]),
    resolution: z.string().trim().min(10, "At least 10 characters").max(500),
    clock_out_time: clockTime.optional(),
  })
  .strict()
  .refine((v) => v.decision !== "add_clock_out" || Boolean(v.clock_out_time), {
    message: "Give the time",
    path: ["clock_out_time"],
  });

/* ------------------------------------------------------------------ *
 * The register
 * ------------------------------------------------------------------ */

const RegisterQuery = listQuery(
  {
    date: isoDate.optional(),
    status: RegisterStatus.optional(),
    department_id: uuid.optional(),
  },
  ["display_name", "clock_in_at", "status"],
);

/** One person on one day: their day row, or what having none means. */
const RegisterRow = z
  .object({
    employee: PersonRef,
    work_pattern: WorkPattern,
    date: isoDate,
    status: RegisterStatus,
    attendance_day_id: uuid.nullable(),
    clock_in_at: isoDateTime.nullable(),
    clock_out_at: isoDateTime.nullable(),
    worked_minutes: minutes,
    late_minutes: minutes,
    expected_location: z.string().nullable(),
    location_verdict: GeofenceVerdict.nullable(),
    device_label: z.string().nullable(),
    device_state: DeviceState.nullable(),
    open_exceptions: z.number().int().min(0),
  })
  .strict();
const RegisterPage = Paged(RegisterRow);

const RegisterSummaryQuery = z.object({ date: isoDate.optional() }).strict();
const RegisterSummary = z
  .object({
    date: isoDate,
    expected: z.number().int().min(0),
    present: z.number().int().min(0),
    late: z.number().int().min(0),
    absent: z.number().int().min(0),
    on_leave: z.number().int().min(0),
    not_in: z.number().int().min(0),
    open_exceptions: z.number().int().min(0),
  })
  .strict();

const DayDetailParams = z.object({ employee_id: uuid }).strict();
const DayDetailQuery = z.object({ date: isoDate.optional() }).strict();
const DayDetail = z
  .object({
    employee: PersonRef,
    date: isoDate,
    work_pattern: WorkPattern,
    status: RegisterStatus,
    attendance_day_id: uuid.nullable(),
    shift: z
      .object({
        working_day: z.boolean(),
        starts_at: clockTime.nullable(),
        ends_at: clockTime.nullable(),
        grace_minutes: minutes,
      })
      .strict(),
    clock_in_at: isoDateTime.nullable(),
    clock_out_at: isoDateTime.nullable(),
    worked_minutes: minutes,
    late_minutes: minutes,
    overtime_minutes: minutes,
    closed: z.boolean(),
    expected_location: z.object({ name: z.string(), radius_m: z.number().int() }).strict().nullable(),
    policy: z.object({ geofence_mode: PolicyMode, device_mode: PolicyMode }).strict(),
    open_exceptions: z.number().int().min(0),
  })
  .strict();

/**
 * What a link to an attendance record opens: the person and the day, from a day's id or
 * an exception's (shared/route-map.js attendance_record, attendance_exception).
 */
const AttendanceRecordRef = z
  .object({
    attendance_day_id: uuid,
    attendance_exception_id: uuid.nullable(),
    employee_id: uuid,
    date: isoDate,
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Exports
 * ------------------------------------------------------------------ */

/** POST /attendance/me/export */
const MyExportRequest = z.object({ month }).strict();

/** POST /attendance/export: at most 31 days. */
const RegisterExportRequest = z
  .object({
    from: isoDate,
    to: isoDate,
    status: RegisterStatus.optional(),
    department_id: uuid.optional(),
    q: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine((v) => v.to >= v.from, { message: "Ends before it starts", path: ["to"] })
  .refine(
    (v) => (Date.parse(`${v.to}T00:00:00Z`) - Date.parse(`${v.from}T00:00:00Z`)) / 86_400_000 <= 30,
    { message: "At most 31 days", path: ["to"] },
  );

const AttendanceExportQueued = z.object({ queued: z.literal(true), email: z.string() }).strict();

/** templates/email/attendance-export.html */
const AttendanceExportEmailVars = z
  .object({
    title: z.string(),
    period: z.string(),
    entries: z.number().int().min(0),
    capped: z.boolean(),
  })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  AttendanceToday: {
    table: null,
    reason: "the person's state now, from their day, the working week, their policy, worksite and device",
  },
  PunchCreate: {
    table: "attendance_event",
    virtual: { location_error: "why the browser gave no reading; kept in attendance_event.validation" },
  },
  PunchResult: {
    table: "attendance_event",
    virtual: {
      reasons: "the exception types the punch opened or would have opened, from attendance_event.validation",
      worksite_name: "worksite.name",
      message: "one line for the person, from the result",
      replayed: "the answer is the original punch's, for a repeated idempotency key",
      today: "the state after the punch",
    },
  },
  AttendanceDay: {
    table: "attendance_day",
    virtual: { open_exceptions: "count of the day's open attendance_exception rows" },
  },
  AttendanceDayPage: { table: null, reason: "a page of a person's days" },
  MyDayListQuery: { table: null, reason: "list controls for my days" },
  MySummaryQuery: { table: null, reason: "the month the figures are for" },
  MyAttendanceSummary: { table: null, reason: "a month's figures, counted from attendance_day" },
  AttendanceEvent: {
    table: "attendance_event",
    virtual: {
      skew_seconds: "occurred_at minus device_at, in seconds",
      worksite_name: "worksite.name",
      geofence: "the geofence verdict, from attendance_event.validation",
      location_reason: "why the location is unverified or not judged, from attendance_event.validation",
      device_label: "attendance_device.label",
      device_state: "the device's state when it punched, from attendance_event.validation",
      reasons: "the exception types the punch opened, from attendance_event.validation",
      excluded: "an exception on it was decided rejected, so the day does not count it",
      recorded_by_name: "who recorded a correction, from employee",
    },
  },
  AttendanceEventPage: { table: null, reason: "a page of punches" },
  MyEventListQuery: { table: null, reason: "list controls for one of my days" },
  EventListQuery: { table: null, reason: "list controls for one person's day" },
  AttendanceException: {
    table: "attendance_exception",
    virtual: {
      employee: "the person, from attendance_day and employee",
      work_date: "attendance_day.attendance_date",
      detail: "one line from attendance_exception.evidence",
      reviewed_by_name: "who decided it, from employee",
    },
  },
  AttendanceExceptionPage: { table: null, reason: "a page of exceptions" },
  MyExceptionListQuery: { table: null, reason: "list controls for my exceptions" },
  ExceptionListQuery: { table: null, reason: "list controls for the exceptions" },
  ExceptionExplanation: { table: "attendance_exception" },
  ExceptionDecision: {
    table: "attendance_exception",
    virtual: {
      decision: "written to attendance_exception.outcome as accepted, rejected or corrected",
      clock_out_time: "the time of the clock-out a correction appends to attendance_event",
    },
  },
  RegisterQuery: { table: null, reason: "list controls for the register" },
  RegisterRow: {
    table: null,
    reason: "one person on one day, from employee, attendance_day and the day's latest punch",
  },
  RegisterPage: { table: null, reason: "a page of the register" },
  RegisterSummaryQuery: { table: null, reason: "the day the figures are for" },
  RegisterSummary: { table: null, reason: "the register's figures for a day, counted in scope" },
  DayDetailParams: { table: null, reason: "the person a day belongs to" },
  DayDetailQuery: { table: null, reason: "the day to open" },
  DayDetail: { table: null, reason: "one person's day with its shift and policy" },
  AttendanceRecordRef: { table: null, reason: "the person and day a link to a day or an exception opens" },
  MyExportRequest: { table: null, reason: "the month to export" },
  RegisterExportRequest: { table: null, reason: "the register's filters for an export" },
  AttendanceExportQueued: { table: null, reason: "that the export was queued, and where it will be emailed" },
  AttendanceExportEmailVars: {
    table: null,
    reason: "the variables of templates/email/attendance-export.html, not a row",
  },
};

module.exports = {
  TABLES,
  EventType,
  PunchState,
  PolicyMode,
  DayStatus,
  RegisterStatus,
  ExceptionType,
  ExceptionStatus,
  ExceptionOutcome,
  LocationError,
  GeofenceVerdict,
  DeviceState,
  TodayState,
  AttendanceToday,
  PunchCreate,
  PunchResult,
  AttendanceDay,
  AttendanceDayPage,
  MyDayListQuery,
  MySummaryQuery,
  MyAttendanceSummary,
  AttendanceEvent,
  AttendanceEventPage,
  MyEventListQuery,
  EventListQuery,
  AttendanceException,
  AttendanceExceptionPage,
  MyExceptionListQuery,
  ExceptionListQuery,
  ExceptionExplanation,
  ExceptionDecision,
  RegisterQuery,
  RegisterRow,
  RegisterPage,
  RegisterSummaryQuery,
  RegisterSummary,
  DayDetailParams,
  DayDetailQuery,
  DayDetail,
  AttendanceRecordRef,
  MyExportRequest,
  RegisterExportRequest,
  AttendanceExportQueued,
  AttendanceExportEmailVars,
};
