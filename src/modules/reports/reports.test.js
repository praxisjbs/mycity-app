"use strict";
/**
 * Home · Reports without a database (docs/guides/home.md §5, §6 Reports, §7, §9): the source
 * registry against the contract, when a schedule fires in Lagos, how a report and a run read
 * on the wire, the file's cells and templates, the routes and their checks, the jobs, the
 * assistant and ⌘K. Who sees what, the writes, the generation as the recipient and the
 * scheduler run against the real migrations in tests/integration/home-reports.test.js.
 */
const c = require("@mycity/contract");
const catalogue = require("../../shared/events/catalogue");
const outbox = require("../../shared/events/outbox");
const lagos = require("../../shared/time/lagos");
const workingWeek = require("../../shared/time/working-week");
const render = require("../../shared/documents/render");
const store = require("../../shared/templates/template-store");
const variables = require("../../shared/templates/variables");
const docTypes = require("../../shared/documents/types");
const kpi = require("../dashboard/kpi-catalog");
const sources = require("./reports.sources");
const schedule = require("./reports.schedule");
const files = require("./reports.files");
const service = require("./reports.service");
const { EVENTS, DOC_TYPE } = require("./reports.events");

const { reports: contract } = c;
const ID = "8a6e0804-2bd0-4672-b79d-d97027f9071a";
const OTHER = "1d2b9f3c-6a4e-4f0b-9a51-7c2d8e0f3a14";

/** MyCity's week: Monday to Saturday, Saturday a half day; 01/10 Independence Day. */
const CALENDAR = workingWeek.makeCalendar({
  days: [1, 2, 3, 4, 5, 6],
  holidays: [{ holiday_date: "2026-10-01", name: "Independence Day" }],
});

/** The Lagos wall clock of a slot, "2026-10-19 18:00". */
const wall = (at) => (at ? `${lagos.dateOf(at)} ${lagos.timeOf(at)}` : null);

/* ------------------------------------------------------------------ *
 * The sources
 * ------------------------------------------------------------------ */

