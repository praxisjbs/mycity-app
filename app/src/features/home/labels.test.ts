import { describe, expect, it } from "vitest";
import alerts from "@mycity/contract/schemas/alerts.js";
import reports from "@mycity/contract/schemas/reports.js";
import copy from "../../../../scripts/check/lib/copy.js";
import {
  ageOf,
  ALERT_CATEGORY,
  audienceLine,
  clearerOptions,
  figure,
  formatName,
  isoWeekday,
  LEAVE_STATUS,
  METRIC,
  METRIC_OPTIONS,
  OVER_BY_HELP,
  overByDetail,
  overByText,
  REPORT_SOURCE,
  REPORT_STATUS,
  ruleLine,
  RUN_DONE,
  RUN_STATUS,
  scheduleLine,
  SEVERITY,
  sourceName,
  sourceRows,
  WEEKDAY_SHORT,
  whoClears,
} from "./labels";

/**
 * The words Home · Alerts and Reports show for the API's values (docs/guides/home.md §6, §10.1):
 * every key the contract lists has its words, a figure reads from its decimal string, Over By
 * reads by its kind, the help on Over By keeps within the help limits, and a schedule reads as
 * a person says it.
 */

describe("the alert words cover the contract", () => {
  it("names every category and every metric the contract lists, and the three severities", () => {
    expect(Object.keys(ALERT_CATEGORY)).toEqual(alerts.HOME_ALERT_CATEGORIES);
    expect(Object.keys(METRIC)).toEqual(Object.keys(alerts.HOME_ALERT_METRICS));
    expect(METRIC_OPTIONS.map(([key]) => key)).toEqual(Object.keys(alerts.HOME_ALERT_METRICS));
    expect(Object.keys(SEVERITY).sort()).toEqual([...alerts.HOME_ALERT_SEVERITIES].sort());
  });

  it("keeps every word Title Case chrome within the button and title limits, with no dashes", () => {
    const chrome = [...Object.values(ALERT_CATEGORY), ...Object.values(METRIC).map((m) => m.label), ...Object.values(SEVERITY).map((s) => s.text)];
    for (const words of chrome) {
      expect([words, copy.titleCaseViolation(words)]).toEqual([words, null]);
      expect(copy.wordCount(words)).toBeLessThanOrEqual(copy.LIMITS.button);
      expect(copy.hasDash(words)).toBe(false);
    }
  });

  it("holds the Over By help to the help limits: 35 words, no sentence over 20", () => {
    expect(copy.wordCount(OVER_BY_HELP)).toBeLessThanOrEqual(copy.LIMITS.help);
    expect(copy.longestSentence(OVER_BY_HELP)).toBeLessThanOrEqual(copy.LIMITS.sentence);
    expect(copy.hasDash(OVER_BY_HELP)).toBe(false);
  });

  it("words the Over By help as the engine reads a count: reaching the threshold raises the alert, so +0 over 3 is 3", () => {
    // A count is raised on reaching its threshold (home.md §6), so a new alert most often reads +0.
    expect(OVER_BY_HELP).toContain(`${overByDetail({ over_by: "0.00", over_by_kind: "over", threshold: "3" })} means it reached 3`);
    expect(OVER_BY_HELP).not.toMatch(/allowed/i);
  });
});

describe("figures and Over By", () => {
  it("reads a decimal string without a float: trailing zeros go, thousands are grouped", () => {
    expect(figure("4.00")).toBe("4");
    expect(figure("2.50")).toBe("2.5");
    expect(figure("12.25")).toBe("12.25");
    expect(figure("1250000.00")).toBe("1,250,000");
    expect(figure("90")).toBe("90");
    expect(figure("-1.50")).toBe("-1.5");
  });

  it("reads a count past its threshold as +N, and in the sheet with the threshold it is past", () => {
    const over = { over_by: "1.00", over_by_kind: "over" as const, threshold: "3" };
    expect(overByText(over)).toBe("+1");
    expect(overByDetail(over)).toBe("+1 over 3");
    expect(overByDetail({ ...over, over_by: "0.00" })).toBe("+0 over 3");
    expect(overByDetail({ over_by: "4.50", over_by_kind: "over", threshold: "90.00" })).toBe("+4.5 over 90");
  });

  it("reads a deadline as the days left, one day singular, Due Today on the day, and Expired only once the date has passed", () => {
    const left = (over_by: string) => overByText({ over_by, over_by_kind: "days_left" });
    expect(left("12.00")).toBe("12 days left");
    expect(left("1.00")).toBe("1 day left");
    // The server keeps 0 for the day itself and the days since, below 0, once it has passed.
    expect(left("0.00")).toBe("Due Today");
    expect(left("-1.00")).toBe("Expired");
    expect(left("-20.00")).toBe("Expired");
    expect(overByDetail({ over_by: "12.00", over_by_kind: "days_left", threshold: "30" })).toBe("12 days left");
    expect(overByDetail({ over_by: "0.00", over_by_kind: "days_left", threshold: "30" })).toBe("Due Today");
  });

  it("shows the figure alone for a metric no longer listed, and nothing when there is no figure", () => {
    expect(overByText({ over_by: "7.00", over_by_kind: null })).toBe("7");
    expect(overByText({ over_by: null, over_by_kind: "over" })).toBeNull();
    expect(overByDetail({ over_by: null, over_by_kind: "over", threshold: "3" })).toBeNull();
  });
});

