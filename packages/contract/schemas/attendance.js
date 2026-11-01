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
  money,
} = require("./common");
const { PersonRef, WorkPattern } = require("./organisation");
const { PlaceInput } = require("./maps");

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
/** Why the browser gave no reading: refused, none found, too slow, no location at all, or a page off its secure address. */
const LocationError = z.enum(["denied", "unavailable", "timeout", "unsupported", "insecure"]);
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
 * Temporary sites: somewhere else to work for some days, added from Home for oneself and
 * colleagues and approved by People, or added by People in force at once; and the check-ins
 * at each stop on their days (guide §6.11, §6.12, PR 4)
 * ------------------------------------------------------------------ */

/** Why people work there: product vocabulary, not a business choice (A26), in the guide's order. */
const TemporarySitePurpose = z.enum([
  "client_visit",
  "partner_meeting",
  "training_delivering",
  "training_attending",
  "event",
  "conference",
  "workshop",
  "exhibition",
  "market_activation",
  "field_survey",
  "site_inspection",
  "media_engagement",
  "government_visit",
  "out_of_station",
  "coworking_space",
  "temporary_home",
  "other",
]);
const TemporarySiteStatus = z.enum(["submitted", "approved", "rejected", "withdrawn", "cancelled"]);
/** Its days' hours: the organisation's week (`usual`), or its own start and end on every day (`site`). */
const TemporarySiteHours = z.enum(["usual", "site"]);
/** Worked out on the day in Lagos: `submitted` while it waits (Awaiting Approval), else by its days or its status. */
const TemporarySiteState = z.enum(["submitted", "upcoming", "in_progress", "done", "rejected", "withdrawn", "cancelled"]);

/** The longest a site runs, in calendar days, first and last included. */
const SITE_MAX_DAYS = 90;
const daysSpanned = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
const siteReason = text(500).refine((v) => v.length >= 10, "At least 10 characters");

/**
 * One of a site's addresses, in its order. A venue's line and point are `address`, `latitude` and
 * `longitude`; a Temporary Home's are `home_address`, `home_latitude` and `home_longitude` instead,
 * personal data: null below its own people, its submitter and `people` scope all, and masked under
 * `employee.personal`. `name` is its optional label; `timezone` the place's.
 */