describe("the source registry", () => {
  test("is the contract's list: the same keys in the same order, each with its module and filters", () => {
    expect(Object.keys(sources.SOURCES)).toEqual(Object.keys(contract.HOME_REPORT_SOURCES));
    expect(Object.keys(sources.SOURCES)).toEqual(contract.HomeReportSource.options);
    for (const [key, declared] of Object.entries(contract.HOME_REPORT_SOURCES))
      expect([key, sources.SOURCES[key]]).toEqual([key, expect.objectContaining({ key, ...declared })]);
  });

  test("each source on the form has a name, its columns Title Case and of a kind a file formats", () => {
    for (const s of Object.values(sources.SOURCES).filter((x) => x.offered)) {
      expect(typeof s.label).toBe("string");
      expect(typeof s.read).toBe("function");
      for (const col of s.columns) {
        expect([s.key, col.kind]).toEqual([s.key, expect.stringMatching(/^(text|date|datetime|number|money)$/)]);
        expect([s.key, col.header]).toEqual([s.key, expect.stringMatching(/^[A-Z][A-Za-z%-]*( [A-Z][A-Za-z%-]*)*$/)]);
      }
    }
  });

  test("the forward sources are their KPI card's records, column for column, in the card's module", () => {
    for (const key of ["tasks", "partnerships", "expenses", "recruitment"]) {
      const s = sources.SOURCES[key];
      const card = kpi.BY_ID.get(s.card);
      expect([key, card.status, card.module, card.capability, card.sensitive_field]).toEqual([
        key,
        "live",
        s.module,
        null,
        null,
      ]);
      expect(s.columns.map((col) => col.key)).toEqual(card.detail.columns.map((col) => col.key));
      expect(s.filters).toEqual([]);
    }
    expect(sources.SOURCES.expenses.columns.find((col) => col.key === "amount").kind).toBe("money");
  });

  test("Open Alerts is opened by the Alerts tab's capabilities; the Overview is never on the form", () => {
    expect(sources.SOURCES.open_alerts.capabilities).toEqual(["alerts.clear", "alerts.manage"]);
    expect(sources.SOURCES.overview).toMatchObject({ offered: false, module: "home" });
    expect(typeof sources.SOURCES.overview.snapshot).toBe("function");
  });

  test("Workspace Analytics is a personal export: never on the form, opened by the workspace export grant", () => {
    expect(sources.SOURCES.workspace_analytics).toMatchObject({ offered: false, module: "workspace", action: "export" });
    expect(typeof sources.SOURCES.workspace_analytics.snapshot).toBe("function");
    const at = new Date("2026-10-27T10:00:00+01:00");
    expect(sources.analyticsDays({ analytics_period: "week" }, at)).toEqual({ from: "2026-10-26", to: "2026-10-27" });
    expect(sources.analyticsDays({}, at)).toEqual({ from: "2026-09-28", to: "2026-10-27" });
    expect(
      sources.describeFilters(
        "workspace_analytics",
        { task_scope: "team", analytics_period: "custom", period_from: "2026-10-01", period_to: "2026-10-20" },
        { analyticsOn: { from: "2026-10-01", to: "2026-10-20" } },
      ),
    ).toEqual([
      { label: "Whose Work", value: "My Team" },
      { label: "Period", value: "Custom, 01/10/2026 to 20/10/2026" },
    ]);
  });

  test("a card's cell becomes the value its column formats", () => {
    const person = { employee_id: ID, display_name: "Ada Obi", job_title: null, department: null };
    expect(sources.cellValue({ kind: "person", person })).toBe("Ada Obi");
    expect(sources.cellValue({ kind: "money", amount: "1250.00" })).toBe("1250.00");
    expect(sources.cellValue({ kind: "text", text: "USD 40.00" })).toBe("USD 40.00");
    expect(sources.cellValue({ kind: "date", date: "2026-10-18" })).toBe("2026-10-18");
    expect(sources.cellValue({ kind: "number", value: 3 })).toBe(3);
    expect(sources.cellValue(null)).toBeNull();
  });

  test("a report's filters read as words on the file", () => {
    expect(sources.describeFilters("daily_attendance", { roster_statuses: ["not_in", "late"], department_id: ID }, {
      departmentName: "Programmes",
    })).toEqual([
      { label: "Day", value: "Today So Far" },
      { label: "Department", value: "Programmes" },
      { label: "Status", value: "Not In, Late" },
    ]);
    expect(sources.describeFilters("daily_attendance", { roster_day: "last_working_day" }, { rosterOn: "2026-10-17" })).toEqual([
      { label: "Day", value: "Last Working Day, 17/10/2026" },
    ]);
    expect(sources.describeFilters("open_alerts", { category: "attendance", severity: "high" })).toEqual([
      { label: "Category", value: "Attendance" },
      { label: "Severity", value: "High" },
    ]);
    expect(sources.describeFilters("headcount", {})).toEqual([]);
  });
});

/** The header of a file, for the tests that build one. */
const META = Object.freeze({
  report_name: "Late Today",
  run_number: "RPT-0042",
  source: "Daily Attendance",
  recipient_name: "Kemi Alade",
  as_at: lagos.instant("2026-10-19", "18:00"),
  filters: [{ label: "Status", value: "Late" }],
});

