"use strict";
/**
 * Home · Overview and Team (docs/guides/home.md §2 to §6): the role's KPI cards, its
 * chart and sections, the records behind a card, the cards a person chooses for
 * themselves, the cards a role opens on, and the Team tab over the shared attendance
 * roster (src/modules/attendance/attendance.roster.js).
 *
 * The server sends data and the screen words it. A section's title, a chart's caption
 * and a status's label are written in app/src/features/home, where the screen gates read
 * them. A card's title, its caption and the columns behind it are the KPI catalogue's
 * (src/modules/dashboard/kpi-catalog), which a test holds to the screen-copy limits.
 *
 * A card id is a key of that catalogue: code, not a table. The contract checks its shape;
 * the service checks it is a card the reader may see, and answers 404 for one they may not.
 *
 * A section the reader has nothing for is null and is not drawn (home.md §11): a reader
 * with no partnerships grant gets `pipeline: null`, never an empty card.
 */
const { z } = require("zod");
const { uuid, isoDate, isoDateTime, money, listQuery, Paged, PAGE_SIZE } = require("./common");
const { Tone, PersonRef } = require("./organisation");
const { RecordScope } = require("./access");
const { TimeOfDay } = require("./settings");
const { LeaveRequest } = require("./leave");

/** A count on screen: whole and never negative. */
const count = z.number().int().min(0);

/** A share of something, as a whole percentage. */
const percent = z.number().int().min(0).max(100);

/** A calendar month, YYYY-MM. */
const isoMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "must be a month as YYYY-MM");

const KEY = /^[a-z][a-z0-9_]*$/;

/* ------------------------------------------------------------------ *
 * KPI cards
 * ------------------------------------------------------------------ */

/** A row of KPI cards holds four. A lost card shrinks the row; nothing is put in its place. */
const HOME_KPI_MAX = 4;

/** A KPI catalogue key ("attendance_today"). Stored in role_kpi and home_kpi_pick. */
const HomeKpiKey = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, "Not a card");

/** The catalogue's groups, in the order the card picker lists them. */
const HomeKpiDomain = z.enum(["people", "work", "business", "finance"]);

/** What a card's figure is: a count, a sum of money, a percentage, a part of a whole, or days. */
const HomeKpiUnit = z.enum(["count", "money", "pct", "pair", "days"]);

/**
 * Where the cards on Overview came from: the person's own pick, their roles' cards, or the
 * defaults of their Home view (home.md §6, KPI resolution).
 */
const HomeKpiSource = z.enum(["user", "role", "view"]);

/** Which way the figure moved against the same day last week. */
const HomeKpiTrend = z.enum(["up", "down", "flat"]);

/**
 * One KPI card, flat. Zero is a figure and is shown; a card the server could not compute
 * is left out of the row instead (home.md §6). A ratio keeps what it is out of, so "0 of
 * 30" and "0 of nothing" stay different.
 */
const HomeKpiCard = z
  .object({
    key: HomeKpiKey,
    title: z.string(),
    unit: HomeKpiUnit,
    /** count and days: the figure; pct: the percentage; pair: the part ("22" of 25). Null for money. */
    value: z.number().nullable(),
    /** money only: the sum, Naira, as a wire string ("1250000.00"). */
    amount: money.nullable(),
    /** pct and pair: what the figure is out of. Null for the other units. */
    denominator: count.nullable(),
    /** False when there was nothing to measure (a denominator of 0): the card shows no figure. */
    measurable: z.boolean(),
    /** A short line under the figure ("4 late"), at most five words. */
    caption: z.string().nullable(),
    tone: Tone.nullable(),
    trend: HomeKpiTrend.nullable(),
    /** The card opens the records behind it (GET /home/kpi/:key). */
    opens: z.boolean(),
  })
  .strict();

