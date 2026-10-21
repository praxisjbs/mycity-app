"use strict";
/**
 * The Attendance policy's consequence rules and its pending deductions and overtime end to end
 * (docs/guides/attendance.md §6.4, §6.16, §6.17; TB's decisions of 20/10/2026, T1 to T6), on the
 * real migrations, through the service and over HTTP (every response parsed with its contract,
 * APP_ENV=test).
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/attendance-rules-pay
 *
 * September 2026 is worked Monday to Friday 09:00 to 17:00 by the company hours of the version in
 * force (22 working days, no public holiday), so Musa's ₦300,000 a month is ₦13,636.36 a day and
 * ₦1,704.55 an hour. Three versions: from 1 January (overtime confirmed by the line manager after
 * the day), from 14 September (overtime confirmed at once, a monthly cap of one hour) and from
 * 21 September (overtime only as approved beforehand, and Late Arrivals switched off). Every
 * person is invented.
 */
const crypto = require("node:crypto");
const request = require("supertest");
const c = require("@mycity/contract");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { attendanceVersion } = require("./helpers/policies");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const { maskForUser } = require("../../src/shared/rbac/field-mask");
const aiRegistry = require("../../src/shared/ai/registry");
const authorise = require("../../src/shared/ai/authorise");
const lagos = require("../../src/shared/time/lagos");
const service = require("../../src/modules/attendance/attendance.service");
const reconcile = require("../../src/modules/attendance/attendance.reconcile");
const engine = require("../../src/modules/attendance/attendance.rules-engine");
const repo = require("../../src/modules/attendance/attendance.repo");
const realtime = require("../../src/services/realtime/emitter");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const PASSWORD = "Rules-Pay9Test";
const a = c.attendance;
/** An instant at a Lagos wall-clock time (UTC+1). */
const at = (date, hhmm) => new Date(`${date}T${hhmm}:00+01:00`);

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

const HOURS = [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
  weekday <= 5 ? { weekday, working: true, starts_at: "09:00", ends_at: "17:00" } : { weekday, working: false, starts_at: null, ends_at: null },
);
const LATE_RULE = { on: true, count: 3, period: "month", hours: null, alert: true, query: false };
const OVERTIME = {
  on: true,
  after_minutes: 30,
  approval: "manager_after",
  method: "multiplier",
  multiplier: 1.5,
  amount: null,
  rest_day_multiplier: 2,
  monthly_cap_hours: 20,
};
const RULES = {
  hours: HOURS,
  grace_minutes: 0,
  late_rule: LATE_RULE,
  late_deduction: { on: true, method: "pro_rata", amount: null },
  absence_deduction: { on: true },
  location_rule: { on: true, count: 2, period: "month", alert: true, query: false },
  overtime: OVERTIME,
};