describe("gathering a report as its reader", () => {
  // The CEO's scope is `all` and nothing is masked for them, so no database is read here.
  const CEO = { user_id: ID, employee_id: OTHER, role_ids: [], is_ceo: true, status: "active" };
  const roster = require("../attendance/attendance.roster");

  afterEach(() => jest.restoreAllMocks());

  test("reads its screen's own query a page at a time, stops at the ceiling and says how many there were", async () => {
    const total = sources.ROW_CEILING + 60;
    const asked = [];
    jest.spyOn(roster, "page").mockImplementation(async (_db, filters, scope, query) => {
      asked.push({ filters, scope: scope.scope, page: query.page });
      const first = (query.page - 1) * 25;
      return {
        data: Array.from({ length: 25 }, (_, i) => ({
          first_name: "Person",
          last_name: String(first + i + 1),
          status: "late",
          late_minutes: 12,
          no_clock_out_yesterday: false,
        })),
        page: { number: query.page, size: 25, total, pages: Math.ceil(total / 25), has_next: first + 25 < total },
      };
    });
    const at = lagos.instant("2026-10-19", "18:00");
    const out = await sources.gather({}, CEO, "daily_attendance", { roster_statuses: ["late"] }, { at });

    expect(asked).toHaveLength(sources.ROW_CEILING / 25);
    expect(asked[0]).toEqual({ filters: { date: "2026-10-19", statuses: ["late"], department_id: undefined }, scope: "all", page: 1 });
    expect(out.lines).toEqual([]);
    expect(out.tables).toHaveLength(1);
    const [t] = out.tables;
    expect([t.title, t.rows.length, t.total]).toEqual(["Daily Attendance", sources.ROW_CEILING, total]);
    expect(t.rows[0]).toMatchObject({ employee: "Person 1", status: "Late", late_minutes: 12, no_clock_out_yesterday: null });
    expect(files.documentVars(META, out).tables[0].note).toBe("Showing the first 2,000 of 2,060 rows.");
  });

  test("a source with fewer rows than the ceiling is read whole, in as many pages as it has", async () => {
    jest.spyOn(roster, "page").mockImplementation(async (_db, _filters, _scope, query) => ({
      data: query.page === 1 ? [{ first_name: "Ada", last_name: "Obi", status: "on_site" }] : [],
      page: { number: query.page, size: 25, total: 1, pages: 1, has_next: false },
    }));
    const out = await sources.gather({}, CEO, "daily_attendance", {}, { at: new Date() });
    expect(roster.page).toHaveBeenCalledTimes(1);
    expect(out.tables[0]).toMatchObject({ total: 1, rows: [expect.objectContaining({ employee: "Ada Obi", status: "On Site" })] });
  });

  test("Daily Attendance on the last working day reads the closed day before: Saturday on a Monday, past a holiday", async () => {
    const days = [];
    jest.spyOn(workingWeek, "loadCalendar").mockResolvedValue(CALENDAR);
    jest.spyOn(roster, "page").mockImplementation(async (_db, filters) => {
      days.push(filters.date);
      return { data: [], page: { number: 1, size: 25, total: 0, pages: 0, has_next: false } };
    });
    const last = { roster_day: "last_working_day", roster_statuses: ["absent"] };
    await sources.gather({}, CEO, "daily_attendance", last, { at: lagos.instant("2026-10-19", "18:00") });
    await sources.gather({}, CEO, "daily_attendance", last, { at: lagos.instant("2026-10-02", "18:00") });
    await sources.gather({}, CEO, "daily_attendance", { roster_day: "today" }, { at: lagos.instant("2026-10-19", "18:00") });
    expect(days).toEqual(["2026-10-17", "2026-09-30", "2026-10-19"]);
  });
});

/* ------------------------------------------------------------------ *
 * When a schedule fires
 * ------------------------------------------------------------------ */

