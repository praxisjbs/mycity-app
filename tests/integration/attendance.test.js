"use strict";
/**
 * Clock-in and clock-out end to end (docs/guides/attendance.md): the real migrations on a
 * throwaway database, the whole app through HTTP, every response parsed with its contract
 * (APP_ENV=test). The punch, its idempotency and its lock; the geofence and device
 * policies; the workplace's clock; leave; People's scope and masking; exceptions and
 * their decisions; the day-close; the event, audit and outbox written together.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/attendance
 *
 * Refuses to run unless the database name ends in "_test". Every person, device, worksite
 * and coordinate here is invented: the office is a fictional point at 6.500000, 3.400000
 * with a 100 m fence. Punches made through HTTP happen now; the ones whose date and time
 * matter (lateness, midnight, Saturday, the day-close) are made through the service with
 * the instant given, on dates in the past.
 */
const crypto = require("node:crypto");
const request = require("supertest");
const contract = require("@mycity/contract");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { attendanceVersion } = require("./helpers/policies");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const { picked } = require("../helpers/places");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const aiRegistry = require("../../src/shared/ai/registry");
const authorise = require("../../src/shared/ai/authorise");
const service = require("../../src/modules/attendance/attendance.service");
const repo = require("../../src/modules/attendance/attendance.repo");
const reconcile = require("../../src/modules/attendance/attendance.reconcile");
const realtime = require("../../src/services/realtime/emitter");

// The queues and the socket emitter would hold Redis connections open past the run: the jobs a
// handler queues are kept here, and every push is recorded on the spy below.
const sent = [];
jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async (queue, name, data, opts) => {
    sent.push({ queue, name, data, opts });
    return { id: String(sent.length) };
  }),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const PASSWORD = "Clock-Days9Test";
const north = (metres) => ({ latitude: 6.5 + metres / 111_195, longitude: 3.4 });
const key = () => crypto.randomUUID();

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

