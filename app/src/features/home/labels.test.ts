import { describe, expect, it } from "vitest";
import alerts from "@mycity/contract/schemas/alerts.js";
import copy from "../../../../scripts/check/lib/copy.js";
import { ageOf, ALERT_CATEGORY, clearerOptions, figure, METRIC, METRIC_OPTIONS, OVER_BY_HELP, overByDetail, overByText, ruleLine, SEVERITY, sourceRows, whoClears } from "./labels";

/**
 * The words Home · Alerts shows for the API's values (docs/guides/home.md §6 Alerts, §10.1):
 * every key the contract lists has its words, a figure reads from its decimal string, Over By
 * reads by its kind, and the help on Over By keeps within the help limits.
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
    expect(line("late_arrivals", "3.00", 30)).toBe("3 late in 30 days");
    expect(line("missing_clock_out", "2", 1)).toBe("2 missing in 1 day");
    expect(line("approval_ageing", "1")).toBe("Waiting 1 day");
    expect(line("document_expiry", "30")).toBe("30 days before expiry");
    expect(line("confirmation_due", "14")).toBe("14 days before confirmation");
    expect(line("contract_ending", "30")).toBe("30 days before it ends");
    expect(line("partner_inactivity", "30")).toBe("30 days without contact");
    expect(line("budget_threshold", "90.50")).toBe("90.5% spent");
    expect(line("recruitment_sla", "5")).toBe("5 days at one stage");
    expect(line("attendance.rule_breached", "3")).toBe("3");
  });

  it("words who clears from the grant: the module's name and who holds the action", () => {
    expect(whoClears("people.approve")).toBe("People Approvers");
    expect(whoClears("people.view")).toBe("People Viewers");
    expect(whoClears("partnerships.edit")).toBe("Partnerships Editors");
    expect(whoClears("expenses.approve")).toBe("Expenses Approvers");
  });

  it("offers each metric's own grant once, in the metric list's order, and a rule's other grant in the server's words", () => {
    const defaults = [...new Set(Object.values(alerts.HOME_ALERT_METRICS).map((m) => m.permission_key))];
    expect(clearerOptions("people.view").map(([key]) => key)).toEqual(defaults);
    expect(clearerOptions("people.view").map(([, words]) => words)).toEqual(["People Viewers", "People Approvers", "People Editors", "Partnerships Editors", "Expenses Approvers", "Recruitment Editors"]);
    expect(clearerOptions("queries.approve", "Queries & Sanctions Approvers").at(-1)).toEqual(["queries.approve", "Queries & Sanctions Approvers"]);
    expect(clearerOptions("queries.approve").at(-1)).toEqual(["queries.approve", "Queries & Sanctions Approvers"]);
  });
});

describe("Alert Sources", () => {
  it("is one bar per metric, most first, a metric no longer listed counted as Other", () => {
    expect(
      sourceRows([
        { metric: "partner_inactivity", count: 4 },
        { metric: "late_arrivals", count: 9 },
        { metric: "attendance.rule_breached", count: 2 },
        { metric: "budget.threshold", count: 3 },
      ]),
    ).toEqual([
      { label: "Late Arrivals", count: 9 },
      { label: "Other", count: 5 },
      { label: "Partner Inactivity", count: 4 },
    ]);
    expect(sourceRows([])).toEqual([]);
  });
});
