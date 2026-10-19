"use strict";
/** The local mock-data seed: where it refuses, and that the roster loads as the contract wants. */
const fs = require("node:fs");
const path = require("node:path");
const { EmployeeCreate } = require("../../packages/contract/schemas/organisation");
const seed = require("../../seeds/build/20_mock_data");
const { datesOf } = require("../../seeds/lib/leave-sample");
const workingWeek = require("../../src/shared/time/working-week");

const ROSTER = path.join(__dirname, "..", "..", "app", "src", "api", "mock", "data", "roster.json");
const roster = JSON.parse(fs.readFileSync(ROSTER, "utf8"));
const DEPT = "00000000-0000-4000-8000-000000000001";

describe("seeds/build/20_mock_data", () => {
  test("loads only on a laptop or in CI, with no mail server", () => {
    const ok = { appEnv: "development", smtpHost: "", rosterExists: true };
    expect(seed.refusals(ok)).toEqual([]);
    expect(seed.refusals({ ...ok, appEnv: "test" })).toEqual([]);
    expect(seed.refusals({ ...ok, appEnv: "staging" })).toHaveLength(1);
    expect(seed.refusals({ ...ok, appEnv: "production" })).toHaveLength(1);
    expect(seed.refusals({ ...ok, smtpHost: "smtp.example.com" })).toHaveLength(1);
    expect(seed.refusals({ ...ok, rosterExists: false })).toHaveLength(1);
  });

  test("puts every manager before the people who report to them", () => {
    const order = seed.inTreeOrder(roster.people).map((p) => p.key);
    expect(order).toHaveLength(roster.people.length);
    for (const p of roster.people)
      if (p.manager) expect(order.indexOf(p.manager)).toBeLessThan(order.indexOf(p.key));
    expect(() => seed.inTreeOrder([{ key: "a", manager: "b" }, { key: "b", manager: "a" }])).toThrow(/loop/);
  });

  test("every person is a valid EmployeeCreate", () => {
    roster.people.forEach((p, i) => {
      const r = EmployeeCreate.safeParse({ ...seed.employeeOf(p, i, "2026-10-17"), department_id: DEPT });
      expect(r.error && r.error.issues).toBeUndefined();
    });
  });

  test("every leave row names someone on the roster", () => {
    const keys = new Set(roster.people.map((p) => p.key));
    for (const l of roster.leave) expect(keys.has(l.key)).toBe(true);
  });

  test("staging's leave sample is the mock's, row for row", () => {
    const staging = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "seeds", "staging", "leave-sample.json"), "utf8"));
    expect(staging).toEqual(roster.leave);
  });

  test("a sample row's dates move off days not worked and stay inside one year", () => {
    const cal = workingWeek.makeCalendar({ holidays: [{ holiday_date: "2026-12-28", name: "Holiday" }] });
    // Saturday 26 December: Sunday is not worked and Monday is a holiday, so it starts on Tuesday;
    // the end, in January, comes back to 31 December.
    const dates = datesOf({ from: 1, to: 9 }, "2026-12-26", cal, workingWeek);
    expect(dates.starts_on).toBe("2026-12-29");
    expect(dates.ends_on).toBe("2026-12-31");
  });
});
