"use strict";
/**
 * Home · Team end to end (docs/guides/home.md §5, §6 Team, §8, §9): the real migrations and
 * reference seeds, the whole app over HTTP, every response parsed with its contract
 * (APP_ENV=test checks each one too). Who may open the tab and whose rows they read, the
 * four cards against the records behind each, the roster's filters and sorts, Attendance
 * This Month against My Attendance's own figures, paging at 25, and the assistant's read.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/home-team
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public
 * schema. Every person here is invented. Calls over HTTP read today; the figures that depend
 * on the day are read through the Team service on Wednesday 14 October 2026, after a week
 * the attendance module recorded and closed (Thursday 1 October is a public holiday and
 * Saturday a short day in the seeded working week).
 *
 * Thirty people: the CEO, an Operations lead, a line manager over two reports and one
 * below them, and twenty-five more in Operations, so every list of everyone is two pages.
 */
const request = require("supertest");
const c = require("@mycity/contract");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const rbac = require("../../src/middleware/rbac");
const lagos = require("../../src/shared/time/lagos");
const workingWeek = require("../../src/shared/time/working-week");
const aiRegistry = require("../../src/shared/ai/registry");
const authorise = require("../../src/shared/ai/authorise");
const realtime = require("../../src/services/realtime/emitter");
const attendanceRepo = require("../../src/modules/attendance/attendance.repo");
const reconcile = require("../../src/modules/attendance/attendance.reconcile");
const roster = require("../../src/modules/attendance/attendance.roster");
const service = require("../../src/modules/dashboard/dashboard.service");
const team = require("../../src/modules/dashboard/dashboard.team");

// The queues and the socket emitter would hold Redis connections open past the run.
jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const d = c.dashboard;
const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const PASSWORD = "Home-Team9Test";

/** The pinned day: Wednesday 14 October 2026, noon in Lagos. */
const TODAY = "2026-10-14";
const NOW = lagos.instant(TODAY, "12:00");
const at = (date, hhmm) => lagos.instant(date, hhmm);

/** A service answer as the wire carries it: what the route's response check parses. */
const wire = (value) => JSON.parse(JSON.stringify(value));

const names = (rows) => rows.map((r) => r.employee.display_name).sort();

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

async function drain() {
  for (let i = 0; i < 10; i += 1) {
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
    const r = await outbox.dispatchDue({ db: pool });
    if (r.claimed === 0) return;
  }
}

