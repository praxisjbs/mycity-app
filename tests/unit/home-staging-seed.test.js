"use strict";
/**
 * Home's staging seed (seeds/staging/60_home.js, docs/guides/home.md §11) without a database:
 * the ids it gives the rows it writes into later milestones' tables, the manifest those
 * milestones delete them by, every column it writes held to the schema the migrations build
 * (the schema gate does not read seeds/staging), and the attendance it plans. The seed itself
 * runs twice against the real migrations in tests/integration/home-staging-seed.test.js.
 */
const { buildCatalogue } = require("../../scripts/check/lib/catalogue");
const workingWeek = require("../../src/shared/time/working-week");
const lagos = require("../../src/shared/time/lagos");
const home = require("../../seeds/staging/60_home");
const forward = require("../../seeds/staging/lib/forward-rows");
const manifest = require("../../seeds/staging/lib/home-staging-rows");
const attendance = require("../../seeds/staging/lib/attendance");
const { uuid5 } = require("../../seeds/staging/lib/uuid5");

const schema = buildCatalogue();
const NOW = lagos.instant("2026-10-14", "12:00");
const CAL = workingWeek.makeCalendar({
  days: [1, 2, 3, 4, 5, 6],
  holidays: [{ holiday_date: "2026-10-01", name: "Independence Day" }],
  hours: { 6: { starts_at: "09:00", ends_at: "15:00" } },
});

/** Someone in every post the rows hang off, each with a login and a department. */
function fakeStaff() {
  let n = 0;
  const person = () => {
    n += 1;
    const hex = n.toString(16).padStart(12, "0");
    return {
      employee_id: `00000000-0000-4000-8000-${hex}`,
      user_id: `00000000-0000-4000-9000-${hex}`,
      department_id: "00000000-0000-4000-a000-000000000001",
      work_email: `person${n}@staff.mycity.test`,
    };
  };
  const head = person();
  const manager = person();
  const team = { [head.employee_id]: [person(), person(), person()], [manager.employee_id]: [person(), person()] };
  return {
    ceo: person(),
    operations: person(),
    head,
    manager,
    management: [person(), person()],
    reportsOf: (p) => team[p.employee_id] || [],
  };
}

const context = () =>
  forward.contextFrom({
    now: NOW,
    cal: CAL,
    categories: ["travel", "office", "training", "utilities", "professional_services"].map((code, i) => ({
      code,
      expense_category_id: `00000000-0000-4000-b000-00000000000${i}`,
    })),
    seats: [
      { title: "Head Sales & Revenue", department_id: "00000000-0000-4000-a000-000000000002" },
      { title: "Technical Assistant", department_id: "00000000-0000-4000-a000-000000000003" },
    ],
  });

