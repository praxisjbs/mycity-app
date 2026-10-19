"use strict";
/**
 * Home's contract (packages/contract/schemas/dashboard.js, alerts.js, reports.js): the
 * rules a form and the API both hold, the lists the code must repeat, and the lists that
 * must equal what the migrations check (docs/guides/home.md §4 to §6).
 */
const fs = require("node:fs");
const path = require("node:path");
const c = require("@mycity/contract");
const catalog = require("../../src/shared/access/access.catalog");
const recurrence = require("../../src/shared/time/recurrence");

const { dashboard, alerts, reports } = c;
const ID = "8a6e0804-2bd0-4672-b79d-d97027f9071a";
const OTHER = "1d3c5a7e-9b2f-4c6d-8e0a-2b4c6d8e0f1a";
const migration = fs.readFileSync(path.join(__dirname, "../../migrations/1150_home_foundation.sql"), "utf8");

/** The values a CHECK (<column> IN (...)) in 1150 allows. */
function checked(column) {
  const m = new RegExp(`${column} text NOT NULL[^,]*CHECK \\(${column} IN \\(([^)]*)\\)\\)`).exec(migration);
  if (!m) throw new Error(`no CHECK on ${column} in 1150`);
  return m[1].split(",").map((s) => s.trim().replace(/'/g, ""));
}

const issues = (result) => (result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));

describe("KPI cards", () => {
  test("a person picks up to four cards, each once, and may pick none", () => {
    expect(dashboard.HomeKpiPicks.safeParse({ kpi_ids: [] }).success).toBe(true);
    expect(dashboard.HomeKpiPicks.safeParse({ kpi_ids: ["headcount", "attendance_today"] }).success).toBe(true);
    expect(issues(dashboard.HomeKpiPicks.safeParse({ kpi_ids: ["a_1", "a_2", "a_3", "a_4", "a_5"] }))).toEqual([
      "kpi_ids: Up to 4 cards",
    ]);
    expect(issues(dashboard.HomeKpiPicks.safeParse({ kpi_ids: ["headcount", "headcount"] }))).toEqual([
      "kpi_ids: Each card once",
    ]);
  });

  test("a card id is a catalogue key, never free text", () => {
    for (const bad of ["Headcount", "head count", "1headcount", "h", "x".repeat(41)])
      expect(dashboard.HomeKpiKey.safeParse(bad).success).toBe(false);
    expect(dashboard.HomeKpiKey.safeParse("partnerships_quiet_30d").success).toBe(true);
  });

  test("a role locks only cards it opens on", () => {
    expect(
      dashboard.HomeRoleKpisSave.safeParse({ default_ids: ["headcount", "tasks_overdue"], locked_ids: ["headcount"] })
        .success,
    ).toBe(true);
    expect(
      issues(dashboard.HomeRoleKpisSave.safeParse({ default_ids: ["headcount"], locked_ids: ["tasks_overdue"] })),
    ).toEqual(["locked_ids: Lock a chosen card"]);
  });

  test("an Overview with nothing to show is still an Overview (production starts empty)", () => {
    const empty = {
      greeting_name: "Cynthia",
      date: "2026-10-19",
      clocked_in: null,
      cards: [],
      picker_source: "view",
      chart: null,
      donut: null,
      day_strip: null,
      pipeline: null,
      goals: null,
      my_goals: null,
      upcoming_leave: null,
      activity: null,
      week: null,
      alerts_to_clear: null,
      prompt_clock_in: false,
    };
    expect(issues(dashboard.HomeOverview.safeParse(empty))).toEqual([]);
    expect(dashboard.HomeOverview.safeParse({ ...empty, cards: Array(5).fill(null) }).success).toBe(false);
  });

  test("Upcoming Leave carries the leave module's own request and balance shapes", () => {
    const leave = {
      balance: { leave_type_id: ID, name: "Annual", remaining: 12 },
      requests: [
        {
          leave_request_id: OTHER,
          employee: { employee_id: ID, display_name: "Ngozi Umeh", job_title: "Analyst", department: "Delivery" },
          leave_type_id: ID,
          leave_type_name: "Annual",
          starts_on: "2026-12-22",
          ends_on: "2026-12-24",
          days: 3,
          reason: null,
          status: "approved",
          workflow_instance_id: null,
          waiting_on: null,
          recorded: false,
          submitted_at: "2026-10-16T09:30:00.000Z",
          decided_at: "2026-10-16T12:00:00.000Z",
          created_at: "2026-10-16T09:30:00.000Z",
        },
      ],
    };
    expect(issues(dashboard.HomeUpcomingLeave.safeParse(leave))).toEqual([]);
    expect(dashboard.HomeUpcomingLeave.safeParse({ ...leave, balance: null }).success).toBe(true);
  });

  test("the Team list takes its filters and refuses a page size", () => {
    expect(dashboard.HomeTeamQuery.safeParse({ status: "late", sort: "-clock_in_at" }).success).toBe(true);
    expect(dashboard.HomeTeamQuery.safeParse({ limit: "100" }).success).toBe(false);
    expect(dashboard.HomeTeamQuery.safeParse({ status: "elsewhere" }).success).toBe(false);
  });
});

describe("alerts", () => {
  test("the metrics are the nine the alerts module computes, in the New Rule order", () => {
    expect(Object.keys(alerts.HOME_ALERT_METRICS)).toEqual([
      "late_arrivals",
      "missing_clock_out",
      "approval_ageing",
      "document_expiry",
      "confirmation_due",
      "contract_ending",
      "partner_inactivity",
      "budget_threshold",
      "recruitment_sla",
    ]);
    expect(alerts.HomeAlertMetric.options).toEqual(Object.keys(alerts.HOME_ALERT_METRICS));
  });

  test("each metric has a category, a kind, and a default clearer the access catalogue knows", () => {
    for (const [key, m] of Object.entries(alerts.HOME_ALERT_METRICS)) {
      expect(alerts.HOME_ALERT_CATEGORIES).toContain(m.category);
      expect(alerts.HomeAlertKind.options).toContain(m.kind);
      const [module, action] = m.permission_key.split(".");
      expect({ key, module: catalog.isModule(module), action: catalog.isAction(action) }).toEqual({
        key,
        module: true,
        action: true,
      });
      if (m.kind === "deadline") expect({ key, window: m.window }).toEqual({ key, window: false });
    }
  });

  const rule = (over = {}) => ({
    name: "Late three times",
    metric: "late_arrivals",
    threshold: "3",
    window_days: 30,
    severity: "medium",
    permission_key: "people.view",
    ...over,
  });

  /** What is wrong with a New Rule form, field by field. */
  const ruleIssues = (over) => issues(alerts.HomeAlertRuleCreate.safeParse(rule(over)));
  const ageing = { metric: "approval_ageing", window_days: undefined, threshold: 14, permission_key: "people.approve" };
  const expiry = { metric: "document_expiry", window_days: undefined, permission_key: "people.edit" };

  test("a window belongs to a metric that counts over days, and to no other", () => {
    expect(ruleIssues()).toEqual([]);
    expect(ruleIssues({ window_days: "" })).toEqual(["window_days: Enter the days"]);
    expect(ruleIssues({ metric: "missing_clock_out", window_days: 1, threshold: 1 })).toEqual([]);
    expect(ruleIssues({ ...ageing, window_days: 30 })).toEqual(["window_days: Not for this metric"]);
    expect(ruleIssues(ageing)).toEqual([]);
  });

  test("a deadline is whole days before the date", () => {
    expect(ruleIssues({ ...expiry, threshold: "30" })).toEqual([]);
    expect(ruleIssues({ ...expiry, threshold: 30 })).toEqual([]);
    expect(ruleIssues({ ...expiry, threshold: "2.5" })).toEqual(["threshold: Whole days only"]);
    expect(ruleIssues({ threshold: "2.5" })).toEqual([]);
  });

  test("who clears is a grant written module.action, and the key is never typed", () => {
    expect(ruleIssues({ permission_key: "people.update" })).toEqual(["permission_key: Choose who clears"]);
    expect(ruleIssues({ permission_key: "people" })).toEqual(["permission_key: Choose who clears"]);
    expect(alerts.HomeAlertRuleCreate.safeParse(rule({ key: "attendance.late" })).success).toBe(false);
  });

  test("a rule change names a field, and keeps the metric", () => {
    expect(issues(alerts.HomeAlertRuleUpdate.safeParse({}))).toEqual([": Change at least one field"]);
    expect(alerts.HomeAlertRuleUpdate.safeParse({ enabled: false }).success).toBe(true);
    expect(alerts.HomeAlertRuleUpdate.safeParse({ metric: "late_arrivals" }).success).toBe(false);
  });

  test("an alert is cleared unless dismissed, and View Dismissed is a state of the list", () => {
    expect(alerts.HomeAlertClear.parse({})).toEqual({ outcome: "cleared" });
    expect(alerts.HomeAlertClear.parse({ outcome: "dismissed", note: "" })).toEqual({ outcome: "dismissed" });
    expect(alerts.HomeAlertQuery.safeParse({ state: "dismissed", category: "attendance" }).success).toBe(true);
    expect(alerts.HomeAlertQuery.safeParse({ page_size: "50" }).success).toBe(false);
  });
});

describe("reports", () => {
  test("the sources are the ones the reports module gathers, Overview Export last and not offered", () => {
    expect(Object.keys(reports.HOME_REPORT_SOURCES)).toEqual([
      "daily_attendance",
      "leave",
      "open_alerts",
      "headcount",
      "tasks",
      "partnerships",
      "expenses",
      "recruitment",
      "overview",
    ]);
    expect(reports.HomeReportSource.options).toEqual(Object.keys(reports.HOME_REPORT_SOURCES));
    const notOffered = Object.entries(reports.HOME_REPORT_SOURCES).filter(([, s]) => !s.offered);
    expect(notOffered.map(([k]) => k)).toEqual(["overview"]);
  });

  test("each source names a catalogued module and only filters a report can hold", () => {
    const filters = Object.keys(reports.HomeReportFilters.shape);
    for (const [key, s] of Object.entries(reports.HOME_REPORT_SOURCES)) {
      expect({ key, module: catalog.isModule(s.module) }).toEqual({ key, module: true });
      for (const f of s.filters) expect(filters).toContain(f);
    }
  });

  test("the formats and run statuses are the ones 1150 checks", () => {
    expect([...reports.HOME_REPORT_FORMATS]).toEqual(checked("format"));
    expect(reports.HomeReportRunStatus.options).toEqual(checked("status"));
  });

  const schedule = (over = {}) => ({
    recurrence: { freq: "daily", working_days_only: true },
    starts_on: "2026-10-19",
    run_time: "18:00",
    formats: ["pdf"],
    recipient_user_ids: [ID],
    ...over,
  });

  test("a report runs on demand until it is given a schedule", () => {
    const made = reports.HomeReportCreate.parse({ name: "Headcount", report_key: "headcount" });
    expect(made).toEqual({ name: "Headcount", report_key: "headcount", filters: {}, shared: false, schedule: null });
  });

  test("a new report runs a source the form offers, with filters that source takes", () => {
    const base = { name: "Daily Attendance", report_key: "daily_attendance", schedule: schedule() };
    const reportIssues = (over) => issues(reports.HomeReportCreate.safeParse({ ...base, ...over }));
    expect(reportIssues({ filters: { roster_status: "late", department_id: ID } })).toEqual([]);
    expect(reportIssues({ filters: { category: "people" } })).toEqual(["filters.category: Not for this source"]);
    expect(reportIssues({ report_key: "overview" })).toEqual(["report_key: Choose a source"]);
    expect(reportIssues({ filters: { roster_status: "elsewhere" } })).toHaveLength(1);
    expect(reportIssues({ filters: { owner: ID } })).toHaveLength(1);
  });

  test("a schedule goes to one to 25 people, each once, in at least one format", () => {
    const scheduleIssues = (over) => issues(reports.HomeReportScheduleSave.safeParse(schedule(over)));
    const many = Array.from({ length: 26 }, (_, i) => `8a6e0804-2bd0-4672-b79d-${String(i).padStart(12, "0")}`);
    expect(scheduleIssues()).toEqual([]);
    expect(scheduleIssues({ formats: [] })).toEqual(["formats: Pick a format"]);
    expect(scheduleIssues({ formats: ["pdf", "pdf"] })).toEqual(["formats: Each format once"]);
    expect(scheduleIssues({ recipient_user_ids: [] })).toEqual(["recipient_user_ids: Add a recipient"]);
    expect(scheduleIssues({ recipient_user_ids: [ID, ID] })).toEqual(["recipient_user_ids: Each person once"]);
    expect(scheduleIssues({ recipient_user_ids: many })).toEqual(["recipient_user_ids: Up to 25 people"]);
    expect(scheduleIssues({ run_time: "6pm" })).toEqual(["run_time: Use HH:MM"]);
    expect(scheduleIssues({ cron: "0 18 * * 1-5" })).toHaveLength(1);
  });

  test("every recurrence a schedule accepts is one the shared recurrence rules accept", () => {
    const accepted = [
      { freq: "daily" },
      { freq: "daily", interval: 2 },
      { freq: "daily", working_days_only: true },
      { freq: "weekly", by_weekday: [1] },
      { freq: "weekly", interval: 2, by_weekday: [1, 3, 5] },
      { freq: "monthly", by_month_day: 25 },
      { freq: "monthly", by_month_day: -1, working_days_only: true },
    ];
    for (const rule of accepted) {
      expect(issues(reports.HomeReportRecurrence.safeParse(rule))).toEqual([]);
      expect(recurrence.validateRule(rule)).toEqual([]);
    }
  });

  test("a recurrence the shared rules refuse, or reports do not offer, is refused on the form", () => {
    const refused = [
      [{ freq: "daily", by_weekday: [1] }, "by_weekday: Weekly only"],
      [{ freq: "weekly", by_month_day: 3 }, "by_month_day: Monthly only"],
      [{ freq: "monthly", by_month_day: 0 }, "by_month_day: 1 to 31, or last"],
      [{ freq: "weekly", by_weekday: [] }, "by_weekday: Pick a day"],
      [{ freq: "weekly", by_weekday: [2, 2] }, "by_weekday: Each day once"],
      [{ freq: "daily", interval: 0 }, "interval: 1 or more"],
    ];
    for (const [rule, problem] of refused) {
      expect(issues(reports.HomeReportRecurrence.safeParse(rule))).toEqual([problem]);
      if (!problem.startsWith("by_weekday: Each")) expect(recurrence.validateRule(rule)).not.toEqual([]);
    }
    expect(reports.HomeReportRecurrence.safeParse({ freq: "yearly" }).success).toBe(false);
    expect(reports.HomeReportRecurrence.safeParse({ freq: "weekly", by_weekday: [1], count: 6 }).success).toBe(false);
  });

  test("a report change names a field; a schedule can be removed, and paused on its own", () => {
    expect(issues(reports.HomeReportUpdate.safeParse({}))).toEqual([": Change at least one field"]);
    expect(reports.HomeReportUpdate.safeParse({ schedule: null }).success).toBe(true);
    expect(reports.HomeReportUpdate.safeParse({ report_key: "leave" }).success).toBe(false);
    expect(reports.HomeReportScheduleState.safeParse({ active: false }).success).toBe(true);
  });

  test("Run Now and Export ask for one format and answer a pending run with no file yet", () => {
    expect(reports.HomeReportRunNow.safeParse({ format: "xlsx" }).success).toBe(true);
    expect(reports.HomeReportRunNow.safeParse({ format: "csv" }).success).toBe(false);
    const pending = {
      home_report_run_id: ID,
      number: "RPT-0001",
      saved_report_id: OTHER,
      report_name: "Daily Attendance",
      report_key: "daily_attendance",
      report_schedule_id: null,
      scheduled_for: null,
      recipient_user_id: ID,
      recipient_name: "Cynthia Okafor",
      requested_by: ID,
      format: "pdf",
      status: "pending",
      document_id: null,
      emailed_at: null,
      run_at: "2026-10-19T17:00:00.000Z",
      finished_at: null,
    };
    expect(issues(reports.HomeReportRun.safeParse(pending))).toEqual([]);
  });

  test("the run list keeps one report's history and refuses a page size", () => {
    const history = { saved_report_id: ID, status: "failed", sort: "-run_at" };
    expect(reports.HomeReportRunQuery.safeParse(history).success).toBe(true);
    expect(reports.HomeReportRunQuery.safeParse({ per_page: "100" }).success).toBe(false);
  });
});
