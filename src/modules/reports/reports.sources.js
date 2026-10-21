"use strict";
/**
 * The sources a report can run (docs/guides/home.md §6 Reports): what each one reads, who
 * may read it, the filters it takes and the columns of its file.
 *
 * A source is the query its own screen uses, read page by page through the owning module's
 * service or repo, never a second copy of it, so a file holds the rows its reader would see
 * on that screen and nothing else:
 *
 *   daily_attendance  today's roster (attendance.roster.js page), as Team and People ·
 *                     Attendance read it, in the reader's `people` scope; department, status
 *   leave             People · Leave's list (leave.service list), in the `people` scope;
 *                     status, type
 *   open_alerts       the open alerts on Home · Alerts (alerts.service list), through the one
 *                     rule of who sees an alert; category, severity
 *   headcount         the staff register (organisation.service list), the active staff the
 *                     Headcount card counts, in the `people` scope; department
 *   tasks             the records behind Overdue Tasks
 *   partnerships      the records behind Active Partnerships
 *   expenses          the records behind Expenses Awaiting Approval
 *   recruitment       the records behind Open Vacancies
 *   overview          the reader's own Overview (dashboard.service overview), each part a
 *                     table: the Overview Export, never offered on the form
 *
 * The four forward sources read their KPI card's records (kpi-catalog), which read the
 * source adapters of the milestones that build those tables (dashboard/sources): they hold no
 * rows until those milestones are built and used, and take no filters until then.
 *
 * Keys and order are the contract's HOME_REPORT_SOURCES, and so are each source's module and
 * filters; a unit test holds them equal. Each source here adds:
 *
 *   label         its name on the file and in the email
 *   capabilities  null, or the capabilities of which the reader must hold one, besides the
 *                 module's `view` grant: the ones that open the source's screen
 *   columns       [{ key, header, kind }], kind text, date (day-first), datetime, number or
 *                 money (Naira)
 *   read          (db, reader, filters, page, at) => one page of 25 raw rows
 *   row           a raw row as the columns name it
 *   snapshot      overview only: (db, reader, at) => the reader's HomeOverview
 *   tables        overview only: the snapshot as { lines, tables }
 *
 * `reader` is { user, scope }: the person the file is built as (grants-cache getAuthUser) and
 * their scope on the source's module. `at` is the moment the report describes.
 *
 * A table holds at most ROW_CEILING rows, the first of its source's order; the file says so
 * when there were more (`total` beside the rows).
 */
const c = require("@mycity/contract");
const rbac = require("../../middleware/rbac");
const grantsCache = require("../../shared/rbac/grants-cache");
const fieldMask = require("../../shared/rbac/field-mask");
const catalogue = require("../../shared/events/catalogue");
const lagos = require("../../shared/time/lagos");
const workingWeek = require("../../shared/time/working-week");
const { formatDate, formatLongDate, formatMonth } = require("../../shared/time/day-first");
const money = require("../../shared/money/money");
const roster = require("../attendance/attendance.roster");
const leave = require("../leave/leave.service");
const organisation = require("../organisation/organisation.service");
const alerts = require("../alerts/alerts.service");
const dashboard = require("../dashboard/dashboard.service");
const kpi = require("../dashboard/kpi-catalog");

/** The most rows one table of a file holds: eighty pages of the screen's list. */
const ROW_CEILING = 2000;

/** The kinds of column a file formats. */
const KINDS = Object.freeze(["text", "date", "datetime", "number", "money"]);

/** "on_site" → "On Site": a stored value as a file shows it. */
const words = (value) =>
  value === null || value === undefined || value === ""
    ? null
    : String(value)
        .split("_")
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
        .join(" ");

/** "1 day", "12 days". */
const days = (n) => `${n} ${n === 1 ? "day" : "days"}`;

const col = (key, header, kind = "text") => Object.freeze({ key, header, kind });

/* ------------------------------------------------------------------ *
 * The sources built on M0 and M1 tables
 * ------------------------------------------------------------------ */

/**
 * The day Daily Attendance reads at `at` (Lagos): today, or the last working day before it,
 * as the roster's own No Clock-Out Yesterday reads it (Saturday on a Monday, the day before a
 * holiday after one). The day-close has closed that day by its 01:30 run.
 * @param {{query: Function}} db
 * @param {object} filters  saved_report.definition.filters
 * @param {Date} at
 * @returns {Promise<string>} YYYY-MM-DD
 */