describeDb("Home · Team against the real migrations", () => {
  let app;
  const people = {};
  const ids = {};
  const tokens = {};
  const users = {};
  const departments = {};
  let headOffice;
  let staffNumber = 0;
  let today;
  let yesterday;

  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
  });

  /** A list over HTTP, every page, each parsed with its contract. */
  async function everyPage(who, path, schema) {
    const rows = [];
    for (let n = 1; ; n += 1) {
      const res = await as(who).get(`${path}${path.includes("?") ? "&" : "?"}page=${n}`);
      expect([path, res.status]).toEqual([path, 200]);
      const page = schema.parse(res.body);
      rows.push(...page.data);
      if (!page.page.has_next) return rows;
    }
  }

  /**
   * Someone People · Employees added, with a login of their own that never signs in here: someone with
   * no active login is never expected to clock in (attendance.md §6.4).
   */
  async function person(key, first, last, { department = "Operations", manager = null, pattern = "on_site" } = {}) {
    staffNumber += 1;
    const row = await one(
      `INSERT INTO employee (staff_number, first_name, last_name, work_email, job_title, department_id,
                             employment_type, work_pattern, start_date, line_manager_id, status)
       VALUES ($1, $2, $3, $4, 'Field Officer', $5, 'full_time', $6, '2026-01-05', $7, 'active')
       RETURNING employee_id`,
      [
        `T${String(staffNumber).padStart(4, "0")}`,
        first,
        last,
        `${first}.${last}@team.mycity.test`.toLowerCase(),
        departments[department],
        pattern,
        manager ? ids[manager] : null,
      ],
    );
    ids[key] = row.employee_id;
    await q("INSERT INTO app_user (employee_id, email, password_hash) VALUES ($1, $2, 'not-a-hash')", [
      row.employee_id,
      `${first}.${last}.${staffNumber}@login.team.mycity.test`.toLowerCase(),
    ]);
  }

  /** A punch as the attendance service records one: the event on its work date, then the day recalculated. */
  async function punch(who, type, date, hhmm) {
    await q(
      `INSERT INTO attendance_event (employee_id, event_type, occurred_at, work_date, worksite_id, source, validation_state)
       VALUES ($1, $2, $3, $4, $5, 'pwa', 'accepted')`,
      [ids[who], type, at(date, hhmm), date, headOffice],
    );
    await reconcile.recomputeDay(pool, await attendanceRepo.person(pool, ids[who]), date);
  }

  const homeScope = (who) => rbac.scopeFor(users[who], "home", "view");

  beforeAll(async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    await rebuild(pool, config.DB_NAME);
    workingWeek.invalidateCalendar();
    outbox.markReady();
    aiRegistry.load();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    ({ worksite_id: headOffice } = await one(
      `INSERT INTO worksite (code, name, latitude, longitude, radius_m)
       VALUES ('HQ_TEAM', 'Head Office', 6.4281, 3.4219, 150) RETURNING worksite_id`,
    ));

    const make = (who, first, last, role, job, department, isCeo = false) =>
      tx(async (client) => {
        people[who] = await createAdmin(
          client,
          {
            employee: {
              first_name: first,
              last_name: last,
              work_email: `${who}@team.mycity.test`,
              phone: "08031234567",
              job_title: job,
              department_name: department,
              start_date: "2026-01-05",
              employment_type: "full_time",
              work_pattern: "on_site",
            },
            role_code: role,
            is_ceo: isCeo,
          },
          PASSWORD,
          { allowAdditional: true },
        );
        ids[who] = people[who].employee.employee_id;
      });
    await make("ceo", "Ifeoma", "Nwankwo", "management", "Chief Executive Officer", "Management", true);
    await make("ops", "Tunde", "Bakare", "operations_people", "Operations Lead", "Operations");
    await make("manager", "Kemi", "Alade", "manager", "Programme Lead", "Programmes");
    await make("staff", "Musa", "Danjuma", "employee", "Field Officer", "Programmes");
    for (const { department_id: id, name } of (await q("SELECT department_id, name FROM department")).rows)
      departments[name] = id;
    ({ department_id: departments["Field Operations"] } = await one(
      "INSERT INTO department (code, name) VALUES ('TEAM_FIELD', 'Field Operations') RETURNING department_id",
    ));

    // Kemi manages Musa and Zainab (who works remotely); Ade reports to Musa, in another department.
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [ids.manager, ids.staff]);
    await person("remote", "Zainab", "Lawal", { department: "Programmes", manager: "manager", pattern: "remote" });
    await person("sub", "Ade", "Ogun", { department: "Field Operations", manager: "staff" });
    await person("late", "Bisi", "Ojo");
    await person("away", "Chidi", "Eze");
    for (let n = 1; n <= 22; n += 1) await person(`filler${n}`, "Filler", `Number${String(n).padStart(2, "0")}`);
    await grantsCache.bumpTeamVersion();
    await drain();

    // The week before the pinned day, as the attendance module records it.
    const { leave_type_id: annual } = await one("SELECT leave_type_id FROM leave_type WHERE code = 'annual'");
    await q(
      `INSERT INTO leave_request (employee_id, leave_type_id, starts_on, ends_on, amount, status)
       VALUES ($1, $2, '2026-10-12', $3, 3, 'approved')`,
      [ids.away, annual, TODAY],
    );
    for (const [who, inAt, outAt] of [
      ["ops", "08:45", "17:00"],
      ["manager", "08:55", "17:00"],
      ["staff", "09:20", "17:00"],
      ["remote", "08:50", "17:00"],
    ]) {
      await punch(who, "clock_in", "2026-10-09", inAt);
      await punch(who, "clock_out", "2026-10-09", outAt);
    }
    for (const [who, inAt, outAt] of [
      ["ops", "08:30", "17:00"],
      ["manager", "08:50", "17:10"],
      ["staff", "08:58", null], // Musa never clocked out on Tuesday
      ["remote", "08:40", "16:00"],
    ]) {
      await punch(who, "clock_in", "2026-10-13", inAt);
      if (outAt) await punch(who, "clock_out", "2026-10-13", outAt);
    }
    // The pinned day: Musa is late, and still carries Tuesday's open shift.
    for (const [who, inAt] of [
      ["ops", "08:40"],
      ["manager", "08:50"],
      ["remote", "08:55"],
      ["staff", "09:12"],
      ["late", "09:30"],
    ])
      await punch(who, "clock_in", TODAY, inAt);
    // The pinned day's 01:30 day-close: every working day before it is closed.
    await reconcile.closeDays({ now: at(TODAY, "01:30") });

    // Today, over HTTP: three people in by 08:50, and Musa's last working day left open.
    today = lagos.today();
    yesterday = workingWeek.addWorkingDays(today, -1, await workingWeek.loadCalendar(pool));
    await punch("ops", "clock_in", today, "08:40");
    await punch("remote", "clock_in", today, "08:45");
    await punch("manager", "clock_in", today, "08:50");
    await punch("staff", "clock_in", yesterday, "09:00");

    let ip = 0;
    for (const who of Object.keys(people)) {
      ip += 1;
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.73.0.${ip}`)
        .send({ email: `${who}@team.mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[who] = res.body.access_token;
      users[who] = await grantsCache.getAuthUser(pool, people[who].user.user_id);
    }
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  /* ---------------------------------------------------------------- *
   * Who may open the tab, and whose rows they read
   * ---------------------------------------------------------------- */

  describe("who sees whom", () => {
    const PATHS = ["/home/team/summary", "/home/team", "/home/team/attendance"];

    test("signed out it is a 401", async () => {
      for (const path of PATHS) expect([path, (await request(app).get(`/api/v1${path}`)).status]).toEqual([path, 401]);
    });

    test("a member of staff without `home.team` is refused all three, as a missing authority", async () => {
      for (const path of PATHS) {
        const res = await as("staff").get(path);
        expect([path, res.status, res.body.error && res.body.error.code]).toEqual([path, 403, "CAPABILITY_REQUIRED"]);
      }
    });

    test("a line manager sees themselves and everyone below them on the solid line, and nobody else", async () => {
      const summary = d.HomeTeamSummary.parse((await as("manager").get("/home/team/summary")).body);
      expect(summary).toMatchObject({ date: today, scope: "team" });
      const expected = ["Ade Ogun", "Kemi Alade", "Musa Danjuma", "Zainab Lawal"];
      expect(names(await everyPage("manager", "/home/team", d.HomeTeamPage))).toEqual(expected);
      expect(names(await everyPage("manager", "/home/team/attendance", d.HomeTeamAttendancePage))).toEqual(expected);
    });

    test("Operations see the whole organisation: thirty people, two pages of 25", async () => {
      expect(d.HomeTeamSummary.parse((await as("ops").get("/home/team/summary")).body).scope).toBe("all");
      for (const [path, schema] of [
        ["/home/team", d.HomeTeamPage],
        ["/home/team/attendance", d.HomeTeamAttendancePage],
      ]) {
        const first = schema.parse((await as("ops").get(path)).body);
        expect([path, first.data.length, first.page]).toEqual([
          path,
          25,
          { number: 1, size: 25, total: 30, pages: 2, has_next: true },
        ]);
        const second = schema.parse((await as("ops").get(`${path}?page=2`)).body);
        expect([path, second.data.length, second.page.has_next]).toEqual([path, 5, false]);
        const seen = new Set([...first.data, ...second.data].map((r) => r.employee.employee_id));
        expect([path, seen.size]).toEqual([path, 30]);
      }
    });

    test("the CEO sees everyone", async () => {
      expect(d.HomeTeamSummary.parse((await as("ceo").get("/home/team/summary")).body).scope).toBe("all");
      expect(d.HomeTeamPage.parse((await as("ceo").get("/home/team")).body).page.total).toBe(30);
    });

    test("`home.team` given to someone whose grant is their own opens the tab on themselves alone", async () => {
      const userId = people.staff.user.user_id;
      await q(
        `INSERT INTO user_capability (user_id, capability_id)
         SELECT $1, capability_id FROM capability WHERE code = 'home.team'`,
        [userId],
      );
      await grantsCache.invalidateUser(userId);
      try {
        expect(d.HomeTeamSummary.parse((await as("staff").get("/home/team/summary")).body).scope).toBe("own");
        expect(names(await everyPage("staff", "/home/team", d.HomeTeamPage))).toEqual(["Musa Danjuma"]);
        expect(names(await everyPage("staff", "/home/team/attendance", d.HomeTeamAttendancePage))).toEqual(["Musa Danjuma"]);
      } finally {
        await q("DELETE FROM user_capability WHERE user_id = $1", [userId]);
        await grantsCache.invalidateUser(userId);
      }
      expect((await as("staff").get("/home/team")).status).toBe(403);
    });
  });

  /* ---------------------------------------------------------------- *
   * The four cards and the records behind each
   * ---------------------------------------------------------------- */

  describe("the cards", () => {
    /**
     * Each card's figure is the number of records behind it: Present Today the people in its
     * On Site, Remote and Late chips; each chip's count its own records; the others their list.
     * `records(key, group)` is a page total, `meta(key)` the card's chips.
     */
    async function holdsItsRecords(cards, records, meta) {
      expect(cards.map((card) => card.key)).toEqual(["team_present", "team_on_site", "team_remote", "team_flags"]);
      for (const card of cards) {
        const chips = (await meta(card.key)).groups;
        for (const chip of chips) expect([card.key, chip.value, await records(card.key, chip.value)]).toEqual([card.key, chip.value, chip.count]);
        if (card.key === "team_present") {
          const present = chips.filter((chip) => ["on_site", "remote", "late"].includes(chip.value));
          expect(present.reduce((n, chip) => n + chip.count, 0)).toBe(card.value);
        } else {
          expect([card.key, await records(card.key)]).toEqual([card.key, card.value]);
        }
      }
    }

    test("on the pinned day, a line manager's: three of four in, one on site, one remote, Musa flagged once", async () => {
      const { cards } = d.HomeTeamSummary.parse(wire(await team.summary(users.manager, await homeScope("manager"), { now: NOW })));
      expect(cards.map((card) => [card.key, card.value, card.denominator, card.caption])).toEqual([
        ["team_present", 3, 4, null],
        ["team_on_site", 1, null, null],
        ["team_remote", 1, null, null],
        ["team_flags", 1, null, "1 late, 1 no clock-out"],
      ]);
      const flagged = await service.kpiPage(users.manager, "team_flags", { page: 1 }, { now: NOW });
      expect(flagged.data.map((r) => r.cells.employee.person.display_name)).toEqual(["Musa Danjuma"]);
      await holdsItsRecords(
        cards,
        async (key, group) => (await service.kpiPage(users.manager, key, { page: 1, group }, { now: NOW })).page.total,
        (key) => service.kpiMeta(users.manager, key, { now: NOW }),
      );
    });

    test("on the pinned day, the organisation's: five of twenty-nine in, Chidi on leave, two flagged", async () => {
      const { cards } = d.HomeTeamSummary.parse(wire(await team.summary(users.ops, await homeScope("ops"), { now: NOW })));
      expect(cards.map((card) => [card.key, card.value, card.denominator, card.caption])).toEqual([
        ["team_present", 5, 29, "1 on leave"],
        ["team_on_site", 2, null, null],
        ["team_remote", 1, null, null],
        ["team_flags", 2, null, "2 late, 1 no clock-out"],
      ]);
      await holdsItsRecords(
        cards,
        async (key, group) => (await service.kpiPage(users.ops, key, { page: 1, group }, { now: NOW })).page.total,
        (key) => service.kpiMeta(users.ops, key, { now: NOW }),
      );
    });

    test("today over HTTP, for each reader, every card equals the records it opens", async () => {
      for (const who of ["manager", "ops", "ceo"]) {
        const { cards } = d.HomeTeamSummary.parse((await as(who).get("/home/team/summary")).body);
        await holdsItsRecords(
          cards,
          async (key, group) => {
            const res = await as(who).get(`/home/kpi/${key}${group ? `?group=${group}` : ""}`);
            expect(res.status).toBe(200);
            return d.HomeKpiDetailPage.parse(res.body).page.total;
          },
          async (key) => d.HomeKpiDetailMeta.parse((await as(who).get(`/home/kpi/${key}/meta`)).body),
        );
      }
      const { cards } = d.HomeTeamSummary.parse((await as("manager").get("/home/team/summary")).body);
      expect(cards.find((card) => card.key === "team_flags").value).toBe(1); // Musa's open shift
    });
  });

  /* ---------------------------------------------------------------- *
   * The roster
   * ---------------------------------------------------------------- */

  describe("the roster", () => {
    test("on the pinned day: each person's status, clock-in and worksite; KPI and Open Tasks null until M2", async () => {
      const ops = await homeScope("ops");
      const page = d.HomeTeamPage.parse(wire(await team.roster(ops, { page: 1, q: "danjuma" }, { now: NOW })));
      expect(page.data).toEqual([
        {
          employee: { employee_id: ids.staff, display_name: "Musa Danjuma", job_title: "Field Officer", department: "Programmes", photo_url: null },
          department_id: departments.Programmes,
          status: "late",
          clock_in_at: at(TODAY, "09:12").toISOString(),
          clock_out_at: null,
          worksite: "Head Office",
          no_clock_out_yesterday: true,
          kpi_percent: null,
          open_tasks: null,
        },
      ]);
      const zainab = (await team.roster(ops, { page: 1, q: "lawal" }, { now: NOW })).data[0];
      expect(zainab).toMatchObject({ status: "remote", worksite: null });
    });

    test("filters by status, the yesterday flag, department and name, in the reader's scope", async () => {
      const ops = await homeScope("ops");
      const read = async (query, scope = ops) => names((await team.roster(scope, { page: 1, ...query }, { now: NOW })).data);
      expect(await read({ status: "late" })).toEqual(["Bisi Ojo", "Musa Danjuma"]);
      expect(await read({ status: "on_leave" })).toEqual(["Chidi Eze"]);
      expect(await read({ no_clock_out_yesterday: "true" })).toEqual(["Musa Danjuma"]);
      expect(await read({ department_id: departments["Field Operations"] })).toEqual(["Ade Ogun"]);
      expect(await read({ status: "late" }, await homeScope("manager"))).toEqual(["Musa Danjuma"]);
      expect(await read({ status: "on_site", department_id: departments.Programmes })).toEqual(["Kemi Alade"]);
    });

    test("sorts by name unless told otherwise, by department, or by Clock-In with nobody in last", async () => {
      const ops = await homeScope("ops");
      const sorted = async (field, dir = "asc") =>
        (await team.roster(ops, { page: 1, sort: { field, dir } }, { now: NOW })).data;
      const earliest = await sorted("clock_in_at");
      expect(earliest.slice(0, 5).map((r) => r.employee.display_name)).toEqual([
        "Tunde Bakare",
        "Kemi Alade",
        "Zainab Lawal",
        "Musa Danjuma",
        "Bisi Ojo",
      ]);
      expect(earliest.slice(5).every((r) => r.clock_in_at === null)).toBe(true);
      const byDepartment = (await sorted("department")).map((r) => r.employee.department);
      expect(byDepartment).toEqual([...byDepartment].sort());
      const byDefault = await team.roster(ops, { page: 1 }, { now: NOW });
      expect(byDefault.data[0].employee.display_name).toBe("Kemi Alade");
    });

    test("today over HTTP: the same filters, sorts and refusals", async () => {
      const read = async (who, query) => names(await everyPage(who, `/home/team?${query}`, d.HomeTeamPage));
      expect(await read("manager", "status=on_site")).toEqual(["Kemi Alade"]);
      expect(await read("manager", "status=remote")).toEqual(["Zainab Lawal"]);
      expect(await read("manager", "no_clock_out_yesterday=true")).toEqual(["Musa Danjuma"]);
      expect(await read("manager", `department_id=${departments["Field Operations"]}`)).toEqual(["Ade Ogun"]);
      expect(await read("ops", "q=danjuma")).toEqual(["Musa Danjuma"]);
      const latest = d.HomeTeamPage.parse((await as("ops").get("/home/team?sort=-clock_in_at")).body);
      expect(latest.data.slice(0, 3).map((r) => r.employee.display_name)).toEqual(["Kemi Alade", "Zainab Lawal", "Tunde Bakare"]);
      for (const query of ["status=present", "limit=5", "sort=status", "no_clock_out_yesterday=yes", "nonsense=1"])
        expect([query, (await as("ops").get(`/home/team?${query}`)).status]).toEqual([query, 422]);
    });
  });

  /* ---------------------------------------------------------------- *
   * Attendance This Month
   * ---------------------------------------------------------------- */

  describe("Attendance This Month", () => {
    test("on the pinned day: each person's month so far is My Attendance's, from one paged read", async () => {
      const ops = await homeScope("ops");
      const rows = [];
      for (let n = 1; ; n += 1) {
        const page = d.HomeTeamAttendancePage.parse(wire(await team.month(ops, { page: n }, { now: NOW })));
        rows.push(...page.data);
        if (!page.page.has_next) break;
      }
      expect(rows).toHaveLength(30);
      for (const r of rows) {
        const mine = roster.totalsOf(await attendanceRepo.daysSummary(pool, r.employee.employee_id, "2026-10-01", TODAY));
        const { employee, ...totals } = r;
        expect({ who: employee.display_name, ...totals }).toEqual({ who: employee.display_name, ...mine });
      }
      const of = (id) => rows.find((r) => r.employee.employee_id === id);
      // Late on the 9th and today, absent on the closed Saturday and Monday, on time on Tuesday.
      expect(of(ids.staff)).toMatchObject({ expected: 5, on_time: 1, late: 2, absent: 2, on_leave: 0 });
      // Absent on the 9th and 10th; on leave on the 12th and 13th; today's leave is not recorded yet.
      expect(of(ids.away)).toMatchObject({ expected: 2, on_time: 0, late: 0, absent: 2, on_leave: 2 });
    });

    test("in the reader's scope, by department, sorted by name or by the days on time", async () => {
      const manager = await homeScope("manager");
      const ops = await homeScope("ops");
      expect(names((await team.month(manager, { page: 1 }, { now: NOW })).data)).toEqual([
        "Ade Ogun",
        "Kemi Alade",
        "Musa Danjuma",
        "Zainab Lawal",
      ]);
      expect(names((await team.month(ops, { page: 1, department_id: departments.Programmes }, { now: NOW })).data)).toEqual([
        "Kemi Alade",
        "Musa Danjuma",
        "Zainab Lawal",
      ]);
      const most = (await team.month(ops, { page: 1, sort: { field: "on_time", dir: "desc" } }, { now: NOW })).data;
      expect(most.map((r) => r.on_time)).toEqual([...most.map((r) => r.on_time)].sort((a, b) => b - a));
      expect(most[0].on_time).toBe(3);
    });

    test("today over HTTP: every row equals My Attendance's figures from the 1st to today", async () => {
      const rows = await everyPage("ops", "/home/team/attendance", d.HomeTeamAttendancePage);
      expect(rows).toHaveLength(30);
      const from = lagos.monthBounds(today).first;
      for (const r of rows) {
        const mine = roster.totalsOf(await attendanceRepo.daysSummary(pool, r.employee.employee_id, from, today));
        const { employee, ...totals } = r;
        expect({ who: employee.display_name, ...totals }).toEqual({ who: employee.display_name, ...mine });
      }
      const sorted = d.HomeTeamAttendancePage.parse((await as("ops").get("/home/team/attendance?sort=-on_time")).body);
      expect(sorted.data.map((r) => r.on_time)).toEqual([...sorted.data.map((r) => r.on_time)].sort((a, b) => b - a));
      for (const query of ["status=late", "limit=5", "sort=late"])
        expect([query, (await as("ops").get(`/home/team/attendance?${query}`)).status]).toEqual([query, 422]);
    });
  });

  /* ---------------------------------------------------------------- *
   * The assistant
   * ---------------------------------------------------------------- */

  describe("the assistant", () => {
    test("team.today: the asker's Team roster in their scope, cited by person", async () => {
      const read = await authorise.runRead(pool, users.manager, "team.today", {});
      expect(read.list).toBe(true);
      expect(d.HomeTeamPage.parse(wire({ data: read.data, page: read.page })).page.total).toBe(4);
      expect(names(read.data)).toEqual(["Ade Ogun", "Kemi Alade", "Musa Danjuma", "Zainab Lawal"]);
      expect(read.citations.map((cite) => cite.type)).toEqual(["employee", "employee", "employee", "employee"]);
      const flagged = await authorise.runRead(pool, users.manager, "team.today", { no_clock_out_yesterday: "true" });
      expect(names(flagged.data)).toEqual(["Musa Danjuma"]);
    });

    test("team.today pages at 25 for the whole organisation", async () => {
      const second = await authorise.runRead(pool, users.ops, "team.today", { page: 2 });
      expect(second.page).toEqual({ number: 2, size: 25, total: 30, pages: 2, has_next: false });
      expect(second.data).toHaveLength(5);
    });

    test("team.today is an empty page for someone without `home.team`, though every login holds `home` view", async () => {
      const read = await authorise.runRead(pool, users.staff, "team.today", {});
      expect(read.data).toEqual([]);
      expect(read.page).toEqual({ number: 1, size: 25, total: 0, pages: 0, has_next: false });
      expect(read.citations).toEqual([]);
    });
  });
});