const TemporarySiteLocation = z
  .object({
    temporary_site_location_id: uuid,
    position: z.number().int().min(1).max(8),
    name: z.string().nullable(),
    address: z.string().nullable(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    home_address: z.string().nullable(),
    home_latitude: z.number().nullable(),
    home_longitude: z.number().nullable(),
    radius_m: z.number().int(),
    timezone: z.string(),
  })
  .strict();

/** One person on it; `removed_at` once taken off, with the reason they read. */
const TemporarySiteMember = z
  .object({
    employee: PersonRef,
    added_at: isoDateTime,
    removed_at: isoDateTime.nullable(),
    removed_reason: z.string().nullable(),
  })
  .strict();

/**
 * A temporary site. `hours` is `usual` (the organisation's week, `starts_at` and `ends_at` null) or
 * `site` (every day of it worked from `starts_at` to `ends_at` on its own clock). `people` counts
 * those still on it; `members` lists everyone who was (at most 25). `waiting_on` is the approval
 * stage it waits at. `can_decide`: that stage waits on the reader,
 * who is not on it; `can_change`: the reader may cancel it or take someone off; `can_withdraw`: the
 * reader submitted it and it still waits.
 */
const TemporarySite = z
  .object({
    temporary_site_id: uuid,
    number: z.string(),
    purpose: TemporarySitePurpose,
    name: z.string(),
    description: z.string(),
    starts_on: isoDate,
    ends_on: isoDate,
    days: z.number().int().min(1),
    hours: TemporarySiteHours,
    starts_at: clockTime.nullable(),
    ends_at: clockTime.nullable(),
    status: TemporarySiteStatus,
    state: TemporarySiteState,
    locations: z.array(TemporarySiteLocation).min(1).max(8),
    members: z.array(TemporarySiteMember).max(25),
    people: z.number().int().min(0),
    submitted_by_name: z.string().nullable(),
    submitted_at: isoDateTime,
    workflow_instance_id: uuid.nullable(),
    waiting_on: z.string().nullable(),
    approved_at: isoDateTime.nullable(),
    approved_by_name: z.string().nullable(),
    cancelled_at: isoDateTime.nullable(),
    cancel_reason: z.string().nullable(),
    can_decide: z.boolean(),
    can_change: z.boolean(),
    can_withdraw: z.boolean(),
  })
  .strict();
const TemporarySitePage = Paged(TemporarySite);

/** An address as the sheet sends it: picked or pinned (F27), with an optional label and its radius (T9). */
const TemporarySiteLocationInput = z
  .object({
    address: PlaceInput,
    name: optionalText(60),
    radius_m: z.number().int().min(150, "At least 150 m").max(500, "At most 500 m"),
  })
  .strict();

/**
 * POST /attendance/me/temporary-sites (Add Work Site) and POST /attendance/temporary-sites (People's
 * own). Site Hours take a start and an end on the same day; the Usual Shift takes neither. The
 * dates against today, who may be on it and the one-a-day rule are the service's (guide §6.11).
 */
const TemporarySiteCreate = z
  .object({
    hours: TemporarySiteHours.default("usual"),
    starts_at: clockTime.nullable().optional(),
    ends_at: clockTime.nullable().optional(),
    purpose: TemporarySitePurpose,
    name: text(120).refine((v) => v.length >= 3, "At least 3 characters"),
    description: text(1000).refine((v) => v.length >= 30, "At least 30 characters"),
    starts_on: isoDate,
    ends_on: isoDate,
    locations: z.array(TemporarySiteLocationInput).min(1, "Add an address").max(8, "At most eight addresses"),
    employee_ids: z
      .array(uuid)
      .min(1, "Pick someone")
      .max(25, "At most 25 people")
      .refine((ids) => new Set(ids).size === ids.length, "Each person once"),
  })
  .strict()
  .refine((v) => v.ends_on >= v.starts_on, { message: "Ends before it starts", path: ["ends_on"] })
  .refine((v) => v.ends_on < v.starts_on || daysSpanned(v.starts_on, v.ends_on) <= SITE_MAX_DAYS, {
    message: "At most 90 days",
    path: ["ends_on"],
  })
  .refine((v) => v.purpose !== "temporary_home" || v.locations.length === 1, {
    message: "One address only",
    path: ["locations"],
  })
  .refine((v) => v.hours !== "site" || Boolean(v.starts_at), { message: "Pick a start", path: ["starts_at"] })
  .refine((v) => v.hours !== "site" || Boolean(v.ends_at), { message: "Pick an end", path: ["ends_at"] })
  .refine((v) => v.hours !== "site" || !v.starts_at || !v.ends_at || v.ends_at > v.starts_at, {
    message: "Ends before it starts",
    path: ["ends_at"],
  })
  .refine((v) => v.hours !== "usual" || (!v.starts_at && !v.ends_at), {
    message: "Only for Site Hours",
    path: ["starts_at"],
  });

/** GET /attendance/temporary-sites: within the reader's `people` scope, waiting first. */
const TemporarySiteListQuery = listQuery(
  {
    status: TemporarySiteStatus.optional(),
    state: TemporarySiteState.optional(),
    purpose: TemporarySitePurpose.optional(),
    employee_id: uuid.optional(),
  },
  ["starts_on"],
);

/** GET /attendance/me/temporary-sites: the person's own, waiting and current first. */
const MyTemporarySiteListQuery = listQuery({ state: TemporarySiteState.optional() }, ["starts_on"]);

/** POST /attendance/me/temporary-sites/:id/withdraw and /attendance/temporary-sites/:id/cancel. */
const TemporarySiteCancel = z.object({ reason: siteReason }).strict();

/** POST /attendance/temporary-sites/:id/remove: the person taken off reads the reason. */
const TemporarySiteMemberRemove = z.object({ employee_id: uuid, reason: siteReason }).strict();

/** Where a check-in stands against the address it was matched to. */
const CheckInVerdict = z.enum(["inside", "outside", "unverified"]);

/**
 * One stop. `location_name` is the address's label, else the site's name when it has one address,
 * else "Address N" (Temporary Home for a home);
 * `address` its line for a venue, `home_address` a Temporary Home's (as on the site); never a point.
 * `flagged`: it opened an exception for People.
 */
const CheckIn = z
  .object({
    attendance_check_in_id: uuid,
    work_date: isoDate,
    occurred_at: isoDateTime,
    temporary_site_location_id: uuid,
    position: z.number().int().min(1).max(8),
    location_name: z.string(),
    address: z.string().nullable(),
    home_address: z.string().nullable(),
    distance_m: z.number().nullable(),
    accuracy_m: z.number().nullable(),
    verdict: CheckInVerdict,
    location_reason: z.string().nullable(),
    flagged: z.boolean(),
  })
  .strict();
const CheckInPage = Paged(CheckIn);

/** GET /attendance/me/check-ins: one of my days' stops, in time order. */
const MyCheckInListQuery = listQuery({ date: isoDate });
/** GET /attendance/check-ins: one person's stops on a day, for People. */
const CheckInListQuery = listQuery({ employee_id: uuid, date: isoDate });

/** POST /attendance/check-ins. As a punch's reading: latitude and longitude together or not at all. */
const CheckInCreate = z
  .object({
    device_at: isoDateTime,
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    accuracy_m: z.number().min(0).max(100000).nullable(),
    location_error: LocationError.nullable().optional(),
  })
  .strict()
  .refine((v) => (v.latitude === null) === (v.longitude === null), {
    message: "Send both coordinates or neither",
    path: ["longitude"],
  });

/** The day's site on the clock panel: its number, name and addresses with their radius, no coordinates. */
const TodayTemporarySite = z
  .object({
    temporary_site_id: uuid,
    number: z.string(),
    name: z.string(),
    purpose: TemporarySitePurpose,
    locations: z
      .array(
        z
          .object({
            temporary_site_location_id: uuid,
            position: z.number().int().min(1).max(8),
            name: z.string().nullable(),
            address: z.string().nullable(),
            radius_m: z.number().int(),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();

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
     * hybrid employee on a home day: approved, waiting on People, or none; null for anyone else, and
     * for everyone while the policy's Home Location is off. `checked` is false on a day worked from
     * home while Home Location is off (`remote`, guide §6.5): the panel reads no location and the
     * punch carries none; true wherever a reading is asked for.
     */
    location: z
      .object({
        kind: z.enum(["worksite", "home", "none", "remote", "temporary_home", "approved_day", "field", "client_visit", "temporary_site"]),
        name: z.string().nullable(),
        radius_m: z.number().int().nullable(),
        home_state: z.enum(["approved", "pending", "none"]).nullable(),
        checked: z.boolean(),
      })
      .strict(),
    /**
     * The policy in force today: `geofence_mode` is the location check for today's place (§6.1);
     * `home_location` is its Home Location switch (§1.3), which every screen that shows a home reads.
     */
    policy: z
      .object({
        geofence_mode: PolicyMode,
        device_mode: PolicyMode,
        max_accuracy_m: z.number().int().min(1),
        home_location: z.boolean(),
      })
      .strict(),
    device: z
      .object({
        state: DeviceState,
        label: z.string().nullable(),
        registered_count: z.number().int().min(0),
        can_register: z.boolean(),
      })
      .strict(),
    /** The day's approved temporary site, or null (PR 4); `location` then names it. */
    temporary_site: TodayTemporarySite.nullable(),
    /** The day's check-ins in time order, so the panel shows each stop's result after a reload (PR 4). */
    check_ins: z.array(CheckIn).max(20),
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

/** What a check-in recorded, and the state after it; `replayed` for the first one answered again (PR 4). */
const CheckInResult = z
  .object({
    check_in: CheckIn,
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
    /** Minutes the person's own last clock-out came before the end, once past the early grace (§6.4). */
    early_minutes: minutes,
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

/**
 * GET /attendance/days: one person's days of a month (this month when absent), newest first,
 * within the reader's `people` scope: People · Attendance's All Days (`?person=`), which ⌘K's
 * "All Days of <the person>" opens after the days it lists.
 */
const PersonDayListQuery = listQuery(
  { employee_id: uuid, month: month.optional(), status: DayStatus.optional() },
  ["attendance_date"],
);

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
    /** The leaving time the person gave for this System Clock-Out (Give Real Time), once given: it is given once. */
    real_time_given: clockTime.nullable(),
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
    /** The check-in it flags, on a temporary site's day (PR 4); null for a punch's or the day's. */
    attendance_check_in_id: uuid.nullable(),
    employee: PersonRef,
    work_date: isoDate,
    exception_type: ExceptionType,
    severity: Severity,
    status: ExceptionStatus,
    outcome: ExceptionOutcome.nullable(),
    detail: z.string(),
    employee_note: z.string().nullable(),
    employee_noted_at: isoDateTime.nullable(),
    /** The real leaving time the person gave for a System Clock-Out (Give Real Time, §6.14), HH:MM. */
    real_time: clockTime.nullable(),
    /** The punch it is about was refused at the clock: no decision makes it count (§6.8). */
    refused: z.boolean(),
    resolution: z.string().nullable(),
    reviewed_at: isoDateTime.nullable(),
    reviewed_by_name: z.string().nullable(),
    created_at: isoDateTime,
    /** Whether the reader may decide it now: open, `people` approve over everyone, and not their own. */
    can_decide: z.boolean(),
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
 * POST /attendance/me/events/:id/explanation: Give Real Time on a System Clock-Out (§6.14), the
 * person's note and their real leaving time on the work date. That it is after the clock-in and not
 * in the future is the service's.
 */
const RealTimeGiven = z.object({ employee_note: text(1000), real_time: clockTime }).strict();

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

/**
 * The assistant's attendance summary (docs/guides/praxis-ai.md §6.13; attendance.md §9): days, lateness
 * counts and minutes, absences and exceptions over a period, grouped by person, department or site, or
 * as a series by day, week or month. Figures, never rows; no page. The period is `from` and `to`, or a
 * `month`, else this month in Lagos.
 */
const AttendanceSummaryBy = z.enum(["day", "week", "month", "person", "department", "site"]);
const AttendanceSummaryQuery = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    month: month.optional(),
    department_id: uuid.optional(),
    employee_id: uuid.optional(),
    by: AttendanceSummaryBy.default("department"),
  })
  .strict();
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
    early_minutes: minutes,
    overtime_minutes: minutes,
    closed: z.boolean(),
    expected_location: z.object({ name: z.string(), radius_m: z.number().int().nullable() }).strict().nullable(),
    /** `pre_approved_overtime`: overtime is on and paid only when approved beforehand, so Approve Overtime applies. */
    policy: z.object({ geofence_mode: PolicyMode, device_mode: PolicyMode, pre_approved_overtime: z.boolean() }).strict(),
    open_exceptions: z.number().int().min(0),
    /** Overtime approved for this day beforehand (Approve Overtime, §6.17), or null. */
    overtime_approval: z
      .object({ minutes: z.number().int().min(1), approved_by_name: z.string().nullable(), reason: z.string() })
      .strict()
      .nullable(),
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

/**
 * GET /attendance/me/home: the home in force, the one waiting, and the last one rejected since.
 * While the policy's Home Location is off (guide §1.3), `needed` is false and no home is given.
 */
const MyHome = z
  .object({
    needed: z.boolean(),
    approved: HomeLocation.nullable(),
    pending: HomeLocation.nullable(),
    rejected: HomeLocation.nullable(),
    max_accuracy_m: z.number().int().min(1),
  })
  .strict();

/**
 * POST /attendance/me/home: one reading taken at home, and the home's address, picked or pinned
 * (F27). The fence is drawn on the reading, never on the address's point.
 */
const HomeRequestCreate = z
  .object({
    home_address: PlaceInput,
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
    /** Whether the reader may decide it now: waiting, `people` approve over everyone, and not their own. */
    can_decide: z.boolean(),
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
 * Work schedules: a person's own week, set by People from a date; with
 * none, the company hours of the Attendance policy (guide §6.13)
 * ------------------------------------------------------------------ */

/** An ISO weekday: 1 is Monday, 7 is Sunday. */
const Weekday = z.number().int().min(1).max(7);

/** Where a person works on a day of the week. */
const SchedulePlace = z.enum(["office", "remote", "off"]);

/** Where a working day of a schedule is worked. */
const WorkPlace = z.enum(["office", "remote"]);

/** One weekday's place, as the week used to be read (kept for My Profile's `EssWorkDay.place`). */
const ScheduleDay = z.object({ weekday: Weekday, place: SchedulePlace }).strict();

/**
 * One weekday of a schedule as People set it. A working day names its place and either both times
 * (the end after the start, the same day) or neither, which takes the company hours for that
 * weekday (guide §6.13); an Off day has neither times nor a place.
 */
const ScheduleDayInput = z
  .object({
    weekday: Weekday,
    working: z.boolean(),
    starts_at: clockTime.nullable(),
    ends_at: clockTime.nullable(),
    place: WorkPlace.nullable(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (!d.working) {
      if (d.starts_at !== null || d.ends_at !== null)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["starts_at"], message: "Not on a day off" });
      if (d.place !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["place"], message: "Not on a day off" });
      return;
    }
    if (d.place === null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["place"], message: "Office or Remote" });
    if ((d.starts_at === null) !== (d.ends_at === null))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [d.starts_at === null ? "starts_at" : "ends_at"], message: "Both times or neither" });
    else if (d.starts_at !== null && d.ends_at <= d.starts_at)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ends_at"], message: "Ends after it starts" });
  });

/** The seven weekdays of a schedule, Monday first. */
const ScheduleDays = z
  .array(ScheduleDayInput)
  .length(7, "All seven days")
  .refine((days) => days.every((d, i) => d.weekday === i + 1), "Monday to Sunday, in order")
  .refine((days) => days.some((d) => d.working), "Tick a working day");

/** One version of a person's schedule: their week from a first day, as it was set. */
const ScheduleVersion = z
  .object({
    attendance_work_schedule_id: uuid,
    days: z.array(ScheduleDayInput).length(7),
    effective_from: isoDate,
    reason: z.string(),
    set_by_name: z.string().nullable(),
    set_at: isoDateTime,
  })
  .strict();

/**
 * One day of a person's week as it is worked: Working (with its hours and place, `company_hours`
 * when they are the company's) or Off.
 */
const WorkDay = z
  .object({
    weekday: Weekday,
    working: z.boolean(),
    starts_at: clockTime.nullable(),
    ends_at: clockTime.nullable(),
    place: WorkPlace.nullable(),
    company_hours: z.boolean(),
  })
  .strict();

/**
 * GET /attendance/schedules/:employee_id and /attendance/me/schedule: how a person's week is worked.
 * `week` is each weekday (Monday first) as worked today, by the schedule in force or, with none
 * (`current` null), the company hours at the place the work pattern gives; `next` is a schedule
 * waiting to start. `worksite` is the office an Office day is matched to, when one is assigned and
 * active. `home_state` is the home of someone whose week has a Remote day, else null, and null for
 * everyone while the policy's Home Location is off (guide §1.3). `can_edit` says whether the reader
 * may set the schedule.
 */
const WorkSchedule = z
  .object({
    employee: PersonRef,
    work_pattern: WorkPattern,
    worksite: z.object({ worksite_id: uuid, name: z.string(), radius_m: z.number().int() }).strict().nullable(),
    home_state: z.enum(["approved", "pending", "none"]).nullable(),
    week: z.array(WorkDay).length(7),
    current: ScheduleVersion.nullable(),
    next: ScheduleVersion.nullable(),
    can_edit: z.boolean(),
  })
  .strict();

const ScheduleParams = z.object({ employee_id: uuid }).strict();

/**
 * POST /attendance/schedules/:employee_id: the seven days, the first day and why. The first day
 * against today, a blank working day the company hours do not work, and who may set it are the
 * service's (guide §6.13).
 */
const WorkScheduleSet = z
  .object({
    days: ScheduleDays,
    effective_from: isoDate,
    reason: reasonText,
  })
  .strict();

/* ------------------------------------------------------------------ *
 * The Attendance policy's rules: a rules policy on Knowledge Hub · Policies
 * (docs/guides/policies.md), whose rules this module owns and enforces (guide §6.15).
 * Its versions, approval and acknowledgement are the policies contract's.
 * ------------------------------------------------------------------ */

/** How a consequence rule counts: a week (Monday to Sunday), the calendar month, or the last 30 days. */
const RulePeriod = z.enum(["week", "month", "days_30"]);
/** How a deduction is worked out (guide §6.17, T4). */
const DeductionMethod = z.enum(["pro_rata", "per_hour", "per_day"]);
/** Who approves overtime before it is paid (T6). */
const OvertimeApproval = z.enum(["manager_after", "pre_approved", "automatic"]);
/** How overtime is paid: a multiple of the hourly rate, or a fixed amount an hour. */
const OvertimeMethod = z.enum(["multiplier", "per_hour"]);

/** One weekday of the company hours. A day that is worked has both times, the end after the start. */
const HoursDay = z
  .object({
    weekday: Weekday,
    working: z.boolean(),
    starts_at: clockTime.nullable(),
    ends_at: clockTime.nullable(),
  })
  .strict();

/** The company hours: the seven weekdays, Monday first. */
const WorkingHours = z
  .array(HoursDay)
  .length(7, "All seven days")
  .refine((days) => days.every((d, i) => d.weekday === i + 1), "Monday to Sunday, in order")
  .refine((days) => days.some((d) => d.working), "Tick a working day")
  .superRefine((days, ctx) => {
    // Each problem sits on the day that has it, so the sheet marks that day's time.
    days.forEach((d, i) => {
      if (!d.working) return;
      if (!d.starts_at) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, "starts_at"], message: "Required" });
      if (!d.ends_at) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, "ends_at"], message: "Required" });
      else if (d.starts_at && d.ends_at <= d.starts_at)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, "ends_at"], message: "Ends after it starts" });
    });
  });