async function rosterDate(db, filters, at) {
  const today = lagos.today(at);
  if ((filters && filters.roster_day) !== "last_working_day") return today;
  return roster.yesterdayOf(today, await workingWeek.loadCalendar(db)).date;
}

const dailyAttendance = {
  label: "Daily Attendance",
  capabilities: null,
  columns: [
    col("employee", "Employee"),
    col("job_title", "Job Title"),
    col("department", "Department"),
    col("status", "Status"),
    col("clock_in_at", "Clock-In", "datetime"),
    col("clock_out_at", "Clock-Out", "datetime"),
    col("late_minutes", "Late Minutes", "number"),
    col("worksite", "Worksite"),
    col("no_clock_out_yesterday", "No Clock-Out Yesterday"),
  ],
  read: async (db, reader, filters, page, at) =>
    roster.page(
      db,
      { date: await rosterDate(db, filters, at), statuses: filters.roster_statuses, department_id: filters.department_id },
      reader.scope,
      { page },
    ),
  row: (r) => ({
    employee: `${r.first_name} ${r.last_name}`.trim(),
    job_title: r.job_title,
    department: r.department,
    status: words(r.status),
    clock_in_at: r.clock_in_at,
    clock_out_at: r.clock_out_at,
    late_minutes: r.late_minutes,
    worksite: r.worksite,
    no_clock_out_yesterday: r.no_clock_out_yesterday ? "Yes" : null,
  }),
};

const leaveRequests = {
  label: "Leave",
  capabilities: null,
  columns: [
    col("employee", "Employee"),
    col("department", "Department"),
    col("leave_type", "Leave Type"),
    col("starts_on", "From", "date"),
    col("ends_on", "To", "date"),
    col("days", "Days", "number"),
    col("status", "Status"),
    col("waiting_on", "Waiting On"),
    col("submitted_at", "Submitted", "datetime"),
  ],
  read: (_db, reader, filters, page) =>
    leave.list({ status: filters.leave_status, leave_type_id: filters.leave_type_id, page }, reader.scope),
  row: (r) => ({
    employee: r.employee.display_name,
    department: r.employee.department,
    leave_type: r.leave_type_name,
    starts_on: r.starts_on,
    ends_on: r.ends_on,
    days: r.days,
    status: words(r.status),
    waiting_on: r.waiting_on,
    submitted_at: r.submitted_at,
  }),
};

/** An alert's Over By as the Alerts tab words it: "+1", "12 days left", or Expired. */
function overBy(r) {
  if (r.over_by === null || r.over_by === undefined) return null;
  const n = Number(r.over_by); // @money:ok how far past an alert rule, a count or days, not an amount
  if (r.over_by_kind === "days_left") return n <= 0 ? "Expired" : `${days(n)} left`;
  return `+${n}`;
}

const openAlerts = {
  label: "Open Alerts",
  // The Alerts tab's own gate: whoever may clear alerts or manage their rules.
  capabilities: ["alerts.clear", "alerts.manage"],
  columns: [
    col("title", "Alert"),
    col("trigger", "Trigger"),
    col("rule", "Rule"),
    col("severity", "Severity"),
    col("over_by", "Over By"),
    col("raised_at", "Raised", "datetime"),
    col("who_can_clear", "Who Can Clear"),
  ],
  read: (_db, reader, filters, page, at) =>
    alerts.list(
      reader.user,
      { state: "open", category: filters.category, severity: filters.severity, page },
      { now: at },
    ),
  row: (r) => ({
    title: r.title,
    trigger: r.trigger,
    rule: r.rule_name,
    severity: words(r.severity),
    over_by: overBy(r),
    raised_at: r.raised_at,
    who_can_clear: r.who_can_clear,
  }),
};

