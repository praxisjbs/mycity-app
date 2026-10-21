"use strict";
/**
 * The cascade's rules and the scoring the goals screens show (docs/guides/performance.md §6),
 * without a database. The routes, the approval and the roll-up run end to end in
 * tests/integration/goals.test.js.
 */
const cascade = require("./goals.cascade");
const score = require("../kpis/kpis.score");
const { routesOf } = require("../../http/route");

describe("goals.cascade", () => {
  test("a level's period is a calendar year or a month", () => {
    expect(cascade.periodOf({ level: "organisation", year: 2026 })).toEqual({ starts_on: "2026-01-01", ends_on: "2026-12-31" });
    expect(cascade.periodOf({ level: "monthly", month: "2026-02" })).toEqual({ starts_on: "2026-02-01", ends_on: "2026-02-28" });
  });

  const parent = (over = {}) => ({
    level: "annual",
    status: "active",
    starts_on: "2026-01-01",
    ends_on: "2026-12-31",
    ...over,
  });
  const october = { starts_on: "2026-10-01", ends_on: "2026-10-31" };

  test("a monthly goal hangs from an approved annual goal that holds its month", () => {
    expect(() => cascade.assertParent("monthly", parent(), october)).not.toThrow();
    expect(() => cascade.assertParent("monthly", null, october)).toThrow(/parent/i);
    expect(() => cascade.assertParent("monthly", parent({ level: "organisation" }), october)).toThrow(/annual/);
    expect(() => cascade.assertParent("monthly", parent({ status: "pending_approval" }), october)).toThrow(
      expect.objectContaining({ code: "PARENT_NOT_ACTIVE" }),
    );
    expect(() => cascade.assertParent("monthly", parent({ ends_on: "2026-09-30" }), october)).toThrow(/period/);
  });

  test("an organisational goal has no parent", () => {
    expect(() => cascade.assertParent("organisation", null, october)).not.toThrow();
  });

  test("each level takes its own capability and numbering scheme", () => {
    expect(cascade.LEVELS.organisation).toMatchObject({ capability: "goals.organisation", doc_type: "goal_organisation" });
    expect(cascade.LEVELS.department).toMatchObject({ capability: "goals.department", parent: "monthly" });
  });
});

describe("kpis.score", () => {
  test("attainment is capped at 1 either way, and lower-is-better counts nothing done as met", () => {
    expect(score.attainment({ target_value: "10", actual_value: "4", direction: "higher" })).toBeCloseTo(0.4);
    expect(score.attainment({ target_value: "10", actual_value: "14", direction: "higher" })).toBe(1);
    expect(score.attainment({ target_value: "2", actual_value: "4", direction: "lower" })).toBe(0.5);
    expect(score.attainment({ target_value: "2", actual_value: "0", direction: "lower" })).toBe(1);
    expect(score.attainment({ target_value: null, actual_value: "3", direction: "higher" })).toBeNull();
  });

  test("status measures attainment against the share of the period gone", () => {
    expect(score.statusOf(1, 0.2)).toBe("met");
    expect(score.statusOf(0.45, 0.5)).toBe("on_track");
    expect(score.statusOf(0.3, 0.5)).toBe("at_risk");
    expect(score.statusOf(0.1, 0.5)).toBe("behind");
    expect(score.statusOf(null, 0.5)).toBeNull();
  });

  test("KPI score weights each KPI, and weights total without float drift", () => {
    const kpis = [
      { target_value: "10", actual_value: "10", direction: "higher", weight: "60.00" },
      { target_value: "4", actual_value: "2", direction: "higher", weight: "40.00" },
    ];
    expect(score.kpiScore(kpis)).toBeCloseTo(0.8);
    expect(score.totalWeight([{ weight: "33.33" }, { weight: "33.33" }, { weight: "33.34" }])).toBe("100.00");
  });

  test("the manager's prefilled rating follows attainment", () => {
    expect([1, 0.9, 0.75, 0.55, 0.2, null].map(score.ratingOf)).toEqual([5, 4, 3, 2, 1, null]);
  });
});

describe("goals.routes", () => {
  const routes = routesOf(require("./goals.routes").router);
  const find = (method, path) => routes.find((r) => r.method === method && r.path === path);

  test("mount at /performance/goals, literal paths before /:id", () => {
    expect(require("./goals.routes").basePath).toBe("/performance/goals");
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /",
      "GET /summary",
      "GET /:id",
      "POST /",
      "PATCH /:id",
      "POST /:id/submit",
      "POST /:id/decide",
    ]);
  });

  test("setting a goal needs a goal capability, submitting goals.company, deciding approve", () => {
    expect(find("POST", "/").capabilities).toEqual(["goals.organisation", "goals.company"]);
    expect(find("POST", "/:id/submit").capability).toBe("goals.company");
    expect(find("POST", "/:id/decide").permission).toMatchObject({ key: "performance", action: "approve" });
  });
});
