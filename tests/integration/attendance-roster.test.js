"use strict";
/**
 * The shared attendance roster (src/modules/attendance/attendance.roster.js) on the real
 * migrations and reference seeds: the seeded week (Monday to Friday 09:00, Saturday 09:00 to
 * 15:00, Sunday off), the seeded public holidays and the Attendance policy's versions (ten
 * minutes of grace to the end of August, none from September), with punches recorded the way the attendance module records them: the event on its
 * work date, then the day recalculated by the module's own reconcile.recomputeDay(), and the
 * days before Friday closed by its own day-close, as the 01:30 job would on Friday morning.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/attendance-roster
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public
 * schema. Every person here is invented. The days are the week of Independence Day 2026:
 * Monday 28 and Tuesday 29 September, Wednesday 30, the holiday on Thursday 1 October,
 * Friday 2, Saturday 3, Sunday 4 and Monday 5 October. A test that changes the working week
 * does it in a transaction it rolls back.
 *
 * Besides its own answers, every day here is held to the attendance register's
 * (repo.register, repo.registerSummary) and every person's days to My Attendance's
 * (repo.listDays, repo.daysSummary), so Home and the attendance screens cannot disagree.
 */
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { rebuild } = require("./helpers/schema");
const { attendanceVersion } = require("./helpers/policies");
const lagos = require("../../src/shared/time/lagos");
const workingWeek = require("../../src/shared/time/working-week");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const repo = require("../../src/modules/attendance/attendance.repo");
const reconcile = require("../../src/modules/attendance/attendance.reconcile");
const roster = require("../../src/modules/attendance/attendance.roster");
const c = require("@mycity/contract");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

const MONDAY_BEFORE = "2026-09-28";
const TUESDAY = "2026-09-29";
const WEDNESDAY = "2026-09-30";
const HOLIDAY = "2026-10-01";
const FRIDAY = "2026-10-02";
const SATURDAY = "2026-10-03";
const SUNDAY = "2026-10-04";
const MONDAY = "2026-10-05";

const ALL = Object.freeze({ scope: "all", scope_ids: null });
const at = (date, hhmm, seconds = 0) => new Date(lagos.instant(date, hhmm).getTime() + seconds * 1000);

/** The register's status (attendance.repo.js REGISTER) in Home's words, for the cross-checks. */
const homeWord = (r) =>
  ({
    leave: "on_leave",
    late: "late",
    absent: "absent",
    not_in: "not_in",
    off: null,
    present: r.work_pattern === "remote" ? "remote" : "on_site",
  })[r.status];

