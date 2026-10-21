"use strict";
/**
 * Home's staging seed end to end (seeds/staging/60_home.js, docs/guides/home.md §11): the real
 * migrations and reference seeds, MyCity's real staff loaded from seeds/staff/ by 10_staff.js
 * as the runner loads them, then the Home seed run twice at the same moment. It leaves the
 * same rows both times, writes every id its manifest lists, hangs everything off the real
 * staff, raises real alerts and real runs through Home's own services, and gives the
 * Operations, CEO, Partnerships and Staff Overviews something in every section they draw. Run
 * again after a seat is filled and after someone changes manager, it follows the organisation,
 * and M7's and M8's removal steps, followed once, leave none of Home's rows or alerts about them.
 * Neither the runner nor the seed itself will touch a database that says it is production.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/home-staging-seed
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public
 * schema. The seed runs as of Wednesday 14 October 2026, noon in Lagos, and every Overview is
 * read at that moment, so the figures never depend on the day the suite runs.
 */
const path = require("node:path");
const c = require("@mycity/contract");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const requestContext = require("../../src/config/request-context");
const { rebuild } = require("./helpers/schema");
const runner = require("../../scripts/db/seed");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const outbox = require("../../src/shared/events/outbox");
const lagos = require("../../src/shared/time/lagos");
const workingWeek = require("../../src/shared/time/working-week");
const realtime = require("../../src/services/realtime/emitter");
const dashboard = require("../../src/modules/dashboard/dashboard.service");
const staffSeed = require("../../seeds/staging/10_staff");
const home = require("../../seeds/staging/60_home");
const workspaceSeed = require("../../seeds/staging/40_workspace");
const forward = require("../../seeds/staging/lib/forward-rows");
const { removeHomeStagingRows } = require("../../seeds/staging/lib/home-staging-rows");
const { realStaff } = require("../../seeds/staging/lib/staff");
const { atomically } = require("../../src/shared/db/tx");
const sweeps = require("../../src/modules/alerts/alerts.sweeps");
const { KEY_PREFIX } = require("../../seeds/staging/lib/attendance");

// The queues and the socket emitter would hold Redis connections open past the run.
jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

/** The moment the seed runs as, and every Overview is read at. */
const TODAY = "2026-10-14";
const NOW = lagos.instant(TODAY, "12:00");

/** Home's own tables and the attendance register, which the seed writes through their modules. */
const OWN_TABLES = [
  "attendance_event",
  "attendance_day",
  "attendance_exception",
  "home_alert_rule",
  "home_alert",
  "saved_report",
  "report_schedule",
  "home_report_run",
];
const TABLES = [...OWN_TABLES, ...home.HOME_STAGING_ROWS.map((e) => e.table), "employee", "app_user"];

/** A seed file run as the runner runs one: in its request context, as the seed. */
const runFile = (fn, extra = {}) =>
  requestContext.run({ requestId: "seed-staging", surface: "script" }, () =>
    fn({ pool, actor: runner.ACTOR, log: () => {}, ...extra }),
  );

/** How many rows each table holds. */
async function counts() {
  const out = {};
  for (const table of TABLES) out[table] = (await one(`SELECT count(*)::int AS n FROM ${table}`)).n;
  return out;
}

/** An Overview as the wire carries it, parsed by the contract. */
async function overviewOf(person) {
  const user = await grantsCache.getAuthUser(pool, person.user_id);
  return c.dashboard.HomeOverview.parse(JSON.parse(JSON.stringify(await dashboard.overview(user, { now: NOW }))));
}

/** A card's figure: its count, or its Naira sum. */
const figure = (card) => (card.unit === "money" ? Number(card.amount) : card.value);
const cardsOf = (o) => Object.fromEntries(o.cards.map((card) => [card.key, card]));

