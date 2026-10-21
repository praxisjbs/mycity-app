"use strict";
/**
 * Calendar: the shapes a month and an event take, and the routes. Invitations, answers
 * and the deadlines on a month run against Postgres in tests/integration/workspace.test.js.
 */
const c = require("@mycity/contract");
const { routesOf } = require("../../http/route");

describe("an event's times", () => {
  test("an event that ends before it starts is refused", () => {
    const r = c.calendar.CalendarEventCreate.safeParse({
      title: "Venue review",
      starts_at: "2026-10-20T10:00:00.000Z",
      ends_at: "2026-10-20T09:00:00.000Z",
    });
    expect(r.success).toBe(false);
  });

  test("a month is YYYY-MM", () => {
    expect(c.calendar.CalendarListQuery.safeParse({ month: "2026-10" }).success).toBe(true);
    expect(c.calendar.CalendarListQuery.safeParse({ month: "2026-13" }).success).toBe(false);
  });
});

describe("the routes", () => {
  test("every route carries a workspace permission", () => {
    const routes = routesOf(require("./calendar.routes").router);
    expect(routes.length).toBe(6);
    for (const r of routes) expect(r.permission && r.permission.key).toBe("workspace");
  });
});