describe("a schedule's next slot, in Lagos", () => {
  const daily = { recurrence: { freq: "daily" }, starts_on: "2026-10-12", run_time: "18:00" };

  test("is the run time in Lagos: 18:00 there is 17:00 UTC", () => {
    const next = schedule.nextSlot(daily, new Date("2026-10-14T08:00:00Z"), CALENDAR);
    expect(next.toISOString()).toBe("2026-10-14T17:00:00.000Z");
  });

  test("is tomorrow's once today's has passed, and never the instant it is asked at", () => {
    expect(wall(schedule.nextSlot(daily, lagos.instant("2026-10-14", "18:30"), CALENDAR))).toBe("2026-10-15 18:00");
    expect(wall(schedule.nextSlot(daily, lagos.instant("2026-10-14", "18:00"), CALENDAR))).toBe("2026-10-15 18:00");
    expect(wall(schedule.nextSlot(daily, lagos.instant("2026-10-14", "17:59"), CALENDAR))).toBe("2026-10-14 18:00");
  });

  test("waits for its start day", () => {
    const later = { ...daily, starts_on: "2026-11-02" };
    expect(wall(schedule.nextSlot(later, lagos.instant("2026-10-14", "09:00"), CALENDAR))).toBe("2026-11-02 18:00");
  });

  test("working days only: a Sunday and a public holiday are skipped, a Saturday is worked", () => {
    const working = { ...daily, recurrence: { freq: "daily", working_days_only: true }, starts_on: "2026-09-01" };
    expect(wall(schedule.nextSlot(working, lagos.instant("2026-10-17", "19:00"), CALENDAR))).toBe("2026-10-19 18:00");
    expect(wall(schedule.nextSlot(working, lagos.instant("2026-10-16", "19:00"), CALENDAR))).toBe("2026-10-17 18:00");
    expect(wall(schedule.nextSlot(working, lagos.instant("2026-09-30", "19:00"), CALENDAR))).toBe("2026-10-02 18:00");
  });

  test("weekly on its days, every other week when its interval says so", () => {
    const weekly = { recurrence: { freq: "weekly", by_weekday: [1, 5] }, starts_on: "2026-10-12", run_time: "08:30" };
    expect(wall(schedule.nextSlot(weekly, lagos.instant("2026-10-13", "09:00"), CALENDAR))).toBe("2026-10-16 08:30");
    expect(wall(schedule.nextSlot(weekly, lagos.instant("2026-10-16", "09:00"), CALENDAR))).toBe("2026-10-19 08:30");
    const fortnightly = { ...weekly, recurrence: { freq: "weekly", interval: 2, by_weekday: [1] } };
    expect(wall(schedule.nextSlot(fortnightly, lagos.instant("2026-10-12", "09:00"), CALENDAR))).toBe("2026-10-26 08:30");
  });

  test("monthly on the 31st or the last day fires on each month's last day", () => {
    const on31 = { recurrence: { freq: "monthly", by_month_day: 31 }, starts_on: "2026-01-01", run_time: "17:00" };
    expect(wall(schedule.nextSlot(on31, lagos.instant("2027-02-01", "09:00"), CALENDAR))).toBe("2027-02-28 17:00");
    expect(wall(schedule.nextSlot(on31, lagos.instant("2028-02-01", "09:00"), CALENDAR))).toBe("2028-02-29 17:00");
    expect(wall(schedule.nextSlot(on31, lagos.instant("2026-04-01", "09:00"), CALENDAR))).toBe("2026-04-30 17:00");
    const last = { ...on31, recurrence: { freq: "monthly", by_month_day: -1 } };
    expect(wall(schedule.nextSlot(last, lagos.instant("2026-11-30", "17:30"), CALENDAR))).toBe("2026-12-31 17:00");
  });

  test("monthly on working days only: a day off moves to the next working day", () => {
    // 31/05/2026 is a Sunday, so the last day of May is sent on Monday 01/06.
    const last = { recurrence: { freq: "monthly", by_month_day: -1, working_days_only: true }, starts_on: "2026-01-01", run_time: "17:00" };
    expect(wall(schedule.nextSlot(last, lagos.instant("2026-05-20", "09:00"), CALENDAR))).toBe("2026-06-01 17:00");
  });

  test("a rule the shared engine refuses is named for the form", () => {
    expect(schedule.problems({ freq: "daily" })).toEqual([]);
    expect(schedule.problems({ freq: "weekly", by_month_day: 3 })).toEqual(["by_month_day is for monthly rules"]);
  });
});

/* ------------------------------------------------------------------ *
 * On the wire
 * ------------------------------------------------------------------ */