const headcount = {
  label: "Headcount",
  capabilities: null,
  columns: [
    col("staff_number", "Staff ID"),
    col("employee", "Employee"),
    col("job_title", "Job Title"),
    col("department", "Department"),
    col("line_manager", "Line Manager"),
    col("employment_type", "Employment Type"),
    col("work_pattern", "Work Pattern"),
    col("start_date", "Start Date", "date"),
    col("confirmed_on", "Confirmed", "date"),
  ],
  read: (db, reader, filters, page) =>
    organisation.list(db, { status: "active", department_id: filters.department_id, page }, reader.scope),
  row: (r) => ({
    staff_number: r.staff_number,
    employee: r.display_name,
    job_title: r.job_title,
    department: r.department,
    line_manager: r.line_manager ? r.line_manager.display_name : null,
    employment_type: words(r.employment_type),
    work_pattern: words(r.work_pattern),
    start_date: r.start_date,
    confirmed_on: r.confirmed_on,
  }),
};

/* ------------------------------------------------------------------ *
 * The forward sources: a KPI card's records
 * ------------------------------------------------------------------ */

/** A KPI card's cell as a value its column formats (packages/contract HomeKpiCell). */
function cellValue(cell) {
  if (!cell) return null;
  switch (cell.kind) {
    case "text":
    case "pill":
      return cell.text;
    case "person":
      return cell.person.display_name;
    case "money":
      return cell.amount;
    case "date":
      return cell.date;
    case "time":
      return cell.at;
    case "number":
      return cell.value;
    default:
      return null;
  }
}

/**
 * A source that is the records behind a KPI card, read as the card's own list reads them,
 * in the reader's scope on the card's module. `columns` are the card's, with the kind each
 * one is formatted as.
 */
function cardSource(cardId, label, columns) {
  return {
    label,
    capabilities: null,
    card: cardId,
    columns,
    read: (db, reader, _filters, page, at) => {
      const entry = kpi.BY_ID.get(cardId);
      const ctx = kpi.context({ user: reader.user, scopes: new Map([[entry.module, reader.scope]]), now: at });
      return kpi.detailPage(entry, db, { page }, ctx);
    },
    row: (record) => Object.fromEntries(columns.map((column) => [column.key, cellValue(record.cells[column.key])])),
  };
}

const tasks = cardSource("tasks_overdue", "Overdue Tasks", [
  col("task", "Task"),
  col("assignee", "Assignee"),
  col("due", "Due", "datetime"),
  col("priority", "Priority"),
]);

const partnerships = cardSource("partnerships_active", "Active Partnerships", [
  col("partner", "Partner"),
  col("type", "Type"),
  col("owner", "Owner"),
  col("last_contact", "Last Contact", "datetime"),
]);

const expenses = cardSource("expenses_pending", "Expenses Awaiting Approval", [
  col("request", "Request"),
  col("employee", "Employee"),
  col("purpose", "Purpose"),
  col("category", "Category"),
  col("amount", "Amount", "money"),
  col("submitted", "Submitted", "datetime"),
]);

const recruitment = cardSource("vacancies_open", "Open Vacancies", [
  col("vacancy", "Vacancy"),
  col("department", "Department"),
  col("hiring_manager", "Hiring Manager"),
  col("positions", "Positions", "number"),
  col("closes", "Closes", "date"),
]);

/* ------------------------------------------------------------------ *
 * The Overview Export
 * ------------------------------------------------------------------ */

const table = (title, columns, rows) => ({ title, columns, rows, total: rows.length });

const CARD_COLUMNS = [col("card", "Card"), col("figure", "Figure"), col("caption", "Note")];

/** A card's figure as the Overview draws it. */
function figureOf(card) {
  if (!card.measurable) return null;
  switch (card.unit) {
    case "money":
      return money.formatNaira(card.amount);
    case "pct":
      return `${card.value}%`;
    case "pair":
      return `${card.value} of ${card.denominator}`;
    default:
      return card.value;
  }
}

const GOAL_COLUMNS = [col("goal", "Goal"), col("progress", "Progress %", "number"), col("due_on", "Due", "date")];
const goalRow = (g) => ({ goal: g.title, progress: g.progress, due_on: g.due_on });

/** The chart beside the cards, by kind. */
function chartTable(chart) {
  if (chart.kind === "attendance_days")
    return table(
      "Attendance, 14 Working Days",
      [col("date", "Date", "date"), col("present", "Present", "number"), col("expected", "Expected", "number")],
      chart.days.map((d) => ({ date: d.date, present: d.present, expected: d.expected })),
    );
  if (chart.kind === "goals")
    return table(
      "Organisational Goals",
      [col("goal", "Goal"), col("progress", "Progress %", "number")],
      chart.goals.map((g) => ({ goal: g.title, progress: g.progress })),
    );
  return table(
    "Monthly Signed Value",
    [col("month", "Month"), col("amount", "Signed Value", "money")],
    chart.months.map((m) => ({ month: formatMonth(`${m.month}-01`), amount: m.amount })),
  );
}

