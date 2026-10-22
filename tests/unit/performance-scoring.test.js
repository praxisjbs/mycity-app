"use strict";
/**
 * The scoring library (docs/guides/performance.md §6.8, §6.9, §6.15), checked against the two Q4
 * workbooks' own rules and the worked examples the guide gives.
 */
const s = require("../../packages/contract/schemas/scoring");

describe("key result scoring (OKR workbook, Read Me)", () => {
  test("numeric: actual ÷ target, capped at 1; ₦18m of a ₦30m commission target is 0.6, Watch", () => {
    const score = s.numericScore({ actual: "18000000", target: "30000000" });
    expect(score).toBe(0.6);
    expect(s.krBand(score)).toBe("watch");
    expect(s.numericScore({ actual: "70000", target: "64000" })).toBe(1);
    expect(s.numericScore({ actual: null, target: "64000" })).toBeNull();
  });

  test("numeric, lower is better: target ÷ actual; an actual of 0 scores 1", () => {
    expect(s.numericScore({ actual: "4", target: "2", direction: "lower" })).toBe(0.5);
    expect(s.numericScore({ actual: "0", target: "2", direction: "lower" })).toBe(1);
    expect(s.numericScore({ actual: "1", target: "2", direction: "lower" })).toBe(1);
  });

  test("dated or yes/no: 1 by the date, 0.7 within 14 days, 0.3 partly, 0 not done", () => {
    const due = "2026-11-30";
    expect(s.datedKrScore({ done_on: "2026-11-28", due_on: due, today: "2026-12-01" })).toBe(1);
    expect(s.datedKrScore({ done_on: "2026-11-30", due_on: due, today: "2026-12-01" })).toBe(1);
    expect(s.datedKrScore({ done_on: "2026-12-14", due_on: due, today: "2026-12-15" })).toBe(0.7);
    expect(s.datedKrScore({ done_on: "2026-12-15", due_on: due, today: "2026-12-15" })).toBe(0);
    expect(s.datedKrScore({ due_on: due, partly: true, today: "2026-12-20" })).toBe(0.3);
    expect(s.datedKrScore({ due_on: due, today: "2026-12-20" })).toBe(0);
    expect(s.datedKrScore({ due_on: due, today: "2026-11-15" })).toBeNull(); // not due yet
  });

  test("multi-part: each part scored, then the mean, rounded as their sheet rounds", () => {
    expect(s.meanScore([1, 0.7, 0.3])).toBe(0.67);
    expect(s.meanScore([null, 1])).toBe(1);
    expect(s.meanScore([])).toBeNull();
  });

  test("bands: 0.7 Good, 0.4 to under 0.7 Watch, under 0.4 Recovery", () => {
    expect(s.krBand(0.7)).toBe("good");
    expect(s.krBand("0.69")).toBe("watch");
    expect(s.krBand(0.4)).toBe("watch");
    expect(s.krBand(0.39)).toBe("recovery");
    expect(s.krBand(null)).toBeNull();
  });

  test("the roll-up is the mean of what is scored, blank when nothing is", () => {
    const objective = s.meanScore([0.6, 1, null]);
    expect(objective).toBe(0.8);
    expect(s.meanScore([objective, 0.5])).toBe(0.65);
    expect(s.meanScore([null, null])).toBeNull();
  });
});

describe("scorecard line scoring (scorecard workbook, Guide)", () => {
  test("John Ojelola's Results line 3: 3 of 4 South West placements is 0.75, so 11.25 of 15", () => {
    const score = s.numericScore({ actual: "3", target: "4" });
    expect(score).toBe(0.75);
    expect(score * 15).toBe(11.25);
  });

  test("milestone: 1.0 on time, 0.5 within 10 business days after, 0 later or not accepted", () => {
    expect(s.milestoneScore({ late_business_days: 0 })).toBe(1);
    expect(s.milestoneScore({ late_business_days: -3 })).toBe(1);
    expect(s.milestoneScore({ late_business_days: 10 })).toBe(0.5);
    expect(s.milestoneScore({ late_business_days: 11 })).toBe(0);
    expect(s.milestoneScore({ late_business_days: null })).toBe(0);
    expect(s.milestoneScore({ late_business_days: null, due_passed: false })).toBeNull();
  });

  test("standard: met 1.0; missed by up to 5 percentage points 0.5; otherwise 0", () => {
    expect(s.standardScore({ actual: "95", target: "95", unit: "%" })).toBe(1);
    expect(s.standardScore({ actual: "90", target: "95", unit: "%" })).toBe(0.5);
    expect(s.standardScore({ actual: "89", target: "95", unit: "%" })).toBe(0);
    // On-time Commitment Delivery, target 80%
    expect(s.standardScore({ actual: "76", target: "80", unit: "%" })).toBe(0.5);
  });

  test("standard against a zero target: one count above it is near, two is a miss", () => {
    expect(s.standardScore({ actual: "0", target: "0", direction: "lower" })).toBe(1);
    expect(s.standardScore({ actual: "1", target: "0", direction: "lower" })).toBe(0.5);
    expect(s.standardScore({ actual: "2", target: "0", direction: "lower" })).toBe(0);
  });

  test("standard on any other figure: within 5% of the target is near", () => {
    expect(s.standardScore({ actual: "96", target: "100" })).toBe(0.5);
    expect(s.standardScore({ actual: "94", target: "100" })).toBe(0);
    expect(s.standardScore({ actual: "52", target: "50", direction: "lower" })).toBe(0.5);
  });

  test("a month with no eligible cases is blank, never 1", () => {
    expect(s.standardScore({ actual: null, target: "100" })).toBeNull();
    expect(s.binaryScore(null)).toBeNull();
    expect(s.binaryScore(true)).toBe(1);
    expect(s.binaryScore(false)).toBe(0);
  });

  test("a Results line takes its latest month; KPI and Accountability lines the mean", () => {
    expect(s.lineScore({ section: "results", months: [0.5, 0.75, null] })).toBe(0.75);
    expect(s.lineScore({ section: "kpis", months: [1, 0.5, null] })).toBe(0.75);
    expect(s.lineScore({ section: "accountability", months: [null, null] })).toBeNull();
  });

  test("score to date: Σ(weight × score) ÷ Σ(weight of the scored lines); Not Assessable leaves the denominator", () => {
    const lines = [
      { weight: 15, score: 0.75 },
      { weight: 45, score: 1 },
      { weight: 25, score: 0.5 },
      { weight: 15, score: null }, // Not Assessable
    ];
    expect(s.scoreToDate(lines)).toBeCloseTo((11.25 + 45 + 12.5) / 85, 10);
    expect(s.scoreToDate([{ weight: 10, score: null }])).toBeNull();
  });
});