const count = z.number().int().min(1, "At least 1").max(31, "At most 31");
const lateHours = z.number().min(0.5, "At least 0.5").max(40, "At most 40");
const multiple = z.number().min(1, "At least 1").max(3, "At most 3");

/** N in a period, with what reaching it does (guide §6.16). */
const CountRule = z
  .object({ on: z.boolean(), count, period: RulePeriod, alert: z.boolean(), query: z.boolean() })
  .strict();
/** N days, or H hours, in a period, whichever comes first. */
const CountHoursRule = CountRule.extend({ hours: lateHours.nullable() }).strict();
/** A deduction for a late or early day. A fixed method needs its amount. */
const Deduction = z.object({ on: z.boolean(), method: DeductionMethod, amount: money.nullable() }).strict();
const Overtime = z
  .object({
    on: z.boolean(),
    after_minutes: z.number().int().min(0).max(120, "At most 120"),
    approval: OvertimeApproval,
    method: OvertimeMethod,
    multiplier: multiple,
    amount: money.nullable(),
    rest_day_multiplier: multiple,
    monthly_cap_hours: z.number().int().min(1, "At least 1").max(100, "At most 100"),
  })
  .strict();

/** The rules a rule is off by, with the figures it takes when switched on. */
const offCount = { on: false, count: 3, period: "month", alert: true, query: true };
const DEFAULT_RULES = Object.freeze({
  hours: null,
  grace_minutes: 0,
  late_rule: { ...offCount, hours: 5 },
  late_deduction: { on: false, method: "pro_rata", amount: null },
  early_grace_minutes: 0,
  early_rule: { ...offCount, hours: null },
  early_deduction: { on: false, method: "pro_rata", amount: null },
  absence_rule: { ...offCount, count: 2 },
  absence_deduction: { on: false },
  forgotten_rule: { ...offCount, query: false },
  location_rule: { ...offCount, query: false },
  overtime: {
    on: false,
    after_minutes: 30,
    approval: "manager_after",
    method: "multiplier",
    multiplier: 1.5,
    amount: null,
    rest_day_multiplier: 2,
    monthly_cap_hours: 20,
  },
  office_geofence_mode: "warn",
  // Off until People switch it on (guide §1.3, H2): every version before it reads it off too.
  home_location: { on: false },
  home_geofence_mode: "warn",
  site_geofence_mode: "warn",
  home_radius_m: 150,
  max_accuracy_m: 100,
  device_mode: "off",
  clock_out_reminder_minutes: 30,
  system_clock_out_after_minutes: 90,
});

