"use strict";
/**
 * Tasks: when a task is due, when a repeat comes round, who may set and manage a task,
 * and the shape of the routes. The board end to end (A24, scope, moves, cancel) runs
 * against Postgres in tests/integration/workspace.test.js.
 */
const c = require("@mycity/contract");
const { routesOf } = require("../../http/route");
const workingWeek = require("../../shared/time/working-week");
const recurrence = require("./tasks.recurrence");
const audience = require("./tasks.audience");

// Monday to Saturday, as MyCity works (A22): 17:00 on weekdays, 15:00 on Saturday.
const hours = { 1: { ends_at: "17:00" }, 2: { ends_at: "17:00" }, 3: { ends_at: "17:00" }, 4: { ends_at: "17:00" }, 5: { ends_at: "17:00" }, 6: { ends_at: "15:00" } };
const cal = workingWeek.makeCalendar({
  days: [1, 2, 3, 4, 5, 6],
  holidays: [{ holiday_date: "2026-12-25", name: "Christmas Day" }],
  hours,
});

describe("when a task is due", () => {
  test("a day given is due at that day's close, Lagos time", () => {
    expect(recurrence.dueFor({ due_on: "2026-10-21" }, "2026-10-19", cal).toISOString()).toBe("2026-10-21T16:00:00.000Z");
    expect(recurrence.dueFor({ due_on: "2026-10-24" }, "2026-10-19", cal).toISOString()).toBe("2026-10-24T14:00:00.000Z");
  });

  test("Daily is today's close, or the next working day's on a Sunday", () => {
    expect(recurrence.dueFor({ cadence: "daily" }, "2026-10-20", cal).toISOString()).toBe("2026-10-20T16:00:00.000Z");
    expect(recurrence.dueFor({ cadence: "daily" }, "2026-10-25", cal).toISOString()).toBe("2026-10-26T16:00:00.000Z");
  });

  test("Weekly is the week's last working day, Saturday at 15:00", () => {
    expect(recurrence.dueFor({ cadence: "weekly" }, "2026-10-19", cal).toISOString()).toBe("2026-10-24T14:00:00.000Z");
    expect(recurrence.dueFor({ cadence: "weekly" }, "2026-10-24", cal).toISOString()).toBe("2026-10-24T14:00:00.000Z");
    expect(recurrence.dueFor({ cadence: "weekly" }, "2026-10-25", cal).toISOString()).toBe("2026-10-31T14:00:00.000Z");
  });

  test("no day and no cadence is no due date", () => {
    expect(recurrence.dueFor({}, "2026-10-19", cal)).toBeNull();
  });
});

describe("when a repeat comes round", () => {
  test("daily skips Sunday and public holidays", () => {
    expect(recurrence.nextDay({ freq: "daily" }, "2026-10-24", cal)).toBe("2026-10-26");
    expect(recurrence.nextDay({ freq: "daily" }, "2026-12-24", cal)).toBe("2026-12-26");
  });

  test("weekly takes the next chosen weekday, counted from the last occurrence", () => {
    expect(recurrence.nextDay({ freq: "weekly", days: [1, 4] }, "2026-10-19", cal)).toBe("2026-10-22");
    expect(recurrence.nextDay({ freq: "weekly", days: [1, 4] }, "2026-10-22", cal)).toBe("2026-10-26");
  });

  test("monthly keeps its day, moved to the next working day", () => {
    expect(recurrence.nextDay({ freq: "monthly", day_of_month: 25 }, "2026-10-26", cal)).toBe("2026-11-25");
    expect(recurrence.nextDay({ freq: "monthly", day_of_month: 25 }, "2026-11-25", cal)).toBe("2026-12-26");
  });

  test("a rule the contract does not know is refused before it is saved", () => {
    expect(c.tasks.Recurrence.safeParse({ freq: "hourly" }).success).toBe(false);
    expect(c.tasks.Recurrence.safeParse({ freq: "weekly", days: [7] }).success).toBe(false);
  });
});

describe("who may set and manage a task (A24)", () => {
  const manager = { scope: "team", scope_ids: ["m", "a", "b"], employee_id: "m" };
  const staff = { scope: "own", scope_ids: ["a"], employee_id: "a" };

  test("a manager sets work for their line; staff only for themselves", () => {
    expect(audience.maySetFor(manager, "a")).toBe(true);
    expect(audience.maySetFor(manager, "z")).toBe(false);
    expect(audience.maySetFor(staff, "a")).toBe(true);
    expect(audience.maySetFor(staff, "b")).toBe(false);
  });

  test("the assignee of a manager's task may not manage it; the manager may", () => {
    const task = { primary_assignee_id: "a", set_by_employee_id: "m" };
    expect(audience.mayManage(staff, task)).toBe(false);
    expect(audience.mayManage(manager, task)).toBe(true);
    expect(audience.mayManage(staff, { primary_assignee_id: "a", set_by_employee_id: "a" })).toBe(true);
  });

  test("a co-assignee sees the task; someone outside does not", () => {
    const task = { primary_assignee_id: "a", set_by_employee_id: "m" };
    expect(audience.maySee({ scope: "own", scope_ids: ["b"], employee_id: "b" }, task, true)).toBe(true);
    expect(audience.maySee({ scope: "own", scope_ids: ["b"], employee_id: "b" }, task, false)).toBe(false);
  });
});

describe("the routes", () => {
  const routes = routesOf(require("./tasks.routes").router);

  test("every route carries a workspace permission", () => {
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) expect(r.permission && r.permission.key).toBe("workspace");
  });

  test("the board pages through the contract's controls, with no page size", () => {
    const list = routes.find((r) => r.method === "GET" && r.path === "/");
    const keys = Object.keys(list.contract.query.shape);
    expect(keys).toEqual(expect.arrayContaining(["page", "q", "sort", "status", "scope"]));
    for (const k of ["limit", "offset", "per_page", "page_size"]) expect(keys).not.toContain(k);
  });
});
