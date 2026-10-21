"use strict";
/**
 * Home · Reports (docs/guides/home.md §3 steps 7 and 8, §4, §6): saved reports, the schedule
 * each may have, the files they produce, and the Overview Export.
 *
 * A report is a source (the query a screen already uses) with its filters, owned by the
 * person who built it and, when `shared`, visible to others who may open its source. Its
 * schedule is a recurrence rule (src/shared/time/recurrence.js, never cron) counted from a
 * start day, run at a time of day in Lagos, in PDF, XLSX or both, for chosen people. A
 * report is generated as each recipient, so a run is one file: one recipient, one format,
 * one number (RPT-0001). Generating is outbox work, so a run starts `pending` with no file
 * and becomes `done`, `failed`, or `skipped` when the recipient can no longer open it.
 *
 * Who reads what (home.md §5, §8): every route needs the `home.reports` capability except
 * the Overview Export, which any Home reader runs on their own Overview.
 */
const { z } = require("zod");
const { uuid, text, isoDate, isoDateTime, listQuery, Paged } = require("./common");
const { TimeOfDay } = require("./settings");
const { LeaveStatus } = require("./leave");
const { HomeRosterStatus } = require("./dashboard");
const { HomeAlertCategory, HomeAlertSeverity } = require("./alerts");

const count = z.number().int().min(0);

/** Unique items, for a list a person builds on a form. */
const distinct = (list) => new Set(list).size === list.length;

/** A report goes to at most a page of people, and every one of them is a file per format. */
const HOME_REPORT_MAX_RECIPIENTS = 25;

const HOME_REPORT_FORMATS = ["pdf", "xlsx"];
const HomeReportFormat = z.enum(HOME_REPORT_FORMATS);

/**
 * The day Daily Attendance reads (home.md §6 Reports): `today`, the day so far, which nobody
 * is Absent on yet (the day-close marks a working day with no clock-in Absent only after it
 * ends; until then that person is Not In), or `last_working_day`, the working day before the
 * report's moment, closed by then, so Absent is real and nobody is Not In.
 */
const HomeReportRosterDay = z.enum(["today", "last_working_day"]);
const HOME_REPORT_ROSTER_DAYS = HomeReportRosterDay.options;

/** The roster statuses a day can hold: Absent only once the day is closed, Not In only while it is open. */
const ROSTER_STATUSES_ON = Object.freeze({
  today: Object.freeze(HomeRosterStatus.options.filter((s) => s !== "absent")),
  last_working_day: Object.freeze(HomeRosterStatus.options.filter((s) => s !== "not_in")),
});

/**
 * The filters a source can take, each meaning one thing whichever source takes it. A
 * report keeps them in saved_report.definition and hands them to its source's query;
 * only the ones its source takes (HOME_REPORT_SOURCES) are accepted.
 */
const HomeReportFilters = z
  .object({
    department_id: uuid.optional(),
    /** Daily Attendance: the day it reads; none is `today`. */
    roster_day: HomeReportRosterDay.optional(),
    /** Daily Attendance: the statuses on that day's roster, any of them; none is everyone. */
    roster_statuses: z
      .array(HomeRosterStatus)
      .min(1, "Pick a status")
      .max(HomeRosterStatus.options.length)
      .refine(distinct, "Each status once")
      .optional(),
    leave_status: LeaveStatus.optional(),
    leave_type_id: uuid.optional(),
    /** Open Alerts. */
    category: HomeAlertCategory.optional(),
    severity: HomeAlertSeverity.optional(),
  })
  .strict();

/**
 * The sources a report can run, in the order the New Report form lists them. Each names
 * the module whose `view` grant a recipient needs to receive it, and the filters its query
 * takes. `offered: false` is not on the form: `overview` is the Overview Export, run on
 * the reader's own Overview. Sources whose module is built in a later milestone return
 * rows once their tables have data. src/modules/reports/reports.sources.js gathers each;
 * a test holds its keys equal to these.
 */