describeDb("the attendance roster against the real migrations", () => {
  const people = {};
  let ops;
  let headOffice;
  let staffNumber = 0;

  /** An active employee in the Test department unless told otherwise. */
  async function person(key, first, last, opts = {}) {
    staffNumber += 1;
    const row = await one(
      `INSERT INTO employee (staff_number, first_name, last_name, work_email, job_title, department_id,
                             employment_type, work_pattern, start_date, line_manager_id, status)
       VALUES ($1, $2, $3, $4, 'Officer', $5, 'full_time', $6, $7, $8, $9)
       RETURNING employee_id`,
      [
        `R${String(staffNumber).padStart(4, "0")}`,
        first,
        last,
        `${first}.${last}@roster.mycity.test`.toLowerCase(),
        opts.department || (await one("SELECT department_id FROM department WHERE code = 'TEST'")).department_id,
        opts.pattern || "on_site",
        opts.starts || "2026-01-05",
        opts.manager ? people[opts.manager] : null,
        opts.status || "active",
      ],
    );
    people[key] = row.employee_id;
    return row.employee_id;
  }

  /** The day recalculated by the attendance module, as a punch or a decision does it. */
  const recompute = async (key, date, client = pool) =>
    reconcile.recomputeDay(client, await repo.person(client, people[key]), date);

  /**
   * A punch as the attendance service records one: the event on its work date, then (unless
   * it was rejected, which changes nothing) the day recalculated.
   */
  async function punch(key, type, date, hhmm, { worksite = headOffice, state = "accepted", seconds = 0 } = {}) {
    const { attendance_event_id: id } = await one(
      `INSERT INTO attendance_event (employee_id, event_type, occurred_at, work_date, worksite_id, source, validation_state)
       VALUES ($1, $2, $3, $4, $5, 'pwa', $6) RETURNING attendance_event_id`,
      [people[key], type, at(date, hhmm, seconds), date, worksite, state],
    );
    if (state !== "rejected") await recompute(key, date);
    return id;
  }

  /** People decide the punch's exception rejected: the punch stops counting, and the day is recalculated. */
  async function rejectedByPeople(key, eventId, date) {
    const { attendance_day_id: dayId } = await one(
      "SELECT attendance_day_id FROM attendance_day WHERE employee_id = $1 AND attendance_date = $2",
      [people[key], date],
    );
    await q(
      `INSERT INTO attendance_exception (attendance_day_id, attendance_event_id, exception_type, severity, status,
                                         outcome, resolution, reviewed_at)
       VALUES ($1, $2, 'outside_worksite', 'medium', 'resolved', 'rejected', 'Not at the office that morning', now())`,
      [dayId, eventId],
    );
    await recompute(key, date);
  }

  /** A leave request covering the days, with its approval in the given state when one is named. */
  async function leave(key, from, to, status, approval = null) {
    const { leave_type_id: typeId } = await one("SELECT leave_type_id FROM leave_type WHERE code = 'annual'");
    const { leave_request_id: id } = await one(
      `INSERT INTO leave_request (employee_id, leave_type_id, starts_on, ends_on, amount, status)
       VALUES ($1, $2, $3, $4, 1, $5) RETURNING leave_request_id`,
      [people[key], typeId, from, to, status],
    );
    if (approval) {
      const { workflow_instance_id: wi } = await one(
        `INSERT INTO workflow_instance (workflow_definition_id, definition_key, module_key, entity_type, entity_id,
                                        subject_employee_id, state)
         SELECT workflow_definition_id, 'leave.approval', 'people', 'leave_request', $1, $2, $3
           FROM workflow_definition WHERE key = 'leave.approval' ORDER BY version DESC LIMIT 1
         RETURNING workflow_instance_id`,
        [id, people[key], approval],
      );
      await q("UPDATE leave_request SET workflow_instance_id = $2 WHERE leave_request_id = $1", [id, wi]);
    }
  }

  /** Every row of a day's roster, page by page. */
  async function everyone(date, scope = ALL, filters = {}, client = pool) {
    const rows = [];
    for (let n = 1; ; n += 1) {
      const result = await roster.page(client, { date, ...filters }, scope, { page: n });
      rows.push(...result.data);
      if (!result.page.has_next) return rows;
    }
  }

  /** Every row of the attendance register for a day, page by page. */
  async function register(date, scope = ALL) {
    const rows = [];
    for (let n = 1; ; n += 1) {
      const result = await repo.register(pool, date, { page: n }, scope);
      rows.push(...result.data);
      if (!result.page.has_next) return rows;
    }
  }

  const byName = (rows) => Object.fromEntries(rows.map((r) => [`${r.first_name} ${r.last_name}`, r]));
  const team = async (key) => ({ scope: "team", scope_ids: await grantsCache.getTeamEmployeeIds(pool, people[key]) });
  const own = (key) => ({ scope: "own", scope_ids: [people[key]] });

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    // The Attendance policy: ten minutes of grace, then none from September. No version is
    // seeded (A26); these stand for MyCity's own.
    await attendanceVersion(pool, { grace_minutes: 10 }, "2026-01-01");
    await attendanceVersion(pool, { grace_minutes: 0 }, "2026-09-01");
    workingWeek.invalidateCalendar();
    ({ department_id: ops } = await one(
      "INSERT INTO department (code, name) VALUES ('ROSTER_OPS', 'Field Operations') RETURNING department_id",
    ));
    ({ worksite_id: headOffice } = await one(
      `INSERT INTO worksite (code, name, latitude, longitude, radius_m)
       VALUES ('HQ_ROSTER', 'Head Office', 6.4281, 3.4219, 150) RETURNING worksite_id`,
    ));

    // A line manager's tree: Kemi over Tunde and Zainab, Tunde over Ifeanyi.
    await person("kemi", "Kemi", "Adeyemi");
    await person("tunde", "Tunde", "Bakare", { manager: "kemi" });
    await person("zainab", "Zainab", "Musa", { manager: "kemi", department: ops });
    await person("ifeanyi", "Ifeanyi", "Okafor", { manager: "tunde" });
    // Lateness and grace.
    await person("bisi", "Bisi", "Ojo");
    await person("wale", "Wale", "Adio");
    // Where people work.
    await person("emeka", "Emeka", "Nnamdi", { pattern: "hybrid", department: ops });
    await person("fola", "Fola", "Adebayo", { pattern: "remote" });
    // Which punches count.
    await person("grace", "Grace", "Eze");
    await person("hassan", "Hassan", "Bello");
    await person("ijeoma", "Ijeoma", "Uche");
    await person("uzo", "Uzo", "Nwankwo");
    // Leave, and how it was decided.
    await person("jide", "Jide", "Coker");
    await person("kunle", "Kunle", "Ade");
    await person("lara", "Lara", "Obi");
    await person("musa", "Musa", "Sani");
    // The last working day's clock-out.
    await person("ngozi", "Ngozi", "Eke");
    await person("obi", "Obi", "Nwosu");
    await person("pat", "Pat", "Okon");
    await person("remi", "Remi", "Ola");
    // Not on the register on Friday: one not started yet, one suspended.
    await person("sola", "Sola", "Akin", { starts: MONDAY });
    await person("tobi", "Tobi", "Ige", { status: "suspended" });
    // Twelve more who are expected and have not come in, so the day runs to two pages.
    for (let n = 1; n <= 12; n += 1) await person(`filler${n}`, "Filler", `Number${String(n).padStart(2, "0")}`);

    // Leave first: a day is recalculated with what holds when the punch lands.
    await leave("jide", HOLIDAY, MONDAY, "approved");
    await leave("kunle", FRIDAY, FRIDAY, "submitted", "approved");
    await leave("lara", FRIDAY, FRIDAY, "rejected");
    await leave("musa", FRIDAY, FRIDAY, "submitted", "pending");

    // Tunde's week, for his totals.
    await punch("tunde", "clock_in", MONDAY_BEFORE, "08:50");
    await punch("tunde", "clock_in", TUESDAY, "09:15");
    // The Wednesday before the holiday: Friday's "yesterday".
    await punch("ngozi", "clock_in", WEDNESDAY, "09:00");
    await punch("obi", "clock_in", WEDNESDAY, "09:00");
    await punch("obi", "clock_out", WEDNESDAY, "17:00");
    await punch("pat", "clock_in", WEDNESDAY, "09:00");
    await punch("pat", "clock_out", WEDNESDAY, "17:00", { state: "rejected" });
    await punch("remi", "clock_in", HOLIDAY, "10:00");

    // Friday.
    await punch("kemi", "clock_in", FRIDAY, "08:50");
    await punch("kemi", "clock_out", FRIDAY, "17:05");
    await punch("tunde", "clock_in", FRIDAY, "09:03");
    await punch("zainab", "clock_in", FRIDAY, "09:00");
    await punch("ifeanyi", "clock_in", FRIDAY, "09:07");
    await punch("bisi", "clock_in", FRIDAY, "09:04");
    await punch("wale", "clock_in", FRIDAY, "09:00", { seconds: 59 });
    await punch("emeka", "clock_in", FRIDAY, "08:50", { worksite: null });
    await punch("fola", "clock_in", FRIDAY, "08:45");
    await punch("grace", "clock_in", FRIDAY, "08:58", { state: "review" });
    await punch("grace", "clock_out", FRIDAY, "13:00");
    await punch("hassan", "clock_in", FRIDAY, "08:40", { state: "rejected" });
    await punch("ijeoma", "clock_in", FRIDAY, "08:40", { state: "rejected" });
    await punch("ijeoma", "clock_in", FRIDAY, "09:20");
    await rejectedByPeople("uzo", await punch("uzo", "clock_in", FRIDAY, "08:45", { state: "review" }), FRIDAY);
    await punch("jide", "clock_in", FRIDAY, "09:30");
    await punch("ngozi", "clock_in", FRIDAY, "08:59");

    // Saturday.
    await punch("kemi", "clock_in", SATURDAY, "09:02");
    await punch("emeka", "clock_in", SATURDAY, "08:55", { worksite: null });

    // Friday morning's day-close: every day before Friday is closed.
    await reconcile.closeDays({ now: at(FRIDAY, "01:30") });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("a working day", () => {
    test("each person has the one status the attendance module's record of their day gives", async () => {
      const rows = byName(await everyone(FRIDAY));
      const status = (name) => rows[name].status;
      expect(status("Kemi Adeyemi")).toBe("on_site");
      expect(status("Emeka Nnamdi")).toBe("on_site"); // hybrid is not remote, with or without a worksite
      expect(status("Fola Adebayo")).toBe("remote"); // works remotely, though the punch was at the office
      expect(status("Grace Eze")).toBe("on_site"); // a punch kept for review counts
      expect(status("Hassan Bello")).toBe("not_in"); // a rejected punch never does
      expect(status("Ijeoma Uche")).toBe("late"); // the first punch that counts is 09:20
      expect(status("Uzo Nwankwo")).toBe("not_in"); // People rejected the only punch
      expect(status("Jide Coker")).toBe("on_leave"); // leave wins over his clock-in
      expect(status("Kunle Ade")).toBe("on_leave"); // granted, not yet copied onto the request
      expect(status("Lara Obi")).toBe("not_in"); // rejected leave is no leave
      expect(status("Musa Sani")).toBe("not_in"); // nor is leave still waiting
      expect(status("Filler Number01")).toBe("not_in");
      for (const r of Object.values(rows)) if (r.status) expect(c.dashboard.HomeRosterStatus.safeParse(r.status).success).toBe(true);
    });

    test("the clock-in and clock-out are the day's record, and the worksite the clock-in was judged against", async () => {
      const rows = byName(await everyone(FRIDAY));
      expect(rows["Kemi Adeyemi"]).toMatchObject({
        clock_in_at: at(FRIDAY, "08:50"),
        clock_out_at: at(FRIDAY, "17:05"),
        worksite: "Head Office",
        department: "Test",
        work_pattern: "on_site",
        late_minutes: 0,
      });
      expect(rows["Grace Eze"]).toMatchObject({ clock_in_at: at(FRIDAY, "08:58"), clock_out_at: at(FRIDAY, "13:00") });
      expect(rows["Emeka Nnamdi"].worksite).toBeNull();
      expect(rows["Fola Adebayo"].worksite).toBeNull();
      expect(rows["Hassan Bello"]).toMatchObject({ clock_in_at: null, worksite: null });
      expect(rows["Uzo Nwankwo"]).toMatchObject({ clock_in_at: null, worksite: null });
    });

    test("who is on the register: active people who have started, and nobody else", async () => {
      const names = Object.keys(byName(await everyone(FRIDAY)));
      expect(names).toHaveLength(32);
      expect(names).not.toContain("Sola Akin");
      expect(names).not.toContain("Tobi Ige");
      const monday = Object.keys(byName(await everyone(MONDAY)));
      expect(monday).toContain("Sola Akin");
      expect(monday).not.toContain("Tobi Ige");
    });

    test("the counts add up, and each equals the list filtered to it", async () => {
      const s = await roster.summary(pool, { date: FRIDAY }, ALL);
      expect(s).toEqual({
        date: FRIDAY,
        working_day: true,
        expected: 30,
        present: 11,
        on_site: 6,
        remote: 1,
        field: 0,
        late: 4,
        absent: 0,
        on_leave: 2,
        not_in: 19,
        no_clock_out_yesterday: 2,
        flagged: 6,
      });
      expect(s.expected).toBe(s.present + s.absent + s.not_in);
      for (const status of roster.STATUSES) {
        const filtered = await roster.page(pool, { date: FRIDAY, status }, ALL, {});
        expect(filtered.page.total).toBe(s[status]);
        expect(filtered.data.every((r) => r.status === status)).toBe(true);
      }
    });

    test("a closed working day: no clock-in is absent", async () => {
      const s = await roster.summary(pool, { date: WEDNESDAY }, ALL);
      expect(s).toMatchObject({ working_day: true, expected: 32, present: 3, on_site: 3, absent: 29, not_in: 0 });
      const rows = byName(await everyone(WEDNESDAY));
      expect(rows["Kemi Adeyemi"].status).toBe("absent");
      expect(rows["Ngozi Eke"].status).toBe("on_site");
      const absent = await roster.page(pool, { date: WEDNESDAY, status: "absent" }, ALL, {});
      expect(absent.page.total).toBe(29);
    });
  });

  describe("lateness, as the attendance module measures it", () => {
    test("the version in force has no grace: 09:03 is three minutes late", async () => {
      const rows = byName(await everyone(FRIDAY));
      expect(rows["Tunde Bakare"]).toMatchObject({ status: "late", late_minutes: 3 });
      expect(rows["Ifeanyi Okafor"]).toMatchObject({ status: "late", late_minutes: 7 });
      expect(rows["Zainab Musa"]).toMatchObject({ status: "on_site", late_minutes: 0 });
    });

    test("a version from Friday with five minutes of grace: 09:03 is on time, 09:07 late by the two past it", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await attendanceVersion(client, { grace_minutes: 5 }, FRIDAY);
        await recompute("tunde", FRIDAY, client);
        await recompute("ifeanyi", FRIDAY, client);
        const rows = byName(await everyone(FRIDAY, ALL, {}, client));
        expect(rows["Tunde Bakare"]).toMatchObject({ status: "on_site", late_minutes: 0 });
        expect(rows["Ifeanyi Okafor"]).toMatchObject({ status: "late", late_minutes: 2 });
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });

    test("a version no longer in force gives way to the one after it", async () => {
      const rows = byName(await everyone(FRIDAY));
      expect(rows["Bisi Ojo"]).toMatchObject({ status: "late", late_minutes: 4 });
    });

    test("whole minutes of the workplace's clock: 09:00:59 is on time", async () => {
      const rows = byName(await everyone(FRIDAY));
      expect(rows["Wale Adio"]).toMatchObject({ status: "on_site", late_minutes: 0 });
    });
  });

  describe("the last working day's clock-out", () => {
    test("after a holiday, yesterday is the day before it; a day left open is flagged", async () => {
      const rows = byName(await everyone(FRIDAY));
      expect(rows["Ngozi Eke"].no_clock_out_yesterday).toBe(true); // in, never out
      expect(rows["Pat Okon"].no_clock_out_yesterday).toBe(true); // the clock-out was rejected
      expect(rows["Obi Nwosu"].no_clock_out_yesterday).toBe(false); // in and out
      expect(rows["Remi Ola"].no_clock_out_yesterday).toBe(false); // the holiday is not yesterday
      const flagged = await roster.page(pool, { date: FRIDAY, no_clock_out_yesterday: true }, ALL, {});
      expect(flagged.data.map((r) => r.first_name).sort()).toEqual(["Ngozi", "Pat"]);
      // The day-close saw the same open shifts.
      const { rows: missing } = await q(
        `SELECT e.first_name FROM attendance_exception x
           JOIN attendance_day ad ON ad.attendance_day_id = x.attendance_day_id
           JOIN employee e ON e.employee_id = ad.employee_id
          WHERE x.exception_type = 'missing_clock_out' AND ad.attendance_date = $1 ORDER BY 1`,
        [WEDNESDAY],
      );
      expect(missing.map((r) => r.first_name)).toEqual(["Ngozi", "Pat"]);
    });

    test("on a Monday, yesterday is Saturday", async () => {
      const rows = byName(await everyone(MONDAY));
      expect(rows["Kemi Adeyemi"].no_clock_out_yesterday).toBe(true);
      expect(rows["Ngozi Eke"].no_clock_out_yesterday).toBe(false);
    });
  });

  describe("who is flagged", () => {
    test("late or no clock-out yesterday, each once: the count is the list, and each filter narrows within it", async () => {
      const s = await roster.summary(pool, { date: FRIDAY }, ALL);
      const flagged = await everyone(FRIDAY, ALL, { flagged: true });
      expect(flagged.map((r) => r.first_name).sort()).toEqual(["Bisi", "Ifeanyi", "Ijeoma", "Ngozi", "Pat", "Tunde"]);
      expect(flagged).toHaveLength(s.flagged);
      expect(flagged.every((r) => r.flagged && (r.status === "late" || r.no_clock_out_yesterday))).toBe(true);
      const calm = await everyone(FRIDAY, ALL, { flagged: false });
      expect(calm).toHaveLength(32 - s.flagged);
      expect(calm.some((r) => r.flagged || r.status === "late" || r.no_clock_out_yesterday)).toBe(false);
      expect((await roster.page(pool, { date: FRIDAY, flagged: true, status: "late" }, ALL, {})).page.total).toBe(s.late);
      expect(
        (await roster.page(pool, { date: FRIDAY, flagged: true, no_clock_out_yesterday: true }, ALL, {})).page.total,
      ).toBe(s.no_clock_out_yesterday);
    });

    test("someone late today with no clock-out yesterday is flagged once, and counted under both", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO attendance_event (employee_id, event_type, occurred_at, work_date, worksite_id, source, validation_state)
           VALUES ($1, 'clock_in', $2, $3, $4, 'pwa', 'accepted')`,
          [people.kemi, at(MONDAY, "09:30"), MONDAY, headOffice],
        );
        await recompute("kemi", MONDAY, client);
        // Kemi and Emeka left Saturday open; Kemi is also late on Monday.
        const s = await roster.summary(client, { date: MONDAY }, ALL);
        expect(s).toMatchObject({ late: 1, no_clock_out_yesterday: 2, flagged: 2 });
        const rows = await roster.page(client, { date: MONDAY, flagged: true }, ALL, {});
        expect(rows.data.map((r) => [r.first_name, r.status, r.no_clock_out_yesterday])).toEqual([
          ["Kemi", "late", true],
          ["Emeka", "not_in", true],
        ]);
        expect(rows.page.total).toBe(s.flagged);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });

    test("a flag that is not yes or no is no filter", async () => {
      expect((await roster.page(pool, { date: FRIDAY, flagged: "yes" }, ALL, {})).page.total).toBe(32);
    });
  });

  describe("days that are not worked, and the short day", () => {
    test("a public holiday expects nobody; a clock-in on it is present, and leave covering it is leave", async () => {
      const s = await roster.summary(pool, { date: HOLIDAY }, ALL);
      expect(s).toMatchObject({ working_day: false, expected: 0, present: 1, on_site: 1, on_leave: 1, not_in: 0, absent: 0 });
      const rows = byName(await everyone(HOLIDAY));
      expect(rows["Remi Ola"]).toMatchObject({ status: "on_site", clock_in_at: at(HOLIDAY, "10:00"), worksite: "Head Office" });
      expect(rows["Jide Coker"].status).toBe("on_leave");
      expect(Object.values(rows).filter((r) => r.status === null)).toHaveLength(30);
      const none = await roster.page(pool, { date: HOLIDAY, status: "not_in" }, ALL, {});
      expect(none.page.total).toBe(0);
    });

    test("Sunday is not worked", async () => {
      const s = await roster.summary(pool, { date: SUNDAY }, ALL);
      expect(s).toMatchObject({ working_day: false, expected: 0, present: 0, on_leave: 1 });
    });

    test("Saturday is worked, and judged against its own start", async () => {
      const s = await roster.summary(pool, { date: SATURDAY }, ALL);
      expect(s).toMatchObject({ working_day: true, present: 2, late: 1, on_site: 1, remote: 0, on_leave: 1 });
      const rows = byName(await everyone(SATURDAY));
      expect(rows["Kemi Adeyemi"]).toMatchObject({ status: "late", late_minutes: 2 });

      // Settings move Saturday's start to 10:00. The record stands until the attendance module
      // recalculates the day; then the same 09:02 is on time, on the roster as on the register.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("UPDATE working_week SET starts_at = '10:00' WHERE weekday = 6");
        workingWeek.invalidateCalendar();
        const before = await roster.page(client, { date: SATURDAY, q: "Adeyemi" }, ALL, {});
        expect(before.data[0]).toMatchObject({ status: "late", late_minutes: 2 });
        await recompute("kemi", SATURDAY, client);
        const after = await roster.page(client, { date: SATURDAY, q: "Adeyemi" }, ALL, {});
        expect(after.data[0]).toMatchObject({ status: "on_site", late_minutes: 0 });
      } finally {
        await client.query("ROLLBACK");
        client.release();
        workingWeek.invalidateCalendar();
      }
    });
  });

  describe("the attendance register says the same", () => {
    const DAYS = [MONDAY_BEFORE, WEDNESDAY, HOLIDAY, FRIDAY, SATURDAY, SUNDAY, MONDAY];

    test("every person on every kind of day: the same people, status, clock-in, clock-out and late minutes", async () => {
      for (const date of DAYS) {
        const mine = Object.fromEntries((await everyone(date)).map((r) => [r.employee_id, r]));
        const theirs = await register(date);
        expect([date, theirs.length]).toEqual([date, Object.keys(mine).length]);
        for (const r of theirs) {
          const home = mine[r.employee.employee_id];
          expect({ date, who: r.employee.display_name, status: home.status, clock_in_at: home.clock_in_at, clock_out_at: home.clock_out_at, late_minutes: home.late_minutes }).toEqual({
            date,
            who: r.employee.display_name,
            status: homeWord(r),
            clock_in_at: r.clock_in_at,
            clock_out_at: r.clock_out_at,
            late_minutes: r.late_minutes,
          });
        }
      }
    });

    test("the counts, in every scope", async () => {
      for (const scope of [ALL, await team("kemi"), own("zainab")]) {
        for (const date of DAYS) {
          const mine = await roster.summary(pool, { date }, scope);
          const theirs = await repo.registerSummary(pool, date, scope);
          expect({ date, scope: scope.scope, ...mine }).toMatchObject({
            date,
            scope: scope.scope,
            expected: theirs.expected,
            present: theirs.present + theirs.late,
            late: theirs.late,
            absent: theirs.absent,
            on_leave: theirs.on_leave,
            not_in: theirs.not_in,
          });
          expect(mine.on_site + mine.remote).toBe(theirs.present);
        }
      }
    });
    test("a holiday entered after the calendar was read counts at once, as on the register", async () => {
      await roster.summary(pool, { date: WEDNESDAY }, ALL); // the working week is now cached for this process
      await q("INSERT INTO public_holiday (holiday_date, name) VALUES ($1, 'Declared Today')", [WEDNESDAY]);
      try {
        const mine = await roster.summary(pool, { date: WEDNESDAY }, ALL);
        const theirs = await repo.registerSummary(pool, WEDNESDAY, ALL);
        expect({ working_day: mine.working_day, expected: mine.expected }).toEqual({ working_day: false, expected: theirs.expected });
        expect(theirs.expected).toBe(0);
        expect((await everyone(WEDNESDAY)).filter((r) => r.status === "not_in")).toEqual([]);
      } finally {
        await q("DELETE FROM public_holiday WHERE holiday_date = $1", [WEDNESDAY]);
        workingWeek.invalidateCalendar();
      }
    });
  });

  describe("scope", () => {
    test("a line manager's team is everyone below them on the solid line, and only them", async () => {
      const mine = await team("kemi");
      const rows = await everyone(FRIDAY, mine);
      expect(rows.map((r) => r.first_name).sort()).toEqual(["Ifeanyi", "Kemi", "Tunde", "Zainab"]);
      expect(await roster.summary(pool, { date: FRIDAY }, mine)).toMatchObject({
        expected: 4,
        present: 4,
        on_site: 2,
        late: 2,
        not_in: 0,
      });
      const tunde = await everyone(FRIDAY, await team("tunde"));
      expect(tunde.map((r) => r.first_name).sort()).toEqual(["Ifeanyi", "Tunde"]);
    });

    test("own scope is the person alone; all is everyone", async () => {
      const zainab = await roster.page(pool, { date: FRIDAY }, own("zainab"), {});
      expect(zainab.data.map((r) => r.first_name)).toEqual(["Zainab"]);
      expect(await roster.summary(pool, { date: FRIDAY }, own("zainab"))).toMatchObject({ expected: 1, on_site: 1 });
      expect((await roster.page(pool, { date: FRIDAY }, ALL, {})).page.total).toBe(32);
    });
  });

  describe("the list", () => {
    test("pages at 25: thirty-two people are two pages, with nobody twice and nobody missed", async () => {
      const first = await roster.page(pool, { date: FRIDAY }, ALL, { page: 1 });
      const second = await roster.page(pool, { date: FRIDAY }, ALL, { page: 2 });
      expect(first.data).toHaveLength(25);
      expect(first.page).toEqual({ number: 1, size: 25, total: 32, pages: 2, has_next: true });
      expect(second.data).toHaveLength(7);
      expect(second.page.has_next).toBe(false);
      const ids = new Set([...first.data, ...second.data].map((r) => r.employee_id));
      expect(ids.size).toBe(32);
    });

    test("filters by department and searches by name, in SQL", async () => {
      const inOps = await roster.page(pool, { date: FRIDAY, department_id: ops }, ALL, {});
      expect(inOps.data.map((r) => r.first_name).sort()).toEqual(["Emeka", "Zainab"]);
      expect(inOps.data[0].department).toBe("Field Operations");
      const found = await roster.page(pool, { date: FRIDAY, q: "bakare" }, ALL, {});
      expect(found.data.map((r) => r.first_name)).toEqual(["Tunde"]);
      const late = await roster.page(pool, { date: FRIDAY, status: "late", department_id: ops }, ALL, {});
      expect(late.page.total).toBe(0);
    });

    test("sorts on the allow-listed columns, by name unless told otherwise", async () => {
      const byDefault = await roster.page(pool, { date: FRIDAY }, ALL, {});
      expect(byDefault.data.slice(0, 3).map((r) => r.last_name)).toEqual(["Ade", "Adebayo", "Adeyemi"]);
      const earliest = await roster.page(pool, { date: FRIDAY }, ALL, { sort: { field: "clock_in_at", dir: "asc" } });
      expect(earliest.data[0].first_name).toBe("Fola");
      const latest = await roster.page(pool, { date: FRIDAY }, ALL, { sort: { field: "clock_in_at", dir: "desc" } });
      expect(latest.data.slice(0, 2).map((r) => r.first_name)).toEqual(["Jide", "Ijeoma"]);
      const lastPage = await roster.page(pool, { date: FRIDAY }, ALL, { page: 2, sort: { field: "clock_in_at", dir: "desc" } });
      expect(lastPage.data.every((r) => r.clock_in_at === null)).toBe(true);
    });

    test("a status that is not the roster's is refused", async () => {
      await expect(roster.page(pool, { date: FRIDAY, status: "present" }, ALL, {})).rejects.toThrow(TypeError);
    });
  });

  describe("everyone's days over a range", () => {
    /** Every row of a range, page by page. */
    async function allMonth(from, to, scope = ALL, filters = {}, query = {}) {
      const rows = [];
      for (let n = 1; ; n += 1) {
        const result = await roster.month(pool, { from, to, ...filters }, scope, { ...query, page: n });
        rows.push(...result.data);
        if (!result.page.has_next) return rows;
      }
    }

    test("each person's totals are My Attendance's for the same days, from one paged read", async () => {
      const rows = await allMonth(MONDAY_BEFORE, SATURDAY);
      expect(rows).toHaveLength(32);
      for (const r of rows) {
        const mine = roster.totalsOf(await repo.daysSummary(pool, r.employee_id, MONDAY_BEFORE, SATURDAY));
        const { expected, on_time: onTime, late, absent, on_leave: onLeave } = r;
        expect({ who: r.first_name, expected, on_time: onTime, late, absent, on_leave: onLeave }).toEqual({ who: r.first_name, ...mine });
      }
      const tunde = rows.find((r) => r.employee_id === people.tunde);
      expect(tunde).toMatchObject({ expected: 4, on_time: 1, late: 2, absent: 1, on_leave: 0, department: "Test" });
      // Only the leave the attendance module recorded counts: Friday, not the holiday or Saturday.
      const jide = rows.find((r) => r.employee_id === people.jide);
      expect(jide).toMatchObject({ expected: 3, on_leave: 1 });
      expect(jide.expected).toBe(jide.on_time + jide.late + jide.absent);
    });

    test("the people are those on the register on any day of the range", async () => {
      const through = async (to) => (await allMonth(MONDAY_BEFORE, to)).map((r) => r.first_name);
      expect(await through(SATURDAY)).not.toContain("Sola"); // starts on Monday
      expect(await through(MONDAY)).toContain("Sola");
      expect(await through(MONDAY)).not.toContain("Tobi"); // suspended, and nothing recorded

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Hassan left on Wednesday: the days recorded for him still count; after them he is gone.
        await client.query("UPDATE employee SET status = 'left', left_on = $2 WHERE employee_id = $1", [people.hassan, WEDNESDAY]);
        const before = await roster.month(client, { from: MONDAY_BEFORE, to: FRIDAY, q: "hassan" }, ALL, {});
        expect(before.data).toEqual([expect.objectContaining({ first_name: "Hassan", expected: 3, absent: 3 })]);
        const after = await roster.month(client, { from: FRIDAY, to: MONDAY, q: "hassan" }, ALL, {});
        expect(after.data).toEqual([]);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });

    test("pages at 25, with nobody twice and nobody missed", async () => {
      const first = await roster.month(pool, { from: MONDAY_BEFORE, to: MONDAY }, ALL, { page: 1 });
      const second = await roster.month(pool, { from: MONDAY_BEFORE, to: MONDAY }, ALL, { page: 2 });
      expect(first.data).toHaveLength(25);
      expect(first.page).toEqual({ number: 1, size: 25, total: 33, pages: 2, has_next: true });
      expect(second.data).toHaveLength(8);
      expect(new Set([...first.data, ...second.data].map((r) => r.employee_id)).size).toBe(33);
    });

    test("within the scope, by department and by name", async () => {
      const names = (rows) => rows.map((r) => r.first_name).sort();
      expect(names(await allMonth(MONDAY_BEFORE, SATURDAY, await team("kemi")))).toEqual(["Ifeanyi", "Kemi", "Tunde", "Zainab"]);
      expect(names(await allMonth(MONDAY_BEFORE, SATURDAY, own("zainab")))).toEqual(["Zainab"]);
      expect(names(await allMonth(MONDAY_BEFORE, SATURDAY, ALL, { department_id: ops }))).toEqual(["Emeka", "Zainab"]);
      expect(names(await allMonth(MONDAY_BEFORE, SATURDAY, ALL, { q: "bakare" }))).toEqual(["Tunde"]);
    });

    test("sorts by name unless told otherwise, or by the days on time", async () => {
      const byDefault = await roster.month(pool, { from: MONDAY_BEFORE, to: SATURDAY }, ALL, {});
      expect(byDefault.data.slice(0, 3).map((r) => r.last_name)).toEqual(["Ade", "Adebayo", "Adeyemi"]);
      const most = await allMonth(MONDAY_BEFORE, SATURDAY, ALL, {}, { sort: { field: "on_time", dir: "desc" } });
      const onTime = most.map((r) => r.on_time);
      expect(onTime).toEqual([...onTime].sort((a, b) => b - a));
      expect(onTime[0]).toBeGreaterThan(0);
    });
  });

  describe("one person's days", () => {
    test("Home's roster and a person's own days always agree, on every kind of day", async () => {
      for (const date of [WEDNESDAY, HOLIDAY, FRIDAY, SATURDAY, MONDAY]) {
        for (const r of await everyone(date)) {
          const { days } = await roster.personal(pool, { employee_id: r.employee_id, from: date, to: date, today: date });
          const { day_status: _recorded, ...day } = days[0];
          expect({ who: r.first_name, date, ...day }).toEqual({
            who: r.first_name,
            date,
            working_day: date !== HOLIDAY,
            status: r.status,
            clock_in_at: r.clock_in_at,
            clock_out_at: r.clock_out_at,
            late_minutes: r.late_minutes,
          });
        }
      }
    });

    test("a week adds up as My Attendance adds it: the recorded days, the closed ones absent", async () => {
      const week = await roster.personal(pool, {
        employee_id: people.tunde,
        from: MONDAY_BEFORE,
        to: SUNDAY,
        today: SATURDAY,
      });
      expect(week.days.map((d) => [d.date, d.status, d.day_status])).toEqual([
        [MONDAY_BEFORE, "on_site", "present"],
        [TUESDAY, "late", "late"],
        [WEDNESDAY, "absent", "absent"],
        [HOLIDAY, null, null],
        [FRIDAY, "late", "late"],
        [SATURDAY, "not_in", null],
        [SUNDAY, null, null],
      ]);
      expect(week.totals).toEqual({ expected: 4, on_time: 1, late: 2, absent: 1, on_leave: 0 });

      // My Attendance's own reads: the same days, and the same figures.
      const listed = await repo.listDays(pool, people.tunde, MONDAY_BEFORE, SATURDAY, {});
      expect(listed.data.map((d) => [d.attendance_date, d.status]).reverse()).toEqual(
        week.days.filter((d) => d.day_status && d.date <= SATURDAY).map((d) => [d.date, d.day_status]),
      );
      expect(week.totals).toEqual(roster.totalsOf(await repo.daysSummary(pool, people.tunde, MONDAY_BEFORE, SATURDAY)));
    });

    test("leave days are counted apart, once the attendance module has recorded them", async () => {
      const { days, totals } = await roster.personal(pool, {
        employee_id: people.jide,
        from: FRIDAY,
        to: MONDAY,
        today: MONDAY,
      });
      expect(days.map((d) => [d.status, d.day_status])).toEqual([
        ["on_leave", "leave"],
        ["on_leave", null],
        ["on_leave", null],
        ["on_leave", null],
      ]);
      expect(totals).toEqual({ expected: 0, on_time: 0, late: 0, absent: 0, on_leave: 1 });
    });

    test("a day before someone started has no status", async () => {
      const { days, totals } = await roster.personal(pool, {
        employee_id: people.sola,
        from: FRIDAY,
        to: MONDAY,
        today: MONDAY,
      });
      expect(days.map((d) => d.status)).toEqual([null, null, null, "not_in"]);
      expect(totals.expected).toBe(0);
    });

    test("someone who is not an employee is a 404", async () => {
      await expect(
        roster.personal(pool, { employee_id: "00000000-0000-4000-8000-000000000000", from: FRIDAY, to: FRIDAY }),
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    });
  });

  describe("a field assignment's day", () => {
    test("present on it is field, on the list, the counts and a person's own days alike; late stays late", async () => {
      const before = await roster.summary(pool, { date: FRIDAY }, ALL);
      const rows = await everyone(FRIDAY);
      const onSite = rows.find((r) => r.status === "on_site");
      const late = rows.find((r) => r.status === "late");
      const fa = await one(
        `INSERT INTO attendance_field_assignment (number, name, client, starts_on, ends_on)
         VALUES ('FA-9001', 'Venue Setup', 'Northwind Events', $1, $1) RETURNING field_assignment_id`,
        [FRIDAY],
      );
      try {
        await q(
          `INSERT INTO attendance_field_site (field_assignment_id, position, name, latitude, longitude, radius_m)
           VALUES ($1, 1, 'Venue Hall', 6.731234, 3.481234, 200)`,
          [fa.field_assignment_id],
        );
        await q(
          "INSERT INTO attendance_field_member (field_assignment_id, employee_id) SELECT $1, x FROM unnest($2::uuid[]) x",
          [fa.field_assignment_id, [onSite.employee_id, late.employee_id]],
        );
        const after = await roster.summary(pool, { date: FRIDAY }, ALL);
        expect(after).toMatchObject({ field: 1, on_site: before.on_site - 1, late: before.late, present: before.present });
        const now = byName(await everyone(FRIDAY));
        expect(now[`${onSite.first_name} ${onSite.last_name}`].status).toBe("field");
        expect(now[`${late.first_name} ${late.last_name}`].status).toBe("late");
        const filtered = await roster.page(pool, { date: FRIDAY, status: "field" }, ALL, {});
        expect(filtered.data.map((r) => r.employee_id)).toEqual([onSite.employee_id]);
        const { days } = await roster.personal(pool, { employee_id: onSite.employee_id, from: FRIDAY, to: FRIDAY, today: FRIDAY });
        expect(days[0].status).toBe("field");
        // Taken off it, the day reads as before.
        await q("UPDATE attendance_field_member SET removed_at = now() WHERE employee_id = $1", [onSite.employee_id]);
        expect((await roster.summary(pool, { date: FRIDAY }, ALL)).field).toBe(0);
      } finally {
        await q("DELETE FROM attendance_field_assignment WHERE field_assignment_id = $1", [fa.field_assignment_id]);
      }
    });
  });
});