/** Every rule, each typed; `AttendanceRules` and `AttendanceRulesDraft` differ only in strictness. */
const ruleShape = {
  /** Null until a version sets them: the working week of Settings · Organisation applies (PR 3). */
  hours: WorkingHours.nullable(),
  grace_minutes: z.number().int().min(0, "At least 0").max(60, "At most 60"),
  late_rule: CountHoursRule,
  late_deduction: Deduction,
  early_grace_minutes: z.number().int().min(0, "At least 0").max(60, "At most 60"),
  early_rule: CountHoursRule,
  early_deduction: Deduction,
  absence_rule: CountRule,
  absence_deduction: z.object({ on: z.boolean() }).strict(),
  forgotten_rule: CountRule,
  location_rule: CountRule,
  overtime: Overtime,
  office_geofence_mode: PolicyMode,
  /** Homes at all (guide §1.3): off, nobody sets one and a day worked from home is not checked. */
  home_location: z.object({ on: z.boolean() }).strict(), // address:none a switch, not a place
  home_geofence_mode: PolicyMode,
  site_geofence_mode: PolicyMode,
  /** At least 150 on a new version while Home Location is on (T9); an older version keeps what it set, down to 50. */
  home_radius_m: z.number().int().min(50).max(500, "At most 500"),
  max_accuracy_m: z.number().int().min(50, "At least 50").max(250, "At most 250"),
  device_mode: PolicyMode,
  clock_out_reminder_minutes: z.number().int().min(15, "At least 15").max(60, "At most 60"),
  system_clock_out_after_minutes: z.number().int().min(30, "At least 30").max(240, "At most 240"),
};

