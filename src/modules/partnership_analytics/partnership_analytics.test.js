"use strict";
/**
 * Partnership Analytics' period and stage-to-stage helpers (docs/guides/partnerships.md §6.18). The
 * measures themselves run on a fixed dataset in tests/integration/partnerships-analytics.test.js.
 */
const service = require("./partnership_analytics.service");

// 10:00 in Lagos on Saturday 8 August 2026.
const NOW = new Date("2026-08-08T09:00:00Z");

describe("partnership analytics: the period", () => {
  test("This Month, This Quarter and This Year are whole Lagos periods", () => {
    expect(service.periodOf({ period: "month" }, NOW)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(service.periodOf({ period: "quarter" }, NOW)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(service.periodOf({ period: "year" }, NOW)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  test("Custom takes its dates, at most five years, and names the missing one", () => {
    expect(service.periodOf({ period: "custom", from: "2026-02-10", to: "2026-03-05" }, NOW)).toEqual({ from: "2026-02-10", to: "2026-03-05" });
    expect(() => service.periodOf({ period: "custom", from: "2026-02-10" }, NOW)).toThrow("Pick the dates");
    expect(() => service.periodOf({ period: "custom", from: "2020-01-01", to: "2026-01-31" }, NOW)).toThrow("Five years at most");
  });

  test("the months of a period, oldest first", () => {
    expect(service.monthsOf({ from: "2026-11-15", to: "2027-02-01" })).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });
});

describe("partnership analytics: stage to stage", () => {
  test("each step is the share of the deals at one stage that reached the next", () => {
    const steps = service.conversionOf([
      { code: "prospect", label: "Prospect Identified", reached: 10 },
      { code: "contact", label: "Initial Contact", reached: 4 },
      { code: "signed", label: "Partnership Signed", reached: 0 },
      { code: "active", label: "Active Partnership", reached: 0 },
    ]);
    expect(steps.map((s) => [s.from_stage, s.to_stage, s.moved, s.rate])).toEqual([
      ["prospect", "contact", 4, 40],
      ["contact", "signed", 0, 0],
      ["signed", "active", 0, null],
    ]);
  });
});
