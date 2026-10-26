"use strict";
/**
 * Targets: the contract a scorecard's lines are saved through. Saving them runs against Postgres
 * in tests/integration/performance-plan.test.js.
 */
const c = require("@mycity/contract");

describe("a scorecard line's weight (QA OBS-04)", () => {
  const line = (weight) => ({ section: "accountability", title: "Weekly report sent", measure: "standard", weight });
  const save = (weight) => c.targets.ScorecardLinesSave.safeParse({ lines: [line(weight)] });

  test("up to 100, as the column holds it; zero is left to the service's Above zero", () => {
    for (const ok of ["0", "0.01", "7.5", "15", "100", "100.00"]) expect(save(ok).success).toBe(true);
  });

  test("over 100 is refused on the line's Weight, never left for the database to refuse", () => {
    for (const bad of ["101", "100.01", "999.99"]) {
      const r = save(bad);
      expect(r.success).toBe(false);
      expect(r.error.issues.map((i) => [i.path.join("."), i.message])).toEqual([["lines.0.weight", "At most 100"]]);
    }
  });

  test("a weight that is not a number keeps its own words", () => {
    expect(save("ten").error.issues.map((i) => i.message)).toEqual(["Like 15 or 12.5"]);
  });
});