describe("deterministic ids", () => {
  test("uuid5 gives the version 5 id the standard's own example gives", () => {
    expect(uuid5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
    expect(uuid5("partner:mtn-nigeria", forward.NAMESPACE)).toBe(forward.idOf("partner", "mtn-nigeria"));
    expect(() => uuid5("x", "not-a-uuid")).toThrow(/namespace/);
    expect(() => uuid5("", forward.NAMESPACE)).toThrow(/name/);
  });

  test("every row has its own id, and the same one on every run", () => {
    const ids = forward.ROWS.map((r) => forward.idOf(r.table, r.key));
    expect(new Set(ids).size).toBe(ids.length);
    expect(forward.ROWS.map((r) => forward.idOf(r.table, r.key))).toEqual(ids);
  });
});

describe("HOME_STAGING_ROWS, the manifest each milestone deletes by", () => {
  test("is what the seed exports, one entry a table, and lists every row it can write under its table", () => {
    expect(home.HOME_STAGING_ROWS).toBe(manifest.HOME_STAGING_ROWS);
    expect(forward.HOME_STAGING_ROWS).toBe(manifest.HOME_STAGING_ROWS);
    expect(home.HOME_STAGING_ROWS.map((e) => e.table)).toEqual([...manifest.DELETE_ORDER]);
    const listed = new Set(home.HOME_STAGING_ROWS.flatMap((e) => e.ids.map((id) => `${e.table} ${id}`)));
    for (const r of forward.ROWS) expect([r.table, r.key, listed.has(`${r.table} ${forward.idOf(r.table, r.key)}`)]).toEqual([r.table, r.key, true]);
    for (const entry of home.HOME_STAGING_ROWS) expect(entry.ids.length).toBeGreaterThan(0);
  });

  test("is written out, not worked out from the rows, so a row taken out of forward-rows.js keeps its id here", () => {
    jest.isolateModules(() => {
      jest.doMock("../../seeds/staging/lib/forward-rows", () => {
        throw new Error("the manifest reads no rows");
      });
      const alone = require("../../seeds/staging/lib/home-staging-rows");
      expect(alone.HOME_STAGING_ROWS.flatMap((e) => e.ids)).toEqual(manifest.HOME_STAGING_ROWS.flatMap((e) => e.ids));
    });
    for (const [table, byKey] of Object.entries(manifest.IDS))
      for (const [key, id] of Object.entries(byKey)) expect([table, key, id]).toEqual([table, key, forward.idOf(table, key)]);
  });

  test("names migrated tables of later milestones by their id columns, never a table Home owns", () => {
    for (const { table, id_column: idColumn } of home.HOME_STAGING_ROWS) {
      expect([table, schema.tables.has(table)]).toEqual([table, true]);
      expect([table, schema.tables.get(table).has(idColumn)]).toEqual([table, true]);
      expect(table).not.toMatch(/^(home_|saved_report|report_schedule|attendance_)/);
    }
  });

  test("lists a table after every table it writes rows that point at", () => {
    const at = (table) => forward.DELETE_ORDER.indexOf(table);
    for (const row of forward.ROWS) for (const [parent] of row.parents || []) expect(at(row.table)).toBeLessThan(at(parent));
  });

  test("an owner's removal deletes the alerts about its rows first, then the rows, children before parents", async () => {
    const calls = [];
    const db = {
      query: async (sql, params) => {
        calls.push([sql.split(" WHERE")[0], params[0].length]);
        return { rowCount: params[0].length };
      },
    };
    const tables = ["budget", "budget_line", "expense_request"];
    const ids = (t) => manifest.HOME_STAGING_ROWS.find((e) => e.table === t).ids.length;
    const done = await manifest.removeHomeStagingRows(db, tables);
    expect(calls).toEqual([
      ["DELETE FROM home_alert", tables.reduce((n, t) => n + ids(t), 0)],
      ["DELETE FROM expense_request", ids("expense_request")],
      ["DELETE FROM budget_line", ids("budget_line")],
      ["DELETE FROM budget", ids("budget")],
    ]);
    expect(done.rows).toBe(tables.reduce((n, t) => n + ids(t), 0));
    await expect(manifest.removeHomeStagingRows(db, ["home_alert"])).rejects.toThrow(/none of Home's staging rows/);
    calls.length = 0;
    expect(await manifest.removeRows(db, [{ table: "budget", ids: [] }])).toEqual({ rows: 0, alerts: 0 });
    expect(calls).toEqual([]);
  });
});

describe("the rows", () => {
  const x = context();
  const staff = fakeStaff();
  const written = forward.ROWS.map((row) => ({
    row,
    values: row.values(
      x,
      row.needs.map((slot) => forward.personOf(staff, slot)),
    ),
  }));

  test("with everyone in post, every row is written", () => {
    for (const { row, values } of written) expect([row.table, row.key, values === null]).toEqual([row.table, row.key, false]);
  });

  test("write only columns the migrations created", () => {
    for (const { row, values } of written)
      for (const column of Object.keys(values))
        expect([row.table, column, schema.tables.get(row.table).has(column)]).toEqual([row.table, column, true]);
  });

  test("money is Naira as numeric(18,2) text", () => {
    const MONEY = ["amount", "spent_amount", "value", "estimated_value"];
    for (const { values } of written) {
      for (const key of MONEY) if (key in values) expect(values[key]).toMatch(/^\d{1,16}\.\d{2}$/);
      if ("currency" in values) expect(values.currency).toBe("NGN");
    }
  });

  test("numbers carry STG, so none can be one the owning module gives", () => {
    const numbers = written.filter((w) => "number" in w.values).map((w) => w.values.number);
    expect(numbers.length).toBeGreaterThan(0);
    for (const n of numbers) expect(n).toMatch(/^[A-Z]{3}-STG-\d{2}$/);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  test("dates count from the run's day: targets inside the quarter, agreements inside the year", () => {
    expect(x.quarterName).toBe("Q4 2026");
    for (const { row, values } of written) {
      if (row.table === "employee_target") {
        expect(values.due_on >= x.today).toBe(true);
        expect(values.due_on <= x.quarter.to).toBe(true);
      }
      if (row.table === "partnership_agreement") expect(values.starts_on >= "2026-01-01").toBe(true);
      if (row.table === "calendar_event") expect(values.starts_at < values.ends_at).toBe(true);
    }
  });

  test("a row whose person has no login, or whose seat or category is missing, is left out", () => {
    const vacancy = forward.ROWS.find((r) => r.table === "vacancy" && r.key === "open-seat-2");
    const withoutSeats = { ...x, seats: x.seats.slice(0, 1) };
    expect(vacancy.values(withoutSeats, [staff.operations])).toBeNull();
    const task = forward.ROWS.find((r) => r.table === "task");
    expect(task.values(x, [staff.operations, { ...staff.ceo, user_id: null }])).toBeNull();
    const line = forward.ROWS.find((r) => r.table === "budget_line");
    expect(line.values({ ...x, categories: new Map() }, [])).toBeNull();
    expect(() => forward.personOf(staff, "chairman")).toThrow(/no post/);
  });

  test("a vacancy's number and slug follow its place among the open seats, never the seat's title", () => {
    const first = forward.ROWS.find((r) => r.table === "vacancy" && r.key === "open-seat-1");
    const before = first.values(x, [staff.operations]);
    const filled = first.values({ ...x, seats: x.seats.slice(1) }, [staff.operations]);
    expect(filled.title).not.toBe(before.title);
    expect([filled.number, filled.slug]).toEqual([before.number, before.slug]);
  });

  test("a row whose unique key would take a value a row before it holds is left out", () => {
    const keys = new Map(forward.DELETE_ORDER.map((table) => [table, []]));
    keys.set("performance_review", [["performance_cycle_id", "employee_id", "reviewer_employee_id", "review_type"]]);
    // One person in both posts: the Line Manager's team is the Head's, reviewed once.
    const plan = forward.planOf(forward.ROWS, x, { ...staff, manager: staff.head }, keys);
    const reviews = [...plan.values()].filter((p) => p.row.table === "performance_review").map((p) => p.row.key);
    expect(reviews).toHaveLength(6);
    expect(reviews.every((key) => /:head_team:\d$/.test(key))).toBe(true);
    expect(forward.planOf(forward.ROWS, x, staff, keys).size).toBe(forward.ROWS.length);
  });
});

describe("attendance", () => {
  const WEEKDAY = { working_day: true, starts_at: "09:00", ends_at: "17:00" };
  const person = { employee_id: "00000000-0000-4000-8000-000000000001", work_email: "ada@staff.mycity.test" };
  const tz = "Africa/Lagos";

  test("nobody punches on a day that is not worked", () => {
    expect(attendance.planDay(person, "2026-10-18", { working_day: false, starts_at: null, ends_at: null }, tz)).toEqual([]);
  });

  test("a day's plan is the same on every run, and a clock-out always follows the clock-in", () => {
    let date = "2026-01-05";
    const kinds = new Set();
    for (let i = 0; i < 300; i += 1, date = lagos.addDays(date, 1)) {
      const plan = attendance.planDay(person, date, WEEKDAY, tz);
      expect(attendance.planDay(person, date, WEEKDAY, tz)).toEqual(plan);
      if (plan.length === 2) expect(plan[0].at < plan[1].at).toBe(true);
      if (!plan.length) kinds.add("absent");
      else if (plan[0].at > lagos.instant(date, "09:00")) kinds.add("late");
      else kinds.add(plan.length === 1 ? "no_clock_out" : "on_time");
    }
    expect([...kinds].sort()).toEqual(["absent", "late", "no_clock_out", "on_time"]);
  });

  test("Saturday's clock-out follows Saturday's shorter day", () => {
    const saturday = { working_day: true, starts_at: "09:00", ends_at: "15:00" };
    let date = "2026-10-03";
    for (let i = 0; i < 20; i += 1, date = lagos.addDays(date, 7)) {
      const out = attendance.planDay(person, date, saturday, tz).find((p) => p.event_type === "clock_out");
      if (out) expect(lagos.timeOf(out.at) < "16:00").toBe(true);
    }
  });

  test("today and the 14 working days before it, holidays and Sundays skipped", () => {
    const days = attendance.daysOf("2026-10-14", CAL);
    expect(days).toHaveLength(attendance.HISTORY_DAYS + 1);
    expect(days[days.length - 1]).toBe("2026-10-14");
    expect(days).not.toContain("2026-10-01");
    expect(days).not.toContain("2026-10-11");
    expect(days[0]).toBe("2026-09-26");
  });
});

describe("the seed's own records", () => {
  test("rules and reports are valid as their screens would send them", () => {
    const c = require("@mycity/contract");
    for (const rule of home.RULES)
      expect(
        c.alerts.HomeAlertRuleCreate.safeParse({ ...rule, permission_key: c.alerts.HOME_ALERT_METRICS[rule.metric].permission_key })
          .success,
      ).toBe(true);
    for (const report of home.REPORTS) expect(c.reports.HOME_REPORT_SOURCES[report.report_key].offered).toBe(true);
  });
});