describe("a report and a run on the wire", () => {
  const owner = { user: { user_id: ID }, ceo: false };
  const row = (over = {}) => ({
    saved_report_id: OTHER,
    name: "Daily Attendance",
    report_key: "daily_attendance",
    definition: { filters: { roster_statuses: ["late"] } },
    shared: true,
    owner_user_id: ID,
    owner_name: "Kemi Alade",
    archived_at: null,
    created_at: new Date("2026-10-18T08:00:00Z"),
    updated_at: new Date("2026-10-18T08:00:00Z"),
    report_schedule_id: null,
    recurrence: null,
    starts_on: null,
    run_time: null,
    formats: null,
    recipient_user_ids: null,
    active: null,
    last_run_at: null,
    next_run_at: null,
    audience: [],
    ...over,
  });
  const wire = (v) => JSON.parse(JSON.stringify(v));

  test("a report with no schedule runs on demand; its owner may change it, a reader who shares it may not", () => {
    const r = contract.HomeReport.parse(wire(service.present(row(), owner)));
    expect(r).toMatchObject({ status: "on_demand", schedule: null, can_edit: true, filters: { roster_statuses: ["late"] } });
    expect(service.present(row(), { user: { user_id: OTHER }, ceo: false }).can_edit).toBe(false);
    expect(service.present(row(), { user: { user_id: OTHER }, ceo: true }).can_edit).toBe(true);
  });

  test("a schedule running is Scheduled, a paused one Paused with no next slot", () => {
    const scheduled = row({
      report_schedule_id: ID,
      recurrence: { freq: "daily", working_days_only: true },
      starts_on: "2026-10-19",
      run_time: "18:00",
      formats: ["pdf", "xlsx"],
      recipient_user_ids: [ID],
      active: true,
      next_run_at: new Date("2026-10-19T17:00:00Z"),
      audience: [{ user_id: ID, display_name: "Kemi Alade", email: "kemi@mycity.test" }],
    });
    const on = contract.HomeReport.parse(wire(service.present(scheduled, owner)));
    expect(on).toMatchObject({ status: "scheduled", schedule: { run_time: "18:00", formats: ["pdf", "xlsx"], active: true } });
    const off = service.present({ ...scheduled, active: false, next_run_at: null }, owner);
    expect(off).toMatchObject({ status: "paused", schedule: { active: false, next_run_at: null } });
  });

  test("a run offers its file only once it is done", () => {
    const run = {
      home_report_run_id: ID,
      number: "RPT-0001",
      saved_report_id: OTHER,
      report_name: "Daily Attendance",
      report_key: "daily_attendance",
      report_schedule_id: null,
      scheduled_for: null,
      recipient_user_id: ID,
      recipient_name: "Kemi Alade",
      requested_by: ID,
      format: "pdf",
      status: "pending",
      document_id: OTHER,
      emailed_at: null,
      run_at: new Date("2026-10-18T08:00:00Z"),
      finished_at: null,
    };
    expect(contract.HomeReportRun.parse(wire(service.presentRun(run))).document_id).toBeNull();
    expect(service.presentRun({ ...run, status: "done" }).document_id).toBe(OTHER);
  });
});

/* ------------------------------------------------------------------ *
 * The file
 * ------------------------------------------------------------------ */

