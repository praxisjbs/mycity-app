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

  test("a day off has no hours, so a task due on one closes at 17:00", () => {
    // The working-week loader hands a day off's empty closing time back as the text "null".
    const offDay = workingWeek.makeCalendar({ days: [1, 2, 3, 4, 5, 6], hours: { ...hours, 7: { starts_at: "null", ends_at: "null" } } });
    expect(recurrence.dueFor({ due_on: "2026-10-18" }, "2026-10-21", offDay).toISOString()).toBe("2026-10-18T16:00:00.000Z");
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

describe("commitments on the task form (docs/guides/performance.md §6.11)", () => {
  const base = { title: "Launch the Lekki guide", is_commitment: true, acceptance_criteria: "Live on the app", commitment_month: "2026-11-01", due_on: "2026-11-12" };
  const problems = (body) => {
    const r = c.tasks.TaskCreate.safeParse(body);
    return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));
  };

  test("a commitment carries its criteria, its month and a due date in that month", () => {
    expect(problems(base)).toEqual({});
    expect(problems({ ...base, acceptance_criteria: undefined })).toEqual({ acceptance_criteria: "Give the criteria" });
    expect(problems({ ...base, commitment_month: undefined })).toEqual({ commitment_month: "Pick the month" });
    expect(problems({ ...base, due_on: undefined })).toEqual({ due_on: "Pick a due date" });
    expect(problems({ ...base, due_on: "2026-12-01" })).toEqual({ due_on: "Not in that month" });
  });

  test("a month is its first day; a plain task needs none of it", () => {
    expect(problems({ ...base, commitment_month: "2026-11-15" })).toHaveProperty("commitment_month");
    expect(problems({ title: "Call the venue" })).toEqual({});
  });

  test("Counts Towards names a line or a key result, with its link", () => {
    const { toTask } = require("./tasks.service");
    const row = { task_id: "t", title: "x", status: "todo", priority: "normal", comment_count: 0, is_commitment: false };
    expect(toTask({ ...row, employee_target_id: "l", target_title: "Publish 12 stories" }).counts_towards).toMatchObject({
      kind: "line",
      employee_target_id: "l",
      title: "Publish 12 stories",
      link: expect.objectContaining({ module: "performance", tab: "targets" }),
    });
    expect(toTask({ ...row, entity_type: "key_result", entity_id: "k", kr_code: "BM-KR1.1", kr_statement: "Grow users" }).counts_towards).toMatchObject({
      kind: "key_result",
      okr_key_result_id: "k",
      title: "BM-KR1.1 Grow users",
    });
    expect(toTask(row).counts_towards).toBeNull();
  });
});
