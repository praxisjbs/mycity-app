"use strict";
/**
 * Quarters and their rounds' deadlines (docs/guides/performance.md §6.2): pure, against the
 * Nigerian holidays that move MyCity's own deadlines.
 */
const ww = require("../../shared/time/working-week");
const { scoring } = require("@mycity/contract");
const periods = require("./goals.periods");

const cal = ww.makeCalendar({
  days: [1, 2, 3, 4, 5, 6],
  holidays: ["2026-12-25", "2026-12-28", "2027-01-01"],
});

describe("quarters", () => {
  test("a quarter is named, ended and planned from its first day", () => {
    expect(periods.quarterName("2026-10-01")).toBe("Q4 2026");
    expect(periods.quarterName("2027-01-01")).toBe("Q1 2027");
    expect(periods.quarterEnd("2026-10-01")).toBe("2026-12-31");
    expect(periods.quarterEnd("2027-01-01")).toBe("2027-03-31");
    expect(periods.monthsOf("2026-10-01")).toEqual(["2026-10-01", "2026-11-01", "2026-12-01"]);
    expect(periods.planYearOf("2026-10-01")).toBe("2026-01-01");
  });
});

describe("a month's round (G2, G3)", () => {
  test("October 2026 opens on 2 November; check-ins due 3 November, heads 4 November", () => {
    expect(periods.roundDates("2026-10-01", scoring.DEFAULT_RULES, cal)).toEqual({
      opens_on: "2026-11-02",
      check_in_due_on: "2026-11-03",
      head_check_in_due_on: "2026-11-04",
      review_due_on: "2026-11-06",
      second_level_due_on: "2026-11-10",
      close_due_on: "2026-11-13",
    });
    expect(periods.roundName("2026-10-01")).toBe("October 2026");
  });

  test("December 2026's round steps over New Year's Day and the Saturday after it", () => {
    const d = periods.roundDates("2026-12-01", scoring.DEFAULT_RULES, cal);
    expect(d.opens_on).toBe("2027-01-04");
    expect(d.head_check_in_due_on).toBe("2027-01-06");
  });

  test("the quarter's own rules move the deadlines", () => {
    const rules = { ...scoring.DEFAULT_RULES, due_business_days: { ...scoring.DEFAULT_RULES.due_business_days, review: 6 } };
    expect(periods.roundDates("2026-10-01", rules, cal).review_due_on).toBe("2026-11-09");
  });

  test("commitments and the function report are due on the month's 3rd business day", () => {
    expect(periods.commitmentsDueOn("2026-11-01", scoring.DEFAULT_RULES, cal)).toBe("2026-11-04");
    expect(periods.commitmentsDueOn("2026-12-01", scoring.DEFAULT_RULES, cal)).toBe("2026-12-03");
  });
});

describe("Analytics (§6.21)", () => {
  const c = require("@mycity/contract");
  const { routesOf } = require("../../http/route");
  const routes = routesOf(require("./goals.routes").router);
  const find = (method, path) => routes.find((r) => r.method === method && r.path === path);
  const analytics = require("./goals.analytics");
  const ALL = { scope: "all", scope_ids: null, employee_id: null };

  test("its routes: the figures and the people behind `performance` view, the export behind export", () => {
    expect(find("GET", "/analytics")).toMatchObject({
      contract: { query: c.goals.PerformanceAnalyticsQuery, response: c.goals.PerformanceAnalytics },
      permission: { key: "performance", action: "view" },
    });
    expect(find("GET", "/analytics/people")).toMatchObject({
      contract: { query: c.goals.AnalyticsPeopleQuery, response: c.goals.AnalyticsPersonPage },
      permission: { key: "performance", action: "view" },
    });
    expect(find("POST", "/analytics/people/export")).toMatchObject({
      contract: { body: c.goals.AnalyticsExportRequest, response: c.documents.ExportFile },
      permission: { key: "performance", action: "export" },
    });
  });

  test("before the first quarter: empty figures and an empty page, from one read", async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const a = await analytics.figures({}, ALL, { db });
    expect(c.goals.PerformanceAnalytics.parse(a)).toEqual(a);
    expect(a).toMatchObject({ period: null, scores: [], ratings: { month: null } });
    expect(a.ratings.counts.map((r) => r.rating)).toEqual(["exceeds", "meets", "partly_meets", "below"]);
    expect(db.query).toHaveBeenCalledTimes(1);
    const page = await analytics.people({ page: 2 }, ALL, { db });
    expect(c.goals.AnalyticsPersonPage.parse(page)).toEqual(page);
    expect(page.page).toMatchObject({ number: 2, total: 0 });
  });

  test("a quarter named that does not exist is a 404", async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await expect(analytics.figures({ period_id: "8a6e0804-2bd0-4672-b79d-d97027f9071a" }, ALL, { db })).rejects.toMatchObject({
      status: 404,
    });
  });

  test("the people table sorts by score or name, never by a column the contract does not allow", () => {
    expect(c.goals.AnalyticsPeopleQuery.safeParse({ sort: "-score_to_date" }).success).toBe(true);
    expect(c.goals.AnalyticsPeopleQuery.safeParse({ sort: "rating" }).success).toBe(false);
    expect(c.goals.ScoreGap.safeParse("-0.12").success).toBe(true);
    expect(c.goals.ScoreGap.safeParse("1.5").success).toBe(false);
  });
});
