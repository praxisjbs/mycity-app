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