/** A rule a version can change: a key of AttendanceRules. */
const AttendanceRule = z.enum(Object.keys(ruleShape));

/**
 * A version's rules as read: a rule a version predates takes its default (off), and anything a
 * version once held that is no longer a rule (`latest_clock_out_minutes`) is dropped.
 */
// Each key written out, so the generated types know every rule (a mapped object would lose them);
// each default a fresh copy, so no two versions share an object.
const AttendanceRules = z.object({
  hours: ruleShape.hours.default(() => structuredClone(DEFAULT_RULES.hours)),
  grace_minutes: ruleShape.grace_minutes.default(() => structuredClone(DEFAULT_RULES.grace_minutes)),
  late_rule: ruleShape.late_rule.default(() => structuredClone(DEFAULT_RULES.late_rule)),
  late_deduction: ruleShape.late_deduction.default(() => structuredClone(DEFAULT_RULES.late_deduction)),
  early_grace_minutes: ruleShape.early_grace_minutes.default(() => structuredClone(DEFAULT_RULES.early_grace_minutes)),
  early_rule: ruleShape.early_rule.default(() => structuredClone(DEFAULT_RULES.early_rule)),
  early_deduction: ruleShape.early_deduction.default(() => structuredClone(DEFAULT_RULES.early_deduction)),
  absence_rule: ruleShape.absence_rule.default(() => structuredClone(DEFAULT_RULES.absence_rule)),
  absence_deduction: ruleShape.absence_deduction.default(() => structuredClone(DEFAULT_RULES.absence_deduction)),
  forgotten_rule: ruleShape.forgotten_rule.default(() => structuredClone(DEFAULT_RULES.forgotten_rule)),
  location_rule: ruleShape.location_rule.default(() => structuredClone(DEFAULT_RULES.location_rule)),
  overtime: ruleShape.overtime.default(() => structuredClone(DEFAULT_RULES.overtime)),
  office_geofence_mode: ruleShape.office_geofence_mode.default(() => structuredClone(DEFAULT_RULES.office_geofence_mode)),
  home_location: ruleShape.home_location.default(() => structuredClone(DEFAULT_RULES.home_location)),
  home_geofence_mode: ruleShape.home_geofence_mode.default(() => structuredClone(DEFAULT_RULES.home_geofence_mode)),
  site_geofence_mode: ruleShape.site_geofence_mode.default(() => structuredClone(DEFAULT_RULES.site_geofence_mode)),
  home_radius_m: ruleShape.home_radius_m.default(() => structuredClone(DEFAULT_RULES.home_radius_m)),
  max_accuracy_m: ruleShape.max_accuracy_m.default(() => structuredClone(DEFAULT_RULES.max_accuracy_m)),
  device_mode: ruleShape.device_mode.default(() => structuredClone(DEFAULT_RULES.device_mode)),
  clock_out_reminder_minutes: ruleShape.clock_out_reminder_minutes.default(() => structuredClone(DEFAULT_RULES.clock_out_reminder_minutes)),
  system_clock_out_after_minutes: ruleShape.system_clock_out_after_minutes.default(() => structuredClone(DEFAULT_RULES.system_clock_out_after_minutes)),
});

/** Fixed methods name their amount. */
const amountGiven = (d) => !d.on || d.method === "pro_rata" || Boolean(d.amount);

