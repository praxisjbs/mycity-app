"use strict";
/**
 * My Workspace: the periods Analytics reads and the start of Since You Were Away.
 * Today and Analytics end to end run in tests/integration/workspace.test.js.
 */
const workingWeek = require("../../shared/time/working-week");
const { periodOf } = require("./workspace.analytics");
const { sinceOf } = require("./workspace.today");

const cal = workingWeek.makeCalendar({ days: [1, 2, 3, 4, 5, 6] });

describe("Analytics periods", () => {
  test("30 and 90 days end today; the year starts on 1 January", () => {
    expect(periodOf("30d", "2026-10-19")).toEqual({ from: "2026-09-20", to: "2026-10-19" });
    expect(periodOf("90d", "2026-10-19")).toEqual({ from: "2026-07-22", to: "2026-10-19" });
    expect(periodOf("year", "2026-10-19")).toEqual({ from: "2026-01-01", to: "2026-10-19" });
  });
});

describe("Since You Were Away", () => {
  test("starts at the previous working day: Saturday for a Monday", () => {
    expect(sinceOf("2026-10-26", cal).toISOString()).toBe("2026-10-23T23:00:00.000Z");
    expect(sinceOf("2026-10-21", cal).toISOString()).toBe("2026-10-19T23:00:00.000Z");
  });
});

describe("the week (docs/guides/performance.md §6.18)", () => {
  const { thisMonday } = require("./workspace.week");
  const { routesOf } = require("../../http/route");

  test("runs Monday to Sunday in Lagos", () => {
    expect(thisMonday(new Date("2026-10-22T09:00:00Z"))).toBe("2026-10-19");
    expect(thisMonday(new Date("2026-10-25T22:30:00Z"))).toBe("2026-10-19");
    expect(thisMonday(new Date("2026-10-25T23:30:00Z"))).toBe("2026-10-26");
  });

  test("its routes carry the workspace permission; Team This Week pages with no page size", () => {
    const routes = routesOf(require("./workspace.routes").router);
    for (const r of routes) expect(r.permission && r.permission.key).toBe("workspace");
    const team = routes.find((r) => r.path === "/team-weeks");
    const keys = Object.keys(team.contract.query.shape);
    expect(keys).toEqual(expect.arrayContaining(["page", "q", "week_starts_on"]));
    for (const k of ["limit", "offset", "per_page", "page_size"]) expect(keys).not.toContain(k);
  });
});
