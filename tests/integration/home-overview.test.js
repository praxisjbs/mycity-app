"use strict";
/**
 * Home · Overview end to end (docs/guides/home.md §5, §6, §7, §9): the real migrations and
 * reference seeds, the whole app over HTTP, every response parsed with its contract
 * (APP_ENV=test checks each one too). The Overview of each Home view, its sections on a
 * pinned day, Activity Today's allow-list and module filter, the cards
 * a person chooses and the ones a role opens on, the prune after an access change, the
 * records behind a card, and the assistant's and ⌘K's reads.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/home-overview
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public
 * schema. Every person and record here is invented. Calls over HTTP read today; the
 * sections whose figures depend on the day are read through the service on Wednesday 14
 * October 2026 (a working day; Thursday 1 October is a public holiday and Saturday a short
 * day in the seeded working week).
 */
const crypto = require("node:crypto");
const request = require("supertest");
const c = require("@mycity/contract");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const catalogue = require("../../src/shared/events/catalogue");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const lagos = require("../../src/shared/time/lagos");
const workingWeek = require("../../src/shared/time/working-week");
const aiRegistry = require("../../src/shared/ai/registry");
const authorise = require("../../src/shared/ai/authorise");
const searchService = require("../../src/shared/search/search.service");
const realtime = require("../../src/services/realtime/emitter");
const access = require("../../src/modules/access/access.service");
const leave = require("../../src/modules/leave/leave.service");
const roster = require("../../src/modules/attendance/attendance.roster");
const attendanceRepo = require("../../src/modules/attendance/attendance.repo");
const reconcile = require("../../src/modules/attendance/attendance.reconcile");
const kpi = require("../../src/modules/dashboard/kpi-catalog");
const resolve = require("../../src/modules/dashboard/kpi-catalog/resolve");
const service = require("../../src/modules/dashboard/dashboard.service");
const activity = require("../../src/modules/dashboard/dashboard.activity");

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
const PASSWORD = "Home-Overview9Test";

/** The pinned day: Wednesday 14 October 2026, noon in Lagos. */
const TODAY = "2026-10-14";
const NOW = lagos.instant(TODAY, "12:00");
const at = (date, hhmm) => lagos.instant(date, hhmm);

/** A service answer as the wire carries it: what the route's response check parses. */
const wire = (value) => JSON.parse(JSON.stringify(value));

/** The keys of a list of cards, in order. */
const keysOf = (cards) => cards.map((card) => card.key);

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

const countEvents = async (key) => (await one("SELECT count(*)::int AS n FROM event_log WHERE event_key = $1", [key])).n;