describe("the file", () => {
  const meta = META;
  const gathered = {
    lines: [],
    tables: [
      {
        title: "Daily Attendance",
        columns: [
          { key: "employee", header: "Employee", kind: "text" },
          { key: "day", header: "Day", kind: "date" },
          { key: "clock_in_at", header: "Clock-In", kind: "datetime" },
          { key: "late", header: "Late Minutes", kind: "number" },
          { key: "amount", header: "Amount", kind: "money" },
        ],
        rows: [
          { employee: "Musa Danjuma", day: "2026-10-19", clock_in_at: lagos.instant("2026-10-19", "09:42"), late: 42, amount: "1250000.00" },
          { employee: "Zainab Lawal", day: null, clock_in_at: null, late: 1500, amount: "USD 40.00" },
        ],
        total: 2400,
      },
    ],
  };

  test("dates are day-first, times Lagos, amounts Naira; another currency is said as it is", () => {
    expect(files.cellText("2026-10-19", "date")).toBe("19/10/2026");
    expect(files.cellText(lagos.instant("2026-10-19", "09:42"), "datetime")).toBe("19/10/2026 09:42");
    expect(files.cellText("1250000.00", "money")).toBe("₦1,250,000.00");
    expect(files.cellText("USD 40.00", "money")).toBe("USD 40.00");
    expect(files.cellText(1500, "number")).toBe("1,500");
    expect(files.cellText(null, "date")).toBe("");
  });

  test("the PDF's variables are the template's, and a table cut short says so", () => {
    const vars = contract.HomeReportDocumentVars.parse(files.documentVars(meta, gathered));
    expect(vars.as_at).toBe("2026-10-19T17:00:00.000Z");
    expect(vars.tables[0].columns.map((col) => [col.header, col.numeric])).toEqual([
      ["Employee", false],
      ["Day", false],
      ["Clock-In", false],
      ["Late Minutes", true],
      ["Amount", true],
    ]);
    expect(vars.tables[0].rows[0].cells.map((cell) => cell.text)).toEqual([
      "Musa Danjuma",
      "19/10/2026",
      "19/10/2026 09:42",
      "42",
      "₦1,250,000.00",
    ]);
    expect(vars.tables[0].note).toBe("Showing the first 2 of 2,400 rows.");
  });

  test("the PDF template names only its declared variables and prints the number, filters and rows", async () => {
    const template = store.shipped("document", "report");
    expect(() => variables.assertTemplate("document", "report", template.body)).not.toThrow();
    const html = render.render(template.body, files.documentVars(meta, gathered));
    expect(html).toContain("RPT-0042");
    expect(html).toContain("Status: Late");
    expect(html).toContain("<td class=\"amount\">₦1,250,000.00</td>");
    expect(html).toContain("Showing the first 2 of 2,400 rows.");
    expect(html).toContain("size: A4 landscape");
    const empty = render.render(template.body, files.documentVars(meta, { lines: ["Hello Ada."], tables: [{ ...gathered.tables[0], rows: [], total: 0 }] }));
    expect(empty).toContain("Nothing to show.");
    expect(empty).toContain("Hello Ada.");
  });

  test("the email names the report, its number and its format, and only declared variables", async () => {
    const template = store.shipped("email", "scheduled-report");
    expect(() => variables.assertTemplate("email", "scheduled-report", `${template.subject}\n${template.body}`)).not.toThrow();
    const data = contract.HomeReportEmailVars.parse({ report_name: "Late Today", run_number: "RPT-0042", format: "Excel" });
    expect(render.render(template.subject, data)).toBe("Late Today (RPT-0042)");
    expect(render.render(template.body, { ...data, recipient: { first_name: "Kemi" } })).toContain(
      "Your scheduled report, Late Today, is attached as Excel.",
    );
  });

  test("the workbook has a cover and a sheet a table, its money summable unless a row is in another currency", async () => {
    const ExcelJS = require("exceljs");
    const naira = { ...gathered.tables[0], rows: [gathered.tables[0].rows[0]], total: 1 };
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await files.workbook(meta, { lines: ["Hello Ada."], tables: [naira, { ...gathered.tables[0], title: "Mixed" }] }));
    expect(book.worksheets.map((ws) => ws.name)).toEqual(["Cover", "Summary", "Daily Attendance", "Mixed"]);
    expect(book.getWorksheet("Daily Attendance").getCell("E2").value).toBe(1250000);
    expect(book.getWorksheet("Mixed").getCell("E3").value).toBe("USD 40.00");
    expect(book.getWorksheet("Mixed").getCell("E2").value).toBe("₦1,250,000.00");
    const cover = book.getWorksheet("Cover");
    const text = [];
    cover.eachRow((r) => r.eachCell((cell) => text.push(String(cell.value))));
    expect(text).toEqual(expect.arrayContaining(["Late Today (RPT-0042)", "Kemi Alade"]));
    expect(text.join(" ")).toContain("Source = Daily Attendance, As At = 19/10/2026 18:00, Status = Late");
    expect(text.join(" ")).toContain("Rows = the first 2 of 2,400");
  });

  test("one document type for both formats, read by the module that owns reports, numbered by its run", () => {
    expect(DOC_TYPE).toBe("home_report");
    expect(docTypes.typeOf(DOC_TYPE)).toMatchObject({ module: "home", sensitivity: "personal", signable: false });
    const spec = require("../../shared/documents/generate").specOf(DOC_TYPE);
    expect(spec).toMatchObject({ template: "report", numbering: null, landscape: true });
  });
});

/* ------------------------------------------------------------------ *
 * The routes
 * ------------------------------------------------------------------ */

describe("the routes", () => {
  const { routesOf } = require("../../http/route");
  const routes = routesOf(require("./reports.routes").router);
  const find = (method, path) => routes.find((r) => r.method === method && r.path === path);

  test("mount at /home, each the contract's, literal paths before /:id", () => {
    expect(require("./reports.routes").basePath).toBe("/home");
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /reports",
      "GET /reports/summary",
      "GET /reports/:id",
      "POST /reports",
      "PATCH /reports/:id",
      "PATCH /reports/:id/schedule",
      "POST /reports/:id/archive",
      "POST /reports/:id/run",
      "GET /report-runs",
      "GET /report-runs/:id",
    ]);
    expect(find("GET", "/reports").contract).toMatchObject({ query: contract.HomeReportQuery, response: contract.HomeReportPage });
    expect(find("POST", "/reports").contract).toMatchObject({ body: contract.HomeReportCreate, response: contract.HomeReport });
    expect(find("PATCH", "/reports/:id").contract.body).toBe(contract.HomeReportUpdate);
    expect(find("PATCH", "/reports/:id/schedule").contract.body).toBe(contract.HomeReportScheduleState);
    expect(find("POST", "/reports/:id/archive").contract.body).toBe(c.common.EmptyBody);
    expect(find("POST", "/reports/:id/run").contract).toMatchObject({ body: contract.HomeReportRunNow, response: contract.HomeReportRun });
    expect(find("GET", "/report-runs").contract).toMatchObject({
      query: contract.HomeReportRunQuery,
      response: contract.HomeReportRunPage,
    });
    expect(find("GET", "/report-runs/:id").contract).toMatchObject({ params: c.common.IdParams, response: contract.HomeReportRun });
  });

  test("every one behind `home` view and then `home.reports`", () => {
    for (const r of routes)
      expect([r.method, r.path, r.permission, r.capability]).toEqual([
        r.method,
        r.path,
        { key: "home", action: "view" },
        "home.reports",
      ]);
  });

  test("the Overview Export is the Overview's, behind `home` view alone", () => {
    const { routesOf: of } = require("../../http/route");
    const exported = of(require("../dashboard/dashboard.routes").router).find((r) => r.path === "/overview/export");
    expect(exported).toMatchObject({
      method: "POST",
      permission: { key: "home", action: "view" },
      capability: null,
      contract: { body: contract.HomeReportRunNow, response: contract.HomeReportRun },
    });
  });
});