describeDb("Home's staging seed against the real migrations", () => {
  let staff;
  let first;
  let second;

  beforeAll(async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    await rebuild(pool, config.DB_NAME);
    await q("INSERT INTO system_marker (environment) VALUES ('test')");
    workingWeek.invalidateCalendar();
    outbox.markReady();
    await runFile(staffSeed);
    // Tasks and the calendar come from My Workspace's own seed, which runs before Home's.
    await runFile(workspaceSeed, { now: NOW });
    staff = await realStaff(pool);
    await runFile(home, { now: NOW });
    first = await counts();
    await runFile(home, { now: NOW });
    second = await counts();
  }, 120_000);

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("the runner loads it after the staff it hangs off", () => {
    const files = runner.seedFiles("staging").map((f) => path.basename(f));
    expect(files.indexOf("10_staff.js")).toBeGreaterThanOrEqual(0);
    expect(files.indexOf("60_home.js")).toBeGreaterThan(files.indexOf("10_staff.js"));
  });

  test("running it twice leaves every table as the first run left it", () => {
    expect(second).toEqual(first);
    for (const table of TABLES) expect([table, first[table] > 0]).toEqual([table, true]);
  });

  test("every id the manifest lists is there, in the column it names", async () => {
    for (const { table, id_column: idColumn, ids } of home.HOME_STAGING_ROWS.filter((e) => !workspaceSeed.M2_TABLES.includes(e.table))) {
      const { n } = await one(`SELECT count(*)::int AS n FROM ${table} WHERE ${idColumn} = ANY($1::uuid[])`, [ids]);
      expect([table, n]).toEqual([table, ids.length]);
    }
  });

  test("the manifest lists a table before the tables its rows point at, so deleting in its order never trips a key", async () => {
    const tables = home.HOME_STAGING_ROWS.map((e) => e.table);
    const { rows } = await q(
      `SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent
         FROM pg_constraint WHERE contype = 'f' AND conrelid::regclass::text = ANY($1) AND confrelid::regclass::text = ANY($1)`,
      [tables],
    );
    for (const { child, parent } of rows)
      if (child !== parent) expect([child, parent, tables.indexOf(child) < tables.indexOf(parent)]).toEqual([child, parent, true]);
  });

  test("hangs everything off the real staff and adds nobody", async () => {
    // The staff sheet's import made every person on the register; the seed made nobody.
    const register = await one(
      `SELECT count(*)::int AS n,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM import_row r WHERE r.target_id = e.employee_id::text))::int AS loaded
         FROM employee e`,
    );
    expect(register.n).toBeGreaterThan(0);
    expect(register.loaded).toBe(register.n);
    const outside = await one(
      `SELECT count(*)::int AS n FROM (
         SELECT owner_id AS who FROM partner UNION ALL SELECT owner_id FROM partnership_opportunity
         UNION ALL SELECT owner_id FROM partnership_agreement UNION ALL SELECT employee_id FROM expense_request
         UNION ALL SELECT owner_id FROM budget UNION ALL SELECT primary_assignee_id FROM task
         UNION ALL SELECT owner_employee_id FROM calendar_event UNION ALL SELECT employee_id FROM employee_target
         UNION ALL SELECT owner_employee_id FROM organisational_goal UNION ALL SELECT employee_id FROM performance_review
         UNION ALL SELECT reviewer_employee_id FROM performance_review UNION ALL SELECT hiring_manager_id FROM vacancy
         UNION ALL SELECT employee_id FROM attendance_event) x
        WHERE NOT EXISTS (SELECT 1 FROM import_row r WHERE r.target_id = x.who::text)`,
    );
    expect(outside.n).toBe(0);
    const owners = await one(
      `SELECT count(*)::int AS n FROM saved_report sr
        WHERE NOT EXISTS (SELECT 1 FROM app_user u JOIN import_row r ON r.target_id = u.employee_id::text
                           WHERE u.user_id = sr.owner_user_id)`,
    );
    expect(owners.n).toBe(0);
  });

  test("attendance is the register's own: seeded punches, days before today closed, nothing after now", async () => {
    const punches = await one(
      `SELECT count(*)::int AS n,
              count(*) FILTER (WHERE source <> 'import' OR idempotency_key NOT LIKE $1 || '%')::int AS other,
              count(*) FILTER (WHERE occurred_at > $2)::int AS future,
              count(*) FILTER (WHERE work_date = $3::date)::int AS today
         FROM attendance_event`,
      [KEY_PREFIX, NOW, TODAY],
    );
    expect(punches).toMatchObject({ other: 0, future: 0 });
    expect(punches.today).toBeGreaterThan(0);
    const days = await one(
      `SELECT count(*) FILTER (WHERE attendance_date < $1::date AND closed_at IS NULL)::int AS open_before,
              count(*) FILTER (WHERE status = 'absent')::int AS absent,
              count(*) FILTER (WHERE status = 'late')::int AS late,
              count(*) FILTER (WHERE attendance_date = $1::date AND closed_at IS NOT NULL)::int AS today_closed
         FROM attendance_day`,
      [TODAY],
    );
    expect(days).toMatchObject({ open_before: 0, today_closed: 0 });
    expect(days.absent).toBeGreaterThan(0);
    expect(days.late).toBeGreaterThan(0);
    expect(first.attendance_exception).toBeGreaterThan(0);
  });

  test("every alert is a breach the sweep found, raised through the shared engine", async () => {
    const rules = await q("SELECT key, metric, created_by FROM home_alert_rule ORDER BY key");
    expect(rules.rows.map((r) => r.metric).sort()).toEqual(home.RULES.map((r) => r.metric).sort());
    for (const rule of rules.rows) expect(rule.created_by).toBeNull();
    const alerts = await q(
      `SELECT r.metric, a.severity, a.subject_type, a.outcome FROM home_alert a
         JOIN home_alert_rule r ON r.home_alert_rule_id = a.home_alert_rule_id`,
    );
    const metrics = new Set(alerts.rows.map((a) => a.metric));
    for (const metric of ["partner_inactivity", "budget_threshold"]) expect([metric, metrics.has(metric)]).toEqual([metric, true]);
    // Attendance's alerts are the Attendance policy's breaches: no version is seeded (A26), so none.
    expect(rules.rows.map((r) => r.metric)).not.toContain("late_arrivals");
    expect(rules.rows.map((r) => r.metric)).not.toContain("missing_clock_out");
    expect(alerts.rows.every((a) => a.outcome === null)).toBe(true);
    expect(alerts.rows.some((a) => a.severity === "high")).toBe(true);
  });

  test("reports through their owners: one scheduled with its last slot fired, one paused, two run once each", async () => {
    const { rows } = await q(
      `SELECT sr.name, sr.report_key, sr.owner_user_id, s.active, s.next_run_at, s.last_run_at,
              (SELECT count(*)::int FROM home_report_run r WHERE r.saved_report_id = sr.saved_report_id) AS runs
         FROM saved_report sr LEFT JOIN report_schedule s ON s.saved_report_id = sr.saved_report_id
        ORDER BY sr.name`,
    );
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(Object.keys(by).sort()).toEqual(home.REPORTS.map((r) => r.name).sort());
    expect(by["Daily Attendance"]).toMatchObject({ owner_user_id: staff.operations.user_id, active: true, runs: 2 });
    expect(by["Daily Attendance"].last_run_at).toEqual(lagos.instant("2026-10-13", "18:00"));
    expect(by["Daily Attendance"].next_run_at).toEqual(lagos.instant(TODAY, "18:00"));
    expect(by["Weekly Headcount"]).toMatchObject({ owner_user_id: staff.ceo.user_id, active: false, next_run_at: null, runs: 0 });
    expect(by["High Alerts"]).toMatchObject({ active: null, runs: 1 });
    expect(by["Team Attendance"]).toMatchObject({ owner_user_id: staff.head.user_id, active: null, runs: 1 });

    const runs = await q("SELECT number, status, format, scheduled_for FROM home_report_run ORDER BY number");
    expect(runs.rows.map((r) => r.number)).toEqual(["RPT-0001", "RPT-0002", "RPT-0003", "RPT-0004"]);
    expect(runs.rows.every((r) => r.status === "pending")).toBe(true);
    expect(runs.rows.filter((r) => r.scheduled_for !== null)).toHaveLength(2);
    const queued = await one("SELECT count(*)::int AS n FROM event_outbox WHERE event_key = 'home.report_run'");
    expect(queued.n).toBe(4);
  });

  describe("the Overview of each Home view has something in every section it draws", () => {
    test("Operations: its cards, Clocked In, the attendance chart and donut, the pipeline, the goals and the week", async () => {
      const o = await overviewOf(staff.operations);
      const cards = cardsOf(o);
      expect(Object.keys(cards)).toEqual(["attendance_today", "tasks_overdue", "expenses_pending", "partnerships_active"]);
      for (const card of o.cards) expect([card.key, figure(card) > 0]).toEqual([card.key, true]);
      expect(o.clocked_in.present).toBeGreaterThan(0);
      expect(o.chart.kind).toBe("attendance_days");
      expect(o.chart.days).toHaveLength(14);
      expect(o.chart.days.every((day) => day.present > 0 && day.present <= day.expected)).toBe(true);
      expect(o.donut).toMatchObject({ kind: "on_time" });
      expect(o.donut.on_time).toBeGreaterThan(0);
      expect(o.donut.late).toBeGreaterThan(0);
      expect(o.pipeline.stages.length).toBeGreaterThan(0);
      expect(o.pipeline.quiet_30d).toBeGreaterThan(0);
      expect(o.goals.length).toBeGreaterThan(0);
      expect(o.week.some((day) => day.items.length > 0)).toBe(true);
      expect(o.alerts_to_clear).toBeGreaterThan(0);
    });

    test("CEO: signed value, open High alerts and who is in; the goals chart, the Org KPI and the pipeline", async () => {
      const o = await overviewOf(staff.ceo);
      const cards = cardsOf(o);
      for (const key of ["partnerships_signed_value", "alerts_high_open", "attendance_today"])
        expect([key, figure(cards[key]) > 0]).toEqual([key, true]);
      expect(o.chart.kind).toBe("goals");
      expect(o.chart.goals.length).toBeGreaterThan(0);
      expect(o.donut.departments.length).toBeGreaterThan(0);
      expect(o.pipeline.stages.length).toBeGreaterThan(0);
      expect(o.week.some((day) => day.items.length > 0)).toBe(true);
    });

    test("Partnerships: every card, the value signed by month, the pipeline and the goals", async () => {
      const o = await overviewOf(staff.head);
      expect(Object.keys(cardsOf(o))).toEqual([
        "partnerships_active",
        "partnerships_signed_value",
        "partnerships_quiet_30d",
        "proposals_out",
      ]);
      for (const card of o.cards) expect([card.key, figure(card) > 0]).toEqual([card.key, true]);
      expect(o.chart.kind).toBe("signed_value");
      expect(o.chart.months.some((m) => Number(m.amount) > 0)).toBe(true);
      expect(o.pipeline.stages.length).toBeGreaterThan(0);
      expect(o.goals.length).toBeGreaterThan(0);
      expect(o.week.some((day) => day.items.length > 0)).toBe(true);
    });

    test("Staff: their own cards, the day strip, My Goals, Upcoming Leave and their week", async () => {
      const member = staff.reportsOf(staff.head)[0];
      const o = await overviewOf(member);
      const cards = cardsOf(o);
      expect(Object.keys(cards)).toEqual(["my_tasks_overdue", "my_reviews_due", "my_attendance_30d", "my_leave_left"]);
      for (const card of o.cards) expect([card.key, figure(card) > 0]).toEqual([card.key, true]);
      expect(o.day_strip).toMatchObject({ starts_at: "09:00", ends_at: "17:00" });
      expect(o.my_goals.length).toBeGreaterThan(0);
      expect(o.upcoming_leave.balance).not.toBeNull();
      expect(o.week.some((day) => day.items.length > 0)).toBe(true);
    });
  });

  describe("run again after the organisation changed", () => {
    const listed = (table) => home.HOME_STAGING_ROWS.find((e) => e.table === table).ids;

    test("a seat filled since the last run: the run passes, and only the seats still vacant have a vacancy", async () => {
      const { rows: seats } = await q("SELECT org_seat_id, title FROM org_seat WHERE status = 'vacant' ORDER BY title, org_seat_id");
      expect(seats.length).toBeGreaterThanOrEqual(2);
      await q("UPDATE org_seat SET status = 'filled', filled_by_employee_id = $2, filled_on = $3 WHERE org_seat_id = $1", [
        seats[0].org_seat_id,
        staff.ceo.employee_id,
        TODAY,
      ]);
      await expect(runFile(home, { now: NOW })).resolves.toBeUndefined();
      const { rows } = await q("SELECT title, slug::text AS slug, status FROM vacancy WHERE vacancy_id = ANY($1::uuid[]) ORDER BY number", [
        listed("vacancy"),
      ]);
      expect(rows.map((v) => v.title)).toEqual(seats.slice(1, 1 + listed("vacancy").length).map((s) => s.title));
      expect(rows.every((v) => v.status === "open")).toBe(true);
    });

    test("someone moved to another manager since the last run: the run passes, and each review is of whoever holds its place now", async () => {
      const before = await realStaff(pool);
      const moved = before.reportsOf(before.head)[0];
      await q("UPDATE employee SET line_manager_id = $2 WHERE employee_id = $1", [moved.employee_id, before.ceo.employee_id]);
      await expect(runFile(home, { now: NOW })).resolves.toBeUndefined();
      const after = await realStaff(pool);
      const expected = {};
      for (const row of forward.ROWS.filter((r) => r.table === "performance_review")) {
        const [person, by] = row.needs.map((slot) => forward.personOf(after, slot));
        if (person && by)
          expected[forward.idOf(row.table, row.key)] = [person.employee_id, by.employee_id, row.key.split(":")[0]];
      }
      const { rows } = await q(
        `SELECT performance_review_id AS id, employee_id, reviewer_employee_id, review_type
           FROM performance_review WHERE performance_review_id = ANY($1::uuid[])`,
        [listed("performance_review")],
      );
      expect(Object.fromEntries(rows.map((r) => [r.id, [r.employee_id, r.reviewer_employee_id, r.review_type]]))).toEqual(expected);
      expect(rows.some((r) => r.employee_id === moved.employee_id)).toBe(false);
    });
  });

  test("M7 and M8 following their steps once leave none of Home's rows in their tables and no alert about one", async () => {
    const TAKEN = [
      ...["partner_interaction", "partnership_agreement", "partnership_proposal", "partnership_opportunity", "partner"],
      ...["expense_request", "budget_line", "budget"],
    ];
    const ids = home.HOME_STAGING_ROWS.filter((e) => TAKEN.includes(e.table)).flatMap((e) => e.ids);
    const about = () => one("SELECT count(*)::int AS n FROM home_alert WHERE subject_id = ANY($1::text[])", [ids]);
    expect((await about()).n).toBeGreaterThan(0);
    const inTx = async (fn) => {
      const client = await pool.connect();
      try {
        return await atomically(client, () => fn(client));
      } finally {
        client.release();
      }
    };

    // Step 1, each owner's own seed; step 2, the Home seed with their rows taken out; then the morning sweep.
    const removed = await inTx((client) => removeHomeStagingRows(client, TAKEN));
    expect(removed.rows).toBeGreaterThan(0);
    const rows = forward.ROWS.filter((r) => !TAKEN.includes(r.table));
    const today = await realStaff(pool);
    await inTx((client) => forward.writeForwardRows({ db: client, staff: today, now: NOW, rows }));
    await sweeps.sweep({ now: NOW, db: pool });

    for (const table of TABLES.filter((t) => TAKEN.includes(t)))
      expect([table, (await one(`SELECT count(*)::int AS n FROM ${table} WHERE ${table}_id = ANY($1::uuid[])`, [ids])).n]).toEqual([table, 0]);
    expect((await about()).n).toBe(0);
    const orphans = await one(
      `SELECT count(*)::int AS n FROM home_alert a
        WHERE (a.subject_type = 'partner' AND NOT EXISTS (SELECT 1 FROM partner p WHERE p.partner_id::text = a.subject_id))
           OR (a.subject_type = 'budget' AND NOT EXISTS (SELECT 1 FROM budget b WHERE b.budget_id::text = a.subject_id))`,
    );
    expect(orphans.n).toBe(0);
    expect(await inTx((client) => removeHomeStagingRows(client, TAKEN))).toEqual({ rows: 0, alerts: 0 });
  });

  describe("never on production", () => {
    test("the runner refuses before any file runs", async () => {
      const before = await counts();
      await expect(
        runner.seed({ mode: "staging", db: pool, appEnv: "production", dbName: config.DB_NAME }),
      ).rejects.toMatchObject({ code: "SEED_REFUSED", problems: [expect.stringMatching(/production is never seeded/)] });
      expect(await counts()).toEqual(before);
    });

    test("the seed itself refuses a database that says it is production, even when called directly", async () => {
      const before = await counts();
      await q("UPDATE system_marker SET environment = 'production'");
      try {
        await expect(runFile(home, { now: NOW })).rejects.toMatchObject({
          code: "SEED_REFUSED",
          problems: [expect.stringMatching(/says production/)],
        });
      } finally {
        await q("UPDATE system_marker SET environment = 'test'");
      }
      expect(await counts()).toEqual(before);
    });
  });
});