/** The donut beside the chart, by kind. */
function donutTable(donut) {
  if (donut.kind === "on_time")
    return table(
      "On Time This Month",
      [col("on_time", "On Time", "number"), col("late", "Late", "number"), col("absent", "Absent", "number")],
      [{ on_time: donut.on_time, late: donut.late, absent: donut.absent }],
    );
  return table(
    "Org KPI",
    [col("department", "Department"), col("percent", "Score %", "number")],
    donut.departments.map((d) => ({ department: d.department, percent: d.percent })),
  );
}

/** Minutes as hours to two places: 450 → 7.5. */
const hours = (minutes) => Math.round((minutes / 60) * 100) / 100;

/** What an event on Activity Today says, as its module declared it. */
const whatHappened = (key) => (catalogue.has(key) ? catalogue.get(key).summary : key);

/**
 * The reader's own Overview (HomeOverview) as it is drawn for them at `at`.
 * @param {{query: Function}} _db
 * @param {{user: object}} reader
 * @param {Date} at
 */
const overviewSnapshot = (_db, reader, at) => dashboard.overview(reader.user, { now: at });

/**
 * An Overview as a file draws it: the greeting and its headline figures, then the cards and
 * every part the reader's Home view draws, each a table. A part that is null is not drawn on
 * the screen and is left out here too.
 * @param {object} o  a HomeOverview
 */
function overviewTables(o) {
  const lines = [`Hello ${o.greeting_name}. This is your Home on ${formatLongDate(o.date)}.`];
  if (o.clocked_in) lines.push(`Clocked in today: ${o.clocked_in.present} of ${o.clocked_in.expected}.`);
  if (o.alerts_to_clear !== null) lines.push(`Alerts you may clear: ${o.alerts_to_clear}.`);
  if (o.pipeline) lines.push(`Partners with no contact in 30 days: ${o.pipeline.quiet_30d}.`);
  if (o.upcoming_leave && o.upcoming_leave.balance)
    lines.push(`${o.upcoming_leave.balance.name} left this year: ${days(o.upcoming_leave.balance.remaining)}.`);

  const tables = [
    table(
      "Cards",
      CARD_COLUMNS,
      o.cards.map((card) => ({ card: card.title, figure: figureOf(card), caption: card.caption })),
    ),
  ];
  if (o.day_strip) {
    const d = o.day_strip;
    tables.push(
      table(
        "Shift Today",
        [
          col("shift", "Shift"),
          col("clock_in_at", "Clock-In", "datetime"),
          col("clock_out_at", "Clock-Out", "datetime"),
          col("status", "Status"),
          col("worksite", "Worksite"),
          col("hours", "Hours Today", "number"),
        ],
        [
          {
            shift: d.starts_at ? `${d.starts_at} to ${d.ends_at}` : "Day Off",
            clock_in_at: d.clock_in_at,
            clock_out_at: d.clock_out_at,
            status: words(d.status),
            worksite: d.worksite,
            hours: d.clock_out_at ? hours(d.worked_minutes) : null,
          },
        ],
      ),
    );
  }
  if (o.chart) tables.push(chartTable(o.chart));
  if (o.donut) tables.push(donutTable(o.donut));
  if (o.pipeline)
    tables.push(
      table(
        "Partnership Pipeline",
        [col("stage", "Stage"), col("open", "Open", "number")],
        o.pipeline.stages.map((s) => ({ stage: s.label, open: s.open })),
      ),
    );
  if (o.goals) tables.push(table("Goals This Quarter", GOAL_COLUMNS, o.goals.map(goalRow)));
  if (o.my_goals) tables.push(table("My Goals This Quarter", GOAL_COLUMNS, o.my_goals.map(goalRow)));
  if (o.upcoming_leave)
    tables.push(
      table(
        "Upcoming Leave",
        [
          col("leave_type", "Leave Type"),
          col("starts_on", "From", "date"),
          col("ends_on", "To", "date"),
          col("days", "Days", "number"),
          col("status", "Status"),
        ],
        o.upcoming_leave.requests.map((r) => ({
          leave_type: r.leave_type_name,
          starts_on: r.starts_on,
          ends_on: r.ends_on,
          days: r.days,
          status: words(r.status),
        })),
      ),
    );
  if (o.activity)
    tables.push(
      table(
        "Activity Today",
        [col("at", "When", "datetime"), col("what", "What"), col("by", "By"), col("about", "About")],
        o.activity.map((a) => ({ at: a.occurred_at, what: whatHappened(a.event_key), by: a.actor_name, about: a.subject })),
      ),
    );
  if (o.week)
    tables.push(
      table(
        "Your Week",
        [col("date", "Date", "date"), col("hours", "Hours"), col("on_leave", "On Leave"), col("items", "Due")],
        o.week.map((day) => ({
          date: day.date,
          hours: day.holiday || (day.starts_at ? `${day.starts_at} to ${day.ends_at}` : null),
          on_leave: day.on_leave ? "Yes" : null,
          items: day.items.length ? day.items.map((i) => i.title).join("; ") : null,
        })),
      ),
    );
  return { lines, tables };
}