describe("age", () => {
  const now = new Date("2026-10-19T07:30:00Z"); // 08:30 on Monday 19/10/2026 in Lagos

  it("counts Lagos days: raised this Lagos day is Today, whatever the hour", () => {
    expect(ageOf("2026-10-18T23:30:00Z", now)).toBe("Today"); // 00:30 Lagos, the 19th
    expect(ageOf("2026-10-18T22:30:00Z", now)).toBe("1 day"); // 23:30 Lagos, the 18th
    expect(ageOf("2026-10-10T08:00:00Z", now)).toBe("9 days");
  });
});

describe("rules", () => {
  it("reads each rule as a person says it", () => {
    const line = (metric: string, threshold: string, window_days: number | null = null) => ruleLine({ metric, threshold, window_days });
    expect(line("approval_ageing", "1")).toBe("Waiting 1 day");
    expect(line("document_expiry", "30")).toBe("30 days before expiry");
    expect(line("confirmation_due", "14")).toBe("14 days before confirmation");
    expect(line("contract_ending", "30")).toBe("30 days before it ends");
    expect(line("partner_inactivity", "30")).toBe("30 days without contact");
    expect(line("budget_threshold", "90.50")).toBe("90.5% spent");
    expect(line("recruitment_sla", "5")).toBe("5 days at one stage");
    // A rule kept from before the metric list, or the Attendance policy's (home.md §6): its number alone.
    expect(line("late_arrivals", "3.00", 30)).toBe("3");
    expect(line("attendance_policy", "1")).toBe("1");
  });

  it("words who clears from the grant: the module's name and who holds the action", () => {
    expect(whoClears("people.approve")).toBe("People Approvers");
    expect(whoClears("people.view")).toBe("People Viewers");
    expect(whoClears("partnerships.edit")).toBe("Partnerships Editors");
    expect(whoClears("expenses.approve")).toBe("Expenses Approvers");
  });

  it("offers each metric's own grant once, in the metric list's order, and a rule's other grant in the server's words", () => {
    const defaults = [...new Set(Object.values(alerts.HOME_ALERT_METRICS).map((m) => m.permission_key))];
    expect(clearerOptions("people.approve").map(([key]) => key)).toEqual(defaults);
    expect(clearerOptions("people.approve").map(([, words]) => words)).toEqual(["People Approvers", "People Editors", "Partnerships Editors", "Expenses Approvers", "Recruitment Editors"]);
    expect(clearerOptions("queries.approve", "Queries & Sanctions Approvers").at(-1)).toEqual(["queries.approve", "Queries & Sanctions Approvers"]);
    expect(clearerOptions("queries.approve").at(-1)).toEqual(["queries.approve", "Queries & Sanctions Approvers"]);
  });
});

describe("Alert Sources", () => {
  it("is one bar per metric, most first, the Attendance policy's breaches as one, a metric no longer listed counted as Other", () => {
    expect(
      sourceRows([
        { metric: "partner_inactivity", count: 4 },
        { metric: "attendance_policy", count: 9 },
        { metric: "late_arrivals", count: 2 },
        { metric: "budget.threshold", count: 3 },
      ]),
    ).toEqual([
      { label: "Attendance Policy", count: 9 },
      { label: "Other", count: 5 },
      { label: "Partner Inactivity", count: 4 },
    ]);
    expect(sourceRows([])).toEqual([]);
  });
});