describeDb("Home · Overview against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  const users = {};
  let ip = 0;
  let headOffice;

  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
    put: (path, body = {}) =>
      request(app).put(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    del: (path) => request(app).delete(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
  });

  const employeeOf = (who) => people[who].employee.employee_id;
  const userIdOf = (who) => people[who].user.user_id;
  const roleId = async (code) => (await one("SELECT role_id FROM role WHERE code = $1", [code])).role_id;

  /** A punch as the attendance service records one: the event, then the day recalculated. */
  async function punch(who, type, date, hhmm) {
    await q(
      `INSERT INTO attendance_event (employee_id, event_type, occurred_at, work_date, worksite_id, source, validation_state)
       VALUES ($1, $2, $3, $4, $5, 'pwa', 'accepted')`,
      [employeeOf(who), type, at(date, hhmm), date, headOffice],
    );
    await reconcile.recomputeDay(pool, await attendanceRepo.person(pool, employeeOf(who)), date);
  }

  /** An event in the log, as emit() writes one, at an instant. */
  const logEvent = (key, module, entity, { occurred, payload = {}, actor = null }) =>
    q(
      `INSERT INTO event_log (event_key, module_key, entity_type, entity_id, actor_user_id, payload, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [key, module, entity.type, entity.id, actor, payload, occurred],
    );

  beforeAll(async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    await rebuild(pool, config.DB_NAME);
    workingWeek.invalidateCalendar();
    outbox.markReady();
    aiRegistry.load();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    ({ worksite_id: headOffice } = await one(
      `INSERT INTO worksite (code, name, latitude, longitude, radius_m)
       VALUES ('HQ_HOME', 'Head Office', 6.4281, 3.4219, 150) RETURNING worksite_id`,
    ));

    const sample = (first, last, email, job, department) => ({
      first_name: first,
      last_name: last,
      work_email: email,
      phone: "08031234567",
      job_title: job,
      department_name: department,
      start_date: "2026-01-05",
      employment_type: "full_time",
      work_pattern: "on_site",
    });
    const make = (who, first, last, role, job, department, isCeo = false) =>
      tx(async (client) => {
        people[who] = await createAdmin(
          client,
          { employee: sample(first, last, `${who}@home.mycity.test`, job, department), role_code: role, is_ceo: isCeo },
          PASSWORD,
          { allowAdditional: true },
        );
      });
    await make("ceo", "Ifeoma", "Nwankwo", "management", "Chief Executive Officer", "Management", true);
    await make("ops", "Tunde", "Bakare", "operations_people", "Operations Lead", "Operations");
    await make("hod", "Chinyere", "Obi", "head_of_department", "Head of Partnerships", "Partnerships");
    await make("manager", "Kemi", "Alade", "manager", "Programme Lead", "Programmes");
    await make("staff", "Musa", "Danjuma", "employee", "Field Officer", "Programmes");
    await make("other", "Zainab", "Lawal", "employee", "Field Officer", "Programmes");
    await make("away", "Bisi", "Ade", "employee", "Accounts Officer", "Finance");
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [
      employeeOf("manager"),
      employeeOf("staff"),
    ]);
    await grantsCache.bumpTeamVersion();
    await drain();

    for (const who of Object.keys(people)) {
      ip += 1;
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.72.0.${ip}`)
        .send({ email: `${who}@home.mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[who] = res.body.access_token;
      users[who] = await grantsCache.getAuthUser(pool, userIdOf(who));
    }
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  /* ---------------------------------------------------------------- *
   * The Overview of each Home view, over HTTP
   * ---------------------------------------------------------------- */

  /*
   * Calls over HTTP read today, and the blocks below add records as they go, so these check
   * which sections each view draws and their shape, never what is in them: the figures are
   * checked on pinned days, each block against records it makes itself.
   */
  describe("the Overview, by Home view", () => {
    const overviewOf = async (who) => {
      const res = await as(who).get("/home/overview");
      expect(res.status).toBe(200);
      return d.HomeOverview.parse(res.body);
    };

    test("signed out it is a 401", async () => {
      expect((await request(app).get("/api/v1/home/overview")).status).toBe(401);
    });

    test("Operations: the attendance chart, the On Time donut, Clocked In, the pipeline and the goals", async () => {
      const o = await overviewOf("ops");
      expect(o.greeting_name).toBe("Tunde");
      expect(o.date).toBe(lagos.today());
      expect(o.picker_source).toBe("view");
      expect(keysOf(o.cards)).toEqual(["attendance_today", "tasks_overdue", "expenses_pending", "partnerships_active"]);
      expect(o.chart.kind).toBe("attendance_days");
      expect(o.chart.days).toHaveLength(14);
      expect(o.donut.kind).toBe("on_time");
      expect(o.clocked_in).toEqual({ present: expect.any(Number), expected: expect.any(Number) });
      expect(o.pipeline).toEqual({ stages: expect.any(Array), quiet_30d: expect.any(Number) });
      expect(Array.isArray(o.goals)).toBe(true);
      expect(o.alerts_to_clear).toEqual(expect.any(Number));
      for (const section of ["day_strip", "my_goals", "upcoming_leave"]) expect([section, o[section]]).toEqual([section, null]);
      expect(Array.isArray(o.week)).toBe(true);
      expect(Array.isArray(o.activity)).toBe(true);
    });

    test("the CEO: every live card is theirs to see, the goals chart and the Org KPI donut, each score null while nothing is scored", async () => {
      const o = await overviewOf("ceo");
      expect(keysOf(o.cards)).toEqual([
        "goals_on_track",
        "approvals_awaiting_you",
        "partnerships_signed_value",
        "alerts_high_open",
      ]);
      expect(o.chart).toEqual({ kind: "goals", goals: expect.any(Array) });
      expect(o.donut.kind).toBe("org_kpi");
      expect(o.donut.percent).toBeNull();
      expect(o.donut.departments.map((dep) => dep.department)).toEqual(
        expect.arrayContaining(["Management", "Operations", "Partnerships", "Programmes", "Finance"]),
      );
      for (const dep of o.donut.departments) expect(dep.percent).toBeNull();
      expect(o.pipeline).not.toBeNull();
      expect(o.goals).toBeNull();
      expect(o.clocked_in).toBeNull();

      const picker = d.HomeKpiPicker.parse((await as("ceo").get("/home/kpi-picker")).body);
      expect(picker.cards.map((card) => card.key)).toEqual([...kpi.PICKABLE_IDS]);
    });

    test("Partnerships: the value signed by month this year and the pipeline", async () => {
      const o = await overviewOf("hod");
      expect(keysOf(o.cards)).toEqual([
        "partnerships_active",
        "partnerships_signed_value",
        "partnerships_quiet_30d",
        "proposals_out",
      ]);
      expect(o.chart.kind).toBe("signed_value");
      expect(o.chart.months[0].month).toBe(`${lagos.today().slice(0, 4)}-01`);
      expect(o.chart.months.length).toBeGreaterThanOrEqual(Number(lagos.today().slice(5, 7)));
      expect(o.donut).toBeNull();
      expect(o.pipeline).not.toBeNull();
      expect(Array.isArray(o.goals)).toBe(true);
    });

    test("Staff: the day strip, My Goals and Upcoming Leave, their own cards, and no card People gates", async () => {
      const o = await overviewOf("staff");
      expect(o.greeting_name).toBe("Musa");
      expect(keysOf(o.cards)).toEqual(["my_targets_on_track", "my_tasks_overdue", "my_reviews_due", "my_attendance_30d"]);
      expect(o.cards.every((card) => kpi.BY_ID.get(card.key).module !== "people")).toBe(true);
      expect(o.day_strip).not.toBeNull();
      expect(Array.isArray(o.my_goals)).toBe(true);
      expect(o.upcoming_leave).toEqual({
        balance: { leave_type_id: expect.any(String), name: "Annual", remaining: expect.any(Number) },
        requests: expect.any(Array),
      });
      for (const section of ["clocked_in", "chart", "donut", "pipeline", "goals", "alerts_to_clear"])
        expect([section, o[section]]).toEqual([section, null]);

      const picker = d.HomeKpiPicker.parse((await as("staff").get("/home/kpi-picker")).body);
      for (const card of picker.cards) expect([card.key, kpi.BY_ID.get(card.key).module]).not.toEqual([card.key, "people"]);
    });

    test("a section drawn with nothing in it is empty, never null: a quarter no block records a goal in", async () => {
      const now = at("2026-02-11", "12:00");
      const ops = await service.overview(users.ops, { now });
      expect(ops.goals).toEqual([]);
      expect((await service.overview(users.ceo, { now })).chart).toEqual({ kind: "goals", goals: [] });
      expect((await service.overview(users.staff, { now })).my_goals).toEqual([]);
    });
  });

  /* ---------------------------------------------------------------- *
   * The sections on a pinned day
   * ---------------------------------------------------------------- */

  describe("the sections on Wednesday 14 October", () => {
    beforeAll(async () => {
      const { leave_type_id: annual } = await one("SELECT leave_type_id FROM leave_type WHERE code = 'annual'");

      // Musa in on time, Kemi in late; Musa was in on Monday and Tuesday too.
      await punch("staff", "clock_in", TODAY, "08:50");
      await punch("manager", "clock_in", TODAY, "10:30");
      await punch("staff", "clock_in", "2026-10-12", "08:45");
      await punch("staff", "clock_in", "2026-10-13", "08:40");
      await punch("staff", "clock_out", "2026-10-13", "17:10");

      // Bisi is on leave today. Musa has a day off on Friday, an old leave and one waiting.
      const leaveRow = (who, from, to, days, status) =>
        q(
          `INSERT INTO leave_request (employee_id, leave_type_id, starts_on, ends_on, amount, status, submitted_at, decided_at)
           VALUES ($1, $2, $3, $4, $5, $6, now(), CASE WHEN $6 = 'approved' THEN now() END)`,
          [employeeOf(who), annual, from, to, days, status],
        );
      await leaveRow("away", TODAY, TODAY, 1, "approved");
      await leaveRow("staff", "2026-10-16", "2026-10-16", 1, "approved");
      await leaveRow("staff", "2026-09-01", "2026-09-03", 3, "approved");
      await leaveRow("staff", "2026-11-02", "2026-11-02", 1, "submitted");

      // Goals this quarter (M2): one live, one ended last quarter, one a department's, one closed last year.
      const goal = (title, level, status, from, to) =>
        q(
          `INSERT INTO organisational_goal (level, title, status, starts_on, ends_on, owner_employee_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [level, title, status, from, to, employeeOf("ceo")],
        );
      await goal("Reach Three New States", "organisation", "active", "2026-10-01", "2026-12-31");
      await goal("Launch the Festival", "organisation", "active", "2026-07-01", "2026-09-30");
      await goal("Hire Two Producers", "department", "active", "2026-10-01", "2026-12-31");
      await goal("Closed Last Year", "organisation", "closed", "2025-10-01", "2025-12-31");

      // Musa's targets: one due this quarter, one last quarter.
      const target = (title, due) =>
        q("INSERT INTO employee_target (employee_id, title, weight, due_on) VALUES ($1, $2, 50, $3)", [
          employeeOf("staff"),
          title,
          due,
        ]);
      await target("File Four Field Reports", "2026-11-15");
      await target("Old Target", "2026-09-01");

      // Musa's week: a meeting on Tuesday, a report due on Thursday, one on another week.
      await q(
        `INSERT INTO calendar_event (title, event_type, owner_employee_id, starts_at, ends_at, created_by)
         VALUES ('Team Meeting', 'meeting', $1, $2, $3, $4), ('Next Week', 'meeting', $1, $5, $6, $4)`,
        [
          employeeOf("staff"),
          at("2026-10-13", "10:00"),
          at("2026-10-13", "11:00"),
          userIdOf("staff"),
          at("2026-10-20", "10:00"),
          at("2026-10-20", "11:00"),
        ],
      );
      await q(
        `INSERT INTO task (title, status, created_by, primary_assignee_id, due_at)
         VALUES ('Send the Field Report', 'todo', $1, $2, $3)`,
        [userIdOf("ops"), employeeOf("staff"), at("2026-10-15", "17:00")],
      );

      // Partnerships (M7), owned by Chinyere: a signed agreement in March, one in dollars,
      // one in draft, one signed that starts in December; an open opportunity; an active
      // partner nobody has contacted.
      const { partner_id: partner } = await one(
        `INSERT INTO partner (number, name, partner_type, status, owner_id, created_at)
         VALUES ('PAR-0001', 'Lagos Arts Council', 'government', 'active', $1, $2) RETURNING partner_id`,
        [employeeOf("hod"), at("2026-06-01", "09:00")],
      );
      await q(
        `INSERT INTO partnership_opportunity (number, partner_id, title, stage, status, owner_id, estimated_value, currency)
         VALUES ('POP-0001', $1, 'Festival Sponsorship', 'proposal', 'open', $2, 5000.00, 'NGN')`,
        [partner, employeeOf("hod")],
      );
      const agreement = (number, status, startsOn, value, currency) =>
        q(
          `INSERT INTO partnership_agreement (partner_id, number, title, status, starts_on, value, currency, owner_id)
           VALUES ($1, $2, 'Sponsorship', $3, $4, $5, $6, $7)`,
          [partner, number, status, startsOn, value, currency, employeeOf("hod")],
        );
      await agreement("AGR-0001", "signed", "2026-03-01", "5000.00", "NGN");
      await agreement("AGR-0002", "active", "2026-03-20", "250.50", "NGN");
      await agreement("AGR-0003", "signed", "2026-06-01", "1000.00", "USD");
      await agreement("AGR-0004", "draft", "2026-05-01", "700.00", "NGN");
      await agreement("AGR-0005", "signed", "2026-12-01", "2000000.00", "NGN");
    });

    const at14 = (who) => service.overview({ ...users[who], session_id: null }, { now: NOW }).then(wire);

    test("Operations: present out of expected on each of the last 14 working days, as the roster counts them", async () => {
      const o = d.HomeOverview.parse(await at14("ops"));
      expect(o.date).toBe(TODAY);
      expect(o.chart.days.map((day) => day.date)).toEqual([
        "2026-09-28",
        "2026-09-29",
        "2026-09-30",
        "2026-10-02",
        "2026-10-03",
        "2026-10-05",
        "2026-10-06",
        "2026-10-07",
        "2026-10-08",
        "2026-10-09",
        "2026-10-10",
        "2026-10-12",
        "2026-10-13",
        "2026-10-14",
      ]);
      const all = { scope: "all", scope_ids: null };
      for (const day of o.chart.days) {
        const s = await roster.summary(pool, { date: day.date }, all);
        expect(day).toEqual({ date: day.date, present: s.present, expected: s.expected });
      }
      const today = await roster.summary(pool, { date: TODAY }, all);
      expect(o.clocked_in).toEqual({ present: 2, expected: today.expected });
      expect(today.expected).toBe(6);
    });

    test("Operations: the On Time donut counts this month's working days so far", async () => {
      const o = await at14("ops");
      const all = { scope: "all", scope_ids: null };
      const total = { on_time: 0, late: 0, absent: 0 };
      for (const date of ["2026-10-02", "2026-10-03", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08",
        "2026-10-09", "2026-10-10", "2026-10-12", "2026-10-13", "2026-10-14"]) {
        const s = await roster.summary(pool, { date }, all);
        total.on_time += s.on_site + s.remote;
        total.late += s.late;
        total.absent += s.absent;
      }
      expect(o.donut).toEqual({ kind: "on_time", ...total });
      expect(total).toMatchObject({ on_time: 3, late: 1 });
    });

    test("a line manager's attendance is their team's: Kemi has the Staff view and no chart", async () => {
      const o = await at14("manager");
      expect(o.chart).toBeNull();
      expect(o.clocked_in).toBeNull();
      expect(o.day_strip).toMatchObject({ status: "late", worksite: "Head Office" });
    });

    test("the CEO: the organisation's own goals live this quarter, progress null while nothing is scored", async () => {
      const o = d.HomeOverview.parse(await at14("ceo"));
      expect(o.chart.goals).toEqual([
        { title: "Reach Three New States", progress: null, link: expect.stringMatching(/^\/performance\?tab=goals&id=/) },
      ]);
    });

    test("Operations' Goals This Quarter are the same goals, with when each ends", async () => {
      const o = await at14("ops");
      expect(o.goals).toEqual([
        {
          title: "Reach Three New States",
          progress: null,
          due_on: "2026-12-31",
          link: expect.stringMatching(/^\/performance\?tab=goals&id=/),
        },
      ]);
    });

    test("Partnerships: the Naira signed each month this year, the agreements the Signed Value card counts", async () => {
      const o = d.HomeOverview.parse(await at14("hod"));
      // The year is read whole, as the card reads it: to December, where the last agreement starts.
      expect(o.chart.months).toHaveLength(12);
      expect(o.chart.months[0]).toEqual({ month: "2026-01", amount: "0.00" });
      expect(o.chart.months[2]).toEqual({ month: "2026-03", amount: "5250.50" });
      expect(o.chart.months[5]).toEqual({ month: "2026-06", amount: "0.00" });
      expect(o.chart.months[10]).toEqual({ month: "2026-11", amount: "0.00" });
      expect(o.chart.months[11]).toEqual({ month: "2026-12", amount: "2000000.00" });
      const card = o.cards.find((x) => x.key === "partnerships_signed_value");
      expect(card.amount).toBe("2005250.50");
      const kobo = o.chart.months.reduce((n, month) => n + Math.round(Number(month.amount) * 100), 0);
      expect((kobo / 100).toFixed(2)).toBe(card.amount);
      expect(o.pipeline).toEqual({ stages: [{ stage: "proposal", label: "Proposal", open: 1 }], quiet_30d: 1 });
      // A year with nothing starting after today runs to this month.
      const march = await service.overview(users.hod, { now: at("2027-03-10", "12:00") });
      expect(march.chart.months.map((month) => month.month)).toEqual(["2027-01", "2027-02", "2027-03"]);
    });

    test("Staff: the day strip is their own row of today's roster and today's hours", async () => {
      const o = d.HomeOverview.parse(await at14("staff"));
      expect(o.day_strip).toEqual({
        starts_at: "09:00",
        ends_at: "17:00",
        clock_in_at: at(TODAY, "08:50").toISOString(),
        clock_out_at: null,
        status: "on_site",
        worksite: "Head Office",
        worked_minutes: 0,
      });
      const tuesday = await service.overview(users.staff, { now: at("2026-10-13", "18:00") });
      expect(tuesday.day_strip).toMatchObject({ status: "on_site", worked_minutes: 8 * 60 + 30 });
    });

    test("Staff: My Goals are their targets due this quarter", async () => {
      const o = await at14("staff");
      expect(o.my_goals).toEqual([
        {
          title: "File Four Field Reports",
          progress: null,
          due_on: "2026-11-15",
          link: expect.stringMatching(/^\/ess\?tab=my-performance&id=/),
        },
      ]);
    });

    test("Staff: Upcoming Leave is their leave still ahead, soonest first, and My Leave's balance", async () => {
      const o = await at14("staff");
      expect(o.upcoming_leave.requests.map((r) => [r.starts_on, r.status])).toEqual([
        ["2026-10-16", "approved"],
        ["2026-11-02", "submitted"],
      ]);
      const year = await leave.balancesFor(employeeOf("staff"), 2026);
      const annual = year.balances.find((b) => b.code === "annual");
      expect(o.upcoming_leave.balance).toEqual({ leave_type_id: annual.leave_type_id, name: "Annual", remaining: annual.remaining });
    });

    test("Your Week: the week's working days with their hours, leave, and the events and tasks on each", async () => {
      const o = d.HomeOverview.parse(await at14("staff"));
      expect(o.week.map((day) => [day.date, day.starts_at, day.ends_at, day.on_leave])).toEqual([
        ["2026-10-12", "09:00", "17:00", false],
        ["2026-10-13", "09:00", "17:00", false],
        ["2026-10-14", "09:00", "17:00", false],
        ["2026-10-15", "09:00", "17:00", false],
        ["2026-10-16", "09:00", "17:00", true],
        ["2026-10-17", "09:00", "15:00", false],
      ]);
      const items = Object.fromEntries(o.week.map((day) => [day.date, day.items]));
      expect(items["2026-10-13"]).toEqual([
        {
          kind: "event",
          title: "Team Meeting",
          at: at("2026-10-13", "10:00").toISOString(),
          link: expect.stringMatching(/^\/workspace\?tab=calendar&id=/),
        },
      ]);
      expect(items["2026-10-15"]).toEqual([
        {
          kind: "task",
          title: "Send the Field Report",
          at: at("2026-10-15", "17:00").toISOString(),
          link: expect.stringMatching(/^\/workspace\?tab=tasks&id=/),
        },
      ]);
      expect(o.week.flatMap((day) => day.items)).toHaveLength(2);
    });

    test("Your Week names a public holiday and gives it no hours", async () => {
      const o = await service.overview(users.staff, { now: at("2026-09-30", "12:00") });
      const thursday = o.week.find((day) => day.date === "2026-10-01");
      expect(thursday).toMatchObject({ holiday: "Independence Day", starts_at: null, ends_at: null });
      expect(o.week.find((day) => day.date === "2026-09-30").holiday).toBeNull();
    });
  });

  /* ---------------------------------------------------------------- *
   * Your Week, in a busy week
   * ---------------------------------------------------------------- */

  describe("Your Week, in a busy week", () => {
    const MONDAY = "2026-10-19";
    const SATURDAY = "2026-10-24";

    beforeAll(async () => {
      const event = (title, from, to) =>
        q(
          `INSERT INTO calendar_event (title, event_type, owner_employee_id, starts_at, ends_at, created_by)
           VALUES ($1, 'meeting', $2, $3, $4, $5)`,
          [title, employeeOf("other"), from, to, userIdOf("other")],
        );
      // Zainab's week: five meetings a day Monday to Friday, a page's worth before Saturday's two.
      for (let day = 0; day < 5; day += 1)
        for (let n = 0; n < 5; n += 1) {
          const date = lagos.addDays(MONDAY, day);
          const hour = String(9 + n).padStart(2, "0");
          await event(`Meeting ${day}.${n}`, at(date, `${hour}:00`), at(date, `${hour}:30`));
        }
      await event("Saturday Clinic", at(SATURDAY, "10:00"), at(SATURDAY, "11:00"));
      await event("Saturday Review", at(SATURDAY, "12:00"), at(SATURDAY, "13:00"));
      // A retreat from the Saturday before into Monday; a workshop from Wednesday to Friday.
      await event("Retreat", at("2026-10-17", "09:00"), at(MONDAY, "12:00"));
      await event("Workshop", at("2026-10-21", "14:00"), at("2026-10-23", "17:00"));
      await q(
        `INSERT INTO task (title, status, created_by, primary_assignee_id, due_at)
         VALUES ('Weekly Report', 'todo', $1, $2, $3)`,
        [userIdOf("ops"), employeeOf("other"), at(SATURDAY, "14:00")],
      );
    });

    test("each working day reads its own page: thirty events in the week keep Saturday's", async () => {
      const o = d.HomeOverview.parse(wire(await service.overview(users.other, { now: at("2026-10-21", "12:00") })));
      const titles = Object.fromEntries(o.week.map((day) => [day.date, day.items.map((item) => item.title)]));
      expect(titles[SATURDAY]).toEqual(["Saturday Clinic", "Saturday Review", "Weekly Report"]);
      expect(titles["2026-10-23"]).toHaveLength(5);
      // The retreat began the week before, so it shows on Monday, first.
      expect(titles[MONDAY]).toEqual(["Retreat", "Meeting 0.0", "Meeting 0.1", "Meeting 0.2", "Meeting 0.3", "Meeting 0.4"]);
      // An event is on the day it starts, not on each day it spans.
      expect(Object.keys(titles).filter((date) => titles[date].includes("Workshop"))).toEqual(["2026-10-21"]);
      expect(o.week.flatMap((day) => day.items)).toHaveLength(30);
    });
  });

  /* ---------------------------------------------------------------- *
   * Need You's alerts
   * ---------------------------------------------------------------- */

  describe("the alerts beside Need You", () => {
    beforeAll(async () => {
      const { home_alert_rule_id: rule } = await one(
        `INSERT INTO home_alert_rule (key, name, metric, threshold, severity, permission_key)
         VALUES ('approval_ageing.test', 'Approvals Waiting', 'approval_ageing', 2, 'medium', 'people.approve')
         RETURNING home_alert_rule_id`,
      );
      const alert = (who, severity, cleared) =>
        q(
          `INSERT INTO home_alert (home_alert_rule_id, subject_type, subject_id, subject_employee_id, title, trigger,
                                   severity, over_by, cleared_at, outcome)
           VALUES ($1, 'employee', $2::text, $2::uuid, 'Approval waiting', 'Waiting three days', $3, 1, $4, $5)`,
          [rule, employeeOf(who), severity, cleared ? new Date() : null, cleared ? "cleared" : null],
        );
      await alert("staff", "low", false);
      await alert("other", "high", false);
      await alert("other", "high", true);
    });

    test("open alerts of any severity the reader may clear, about people in their scope; none to clear is null", async () => {
      const count = async (who) => d.HomeOverview.parse((await as(who).get("/home/overview")).body).alerts_to_clear;
      expect(await count("ops")).toBe(2);
      expect(await count("ceo")).toBe(2);
      expect(await count("manager")).toBe(1);
      expect(await count("hod")).toBe(0);
      expect(await count("staff")).toBeNull();
    });
  });

  /* ---------------------------------------------------------------- *
   * Activity Today
   * ---------------------------------------------------------------- */

  describe("Activity Today", () => {
    const DAY = "2026-10-08";
    const activityOf = (who, date = DAY) => activity.today(pool, users[who], { today: date }).then(wire);

    beforeAll(async () => {
      const on = (hhmm) => at(DAY, hhmm);
      const actor = userIdOf("ops");
      await logEvent("employee.created", "people", { type: "employee", id: employeeOf("staff") }, {
        occurred: on("09:00"),
        payload: { employee_id: employeeOf("staff") },
        actor,
      });
      await logEvent("employee.created", "people", { type: "employee", id: employeeOf("other") }, {
        occurred: on("09:10"),
        payload: { employee_id: employeeOf("other") },
        actor,
      });
      await logEvent("leave_request.approved", "people", { type: "leave_request", id: crypto.randomUUID() }, {
        occurred: on("10:00"),
        payload: { subject_employee_id: employeeOf("staff") },
      });
      await logEvent("recognition.posted", "community", { type: "recognition", id: crypto.randomUUID() }, {
        occurred: on("11:00"),
        payload: { subject_employee_id: employeeOf("other") },
        actor: userIdOf("staff"),
      });
      // Never on Home: mail, a direct message, a sign-in, an allowed key under another module, yesterday.
      await logEvent("mail_message.received", "mailbox", { type: "mail_message", id: crypto.randomUUID() }, {
        occurred: on("12:00"),
        payload: { employee_id: employeeOf("staff") },
      });
      await logEvent("direct_message.sent", "community", { type: "direct_message", id: crypto.randomUUID() }, {
        occurred: on("12:05"),
      });
      await logEvent("auth.signed_in", "settings", { type: "app_user", id: userIdOf("staff") }, { occurred: on("12:10") });
      await logEvent("employee.created", "community", { type: "employee", id: employeeOf("staff") }, {
        occurred: on("12:15"),
      });
      await logEvent("employee.created", "people", { type: "employee", id: employeeOf("away") }, {
        occurred: at("2026-10-07", "23:30"),
      });
    });

    test("an allow-list of keys, today only, newest first, in the contract's shape", async () => {
      const items = await activityOf("ops");
      for (const item of items) d.HomeActivityItem.parse(item);
      expect(items.map((i) => [i.event_key, i.subject])).toEqual([
        ["recognition.posted", "Zainab Lawal"],
        ["leave_request.approved", "Musa Danjuma"],
        ["employee.created", "Zainab Lawal"],
        ["employee.created", "Musa Danjuma"],
      ]);
      const created = items[3];
      expect(created).toMatchObject({
        module_key: "people",
        actor_name: "Tunde Bakare",
        link: `/people?tab=employees&id=${employeeOf("staff")}`,
        occurred_at: at(DAY, "09:00").toISOString(),
      });
      expect(items[1].actor_name).toBeNull();
    });

    test("only modules the reader may view, and a person's events only within their scope", async () => {
      // Kemi sees People for her team (Musa) and #general; Musa holds no People grant.
      expect((await activityOf("manager")).map((i) => [i.event_key, i.subject])).toEqual([
        ["recognition.posted", "Zainab Lawal"],
        ["leave_request.approved", "Musa Danjuma"],
        ["employee.created", "Musa Danjuma"],
      ]);
      expect((await activityOf("staff")).map((i) => i.event_key)).toEqual(["recognition.posted"]);
    });

    test("an event opens where its record does, and one about the reader in their own view", async () => {
      const [theirs] = (await activityOf("manager")).filter((i) => i.event_key === "leave_request.approved");
      expect(theirs.link).toMatch(/^\/people\?tab=leave&id=/);

      const day = "2026-10-05";
      await logEvent("leave_request.approved", "people", { type: "leave_request", id: crypto.randomUUID() }, {
        occurred: at(day, "10:00"),
        payload: { subject_employee_id: employeeOf("ops") },
      });
      const [own] = await activityOf("ops", day);
      expect(own).toMatchObject({ subject: "Tunde Bakare", link: expect.stringMatching(/^\/ess\?tab=my-leave&id=/) });
    });

    test("at most 25, the newest", async () => {
      const busy = "2026-10-09";
      for (let n = 0; n < 30; n += 1)
        await logEvent("celebration.posted", "community", { type: "channel_message", id: crypto.randomUUID() }, {
          occurred: at(busy, `09:${String(n).padStart(2, "0")}`),
          payload: { subject_employee_id: employeeOf("other") },
        });
      const items = await activityOf("staff", busy);
      expect(items).toHaveLength(25);
      expect(items[0].occurred_at).toBe(at(busy, "09:29").toISOString());
      expect(items[24].occurred_at).toBe(at(busy, "09:05").toISOString());
    });

    test("the assistant's activity.list: the same events, one person's by id or by name, each cited as its record", async () => {
      const read = (who, params) => authorise.runRead(pool, users[who], "activity.list", params);
      const MUSA = [
        ["recognition.posted", "Musa Danjuma", "Zainab Lawal"],
        ["leave_request.approved", null, "Musa Danjuma"],
        ["employee.created", "Tunde Bakare", "Musa Danjuma"],
      ];
      const byId = await read("ops", { date: DAY, employee_id: employeeOf("staff") });
      expect(byId.data.map((r) => [r.event_key, r.actor_name, r.subject])).toEqual(MUSA);
      expect(byId.page).toMatchObject({ number: 1, total: 3, has_next: false });
      const byName = await read("ops", { date: DAY, q: "musa" });
      expect(byName.data.map((r) => [r.event_key, r.actor_name, r.subject])).toEqual(MUSA);
      expect(byName.citations.map((ct) => ct.type)).toEqual(["recognition", "leave_request", "employee"]);
      expect(byName.citations[2]).toMatchObject({ id: employeeOf("staff"), label: "Musa Danjuma", link: `/people?tab=employees&id=${employeeOf("staff")}` });

      // The same rules as Home: Kemi's People scope is her team, so Zainab's record is not hers; #general is.
      expect((await read("manager", { date: DAY, employee_id: employeeOf("other") })).data.map((r) => r.event_key)).toEqual(["recognition.posted"]);
      // Today unless a day is asked for.
      const today = await activity.forAssistant(pool, users.ops, {}, { now: at(DAY, "12:00") });
      expect(today.data.map((r) => r.event_key)).toEqual(["recognition.posted", "leave_request.approved", "employee.created", "employee.created"]);
    });

    test("the assistant's activity.list pages at 25, as every read does", async () => {
      const busy = "2026-10-06";
      for (let n = 0; n < 30; n += 1)
        await logEvent("celebration.posted", "community", { type: "channel_message", id: crypto.randomUUID() }, {
          occurred: at(busy, `09:${String(n).padStart(2, "0")}`),
          payload: { subject_employee_id: employeeOf("other") },
        });
      const first = await authorise.runRead(pool, users.staff, "activity.list", { date: busy });
      expect(first.data).toHaveLength(25);
      expect(first.page).toMatchObject({ number: 1, total: 30, has_next: true });
      const second = await authorise.runRead(pool, users.staff, "activity.list", { date: busy, page: 2 });
      expect(second.data).toHaveLength(5);
      expect(second.data[4].occurred_at).toBe(at(busy, "09:00").toISOString());
    });

    test("every allowed key is declared by the module it names", async () => {
      require("../../src/modules/organisation/organisation.events");
      require("../../src/modules/leave/leave.events");
      require("../../src/modules/attendance/attendance.events");
      require("../../src/modules/community/community.events");
      for (const [key, { module }] of Object.entries(activity.ALLOWED))
        expect([key, catalogue.get(key) && catalogue.get(key).module]).toEqual([key, module]);
    });
  });

  /* ---------------------------------------------------------------- *
   * The cards a person chooses
   * ---------------------------------------------------------------- */

  describe("the cards a person chooses", () => {
    const picks = (who, ids) => as(who).put("/home/kpi-picks", { kpi_ids: ids });
    const PICKED = "home.kpi_picks_changed";

    test("save, in order: the Overview follows them, and saving the same again records nothing", async () => {
      const res = await picks("staff", ["my_leave_left", "my_tasks_overdue"]);
      expect(res.status).toBe(200);
      const picker = d.HomeKpiPicker.parse(res.body);
      expect(picker).toMatchObject({
        source: "user",
        kpi_ids: ["my_leave_left", "my_tasks_overdue"],
        showing_ids: ["my_leave_left", "my_tasks_overdue"],
      });
      const events = await countEvents(PICKED);
      expect((await picks("staff", ["my_leave_left", "my_tasks_overdue"])).status).toBe(200);
      expect(await countEvents(PICKED)).toBe(events);
      const o = d.HomeOverview.parse((await as("staff").get("/home/overview")).body);
      expect(keysOf(o.cards)).toEqual(["my_leave_left", "my_tasks_overdue"]);
      expect(o.picker_source).toBe("user");
    });

    test("refused: a card they may not see, one never offered, a hidden one, more than four, one twice", async () => {
      for (const ids of [["headcount"], ["team_present"], ["payroll_run_state"], ["not_a_card"]]) {
        const res = await picks("staff", ids);
        expect([ids[0], res.status]).toEqual([ids[0], 422]);
        expect(res.body.error.fields.kpi_ids).toBeDefined();
      }
      const five = ["my_leave_left", "my_tasks_overdue", "my_reviews_due", "my_attendance_30d", "tasks_overdue"];
      expect((await picks("staff", five)).status).toBe(422);
      expect((await picks("staff", ["my_leave_left", "my_leave_left"])).status).toBe(422);
    });

    test("an empty pick is a choice of none", async () => {
      const res = await picks("staff", []);
      expect(d.HomeKpiPicker.parse(res.body)).toMatchObject({ source: "user", kpi_ids: [], showing_ids: [] });
      expect((await as("staff").get("/home/overview")).body.cards).toEqual([]);
    });

    test("restating the roles' cards in their order is following the roles", async () => {
      const defaults = d.HomeKpiPicker.parse((await as("staff").get("/home/kpi-picker")).body).default_ids;
      const res = await picks("staff", defaults);
      expect(d.HomeKpiPicker.parse(res.body)).toMatchObject({ source: "view", kpi_ids: null });
      expect(await one("SELECT count(*)::int AS n FROM home_kpi_pick WHERE user_id = $1", [userIdOf("staff")])).toEqual({
        n: 0,
      });
    });

    test("go back to the roles' cards; with nothing to forget nothing is recorded", async () => {
      await picks("staff", ["my_leave_left"]);
      const events = await countEvents(PICKED);
      expect((await as("staff").del("/home/kpi-picks")).status).toBe(204);
      expect(await countEvents(PICKED)).toBe(events + 1);
      expect((await as("staff").del("/home/kpi-picks")).status).toBe(204);
      expect(await countEvents(PICKED)).toBe(events + 1);
      expect((await as("staff").get("/home/kpi-picker")).body.source).toBe("view");
    });
  });

  /* ---------------------------------------------------------------- *
   * The cards a role opens on
   * ---------------------------------------------------------------- */

  describe("a role's cards", () => {
    let staffRole;
    const path = (id) => `/home/roles/${id}/kpis`;

    beforeAll(async () => {
      staffRole = await roleId("employee");
    });

    test("Settings view reads them; a member of staff may not", async () => {
      expect((await as("staff").get(path(staffRole))).status).toBe(403);
      const res = await as("ops").get(path(staffRole));
      expect(res.status).toBe(200);
      const cards = d.HomeRoleKpis.parse(res.body);
      expect(cards).toMatchObject({ role_id: staffRole, configured: false, default_ids: [], locked_ids: [] });
      expect(cards.view_default_ids).toEqual(["my_targets_on_track", "my_tasks_overdue", "my_reviews_due", "my_attendance_30d"]);
      expect(cards.cards.some((card) => card.key === "headcount")).toBe(false);
      expect(cards.cards.some((card) => card.key === "my_leave_left")).toBe(true);
    });

    test("refused: a card the role may not see, more than four, a lock it does not show", async () => {
      const save = (body) => as("ops").put(path(staffRole), body);
      const unseen = await save({ default_ids: ["headcount"], locked_ids: [] });
      expect(unseen.status).toBe(422);
      expect(unseen.body.error.code).toBe("KPI_NOT_FOR_ROLE");
      const five = ["my_leave_left", "my_tasks_overdue", "my_reviews_due", "my_attendance_30d", "tasks_overdue"];
      expect((await save({ default_ids: five, locked_ids: [] })).status).toBe(422);
      expect((await save({ default_ids: ["my_leave_left"], locked_ids: ["my_tasks_overdue"] })).status).toBe(422);
      expect((await as("staff").put(path(staffRole), { default_ids: [], locked_ids: [] })).status).toBe(403);
    });

    test("saved, a role's cards lead its members' Overview and its lock cannot be dropped", async () => {
      const res = await as("ops").put(path(staffRole), {
        default_ids: ["my_leave_left", "my_attendance_30d"],
        locked_ids: ["my_leave_left"],
      });
      expect(res.status).toBe(200);
      expect(d.HomeRoleKpis.parse(res.body)).toMatchObject({
        configured: true,
        default_ids: ["my_leave_left", "my_attendance_30d"],
        locked_ids: ["my_leave_left"],
      });
      const events = await countEvents("home.role_kpis_changed");
      await as("ops").put(path(staffRole), { default_ids: ["my_leave_left", "my_attendance_30d"], locked_ids: ["my_leave_left"] });
      expect(await countEvents("home.role_kpis_changed")).toBe(events);

      const o = d.HomeOverview.parse((await as("staff").get("/home/overview")).body);
      expect(o.picker_source).toBe("role");
      expect(keysOf(o.cards)).toEqual(["my_leave_left", "my_attendance_30d"]);

      const dropped = await as("staff").put("/home/kpi-picks", { kpi_ids: ["my_tasks_overdue"] });
      expect(dropped.status).toBe(422);
      expect(dropped.body.error.code).toBe("KPI_LOCKED");
      const kept = await as("staff").put("/home/kpi-picks", { kpi_ids: ["my_tasks_overdue", "my_leave_left"] });
      expect(d.HomeKpiPicker.parse(kept.body).showing_ids).toEqual(["my_leave_left", "my_tasks_overdue"]);
      expect((await as("staff").del("/home/kpi-picks")).status).toBe(204);
    });

    test("cleared, the role follows its Home view again", async () => {
      expect((await as("ops").del(path(staffRole))).status).toBe(204);
      expect(d.HomeRoleKpis.parse((await as("ops").get(path(staffRole))).body).configured).toBe(false);
      expect((await as("staff").get("/home/overview")).body.picker_source).toBe("view");
    });

    test("saved with no defaults, the role has no row and follows its Home view, as when cleared", async () => {
      await as("ops").put(path(staffRole), { default_ids: ["my_leave_left"], locked_ids: [] });
      const events = await countEvents("home.role_kpis_changed");
      const res = await as("ops").put(path(staffRole), { default_ids: [], locked_ids: [] });
      expect(res.status).toBe(200);
      expect(d.HomeRoleKpis.parse(res.body)).toMatchObject({ configured: false, default_ids: [], locked_ids: [] });
      expect(await one("SELECT count(*)::int AS n FROM role_kpi WHERE role_id = $1", [staffRole])).toEqual({ n: 0 });
      expect(await countEvents("home.role_kpis_changed")).toBe(events + 1);
      expect((await as("staff").get("/home/overview")).body.picker_source).toBe("view");
      // With no row to clear, an empty save records nothing.
      expect((await as("ops").put(path(staffRole), { default_ids: [], locked_ids: [] })).status).toBe(200);
      expect(await countEvents("home.role_kpis_changed")).toBe(events + 1);
    });

    test("a role that does not exist is a 404", async () => {
      expect((await as("ops").get(path(crypto.randomUUID()))).status).toBe(404);
      expect((await as("ops").get(path("not-a-role"))).status).toBe(404);
      expect((await as("ops").del(path(crypto.randomUUID()))).status).toBe(404);
    });
  });

  /* ---------------------------------------------------------------- *
   * The prune
   * ---------------------------------------------------------------- */

  describe("the prune after an access change", () => {
    let role;
    const grant = (module, scope) => ({ module_key: module, scope, actions: ["view"] });
    const cardsOfRole = () => one("SELECT default_ids, locked_ids FROM role_kpi WHERE role_id = $1", [role]);

    /** Save the role as Settings · Roles would, then run what the change sets off. */
    async function saveRole(grants, capabilities) {
      const detail = await access.roleDetail(role);
      await access.updateRole(
        role,
        {
          name: detail.name,
          description: detail.description,
          home_view: detail.home_view,
          grants,
          visible_fields: detail.visible_fields,
          capabilities,
        },
        users.ops,
      );
      await drain();
    }

    beforeAll(async () => {
      ({ role_id: role } = await one(
        "INSERT INTO role (code, name, home_view) VALUES ('front_desk', 'Front Desk', 'staff') RETURNING role_id",
      ));
      await saveRole([grant("home", "own"), grant("people", "all"), grant("ess", "own")], ["alerts.clear"]);
      await q(
        "INSERT INTO role_kpi (role_id, default_ids, locked_ids) VALUES ($1, $2::text[], $3::text[])",
        [role, ["attendance_today", "alerts_high_open", "my_leave_left"], ["attendance_today"]],
      );
    });

    test("a lost grant takes its cards, and their locks, out of the role", async () => {
      await saveRole([grant("home", "own"), grant("ess", "own")], ["alerts.clear"]);
      expect(await cardsOfRole()).toEqual({ default_ids: ["alerts_high_open", "my_leave_left"], locked_ids: [] });
    });

    test("a lost capability takes its card out", async () => {
      await saveRole([grant("home", "own"), grant("ess", "own")], []);
      expect(await cardsOfRole()).toEqual({ default_ids: ["my_leave_left"], locked_ids: [] });
      const pruned = await q(
        "SELECT count(*)::int AS n FROM event_log WHERE event_key = 'home.role_kpis_changed' AND entity_id = $1",
        [role],
      );
      expect(pruned.rows[0].n).toBe(2);
    });

    test("running it again changes and records nothing", async () => {
      const before = await countEvents("home.role_kpis_changed");
      await service.pruneRoleCards(role);
      await service.pruneRoleCards(role);
      expect(await cardsOfRole()).toEqual({ default_ids: ["my_leave_left"], locked_ids: [] });
      expect(await countEvents("home.role_kpis_changed")).toBe(before);
    });

    test("a role left with no card it can see has no row, and follows its Home view", async () => {
      await saveRole([grant("home", "own")], []);
      expect(await cardsOfRole()).toBeUndefined();
    });
  });

  /* ---------------------------------------------------------------- *
   * The records behind a card
   * ---------------------------------------------------------------- */

  describe("the records behind a card", () => {
    test("a card the reader may not see is a 404, never a 403, and so is one that does not exist", async () => {
      for (const key of ["headcount", "team_present", "payroll_run_state", "not_a_card"]) {
        expect([key, (await as("staff").get(`/home/kpi/${key}/meta`)).status]).toEqual([key, 404]);
        expect([key, (await as("staff").get(`/home/kpi/${key}`)).status]).toEqual([key, 404]);
      }
    });

    test("what the records are, and one page of them, in the contract's shape", async () => {
      const meta = await as("ops").get("/home/kpi/attendance_today/meta");
      expect(meta.status).toBe(200);
      const m = d.HomeKpiDetailMeta.parse(meta.body);
      expect(m.title).toBe("Clocked In Today");
      expect(m.groups.map((g) => g.value)).toContain("on_site");

      const page = await as("ops").get("/home/kpi/attendance_today");
      expect(page.status).toBe(200);
      expect(d.HomeKpiDetailPage.parse(page.body).page.size).toBe(25);

      const late = await as("ops").get("/home/kpi/attendance_today?group=late");
      expect(late.status).toBe(200);
      expect(d.HomeKpiDetailPage.parse(late.body).data.every((r) => r.cells.status.text === "Late")).toBe(true);

      expect((await as("ops").get("/home/kpi/team_present")).status).toBe(200);
    });

    test("a chip the card does not have, a page size or an unknown filter is refused", async () => {
      for (const query of ["?group=bogus", "?limit=5", "?nonsense=1"])
        expect([query, (await as("ops").get(`/home/kpi/attendance_today${query}`)).status]).toEqual([query, 422]);
    });

    test("a person's own card lists their own records", async () => {
      const res = await as("staff").get("/home/kpi/my_leave_left");
      expect(res.status).toBe(200);
      expect(d.HomeKpiDetailPage.parse(res.body).data.map((r) => r.cells.leave_type && r.cells.leave_type.text)).toContain(
        "Annual",
      );
    });
  });

  /* ---------------------------------------------------------------- *
   * The assistant and ⌘K
   * ---------------------------------------------------------------- */

  describe("the assistant and search", () => {
    test("cards.mine: the asker's own cards, as their Overview paints them", async () => {
      const read = await authorise.runRead(pool, users.staff, "cards.mine", {});
      const o = await service.overview(users.staff);
      expect(read.list).toBe(false);
      expect(read.data.source).toBe(o.picker_source);
      expect(keysOf(read.data.cards)).toEqual(keysOf(o.cards));
      for (const card of read.data.cards) d.HomeKpiCard.parse(card);
      expect(read.citations).toEqual([expect.objectContaining({ type: "screen", id: "home.overview" })]);
    });

    test("⌘K finds a card the reader may see by its title, and never one they may not", async () => {
      const group = (result) => result.groups.find((g) => g.type === "home_kpi");
      const mine = group(await searchService.search(pool, users.staff, { q: "leave left" }));
      expect(mine.items).toEqual([
        expect.objectContaining({ id: "my_leave_left", title: "My Leave Left", link: "/home?tab=overview&id=my_leave_left" }),
      ]);
      expect(group(await searchService.search(pool, users.staff, { q: "headcount" }))).toBeUndefined();
      expect(group(await searchService.search(pool, users.ops, { q: "headcount" })).items.map((i) => i.id)).toEqual([
        "headcount",
      ]);
      const typed = await searchService.search(pool, users.ops, { q: "kpi attrition" });
      expect(typed.hint).toBe("home_kpi");
      expect(group(typed).items.map((i) => i.id)).toEqual(["attrition_90d"]);
    });
  });

  test("Home's events are declared under home, with the spellings the guide names", () => {
    expect(catalogue.get("home.kpi_picks_changed").module).toBe("home");
    expect(catalogue.get("home.role_kpis_changed").module).toBe("home");
    expect(resolve.HOME_VIEW_DEFAULTS.staff).toContain("my_leave_left");
  });
});