const overview = {
  label: "Overview",
  capabilities: null,
  snapshot: overviewSnapshot,
  tables: overviewTables,
};

/* ------------------------------------------------------------------ *
 * The registry
 * ------------------------------------------------------------------ */

const BUILT = {
  daily_attendance: dailyAttendance,
  leave: leaveRequests,
  open_alerts: openAlerts,
  headcount,
  tasks,
  partnerships,
  expenses,
  recruitment,
  overview,
};

/** Each source, its contract half (module, filters, offered) beside how it is read. */
const SOURCES = Object.freeze(
  Object.fromEntries(
    Object.entries(c.reports.HOME_REPORT_SOURCES).map(([key, declared]) => {
      const built = BUILT[key];
      if (!built) throw new Error(`reports.sources: "${key}" is in the contract and not built here`);
      return [
        key,
        Object.freeze({
          key,
          module: declared.module,
          filters: declared.filters,
          offered: declared.offered,
          ...built,
          columns: built.columns ? Object.freeze(built.columns) : null,
        }),
      ];
    }),
  ),
);

/** Fails the require on a source that is half defined, as the KPI catalogue does. */
function assertSources() {
  const problems = [];
  for (const key of Object.keys(BUILT))
    if (!SOURCES[key]) problems.push(`"${key}" is built here and not in the contract`);
  for (const s of Object.values(SOURCES)) {
    if (s.snapshot) {
      if (typeof s.tables !== "function") problems.push(`${s.key}: a snapshot needs its tables`);
      continue;
    }
    if (typeof s.read !== "function" || typeof s.row !== "function") problems.push(`${s.key}: read and row`);
    if (!s.columns || !s.columns.length) problems.push(`${s.key}: no columns`);
    for (const column of s.columns || [])
      if (!KINDS.includes(column.kind)) problems.push(`${s.key}.${column.key}: kind "${column.kind}"`);
    if (s.card) {
      const entry = kpi.BY_ID.get(s.card);
      // The card's records are read in its module's scope alone: no capability, no masked field.
      if (!entry || entry.status !== "live" || entry.module !== s.module || entry.capability || entry.sensitive_field)
        problems.push(`${s.key}: "${s.card}" must be a live ${s.module} card with no capability or sensitive field`);
    }
  }
  if (problems.length) throw new Error(`reports.sources:\n  ${problems.join("\n  ")}`);
}

assertSources();

/* ------------------------------------------------------------------ *
 * Who may read a source
 * ------------------------------------------------------------------ */

/**
 * The person's scope on a source's module, when they may open the source: its module's
 * `view` grant (rbac.scopeFor, as a route checks it) and, for a source whose screen a
 * capability opens, one of those capabilities. The CEO opens every source.
 * @param {{query: Function}} db
 * @param {{user_id: string, employee_id: string|null, role_ids: string[], is_ceo?: boolean}} user
 * @param {string} key  a source key
 * @returns {Promise<{scope: string, scope_ids: string[]|null, employee_id: string|null}|null>}
 */