describeDb("consequence rules and pay items against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  let ip = 0;

  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
    post: (path, body = {}) => request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
  });
  const employeeId = (who) => people[who].employee.employee_id;

  async function actorOf(who) {
    const u = await grantsCache.getAuthUser(pool, people[who].user.user_id);
    const s = await q("SELECT session_id FROM user_session WHERE user_id = $1 ORDER BY issued_at DESC LIMIT 1", [u.user_id]);
    return { ...u, session_id: s.rows[0].session_id };
  }

  /** A punch through the service at an instant, with no location (the default policy reviews it). */
  const punchAt = async (who, instant, eventType = "clock_in") =>
    service.punch(
      await actorOf(who),
      { event_type: eventType, device_at: instant.toISOString(), latitude: null, longitude: null, accuracy_m: null, location_error: "denied" },
      { idempotencyKey: crypto.randomUUID(), now: instant },
    );
  const workDay = async (who, date, inAt, outAt = null) => {
    await punchAt(who, at(date, inAt));
    if (outAt) await punchAt(who, at(date, outAt), "clock_out");
  };

  const itemsOf = async (who, date, kind) =>
    (await repo.payItemsOn(pool, employeeId(who), date)).filter((x) => !kind || x.kind === kind);
  const itemOf = async (who, date, kind) => (await itemsOf(who, date, kind))[0] || null;
  const noticesOf = (who, key) =>
    q("SELECT title, body FROM notification WHERE user_id = $1 AND event_key = $2 ORDER BY created_at", [people[who].user.user_id, key]).then(
      (r) => r.rows,
    );

  beforeAll(async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    await rebuild(pool, config.DB_NAME);
    await attendanceVersion(pool, RULES, "2026-01-01");
    await attendanceVersion(pool, { ...RULES, overtime: { ...OVERTIME, approval: "automatic", monthly_cap_hours: 1 } }, "2026-09-14");
    await attendanceVersion(
      pool,
      { ...RULES, late_rule: { ...LATE_RULE, on: false }, overtime: { ...OVERTIME, approval: "pre_approved" } },
      "2026-09-21",
    );
    outbox.markReady();
    aiRegistry.load();
    ({ app } = buildApp({ strict: true, accessLog: false }));

    const make = (who, first, last, role) =>
      tx(async (client) => {
        people[who] = await createAdmin(
          client,
          {
            employee: {
              first_name: first,
              last_name: last,
              work_email: `${who}@mycity.test`,
              phone: "08031234567",
              job_title: "Officer",
              department_name: "Programmes",
              start_date: "2026-01-05",
              employment_type: "full_time",
              work_pattern: "on_site",
            },
            role_code: role,
            is_ceo: false,
          },
          PASSWORD,
          { allowAdditional: true },
        );
      });
    await make("ops", "Tunde", "Bakare", "operations_people");
    await make("manager", "Kemi", "Alade", "manager");
    await make("staff", "Musa", "Danjuma", "employee");
    await make("other", "Zainab", "Lawal", "employee");
    await make("outsider", "Bisi", "Ade", "employee");
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = ANY($2::uuid[])", [
      employeeId("manager"),
      [employeeId("staff"), employeeId("other")],
    ]);
    await q("UPDATE employee SET gross_monthly = '300000.00' WHERE employee_id = $1", [employeeId("staff")]);
    await q("UPDATE employee SET gross_monthly = '250000.00' WHERE employee_id = $1", [employeeId("ops")]);
    await grantsCache.bumpTeamVersion();
    await drain();
    for (const who of Object.keys(people)) {
      ip += 1;
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.73.0.${ip}`)
        .send({ email: `${who}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[who] = res.body.access_token;
    }
  }, 120_000);

  // Every push after a commit goes to the spy: the real emitter would hold Redis open past the run.
  beforeEach(() => jest.spyOn(realtime, "toUser").mockReturnValue(true));
  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  /* ---------------------------------------------------------------- *
   * Deductions
   * ---------------------------------------------------------------- */

  test("a late day is a pending deduction priced from the gross, the person told; no gross keeps the minutes", async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    await workDay("staff", "2026-09-01", "09:12");
    await workDay("other", "2026-09-01", "09:12");
    await workDay("ops", "2026-09-01", "09:20");
    expect(await itemOf("staff", "2026-09-01", "late")).toMatchObject({
      kind: "late",
      minutes: 12,
      method: "pro_rata",
      amount: "340.91",
      status: "pending",
      rest_day: false,
    });
    expect(await itemOf("other", "2026-09-01", "late")).toMatchObject({ minutes: 12, amount: null, status: "pending" });

    await drain();
    expect(await noticesOf("staff", "attendance.pay_item_added")).toEqual([{ title: "Late deduction", body: "01/09/2026: 12 minutes late." }]);
    // Events carry the day, the minutes and the status, never an amount.
    const { payload } = await one("SELECT payload FROM event_log WHERE event_key = 'attendance.pay_item_added' ORDER BY occurred_at LIMIT 1");
    expect(Object.keys(payload)).not.toEqual(expect.arrayContaining(["amount"]));
    expect(payload).not.toHaveProperty("pay_amount");
    expect(payload).toMatchObject({ kind: "late", minutes: 12, status: "pending", work_date: "2026-09-01" });
  });

  test("amounts are masked as the salary is: the person sees their own, People with the grant all, a line manager none", async () => {
    const mine = a.PayItemPage.parse((await as("staff").get("/attendance/me/pay-items?month=2026-09")).body);
    expect(mine.data.map((x) => [x.work_date, x.kind, x.minutes, x.pay_amount, x.salary_set])).toEqual([
      ["2026-09-01", "late", 12, "340.91", true],
    ]);
    const all = a.PayItemPage.parse((await as("ops").get("/attendance/pay-items?month=2026-09&group=deductions")).body);
    const byName = Object.fromEntries(all.data.map((x) => [x.employee.display_name, x]));
    expect(byName["Musa Danjuma"]).toMatchObject({ pay_amount: "340.91", can_decide: true });
    expect(byName["Zainab Lawal"]).toMatchObject({ pay_amount: null, salary_set: false, can_decide: true });
    // Ops's own amount is theirs to read, and never theirs to waive.
    expect(byName["Tunde Bakare"]).toMatchObject({ pay_amount: "473.48", can_decide: false });

    const team = a.PayItemPage.parse((await as("manager").get("/attendance/pay-items?month=2026-09")).body);
    expect(team.data.map((x) => x.employee.display_name).sort()).toEqual(["Musa Danjuma", "Zainab Lawal"]);
    expect(team.data.every((x) => x.pay_amount === null && x.minutes === 12 && x.can_decide === false)).toBe(true);
    expect((await as("outsider").get("/attendance/pay-items")).status).toBe(403);

    // The mask names `pay_amount`, never `amount`, which every money in the product is called.
    const manager = await grantsCache.getAuthUser(pool, people.manager.user.user_id);
    expect(await maskForUser(pool, manager, { amount: "5000.00", pay_amount: "340.91", nested: { amount: "1.00" } })).toEqual({
      amount: "5000.00",
      pay_amount: null,
      nested: { amount: "1.00" },
    });

    // The assistant reads pages of 25 through the same scope, its amounts masked as the screen's.
    const read = await authorise.runRead(pool, { ...manager, scope: null }, "attendance.pay_items", { month: "2026-09" });
    expect(read.page.total).toBe(2);
    expect(read.data.every((x) => x.pay_amount === null)).toBe(true);
  });

  test("three late days in the month are one breach with its alert; six are two; from a version that switches it off, none", async () => {
    await workDay("staff", "2026-09-02", "09:05", "17:00");
    await workDay("staff", "2026-09-03", "09:30", "17:00");
    const breaches = () =>
      q("SELECT days::text[] AS days, count, period, alert, raise_query FROM attendance_rule_breach WHERE employee_id = $1 AND rule = 'late' ORDER BY last_day", [
        employeeId("staff"),
      ]).then((r) => r.rows);
    expect(await breaches()).toEqual([
      { days: ["2026-09-01", "2026-09-02", "2026-09-03"], count: 3, period: "month", alert: true, raise_query: false },
    ]);
    await workDay("staff", "2026-09-04", "09:10", "17:00");
    await workDay("staff", "2026-09-07", "09:10", "17:00");
    expect(await breaches()).toHaveLength(1);
    await workDay("staff", "2026-09-08", "09:10", "17:00");
    expect((await breaches()).map((b) => b.days)).toEqual([
      ["2026-09-01", "2026-09-02", "2026-09-03"],
      ["2026-09-04", "2026-09-07", "2026-09-08"],
    ]);
    await drain();
    const alerts = await q(
      `SELECT a.title, a.subject_type FROM home_alert a JOIN home_alert_rule r ON r.home_alert_rule_id = a.home_alert_rule_id
        WHERE r.key = 'attendance_policy.late_rule' AND a.subject_employee_id = $1 ORDER BY a.raised_at`,
      [employeeId("staff")],
    );
    expect(alerts.rows).toEqual([
      { title: "Musa Danjuma: 3 late arrivals this month", subject_type: "attendance_rule_breach" },
      { title: "Musa Danjuma: 3 late arrivals this month", subject_type: "attendance_rule_breach" },
    ]);
    // Late Arrivals is off from 21 September: three more late days add no breach.
    for (const date of ["2026-09-21", "2026-09-22", "2026-09-23"]) await workDay("staff", date, "09:10", "17:00");
    expect(await breaches()).toHaveLength(2);
  });

  test("a day closed absent is a day's pay; leave granted later waives it with the reason, and the breach stays", async () => {
    await reconcile.closeDays({ now: at("2026-09-10", "01:30") });
    expect(await itemOf("staff", "2026-09-09", "absence")).toMatchObject({
      minutes: 480,
      method: "daily_rate",
      amount: "13636.36",
      status: "pending",
    });
    const annual = (await one("SELECT leave_type_id FROM leave_type WHERE code = 'annual'")).leave_type_id;
    await q(
      `INSERT INTO leave_request (employee_id, leave_type_id, starts_on, ends_on, amount, status)
       VALUES ($1, $2, '2026-09-09', '2026-09-09', 1, 'approved')`,
      [employeeId("staff"), annual],
    );
    await tx(async (client) => {
      await repo.lockEmployee(client, employeeId("staff"));
      await reconcile.recomputeDay(client, await repo.person(client, employeeId("staff")), "2026-09-09");
    });
    expect(await repo.getDay(pool, employeeId("staff"), "2026-09-09")).toMatchObject({ status: "leave" });
    expect(await itemOf("staff", "2026-09-09", "absence")).toMatchObject({ status: "waived", reason: "Leave granted", decided_by: null });
    await drain();
    expect((await noticesOf("staff", "attendance.pay_item_waived")).map((n) => n.body)).toEqual(["09/09/2026: Leave granted"]);
  });

  test("People waive up to 25 deductions with a reason: never their own, a narrower scope refused, one in a run skipped", async () => {
    const late = await itemOf("staff", "2026-09-02", "late");
    const other = await itemOf("other", "2026-09-01", "late");
    const own = await itemOf("ops", "2026-09-01", "late");
    const inRun = await itemOf("staff", "2026-09-03", "late");
    await q("UPDATE attendance_pay_item SET status = 'in_run' WHERE attendance_pay_item_id = $1", [inRun.attendance_pay_item_id]);
    const waive = (who, ids, reason = "Traffic on the bridge, agreed with People") =>
      as(who).post("/attendance/pay-items/waive", { pay_item_ids: ids, reason });

    const narrow = await waive("manager", [late.attendance_pay_item_id]);
    expect([narrow.status, narrow.body.error.code]).toEqual([403, "FORBIDDEN"]);
    const mine = await waive("ops", [own.attendance_pay_item_id]);
    expect([mine.status, mine.body.error.code]).toEqual([403, "OWN_RECORD"]);
    expect((await waive("ops", [late.attendance_pay_item_id], "Too short")).status).toBe(422);
    expect((await waive("ops", Array.from({ length: 26 }, () => crypto.randomUUID()))).status).toBe(422);

    const res = await waive("ops", [late.attendance_pay_item_id, other.attendance_pay_item_id, inRun.attendance_pay_item_id]);
    expect(res.status).toBe(200);
    const out = a.PayItemBatchResult.parse(res.body);
    expect(out.waived.map((x) => [x.employee.display_name, x.status, x.reason]).sort()).toEqual([
      ["Musa Danjuma", "waived", "Traffic on the bridge, agreed with People"],
      ["Zainab Lawal", "waived", "Traffic on the bridge, agreed with People"],
    ]);
    expect(out.skipped).toEqual([{ attendance_pay_item_id: inRun.attendance_pay_item_id, code: "IN_RUN" }]);
    const again = a.PayItemBatchResult.parse((await waive("ops", [late.attendance_pay_item_id])).body);
    expect(again).toEqual({ waived: [], skipped: [{ attendance_pay_item_id: late.attendance_pay_item_id, code: "NOT_PENDING" }] });
    // Waiving restores the pay, not the day: the breach that counted it stays.
    expect((await one("SELECT count(*)::int AS n FROM attendance_rule_breach WHERE employee_id = $1", [employeeId("staff")])).n).toBe(2);
    // A waived deduction stays waived when its day is recalculated: People decided it.
    await tx(async (client) => {
      await repo.lockEmployee(client, employeeId("staff"));
      await reconcile.recomputeDay(client, await repo.person(client, employeeId("staff")), "2026-09-02");
    });
    expect(await itemOf("staff", "2026-09-02", "late")).toMatchObject({ status: "waived", reason: "Traffic on the bridge, agreed with People" });
  });

  /* ---------------------------------------------------------------- *
   * Overtime
   * ---------------------------------------------------------------- */

  test("Line Manager After: overtime waits for the line manager, who confirms fewer minutes or cuts it; never their own", async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    await workDay("staff", "2026-09-10", "08:55", "17:45");
    await workDay("other", "2026-09-10", "08:55", "18:00");
    // Sunday is not worked: every worked minute is overtime, at the rest-day multiple.
    await workDay("staff", "2026-09-13", "10:00", "12:00");
    const item = await itemOf("staff", "2026-09-10", "overtime");
    expect(item).toMatchObject({ minutes: 45, method: "multiplier", amount: "1917.61", status: "pending", rest_day: false });
    expect(await itemOf("staff", "2026-09-13", "overtime")).toMatchObject({ minutes: 120, rest_day: true, amount: "6818.18", status: "pending" });
    await drain();
    const awaiting = (who) => noticesOf(who, "attendance.pay_item_added").then((rows) => rows.filter((n) => n.title === "Overtime awaiting approval"));
    expect((await awaiting("manager")).map((n) => n.body)).toContain("Musa Danjuma, 10/09/2026: 45 minutes, to confirm.");
    expect((await awaiting("staff")).length).toBeGreaterThan(0);

    const decide = (who, id, body) => as(who).post(`/attendance/pay-items/${id}/overtime`, body);
    expect((await decide("staff", item.attendance_pay_item_id, { decision: "confirm" })).status).toBe(403);
    // Nobody confirms their own, People included.
    await workDay("ops", "2026-09-10", "08:55", "17:45");
    const opsItem = await itemOf("ops", "2026-09-10", "overtime");
    const own = await decide("ops", opsItem.attendance_pay_item_id, { decision: "confirm" });
    expect([own.status, own.body.error.code]).toEqual([403, "OWN_RECORD"]);
    const tooMany = await decide("manager", item.attendance_pay_item_id, { decision: "confirm", minutes: 60 });
    expect([tooMany.status, tooMany.body.error.code]).toEqual([422, "OVERTIME_MINUTES"]);
    expect((await decide("manager", item.attendance_pay_item_id, { decision: "cut" })).status).toBe(422);

    const confirmed = a.PayItem.parse((await decide("manager", item.attendance_pay_item_id, { decision: "confirm", minutes: 30 })).body);
    expect(confirmed).toMatchObject({ status: "confirmed", confirmed_minutes: 30, pay_amount: null, decided_by_name: "Kemi Alade" });
    expect(await itemOf("staff", "2026-09-10", "overtime")).toMatchObject({ amount: "1278.41", confirmed_minutes: 30 });
    const twice = await decide("manager", item.attendance_pay_item_id, { decision: "confirm" });
    expect([twice.status, twice.body.error.code]).toEqual([409, "OVERTIME_DECIDED"]);

    const zainab = await itemOf("other", "2026-09-10", "overtime");
    const cut = a.PayItem.parse(
      (await decide("manager", zainab.attendance_pay_item_id, { decision: "cut", reason: "Not agreed beforehand" })).body,
    );
    expect(cut).toMatchObject({ status: "cut", confirmed_minutes: 0, reason: "Not agreed beforehand" });
    const deduction = await itemOf("staff", "2026-09-07", "late");
    const notOvertime = await decide("ops", deduction.attendance_pay_item_id, { decision: "confirm" });
    expect([notOvertime.status, notOvertime.body.error.code]).toEqual([422, "NOT_OVERTIME"]);
    await drain();
    expect((await noticesOf("other", "attendance.overtime_decided")).map((n) => n.title)).toEqual(["Overtime cut"]);
  });

  test("Automatic confirms at once, held to the monthly cap; a System Clock-Out is never overtime", async () => {
    // From 14 September a version confirms overtime at once, with a cap of one hour a month: 30
    // minutes of September's are already confirmed.
    await workDay("staff", "2026-09-14", "08:55", "17:45");
    expect(await itemOf("staff", "2026-09-14", "overtime")).toMatchObject({
      minutes: 45,
      status: "confirmed",
      confirmed_minutes: 30,
      reason: "Monthly cap",
    });
    await workDay("staff", "2026-09-15", "08:55", "17:40");
    expect(await itemOf("staff", "2026-09-15", "overtime")).toMatchObject({ status: "cut", confirmed_minutes: 0, reason: "Monthly cap" });

    await punchAt("other", at("2026-09-16", "08:55"));
    const watch = require("../../src/modules/attendance/attendance.clock-watch");
    jest.spyOn(require("../../src/services/realtime/active"), "activity").mockResolvedValue({ known: true, active: false, last_active_at: null });
    expect(await watch.clockOut({ now: at("2026-09-16", "18:35") })).toMatchObject({ clocked_out: 1 });
    expect(await repo.getDay(pool, employeeId("other"), "2026-09-16")).toMatchObject({ overtime_minutes: 0, early_minutes: 0 });
    expect(await itemsOf("other", "2026-09-16", "overtime")).toEqual([]);
  });

  test("Pre-Approved: confirmed up to the minutes approved beforehand, the rest cut; none without one", async () => {
    const holidays = new Set((await q("SELECT holiday_date::text AS d FROM public_holiday")).rows.map((r) => r.d));
    const weekdayFrom = (n) => {
      let d = lagos.addDays(lagos.today(), n);
      while (lagos.weekday(d) > 5 || holidays.has(d)) d = lagos.addDays(d, 1);
      return d;
    };
    const day = weekdayFrom(7);
    const next = weekdayFrom(Number(lagos.daysBetween(lagos.today(), day)) + 1);
    const approve = (who, body) =>
      as(who).post("/attendance/overtime-approvals", { employee_id: employeeId("staff"), minutes: 30, reason: "Month-end close, agreed", ...body });

    const past = await approve("manager", { work_date: "2026-09-21" });
    expect([past.status, past.body.error.code]).toEqual([422, "OVERTIME_IN_THE_PAST"]);
    const far = await approve("manager", { work_date: lagos.addDays(lagos.today(), 95) });
    expect([far.status, far.body.error.code]).toEqual([422, "OVERTIME_TOO_FAR"]);
    const own = await as("staff").post("/attendance/overtime-approvals", {
      employee_id: employeeId("staff"),
      work_date: day,
      minutes: 30,
      reason: "My own overtime, please",
    });
    expect(own.status).toBe(403);
    const res = await approve("manager", { work_date: day });
    expect(res.status).toBe(201);
    expect(a.OvertimePreApproval.parse(res.body)).toMatchObject({ work_date: day, minutes: 30, approved_by_name: "Kemi Alade" });
    await drain();
    expect((await noticesOf("staff", "attendance.overtime_approved")).length).toBe(1);

    await workDay("staff", day, "08:55", "17:50");
    expect(await itemOf("staff", day, "overtime")).toMatchObject({
      minutes: 50,
      status: "confirmed",
      confirmed_minutes: 30,
      reason: "Beyond pre-approval",
    });
    await workDay("staff", next, "08:55", "17:50");
    expect(await itemOf("staff", next, "overtime")).toMatchObject({ status: "cut", confirmed_minutes: 0, reason: "Not pre-approved" });
    const detail = await as("ops").get(`/attendance/register/${employeeId("staff")}?date=${day}`);
    expect(a.DayDetail.parse(detail.body).overtime_approval).toEqual({ minutes: 30, approved_by_name: "Kemi Alade", reason: "Month-end close, agreed" });
  });

  /* ---------------------------------------------------------------- *
   * Location Flags (gap m)
   * ---------------------------------------------------------------- */

  test("Location Flags: a refused punch's flag counts while open or accepted, any other while open or rejected", async () => {
    const who = employeeId("outsider");
    const flag = async (date, { state, status = "open", outcome = null, event = true }) => {
      const { attendance_day_id: dayId } = await one(
        `INSERT INTO attendance_day (employee_id, attendance_date, status) VALUES ($1, $2, 'present')
         ON CONFLICT (employee_id, attendance_date) DO UPDATE SET status = attendance_day.status RETURNING attendance_day_id`,
        [who, date],
      );
      let eventId = null;
      if (event)
        ({ attendance_event_id: eventId } = await one(
          `INSERT INTO attendance_event (employee_id, event_type, occurred_at, work_date, source, validation_state)
           VALUES ($1, 'clock_in', $2, $3, 'pwa', $4) RETURNING attendance_event_id`,
          [who, at(date, "08:50"), date, state],
        ));
      await q(
        `INSERT INTO attendance_exception (attendance_day_id, attendance_event_id, exception_type, severity, status, outcome)
         VALUES ($1, $2, 'outside_worksite', 'medium', $3, $4)`,
        [dayId, eventId, status, outcome],
      );
    };
    await flag("2026-08-03", { state: "review" }); // open: counts
    await flag("2026-08-04", { state: "review", status: "resolved", outcome: "accepted" }); // accepted: drops out
    await flag("2026-08-05", { state: "review", status: "resolved", outcome: "rejected" }); // rejected: counts
    await flag("2026-08-06", { state: "rejected" }); // a refused punch, open: counts
    await flag("2026-08-07", { state: "rejected", status: "resolved", outcome: "accepted" }); // the refusal kept: counts
    await flag("2026-08-10", { state: "rejected", status: "resolved", outcome: "rejected" }); // the refusal wrong: drops out
    await flag("2026-08-11", { event: false }); // a check-in's flag (PR 4), no punch: counts
    expect((await repo.locationFlags(pool, who, "2026-08-01", "2026-08-31")).map((e) => e.date)).toEqual([
      "2026-08-03",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-11",
    ]);
    await tx(async (client) => engine.countDay(client, await repo.person(client, who), "2026-08-11"));
    const breaches = await q("SELECT days::text[] AS days FROM attendance_rule_breach WHERE employee_id = $1 AND rule = 'location_flag' ORDER BY last_day", [
      who,
    ]);
    expect(breaches.rows.map((r) => r.days)).toEqual([
      ["2026-08-03", "2026-08-05"],
      ["2026-08-06", "2026-08-07"],
    ]);
  });
});