const HOME_REPORT_SOURCES = Object.freeze({
  daily_attendance: Object.freeze({ module: "people", filters: Object.freeze(["roster_day", "department_id", "roster_statuses"]), offered: true }),
  leave: Object.freeze({ module: "people", filters: Object.freeze(["leave_status", "leave_type_id"]), offered: true }),
  open_alerts: Object.freeze({ module: "home", filters: Object.freeze(["category", "severity"]), offered: true }),
  headcount: Object.freeze({ module: "people", filters: Object.freeze(["department_id"]), offered: true }),
  tasks: Object.freeze({ module: "workspace", filters: Object.freeze([]), offered: true }),
  partnerships: Object.freeze({ module: "partnerships", filters: Object.freeze([]), offered: true }),
  expenses: Object.freeze({ module: "expenses", filters: Object.freeze([]), offered: true }),
  recruitment: Object.freeze({ module: "recruitment", filters: Object.freeze([]), offered: true }),
  overview: Object.freeze({ module: "home", filters: Object.freeze([]), offered: false }),
});
const HomeReportSource = z.enum(Object.keys(HOME_REPORT_SOURCES));

/** On the report card: running on a schedule, paused, or run only when someone presses Run Now. */
const HomeReportStatus = z.enum(["scheduled", "paused", "on_demand"]);

/** A file's progress: waiting to be generated, generated, failed, or not generated for this recipient. */
const HomeReportRunStatus = z.enum(["pending", "done", "failed", "skipped"]);

/* ------------------------------------------------------------------ *
 * Reports
 * ------------------------------------------------------------------ */

/**
 * When a schedule fires, as a recurrence rule (src/shared/time/recurrence.js): every
 * `interval` days, weeks (on `by_weekday`, 1 Monday to 7 Sunday) or months (on
 * `by_month_day`, -1 for the last day). `working_days_only` moves a day off to the next
 * working day. Reports repeat daily, weekly or monthly; the rule's other shapes are not
 * offered.
 */
const HomeReportRecurrence = z
  .object({
    freq: z.enum(["daily", "weekly", "monthly"]),
    interval: z.number().int().min(1, "1 or more").max(366, "366 at most").optional(),
    by_weekday: z
      .array(z.number().int().min(1).max(7))
      .min(1, "Pick a day")
      .max(7)
      .refine(distinct, "Each day once")
      .optional(),
    by_month_day: z
      .number()
      .int()
      .min(-1)
      .max(31)
      .refine((d) => d !== 0, "1 to 31, or last")
      .optional(),
    working_days_only: z.boolean().optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.by_weekday !== undefined && r.freq !== "weekly")
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["by_weekday"], message: "Weekly only" });
    if (r.by_month_day !== undefined && r.freq !== "monthly")
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["by_month_day"], message: "Monthly only" });
  });

/** Someone a report goes to: a login, so the report can be generated as them. */
const HomeReportRecipient = z
  .object({
    user_id: uuid,
    display_name: z.string(),
    email: z.string(),
  })
  .strict();

/** A report's schedule, as the report card and the Edit form show it. */
const HomeReportSchedule = z
  .object({
    report_schedule_id: uuid,
    recurrence: HomeReportRecurrence,
    /** The first day it may fire; the rule counts from it. */
    starts_on: isoDate,
    /** The time of day it fires, in Lagos. */
    run_time: TimeOfDay,
    formats: z.array(HomeReportFormat).min(1).max(HOME_REPORT_FORMATS.length),
    /** Who receives it, in the order chosen. */
    audience: z.array(HomeReportRecipient).max(HOME_REPORT_MAX_RECIPIENTS),
    /** False while paused: it keeps its schedule and sends nothing. */
    active: z.boolean(),
    last_run_at: isoDateTime.nullable(),
    /** Null while paused. */
    next_run_at: isoDateTime.nullable(),
  })
  .strict();