async function scopeOn(db, user, key) {
  const source = SOURCES[key];
  if (!source || !user) return null;
  const scope = await rbac.scopeFor(user, source.module, "view");
  if (!scope) return null;
  if (!source.capabilities || user.is_ceo === true) return scope;
  const held = await grantsCache.getCapabilities(db, user.user_id);
  return source.capabilities.some((code) => held.includes(code)) ? scope : null;
}

/**
 * The sources a person may open, in the registry's order.
 * @returns {Promise<string[]>}
 */
async function openTo(db, user) {
  const keys = Object.keys(SOURCES);
  const open = [];
  // One after the other: `db` may be a transaction's client, which runs one query at a time.
  for (const key of keys) if (await scopeOn(db, user, key)) open.push(key);
  return open;
}

/* ------------------------------------------------------------------ *
 * Gathering a report as its reader
 * ------------------------------------------------------------------ */

/** Every page of a read, up to the ceiling, and how many rows the source holds. */
async function allPages(read) {
  const rows = [];
  let page = await read(1);
  rows.push(...page.data);
  while (page.page.has_next && rows.length < ROW_CEILING) {
    page = await read(page.page.number + 1);
    rows.push(...page.data);
  }
  return { rows: rows.slice(0, ROW_CEILING), total: page.page.total };
}

/**
 * The filters as a person reads them on the file ("Status: Late"). Ids are named by what
 * they are, read from the rows when they say it; a filter is shown even when it matched none.
 * @param {string} key
 * @param {object} filters  saved_report.definition.filters
 * Daily Attendance always names its day, with the date it read when the caller knows it.
 * @param {{departmentName?: string|null, leaveTypeName?: string|null, rosterOn?: string|null}} [names]
 */
function describeFilters(key, filters, { departmentName = null, leaveTypeName = null, rosterOn = null } = {}) {
  const out = [];
  const f = filters || {};
  if (key === "daily_attendance") {
    const day = f.roster_day === "last_working_day" ? "Last Working Day" : "Today So Far";
    out.push({ label: "Day", value: rosterOn ? `${day}, ${formatDate(rosterOn)}` : day });
  }
  if (f.department_id) out.push({ label: "Department", value: departmentName || "One department" });
  if (f.roster_statuses) out.push({ label: "Status", value: f.roster_statuses.map(words).join(", ") });
  if (f.leave_status) out.push({ label: "Status", value: words(f.leave_status) });
  if (f.leave_type_id) out.push({ label: "Leave Type", value: leaveTypeName || "One leave type" });
  if (f.category) out.push({ label: "Category", value: words(f.category) });
  if (f.severity) out.push({ label: "Severity", value: words(f.severity) });
  return out;
}

/**
 * A report's rows as `user` may see them, at `at`: one table for a source, a table for each
 * part of an Overview. Read through the source's own query in the person's scope, then put
 * through their field mask, so a file never holds what their screen would not show.
 *
 * The caller has checked that the person may open the source (scopeOn); a source they cannot
 * open is an error here, not an empty file.
 * @param {{query: Function}} db
 * @param {object} user  grants-cache getAuthUser
 * @param {string} key  a source key
 * @param {object} filters  saved_report.definition.filters
 * @param {{at: Date}} when  the moment the report describes
 * @returns {Promise<{lines: string[], tables: Array<{title: string, columns: object[], rows: object[], total: number}>}>}
 */
async function gather(db, user, key, filters, { at }) {
  const source = SOURCES[key];
  if (!source) throw new Error(`reports.sources: no source "${key}"`);
  const scope = await scopeOn(db, user, key);
  if (!scope) throw new Error(`reports.sources: ${user.user_id} may not open "${key}"`);
  const masked = await fieldMask.maskedKeysFor(db, user);
  const reader = { user, scope };
  if (source.snapshot) return source.tables(fieldMask.maskData(await source.snapshot(db, reader, at), masked));

  const { rows, total } = await allPages(async (n) => {
    const page = await source.read(db, reader, filters || {}, n, at);
    return { ...page, data: fieldMask.maskData(page.data, masked) };
  });
  return { lines: [], tables: [{ title: source.label, columns: source.columns, rows: rows.map(source.row), total }] };
}

module.exports = {
  ROW_CEILING,
  KINDS,
  SOURCES,
  words,
  cellValue,
  scopeOn,
  openTo,
  gather,
  rosterDate,
  describeFilters,
};
