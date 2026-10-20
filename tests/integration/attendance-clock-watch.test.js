"use strict";
/**
 * The clock watch end to end (docs/guides/attendance.md §6.14): the reminder to clock in and the
 * automatic clock-out, on the real migrations, with the person's explanation and People's
 * correction through HTTP (every response parsed with its contract, APP_ENV=test).
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/attendance-clock-watch
 *
 * The watch runs with the instant given, on Monday 12 October 2026 (09:00 to 17:00, the working
 * week's default), and whether someone is in front of the app is stubbed on
 * services/realtime/active.js. Every person is invented.
 */
const crypto = require("node:crypto");
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const aiRegistry = require("../../src/shared/ai/registry");
const service = require("../../src/modules/attendance/attendance.service");
const watch = require("../../src/modules/attendance/attendance.clock-watch");
const repo = require("../../src/modules/attendance/attendance.repo");
const active = require("../../src/services/realtime/active");
const realtime = require("../../src/services/realtime/emitter");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const PASSWORD = "Clock-Watch9Test";
const DAY = "2026-10-12";
/** An instant on DAY at a Lagos wall-clock time (UTC+1). */
const at = (hhmm, date = DAY) => new Date(`${date}T${hhmm}:00+01:00`);

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

describeDb("the clock watch against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  let ip = 0;

  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
    post: (path, body = {}) =>
      request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
  });

  async function actorOf(who) {
    const u = await grantsCache.getAuthUser(pool, people[who].user.user_id);
    const s = await q("SELECT session_id FROM user_session WHERE user_id = $1 ORDER BY issued_at DESC LIMIT 1", [u.user_id]);
    return { ...u, session_id: s.rows[0].session_id };
  }

  /** A punch through the service at an instant, with no location (the policy reviews, never rejects). */
  const punchAt = async (who, instant, eventType = "clock_in") =>
    service.punch(
      await actorOf(who),
      { event_type: eventType, device_at: instant.toISOString(), latitude: null, longitude: null, accuracy_m: null, location_error: "denied" },
      { idempotencyKey: crypto.randomUUID(), now: instant },
    );

  /** Who is in front of the app, as the watch is told. */
  const presence = (value) => jest.spyOn(active, "activity").mockResolvedValue(value);
  const away = (last) => presence({ known: true, active: false, last_active_at: last });

  const employeeId = (who) => people[who].employee.employee_id;
  const eventsOn = (who, date = DAY) => repo.eventsOn(pool, employeeId(who), date);
  const noticesOf = (who, key) =>
    q("SELECT title, body, entity_type, entity_id, read_at FROM notification WHERE user_id = $1 AND event_key = $2 ORDER BY created_at", [
      people[who].user.user_id,
      key,
    ]).then((r) => r.rows);

  async function signIn(who) {
    ip += 1;
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", `10.72.0.${ip}`)
      .send({ email: `${who}@mycity.test`, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body.access_token;
  }

  beforeAll(async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    await rebuild(pool, config.DB_NAME);
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
    await make("staff", "Musa", "Danjuma", "employee");
    await make("late", "Zainab", "Lawal", "employee");
    await make("early", "Bisi", "Ade", "employee");
    await grantsCache.bumpTeamVersion();
    await drain();
    for (const who of Object.keys(people)) tokens[who] = await signIn(who);
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("the reminder goes once, in the first hour after the start, to whoever is not in", async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    away(null);
    expect(await watch.remind({ now: at("08:55") })).toEqual({ reminded: 0, in_front: 0 });

    await punchAt("early", at("08:50"));
    expect(await watch.remind({ now: at("09:05") })).toEqual({ reminded: 3, in_front: 0 });
    expect(await watch.remind({ now: at("09:10") })).toEqual({ reminded: 0, in_front: 0 });
    const sent = await q("SELECT employee_id FROM attendance_clock_reminder WHERE work_date = $1", [DAY]);
    expect(sent.rows.map((r) => r.employee_id)).not.toContain(employeeId("early"));

    await drain();
    const [notice] = await noticesOf("staff", "attendance.clock_in_due");
    expect(notice).toMatchObject({ title: "Time to clock in", body: "Your shift started at 09:00.", entity_type: "attendance_clock_reminder", read_at: null });
    expect(await noticesOf("early", "attendance.clock_in_due")).toEqual([]);

    // Clocking in reads it.
    await punchAt("staff", at("09:12"));
    const [read] = await noticesOf("staff", "attendance.clock_in_due");
    expect(read.read_at).not.toBeNull();

    // A day that is not worked, and a run after the first hour, send nothing.
    expect(await watch.remind({ now: at("10:05") })).toEqual({ reminded: 0, in_front: 0 });
    expect(await watch.remind({ now: at("09:05", "2026-10-11") })).toEqual({ reminded: 0, in_front: 0 });
  });

  test("someone in front of the app is not pushed: the app's prompt asks them, and a later run reminds them once away", async () => {
    const day = "2026-10-13";
    presence({ known: true, active: true, last_active_at: at("09:04", day) });
    expect(await watch.remind({ now: at("09:05", day) })).toEqual({ reminded: 0, in_front: 4 });
    expect((await q("SELECT count(*)::int AS n FROM attendance_clock_reminder WHERE work_date = $1", [day])).rows[0].n).toBe(0);
    away(at("09:06", day));
    expect(await watch.remind({ now: at("09:20", day) })).toEqual({ reminded: 4, in_front: 0 });
    // Presence that cannot be read sends it, as before.
    presence({ known: false, active: false, last_active_at: null });
    expect(await watch.remind({ now: at("09:05", "2026-10-14") })).toEqual({ reminded: 4, in_front: 0 });
  });

  test("the sign-in prompt: the first session of a working day, not yet clocked in, once", async () => {
    const day = "2026-10-15";
    const sessionAt = async (instant) =>
      (
        await q(
          `INSERT INTO user_session (user_id, refresh_token_hash, issued_at, expires_at)
           VALUES ($1, $2, $3, $3::timestamptz + interval '1 day') RETURNING session_id`,
          [people.ops.user.user_id, crypto.randomUUID(), instant],
        )
      ).rows[0].session_id;
    const user = { ...(await actorOf("ops")) };
    const todayAs = (sessionId, instant) => service.today({ ...user, session_id: sessionId }, { now: instant });

    const first = await sessionAt(at("07:30", day));
    const second = await sessionAt(at("08:15", day));
    expect((await todayAs(first, at("08:30", day))).sign_in_prompt).toBe(true);
    expect((await todayAs(second, at("08:30", day))).sign_in_prompt).toBe(false);
    // A session kept alive from yesterday is not today's first.
    expect((await todayAs(first, at("08:30", "2026-10-16"))).sign_in_prompt).toBe(false);
    // Not once clocked in, and not on a day that is not worked.
    await punchAt("ops", at("08:40", day));
    expect((await todayAs(first, at("09:00", day))).sign_in_prompt).toBe(false);
    const sunday = await sessionAt(at("08:00", "2026-10-18"));
    expect((await todayAs(sunday, at("09:00", "2026-10-18"))).sign_in_prompt).toBe(false);
    // Without a session to compare, never.
    expect(await repo.firstSessionOn(pool, { user_id: people.ops.user.user_id }, day)).toBe(false);
  });

  test("nothing closes while the shift runs, while they are in front of the app, or when presence cannot answer", async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    away(null);
    expect(await watch.clockOut({ now: at("16:55") })).toMatchObject({ clocked_out: 0 });
    presence({ known: true, active: true, last_active_at: at("17:04") });
    expect(await watch.clockOut({ now: at("17:05") })).toMatchObject({ clocked_out: 0, waiting: 2 });
    presence({ known: false, active: false, last_active_at: null });
    expect(await watch.clockOut({ now: at("17:05") })).toMatchObject({ clocked_out: 0, unknown: 2 });
    away(at("16:58"));
    expect(await watch.clockOut({ now: at("17:05") })).toMatchObject({ clocked_out: 0, waiting: 2 });
    expect((await eventsOn("staff")).filter((e) => e.event_type === "clock_out")).toEqual([]);
  });

  test("away from the app after the end: clocked out at the end, once, and told", async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    away(at("16:20"));
    expect(await watch.clockOut({ now: at("17:20") })).toMatchObject({ clocked_out: 2 });
    expect(await watch.clockOut({ now: at("17:25") })).toMatchObject({ clocked_out: 0 });

    const out = (await eventsOn("staff")).find((e) => e.event_type === "clock_out");
    expect(out).toMatchObject({ source: "system", validation_state: "accepted", excluded: false });
    expect(new Date(out.occurred_at).toISOString()).toBe(at("17:00").toISOString());
    const day = await repo.getDay(pool, employeeId("staff"), DAY);
    expect(new Date(day.last_clock_out_at).toISOString()).toBe(at("17:00").toISOString());
    expect(day.worked_minutes).toBe(468);

    await drain();
    const [notice] = await noticesOf("staff", "attendance.clocked_out_automatically");
    expect(notice).toMatchObject({ title: "Clocked out automatically", body: "12/10/2026: clocked out at 17:00.", entity_type: "attendance_record" });

    // The person's own clock-out afterwards is refused; the day reads the automatic one.
    await expect(punchAt("staff", at("17:30"), "clock_out")).rejects.toMatchObject({ code: "ALREADY_CLOCKED_OUT" });
    const days = await as("staff").get("/attendance/me?month=2026-10");
    expect(days.status).toBe(200);
    expect(days.body.data.find((d) => d.attendance_date === DAY)).toMatchObject({ clock_out_automatic: true });
  });

  test("on the app after the end: clocked out at the last moment they were, never before the clock-in", async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    await punchAt("late", at("18:10"));
    away(at("18:40"));
    expect(await watch.clockOut({ now: at("19:00") })).toMatchObject({ clocked_out: 1 });
    const out = (await eventsOn("late")).find((e) => e.event_type === "clock_out");
    expect(new Date(out.occurred_at).toISOString()).toBe(at("18:40").toISOString());
    const ev = await q("SELECT validation FROM attendance_event WHERE attendance_event_id = $1", [out.attendance_event_id]);
    expect(ev.rows[0].validation.automatic).toMatchObject({ reason: "left_app", last_active_at: at("18:40").toISOString() });
  });

  test("the register keeps the person's own punch's location and device", async () => {
    const res = await as("ops").get(`/attendance/register?date=${DAY}&q=Danjuma`);
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ location_verdict: "unverified" });
  });

  test("the person explains an automatic clock-out; People keep it or correct its time", async () => {
    const out = (await eventsOn("staff")).find((e) => e.event_type === "clock_out");
    const clockIn = (await eventsOn("staff")).find((e) => e.event_type === "clock_in");

    expect((await as("early").post(`/attendance/me/events/${out.attendance_event_id}/explanation`, { employee_note: "Not mine" })).status).toBe(404);
    const wrong = await as("staff").post(`/attendance/me/events/${clockIn.attendance_event_id}/explanation`, { employee_note: "Left at four" });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.code).toBe("NOT_AUTOMATIC");

    const res = await as("staff").post(`/attendance/me/events/${out.attendance_event_id}/explanation`, { employee_note: "I left at four for a site visit" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ exception_type: "automatic_clock_out", status: "open", employee_note: "I left at four for a site visit", detail: "Clocked out automatically at 17:00" });
    const again = await as("staff").post(`/attendance/me/events/${out.attendance_event_id}/explanation`, { employee_note: "Again" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ALREADY_EXPLAINED");

    const id = res.body.attendance_exception_id;
    const reject = await as("ops").post(`/attendance/exceptions/${id}/decision`, { decision: "reject", resolution: "Not a real clock-out" });
    expect(reject.status).toBe(422);
    const fix = await as("ops").post(`/attendance/exceptions/${id}/decision`, {
      decision: "add_clock_out",
      resolution: "Matches the site visit log",
      clock_out_time: "16:00",
    });
    expect(fix.status).toBe(200);
    expect(fix.body).toMatchObject({ status: "resolved", outcome: "corrected" });

    const events = await as("staff").get(`/attendance/me/events?date=${DAY}`);
    const system = events.body.data.find((e) => e.source === "system");
    const admin = events.body.data.find((e) => e.source === "admin");
    expect(system.excluded).toBe(true);
    expect(admin).toMatchObject({ event_type: "clock_out", excluded: false });
    const day = await repo.getDay(pool, employeeId("staff"), DAY);
    expect(new Date(day.last_clock_out_at).toISOString()).toBe(at("16:00").toISOString());
    const days = await as("staff").get("/attendance/me?month=2026-10");
    expect(days.body.data.find((d) => d.attendance_date === DAY)).toMatchObject({ clock_out_automatic: false });
  });

  test("the day-close after an automatic clock-out opens no missing clock-out", async () => {
    await service.closeDays({ now: at("12:00", "2026-10-13") });
    const missing = await q(
      `SELECT count(*)::int AS n FROM attendance_exception x JOIN attendance_day ad ON ad.attendance_day_id = x.attendance_day_id
        WHERE ad.attendance_date = $1 AND x.exception_type = 'missing_clock_out'`,
      [DAY],
    );
    expect(missing.rows[0].n).toBe(0);
  });

  test("a day that is not worked has no end: no automatic clock-out", async () => {
    await punchAt("early", at("10:00", "2026-10-18"));
    away(null);
    expect(await watch.clockOut({ now: at("20:00", "2026-10-18") })).toMatchObject({ clocked_out: 0 });
  });
});