/** A card as the picker and the role editor offer it: what it is, not its figure. */
const HomeKpiOption = z
  .object({
    key: HomeKpiKey,
    title: z.string(),
    domain: HomeKpiDomain,
    unit: HomeKpiUnit,
  })
  .strict();

const kpiIds = (max) =>
  z
    .array(HomeKpiKey)
    .max(max, `Up to ${max} cards`)
    .refine((ids) => new Set(ids).size === ids.length, "Each card once");

/* ------------------------------------------------------------------ *
 * Overview: GET /home/overview
 * ------------------------------------------------------------------ */

/**
 * The role's main chart (home.md §10.1), chosen by the reader's Home view in
 * src/modules/dashboard/dashboard.layout.js. Null when the reader cannot open the module
 * the chart reads.
 *
 *   attendance_days  Operations: who was in on each of the last 14 working days
 *   goals            CEO: the organisation's goals this quarter and how far along each is
 *   signed_value     Partnerships: the value of agreements signed each month, Naira
 */
const HomeChart = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("attendance_days"),
      days: z
        .array(z.object({ date: isoDate, present: count, expected: count }).strict())
        .max(14),
    })
    .strict(),
  z
    .object({
      kind: z.literal("goals"),
      goals: z
        .array(
          z
            .object({
              title: z.string(),
              progress: percent.nullable(),
              link: z.string().nullable(),
            })
            .strict(),
        )
        .max(PAGE_SIZE),
    })
    .strict(),
  z
    .object({
      kind: z.literal("signed_value"),
      months: z.array(z.object({ month: isoMonth, amount: money }).strict()).max(12),
    })
    .strict(),
]);

/**
 * The donut beside the main chart.
 *
 *   on_time  Operations: this month so far, the days people were in on time, late, or absent
 *   org_kpi  CEO: the organisation's KPI score and each department's beside it
 */
const HomeDonut = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("on_time"),
      on_time: count,
      late: count,
      absent: count,
    })
    .strict(),
  z
    .object({
      kind: z.literal("org_kpi"),
      percent: percent.nullable(),
      departments: z
        .array(
          z
            .object({
              department_id: uuid,
              department: z.string(),
              percent: percent.nullable(),
            })
            .strict(),
        )
        .max(PAGE_SIZE),
    })
    .strict(),
]);

/**
 * One person's status for a day on the shared attendance roster: the attendance register's
 * status in Home's words (home.md §6, attendance.md §6.9). On leave; late (the day's record
 * has late minutes); on site, remote or field (in on time; field on a field assignment's day,
 * remote for someone who works remotely or is on an approved remote day);
 * absent (a working day the day-close closed with no clock-in); not in (a working day not
 * closed, no clock-in yet). A day that is not worked, with nothing recorded, has no status.
 */
const HomeRosterStatus = z.enum(["on_leave", "late", "on_site", "remote", "field", "absent", "not_in"]);

/** Staff: today's shift, their clock-in, where they are, their status and hours. */
const HomeDayStrip = z
  .object({
    /** Today's hours in the working week; null on a day that is not a working day. */
    starts_at: TimeOfDay.nullable(),
    ends_at: TimeOfDay.nullable(),
    clock_in_at: isoDateTime.nullable(),
    clock_out_at: isoDateTime.nullable(),
    status: HomeRosterStatus.nullable(),
    /** The worksite of the first clock-in; null when remote or not in. */
    worksite: z.string().nullable(),
    worked_minutes: count,
  })
  .strict();

/** The partnership pipeline: open opportunities by stage, and the partners gone quiet. */
const HomePipeline = z
  .object({
    /** In stage order. `label` is the stage's name as Partnerships keep it. */
    stages: z
      .array(z.object({ stage: z.string(), label: z.string(), open: count }).strict())
      .max(PAGE_SIZE),
    /** Active partners with no recorded contact in the last 30 days. */
    quiet_30d: count,
  })
  .strict();