describeDb("attendance against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  const cookies = {};
  let site;
  let ip = 0;

  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
    post: (path, body = {}) =>
      request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    patch: (path, body = {}) =>
      request(app).patch(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
  });

  /** A punch's body, timed now unless it says otherwise. */
  const punchBody = (body = {}) => ({
    event_type: "clock_in",
    device_at: new Date().toISOString(),
    latitude: north(20).latitude,
    longitude: north(20).longitude,
    accuracy_m: 15,
    ...body,
  });

  /** A punch over HTTP, now. */
  const punch = (who, body, idem = key()) =>
    request(app)
      .post("/api/v1/attendance/punches")
      .set("Authorization", `Bearer ${tokens[who]}`)
      .set("Idempotency-Key", idem)
      .send(punchBody(body));

  /** Today in Lagos, the work date of a punch made over HTTP. */
  const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());

  /** The person as the service sees them: their login, employee and latest session. */
  async function actorOf(who) {
    const u = await grantsCache.getAuthUser(pool, people[who].user.user_id);
    const s = await q("SELECT session_id FROM user_session WHERE user_id = $1 ORDER BY issued_at DESC LIMIT 1", [u.user_id]);
    return { ...u, session_id: s.rows[0].session_id };
  }

  /** A punch through the service, at a given instant. */
  const punchAt = async (who, iso, body = {}) =>
    service.punch(
      await actorOf(who),
      {
        event_type: "clock_in",
        device_at: iso,
        latitude: north(20).latitude,
        longitude: north(20).longitude,
        accuracy_m: 15,
        ...body,
      },
      { idempotencyKey: key(), now: new Date(iso) },
    );

  /** Kemi clocked in today over HTTP: that day is in October's list only when today is in October. */
  const managerToday = () => (today().startsWith("2026-10") ? [today()] : []);

  /**
   * The Attendance policy's rules from now on: a new version over the last, from a first day before
   * every date here, so the newest version is the one in force. Homes keep the 100 m an older
   * version may hold (the 150 m minimum binds new drafts only).
   */
  let rulesNow = { home_radius_m: 100 };
  const setRules = (changes) => {
    rulesNow = { ...rulesNow, ...changes };
    return attendanceVersion(pool, rulesNow, "2026-01-01");
  };
  /** Every place's location check and the device check. */
  const setPolicy = (geofence, device) =>
    setRules({ office_geofence_mode: geofence, home_geofence_mode: geofence, site_geofence_mode: geofence, device_mode: device });

  async function signIn(who, { cookie = null } = {}) {
    ip += 1;
    const req = request(app).post("/api/v1/auth/login").set("X-Forwarded-For", `10.71.0.${ip}`);
    if (cookie) req.set("Cookie", cookie);
    const res = await req.send({ email: `${who}@mycity.test`, password: PASSWORD });
    expect(res.status).toBe(200);
    const device = (res.headers["set-cookie"] || []).find((c) => c.startsWith("mycity_device="));
    return { token: res.body.access_token, cookie: device ? device.split(";")[0] : cookie };
  }

  beforeAll(async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    await rebuild(pool, config.DB_NAME);
    // The Attendance policy's first version: no version is seeded (A26), and setPolicy below
    // publishes the next.
    await setRules({});
    outbox.markReady();
    aiRegistry.load();
    ({ app } = buildApp({ strict: true, accessLog: false }));

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
    const make = (who, first, last, role, job, department = "Programmes") =>
      tx(async (client) => {
        people[who] = await createAdmin(
          client,
          { employee: sample(first, last, `${who}@mycity.test`, job, department), role_code: role, is_ceo: false },
          PASSWORD,
          { allowAdditional: true },
        );
      });
    await make("ops", "Tunde", "Bakare", "operations_people", "Operations Lead", "Operations");
    await make("manager", "Kemi", "Alade", "manager", "Programme Lead");
    await make("staff", "Musa", "Danjuma", "employee", "Field Officer");
    await make("other", "Zainab", "Lawal", "employee", "Field Officer");
    await make("outsider", "Bisi", "Ade", "employee", "Accounts Officer", "Finance");
    await make("remote", "Femi", "Oke", "employee", "Writer");
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = ANY($2::uuid[])", [
      people.manager.employee.employee_id,
      [people.staff.employee.employee_id, people.other.employee.employee_id],
    ]);
    await q("UPDATE employee SET work_pattern = 'remote' WHERE employee_id = $1", [people.remote.employee.employee_id]);
    await grantsCache.bumpTeamVersion();
    await drain();

    for (const who of Object.keys(people)) {
      const s = await signIn(who);
      tokens[who] = s.token;
      cookies[who] = s.cookie;
    }
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("signed out every route is 401; without the people grant the register is 403", async () => {
    expect((await request(app).get("/api/v1/attendance/me/today")).status).toBe(401);
    expect((await request(app).post("/api/v1/attendance/punches").send({})).status).toBe(401);
    expect((await request(app).get("/api/v1/attendance/register")).status).toBe(401);
    expect((await request(app).get("/api/v1/devices/mine")).status).toBe(401);
    expect((await request(app).get("/api/v1/worksites")).status).toBe(401);
    expect((await as("staff").get("/attendance/register")).status).toBe(403);
    expect((await as("staff").get("/attendance/exceptions")).status).toBe(403);
    expect((await as("staff").get("/devices")).status).toBe(403);
    expect((await as("staff").get("/worksites")).status).toBe(403);
    expect((await as("staff").post("/worksites", { name: "Nope", latitude: 6, longitude: 3, radius_m: 100 })).status).toBe(403);
  });

  test("People add a worksite and assign people to it; a manager may not add one", async () => {
    expect((await as("manager").post("/worksites", { name: "X", latitude: 6, longitude: 3, radius_m: 100 })).status).toBe(403);
    const res = await as("ops").post("/worksites", {
      name: "Testbed Office",
      address: picked("1 Invented Street, Lagos"),
      latitude: 6.5,
      longitude: 3.4,
      radius_m: 100,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ code: "TESTBED-OFFICE", radius_m: 100, timezone: "Africa/Lagos", active: true, assigned_count: 0 });
    site = res.body;
    expect((await as("ops").post("/worksites", { name: "Testbed Office", latitude: 6.6, longitude: 3.3, radius_m: 50 })).body.code).toBe(
      "TESTBED-OFFICE-2",
    );
    expect((await as("ops").post("/worksites", { name: "Bad Zone", latitude: 6, longitude: 3, radius_m: 100, timezone: "Mars/Olympus" })).status).toBe(422);

    for (const who of ["staff", "other", "ops", "manager"]) {
      const a = await as("ops").post(`/worksites/${site.worksite_id}/employees`, { employee_id: people[who].employee.employee_id });
      expect(a.status).toBe(200);
      expect(a.body.worksite_id).toBe(site.worksite_id);
    }
    expect((await as("ops").get(`/worksites/${site.worksite_id}`)).body.assigned_count).toBe(4);
    expect((await as("ops").get(`/worksites/${site.worksite_id}/employees`)).body.page).toMatchObject({ size: 25, total: 4 });
    // A manager reads the worksite's people within their team only.
    const team = await as("manager").get(`/worksites/${site.worksite_id}/employees`);
    expect(team.body.data.map((e) => e.display_name).sort()).toEqual(["Kemi Alade", "Musa Danjuma", "Zainab Lawal"]);
  });

  test("the clock's state: the worksite by name and radius, no coordinates, this device", async () => {
    const t = await as("staff").get("/attendance/me/today");
    expect(t.status).toBe(200);
    expect(t.body).toMatchObject({
      state: "not_clocked_in",
      timezone: "Africa/Lagos",
      location: { kind: "worksite", name: "Testbed Office", radius_m: 100 },
      policy: { geofence_mode: "warn", device_mode: "off" },
      device: { state: "observed", registered_count: 0, can_register: true },
    });
    expect(JSON.stringify(t.body)).not.toMatch(/latitude|longitude/);
  });

  test("a punch needs an Idempotency-Key, and its body cannot name a distance, a flag or another person", async () => {
    const noKey = await as("staff").post("/attendance/punches", {
      event_type: "clock_in",
      device_at: new Date().toISOString(),
      latitude: null,
      longitude: null,
      accuracy_m: null,
    });
    expect(noKey.status).toBe(428);
    expect(noKey.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    for (const extra of [{ distance_m: 1 }, { inside: true }, { employee_id: people.other.employee.employee_id }, { known: true }]) {
      expect((await punch("staff", extra)).status).toBe(422);
    }
    expect((await punch("staff", { latitude: 6.5, longitude: null })).status).toBe(422);
  });

  test("every transition: in, a second in refused, a replay answered, out, a second out refused, in again refused", async () => {
    const idem = key();
    const body = punchBody({ note: "Morning" });
    const first = await punch("staff", body, idem);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ event_type: "clock_in", validation_state: "accepted", reasons: [], replayed: false, worksite_name: "Testbed Office" });
    expect(first.body.distance_m).toBe(20);
    expect(first.body.today).toMatchObject({ state: "clocked_in" });

    // The same key with a different body is refused, never answered with the first punch.
    expect((await punch("staff", { note: "Changed" }, idem)).status).toBe(422);
    const replay = await punch("staff", body, idem);
    expect(replay.status).toBe(201);
    expect(replay.body.attendance_event_id).toBe(first.body.attendance_event_id);
    expect(replay.headers["idempotency-replayed"]).toBe("true");

    const again = await punch("staff");
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ALREADY_CLOCKED_IN");

    const out = await punch("staff", { event_type: "clock_out" });
    expect(out.status).toBe(201);
    expect(out.body).toMatchObject({ event_type: "clock_out", validation_state: "accepted" });
    expect(out.body.today).toMatchObject({ state: "clocked_out" });

    expect((await punch("staff", { event_type: "clock_out" })).body.error.code).toBe("ALREADY_CLOCKED_OUT");
    expect((await punch("staff")).body.error.code).toBe("SHIFT_DONE");
    expect((await punch("other", { event_type: "clock_out" })).body.error.code).toBe("NOT_CLOCKED_IN");

    const rows = await q("SELECT count(*)::int AS n FROM attendance_event WHERE employee_id = $1", [people.staff.employee.employee_id]);
    expect(rows.rows[0].n).toBe(2);
  });

  test("a replayed key the middleware no longer holds still returns the first punch, not a second one", async () => {
    const idem = key();
    const body = punchBody();
    const first = await punch("other", body, idem);
    expect(first.status).toBe(201);
    await q("DELETE FROM idempotency_key WHERE key = $1", [idem]);
    const again = await punch("other", body, idem);
    expect(again.status).toBe(201);
    expect(again.body).toMatchObject({ attendance_event_id: first.body.attendance_event_id, replayed: true });
    expect((await q("SELECT count(*)::int AS n FROM attendance_event WHERE idempotency_key = $1", [idem])).rows[0].n).toBe(1);
  });

  test("two clock-outs at once with different keys: one punch, one 409", async () => {
    const [a, b] = await Promise.all([punch("other", { event_type: "clock_out" }), punch("other", { event_type: "clock_out" })]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const n = await q(
      "SELECT count(*)::int AS n FROM attendance_event WHERE employee_id = $1 AND event_type = 'clock_out'",
      [people.other.employee.employee_id],
    );
    expect(n.rows[0].n).toBe(1);
  });

  test("two clock-ins at once, with different keys and with the same key: one punch each time", async () => {
    const [a, b] = await Promise.all([punch("manager"), punch("manager")]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const idem = key();
    const body = punchBody();
    const [c, d] = await Promise.all([punch("ops", body, idem), punch("ops", body, idem)]);
    expect([c.status, d.status]).toContain(201);
    for (const r of [c, d]) expect([201, 409]).toContain(r.status);
    const ins = await q(
      "SELECT count(*)::int AS n FROM attendance_event WHERE employee_id = ANY($1::uuid[]) AND event_type = 'clock_in'",
      [[people.manager.employee.employee_id, people.ops.employee.employee_id]],
    );
    expect(ins.rows[0].n).toBe(2);
  });

  test("the database backstop: a second active clock-in for the day cannot be written", async () => {
    const day = (await q("SELECT work_date FROM attendance_event WHERE employee_id = $1 LIMIT 1", [people.ops.employee.employee_id])).rows[0].work_date;
    await expect(
      q(
        `INSERT INTO attendance_event (employee_id, event_type, occurred_at, work_date, source, validation_state)
         VALUES ($1, 'clock_in', now(), $2, 'pwa', 'accepted')`,
        [people.ops.employee.employee_id, day],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(q("UPDATE attendance_event SET note = 'changed' WHERE employee_id = $1", [people.ops.employee.employee_id])).rejects.toThrow(
      /append-only/,
    );
  });

  test("a punch writes its event, audit row and outbox row together", async () => {
    const ev = await q(
      `SELECT l.event_id, l.payload, a.action, o.event_key
         FROM event_log l JOIN audit_ledger a ON a.event_id = l.event_id JOIN event_outbox o ON o.event_id = l.event_id
        WHERE l.event_key = 'attendance.punched' AND l.payload ->> 'employee_id' = $1`,
      [people.staff.employee.employee_id],
    );
    expect(ev.rows).toHaveLength(2);
    for (const r of ev.rows) {
      expect(r.action).toBe("attendance.punched");
      expect(JSON.stringify(r.payload)).not.toMatch(/latitude|longitude|fingerprint/);
    }
  });

  test("a failure half way rolls the whole punch back: no event, no day, no audit, no outbox, no device", async () => {
    await setPolicy("warn", "off");
    const assigned = await as("ops").post(`/worksites/${site.worksite_id}/employees`, { employee_id: people.outsider.employee.employee_id });
    expect(assigned.status).toBe(200);
    const before = {
      events: (await q("SELECT count(*)::int AS n FROM attendance_event", [])).rows[0].n,
      log: (await q("SELECT count(*)::int AS n FROM event_log WHERE event_key LIKE 'attendance.%'", [])).rows[0].n,
      outbox: (await q("SELECT count(*)::int AS n FROM event_outbox WHERE event_key LIKE 'attendance.%'", [])).rows[0].n,
      devices: (await q("SELECT count(*)::int AS n FROM attendance_device WHERE employee_id = $1", [people.outsider.employee.employee_id])).rows[0].n,
    };
    const spy = jest.spyOn(repo, "insertException").mockRejectedValueOnce(new Error("disk full"));
    const res = await punch("outsider", { latitude: null, longitude: null, accuracy_m: null, location_error: "denied" });
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect((await q("SELECT count(*)::int AS n FROM attendance_event", [])).rows[0].n).toBe(before.events);
    expect((await q("SELECT count(*)::int AS n FROM event_log WHERE event_key LIKE 'attendance.%'", [])).rows[0].n).toBe(before.log);
    expect((await q("SELECT count(*)::int AS n FROM event_outbox WHERE event_key LIKE 'attendance.%'", [])).rows[0].n).toBe(before.outbox);
    expect((await q("SELECT count(*)::int AS n FROM attendance_device WHERE employee_id = $1", [people.outsider.employee.employee_id])).rows[0].n).toBe(
      before.devices,
    );
    expect((await q("SELECT count(*)::int AS n FROM attendance_day WHERE employee_id = $1", [people.outsider.employee.employee_id])).rows[0].n).toBe(0);
  });

  /* ---------------------------------------------------------------- *
   * The geofence and the device, under each mode
   * ---------------------------------------------------------------- */

  describe("the policy modes", () => {
    const D = (n) => `2026-09-${String(n).padStart(2, "0")}`; // September 2026, in the past
    let n = 0;
    /** A fresh weekday morning in September for each case, 08:00 Lagos. */
    const nextMorning = () => {
      n += 1;
      const day = [1, 2, 3, 4, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25][n - 1];
      return `${D(day)}T07:00:00Z`;
    };

    test("warn: outside the fence is recorded for review with an exception; the boundary is inside", async () => {
      await setPolicy("warn", "off");
      const outside = await punchAt("outsider", nextMorning(), { ...north(340) });
      expect(outside).toMatchObject({ validation_state: "review", reasons: ["outside_worksite"], distance_m: 340 });
      expect(outside.worksite_name).toBe("Testbed Office");
      expect(outside.message).toBe("Clocked in at 08:00. People will review it: you were 340 m from Testbed Office.");
    });

    test("someone expected at an office with none assigned is reviewed, as a remote one with no approved home is; never rejected", async () => {
      await setPolicy("block", "off");
      await q("UPDATE employee SET worksite_id = NULL WHERE employee_id = $1", [people.outsider.employee.employee_id]);
      const r = await punchAt("outsider", nextMorning(), { ...north(5000) });
      expect(r).toMatchObject({ validation_state: "review", reasons: ["location_unverified"], worksite_name: null, distance_m: null });
      expect(r.message).toBe("Clocked in at 08:00. People will review it: you have no office assigned yet.");
      expect(r.today.location).toEqual({ kind: "none", name: null, radius_m: null, home_state: null });
      const ev = await q(
        "SELECT validation -> 'geofence' AS g, latitude::float8 AS lat FROM attendance_event WHERE attendance_event_id = $1",
        [r.attendance_event_id],
      );
      expect(ev.rows[0].g).toMatchObject({ verdict: "unverified", reason: "no_worksite" });
      expect(ev.rows[0].lat).not.toBeNull();
      const exceptions = await q("SELECT exception_type, evidence ->> 'reason' AS why FROM attendance_exception WHERE attendance_event_id = $1", [
        r.attendance_event_id,
      ]);
      expect(exceptions.rows).toEqual([{ exception_type: "location_unverified", why: "no_worksite" }]);
      const remote = await punchAt("remote", nextMorning(), { ...north(9000) });
      expect(remote).toMatchObject({ validation_state: "review", reasons: ["location_unverified"], worksite_name: null });
      expect(remote.message).toBe("Clocked in at 08:00. People will review it: you have no approved home location yet.");
      expect(remote.today.location).toEqual({ kind: "remote", name: null, radius_m: null, home_state: "none" });
    });

    test("block: outside is rejected, counts for nothing and opens nothing; inside and the boundary are accepted", async () => {
      await setPolicy("block", "off");
      const at = nextMorning();
      const out = await punchAt("staff", at, { ...north(340) });
      expect(out).toMatchObject({ validation_state: "rejected", reasons: ["outside_worksite"] });
      expect(out.message).toBe("Not counted: you were 340 m from Testbed Office.");
      const date = at.slice(0, 10);
      expect(await repo.getDay(pool, people.staff.employee.employee_id, date)).toBeNull();
      // The rejected attempt does not block the next try.
      const edge = await punchAt("staff", at.replace("07:00", "07:01"), { ...north(100) });
      expect(edge).toMatchObject({ validation_state: "accepted", distance_m: 100 });
    });

    test("no reading or a poor one is reviewed under block and warn, accepted under off", async () => {
      await setPolicy("block", "off");
      const denied = await punchAt("staff", nextMorning(), { latitude: null, longitude: null, accuracy_m: null, location_error: "denied" });
      expect(denied).toMatchObject({ validation_state: "review", reasons: ["location_unverified"] });
      await setPolicy("warn", "off");
      const poor = await punchAt("staff", nextMorning(), { accuracy_m: 250 });
      expect(poor).toMatchObject({ validation_state: "review", reasons: ["location_unverified"] });
      await setPolicy("off", "off");
      const off = await punchAt("staff", nextMorning(), { ...north(900) });
      expect(off).toMatchObject({ validation_state: "accepted", reasons: [], distance_m: 900 });
    });

    test("devices: off records it, warn reviews an unknown one, block rejects it; a registered one passes", async () => {
      await setPolicy("off", "off");
      const observed = await punchAt("other", nextMorning());
      expect(observed).toMatchObject({ validation_state: "accepted", reasons: [] });
      const device = await q("SELECT status FROM attendance_device WHERE employee_id = $1", [people.other.employee.employee_id]);
      expect(device.rows.map((r) => r.status)).toEqual(["observed"]);

      await setPolicy("off", "warn");
      const warned = await punchAt("other", nextMorning());
      expect(warned).toMatchObject({ validation_state: "review", reasons: ["unknown_device"] });
      await setPolicy("off", "block");
      const blocked = await punchAt("other", nextMorning());
      expect(blocked).toMatchObject({ validation_state: "rejected", reasons: ["unknown_device"] });
      expect(blocked.message).toBe("Not counted: this device is not registered.");

      const reg = await as("other").post("/devices/mine", { label: "Zainab's phone" });
      expect(reg.status).toBe(201);
      expect(reg.body).toMatchObject({ label: "Zainab's phone", status: "registered", this_device: true });
      const known = await punchAt("other", nextMorning());
      expect(known).toMatchObject({ validation_state: "accepted", reasons: [] });
      expect(known.today.device).toMatchObject({ state: "registered", registered_count: 1, can_register: false });
    });

    test("a device clock ahead of the server is held for review whatever the modes", async () => {
      await setPolicy("off", "off");
      const at = nextMorning();
      const ahead = new Date(new Date(at).getTime() + 10 * 60_000).toISOString();
      const r = await service.punch(
        await actorOf("staff"),
        { event_type: "clock_in", device_at: ahead, latitude: north(10).latitude, longitude: north(10).longitude, accuracy_m: 10 },
        { idempotencyKey: key(), now: new Date(at) },
      );
      expect(r).toMatchObject({ validation_state: "review", reasons: ["suspicious_timestamp"], device_at: ahead });
    });

    afterAll(() => setPolicy("warn", "off"));
  });

  /* ---------------------------------------------------------------- *
   * Devices
   * ---------------------------------------------------------------- */

  test("at most three registered devices; the fourth is refused until one is removed; People remove with a reason", async () => {
    const sessions = [];
    for (let i = 0; i < 4; i += 1) sessions.push(await signIn("manager"));
    const register = (s) =>
      request(app).post("/api/v1/devices/mine").set("Authorization", `Bearer ${s.token}`).send({});
    expect((await register(sessions[0])).status).toBe(201);
    expect((await register(sessions[1])).status).toBe(201);
    // Registering the same device twice changes nothing.
    expect((await register(sessions[1])).body.status).toBe("registered");
    expect((await register(sessions[2])).status).toBe(201);
    const fourth = await register(sessions[3]);
    expect(fourth.status).toBe(409);
    expect(fourth.body.error.code).toBe("DEVICE_LIMIT");

    const mine = await request(app).get("/api/v1/devices/mine").set("Authorization", `Bearer ${sessions[3].token}`);
    expect(mine.body.page.total).toBe(4);
    const one = mine.body.data.find((d) => d.status === "registered");
    expect(JSON.stringify(mine.body)).not.toMatch(/fingerprint|known_device/);

    expect((await as("staff").post(`/devices/${one.attendance_device_id}/remove`, { removal_reason: "Lost phone" })).status).toBe(403);
    expect((await as("manager").post(`/devices/${one.attendance_device_id}/remove`, { removal_reason: "Lost phone" })).status).toBe(403);
    const removed = await as("ops").post(`/devices/${one.attendance_device_id}/remove`, { removal_reason: "Lost phone" });
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ status: "removed", removal_reason: "Lost phone", removed_by_name: "Tunde Bakare" });
    expect((await register(sessions[3])).status).toBe(201);
    await drain();
    const told = await q("SELECT title FROM notification WHERE user_id = $1 AND event_key = 'device.removed'", [people.manager.user.user_id]);
    expect(told.rows.map((r) => r.title)).toEqual(["Clock-in device removed"]);
  });

  test("a person removes only their own device; another's is a 404", async () => {
    const theirs = await q("SELECT attendance_device_id FROM attendance_device WHERE employee_id = $1 LIMIT 1", [people.manager.employee.employee_id]);
    expect((await as("staff").post(`/devices/mine/${theirs.rows[0].attendance_device_id}/remove`)).status).toBe(404);
  });

  test("People's device list is within scope: a manager sees their team's only", async () => {
    const all = await as("ops").get("/devices");
    expect(all.status).toBe(200);
    expect(all.body.page.size).toBe(25);
    const team = await as("manager").get("/devices");
    const owners = new Set(team.body.data.map((d) => d.employee.display_name));
    expect(owners.has("Bisi Ade")).toBe(false);
    const outsiderDevice = await q("SELECT attendance_device_id FROM attendance_device WHERE employee_id = $1 LIMIT 1", [people.outsider.employee.employee_id]);
    expect(outsiderDevice.rows).toHaveLength(1);
    expect((await as("manager").get(`/devices/${outsiderDevice.rows[0].attendance_device_id}`)).status).toBe(404);
    expect((await as("ops").get(`/devices/${outsiderDevice.rows[0].attendance_device_id}`)).status).toBe(200);
  });

  /* ---------------------------------------------------------------- *
   * Time: lateness, midnight, Saturday, leave
   * ---------------------------------------------------------------- */

  test("lateness is read on the workplace's clock against the working week and the policy's grace", async () => {
    await setRules({ grace_minutes: 5 });
    // Monday 5 October 2026: 09:20 Lagos is 08:20Z, 15 minutes past 09:05.
    const r = await punchAt("ops", "2026-10-05T08:20:00Z");
    const day = await repo.getDay(pool, people.ops.employee.employee_id, "2026-10-05");
    expect(r.work_date).toBe("2026-10-05");
    expect(day).toMatchObject({ status: "late", late_minutes: 15 });
    await setRules({ grace_minutes: 0 });
  });

  test("a Saturday is judged against 09:00 to 15:00, and a Sunday or a public holiday is never late", async () => {
    // Saturday 3 October 2026: 09:30 in, 16:00 out.
    await punchAt("manager", "2026-10-03T08:30:00Z");
    await punchAt("manager", "2026-10-03T15:00:00Z", { event_type: "clock_out" });
    expect(await repo.getDay(pool, people.manager.employee.employee_id, "2026-10-03")).toMatchObject({
      status: "late",
      late_minutes: 30,
      overtime_minutes: 60,
      worked_minutes: 390,
    });
    // Sunday 4 October and Independence Day, 1 October.
    await punchAt("manager", "2026-10-04T10:00:00Z");
    expect(await repo.getDay(pool, people.manager.employee.employee_id, "2026-10-04")).toMatchObject({ status: "present", late_minutes: 0 });
    await punchAt("manager", "2026-10-01T10:00:00Z");
    expect(await repo.getDay(pool, people.manager.employee.employee_id, "2026-10-01")).toMatchObject({ status: "present", late_minutes: 0 });
  });

  test("midnight: 23:30Z is the next day in Lagos; a clock-out after midnight closes yesterday's shift", async () => {
    // Tuesday 6 October 23:30Z is 00:30 on Wednesday 7 October in Lagos.
    const r = await punchAt("ops", "2026-10-06T23:30:00Z");
    expect(r.work_date).toBe("2026-10-07");
    // A late shift: in at 20:00 Lagos on Thursday 8 October, out at 00:40 on the 9th.
    await punchAt("manager", "2026-10-08T19:00:00Z");
    const out = await punchAt("manager", "2026-10-08T23:40:00Z", { event_type: "clock_out" });
    expect(out.work_date).toBe("2026-10-08");
    expect(await repo.getDay(pool, people.manager.employee.employee_id, "2026-10-08")).toMatchObject({ worked_minutes: 280 });
  });

  test("on granted leave both punches are refused with the leave's dates", async () => {
    const annual = (await q("SELECT leave_type_id FROM leave_type WHERE code = 'annual'")).rows[0].leave_type_id;
    await q(
      `INSERT INTO leave_request (employee_id, leave_type_id, starts_on, ends_on, amount, status)
       VALUES ($1, $2, '2026-10-12', '2026-10-13', 2, 'approved')`,
      [people.other.employee.employee_id, annual],
    );
    await expect(punchAt("other", "2026-10-12T08:00:00Z")).rejects.toMatchObject({
      code: "ON_LEAVE",
      status: 422,
      message: "You are on Annual leave from 12/10/2026 to 13/10/2026.",
    });
    await expect(punchAt("other", "2026-10-13T16:00:00Z", { event_type: "clock_out" })).rejects.toMatchObject({ code: "ON_LEAVE" });
  });

  /* ---------------------------------------------------------------- *
   * People: the register, scope, masking, paging
   * ---------------------------------------------------------------- */

  test("the register: everyone at work, their status, 25 a page, filtered in SQL; a manager sees their team", async () => {
    // 25 more invented people, so the register has a second page.
    for (let i = 0; i < 25; i += 1)
      await tx((client) =>
        createAdmin(
          client,
          {
            employee: {
              first_name: "Extra",
              last_name: `Person${String(i).padStart(2, "0")}`,
              work_email: `extra${i}@mycity.test`,
              phone: "08031234567",
              job_title: "Officer",
              department_name: "Programmes",
              start_date: "2026-01-05",
              employment_type: "full_time",
              work_pattern: "on_site",
            },
            role_code: "employee",
            is_ceo: false,
          },
          PASSWORD,
          { allowAdditional: true },
        ),
      );
    const date = "2026-10-05";
    const page1 = await as("ops").get(`/attendance/register?date=${date}`);
    expect(page1.status).toBe(200);
    expect(page1.body.page).toMatchObject({ number: 1, size: 25, total: 31, pages: 2, has_next: true });
    expect(page1.body.data).toHaveLength(25);
    expect(page1.body.data.every((r) => r.employee.photo_url === null)).toBe(true);
    const page2 = await as("ops").get(`/attendance/register?date=${date}&page=2`);
    expect(page2.body.data).toHaveLength(6);
    expect((await as("ops").get(`/attendance/register?date=${date}&limit=100`)).status).toBe(422);

    const late = await as("ops").get(`/attendance/register?date=${date}&status=late`);
    expect(late.body.data.map((r) => r.employee.display_name)).toEqual(["Tunde Bakare"]);
    const search = await as("ops").get(`/attendance/register?date=${date}&q=zainab`);
    expect(search.body.data.map((r) => r.employee.display_name)).toEqual(["Zainab Lawal"]);
    expect(search.body.data[0]).toMatchObject({ status: "not_in", expected_location: "Testbed Office" });

    const team = await as("manager").get(`/attendance/register?date=${date}`);
    expect(team.body.data.map((r) => r.employee.display_name).sort()).toEqual(["Kemi Alade", "Musa Danjuma", "Zainab Lawal"]);

    const summary = await as("ops").get(`/attendance/summary?date=${date}`);
    expect(summary.body).toMatchObject({ date, late: 1, on_leave: 0 });
    expect(summary.body.expected).toBe(31);
    const sunday = await as("ops").get("/attendance/summary?date=2026-10-04");
    expect(sunday.body.expected).toBe(0);
  });

  test("a person's day: within scope only; the punch's coordinates only for scope all", async () => {
    const date = "2026-10-03";
    const id = people.manager.employee.employee_id;
    const day = await as("ops").get(`/attendance/register/${id}?date=${date}`);
    expect(day.status).toBe(200);
    expect(day.body).toMatchObject({ status: "late", shift: { working_day: true, starts_at: "09:00", ends_at: "15:00" } });

    const all = await as("ops").get(`/attendance/events?employee_id=${id}&date=${date}`);
    expect(all.body.data).toHaveLength(2);
    expect(all.body.data[0].latitude).toBeCloseTo(north(20).latitude, 5);

    const self = await as("manager").get(`/attendance/register/${people.staff.employee.employee_id}?date=${date}`);
    expect(self.status).toBe(200);
    const staffEvents = await as("manager").get(`/attendance/events?employee_id=${people.staff.employee.employee_id}&date=2026-09-01`);
    for (const e of staffEvents.body.data) expect([e.latitude, e.longitude]).toEqual([null, null]);

    expect((await as("manager").get(`/attendance/register/${people.outsider.employee.employee_id}?date=${date}`)).status).toBe(404);
    expect((await as("manager").get(`/attendance/events?employee_id=${people.outsider.employee.employee_id}&date=${date}`)).status).toBe(404);
  });

  test("the person's own: days, figures, punches and exceptions, never anyone else's, no coordinates", async () => {
    const days = await as("manager").get("/attendance/me?month=2026-10");
    expect(days.status).toBe(200);
    expect(days.body.data.map((d) => d.attendance_date)).toEqual([...managerToday(), "2026-10-08", "2026-10-04", "2026-10-03", "2026-10-01"]);
    const sum = await as("manager").get("/attendance/me/summary?month=2026-10");
    expect(sum.body).toMatchObject({ month: "2026-10", days_present: 4 + managerToday().length });
    // A figure's days (My Attendance's cards): present counts late days too, as the figure does.
    const present = await as("manager").get("/attendance/me?month=2026-10&status=present");
    expect(present.body.page.total).toBe(sum.body.days_present);
    const late = await as("manager").get("/attendance/me?month=2026-10&status=late");
    expect(late.body.page.total).toBe(sum.body.late_days);
    for (const d of late.body.data) expect(d.status).toBe("late");
    expect((await as("manager").get("/attendance/me?status=sick")).status).toBe(422);
    const events = await as("manager").get("/attendance/me/events?date=2026-10-03");
    expect(events.body.data).toHaveLength(2);
    for (const e of events.body.data) expect(e.latitude).toBeNull();
    // There is no way to name another person on the own routes.
    expect((await as("manager").get(`/attendance/me?employee_id=${people.staff.employee.employee_id}`)).status).toBe(422);
  });

  /* ---------------------------------------------------------------- *
   * Exceptions and the day-close
   * ---------------------------------------------------------------- */

  test("an exception is explained by its person and decided by People with scope all, never their own", async () => {
    const list = await as("ops").get("/attendance/exceptions?status=open&exception_type=outside_worksite");
    expect(list.status).toBe(200);
    const x = list.body.data.find((e) => e.employee.display_name === "Bisi Ade");
    expect(x).toMatchObject({ status: "open", detail: "340 m from Testbed Office, radius 100 m" });

    const mine = await as("outsider").get("/attendance/me/exceptions");
    expect(mine.body.data.map((e) => e.attendance_exception_id)).toContain(x.attendance_exception_id);
    expect((await as("staff").post(`/attendance/me/exceptions/${x.attendance_exception_id}/explanation`, { employee_note: "Not mine" })).status).toBe(404);
    const explained = await as("outsider").post(`/attendance/me/exceptions/${x.attendance_exception_id}/explanation`, {
      employee_note: "Visiting a partner nearby",
    });
    expect(explained.body.employee_note).toBe("Visiting a partner nearby");

    const decide = (who, body) => as(who).post(`/attendance/exceptions/${x.attendance_exception_id}/decision`, body);
    expect((await decide("manager", { decision: "accept", resolution: "Agreed partner visit" })).status).toBe(403);
    expect((await decide("ops", { decision: "accept", resolution: "short" })).status).toBe(422);
    const rejected = await decide("ops", { decision: "reject", resolution: "No visit was booked that day" });
    expect(rejected.status).toBe(200);
    expect(rejected.body).toMatchObject({ status: "resolved", outcome: "rejected", reviewed_by_name: "Tunde Bakare" });
    expect((await decide("ops", { decision: "accept", resolution: "Changed my mind on it" })).status).toBe(409);

    const events = await as("ops").get(`/attendance/events?employee_id=${people.outsider.employee.employee_id}&date=${x.work_date}`);
    expect(events.body.data.find((e) => e.event_type === "clock_in")).toMatchObject({ excluded: true, validation_state: "review" });
    const day = await repo.getDay(pool, people.outsider.employee.employee_id, x.work_date);
    expect(day).toMatchObject({ status: null, first_clock_in_at: null });

    // Nobody decides their own: Tunde's punch on a day his location could not be read.
    await setPolicy("warn", "off");
    await punchAt("ops", "2026-08-31T08:00:00Z", { latitude: null, longitude: null, accuracy_m: null, location_error: "denied" });
    const own = (await q(
      `SELECT x.attendance_exception_id FROM attendance_exception x JOIN attendance_day d ON d.attendance_day_id = x.attendance_day_id
        WHERE d.employee_id = $1 AND x.status = 'open' LIMIT 1`,
      [people.ops.employee.employee_id],
    )).rows[0];
    const ownDecision = await as("ops").post(`/attendance/exceptions/${own.attendance_exception_id}/decision`, {
      decision: "accept",
      resolution: "Looks right to me",
    });
    expect(ownDecision.status).toBe(403);
    expect(ownDecision.body.error.code).toBe("OWN_RECORD");

    await drain();
    const told = await q("SELECT title FROM notification WHERE user_id = $1 AND event_key = 'attendance.exception_decided'", [people.outsider.user.user_id]);
    expect(told.rows.map((r) => r.title)).toEqual(["Attendance reviewed"]);
  });

  test("the day-close: a missing clock-out opens one exception, absences are counted, and a second run changes nothing", async () => {
    // Monday 21 September: Musa clocks in and never out.
    await punchAt("staff", "2026-09-28T07:50:00Z");
    const first = await service.closeDays({ now: new Date("2026-09-30T12:00:00Z") });
    expect(first.missing_clock_out).toBeGreaterThanOrEqual(1);
    const second = await service.closeDays({ now: new Date("2026-09-30T12:00:00Z") });
    expect(second).toMatchObject({ closed: 0, absent: 0, missing_clock_out: 0 });

    const day = await repo.getDay(pool, people.staff.employee.employee_id, "2026-09-28");
    expect(day.closed_at).not.toBeNull();
    expect(day).toMatchObject({ status: "present", worked_minutes: 0 });
    const missing = await q(
      `SELECT x.attendance_exception_id FROM attendance_exception x
        WHERE x.attendance_day_id = $1 AND x.exception_type = 'missing_clock_out'`,
      [day.attendance_day_id],
    );
    expect(missing.rows).toHaveLength(1);

    // Tuesday 29 September: nobody punched, so everyone at work is absent; Zainab had leave? No: absent.
    const absent = await repo.getDay(pool, people.other.employee.employee_id, "2026-09-29");
    expect(absent).toMatchObject({ status: "absent" });
    expect(absent.closed_at).not.toBeNull();

    // A clock-out after the day closed is refused: the shift is no longer open.
    await expect(punchAt("staff", "2026-09-29T00:30:00Z", { event_type: "clock_out" })).rejects.toMatchObject({ code: "NOT_CLOCKED_IN" });

    // People add the missing clock-out; the original punch is untouched, and the day is worked out again.
    const x = missing.rows[0].attendance_exception_id;
    const before = await as("ops").post(`/attendance/exceptions/${x}/decision`, { decision: "add_clock_out", resolution: "Gate log shows 17:00", clock_out_time: "08:00" });
    expect(before.status).toBe(422);
    const fixed = await as("ops").post(`/attendance/exceptions/${x}/decision`, {
      decision: "add_clock_out",
      resolution: "Gate log shows 17:00",
      clock_out_time: "17:00",
    });
    expect(fixed.status).toBe(200);
    expect(fixed.body).toMatchObject({ outcome: "corrected" });
    expect(await repo.getDay(pool, people.staff.employee.employee_id, "2026-09-28")).toMatchObject({ worked_minutes: 8 * 60 + 10 });
    const correction = await q(
      "SELECT source, recorded_by, reason FROM attendance_event WHERE employee_id = $1 AND work_date = '2026-09-28' AND event_type = 'clock_out'",
      [people.staff.employee.employee_id],
    );
    expect(correction.rows).toEqual([{ source: "admin", recorded_by: people.ops.user.user_id, reason: "Gate log shows 17:00" }]);
    expect(reconcile.detailOf("missing_clock_out", { clock_in_at: "2026-09-28T07:50:00Z", timezone: "Africa/Lagos" })).toBe(
      "Clocked in 08:50, no clock-out",
    );
  });

  test("a link opens the right day; a link to someone else's is a 404", async () => {
    const day = await repo.getDay(pool, people.staff.employee.employee_id, "2026-09-28");
    const ref = await as("ops").get(`/attendance/records/${day.attendance_day_id}`);
    expect(ref.body).toMatchObject({ employee_id: people.staff.employee.employee_id, date: "2026-09-28", attendance_exception_id: null });
    expect((await as("staff").get(`/attendance/me/records/${day.attendance_day_id}`)).status).toBe(200);
    expect((await as("other").get(`/attendance/me/records/${day.attendance_day_id}`)).status).toBe(404);
    expect((await as("manager").get(`/attendance/records/${day.attendance_day_id}`)).status).toBe(200);
    expect((await as("outsider").get(`/attendance/records/${day.attendance_day_id}`)).status).toBe(403);
  });

  test("the realtime refresh and the review notification reach the person and People", async () => {
    await drain();
    const review = await q("SELECT user_id FROM notification WHERE event_key = 'attendance.review_required'", []);
    const users = new Set(review.rows.map((r) => r.user_id));
    expect(users.has(people.ops.user.user_id)).toBe(true);
    expect(users.has(people.staff.user.user_id)).toBe(true);
    const failed = await q("SELECT count(*)::int AS n FROM event_outbox WHERE event_key LIKE 'attendance.%' AND status = 'failed'", []);
    expect(failed.rows[0].n).toBe(0);
    // The screens reload on the push: the person and People with the view both get it.
    const pushed = realtime.toUser.mock.calls.filter((c) => c[1] === "attendance.updated");
    const to = (who) => pushed.filter((c) => c[0] === people[who].user.user_id && c[2].employee_id === people.staff.employee.employee_id);
    expect(to("staff").length).toBeGreaterThan(0);
    expect(to("ops").length).toBeGreaterThan(0);
    expect(to("outsider")).toHaveLength(0);
  });

  test("an export is reserved at once, made after commit into the file the screen downloads, and its rows are the month's days", async () => {
    const res = await as("manager").post("/attendance/me/export", { month: "2026-10" });
    expect(res.status).toBe(202);
    const mine = contract.documents.ExportFile.parse(res.body);
    expect(mine).toMatchObject({ status: "pending", file_name: expect.stringMatching(/^my-attendance-.+\.xlsx$/) });
    const queued = await q("SELECT payload FROM event_log WHERE event_key = 'attendance.export_requested' ORDER BY occurred_at DESC LIMIT 1", []);
    expect(queued.rows[0].payload).toMatchObject({ kind: "month", month: "2026-10", document_id: mine.document_id });
    const rows = await require("../../src/modules/attendance/attendance.export").monthRows(people.manager.employee.employee_id, "2026-10");
    expect(rows.rows.map((r) => r.attendance_date)).toEqual([...managerToday(), "2026-10-08", "2026-10-04", "2026-10-03", "2026-10-01"]);
    expect((await as("staff").post("/attendance/export", { from: "2026-10-01", to: "2026-10-05" })).status).toBe(403);
    expect((await as("ops").post("/attendance/export", { from: "2026-09-01", to: "2026-10-05" })).status).toBe(422);
    const register = await as("ops").post("/attendance/export", { from: "2026-10-01", to: "2026-10-05" });
    expect(register.status).toBe(202);
    const theirs = contract.documents.ExportFile.parse(register.body);
    expect((await as("ops").get(`/exports/${theirs.document_id}`)).body.status).toBe("pending");

    // After commit the outbox makes each workbook into its restricted file; nothing is emailed.
    await drain();
    const docs = await q("SELECT sensitivity, title, render_status FROM document WHERE doc_type = 'attendance_export' ORDER BY title", []);
    expect(docs.rows).toEqual([
      { sensitivity: "restricted", title: "Attendance Register export", render_status: "done" },
      { sensitivity: "restricted", title: "My Attendance export", render_status: "done" },
    ]);
    expect(sent.filter((m) => m.queue === "email-send" && /export/.test(m.name))).toEqual([]);
    for (const [who, file] of [["manager", mine], ["ops", theirs]]) {
      expect((await as(who).get(`/exports/${file.document_id}`)).body.status).toBe("done");
      const content = await as(who).get(`/documents/${file.document_id}/content`);
      expect(content.status).toBe(200);
      expect(content.headers["content-type"]).toMatch(/spreadsheetml/);
    }
    // Each waits for the person who asked alone.
    expect((await as("ops").get(`/exports/${mine.document_id}`)).status).toBe(404);
    const failed = await q("SELECT count(*)::int AS n FROM event_outbox WHERE event_key = 'attendance.export_requested' AND status <> 'done'", []);
    expect(failed.rows[0].n).toBe(0);
  });

  test("the assistant reads a page of 25 within the asker's scope, with no coordinates or device identifiers", async () => {
    const manager = await actorOf("manager");
    const r = await authorise.runRead(pool, manager, "attendance.register", { date: "2026-10-05" });
    expect(r.page.size).toBe(25);
    expect(r.data.map((x) => x.employee.display_name).sort()).toEqual(["Kemi Alade", "Musa Danjuma", "Zainab Lawal"]);
    const ops = await actorOf("ops");
    const sites = await authorise.runRead(pool, ops, "worksites.list", {});
    expect(sites.data[0]).not.toHaveProperty("latitude");
    const devices = await authorise.runRead(pool, ops, "devices.list", {});
    expect(JSON.stringify(devices.data)).not.toMatch(/fingerprint|known_device/);
    const staff = await actorOf("staff");
    await expect(authorise.runRead(pool, staff, "attendance.register", {})).rejects.toMatchObject({ status: 403 });
    const own = await authorise.runRead(pool, staff, "attendance.my_days", { month: "2026-09" });
    expect(own.data.length).toBeGreaterThan(0);
  });

  test("⌘K finds a worksite, a device and a day within the reader's scope", async () => {
    const found = await as("ops").get("/search?q=testbed");
    const types = new Set((found.body.groups || []).map((g) => g.type));
    expect(types.has("worksite")).toBe(true);
    const days = await as("manager").get("/search?q=bisi");
    for (const g of days.body.groups || []) expect(["attendance_record", "attendance_exception", "device"]).not.toContain(g.type);
  });
  /* ---------------------------------------------------------------- *
   * Remote staff's homes
   * ---------------------------------------------------------------- */

  describe("remote staff's approved homes", () => {
    /** A point `metres` north of Femi's invented home at 6.600000, 3.500000. */
    const home = (metres) => ({ latitude: 6.6 + metres / 111_195, longitude: 3.5 });
    const ADDRESS = "14 Invented Close, Testbed Estate";
    const MOVED = "3 Imaginary Road, Testbed Estate";
    const send = (who, at, address = ADDRESS, accuracy = 18) =>
      as(who).post("/attendance/me/home", { home_address: picked(address), home_latitude: at.latitude, home_longitude: at.longitude, accuracy_m: accuracy });
    const decide = (who, id, body) => as(who).post(`/attendance/homes/${id}/decision`, body);
    const homeRows = async () =>
      (await q("SELECT status, address FROM attendance_home WHERE employee_id = $1 ORDER BY requested_at, status", [people.remote.employee.employee_id])).rows;
    const D = (n) => `2026-08-${String(n).padStart(2, "0")}T07:00:00Z`; // August 2026 weekdays, in the past
    let first;

    test("only a remote employee sends one, from a reading good enough; a second one waiting replaces the first", async () => {
      const notRemote = await send("staff", home(0));
      expect(notRemote.status).toBe(422);
      expect(notRemote.body.error.code).toBe("HOME_NOT_NEEDED");

      const empty = await as("remote").get("/attendance/me/home");
      expect(empty.body).toEqual({ needed: true, approved: null, pending: null, rejected: null, max_accuracy_m: 100 });
      expect((await as("staff").get("/attendance/me/home")).body).toMatchObject({ needed: false });

      const weak = await send("remote", home(0), ADDRESS, 250);
      expect(weak.status).toBe(422);
      expect(weak.body.error.code).toBe("HOME_READING_WEAK");
      expect((await as("remote").post("/attendance/me/home", { home_address: picked(ADDRESS), home_latitude: 6.6, home_longitude: 3.5, accuracy_m: 10, employee_id: people.staff.employee.employee_id })).status).toBe(422);

      const wrong = await send("remote", home(900), "Old address picked by mistake");
      expect(wrong.status).toBe(201);
      const sent2 = await send("remote", home(0));
      expect(sent2.status).toBe(201);
      expect(sent2.body.approved).toBeNull();
      expect(sent2.body.pending).toMatchObject({ status: "pending", home_address: ADDRESS, radius_m: 100, accuracy_m: 18 });
      expect(sent2.body.pending.home_latitude).toBeCloseTo(6.6, 5);
      first = sent2.body.pending.attendance_home_id;
      expect(await homeRows()).toEqual([
        { status: "superseded", address: "Old address picked by mistake" },
        { status: "pending", address: ADDRESS },
      ]);
      const now = await as("remote").get("/attendance/me/today");
      expect(now.body.location).toEqual({ kind: "remote", name: null, radius_m: null, home_state: "pending" });

      // Waiting is not approved: the punch is still reviewed for want of a home, never rejected.
      await setPolicy("block", "off");
      const waiting = await punchAt("remote", D(3), home(0));
      expect(waiting).toMatchObject({ validation_state: "review", reasons: ["location_unverified"] });
    });

    test("People list homes waiting first; the address and point only for scope all, never for a manager", async () => {
      const ops = await as("ops").get("/attendance/homes");
      expect(ops.status).toBe(200);
      expect(ops.body.page.size).toBe(25);
      expect(ops.body.data[0]).toMatchObject({
        attendance_home_id: first,
        status: "pending",
        home_address: ADDRESS,
        radius_m: 100,
        distance_from_approved_m: null,
        employee: { display_name: "Femi Oke" },
      });
      expect(ops.body.data[0].home_longitude).toBeCloseTo(3.5, 5);
      expect((await as("ops").get(`/attendance/homes?status=superseded`)).body.data.map((h) => h.status)).toEqual(["superseded"]);
      expect((await as("ops").get(`/attendance/homes/${first}`)).body).toMatchObject({ home_address: ADDRESS });
      expect((await as("ops").get("/attendance/homes?limit=100")).status).toBe(422);

      expect((await as("staff").get("/attendance/homes")).status).toBe(403);
      expect((await as("manager").get("/attendance/homes")).body.data).toEqual([]);
      expect((await as("manager").get(`/attendance/homes/${first}`)).status).toBe(404);

      // On the manager's team: the status and the distance, never the address or the point.
      await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [people.manager.employee.employee_id, people.remote.employee.employee_id]);
      await grantsCache.bumpTeamVersion();
      try {
        const team = await as("manager").get("/attendance/homes");
        expect(team.body.data.length).toBeGreaterThan(0);
        for (const h of team.body.data) expect([h.home_address, h.home_latitude, h.home_longitude]).toEqual([null, null, null]);
        expect(team.body.data[0]).toMatchObject({ status: "pending", employee: { display_name: "Femi Oke" } });
        const one = await as("manager").get(`/attendance/homes/${first}`);
        expect(one.body).toMatchObject({ home_address: null, home_latitude: null });
        expect((await decide("manager", first, { decision: "approve" })).status).toBe(403);
      } finally {
        await q("UPDATE employee SET line_manager_id = NULL WHERE employee_id = $1", [people.remote.employee.employee_id]);
        await grantsCache.bumpTeamVersion();
      }
    });

    test("People with scope all approve; a rejection needs a reason; a decided home is a 409", async () => {
      expect((await decide("ops", first, { decision: "reject", reason: "short" })).status).toBe(422);
      expect((await decide("ops", first, { decision: "maybe" })).status).toBe(422);
      const ok = await decide("ops", first, { decision: "approve" });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ status: "approved", decided_by_name: "Tunde Bakare", decision_reason: null, home_address: ADDRESS });
      const again = await decide("ops", first, { decision: "reject", reason: "Changed my mind about it" });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("HOME_DECIDED");

      const mine = await as("remote").get("/attendance/me/home");
      expect(mine.body).toMatchObject({ approved: { attendance_home_id: first, status: "approved" }, pending: null, rejected: null });
      const now = await as("remote").get("/attendance/me/today");
      expect(now.body.location).toEqual({ kind: "home", name: "Home", radius_m: 100, home_state: "approved" });
    });

    test("a remote punch is judged against the approved home: inside, the boundary, outside under warn and block", async () => {
      await setPolicy("block", "off");
      const inside = await punchAt("remote", D(4), home(60));
      expect(inside).toMatchObject({ validation_state: "accepted", reasons: [], distance_m: 60, worksite_name: "Home" });
      const stored = await q(
        "SELECT worksite_id, validation->'geofence' AS g FROM attendance_event WHERE attendance_event_id = $1",
        [inside.attendance_event_id],
      );
      expect(stored.rows[0].worksite_id).toBeNull();
      expect(stored.rows[0].g).toMatchObject({ verdict: "inside", place: "home", home_id: first, radius_m: 100 });

      expect(await punchAt("remote", D(5), home(100))).toMatchObject({ validation_state: "accepted", distance_m: 100 });

      const blocked = await punchAt("remote", D(6), home(2400));
      expect(blocked).toMatchObject({ validation_state: "rejected", reasons: ["outside_home"] });
      expect(blocked.message).toBe("Not counted: you were 2400 m from your approved home.");

      await setPolicy("warn", "off");
      const warned = await punchAt("remote", D(7), home(400));
      expect(warned).toMatchObject({ validation_state: "review", reasons: ["outside_home"], distance_m: 400 });
      expect(warned.message).toBe("Clocked in at 08:00. People will review it: you were 400 m from your approved home.");
      const x = await as("ops").get(`/attendance/exceptions?employee_id=${people.remote.employee.employee_id}&exception_type=outside_home`);
      expect(x.body.data.map((e) => e.detail)).toEqual(["400 m from the approved home, radius 100 m"]);

      // The register and the day name the home; the roster still reads the punch as remote.
      const reg = await as("ops").get("/attendance/register?date=2026-08-07&q=femi");
      expect(reg.body.data[0]).toMatchObject({ expected_location: "Home", work_pattern: "remote" });
      const day = await as("ops").get(`/attendance/register/${people.remote.employee.employee_id}?date=2026-08-07`);
      expect(day.body.expected_location).toEqual({ name: "Home", radius_m: 100 });
    });

    test("moving house: the new home waits while the old one stays the fence; a rejection is read by the person", async () => {
      await setPolicy("block", "off");
      const moved = await send("remote", home(3000), MOVED);
      expect(moved.status).toBe(201);
      expect(moved.body).toMatchObject({ approved: { attendance_home_id: first }, pending: { home_address: MOVED } });
      expect(await punchAt("remote", D(10), home(10))).toMatchObject({ validation_state: "accepted" });

      const waiting = await as("ops").get("/attendance/homes?status=pending");
      const next = waiting.body.data.find((h) => h.home_address === MOVED);
      expect(next.distance_from_approved_m).toBe(3000);
      const no = await decide("ops", next.attendance_home_id, { decision: "reject", reason: "Send it from the new house please" });
      expect(no.body).toMatchObject({ status: "rejected", decision_reason: "Send it from the new house please" });
      const after = await as("remote").get("/attendance/me/home");
      expect(after.body).toMatchObject({
        approved: { attendance_home_id: first },
        pending: null,
        rejected: { home_address: MOVED, decision_reason: "Send it from the new house please" },
      });

      const again = await send("remote", home(3000), MOVED);
      const yes = await decide("ops", again.body.pending.attendance_home_id, { decision: "approve" });
      expect(yes.body.status).toBe("approved");
      const statuses = (await homeRows()).map((r) => r.status);
      expect(statuses.filter((st) => st === "approved")).toHaveLength(1);
      expect(statuses.filter((st) => st === "superseded")).toHaveLength(2);
      expect(await punchAt("remote", D(11), home(3010))).toMatchObject({ validation_state: "accepted", distance_m: 10 });
      expect(await punchAt("remote", D(12), home(10))).toMatchObject({ validation_state: "rejected", reasons: ["outside_home"] });
      await setPolicy("warn", "off");
    });

    test("nobody decides their own home", async () => {
      await q("UPDATE employee SET work_pattern = 'remote' WHERE employee_id = $1", [people.ops.employee.employee_id]);
      try {
        const own = await send("ops", { latitude: 6.7, longitude: 3.6 }, "1 Made Up Lane, Testbed Estate");
        expect(own.status).toBe(201);
        const res = await decide("ops", own.body.pending.attendance_home_id, { decision: "approve" });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("OWN_RECORD");
      } finally {
        await q("UPDATE employee SET work_pattern = 'on_site' WHERE employee_id = $1", [people.ops.employee.employee_id]);
      }
    });

    test("events, the audit, notifications and search carry no address or coordinates", async () => {
      await drain();
      const logged = await q(
        `SELECT l.event_key, l.payload, a.before, a.after FROM event_log l LEFT JOIN audit_ledger a ON a.event_id = l.event_id
          WHERE l.event_key LIKE 'attendance.home_%'`,
        [],
      );
      expect(new Set(logged.rows.map((r) => r.event_key))).toEqual(new Set(["attendance.home_requested", "attendance.home_decided"]));
      const text = JSON.stringify(logged.rows);
      for (const secret of ["Invented Close", "Imaginary Road", "Made Up Lane", "6.6", "3.5"]) expect(text).not.toContain(secret);

      const toOps = await q("SELECT title, body FROM notification WHERE user_id = $1 AND event_key = 'attendance.home_requested'", [people.ops.user.user_id]);
      expect(toOps.rows[0]).toEqual({ title: "Home location to approve", body: "Femi Oke sent a home location." });
      const toFemi = await q("SELECT title FROM notification WHERE user_id = $1 AND event_key = 'attendance.home_decided' ORDER BY created_at", [people.remote.user.user_id]);
      expect(toFemi.rows.map((r) => r.title)).toEqual(["Home location approved", "Home location rejected", "Home location approved"]);
      const pushed = realtime.toUser.mock.calls.filter((c) => c[1] === "attendance.updated" && c[0] === people.remote.user.user_id);
      expect(pushed.length).toBeGreaterThan(0);

      const byName = await as("ops").get("/search?q=femi");
      expect((byName.body.groups || []).map((g) => g.type)).toContain("attendance_home");
      const byAddress = await as("ops").get("/search?q=imaginary");
      expect((byAddress.body.groups || []).map((g) => g.type)).not.toContain("attendance_home");
      const team = await as("manager").get("/search?q=femi");
      expect((team.body.groups || []).map((g) => g.type)).not.toContain("attendance_home");
    });
  });
  /* ---------------------------------------------------------------- *
   * Work location requests
   * ---------------------------------------------------------------- */

  describe("work location requests made before PR 4", () => {
    const lagos = require("../../src/shared/time/lagos");
    const roster = require("../../src/modules/attendance/attendance.roster");
    const { legacyRequest } = require("./helpers/legacy-places");
    const day = (n) => lagos.addDays(today(), n);
    /** A request as the person asked for it before PR 4, waiting on its approval. */
    const ask = async (who, body) => {
      const made = await tx(async (client) =>
        legacyRequest(client, await actorOf(who), { ...body, address: body.address ? contract.maps.PlaceInput.parse(body.address) : null }),
      );
      return (await as(who).get(`/attendance/me/requests/${made.location_request_id}`)).body;
    };
    /** A client's venue, typed as a field site is; `visitAt(m)` is a reading m metres north of it. */
    const SITE = { site_latitude: 6.46, site_longitude: 3.41, site_radius_m: 200 };
    const visitAt = (m) => ({ latitude: SITE.site_latitude + m / 111_195, longitude: SITE.site_longitude });
    const approve = (who, wid) => as(who).post(`/workflow/instances/${wid}/approve`, {});
    const ALL = { scope: "all", scope_ids: null };
    /** Both stages: the line manager, then Operations & People; the outcome is copied after commit. */
    async function approveBoth(wid) {
      expect((await approve("manager", wid)).status).toBe(200);
      expect((await approve("ops", wid)).status).toBe(200);
      await drain();
    }

    test("no new request is taken: the route is gone; those already made are still read", async () => {
      const res = await as("staff").post("/attendance/me/requests", { request_type: "remote_day", starts_on: day(2), ends_on: day(2), reason: "Waiting in for a delivery" });
      expect(res.status).toBe(404);
      expect(await q("SELECT count(*)::int AS n FROM attendance_location_request", []).then((r) => r.rows[0].n)).toBe(0);
      expect((await as("staff").get("/attendance/me/requests")).status).toBe(200);
    });

    test("a remote day waits on the line manager then Operations & People, nobody decides out of turn, and its day still applies", async () => {
      await setPolicy("block", "off");
      const asked = await ask("staff", { request_type: "remote_day", starts_on: day(3), ends_on: day(3), reason: "Waiting in for a delivery" });
      expect(asked).toMatchObject({ request_type: "remote_day", status: "submitted", waiting_on: "Line Manager", can_decide: false, days: 1, address: null });
      expect(asked.number).toMatch(/^WLR-\d{4}$/);
      const id = asked.location_request_id;
      const wid = asked.workflow_instance_id;

      const byManager = await as("manager").get("/attendance/requests?status=submitted");
      expect(byManager.body.data.find((r) => r.location_request_id === id)).toMatchObject({ can_decide: true, waiting_on: "Line Manager" });
      const byOps = await as("ops").get(`/attendance/requests/${id}`);
      expect(byOps.body).toMatchObject({ can_decide: false, employee: { display_name: "Musa Danjuma" } });
      expect((await approve("ops", wid)).status).toBe(403);
      expect((await approve("staff", wid)).status).toBeGreaterThanOrEqual(403);

      expect((await approve("manager", wid)).status).toBe(200);
      const atOps = await as("ops").get(`/attendance/requests/${id}`);
      expect(atOps.body).toMatchObject({ waiting_on: "Operations & People", can_decide: true, status: "submitted" });
      expect((await approve("ops", wid)).status).toBe(200);
      await drain();
      const mine = await as("staff").get(`/attendance/me/requests/${id}`);
      expect(mine.body).toMatchObject({ status: "approved", waiting_on: null });
      expect(mine.body.decided_at).toBeTruthy();
      expect((await as("other").get(`/attendance/me/requests/${id}`)).status).toBe(404);

      // On the day the approval is the check: far from the office, under block, accepted.
      const punched = await punchAt("staff", `${day(3)}T07:00:00Z`, { ...north(9000) });
      expect(punched).toMatchObject({ validation_state: "accepted", reasons: [], worksite_name: "Remote Day" });
      const ev = await q("SELECT worksite_id, validation->'geofence' AS g FROM attendance_event WHERE attendance_event_id = $1", [punched.attendance_event_id]);
      expect(ev.rows[0].worksite_id).toBeNull();
      expect(ev.rows[0].g).toMatchObject({ verdict: "not_applied", reason: "approved_request", place: "remote_day", request_id: id });
      const reg = await as("ops").get(`/attendance/register?date=${day(3)}&q=musa`);
      expect(reg.body.data[0]).toMatchObject({ expected_location: "Remote Day" });
      const row = (await roster.page(pool, { date: day(3), q: "Musa" }, ALL, {})).data[0];
      expect(row).toMatchObject({ status: "remote", worksite: null });
      // The day after, the office again.
      const next = await punchAt("staff", `${day(4)}T07:00:00Z`, { ...north(9000) });
      expect(next).toMatchObject({ validation_state: "rejected", reasons: ["outside_worksite"] });
    });

    test("a client visit is fenced on its site: inside counts, outside is rejected under block, no reading is reviewed", async () => {
      await setPolicy("block", "off");
      const asked = await ask("other", { request_type: "client_visit", starts_on: day(5), ends_on: day(6), address: picked("Client office, 4 Example Road"), ...SITE });
      expect(asked).toMatchObject({ ...SITE, home_latitude: null, home_longitude: null });
      await approveBoth(asked.workflow_instance_id);

      const inside = await punchAt("other", `${day(5)}T07:00:00Z`, visitAt(150));
      expect(inside).toMatchObject({ validation_state: "accepted", reasons: [], worksite_name: "Client Visit", distance_m: 150 });
      expect(inside.today.location).toMatchObject({ kind: "client_visit", name: "Client Visit", radius_m: 200 });
      const ev = await q("SELECT worksite_id, validation->'geofence' AS g FROM attendance_event WHERE attendance_event_id = $1", [inside.attendance_event_id]);
      expect(ev.rows[0].worksite_id).toBeNull();
      expect(ev.rows[0].g).toMatchObject({ verdict: "inside", place: "client_visit", request_id: asked.location_request_id });

      const out = await punchAt("other", `${day(6)}T07:00:00Z`, visitAt(600));
      expect(out).toMatchObject({ validation_state: "rejected", reasons: ["outside_worksite"] });
      expect(out.message).toBe("Not counted: you were 600 m from the client's site.");
      const denied = await punchAt("other", `${day(6)}T07:01:00Z`, { latitude: null, longitude: null, accuracy_m: null, location_error: "denied" });
      expect(denied).toMatchObject({ validation_state: "review", reasons: ["location_unverified"] });
    });

    test("a client visit sent before sites were asked for keeps its approval as the check", async () => {
      await setPolicy("block", "off");
      const asked = await ask("other", { request_type: "client_visit", starts_on: day(11), ends_on: day(11), address: picked("Client office, 4 Example Road") });
      await approveBoth(asked.workflow_instance_id);
      const far = await punchAt("other", `${day(11)}T07:00:00Z`, { ...north(9000) });
      expect(far).toMatchObject({ validation_state: "accepted", reasons: [], worksite_name: "Client Visit" });
      expect(far.today.location).toMatchObject({ kind: "approved_day", name: "Client Visit", radius_m: null });
    });

    test("a temporary home is fenced like a home for its days, over the approved one", async () => {
      await setPolicy("block", "off");
      const temp = (m) => ({ latitude: 6.62 + m / 111_195, longitude: 3.52 });
      await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [people.manager.employee.employee_id, people.remote.employee.employee_id]);
      await grantsCache.bumpTeamVersion();
      try {
        const asked = await ask("remote", {
          request_type: "temporary_home", starts_on: day(7), ends_on: day(9), address: picked("9 Sample Crescent", { details: "Flat 2" }),
          home_latitude: temp(0).latitude, home_longitude: temp(0).longitude, accuracy_m: 14,
        });
        expect(asked).toMatchObject({ days: 3, address: "Flat 2, 9 Sample Crescent", accuracy_m: 14 });
        expect(asked.home_latitude).toBeCloseTo(temp(0).latitude, 5);
        const team = await as("manager").get(`/attendance/requests/${asked.location_request_id}`);
        expect([team.body.home_latitude, team.body.home_longitude]).toEqual([null, null]);
        expect(team.body.address).toBe("Flat 2, 9 Sample Crescent");
        await approveBoth(asked.workflow_instance_id);

        const inside = await punchAt("remote", `${day(8)}T07:00:00Z`, temp(40));
        expect(inside).toMatchObject({ validation_state: "accepted", distance_m: 40, worksite_name: "Temporary Home" });
        expect(inside.today.location).toMatchObject({ kind: "temporary_home", name: "Temporary Home", radius_m: 100, home_state: "approved" });
        const out = await punchAt("remote", `${day(9)}T07:00:00Z`, temp(600));
        expect(out).toMatchObject({ validation_state: "rejected", reasons: ["outside_home"] });
        expect(out.message).toBe("Not counted: you were 600 m from your temporary home.");
        const detail = await as("ops").get(`/attendance/register/${people.remote.employee.employee_id}?date=${day(8)}`);
        expect(detail.body.expected_location).toEqual({ name: "Temporary Home", radius_m: 100 });
      } finally {
        await q("UPDATE employee SET line_manager_id = NULL WHERE employee_id = $1", [people.remote.employee.employee_id]);
        await grantsCache.bumpTeamVersion();
      }
    });

    test("withdrawn while waiting, cancelled before it starts, never once it has started", async () => {
      const waiting = await ask("other", { request_type: "client_visit", starts_on: day(20), ends_on: day(20), address: picked("Client office, 4 Example Road"), ...SITE });
      const withdrawn = await as("other").post(`/attendance/me/requests/${waiting.location_request_id}/cancel`, { reason: "Meeting moved online" });
      expect(withdrawn.body).toMatchObject({ status: "cancelled", cancel_reason: "Meeting moved online", waiting_on: null });
      const instance = await q("SELECT state FROM workflow_instance WHERE workflow_instance_id = $1", [waiting.workflow_instance_id]);
      expect(instance.rows[0].state).toBe("cancelled");
      expect((await as("other").post(`/attendance/me/requests/${waiting.location_request_id}/cancel`, {})).status).toBe(409);

      const later = await ask("other", { request_type: "client_visit", starts_on: day(22), ends_on: day(23), address: picked("Client office, 4 Example Road"), ...SITE });
      await approveBoth(later.workflow_instance_id);
      expect((await as("other").post(`/attendance/me/requests/${later.location_request_id}/cancel`, {})).body.status).toBe("cancelled");

      const started = await ask("other", { request_type: "client_visit", starts_on: day(0), ends_on: day(1), address: picked("Client office, 4 Example Road"), ...SITE });
      await approveBoth(started.workflow_instance_id);
      const refused = await as("other").post(`/attendance/me/requests/${started.location_request_id}/cancel`, {});
      expect([refused.status, refused.body.error.code]).toEqual([409, "REQUEST_NOT_CANCELLABLE"]);
      expect((await as("staff").post(`/attendance/me/requests/${started.location_request_id}/cancel`, {})).status).toBe(404);
    });

    test("lists page at 25 within scope; search finds a request by number, never by its address; events carry no place", async () => {
      const mine = await as("other").get("/attendance/me/requests");
      expect(mine.body.page.size).toBe(25);
      for (const r of mine.body.data) expect(r.employee.display_name).toBe("Zainab Lawal");
      expect((await as("staff").get("/attendance/requests")).status).toBe(403);
      const team = await as("manager").get("/attendance/requests");
      const names = new Set(team.body.data.map((r) => r.employee.display_name));
      expect(names.has("Bisi Ade")).toBe(false);
      expect((await as("outsider").get("/attendance/requests")).status).toBe(403);

      const one = (await as("ops").get("/attendance/requests?request_type=temporary_home")).body.data[0];
      const byNumber = await as("ops").get(`/search?q=${one.number}`);
      expect((byNumber.body.groups || []).map((g) => g.type)).toContain("attendance_location_request");
      const byAddress = await as("ops").get("/search?q=crescent");
      expect((byAddress.body.groups || []).map((g) => g.type)).not.toContain("attendance_location_request");

      await drain();
      const logged = await q(
        `SELECT l.payload, a.before, a.after FROM event_log l LEFT JOIN audit_ledger a ON a.event_id = l.event_id
          WHERE l.event_key LIKE 'location_request.%'`,
        [],
      );
      expect(logged.rows.length).toBeGreaterThan(0);
      const text = JSON.stringify(logged.rows);
      for (const secret of ["Sample Crescent", "Example Road", "6.62", "3.52"]) expect(text).not.toContain(secret);
      const told = await q("SELECT count(*)::int AS n FROM notification WHERE user_id = $1 AND entity_type = 'attendance_location_request'", [people.manager.user.user_id]);
      expect(told.rows[0].n).toBeGreaterThan(0);
      const failed = await q("SELECT count(*)::int AS n FROM event_outbox WHERE status = 'failed'", []);
      expect(failed.rows[0].n).toBe(0);
    });
  });
  describe("field assignments made before PR 4", () => {
    const lagos = require("../../src/shared/time/lagos");
    const roster = require("../../src/modules/attendance/attendance.roster");
    const { legacyAssignment } = require("./helpers/legacy-places");
    const day = (n) => lagos.addDays(today(), n);
    const ALL = { scope: "all", scope_ids: null };
    // Two invented venues, far from the office and from each other.
    const HALL = { name: "Venue Hall", address: picked("12 Hidden Avenue", { lat: 6.731234, lon: 3.481234 }), latitude: 6.731234, longitude: 3.481234, radius_m: 200 };
    const YARD = { name: "Depot Yard", address: picked("3 Quiet Lane", { lat: 6.781234, lon: 3.481234 }), latitude: 6.781234, longitude: 3.481234, radius_m: 300 };
    const near = (venue, m) => ({ latitude: venue.latitude + m / 111_195, longitude: venue.longitude });
    const id = (who) => people[who].employee.employee_id;
    /** An assignment as a manager or People set it before PR 4, in force at once. */
    const send = async (who, body) => {
      const a = { name: "Venue Setup", client: "Northwind Events", starts_on: day(40), ends_on: day(41), sites: [HALL], ...body };
      const sites = a.sites.map((x) => ({ ...x, address: x.address ? contract.maps.PlaceInput.parse(x.address) : null }));
      const made = await tx(async (client) => legacyAssignment(client, await actorOf(who), { ...a, sites }));
      return (await as("ops").get(`/attendance/field-assignments/${made.field_assignment_id}`)).body;
    };

    test("no new assignment is set: the route is gone", async () => {
      const res = await as("manager").post("/attendance/field-assignments", { name: "Venue Setup", client: "Northwind Events", starts_on: day(40), ends_on: day(41), sites: [HALL], employee_ids: [id("staff")] });
      expect(res.status).toBe(404);
      expect(await q("SELECT count(*)::int AS n FROM attendance_field_assignment", []).then((r) => r.rows[0].n)).toBe(0);
    });

    test("one made by a manager for two of their team is read in scope, by the people on it, never by others", async () => {
      const made = await send("manager", { employee_ids: [id("staff"), id("other")], sites: [HALL, YARD], note: "Bring the banners" });
      expect(made).toMatchObject({ name: "Venue Setup", client: "Northwind Events", status: "active", state: "upcoming", days: 2, people: 2, assigned_by_name: "Kemi Alade", note: "Bring the banners" });
      expect(made.number).toMatch(/^FA-\d{4}$/);
      expect(made.sites.map((x) => [x.position, x.name, x.radius_m])).toEqual([[1, "Venue Hall", 200], [2, "Depot Yard", 300]]);
      const fid = made.field_assignment_id;
      const mine = await as("staff").get("/attendance/me/field-assignments");
      expect(mine.body.page.size).toBe(25);
      expect(mine.body.data.find((x) => x.field_assignment_id === fid)).toMatchObject({ can_change: false, state: "upcoming" });
      expect((await as("outsider").get(`/attendance/me/field-assignments/${fid}`)).status).toBe(404);
      expect((await as("staff").get("/attendance/field-assignments")).status).toBe(403);
      expect((await as("manager").get("/attendance/field-assignments")).body.data.map((x) => x.field_assignment_id)).toContain(fid);
      expect((await as("ops").get(`/attendance/field-assignments/${fid}`)).body).toMatchObject({ can_change: true, people: 2 });
    });

    test("on its days the assignment decides the place, after a temporary site: the nearer site judges, a remote person too, and the roster reads field", async () => {
      await setPolicy("block", "off");
      const [fa] = (await as("ops").get(`/attendance/field-assignments?employee_id=${id("staff")}`)).body.data;
      const inside = await punchAt("staff", `${day(40)}T07:00:00Z`, near(YARD, 100));
      expect(inside).toMatchObject({ validation_state: "accepted", distance_m: 100, worksite_name: "Depot Yard" });
      expect(inside.today.location).toMatchObject({ kind: "field", name: "Venue Hall or Depot Yard", radius_m: null });
      const ev = await q("SELECT worksite_id, validation->'geofence' AS g FROM attendance_event WHERE attendance_event_id = $1", [inside.attendance_event_id]);
      expect(ev.rows[0].worksite_id).toBeNull();
      expect(ev.rows[0].g).toMatchObject({ verdict: "inside", place: "field", assignment_id: fa.field_assignment_id, worksite_name: "Depot Yard" });

      const out = await punchAt("other", `${day(41)}T07:00:00Z`, near(HALL, 900));
      expect(out).toMatchObject({ validation_state: "rejected", reasons: ["outside_worksite"] });
      expect(out.message).toBe("Not counted: you were 900 m from Venue Hall.");

      const reg = await as("ops").get(`/attendance/register?date=${day(40)}&q=musa`);
      expect(reg.body.data[0]).toMatchObject({ expected_location: "Venue Hall or Depot Yard" });
      const row = (await roster.page(pool, { date: day(40), q: "Musa" }, ALL, {})).data[0];
      expect(row).toMatchObject({ status: "field", worksite: "Depot Yard" });
      const sum = await roster.summary(pool, { date: day(40) }, ALL);
      expect(sum.field).toBeGreaterThanOrEqual(1);
      expect(sum.present).toBe(sum.late + sum.on_site + sum.remote + sum.field);

      // A remote employee sent out is judged at the site, not at home.
      await send("ops", { employee_ids: [id("remote")], starts_on: day(45), ends_on: day(45) });
      const remote = await punchAt("remote", `${day(45)}T07:00:00Z`, near(HALL, 50));
      expect(remote).toMatchObject({ validation_state: "accepted", worksite_name: "Venue Hall" });
      expect((await roster.page(pool, { date: day(45), q: "Femi" }, ALL, {})).data[0]).toMatchObject({ status: "field" });
    });

    test("cancel and take off: within scope, with a reason, never the last; the days to come go back", async () => {
      await setPolicy("block", "off");
      const made = await send("ops", { name: "Stand Build", employee_ids: [id("staff"), id("other")], starts_on: day(50), ends_on: day(52) });
      const fid = made.field_assignment_id;
      const remoteOne = (await as("ops").get(`/attendance/field-assignments?employee_id=${id("remote")}`)).body.data[0];
      expect((await as("manager").post(`/attendance/field-assignments/${remoteOne.field_assignment_id}/cancel`, { reason: "No longer needed there" })).status).toBe(404);

      expect((await as("manager").post(`/attendance/field-assignments/${fid}/remove`, { employee_id: id("other"), reason: "short" })).status).toBe(422);
      const off = await as("manager").post(`/attendance/field-assignments/${fid}/remove`, { employee_id: id("other"), reason: "Needed at the office that week" });
      expect(off.status).toBe(200);
      expect(off.body.people).toBe(1);
      expect(off.body.members.find((m) => m.employee.display_name === "Zainab Lawal")).toMatchObject({ removed_reason: "Needed at the office that week" });
      const last = await as("manager").post(`/attendance/field-assignments/${fid}/remove`, { employee_id: id("staff"), reason: "Needed at the office that week" });
      expect([last.status, last.body.error.code]).toEqual([409, "ASSIGNMENT_LAST_PERSON"]);
      // Taken off: back to the office on its days.
      const back = await punchAt("other", `${day(50)}T07:00:00Z`);
      expect(back).toMatchObject({ validation_state: "accepted", worksite_name: "Testbed Office" });

      expect((await as("manager").post(`/attendance/field-assignments/${fid}/cancel`, { reason: "no" })).status).toBe(422);
      const cancelled = await as("manager").post(`/attendance/field-assignments/${fid}/cancel`, { reason: "The client moved the event" });
      expect(cancelled.body).toMatchObject({ status: "cancelled", state: "cancelled", cancel_reason: "The client moved the event", can_change: false });
      const again = await as("manager").post(`/attendance/field-assignments/${fid}/cancel`, { reason: "The client moved the event" });
      expect([again.status, again.body.error.code]).toEqual([409, "ASSIGNMENT_CANCELLED"]);
      expect((await punchAt("staff", `${day(51)}T07:00:00Z`)).worksite_name).toBe("Testbed Office");

      await drain();
      const told = await q(
        "SELECT event_key FROM notification WHERE user_id = $1 AND entity_id = $2 ORDER BY created_at",
        [people.other.user.user_id, fid],
      );
      expect(told.rows.map((r) => r.event_key)).toEqual(["field_assignment.member_removed"]);

      // Over: an assignment whose last day has passed cannot be changed.
      const old = await send("ops", { employee_ids: [id("outsider")], starts_on: day(60), ends_on: day(60) });
      await q("UPDATE attendance_field_assignment SET starts_on = $2, ends_on = $2 WHERE field_assignment_id = $1", [old.field_assignment_id, day(-2)]);
      const ended = await as("ops").post(`/attendance/field-assignments/${old.field_assignment_id}/cancel`, { reason: "The client moved the event" });
      expect([ended.status, ended.body.error.code]).toEqual([409, "ASSIGNMENT_ENDED"]);
      expect((await as("ops").get(`/attendance/field-assignments/${old.field_assignment_id}`)).body.state).toBe("done");
    });

    test("search finds an assignment by number, name or person within scope, never by a site; events carry no site", async () => {
      const first = (await as("ops").get("/attendance/field-assignments?q=Venue")).body.data[0];
      const byNumber = await as("ops").get(`/search?q=${first.number}`);
      expect((byNumber.body.groups || []).map((g) => g.type)).toContain("attendance_field_assignment");
      const byPerson = await as("manager").get("/search?q=zainab");
      const group = (byPerson.body.groups || []).find((g) => g.type === "attendance_field_assignment");
      expect(group && group.items.length).toBeGreaterThan(0);
      expect(new Set(group.items.map((i) => i.id)).size).toBe(group.items.length);
      const bySite = await as("ops").get("/search?q=hidden");
      expect((bySite.body.groups || []).map((g) => g.type)).not.toContain("attendance_field_assignment");

      await drain();
      const logged = await q(
        `SELECT l.payload, a.before, a.after FROM event_log l LEFT JOIN audit_ledger a ON a.event_id = l.event_id
          WHERE l.event_key LIKE 'field_assignment.%'`,
        [],
      );
      expect(logged.rows.length).toBeGreaterThan(0);
      const text = JSON.stringify(logged.rows);
      for (const secret of ["Hidden Avenue", "Quiet Lane", "6.731", "6.781", "3.481"]) expect(text).not.toContain(secret);
      const failed = await q("SELECT count(*)::int AS n FROM event_outbox WHERE status = 'failed'", []);
      expect(failed.rows[0].n).toBe(0);
    });
  });

  /* ---------------------------------------------------------------- *
   * Hybrid staff's weekly schedule (guide §6.13)
   * ---------------------------------------------------------------- */

  describe("hybrid staff's weekly schedule", () => {
    const lagos = require("../../src/shared/time/lagos");
    const roster = require("../../src/modules/attendance/attendance.roster");
    const day = (n) => lagos.addDays(today(), n);
    /** The first date from day(n) on that falls on ISO weekday `wd`. */
    const onWeekday = (n, wd) => {
      let d = day(n);
      while (lagos.weekday(d) !== wd) d = lagos.addDays(d, 1);
      return d;
    };
    const ALL = { scope: "all", scope_ids: null };
    const musa = () => people.staff.employee.employee_id;
    const set = (who, id, body) => as(who).post(`/attendance/schedules/${id}`, { reason: "Office on the team's days", ...body });
    const homeAt = (m) => ({ latitude: 6.62 + m / 111_195, longitude: 3.52 });

    beforeAll(async () => {
      await q("UPDATE employee SET work_pattern = 'hybrid' WHERE employee_id = $1", [musa()]);
    });
    afterAll(async () => {
      await q("UPDATE employee SET work_pattern = 'on_site' WHERE employee_id = $1", [musa()]);
    });

    test("read within scope; set under people edit, never your own, hybrid only, with its checks", async () => {
      const read = await as("manager").get(`/attendance/schedules/${musa()}`);
      expect(read.status).toBe(200);
      expect(read.body).toMatchObject({
        employee: { display_name: "Musa Danjuma" }, work_pattern: "hybrid", worksite: { name: "Testbed Office", radius_m: 100 },
        home_state: null, current: null, next: null, can_edit: false,
      });
      // No schedule yet: every working day is at the office.
      expect(new Set(read.body.week.filter((d) => d.place !== "off").map((d) => d.place))).toEqual(new Set(["office"]));
      expect(read.body.week.find((d) => d.weekday === 7).place).toBe("off");
      expect((await as("manager").get(`/attendance/schedules/${people.outsider.employee.employee_id}`)).status).toBe(404);
      expect((await as("outsider").get(`/attendance/schedules/${musa()}`)).status).toBe(403);
      expect((await as("ops").get(`/attendance/schedules/${musa()}`)).body.can_edit).toBe(true);

      expect((await set("manager", musa(), { office_days: [1, 2], effective_from: day(1) })).status).toBe(403);
      const no = async (who, id, body, status, code) => {
        const res = await set(who, id, body);
        expect([res.status, res.body.error && res.body.error.code]).toEqual([status, code]);
      };
      await no("ops", people.ops.employee.employee_id, { office_days: [1, 2], effective_from: day(1) }, 403, "OWN_RECORD");
      await no("ops", people.other.employee.employee_id, { office_days: [1, 2], effective_from: day(1) }, 422, "SCHEDULE_NOT_NEEDED");
      await no("ops", musa(), { office_days: [1, 2], effective_from: day(-1) }, 422, "SCHEDULE_IN_THE_PAST");
      await no("ops", musa(), { office_days: [1, 2], effective_from: day(95) }, 422, "SCHEDULE_TOO_FAR");
      await no("ops", musa(), { office_days: [1, 7], effective_from: day(1) }, 422, "SCHEDULE_DAY_NOT_WORKED");
      const working = read.body.week.filter((d) => d.place !== "off").map((d) => d.weekday);
      await no("ops", musa(), { office_days: working, effective_from: day(1) }, 422, "SCHEDULE_NO_HOME_DAY");
      expect((await set("ops", musa(), { office_days: [1, 1], effective_from: day(1) })).status).toBe(422);
      expect((await set("ops", musa(), { office_days: [1, 2], effective_from: day(1), reason: "short" })).status).toBe(422);
      expect((await q("SELECT count(*)::int AS n FROM attendance_schedule", [])).rows[0].n).toBe(0);
    });

    test("set from today, replaced from the same day, a later one waits; history, the notice, My Profile and the home", async () => {
      const first = await set("ops", musa(), { office_days: [4, 1, 2], effective_from: today() });
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({
        current: { office_days: [1, 2, 4], effective_from: today(), set_by_name: "Tunde Bakare" },
        next: null, home_state: "none", can_edit: true,
      });
      expect(first.body.week.find((d) => d.weekday === 3).place).toBe("remote");
      expect(first.body.week.find((d) => d.weekday === 1).place).toBe("office");

      const again = await set("ops", musa(), { office_days: [1, 2, 3], effective_from: today() });
      expect(again.body.current.office_days).toEqual([1, 2, 3]);
      expect((await q("SELECT count(*)::int AS n FROM attendance_schedule WHERE employee_id = $1", [musa()])).rows[0].n).toBe(1);

      const later = await set("ops", musa(), { office_days: [1, 2], effective_from: day(60) });
      expect(later.body).toMatchObject({ current: { office_days: [1, 2, 3] }, next: { office_days: [1, 2], effective_from: day(60) } });

      await drain();
      const history = await as("ops").get(`/employees/${musa()}/history`);
      expect(history.body.data.filter((h) => h.summary.startsWith("Work schedule set")).length).toBe(3);
      const told = await q("SELECT title, body FROM notification WHERE user_id = $1 AND event_key = 'attendance.schedule_set' ORDER BY created_at", [
        people.staff.user.user_id,
      ]);
      expect(told.rows.map((r) => r.title)).toEqual(["Work schedule set", "Work schedule set", "Work schedule set"]);
      expect(told.rows[1].body).toBe(`Office Mon, Tue, Wed from ${today().split("-").reverse().join("/")}.`);

      const profile = await as("staff").get("/ess/profile");
      const place = (wd) => profile.body.working_week.find((d) => d.weekday === wd).place;
      expect([place(1), place(3), place(4), place(7)]).toEqual(["office", "office", "remote", "off"]);
      expect((await as("staff").get("/attendance/me/home")).body.needed).toBe(true);
      expect((await as("other").get("/attendance/me/home")).body.needed).toBe(false);
    });

    test("on the clock: an office day at the worksite, a home day at the approved home, no home is reviewed", async () => {
      await setPolicy("block", "off");
      const monday = onWeekday(61, 1);
      const thursday = onWeekday(61, 4);
      const friday = onWeekday(61, 5);
      const wednesday = onWeekday(68, 3);

      const office = await punchAt("staff", `${monday}T07:00:00Z`, { ...north(20) });
      expect(office).toMatchObject({ validation_state: "accepted", worksite_name: "Testbed Office" });
      expect(office.today.location).toMatchObject({ kind: "worksite", name: "Testbed Office", home_state: null });

      const noHome = await punchAt("staff", `${thursday}T07:00:00Z`, homeAt(0));
      expect(noHome).toMatchObject({ validation_state: "review", reasons: ["location_unverified"] });
      expect(noHome.message).toBe("Clocked in at 08:00. People will review it: you have no approved home location yet.");
      expect(noHome.today.location).toEqual({ kind: "remote", name: null, radius_m: null, home_state: "none" });

      const homeSent = await as("staff").post("/attendance/me/home", {
        home_address: picked("3 Example Close, Yaba"), home_latitude: homeAt(0).latitude, home_longitude: homeAt(0).longitude, accuracy_m: 12,
      });
      expect(homeSent.status).toBe(201);
      const decided = await as("ops").post(`/attendance/homes/${homeSent.body.pending.attendance_home_id}/decision`, { decision: "approve" });
      expect(decided.status).toBe(200);

      const inside = await punchAt("staff", `${friday}T07:00:00Z`, homeAt(60));
      expect(inside).toMatchObject({ validation_state: "accepted", worksite_name: "Home", distance_m: 60 });
      expect(inside.today.location).toMatchObject({ kind: "home", radius_m: 100, home_state: "approved" });
      const ev = await q("SELECT worksite_id, validation->'geofence' AS g FROM attendance_event WHERE attendance_event_id = $1", [inside.attendance_event_id]);
      expect(ev.rows[0].worksite_id).toBeNull();
      expect(ev.rows[0].g).toMatchObject({ verdict: "inside", place: "home" });

      // The schedule from day(60) leaves Wednesday for home too.
      const away = await punchAt("staff", `${wednesday}T07:00:00Z`, { ...north(20) });
      expect(away).toMatchObject({ validation_state: "rejected", reasons: ["outside_home"] });
    });

    test("Home's roster and the register read a present home day as remote, an office day as on site", async () => {
      const monday = onWeekday(61, 1);
      const friday = onWeekday(61, 5);
      const row = async (date) =>
        (await roster.page(pool, { date, q: "Musa" }, ALL, { page: 1 })).data.find((r) => r.employee_id === musa());
      expect(await row(friday)).toMatchObject({ status: "remote", worksite: null });
      expect(await row(monday)).toMatchObject({ status: "on_site", worksite: "Testbed Office" });
      expect(await roster.summary(pool, { date: friday }, ALL)).toMatchObject({ remote: 1 });

      const reg = await as("ops").get(`/attendance/register?date=${friday}&q=Musa`);
      expect(reg.body.data[0]).toMatchObject({ expected_location: "Home", work_pattern: "hybrid", status: "present" });
      const office = await as("ops").get(`/attendance/register?date=${monday}&q=Musa`);
      expect(office.body.data[0]).toMatchObject({ expected_location: "Testbed Office" });
      const detail = await as("ops").get(`/attendance/register/${musa()}?date=${friday}`);
      expect(detail.body.expected_location).toEqual({ name: "Home", radius_m: 100 });
    });
  });
});