describe("rating and the conduct cap (§6.15)", () => {
  test("bands: 0.90 Exceeds, 0.75 Meets, 0.50 Partly Meets, below that Below", () => {
    expect(s.rating(0.9)).toBe("exceeds");
    expect(s.rating("0.8999")).toBe("meets");
    expect(s.rating(0.75)).toBe("meets");
    expect(s.rating(0.5)).toBe("partly_meets");
    expect(s.rating(0.49)).toBe("below");
    expect(s.rating(null)).toBeNull();
  });

  test("a confirmed conduct breach caps the rating at Partly Meets, whatever the score", () => {
    expect(s.rating(0.95, { conduct_breach: true })).toBe("partly_meets");
    expect(s.rating(0.8, { conduct_breach: true })).toBe("partly_meets");
    expect(s.rating(0.3, { conduct_breach: true })).toBe("below");
  });
});

describe("rules and weights", () => {
  test("the defaults are MyCity's workbooks' rules and pass their own schema", () => {
    expect(s.ScoringRules.parse(s.DEFAULT_RULES)).toEqual(s.DEFAULT_RULES);
    expect(s.DEFAULT_RULES.sections).toEqual({ results: 60, kpis: 25, accountability: 15 });
    expect(s.DEFAULT_RULES.due_business_days.check_in).toBe(2);
    expect(Object.isFrozen(s.DEFAULT_RULES)).toBe(true);
  });

  test("rules a person saves are refused when they do not hold together", () => {
    const bad = JSON.parse(JSON.stringify(s.DEFAULT_RULES));
    bad.sections.results = 70;
    expect(s.ScoringRules.safeParse(bad).success).toBe(false);
    const bands = JSON.parse(JSON.stringify(s.DEFAULT_RULES));
    bands.bands.meets = 0.95;
    expect(s.ScoringRules.safeParse(bands).success).toBe(false);
    const due = JSON.parse(JSON.stringify(s.DEFAULT_RULES));
    due.due_business_days.review = 1;
    expect(s.ScoringRules.safeParse(due).success).toBe(false);
  });

  test("changed rules change the score: a 7-day grace", () => {
    const rules = { ...s.DEFAULT_RULES.key_results, dated_grace_days: 7 };
    expect(s.datedKrScore({ done_on: "2026-12-08", due_on: "2026-11-30", today: "2026-12-09" }, rules)).toBe(0);
  });

  test("each section's lines must fill its weight", () => {
    const lines = [
      { section: "results", weight: "45" },
      { section: "results", weight: "15" },
      { section: "kpis", weight: "20" },
      { section: "accountability", weight: "15" },
    ];
    expect(s.sectionWeightProblems(lines)).toEqual([{ section: "kpis", total: 20, expected: 25 }]);
  });

  test("scores travel as decimal strings", () => {
    expect(s.formatScore(0.75)).toBe("0.75");
    expect(s.formatScore(2 / 3)).toBe("0.6667");
    expect(s.formatScore(1.2)).toBe("1");
    expect(s.formatScore(null)).toBeNull();
    expect(s.ScoreValue.safeParse("0.6667").success).toBe(true);
    expect(s.ScoreValue.safeParse("1.0").success).toBe(true);
    expect(s.ScoreValue.safeParse("1.2").success).toBe(false);
    expect(s.Quantity.safeParse("30000000").success).toBe(true);
    expect(s.Quantity.safeParse("12,000").success).toBe(false);
  });
});