describe("the report words cover the contract", () => {
  it("names every source, report status and run status the contract lists, and every leave status", () => {
    expect(Object.keys(REPORT_SOURCE)).toEqual(Object.keys(reports.HOME_REPORT_SOURCES));
    expect(Object.keys(REPORT_STATUS).sort()).toEqual([...reports.HomeReportStatus.options].sort());
    expect([...Object.keys(RUN_STATUS), "done"].sort()).toEqual([...reports.HomeReportRunStatus.options].sort());
    expect(Object.keys(LEAVE_STATUS)).toEqual(["submitted", "approved", "rejected", "cancelled"]);
    expect(reports.HOME_REPORT_FORMATS.map(formatName)).toEqual(["PDF", "XLSX"]);
  });

  it("keeps every word Title Case chrome within the button and title limits, with no dashes", () => {
    const chrome = [...Object.values(REPORT_SOURCE), ...Object.values(REPORT_STATUS).map((s) => s.text), ...Object.values(RUN_STATUS).map((s) => s.text), RUN_DONE.text, ...Object.values(LEAVE_STATUS), ...WEEKDAY_SHORT];
    for (const words of chrome) {
      expect([words, copy.titleCaseViolation(words)]).toEqual([words, null]);
      expect(copy.wordCount(words)).toBeLessThanOrEqual(copy.LIMITS.button);
      expect(copy.hasDash(words)).toBe(false);
    }
  });

  it("names a source the contract no longer lists Other, never by its key", () => {
    expect(sourceName("daily_attendance")).toBe("Daily Attendance");
    expect(sourceName("overview")).toBe("Overview");
    expect(sourceName("payroll_month")).toBe("Other");
  });
});

describe("schedules and audiences", () => {
  const at = (recurrence: Parameters<typeof scheduleLine>[0]["recurrence"], starts_on = "2026-10-21", run_time = "18:00") => scheduleLine({ recurrence, starts_on, run_time });

  it("reads a daily rule, every day or every working day", () => {
    expect(at({ freq: "daily" })).toBe("Every day at 18:00");
    expect(at({ freq: "daily", working_days_only: true })).toBe("Every working day at 18:00");
    expect(at({ freq: "daily", interval: 3 })).toBe("Every 3 days at 18:00");
    expect(at({ freq: "daily", interval: 2, working_days_only: true })).toBe("Every 2 days, working days only at 18:00");
  });

  it("reads a weekly rule by its days, a run of them as a span, and a rule with none on its start's weekday", () => {
    expect(at({ freq: "weekly", by_weekday: [1] }, undefined, "08:00")).toBe("Mondays at 08:00");
    expect(at({ freq: "weekly", by_weekday: [5, 1] })).toBe("Mondays and Fridays at 18:00");
    expect(at({ freq: "weekly", by_weekday: [1, 3, 5] })).toBe("Mondays, Wednesdays and Fridays at 18:00");
    expect(at({ freq: "weekly", by_weekday: [1, 2, 3, 4, 5] })).toBe("Monday to Friday at 18:00");
    expect(at({ freq: "weekly", by_weekday: [1, 2, 3, 4, 5, 6, 7] })).toBe("Every day at 18:00");
    expect(at({ freq: "weekly" })).toBe("Wednesdays at 18:00");
    expect(at({ freq: "weekly", interval: 2, by_weekday: [1] })).toBe("Every 2 weeks on Mondays at 18:00");
  });

  it("reads a monthly rule by its day, the last day, or its start's day", () => {
    expect(at({ freq: "monthly", by_month_day: 1 })).toBe("Monthly on the 1st at 18:00");
    expect(at({ freq: "monthly", by_month_day: 22 })).toBe("Monthly on the 22nd at 18:00");
    expect(at({ freq: "monthly", by_month_day: 13 })).toBe("Monthly on the 13th at 18:00");
    expect(at({ freq: "monthly", by_month_day: -1 })).toBe("Monthly on the last day at 18:00");
    expect(at({ freq: "monthly" })).toBe("Monthly on the 21st at 18:00");
    expect(at({ freq: "monthly", interval: 3, by_month_day: 1 })).toBe("Every 3 months on the 1st at 18:00");
  });

  it("numbers weekdays as the rule does, Monday 1 to Sunday 7", () => {
    expect(isoWeekday("2026-10-19")).toBe(1);
    expect(isoWeekday("2026-10-25")).toBe(7);
  });

  it("names up to three people, then two and how many more", () => {
    const people = (...names: string[]) => names.map((display_name) => ({ display_name }));
    expect(audienceLine([])).toBeNull();
    expect(audienceLine(people("Ada Obi"))).toBe("Ada Obi");
    expect(audienceLine(people("Ada Obi", "Tolu Ade"))).toBe("Ada Obi and Tolu Ade");
    expect(audienceLine(people("Ada Obi", "Tolu Ade", "Emeka Obi"))).toBe("Ada Obi, Tolu Ade and Emeka Obi");
    expect(audienceLine(people("Ada Obi", "Tolu Ade", "Emeka Obi", "Kemi Ola", "Musa Bello"))).toBe("Ada Obi, Tolu Ade and 3 more");
  });
});