/** A fixed amount's range (guide §6.15): ₦1.00 to ₦1,000,000.00, compared in kobo, never as a float. */
const kobo = (amount) => {
  const m = /^(-?)(\d+)\.(\d{2})$/.exec(String(amount));
  return m ? (m[1] ? -1 : 1) * (Number(m[2]) * 100 + Number(m[3])) : Number.NaN;
};
const MIN_FIXED_KOBO = 100;
const MAX_FIXED_KOBO = 100_000_000;
const inRange = (amount) => kobo(amount) >= MIN_FIXED_KOBO && kobo(amount) <= MAX_FIXED_KOBO;
/** A fixed deduction's amount, when one is given and used. */
const deductionInRange = (d) => !d.on || d.method === "pro_rata" || !d.amount || inRange(d.amount);

/**
 * The rules as People save them in a draft: every rule given, and the rules a new version must
 * meet (guide §6.15): a temporary site is Flag or Refuse, never Off; while Home Location is on, a
 * home is too and its radius is at least 150 m (off, both are kept as they were and checked only
 * once it is switched on, when the worksheet shows them); a fixed deduction or overtime paid per
 * hour names its amount.
 */
const AttendanceRulesDraft = z
  .object(ruleShape)
  .strict()
  .refine((r) => !r.home_location.on || r.home_geofence_mode !== "off", { message: "Flag or Refuse", path: ["home_geofence_mode"] })
  .refine((r) => r.site_geofence_mode !== "off", { message: "Flag or Refuse", path: ["site_geofence_mode"] })
  .refine((r) => !r.home_location.on || r.home_radius_m >= 150, { message: "At least 150", path: ["home_radius_m"] })
  .refine((r) => amountGiven(r.late_deduction), { message: "Enter the amount", path: ["late_deduction", "amount"] })
  .refine((r) => amountGiven(r.early_deduction), { message: "Enter the amount", path: ["early_deduction", "amount"] })
  .refine((r) => !r.overtime.on || r.overtime.method === "multiplier" || Boolean(r.overtime.amount), {
    message: "Enter the amount",
    path: ["overtime", "amount"],
  })
  .refine((r) => deductionInRange(r.late_deduction), { message: "₦1 to ₦1,000,000", path: ["late_deduction", "amount"] })
  .refine((r) => deductionInRange(r.early_deduction), { message: "₦1 to ₦1,000,000", path: ["early_deduction", "amount"] })
  .refine(
    (r) => !r.overtime.on || r.overtime.method === "multiplier" || !r.overtime.amount || inRange(r.overtime.amount),
    { message: "₦1 to ₦1,000,000", path: ["overtime", "amount"] },
  );

/* ------------------------------------------------------------------ *
 * Exports
 * ------------------------------------------------------------------ */

/** POST /attendance/me/export: my month as a workbook, answered as documents ExportFile. */
const MyExportRequest = z.object({ month }).strict();

/** POST /attendance/export: the register, at most 31 days, answered as documents ExportFile. */
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

/* ------------------------------------------------------------------ *
 * Pending deductions and overtime: what a late, early or absent day, or a
 * day's overtime, comes to under the policy (guide §6.17)
 * ------------------------------------------------------------------ */

const PayItemKind = z.enum(["late", "early_departure", "absence", "overtime"]);
/** The deductions, or the overtime: the two views of People · Attendance and My Attendance. */
const PayItemGroup = z.enum(["deductions", "overtime"]);
const PayItemStatus = z.enum(["pending", "waived", "confirmed", "cut", "in_run"]);
/**
 * How the amount was worked out: a deduction's method (pro_rata, per_hour started, per_day), an
 * absence's day rate (daily_rate), or overtime's (multiplier of the hourly rate, per_hour prorated).
 */
const PayItemMethod = z.enum(["pro_rata", "per_hour", "per_day", "daily_rate", "multiplier"]);

/**
 * One pending deduction or overtime item. `pay_amount` is derived from the person's salary and is
 * masked as the salary is (null below the salary grant, and null too with no salary set: No Salary
 * Set). `confirmed_minutes` is what was confirmed of an overtime item. `can_decide` says whether the
 * reader may waive it (a deduction) or confirm and cut it (overtime pending its line manager).
 */
const PayItem = z
  .object({
    attendance_pay_item_id: uuid,
    attendance_day_id: uuid.nullable(),
    employee: PersonRef,
    work_date: isoDate,
    kind: PayItemKind,
    minutes,
    rest_day: z.boolean(),
    method: PayItemMethod,
    pay_amount: money.nullable(),
    salary_set: z.boolean(),
    status: PayItemStatus,
    confirmed_minutes: minutes.nullable(),
    reason: z.string().nullable(),
    decided_by_name: z.string().nullable(),
    decided_at: isoDateTime.nullable(),
    created_at: isoDateTime,
    can_decide: z.boolean(),
  })
  .strict();
const PayItemPage = Paged(PayItem);

/** GET /attendance/pay-items: within the reader's `people` scope, pending first, then the newest day. */
const PayItemListQuery = listQuery(
  {
    group: PayItemGroup.optional(),
    kind: PayItemKind.optional(),
    status: PayItemStatus.optional(),
    month: month.optional(),
    employee_id: uuid.optional(),
  },
  ["work_date", "minutes"],
);

/** GET /attendance/me/pay-items: the person's own for a month (this month when absent), newest day first. */
const MyPayItemListQuery = listQuery(
  { month: month.optional(), group: PayItemGroup.optional(), kind: PayItemKind.optional() },
  ["work_date"],
);

/** POST /attendance/pay-items/waive: up to 25 deductions at once, with the reason the person reads. */
const PayItemWaive = z
  .object({
    pay_item_ids: z
      .array(uuid)
      .min(1, "Pick a deduction")
      .max(25, "At most 25")
      .refine((ids) => new Set(ids).size === ids.length, "Each once"),
    reason: reasonText,
  })
  .strict();

/** What a waive did: the items it waived, and those it skipped because they were no longer pending. */
const PayItemBatchResult = z
  .object({
    waived: z.array(PayItem).max(25),
    skipped: z
      .array(z.object({ attendance_pay_item_id: uuid, code: z.enum(["NOT_PENDING", "IN_RUN"]) }).strict())
      .max(25),
  })
  .strict();