/** One report, as its card and its Edit form show it. */
const HomeReport = z
  .object({
    saved_report_id: uuid,
    name: z.string(),
    report_key: HomeReportSource,
    filters: HomeReportFilters,
    /** Others who hold `home.reports` and may open the source see it and run it for themselves. */
    shared: z.boolean(),
    owner_user_id: uuid,
    owner_name: z.string(),
    status: HomeReportStatus,
    /** Null for a report run only on demand. */
    schedule: HomeReportSchedule.nullable(),
    /** The reader may change, pause or archive it: its owner, or the CEO. */
    can_edit: z.boolean(),
    archived_at: isoDateTime.nullable(),
    created_at: isoDateTime,
    updated_at: isoDateTime,
  })
  .strict();

/**
 * GET /home/reports: the reports the reader may see (their own, and shared ones whose
 * source they may open), by name. Archived ones only when `archived` asks for them.
 * `mine`: only those the reader owns or receives.
 */
const HomeReportQuery = listQuery(
  {
    report_key: HomeReportSource.optional(),
    status: HomeReportStatus.optional(),
    archived: z.enum(["true", "false"]).optional(),
    mine: z.enum(["true", "false"]).optional(),
  },
  ["name", "created_at"],
);
const HomeReportPage = Paged(HomeReport);

/**
 * A schedule as the form sends it, whole. A new schedule runs; saving over one keeps it
 * running or paused as it was.
 */
const HomeReportScheduleSave = z
  .object({
    recurrence: HomeReportRecurrence,
    starts_on: isoDate,
    run_time: TimeOfDay,
    formats: z
      .array(HomeReportFormat)
      .min(1, "Pick a format")
      .max(HOME_REPORT_FORMATS.length)
      .refine(distinct, "Each format once"),
    recipient_user_ids: z
      .array(uuid)
      .min(1, "Add a recipient")
      .max(HOME_REPORT_MAX_RECIPIENTS, `Up to ${HOME_REPORT_MAX_RECIPIENTS} people`)
      .refine(distinct, "Each person once"),
  })
  .strict();

/** The source a new report runs is one the form offers, and its filters are ones that source takes. */
function sourceFits(v, ctx) {
  const source = HOME_REPORT_SOURCES[v.report_key];
  if (!source) return;
  if (!source.offered)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["report_key"], message: "Choose a source" });
  for (const key of Object.keys(v.filters || {})) {
    if (v.filters[key] !== undefined && !source.filters.includes(key))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["filters", key], message: "Not for this source" });
  }
  rosterDayFits(v.filters, ctx);
}

/** Daily Attendance's statuses are ones its day can hold: Absent on the last working day, Not In today. */
function rosterDayFits(filters, ctx) {
  const statuses = filters && filters.roster_statuses;
  if (!statuses) return;
  const day = filters.roster_day || "today";
  if (statuses.some((s) => !ROSTER_STATUSES_ON[day].includes(s)))
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["filters", "roster_statuses"],
      message: day === "today" ? "Absent needs Last Working Day" : "Not In needs Today",
    });
}

/**
 * POST /home/reports: a report, and its schedule when it has one (none: run on demand).
 * Its source cannot change afterwards, since its filters belong to it.
 */
const HomeReportCreate = z
  .object({
    name: text(80),
    report_key: HomeReportSource,
    filters: HomeReportFilters.default({}),
    shared: z.boolean().default(false),
    schedule: HomeReportScheduleSave.nullable().default(null),
  })
  .strict()
  .superRefine(sourceFits);

/**
 * PATCH /home/reports/:id: its name, filters, sharing, or its whole schedule (null makes
 * it on demand). The service holds the filters to the report's source as POST does.
 */