/* ------------------------------------------------------------------ *
 * Events and jobs
 * ------------------------------------------------------------------ */

describe("events and jobs", () => {
  test("Home declares its report events, and builds each run's file after commit", () => {
    for (const key of Object.values(EVENTS)) expect(catalogue.get(key)).toMatchObject({ module: "home" });
    /* Sorted: other modules register on the document events too, in whatever order they load. */
    const byName = (a, b) => a.name.localeCompare(b.name);
    const handlers = outbox.registrations().filter((h) => h.name.startsWith("reports."));
    expect(handlers.sort(byName)).toEqual([
      { key: "document.render_failed", name: "reports.file-failed" },
      { key: "document.generated", name: "reports.file-ready" },
      { key: "home.report_run", name: "reports.generate" },
    ]);
  });

  test("the tick runs every five minutes in Lagos, its job one slot of one schedule", async () => {
    const registry = require("../../jobs/registry");
    const tick = registry.schedules().find((s) => s.name === "scheduled-reports");
    expect(tick).toMatchObject({ pattern: "*/5 * * * *", tz: "Africa/Lagos", inProcess: false });
    expect(registry.JOBS.find((j) => j.queue === "scheduled-report")).toBeTruthy();
    const handler = registry.handlerOf("scheduled-report");
    await expect(handler({ data: { report_schedule_id: "nope", slot: "2026-10-19T17:00:00Z" } })).rejects.toThrow(
      /needs report_schedule_id and its slot/,
    );
    await expect(handler({ data: { report_schedule_id: ID, slot: "soon" } })).rejects.toThrow(/its slot/);
  });
});

/* ------------------------------------------------------------------ *
 * The assistant and ⌘K
 * ------------------------------------------------------------------ */

describe("the assistant and ⌘K", () => {
  test("two reads, never a write, and routes to the tab", () => {
    const manifest = require("./reports.ai");
    expect(manifest.reads.map((r) => [r.key, r.permission])).toEqual([
      ["reports.mine", ["home", "view"]],
      ["runs.mine", ["home", "view"]],
    ]);
    expect(manifest.reads.map((r) => r.params)).toEqual([contract.HomeReportQuery, contract.HomeReportRunQuery]);
    expect(manifest.routes.every((r) => r.screen === "home.reports")).toBe(true);
  });

  test("a report opens on the tab by its id, a run by `?run=`", () => {
    const routeMap = require("../../shared/route-map");
    expect(routeMap.linkFor("home_report", ID).path).toBe(`/home?tab=reports&id=${ID}`);
    expect(routeMap.linkFor("home_report_run", ID).path).toBe(`/home?tab=reports&run=${ID}`);
    expect(require("./reports.search").map((p) => [p.type, p.module])).toEqual([
      ["home_report", "home"],
      ["home_report_run", "home"],
    ]);
  });

  test("New Report is a ⌘K action for the holders of `home.reports`", () => {
    const { ACTIONS, linkOf } = require("../../shared/search/actions");
    const action = ACTIONS.find((a) => a.label === "New Report");
    expect(action).toMatchObject({ need: ["home", "view"], capability: "home.reports" });
    expect(linkOf(action)).toBe("/home?tab=reports&action=new");
  });
});