/** A goal on Goals This Quarter or My Goals This Quarter. Progress is null until it can be measured. */
const HomeGoal = z
  .object({
    title: z.string(),
    progress: percent.nullable(),
    due_on: isoDate.nullable(),
    link: z.string().nullable(),
  })
  .strict();

/**
 * What is left this year of the leave type My Leave leads with: Annual, else the first
 * type with an allowance. The same figure My Leave shows, from the leave module's own
 * balance read (schemas/leave.js `LeaveBalance`).
 */
const HomeLeaveBalance = z
  .object({
    leave_type_id: uuid,
    name: z.string(),
    /** Working days left: the allowance less what is taken, booked and waiting. */
    remaining: z.number(),
  })
  .strict();

/**
 * Staff: their leave still ahead (submitted or approved, not yet over, soonest first), as
 * the leave module shapes a request, and what is left of the year. `balance` is null when
 * no leave type has an allowance.
 */
const HomeUpcomingLeave = z
  .object({
    balance: HomeLeaveBalance.nullable(),
    requests: z.array(LeaveRequest).max(PAGE_SIZE),
  })
  .strict();

/**
 * One event on Activity Today. The screen words it from `event_key`; the server sends
 * only events of modules the reader may open, from an allow-list, and never a mail or
 * private event (home.md §6).
 */
const HomeActivityItem = z
  .object({
    event_id: uuid,
    event_key: z.string(),
    module_key: z.string(),
    occurred_at: isoDateTime,
    actor_name: z.string().nullable(),
    /** The record the event is about, as its own screen names it. */
    subject: z.string().nullable(),
    link: z.string().nullable(),
  })
  .strict();

/** One working day of Your Week: its hours, a public holiday, the reader's leave, and what is due. */
const HomeWeekDay = z
  .object({
    date: isoDate,
    starts_at: TimeOfDay.nullable(),
    ends_at: TimeOfDay.nullable(),
    /** The public holiday's name, when the day is one. */
    holiday: z.string().nullable(),
    on_leave: z.boolean(),
    items: z
      .array(
        z
          .object({
            kind: z.enum(["event", "task"]),
            title: z.string(),
            at: isoDateTime.nullable(),
            link: z.string().nullable(),
          })
          .strict(),
      )
      .max(PAGE_SIZE),
  })
  .strict();

/**
 * GET /home/overview: everything the Overview draws, resolved for the reader. Need You's
 * requests come from GET /workflow/mine, its own paged list; `alerts_to_clear` is the
 * alerts beside them.
 */