const HomeReportUpdate = z
  .object({
    name: text(80),
    filters: HomeReportFilters,
    shared: z.boolean(),
    schedule: HomeReportScheduleSave.nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Change at least one field" })
  .superRefine((v, ctx) => rosterDayFits(v.filters, ctx));

/** PATCH /home/reports/:id/schedule: Pause or Resume. */
const HomeReportScheduleState = z.object({ active: z.boolean() }).strict();

/** GET /home/reports/summary: the four cards over the reports the reader may see. */
const HomeReportSummary = z
  .object({
    /** Reports the reader may see that run on a schedule, and those whose schedule is paused. */
    scheduled: count,
    paused: count,
    /** Files generated since the 1st of this month (Lagos), of the runs on the reader's Recent Runs. */
    runs_this_month: count,
    /** People who receive at least one of the scheduled ones. */
    recipients: count,
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Runs
 * ------------------------------------------------------------------ */

/**
 * One generated file. Download it from GET /documents/:id/content once `status` is
 * `done`; until then `document_id` is null.
 */
const HomeReportRun = z
  .object({
    home_report_run_id: uuid,
    number: z.string(),
    saved_report_id: uuid,
    report_name: z.string(),
    report_key: HomeReportSource,
    /** Null for a run on demand. */
    report_schedule_id: uuid.nullable(),
    /** The slot a schedule fired for; null on demand. */
    scheduled_for: isoDateTime.nullable(),
    recipient_user_id: uuid,
    recipient_name: z.string(),
    /** Who pressed Run Now or Export; null for a scheduled run. */
    requested_by: uuid.nullable(),
    format: HomeReportFormat,
    status: HomeReportRunStatus,
    document_id: uuid.nullable(),
    emailed_at: isoDateTime.nullable(),
    run_at: isoDateTime,
    finished_at: isoDateTime.nullable(),
  })
  .strict();

/**
 * GET /home/report-runs: Recent Runs, newest first: the files the reader received, and
 * every file of the reports they own (the CEO: every file). `saved_report_id` keeps one
 * report's history.
 */
const HomeReportRunQuery = listQuery(
  {
    saved_report_id: uuid.optional(),
    status: HomeReportRunStatus.optional(),
    format: HomeReportFormat.optional(),
  },
  ["run_at"],
);
const HomeReportRunPage = Paged(HomeReportRun);

/**
 * POST /home/reports/:id/run (Run Now) and POST /home/overview/export: one file for the
 * caller, in one format. The answer is the pending run.
 */
const HomeReportRunNow = z.object({ format: HomeReportFormat }).strict();

/* ------------------------------------------------------------------ *
 * The file and its email
 * ------------------------------------------------------------------ */

/** A cell as the PDF prints it: dates day-first and amounts in Naira, already written out. */
const HomeReportCell = z.object({ text: z.string(), numeric: z.boolean() }).strict();

/** One table of a report file: a source's rows, or one part of an Overview. */
const HomeReportTable = z
  .object({
    title: z.string(),
    columns: z.array(z.object({ header: z.string(), numeric: z.boolean() }).strict()).min(1),
    rows: z.array(z.object({ cells: z.array(HomeReportCell) }).strict()),
    /** Why the table is shorter than its source: more rows than one file holds. Null when whole. */
    note: z.string().nullable(),
  })
  .strict();

/**
 * templates/documents/report.html: a report as its recipient may read it. Generated as
 * that person, so every row is one they could open on screen.
 */
const HomeReportDocumentVars = z
  .object({
    report_name: z.string(),
    /** The run's number (RPT-0001); the document itself takes none. */
    run_number: z.string(),
    /** The source's name ("Daily Attendance"). */
    source: z.string(),
    recipient_name: z.string(),
    /** The moment the report describes: the slot a schedule fired for, or when it was asked for. */
    as_at: isoDateTime,
    /** The report's filters as a person reads them ("Status: Late"). */
    filters: z.array(z.object({ label: z.string(), value: z.string() }).strict()),
    /** Lines above the tables: an Overview's greeting and its headline figures. */
    lines: z.array(z.string()),
    tables: z.array(HomeReportTable).min(1),
  })
  .strict();

/**
 * templates/email/scheduled-report.html: a schedule's file, attached. A run somebody pressed
 * for (Run Now, the Overview's Export) is downloaded where they pressed, never emailed.
 */
const HomeReportEmailVars = z
  .object({
    report_name: z.string(),
    run_number: z.string(),
    /** How the attachment opens: "PDF" or "Excel". */
    format: z.enum(["PDF", "Excel"]),
  })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  HomeReportFilters: {
    table: null,
    reason: "the filters a report's source takes, kept in saved_report.definition",
  },
  HomeReportRecurrence: {
    table: null,
    reason: "a recurrence rule (src/shared/time/recurrence.js), kept in report_schedule.recurrence",
  },
  HomeReportRecipient: {
    table: "app_user",
    virtual: { display_name: "the person's name, from their employee record" },
  },
  HomeReportSchedule: {
    table: "report_schedule",
    virtual: {
      audience: "the logins in recipient_user_ids, in order, each with its name and address",
    },
  },
  HomeReport: {
    table: "saved_report",
    virtual: {
      filters: "kept in saved_report.definition",
      owner_name: "the name of the login in owner_user_id",
      status: "from the schedule: none is on demand, active is scheduled, otherwise paused",
      can_edit: "the reader owns the report, or is the CEO",
    },
    nested: {
      schedule: {
        table: "report_schedule",
        virtual: {
          audience: "the logins in recipient_user_ids, in order, each with its name and address",
        },
      },
    },
  },
  HomeReportQuery: { table: null, reason: "list controls and the report list's filters" },
  HomeReportPage: { table: null, reason: "a page of reports" },
  HomeReportScheduleSave: { table: "report_schedule" },
  HomeReportCreate: {
    table: "saved_report",
    virtual: { filters: "written to saved_report.definition" },
    nested: { schedule: { table: "report_schedule" } },
  },
  HomeReportUpdate: {
    table: "saved_report",
    virtual: { filters: "written to saved_report.definition" },
    nested: { schedule: { table: "report_schedule" } },
  },
  HomeReportScheduleState: { table: "report_schedule" },
  HomeReportSummary: { table: null, reason: "counts over the reports, schedules and runs the reader may see" },
  HomeReportRun: {
    table: "home_report_run",
    virtual: {
      report_name: "the report's name, from saved_report",
      report_key: "the report's source, from saved_report",
      recipient_name: "the name of the login in recipient_user_id",
    },
  },
  HomeReportRunQuery: { table: null, reason: "list controls and the Recent Runs filters" },
  HomeReportRunPage: { table: null, reason: "a page of report runs" },
  HomeReportRunNow: { table: "home_report_run" },
  HomeReportDocumentVars: {
    table: null,
    reason: "the variables of templates/documents/report.html, not a row",
  },
  HomeReportEmailVars: {
    table: null,
    reason: "the variables of templates/email/scheduled-report.html, not a row",
  },
};

module.exports = {
  TABLES,
  HOME_REPORT_MAX_RECIPIENTS,
  HOME_REPORT_FORMATS,
  HOME_REPORT_SOURCES,
  HOME_REPORT_ROSTER_DAYS,
  ROSTER_STATUSES_ON,
  HomeReportRosterDay,
  HomeReportFormat,
  HomeReportSource,
  HomeReportStatus,
  HomeReportRunStatus,
  HomeReportFilters,
  HomeReportRecurrence,
  HomeReportRecipient,
  HomeReportSchedule,
  HomeReport,
  HomeReportQuery,
  HomeReportPage,
  HomeReportScheduleSave,
  HomeReportCreate,
  HomeReportUpdate,
  HomeReportScheduleState,
  HomeReportSummary,
  HomeReportRun,
  HomeReportRunQuery,
  HomeReportRunPage,
  HomeReportRunNow,
  HomeReportDocumentVars,
  HomeReportEmailVars,
};