/**
 * POST /attendance/pay-items/:id/overtime: confirm all of it, confirm fewer minutes, or cut it with a
 * reason (Line Manager After, §6.17). That `minutes` is at most the item's is the service's.
 */
const OvertimeDecision = z
  .object({
    decision: z.enum(["confirm", "cut"]),
    minutes: z.number().int().min(1, "At least 1").optional(),
    reason: optionalText(500),
  })
  .strict()
  .refine((v) => v.decision !== "cut" || (v.reason || "").length >= 10, {
    message: "At least 10 characters",
    path: ["reason"],
  })
  .refine((v) => v.decision !== "cut" || v.minutes === undefined, { message: "Not when cutting", path: ["minutes"] });

/**
 * POST /attendance/overtime-approvals: overtime approved beforehand for a person's day (Approve
 * Overtime, Pre-Approved). The day against today and who may approve are the service's (§6.17).
 */
const OvertimePreApprovalCreate = z
  .object({
    employee_id: uuid,
    work_date: isoDate,
    minutes: z.number().int().min(1, "At least 1").max(720, "At most 720"),
    reason: reasonText,
  })
  .strict();

/** One overtime approval: the person, the day, the minutes and who approved them. */
const OvertimePreApproval = z
  .object({
    attendance_overtime_approval_id: uuid,
    employee: PersonRef,
    work_date: isoDate,
    minutes: z.number().int().min(1),
    reason: z.string(),
    approved_by_name: z.string().nullable(),
    approved_at: isoDateTime,
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
      can_decide: "the reader's: pending, people approve over everyone, and not their own (attendance.controller)",
    },
  },
  HomeRequestPage: { table: null, reason: "a page of home locations" },
  HomeListQuery: { table: null, reason: "list controls for the home locations" },
  HomeDecision: {
    table: "attendance_home",
    virtual: { decision: "written as attendance_home.status approved or rejected", reason: "attendance_home.decision_reason" },
  },
  ScheduleDay: { table: null, reason: "one weekday's place, from attendance_work_schedule, the company hours and the pattern" },
  ScheduleDayInput: { table: null, reason: "one weekday of attendance_work_schedule.days (jsonb), as People set it" },
  ScheduleVersion: {
    table: "attendance_work_schedule",
    virtual: { set_by_name: "who set it, from app_user and employee" },
  },
  WorkDay: {
    table: null,
    reason: "one weekday as worked, from attendance_work_schedule.days, the policy's hours and working_week",
  },
  WorkSchedule: {
    table: null,
    reason: "a person's week, from employee, worksite, attendance_home, attendance_work_schedule and the company hours",
  },
  ScheduleParams: { table: null, reason: "the person whose schedule it is" },
  WorkScheduleSet: { table: "attendance_work_schedule" },
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
  PersonDayListQuery: { table: null, reason: "the person, the month and the list controls for one person's days" },
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
      real_time_given: "the real leaving time the person gave for this System Clock-Out, from its exception's evidence",
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
      real_time: "the real leaving time the person gave, from attendance_exception.evidence",
      reviewed_by_name: "who decided it, from employee",
      refused: "the punch was refused at the clock, from attendance_exception.evidence",
      can_decide: "the reader's: open, people approve over everyone, and not their own (attendance.controller)",
    },
  },
  AttendanceExceptionPage: { table: null, reason: "a page of exceptions" },
  MyExceptionListQuery: { table: null, reason: "list controls for my exceptions" },
  ExceptionListQuery: { table: null, reason: "list controls for the exceptions" },
  ExceptionExplanation: { table: "attendance_exception" },
  RealTimeGiven: {
    table: "attendance_exception",
    virtual: { real_time: "kept in attendance_exception.evidence with the instant it names" },
  },
  ExceptionDecision: {
    table: "attendance_exception",
    virtual: {
      decision: "written to attendance_exception.outcome as accepted, rejected or corrected",
      clock_out_time: "the time of the clock-out a correction appends to attendance_event",
    },
  },
  RegisterQuery: { table: null, reason: "list controls for the register" },
  AttendanceSummaryQuery: { table: null, reason: "the filters and grouping of the assistant's attendance summary; figures, never a row" },
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
  HoursDay: { table: null, reason: "one weekday of the Attendance policy's hours, kept in policy_version.rules" },
  CountRule: { table: null, reason: "a consequence rule, kept in policy_version.rules" },
  CountHoursRule: { table: null, reason: "a consequence rule counting days or hours, kept in policy_version.rules" },
  Deduction: { table: null, reason: "a deduction rule, kept in policy_version.rules" },
  Overtime: { table: null, reason: "the overtime rule, kept in policy_version.rules" },
  AttendanceRules: { table: null, reason: "an Attendance policy version's rules, kept as policy_version.rules (jsonb)" },
  AttendanceRulesDraft: { table: null, reason: "the Attendance policy's rules as a draft saves them, kept as policy_version.rules (jsonb)" },
  MyExportRequest: { table: null, reason: "the month to export" },
  RegisterExportRequest: { table: null, reason: "the register's filters for an export" },
  PayItem: {
    table: "attendance_pay_item",
    virtual: {
      employee: "the person, from employee and department, with their photo_url",
      pay_amount: "attendance_pay_item.amount, named for the salary mask",
      salary_set: "whether employee.gross_monthly is set",
      decided_by_name: "who decided it, from app_user and employee; null when the system did",
      can_decide: "whether the reader may waive it or confirm and cut it",
    },
  },
  PayItemPage: { table: null, reason: "a page of deductions and overtime" },
  PayItemListQuery: { table: null, reason: "list controls for People's deductions and overtime" },
  MyPayItemListQuery: { table: null, reason: "list controls for the person's own deductions and overtime" },
  PayItemWaive: { table: null, reason: "the deductions People waive and why; the reason kept on each attendance_pay_item" },
  PayItemBatchResult: { table: null, reason: "the items a waive waived and those it skipped" },
  OvertimeDecision: {
    table: "attendance_pay_item",
    virtual: {
      decision: "written as attendance_pay_item.status confirmed or cut",
      minutes: "written as attendance_pay_item.confirmed_minutes",
    },
  },
  OvertimePreApprovalCreate: { table: "attendance_overtime_approval" },
  OvertimePreApproval: {
    table: "attendance_overtime_approval",
    virtual: {
      employee: "the person, from employee and department, with their photo_url",
      approved_by_name: "who approved it, from app_user and employee",
    },
  },
  TemporarySiteLocation: {
    table: "attendance_temporary_site_location",
    virtual: {
      home_address: "a Temporary Home's attendance_temporary_site_location.address, named for the personal-details mask",
      home_latitude: "a Temporary Home's attendance_temporary_site_location.latitude, named for the personal-details mask",
      home_longitude: "a Temporary Home's attendance_temporary_site_location.longitude, named for the personal-details mask",
    },
  },
  TemporarySiteMember: {
    table: "attendance_temporary_site_member",
    virtual: { employee: "the person, from employee and department" },
  },
  TemporarySite: {
    table: "attendance_temporary_site",
    virtual: {
      days: "calendar days from starts_on to ends_on",
      state: "awaiting approval, upcoming, in progress or done against today in Lagos, else its status",
      locations: "its attendance_temporary_site_location rows",
      members: "its attendance_temporary_site_member rows",
      people: "how many attendance_temporary_site_member rows are not removed",
      submitted_by_name: "who added it, from employee",
      submitted_at: "attendance_temporary_site.created_at",
      waiting_on: "the name of the approval stage it waits at, from workflow_instance",
      approved_by_name: "who approved it, from employee",
      can_decide: "whether that stage waits on the reader and they are not on it (shared/workflow/approvers.js)",
      can_change: "whether the reader may cancel it or take someone off",
      can_withdraw: "whether the reader submitted it and it still waits",
    },
  },
  TemporarySitePage: { table: null, reason: "a page of temporary sites" },
  TemporarySiteLocationInput: { table: "attendance_temporary_site_location" },
  TemporarySiteCreate: {
    table: "attendance_temporary_site",
    virtual: {
      locations: "written as attendance_temporary_site_location rows, each place kept by shared/places",
      employee_ids: "written as attendance_temporary_site_member rows",
    },
  },
  TemporarySiteListQuery: { table: null, reason: "list controls for People's temporary sites" },
  MyTemporarySiteListQuery: { table: null, reason: "list controls for the person's own temporary sites" },
  TemporarySiteCancel: {
    table: null,
    reason: "why a site is withdrawn or cancelled; kept as cancel_reason and on the audit row",
  },
  TemporarySiteMemberRemove: {
    table: null,
    reason: "who is taken off and why; kept as removed_reason on their attendance_temporary_site_member row",
  },
  TodayTemporarySite: { table: null, reason: "the day's site on the clock panel, from attendance_temporary_site and its locations" },
  CheckIn: {
    table: "attendance_check_in",
    virtual: {
      position: "the matched address's attendance_temporary_site_location.position",
      location_name: "the matched address's label, else its position",
      address: "a venue's attendance_temporary_site_location.address",
      home_address: "a Temporary Home's attendance_temporary_site_location.address, named for the personal-details mask",
      location_reason: "why a reading was unclear, from attendance_check_in.evidence",
      flagged: "an attendance_exception carries it",
    },
  },
  CheckInPage: { table: null, reason: "a page of check-ins" },
  MyCheckInListQuery: { table: null, reason: "list controls for one of my days' check-ins" },
  CheckInListQuery: { table: null, reason: "list controls for one person's check-ins on a day" },
  CheckInCreate: {
    table: "attendance_check_in",
    virtual: { location_error: "why the browser gave no reading; kept in attendance_check_in.evidence" },
  },
  CheckInResult: { table: null, reason: "what a check-in recorded, and the state after it" },
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
  PersonDayListQuery,
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
  RealTimeGiven,
  ExceptionDecision,
  RegisterQuery,
  AttendanceSummaryQuery,
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
  MyLocationRequestListQuery,
  LocationRequestListQuery,
  LocationRequestCancel,
  FieldAssignmentState,
  FieldAssignmentStatus,
  FieldSite,
  FieldMember,
  FieldAssignment,
  FieldAssignmentPage,
  FieldAssignmentListQuery,
  MyFieldAssignmentListQuery,
  FieldAssignmentCancel,
  FieldMemberRemove,
  Weekday,
  SchedulePlace,
  WorkPlace,
  ScheduleDay,
  ScheduleDayInput,
  ScheduleDays,
  ScheduleVersion,
  WorkDay,
  WorkSchedule,
  ScheduleParams,
  WorkScheduleSet,
  RulePeriod,
  DeductionMethod,
  OvertimeApproval,
  OvertimeMethod,
  HoursDay,
  WorkingHours,
  CountRule,
  CountHoursRule,
  Deduction,
  Overtime,
  DEFAULT_RULES,
  AttendanceRule,
  AttendanceRules,
  AttendanceRulesDraft,
  PayItemKind,
  PayItemGroup,
  PayItemStatus,
  PayItemMethod,
  PayItem,
  PayItemPage,
  PayItemListQuery,
  MyPayItemListQuery,
  PayItemWaive,
  PayItemBatchResult,
  OvertimeDecision,
  OvertimePreApprovalCreate,
  OvertimePreApproval,
  TemporarySitePurpose,
  TemporarySiteStatus,
  TemporarySiteHours,
  TemporarySiteState,
  TemporarySiteLocation,
  TemporarySiteMember,
  TemporarySite,
  TemporarySitePage,
  TemporarySiteLocationInput,
  TemporarySiteCreate,
  TemporarySiteListQuery,
  MyTemporarySiteListQuery,
  TemporarySiteCancel,
  TemporarySiteMemberRemove,
  CheckInVerdict,
  CheckIn,
  CheckInPage,
  MyCheckInListQuery,
  CheckInListQuery,
  CheckInCreate,
  CheckInResult,
  TodayTemporarySite,
};