const HomeOverview = z
  .object({
    /** The name the greeting uses: the person's first name. */
    greeting_name: z.string(),
    /** Today in Lagos. */
    date: isoDate,
    /** Operations: who is in today, out of who is expected, for the line under the greeting. */
    clocked_in: z.object({ present: count, expected: count }).strict().nullable(),
    cards: z.array(HomeKpiCard).max(HOME_KPI_MAX),
    picker_source: HomeKpiSource,
    chart: HomeChart.nullable(),
    donut: HomeDonut.nullable(),
    day_strip: HomeDayStrip.nullable(),
    pipeline: HomePipeline.nullable(),
    goals: z.array(HomeGoal).max(PAGE_SIZE).nullable(),
    my_goals: z.array(HomeGoal).max(PAGE_SIZE).nullable(),
    upcoming_leave: HomeUpcomingLeave.nullable(),
    activity: z.array(HomeActivityItem).max(PAGE_SIZE).nullable(),
    /** The working days of this week, Monday first. */
    week: z.array(HomeWeekDay).max(7).nullable(),
    /** Open alerts the reader may clear; null for a reader who clears none. */
    alerts_to_clear: count.nullable(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * The card picker and a role's cards
 * ------------------------------------------------------------------ */

/**
 * GET /home/kpi-picker, and the answer to choosing or resetting. Offers only cards the
 * reader may see: a card they cannot open is not listed, greyed or counted.
 */
const HomeKpiPicker = z
  .object({
    max: z.literal(HOME_KPI_MAX),
    cards: z.array(HomeKpiOption),
    /** The person's own choice, in order; null when they follow their roles. An empty list is a choice. */
    kpi_ids: z.array(HomeKpiKey).max(HOME_KPI_MAX).nullable(),
    /** What they see when they have not chosen: their roles' cards, else their Home view's. */
    default_ids: z.array(HomeKpiKey).max(HOME_KPI_MAX),
    /** Cards their roles fix in place: always shown, first, and never taken off. */
    locked_ids: z.array(HomeKpiKey).max(HOME_KPI_MAX),
    /** What Overview shows now. */
    showing_ids: z.array(HomeKpiKey).max(HOME_KPI_MAX),
    source: HomeKpiSource,
  })
  .strict();

/** PUT /home/kpi-picks: the cards a person wants, in order. DELETE /home/kpi-picks goes back to their roles'. */
const HomeKpiPicks = z.object({ kpi_ids: kpiIds(HOME_KPI_MAX) }).strict();

/**
 * GET /home/roles/:role_id/kpis: the cards a role's members open on, and the ones they
 * cannot take off. `cards` are the ones the ROLE may see, so a person editing it is offered
 * cards they cannot open themselves.
 */
const HomeRoleKpis = z
  .object({
    role_id: uuid,
    default_ids: z.array(HomeKpiKey).max(HOME_KPI_MAX),
    locked_ids: z.array(HomeKpiKey).max(HOME_KPI_MAX),
    /** False when the role has no cards of its own and its members get their Home view's. */
    configured: z.boolean(),
    /** The Home view's cards the role falls back to, as the role may see them. */
    view_default_ids: z.array(HomeKpiKey).max(HOME_KPI_MAX),
    cards: z.array(HomeKpiOption),
  })
  .strict();

/** PUT /home/roles/:role_id/kpis. DELETE takes the role back to its Home view's cards. */
const HomeRoleKpisSave = z
  .object({
    default_ids: kpiIds(HOME_KPI_MAX),
    locked_ids: kpiIds(HOME_KPI_MAX),
  })
  .strict()
  .refine((v) => v.locked_ids.every((id) => v.default_ids.includes(id)), {
    message: "Lock a chosen card",
    path: ["locked_ids"],
  });

/* ------------------------------------------------------------------ *
 * The records behind a card: GET /home/kpi/:key and /meta
 * ------------------------------------------------------------------ */

/** The card a detail route is for. A key the reader may not see answers 404. */
const HomeKpiParams = z.object({ key: HomeKpiKey }).strict();

/** A column of a card's list. `phone`: shown on a phone card (two at most besides the title). */
const HomeKpiColumn = z
  .object({
    key: z.string().regex(KEY),
    label: z.string(),
    numeric: z.boolean(),
    phone: z.boolean(),
  })
  .strict();

/** A group chip over the list ("On Site"), with how many records are in it. */
const HomeKpiGroup = z
  .object({
    value: z.string().regex(KEY),
    label: z.string(),
    count,
  })
  .strict();

/** GET /home/kpi/:key/meta: the title, the line above the list, its columns and groups. */
const HomeKpiDetailMeta = z
  .object({
    key: HomeKpiKey,
    title: z.string(),
    /** One line over the list ("22 of 25 clocked in across the organisation"); null when none. */
    summary: z.string().nullable(),
    columns: z.array(HomeKpiColumn).min(1).max(8),
    groups: z.array(HomeKpiGroup).max(10),
  })
  .strict();

/** One cell of a card's list, typed so the screen formats it (dates day-first, money as Naira). */
const HomeKpiCell = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }).strict(),
  z.object({ kind: z.literal("person"), person: PersonRef }).strict(),
  z.object({ kind: z.literal("pill"), tone: Tone, text: z.string() }).strict(),
  z.object({ kind: z.literal("money"), amount: money }).strict(),
  z.object({ kind: z.literal("date"), date: isoDate }).strict(),
  z.object({ kind: z.literal("time"), at: isoDateTime }).strict(),
  z.object({ kind: z.literal("number"), value: z.number() }).strict(),
]);

