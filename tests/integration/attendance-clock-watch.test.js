"use strict";
/**
 * The clock watch end to end (docs/guides/attendance.md §6.14; T13): the reminder to clock in, the
 * reminders to clock out every 30 minutes from the end and the System Clock-Out at the end plus 90,
 * on the real migrations, with the person's Give Real Time and People's correction through HTTP
 * (every response parsed with its contract, APP_ENV=test).
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

  test("a reminder to clock out every 30 minutes from the end, each once, the push only for someone away", async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    // Musa (in at 09:12) and Bisi (in at 08:50) are still clocked in on Monday.
    away(null);
    expect(await watch.clockOut({ now: at("16:55") })).toMatchObject({ clock_out_reminded: 0, clocked_out: 0 });
    presence({ known: true, active: true, last_active_at: at("17:01") });
    expect(await watch.clockOut({ now: at("17:02") })).toMatchObject({ clock_out_reminded: 0, clock_out_in_front: 2 });
    away(at("17:02"));
    expect(await watch.clockOut({ now: at("17:04") })).toMatchObject({ clock_out_reminded: 2 });
    expect(await watch.clockOut({ now: at("17:09") })).toMatchObject({ clock_out_reminded: 0 });
    // Presence that cannot be read sends it.
    presence({ known: false, active: false, last_active_at: null });
    expect(await watch.clockOut({ now: at("17:31") })).toMatchObject({ clock_out_reminded: 2 });
    away(null);
    expect(await watch.clockOut({ now: at("18:02") })).toMatchObject({ clock_out_reminded: 2, clocked_out: 0 });
    expect(await watch.clockOut({ now: at("18:20") })).toMatchObject({ clock_out_reminded: 0, clocked_out: 0 });

    const slots = await q(
      "SELECT slot, due_at FROM attendance_clock_reminder WHERE employee_id = $1 AND work_date = $2 AND kind = 'clock_out_due' ORDER BY slot",
      [employeeId("staff"), DAY],
    );
    expect(slots.rows.map((r) => [r.slot, new Date(r.due_at).toISOString()])).toEqual([
      [1, at("17:00").toISOString()],
      [2, at("17:30").toISOString()],
      [3, at("18:00").toISOString()],
    ]);
    await drain();
    const notices = await noticesOf("staff", "attendance.clock_out_due");
    expect(notices).toHaveLength(3);
    expect(notices[0]).toMatchObject({ title: "Time to clock out", body: "Your shift ended at 17:00.", entity_type: "attendance_clock_reminder", read_at: null });

    // Bisi clocks out herself: her reminders are read.
    await punchAt("early", at("18:10"), "clock_out");
    expect((await noticesOf("early", "attendance.clock_out_due")).every((n) => n.read_at !== null)).toBe(true);
  });

  test("at the end plus 90 minutes, the System Clock-Out: at that moment, once, counted to the end, and told", async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    away(null);
    expect(await watch.clockOut({ now: at("18:29") })).toMatchObject({ clocked_out: 0 });
    // A late run still clocks out at 18:30.
    expect(await watch.clockOut({ now: at("18:44") })).toMatchObject({ clocked_out: 1 });
    expect(await watch.clockOut({ now: at("18:49") })).toMatchObject({ clocked_out: 0 });

    const out = (await eventsOn("staff")).find((e) => e.event_type === "clock_out");
    expect(out).toMatchObject({ source: "system", validation_state: "accepted", excluded: false });
    expect(new Date(out.occurred_at).toISOString()).toBe(at("18:30").toISOString());
    const ev = await q("SELECT validation FROM attendance_event WHERE attendance_event_id = $1", [out.attendance_event_id]);
    expect(ev.rows[0].validation.system).toEqual({
      shift_end: at("17:00").toISOString(),
      rule: "system_clock_out_after_minutes",
      minutes: 90,
    });
    const day = await repo.getDay(pool, employeeId("staff"), DAY);
    expect(new Date(day.last_clock_out_at).toISOString()).toBe(at("18:30").toISOString());
    // In at 09:12, counted to 17:00: never early, never overtime.
    expect(day).toMatchObject({ worked_minutes: 468, early_minutes: 0, overtime_minutes: 0 });

    await drain();
    const [notice] = await noticesOf("staff", "attendance.clocked_out_automatically");
    expect(notice).toMatchObject({
      title: "System Clock-Out",
      body: "12/10/2026: clocked out by the system at 18:30.",
      entity_type: "attendance_record",
    });

    // The person's own clock-out afterwards is refused; the day reads the system's.
    await expect(punchAt("staff", at("18:50"), "clock_out")).rejects.toMatchObject({ code: "ALREADY_CLOCKED_OUT" });
    const days = await as("staff").get("/attendance/me?month=2026-10");
    expect(days.status).toBe(200);
    expect(days.body.data.find((d) => d.attendance_date === DAY)).toMatchObject({ clock_out_automatic: true });
  });

  test("an evening start gets no reminder and no System Clock-Out; one between the end and that moment is clocked out at it", async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    const day = "2026-10-14";
    away(null);
    await punchAt("ops", at("17:40", day));
    await punchAt("late", at("18:40", day));
    // Tunde's reminders at 17:00 and 17:30 came before his clock-in; Zainab's day is an evening start.
    expect(await watch.clockOut({ now: at("17:45", day) })).toMatchObject({ clock_out_reminded: 0 });
    expect(await watch.clockOut({ now: at("18:03", day) })).toMatchObject({ clock_out_reminded: 1 });
    expect(await watch.clockOut({ now: at("18:41", day) })).toMatchObject({ clocked_out: 1, evening: 1 });
    expect(await watch.clockOut({ now: at("23:55", day) })).toMatchObject({ clocked_out: 0, clock_out_reminded: 0, evening: 1 });
    const tunde = await repo.getDay(pool, employeeId("ops"), day);
    expect(new Date(tunde.last_clock_out_at).toISOString()).toBe(at("18:30", day).toISOString());
    expect(tunde.worked_minutes).toBe(0);
    expect((await eventsOn("late", day)).filter((e) => e.event_type === "clock_out")).toEqual([]);
    const reminders = await q("SELECT count(*)::int AS n FROM attendance_clock_reminder WHERE employee_id = $1 AND kind = 'clock_out_due'", [
      employeeId("late"),
    ]);
    expect(reminders.rows[0].n).toBe(0);
  });

  test("the register keeps the person's own punch's location and device", async () => {
    const res = await as("ops").get(`/attendance/register?date=${DAY}&q=Danjuma`);
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ location_verdict: "unverified" });
  });

  test("Give Real Time on a System Clock-Out; People keep the system's time or correct it, which stands in for the person's", async () => {
    const out = (await eventsOn("staff")).find((e) => e.event_type === "clock_out");
    const clockIn = (await eventsOn("staff")).find((e) => e.event_type === "clock_in");
    const give = (who, id, body) => as(who).post(`/attendance/me/events/${id}/explanation`, body);

    expect((await give("early", out.attendance_event_id, { employee_note: "Not mine", real_time: "16:00" })).status).toBe(404);
    const wrong = await give("staff", clockIn.attendance_event_id, { employee_note: "Left at four", real_time: "16:00" });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.code).toBe("NOT_AUTOMATIC");
    const early = await give("staff", out.attendance_event_id, { employee_note: "I left before I came in", real_time: "08:00" });
    expect(early.status).toBe(422);
    expect(early.body.error).toMatchObject({ code: "REAL_TIME_INVALID", fields: { real_time: ["After your clock-in"] } });
    expect((await give("staff", out.attendance_event_id, { employee_note: "No time given" })).status).toBe(422);

    const res = await give("staff", out.attendance_event_id, { employee_note: "I left at four for a site visit", real_time: "16:00" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      exception_type: "automatic_clock_out",
      status: "open",
      employee_note: "I left at four for a site visit",
      real_time: "16:00",
      detail: "System Clock-Out at 18:30; real time 16:00",
    });
    const again = await give("staff", out.attendance_event_id, { employee_note: "Again", real_time: "16:10" });
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
    // People's clock-out stands in for the person's own: an hour early, worked to 16:00 (§6.4).
    expect(day).toMatchObject({ early_minutes: 60, worked_minutes: 408 });
    const days = await as("staff").get("/attendance/me?month=2026-10");
    expect(days.body.data.find((d) => d.attendance_date === DAY)).toMatchObject({ clock_out_automatic: false });
  });

  test("the day-close after a System Clock-Out opens no missing clock-out", async () => {
    await service.closeDays({ now: at("12:00", "2026-10-13") });
    const missing = await q(
      `SELECT count(*)::int AS n FROM attendance_exception x JOIN attendance_day ad ON ad.attendance_day_id = x.attendance_day_id
        WHERE ad.attendance_date = $1 AND x.exception_type = 'missing_clock_out'`,
      [DAY],
    );
    expect(missing.rows[0].n).toBe(0);
  });

  test("a day that is not worked has no end: no reminder and no System Clock-Out", async () => {
    await punchAt("early", at("10:00", "2026-10-18"));
    away(null);
    expect(await watch.clockOut({ now: at("20:00", "2026-10-18") })).toMatchObject({ clocked_out: 0, clock_out_reminded: 0 });
  });

  test("a part-timer's own hours: reminded from their own end, never on their Off day", async () => {
    const day = "2026-10-20";
    // Bisi works Tuesdays 10:00 to 14:00 from 20 October; Wednesday is her Off day.
    const d = (working, starts_at = null, ends_at = null) => ({ working, starts_at, ends_at, place: working ? "office" : null });
    await q(
      `INSERT INTO attendance_work_schedule (employee_id, days, effective_from, reason)
       VALUES ($1, $2::jsonb, $3, 'Part time from this week')`,
      [
        employeeId("early"),
        JSON.stringify([d(true), d(true, "10:00", "14:00"), d(false), d(true), d(true), d(false), d(false)].map((x, i) => ({ weekday: i + 1, ...x }))),
        day,
      ],
    );
    away(null);
    expect(await watch.remind({ now: at("09:05", day) })).toMatchObject({ reminded: 3 }); // everyone but Bisi
    expect(await watch.remind({ now: at("10:05", day) })).toMatchObject({ reminded: 1 }); // Bisi at her own start
    await punchAt("early", at("10:02", day));
    expect(await watch.clockOut({ now: at("14:03", day) })).toMatchObject({ clock_out_reminded: 1 });
    expect(await watch.clockOut({ now: at("15:31", day) })).toMatchObject({ clocked_out: 1 });
    const bisi = await repo.getDay(pool, employeeId("early"), day);
    expect(new Date(bisi.last_clock_out_at).toISOString()).toBe(at("15:30", day).toISOString());
    expect(bisi).toMatchObject({ worked_minutes: 238, late_minutes: 2, shift_starts_at: "10:00:00", shift_ends_at: "14:00:00" });
    // Her Off day: nothing at 10:05.
    const wednesday = "2026-10-21";
    expect(await watch.remind({ now: at("10:05", wednesday) })).toMatchObject({ reminded: 0 });
  });
});
