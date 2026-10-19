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
  "outside_home",
  "location_unverified",
  "unknown_device",
  "suspicious_timestamp",
  "missing_clock_out",
  "automatic_clock_out",
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
    /** The clock-out was the system's, made once the shift ended and the person was away (§6.14). */
    clock_out_automatic: z.boolean(),
    /**
     * Open the clock panel once, on whatever screen comes first: this is the person's first session
     * of a working day and they are not clocked in (attendance.md §6.14, the sign-in prompt).
     */
    sign_in_prompt: z.boolean(),
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
    /**
     * Where the punch is matched: a worksite, the approved home of someone working from home that
     * day (remote staff, or a hybrid employee's home day), someone working from home with no
     * approved home yet (`remote`, judged unverified), or someone expected at an office with none
     * assigned (`none`, judged unverified). On a day an approved work location request covers: its
     * temporary home (`temporary_home`, fenced), a client visit's site (`client_visit`, fenced), or
     * an approved remote day, or a client visit sent before sites were asked for, with no fence
     * (`approved_day`, named in `name`). `home_state` is the home of a remote employee, or of a
     * hybrid employee on a home day: approved, waiting on People, or none; null for anyone else.
     */
    location: z
      .object({
        kind: z.enum(["worksite", "home", "none", "remote", "temporary_home", "approved_day", "field", "client_visit"]),
        name: z.string().nullable(),
        radius_m: z.number().int().nullable(),
        home_state: z.enum(["approved", "pending", "none"]).nullable(),
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
    /** The clock-out that counts was the system's (§6.14). */
    clock_out_automatic: z.boolean(),
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

/**
 * POST /attendance/me/exceptions/:id/explanation, and POST /attendance/me/events/:id/explanation
 * for an automatic clock-out, which opens its exception with the note.
 */
const ExceptionExplanation = z.object({ employee_note: text(1000) }).strict();

/**
 * POST /attendance/exceptions/:id/decision. A correction names the clock-out's time: the missing
 * one, or the real one in place of an automatic clock-out.
 */
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
    expected_location: z.object({ name: z.string(), radius_m: z.number().int().nullable() }).strict().nullable(),
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
 * Home locations: a remote employee's approved home is their fence
 * ------------------------------------------------------------------ */

const HomeStatus = z.enum(["pending", "approved", "rejected", "superseded"]);

/**
 * One of my home locations. The address and the point are personal data: the person's own here,
 * and only People with scope all see them elsewhere (masked under `employee.personal`).
 */
const HomeLocation = z
  .object({
    attendance_home_id: uuid,
    status: HomeStatus,
    home_address: z.string(),
    home_latitude: z.number(),
    home_longitude: z.number(),
    accuracy_m: z.number().nullable(),
    radius_m: z.number().int(),
    requested_at: isoDateTime,
    decided_at: isoDateTime.nullable(),
    decision_reason: z.string().nullable(),
  })
  .strict();

/** GET /attendance/me/home: the home in force, the one waiting, and the last one rejected since. */
const MyHome = z
  .object({
    needed: z.boolean(),
    approved: HomeLocation.nullable(),
    pending: HomeLocation.nullable(),
    rejected: HomeLocation.nullable(),
    max_accuracy_m: z.number().int().min(1),
  })
  .strict();

/** POST /attendance/me/home: one reading taken at home, and the address in the person's words. */
const HomeRequestCreate = z
  .object({
    home_address: text(300),
    home_latitude: z.number().min(-90).max(90),
    home_longitude: z.number().min(-180).max(180),
    accuracy_m: z.number().min(0).max(100000),
  })
  .strict();

/** A home location as People see it; the address and point are null below scope all. */
const HomeRequest = z
  .object({
    attendance_home_id: uuid,
    employee: PersonRef,
    status: HomeStatus,
    home_address: z.string().nullable(),
    home_latitude: z.number().nullable(),
    home_longitude: z.number().nullable(),
    accuracy_m: z.number().nullable(),
    radius_m: z.number().int(),
    distance_from_approved_m: z.number().nullable(),
    requested_at: isoDateTime,
    decided_at: isoDateTime.nullable(),
    decided_by_name: z.string().nullable(),
    decision_reason: z.string().nullable(),
  })
  .strict();
const HomeRequestPage = Paged(HomeRequest);

/** GET /attendance/homes: waiting first, newest first. */
const HomeListQuery = listQuery({ status: HomeStatus.optional(), employee_id: uuid.optional() }, ["requested_at"]);

/** POST /attendance/homes/:id/decision. A rejection says why, for the person to read. */
const HomeDecision = z
  .object({
    decision: z.enum(["approve", "reject"]),
    reason: optionalText(500),
  })
  .strict()
  .refine((v) => v.decision !== "reject" || (v.reason || "").length >= 10, {
    message: "At least 10 characters",
    path: ["reason"],
  });

/* ------------------------------------------------------------------ *
 * Work location requests: somewhere else to work for some days, approved
 * by the line manager and then Operations & People (attendance.location_request)
 * ------------------------------------------------------------------ */

const LocationRequestType = z.enum(["temporary_home", "remote_day", "client_visit"]);
const LocationRequestStatus = z.enum(["submitted", "approved", "rejected", "cancelled"]);

/**
 * A work location request. `home_latitude`, `home_longitude` and `accuracy_m` are a temporary
 * home's reading (null for the other types, and below scope all for People). `site_latitude`,
 * `site_longitude` and `site_radius_m` are a client visit's site, a client's venue that everyone
 * who reads the request sees (null for the other types, and for a client visit sent before sites
 * were asked for). `waiting_on` is the stage it waits at; `can_decide` says whether that stage
 * waits on the reader.
 */
const LocationRequest = z
  .object({
    location_request_id: uuid,
    number: z.string(),
    employee: PersonRef,
    request_type: LocationRequestType,
    starts_on: isoDate,
    ends_on: isoDate,
    days: z.number().int().min(1),
    address: z.string().nullable(),
    home_latitude: z.number().nullable(),
    home_longitude: z.number().nullable(),
    accuracy_m: z.number().nullable(),
    site_latitude: z.number().nullable(),
    site_longitude: z.number().nullable(),
    site_radius_m: z.number().int().nullable(),
    reason: z.string(),
    status: LocationRequestStatus,
    workflow_instance_id: uuid.nullable(),
    waiting_on: z.string().nullable(),
    can_decide: z.boolean(),
    requested_at: isoDateTime,
    decided_at: isoDateTime.nullable(),
    cancelled_at: isoDateTime.nullable(),
    cancel_reason: z.string().nullable(),
  })
  .strict();
const LocationRequestPage = Paged(LocationRequest);

const isNumber = (v) => typeof v === "number";

/**
 * POST /attendance/me/requests. A temporary home carries one reading taken there and its address;
 * a client visit its address and its site, typed as a field site's is (a centre and a radius of 100
 * to 500 m); a remote day may name an address. Who may ask which type, the spans and the overlap are
 * the service's (guide §6.11).
 */
const LocationRequestCreate = z
  .object({
    request_type: LocationRequestType,
    starts_on: isoDate,
    ends_on: isoDate,
    address: optionalText(300),
    reason: text(500).refine((v) => v.length >= 10, "At least 10 characters"),
    home_latitude: z.number().min(-90).max(90).nullable().optional(),
    home_longitude: z.number().min(-180).max(180).nullable().optional(),
    accuracy_m: z.number().min(0).max(100000).nullable().optional(),
    site_latitude: z.number().min(-90).max(90).nullable().optional(),
    site_longitude: z.number().min(-180).max(180).nullable().optional(),
    site_radius_m: z.number().int().min(100, "At least 100 m").max(500, "At most 500 m").nullable().optional(),
  })
  .strict()
  .refine((v) => v.ends_on >= v.starts_on, { message: "Ends before it starts", path: ["ends_on"] })
  .refine((v) => v.request_type === "remote_day" || Boolean(v.address), {
    message: "Enter the address",
    path: ["address"],
  })
  .refine(
    (v) =>
      v.request_type !== "temporary_home" ||
      (typeof v.home_latitude === "number" && typeof v.home_longitude === "number" && typeof v.accuracy_m === "number"),
    { message: "Take a reading there", path: ["home_latitude"] },
  )
  .refine((v) => v.request_type === "temporary_home" || (typeof v.home_latitude !== "number" && typeof v.home_longitude !== "number"), {
    message: "Only for a temporary home",
    path: ["home_latitude"],
  })
  .refine((v) => v.request_type !== "client_visit" || isNumber(v.site_latitude), {
    message: "Enter the latitude",
    path: ["site_latitude"],
  })
  .refine((v) => v.request_type !== "client_visit" || isNumber(v.site_longitude), {
    message: "Enter the longitude",
    path: ["site_longitude"],
  })
  .refine((v) => v.request_type !== "client_visit" || isNumber(v.site_radius_m), {
    message: "Enter the radius",
    path: ["site_radius_m"],
  })
  .refine(
    (v) =>
      v.request_type === "client_visit" ||
      (!isNumber(v.site_latitude) && !isNumber(v.site_longitude) && !isNumber(v.site_radius_m)),
    { message: "Only for a client visit", path: ["site_latitude"] },
  );

/** GET /attendance/me/requests: the person's own, newest first. */
const MyLocationRequestListQuery = listQuery({ status: LocationRequestStatus.optional() }, ["starts_on"]);

/** GET /attendance/requests: within the reader's `people` scope, waiting first. */
const LocationRequestListQuery = listQuery(
  {
    status: LocationRequestStatus.optional(),
    request_type: LocationRequestType.optional(),
    employee_id: uuid.optional(),
  },
  ["starts_on", "requested_at"],
);

/** POST /attendance/me/requests/:id/cancel */
const LocationRequestCancel = z.object({ reason: optionalText(500) }).strict();

/* ------------------------------------------------------------------ *
 * Field assignments: people sent to one or two sites for some days by their
 * line manager or People, in force at once (guide §6.12)
 * ------------------------------------------------------------------ */

/** Worked out on the day in Lagos; `cancelled` is the status. */
const FieldAssignmentState = z.enum(["upcoming", "in_progress", "done", "cancelled"]);
const FieldAssignmentStatus = z.enum(["active", "cancelled"]);

/** One of an assignment's sites: a client's venue, typed as a worksite is. */
const FieldSite = z
  .object({
    field_site_id: uuid,
    position: z.number().int().min(1).max(2),
    name: z.string(),
    address: z.string().nullable(),
    latitude: z.number(),
    longitude: z.number(),
    radius_m: z.number().int(),
  })
  .strict();

/** One person on it; `removed_at` once taken off, with the reason they read. */
const FieldMember = z
  .object({
    employee: PersonRef,
    added_at: isoDateTime,
    removed_at: isoDateTime.nullable(),
    removed_reason: z.string().nullable(),
  })
  .strict();

/**
 * A field assignment. `people` counts those still on it; `members` lists everyone who was (at most
 * 25: people are only ever taken off). `can_change` says whether the reader may cancel it or take
 * someone off.
 */
const FieldAssignment = z
  .object({
    field_assignment_id: uuid,
    number: z.string(),
    name: z.string(),
    client: z.string(),
    note: z.string().nullable(),
    starts_on: isoDate,
    ends_on: isoDate,
    days: z.number().int().min(1),
    status: FieldAssignmentStatus,
    state: FieldAssignmentState,
    sites: z.array(FieldSite).min(1).max(2),
    members: z.array(FieldMember).max(25),
    people: z.number().int().min(0),
    assigned_by_name: z.string().nullable(),
    assigned_at: isoDateTime,
    cancelled_at: isoDateTime.nullable(),
    cancel_reason: z.string().nullable(),
    can_change: z.boolean(),
  })
  .strict();
const FieldAssignmentPage = Paged(FieldAssignment);

const minLength = (n) => (v) => v.length >= n;
const reasonText = text(500).refine(minLength(10), "At least 10 characters");

/** A site as it is set: its centre and radius typed until address search exists (F21). */
const FieldSiteInput = z
  .object({
    name: text(120).refine(minLength(2), "At least 2 characters"),
    address: optionalText(300),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    radius_m: z.number().int().min(100, "At least 100 m").max(500, "At most 500 m"),
  })
  .strict();

/**
 * POST /attendance/field-assignments. Who may be put on it, the dates against today and the overlap
 * are the service's (guide §6.12).
 */
const FieldAssignmentCreate = z
  .object({
    name: text(120).refine(minLength(3), "At least 3 characters"),
    client: text(120).refine(minLength(2), "At least 2 characters"),
    note: optionalText(500),
    starts_on: isoDate,
    ends_on: isoDate,
    employee_ids: z
      .array(uuid)
      .min(1, "Pick someone")
      .max(25, "At most 25 people")
      .refine((ids) => new Set(ids).size === ids.length, "Each person once"),
    sites: z.array(FieldSiteInput).min(1, "Add a site").max(2, "At most two sites"),
  })
  .strict()
  .refine((v) => v.ends_on >= v.starts_on, { message: "Ends before it starts", path: ["ends_on"] });

/** GET /attendance/field-assignments: within the reader's `people` scope, in progress and upcoming first. */
const FieldAssignmentListQuery = listQuery(
  { state: FieldAssignmentState.optional(), employee_id: uuid.optional() },
  ["starts_on"],
);

/** GET /attendance/me/field-assignments: the person's own. */
const MyFieldAssignmentListQuery = listQuery({ state: FieldAssignmentState.optional() }, ["starts_on"]);

/** POST /attendance/field-assignments/:id/cancel: everyone on it reads the reason. */
const FieldAssignmentCancel = z.object({ reason: reasonText }).strict();

/** POST /attendance/field-assignments/:id/remove: the person taken off reads the reason. */
const FieldMemberRemove = z.object({ employee_id: uuid, reason: reasonText }).strict();

/* ------------------------------------------------------------------ *
 * Hybrid staff's weekly schedule: the days at the office, set by People;
 * the other working days are worked from home (guide §6.13)
 * ------------------------------------------------------------------ */

/** An ISO weekday: 1 is Monday, 7 is Sunday. */
const Weekday = z.number().int().min(1).max(7);

/** Where a person works on a day of the week. */
const SchedulePlace = z.enum(["office", "remote", "off"]);

/** One day of the person's week. */
const ScheduleDay = z.object({ weekday: Weekday, place: SchedulePlace }).strict();

/** One version of a hybrid employee's schedule: the office days from a first day. */
const ScheduleVersion = z
  .object({
    attendance_schedule_id: uuid,
    office_days: z.array(Weekday).min(1).max(7),
    effective_from: isoDate,
    reason: z.string(),
    set_by_name: z.string().nullable(),
    set_at: isoDateTime,
  })
  .strict();

/**
 * GET /attendance/schedules/:employee_id: how a person's week is worked. `week` is each weekday
 * (Monday first) by the pattern, the organisation's week and the schedule in force today; `current`
 * is that schedule and `next` one waiting to start (hybrid staff only). `worksite` is the office an
 * office day is matched to, when one is assigned and active. `home_state` is the home of someone who
 * works from home on some days (remote staff, hybrid staff with a home day), else null. `can_edit`
 * says whether the reader may set the schedule.
 */
const WorkSchedule = z
  .object({
    employee: PersonRef,
    work_pattern: WorkPattern,
    worksite: z.object({ worksite_id: uuid, name: z.string(), radius_m: z.number().int() }).strict().nullable(),
    home_state: z.enum(["approved", "pending", "none"]).nullable(),
    week: z.array(ScheduleDay).length(7),
    current: ScheduleVersion.nullable(),
    next: ScheduleVersion.nullable(),
    can_edit: z.boolean(),
  })
  .strict();

const ScheduleParams = z.object({ employee_id: uuid }).strict();

/**
 * POST /attendance/schedules/:employee_id. The office days, each once; that they are working days,
 * that one is left for home, the first day against today and who may set it are the service's
 * (guide §6.13).
 */
const WorkScheduleSet = z
  .object({
    office_days: z
      .array(Weekday)
      .min(1, "Pick an office day")
      .max(6, "Leave a home day")
      .refine((days) => new Set(days).size === days.length, "Each day once"),
    effective_from: isoDate,
    reason: reasonText,
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
  HomeLocation: {
    table: "attendance_home",
    virtual: {
      home_address: "attendance_home.address, named for the personal-details mask",
      home_latitude: "attendance_home.latitude, named for the personal-details mask",
      home_longitude: "attendance_home.longitude, named for the personal-details mask",
      radius_m: "the policy's home_radius_m",
    },
  },
  MyHome: { table: null, reason: "the person's home locations: in force, waiting and last rejected" },
  HomeRequestCreate: {
    table: "attendance_home",
    virtual: {
      home_address: "written to attendance_home.address",
      home_latitude: "written to attendance_home.latitude",
      home_longitude: "written to attendance_home.longitude",
    },
  },
  HomeRequest: {
    table: "attendance_home",
    virtual: {
      employee: "the person, from employee and department",
      home_address: "attendance_home.address, null below scope all",
      home_latitude: "attendance_home.latitude, null below scope all",
      home_longitude: "attendance_home.longitude, null below scope all",
      radius_m: "the policy's home_radius_m",
      distance_from_approved_m: "metres between this point and the person's approved home",
      decided_by_name: "who decided it, from employee",
    },
  },
  HomeRequestPage: { table: null, reason: "a page of home locations" },
  HomeListQuery: { table: null, reason: "list controls for the home locations" },
  HomeDecision: {
    table: "attendance_home",
    virtual: { decision: "written as attendance_home.status approved or rejected", reason: "attendance_home.decision_reason" },
  },
  ScheduleDay: { table: null, reason: "one weekday's place, from the pattern, working_week and attendance_schedule" },
  ScheduleVersion: {
    table: "attendance_schedule",
    virtual: { set_by_name: "who set it, from app_user and employee" },
  },
  WorkSchedule: {
    table: null,
    reason: "a person's week, from employee, worksite, attendance_home, working_week and attendance_schedule",
  },
  ScheduleParams: { table: null, reason: "the person whose schedule it is" },
  WorkScheduleSet: { table: "attendance_schedule" },
  LocationRequest: {
    table: "attendance_location_request",
    virtual: {
      employee: "the person, from employee and department",
      days: "calendar days from starts_on to ends_on",
      home_latitude: "attendance_location_request.latitude, named for the personal-details mask",
      home_longitude: "attendance_location_request.longitude, named for the personal-details mask",
      waiting_on: "the name of the approval stage it waits at, from workflow_instance",
      can_decide: "whether that stage waits on the reader (shared/workflow/approvers.js)",
    },
  },
  LocationRequestPage: { table: null, reason: "a page of work location requests" },
  LocationRequestCreate: {
    table: "attendance_location_request",
    virtual: {
      home_latitude: "written to attendance_location_request.latitude",
      home_longitude: "written to attendance_location_request.longitude",
    },
  },
  MyLocationRequestListQuery: { table: null, reason: "list controls for the person's own requests" },
  LocationRequestListQuery: { table: null, reason: "list controls for People's requests" },
  LocationRequestCancel: {
    table: null,
    reason: "why a request is withdrawn or cancelled; kept on the request and the audit row",
  },
  FieldSite: { table: "attendance_field_site" },
  FieldMember: {
    table: "attendance_field_member",
    virtual: { employee: "the person, from employee and department" },
  },
  FieldAssignment: {
    table: "attendance_field_assignment",
    virtual: {
      days: "calendar days from starts_on to ends_on",
      state: "upcoming, in progress or done against today in Lagos, else cancelled",
      sites: "its attendance_field_site rows",
      members: "its attendance_field_member rows",
      people: "how many attendance_field_member rows are not removed",
      assigned_by_name: "who set it, from employee",
      can_change: "whether the reader holds people approve over everyone still on it",
    },
  },
  FieldAssignmentPage: { table: null, reason: "a page of field assignments" },
  FieldSiteInput: { table: "attendance_field_site" },
  FieldAssignmentCreate: {
    table: "attendance_field_assignment",
    virtual: {
      employee_ids: "written as attendance_field_member rows",
      sites: "written as attendance_field_site rows",
    },
  },
  FieldAssignmentListQuery: { table: null, reason: "list controls for People's field assignments" },
  MyFieldAssignmentListQuery: { table: null, reason: "list controls for the person's own field assignments" },
  FieldAssignmentCancel: { table: null, reason: "why it is cancelled; kept as cancel_reason and on the audit row" },
  FieldMemberRemove: {
    table: null,
    reason: "who is taken off and why; kept as removed_reason on their attendance_field_member row",
  },
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
    virtual: {
      open_exceptions: "count of the day's open attendance_exception rows",
      clock_out_automatic: "the day's counted clock-out is an attendance_event with source system",
    },
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
      excluded:
        "an exception on it was decided rejected, or an automatic clock-out's was corrected, so the day does not count it",
      recorded_by_name: "who recorded a correction, from employee",
    },
  },
  AttendanceEventPage: { table: null, reason: "a page of punches" },
  MyEventListQuery: { table: null, reason: "list controls for one of my days" },
  EventListQuery: { table: null, reason: "list controls for one person's day" },
  AttendanceException: {
    table: "attendance_exception",
    virtual: {
      employee: "the person, from attendance_day and employee, with their photo_url",
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
  HomeStatus,
  HomeLocation,
  MyHome,
  HomeRequestCreate,
  HomeRequest,
  HomeRequestPage,
  HomeListQuery,
  HomeDecision,
  LocationRequestType,
  LocationRequestStatus,
  LocationRequest,
  LocationRequestPage,
  LocationRequestCreate,
  MyLocationRequestListQuery,
  LocationRequestListQuery,
  LocationRequestCancel,
  FieldAssignmentState,
  FieldAssignmentStatus,
  FieldSite,
  FieldMember,
  FieldAssignment,
  FieldAssignmentPage,
  FieldSiteInput,
  FieldAssignmentCreate,
  FieldAssignmentListQuery,
  MyFieldAssignmentListQuery,
  FieldAssignmentCancel,
  FieldMemberRemove,
  Weekday,
  SchedulePlace,
  ScheduleDay,
  ScheduleVersion,
  WorkSchedule,
  ScheduleParams,
  WorkScheduleSet,
};