/** One record behind a card: a cell per column (null when empty) and where it opens. */
const HomeKpiDetailRow = z
  .object({
    id: z.string(),
    cells: z.record(z.string(), HomeKpiCell.nullable()),
    link: z.string().nullable(),
  })
  .strict();

/** GET /home/kpi/:key: in the card's own order; `group` keeps one chip's records. */
const HomeKpiDetailQuery = listQuery({ group: z.string().regex(KEY).max(40).optional() });
const HomeKpiDetailPage = Paged(HomeKpiDetailRow);

/* ------------------------------------------------------------------ *
 * Team: GET /home/team, /team/summary, /team/attendance
 * ------------------------------------------------------------------ */

/**
 * GET /home/team/summary: whose people the tab shows, and its four cards today: Present Today,
 * On Site, Remote and Flags, each the number of records behind it (GET /home/kpi/:key).
 */
const HomeTeamSummary = z
  .object({
    /** Today in Lagos. */
    date: isoDate,
    /** `all`: the whole organisation; `team`: the reader and everyone below them; `own`: the reader alone. */
    scope: RecordScope,
    cards: z.array(HomeKpiCard).max(HOME_KPI_MAX),
  })
  .strict();

/** GET /home/team: today's roster for the people the reader may see. `q` searches name and job title. */
const HomeTeamQuery = listQuery(
  {
    department_id: uuid.optional(),
    status: HomeRosterStatus.optional(),
    no_clock_out_yesterday: z.enum(["true", "false"]).optional(),
  },
  ["display_name", "department", "clock_in_at"],
);

/** One person on the Team Roster today. */
const HomeTeamRow = z
  .object({
    employee: PersonRef,
    department_id: uuid,
    /** Null on a day that is not worked, when nothing is recorded for them. */
    status: HomeRosterStatus.nullable(),
    clock_in_at: isoDateTime.nullable(),
    clock_out_at: isoDateTime.nullable(),
    worksite: z.string().nullable(),
    no_clock_out_yesterday: z.boolean(),
    /** Their weighted KPI score this period; null until Performance measures it (M2). */
    kpi_percent: percent.nullable(),
    /** Tasks assigned to them and not done; null until Tasks are built (M2). */
    open_tasks: count.nullable(),
  })
  .strict();

const HomeTeamPage = Paged(HomeTeamRow);

/**
 * GET /home/team/attendance: Attendance This Month, one row a person on the register on any
 * day from the 1st to today. `q` searches name and job title.
 */
const HomeTeamAttendanceQuery = listQuery(
  { department_id: uuid.optional() },
  ["display_name", "on_time"],
);

/**
 * A person's days this month so far, as My Attendance counts them: a day counts once the
 * attendance module has recorded it (a clock-in, or the day-close's absence or leave).
 */
const HomeTeamAttendanceRow = z
  .object({
    employee: PersonRef,
    /** The days they were expected in: on time plus late plus absent. Leave is counted apart. */
    expected: count,
    on_time: count,
    late: count,
    absent: count,
    on_leave: count,
  })
  .strict();

const HomeTeamAttendancePage = Paged(HomeTeamAttendanceRow);

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  HomeKpiCard: { table: null, reason: "a card computed from the KPI catalogue for the reader" },
  HomeKpiOption: { table: null, reason: "a KPI catalogue entry as the picker offers it; the catalogue is code" },
  HomeDayStrip: { table: null, reason: "the reader's day on the shared attendance roster and the working week" },
  HomePipeline: { table: null, reason: "open opportunities counted by stage, through the partnerships source adapter" },
  HomeGoal: { table: null, reason: "a goal and its progress, through the goals source adapter" },
  HomeLeaveBalance: { table: null, reason: "one leave type's year, from the leave module's balance read" },
  HomeUpcomingLeave: { table: null, reason: "the reader's own leave ahead and what is left of the leave year" },
  HomeActivityItem: {
    table: "event_log",
    virtual: {
      actor_name: "the name of the login in actor_user_id",
      subject: "the record's name, as its own screen shows it",
      link: "derived from entity_type and entity_id through shared/route-map.js",
    },
  },
  HomeWeekDay: { table: null, reason: "a working day of this week from the working week, holidays, leave and what is due" },
  HomeOverview: { table: null, reason: "the reader's Overview, assembled from the KPI catalogue and the source adapters" },
  HomeKpiPicker: { table: null, reason: "the cards a reader may choose, their pick from home_kpi_pick and what their roles give them" },
  HomeKpiPicks: { table: "home_kpi_pick" },
  HomeRoleKpis: {
    table: "role_kpi",
    virtual: {
      configured: "whether the role has a role_kpi row",
      view_default_ids: "the role's Home view defaults in src/modules/dashboard/kpi-catalog, as the role may see them",
      cards: "the KPI catalogue's cards the role may see",
    },
  },
  HomeRoleKpisSave: { table: "role_kpi" },
  HomeKpiParams: { table: null, reason: "the :key path parameter, a KPI catalogue key" },
  HomeKpiColumn: { table: null, reason: "a column a KPI catalogue entry declares for its list" },
  HomeKpiGroup: { table: null, reason: "a group a KPI catalogue entry declares, counted over its records" },
  HomeKpiDetailMeta: { table: null, reason: "a KPI catalogue entry's list, described for the reader" },
  HomeKpiDetailRow: { table: null, reason: "a record behind a card, as its catalogue entry's list shapes it" },
  HomeKpiDetailQuery: { table: null, reason: "list controls and the group chip of a card's list" },
  HomeKpiDetailPage: { table: null, reason: "a page of the records behind a card" },
  HomeTeamSummary: { table: null, reason: "the Team tab's scope and its cards from the shared attendance roster" },
  HomeTeamQuery: { table: null, reason: "list controls and the Team Roster's filters" },
  HomeTeamRow: { table: null, reason: "a person's day on the shared attendance roster, the person with their photo_url" },
  HomeTeamPage: { table: null, reason: "a page of the Team Roster" },
  HomeTeamAttendanceQuery: { table: null, reason: "list controls and the department filter of Attendance This Month" },
  HomeTeamAttendanceRow: { table: null, reason: "a person's month so far, counted from the shared attendance roster, the person with their photo_url" },
  HomeTeamAttendancePage: { table: null, reason: "a page of Attendance This Month" },
};

module.exports = {
  TABLES,
  HOME_KPI_MAX,
  HomeKpiKey,
  HomeKpiDomain,
  HomeKpiUnit,
  HomeKpiSource,
  HomeKpiTrend,
  HomeKpiCard,
  HomeKpiOption,
  HomeChart,
  HomeDonut,
  HomeRosterStatus,
  HomeDayStrip,
  HomePipeline,
  HomeGoal,
  HomeLeaveBalance,
  HomeUpcomingLeave,
  HomeActivityItem,
  HomeWeekDay,
  HomeOverview,
  HomeKpiPicker,
  HomeKpiPicks,
  HomeRoleKpis,
  HomeRoleKpisSave,
  HomeKpiParams,
  HomeKpiColumn,
  HomeKpiGroup,
  HomeKpiDetailMeta,
  HomeKpiCell,
  HomeKpiDetailRow,
  HomeKpiDetailQuery,
  HomeKpiDetailPage,
  HomeTeamSummary,
  HomeTeamQuery,
  HomeTeamRow,
  HomeTeamPage,
  HomeTeamAttendanceQuery,
  HomeTeamAttendanceRow,
  HomeTeamAttendancePage,
};
