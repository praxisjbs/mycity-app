"use strict";
/**
 * Temporary sites and check-ins end to end (docs/guides/attendance.md §6.11, §6.12, PR 4): the real
 * migrations on a throwaway database, the whole app through HTTP, every response parsed with its
 * contract (APP_ENV=test). Add Work Site and its approval (nobody on a site decides it), People's
 * own, withdraw, cancel and take off, one site a person a day under the person's lock, the site
 * first on the clock and its time zone, flags a late approval covers, a Temporary Home's mask, and
 * check-ins at each stop: matched, flagged, limited, never the shift, decided as a punch's are.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/attendance-sites
 *
 * Every person, site and coordinate here is invented. The office is a fictional point at
 * 6.500000, 3.400000 with a 100 m fence; the partner's hall and annex are 11 and 13 km north of it.
 * Days are counted from today in Lagos; the punches whose date and time matter are made through
 * the service at the instant given.
 */
const crypto = require("node:crypto");
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { attendanceVersion } = require("./helpers/policies");
const { legacyAssignment } = require("./helpers/legacy-places");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const token = require("../../src/shared/places/token");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const aiRegistry = require("../../src/shared/ai/registry");
const lagos = require("../../src/shared/time/lagos");
const service = require("../../src/modules/attendance/attendance.service");
const checkIns = require("../../src/modules/attendance/attendance.check-ins");
const roster = require("../../src/modules/attendance/attendance.roster");
const realtime = require("../../src/services/realtime/emitter");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const PASSWORD = "Field-Days9Test";
const key = () => crypto.randomUUID();
const ALL = { scope: "all", scope_ids: null };

/** Points: the office, and the partner's hall and annex; `at(p, m)` is m metres north of p. */
const OFFICE = { lat: 6.5, lon: 3.4 };
const HALL = { lat: 6.6, lon: 3.4 };
const ANNEX = { lat: 6.62, lon: 3.4 };
const HOME = { lat: 6.44, lon: 3.47 };
const GABORONE = { lat: -24.6545, lon: 25.9086 };
const at = (p, m = 0) => ({ latitude: p.lat + m / 111_195, longitude: p.lon });

/** An address as the search signs it: a pick at a point, with the provider's zone when it named one. */
const pick = (formatted, p, { timezone } = {}) => ({
  token: token.sign({
    source: "search",
    formatted,
    lat: p.lat,
    lon: p.lon,
    provider_id: `test-${formatted.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    kind: "building",
    city: "Lagos",
    country_code: "ng",
    timezone: timezone || null,
    verified: true,
    pending: false,
  }),
});

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

describeDb("temporary sites and check-ins against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  let ip = 0;

  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
    post: (path, body = {}, headers = {}) => {
      const r = request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`);
      for (const [k, v] of Object.entries(headers)) r.set(k, v);
      return r.send(body);
    },
  });
  const id = (who) => people[who].employee.employee_id;
  const today = () => lagos.today();
  const day = (n) => lagos.addDays(today(), n);
  /** The first weekday (Monday to Friday) from day(n) on. */
  const weekday = (n) => {
    let d = day(n);
    while (lagos.weekday(d) > 5) d = lagos.addDays(d, 1);
    return d;
  };

  async function actorOf(who) {
    const u = await grantsCache.getAuthUser(pool, people[who].user.user_id);
    const s = await q("SELECT session_id FROM user_session WHERE user_id = $1 ORDER BY issued_at DESC LIMIT 1", [u.user_id]);
    return { ...u, session_id: s.rows[0].session_id };
  }

  /** A punch through the service at an instant, from a point. */
  const punchAt = async (who, iso, point, body = {}) =>
    service.punch(
      await actorOf(who),
      { event_type: "clock_in", device_at: iso, ...point, accuracy_m: 15, ...body },
      { idempotencyKey: key(), now: new Date(iso) },
    );
  /** A check-in through the service at an instant, from a point. */
  const checkInAt = async (who, iso, point, { idem = key(), accuracy = 15, ...body } = {}) =>
    checkIns.checkIn(
      await actorOf(who),
      { device_at: iso, ...point, accuracy_m: accuracy, ...body },
      { idempotencyKey: idem, now: new Date(iso) },
    );

  const setRules = (changes) => attendanceVersion(pool, { home_radius_m: 150, ...changes }, "2026-01-01");
  const setPolicy = (mode) =>
    setRules({ office_geofence_mode: mode, home_geofence_mode: mode, site_geofence_mode: mode, device_mode: "off" });

  /** A site's body as the Add Work Site sheet sends it. */
  const body = (over = {}) => ({
    purpose: "training_attending",
    name: "Partner Training Week",
    description: "Two days of partner training at their office; the out-of-station letter is on file.",
    starts_on: day(2),
    ends_on: day(3),
    locations: [
      { address: pick("Partner Hall, 1 Sample Road", HALL), name: "Hall", radius_m: 150 },
      { address: pick("Partner Annex, 9 Sample Road", ANNEX), name: "Annex", radius_m: 200 },
    ],
    employee_ids: [id("staff"), id("other")],
    ...over,
  });
  const approve = (who, wid) => as(who).post(`/workflow/instances/${wid}/approve`, {});
  const told = async (who, keyLike) =>
    (await q("SELECT event_key, title, body FROM notification WHERE user_id = $1 AND event_key LIKE $2 ORDER BY created_at", [people[who].user.user_id, keyLike])).rows;

  async function signIn(who) {
    ip += 1;
    const res = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", `10.72.0.${ip}`).send({ email: `${who}@mycity.test`, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body.access_token;
  }

  beforeAll(async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    await rebuild(pool, config.DB_NAME);
    await setPolicy("warn");
    outbox.markReady();
    aiRegistry.load();
    ({ app } = buildApp({ strict: true, accessLog: false }));

    const make = (who, first, last, role, department = "Programmes") =>
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
              department_name: department,
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
    await make("ops", "Tunde", "Bakare", "operations_people", "Operations");
    await make("ops2", "Ngozi", "Eze", "operations_people", "Operations");
    await make("manager", "Kemi", "Alade", "manager");
    await make("staff", "Musa", "Danjuma", "employee");
    await make("other", "Zainab", "Lawal", "employee");
    await make("outsider", "Bisi", "Ade", "employee", "Finance");
    await make("remote", "Femi", "Oke", "employee");
    await make("leaver", "Lola", "Ayo", "employee");
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = ANY($2::uuid[])", [id("manager"), [id("staff"), id("other"), id("remote")]]);
    await q("UPDATE employee SET work_pattern = 'remote' WHERE employee_id = $1", [id("remote")]);
    await q("UPDATE employee SET status = 'left', left_on = $2 WHERE employee_id = $1", [id("leaver"), day(-1)]);
    const w = await q(
      `INSERT INTO worksite (code, name, address, latitude, longitude, radius_m, timezone)
       VALUES ('SITES-OFFICE', 'Sites Office', '{"text":"1 Invented Street"}'::jsonb, $1, $2, 100, 'Africa/Lagos') RETURNING worksite_id`,
      [OFFICE.lat, OFFICE.lon],
    );
    await q("UPDATE employee SET worksite_id = $1 WHERE employee_id = ANY($2::uuid[])", [
      w.rows[0].worksite_id,
      ["ops", "ops2", "manager", "staff", "other", "outsider"].map(id),
    ]);
    await grantsCache.bumpTeamVersion();
    await drain();
    for (const who of Object.keys(people)) if (who !== "leaver") tokens[who] = await signIn(who);
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("Add Work Site checks the dates, the addresses and the people; People's own never puts them on it", async () => {
    const no = async (who, path, over, status, code) => {
      const res = await as(who).post(path, body(over));
      expect([res.status, res.body.error && res.body.error.code]).toEqual([status, code]);
      return res;
    };
    await no("staff", "/attendance/me/temporary-sites", { starts_on: day(-1), ends_on: day(0) }, 422, "SITE_IN_THE_PAST");
    await no("staff", "/attendance/me/temporary-sites", { starts_on: day(95), ends_on: day(95) }, 422, "SITE_TOO_FAR");
    await no("staff", "/attendance/me/temporary-sites", { starts_on: day(2), ends_on: day(92) }, 422, "VALIDATION_FAILED");
    await no("staff", "/attendance/me/temporary-sites", { employee_ids: [id("staff"), id("leaver")] }, 422, "NOT_EMPLOYED");
    const narrow = await no("staff", "/attendance/me/temporary-sites", { locations: [{ address: pick("Partner Hall", HALL), radius_m: 100 }] }, 422, "VALIDATION_FAILED");
    expect(Object.keys(narrow.body.error.fields)).toEqual(["locations.0.radius_m"]);
    const home = await no("staff", "/attendance/me/temporary-sites", { purpose: "temporary_home" }, 422, "VALIDATION_FAILED");
    expect(Object.keys(home.body.error.fields)).toEqual(["locations"]);
    await no("staff", "/attendance/me/temporary-sites", { locations: [{ address: { token: "p1.not.real-token-at-all" }, radius_m: 150 }] }, 422, "VALIDATION_FAILED");
    await no("staff", "/attendance/me/temporary-sites", { description: "Too short to approve" }, 422, "VALIDATION_FAILED");
    await no("staff", "/attendance/temporary-sites", {}, 403, "PERMISSION_DENIED");
    await no("ops", "/attendance/temporary-sites", { employee_ids: [id("ops"), id("staff")] }, 403, "OWN_RECORD");
    expect(await q("SELECT count(*)::int AS n FROM attendance_temporary_site", []).then((r) => r.rows[0].n)).toBe(0);
  });

  let site;

  test("a site sent from Home is numbered and waits on Operations & People; nobody on it decides it, and everyone on it is told", async () => {
    const res = await as("staff").post("/attendance/me/temporary-sites", body({ employee_ids: [id("staff"), id("other"), id("ops2")] }));
    expect(res.status).toBe(201);
    site = res.body;
    expect(site).toMatchObject({ status: "submitted", state: "submitted", days: 2, people: 3, can_withdraw: true, submitted_by_name: "Musa Danjuma" });
    expect(site.number).toMatch(/^TS-\d{4}$/);
    expect(site.locations.map((l) => [l.position, l.name, l.radius_m, l.timezone])).toEqual([[1, "Hall", 150, "Africa/Lagos"], [2, "Annex", 200, "Africa/Lagos"]]);
    expect(site.locations[0]).toMatchObject({ address: "Partner Hall, 1 Sample Road", home_address: null });
    const instance = await q("SELECT state, excluded_employee_ids::text[] AS ex FROM workflow_instance WHERE workflow_instance_id = $1", [site.workflow_instance_id]);
    expect(instance.rows[0].state).toBe("pending");
    expect(instance.rows[0].ex.sort()).toEqual([id("ops2"), id("other"), id("staff")].sort());

    // Ngozi holds Operations & People but is on it: not offered, and refused by the engine.
    expect((await as("ops2").get(`/attendance/temporary-sites/${site.temporary_site_id}`)).body.can_decide).toBe(false);
    expect((await as("ops").get(`/attendance/temporary-sites/${site.temporary_site_id}`)).body).toMatchObject({ can_decide: true, waiting_on: "Operations & People" });
    expect((await approve("ops2", site.workflow_instance_id)).status).toBe(403);
    expect((await approve("staff", site.workflow_instance_id)).status).toBeGreaterThanOrEqual(403);
    const waitingOnNgozi = await as("ops2").get("/workflow/mine");
    expect((waitingOnNgozi.body.data || []).map((i) => i.entity_id)).not.toContain(site.temporary_site_id);

    await drain();
    expect((await told("other", "temporary_site.%")).map((r) => r.title)).toEqual(["Put on a Temporary Site"]);
    expect(await told("staff", "temporary_site.%")).toEqual([]);
    const asked = await told("ops", "workflow.%");
    expect(asked.map((r) => r.event_key)).toContain("workflow.opened");
    expect(await told("ops2", "workflow.%")).toEqual([]);

    expect((await approve("ops", site.workflow_instance_id)).status).toBe(200);
    await drain();
    const mine = await as("other").get(`/attendance/me/temporary-sites/${site.temporary_site_id}`);
    expect(mine.body).toMatchObject({ status: "approved", state: "upcoming", approved_by_name: "Tunde Bakare", can_withdraw: false });
    expect((await told("other", "temporary_site.%")).map((r) => r.title)).toEqual(["Put on a Temporary Site", "Temporary Site Approved"]);
    // The submitter hears of the decision from the approval, once.
    expect(await told("staff", "temporary_site.%")).toEqual([]);
    expect((await told("staff", "workflow.completed")).length).toBe(1);
    expect((await as("outsider").get(`/attendance/me/temporary-sites/${site.temporary_site_id}`)).status).toBe(404);
  });

  test("on its days the site decides the place before a field assignment: the nearest address judges, named on the punch, the register and the roster", async () => {
    await setPolicy("warn");
    await tx(async (client) =>
      legacyAssignment(client, await actorOf("ops"), {
        name: "Old Crew", client: "Northwind", starts_on: day(2), ends_on: day(2), employee_ids: [id("staff")],
        sites: [{ name: "Old Yard", latitude: 6.9, longitude: 3.4, radius_m: 200 }],
      }),
    );
    const inside = await punchAt("staff", `${day(2)}T07:00:00Z`, at(HALL, 40));
    expect(inside).toMatchObject({ validation_state: "accepted", reasons: [], distance_m: 40, worksite_name: "Partner Training Week, Hall" });
    expect(inside.today.location).toMatchObject({ kind: "temporary_site", name: "Partner Training Week", radius_m: null });
    expect(inside.today.temporary_site).toMatchObject({ number: site.number, name: "Partner Training Week" });
    expect(inside.today.temporary_site.locations.map((l) => [l.name, l.radius_m])).toEqual([["Hall", 150], ["Annex", 200]]);
    const ev = await q("SELECT worksite_id, validation->'geofence' AS g FROM attendance_event WHERE attendance_event_id = $1", [inside.attendance_event_id]);
    expect(ev.rows[0].worksite_id).toBeNull();
    expect(ev.rows[0].g).toMatchObject({
      verdict: "inside", place: "temporary_site", temporary_site_id: site.temporary_site_id,
      site_id: site.locations[0].temporary_site_location_id, worksite_name: "Partner Training Week, Hall",
    });
    const outside = await punchAt("other", `${day(2)}T07:00:00Z`, at(ANNEX, 900));
    expect(outside).toMatchObject({ validation_state: "review", reasons: ["outside_worksite"] });
    expect(outside.message).toContain("from Partner Training Week, Annex");

    const reg = await as("ops").get(`/attendance/register?date=${day(2)}&q=musa`);
    expect(reg.body.data[0]).toMatchObject({ expected_location: "Partner Training Week" });
    const events = await as("ops").get(`/attendance/events?employee_id=${id("staff")}&date=${day(2)}`);
    expect(events.body.data[0].worksite_name).toBe("Partner Training Week, Hall");
    const row = (await roster.page(pool, { date: day(2), q: "Musa" }, ALL, {})).data[0];
    expect(row).toMatchObject({ status: "field", worksite: "Partner Training Week, Hall" });
    const day4 = await punchAt("staff", `${day(4)}T07:00:00Z`, at(OFFICE, 20));
    expect(day4).toMatchObject({ validation_state: "accepted", worksite_name: "Sites Office" });
  });

  test("check-ins: matched to the nearest address, flagged outside, a repeat answered with the first, 20 a day, never the shift", async () => {
    await setPolicy("block");
    const actorDay = day(3);
    await punchAt("staff", `${actorDay}T07:00:00Z`, at(HALL, 10));
    const dayBefore = await q("SELECT * FROM attendance_day WHERE employee_id = $1 AND attendance_date = $2", [id("staff"), actorDay]);
    const punches = () => q("SELECT count(*)::int AS n FROM attendance_event WHERE employee_id = $1", [id("staff")]).then((r) => r.rows[0].n);
    const before = await punches();

    const annex = await checkInAt("staff", `${actorDay}T08:00:00Z`, at(ANNEX, 50));
    expect(annex.check_in).toMatchObject({ verdict: "inside", flagged: false, location_name: "Annex", position: 2, address: "Partner Annex, 9 Sample Road", distance_m: 50 });
    expect(annex.message).toBe("Checked in at Annex.");
    // Under Refuse a stop outside is recorded and flagged, never refused.
    const away = await checkInAt("staff", `${actorDay}T08:30:00Z`, at(ANNEX, 3000));
    expect(away.check_in).toMatchObject({ verdict: "outside", flagged: true, location_name: "Annex" });
    expect(away.message).toBe("Checked in 3000 m from Annex. People will review it.");
    const farther = await checkInAt("staff", `${actorDay}T08:40:00Z`, at(ANNEX, 4000));
    expect(farther.check_in.flagged).toBe(true);
    const rough = await checkInAt("staff", `${actorDay}T08:50:00Z`, { latitude: null, longitude: null }, { accuracy: null, location_error: "denied" });
    expect(rough.check_in).toMatchObject({ verdict: "unverified", flagged: true, location_reason: "denied" });
    const flags = await q(
      `SELECT x.exception_type, x.attendance_event_id, x.attendance_check_in_id FROM attendance_exception x
        WHERE x.attendance_check_in_id IS NOT NULL ORDER BY x.created_at`,
      [],
    );
    expect(flags.rows.map((r) => r.exception_type)).toEqual(["outside_worksite", "outside_worksite", "location_unverified"]);
    expect(flags.rows.every((r) => r.attendance_event_id === null)).toBe(true);

    // The same key, and the same stop within 5 minutes, answer with the first; nothing new is recorded.
    const idem = key();
    const first = await checkInAt("staff", `${actorDay}T09:00:00Z`, at(HALL, 5), { idem });
    const replay = await checkInAt("staff", `${actorDay}T09:00:30Z`, at(HALL, 5), { idem });
    expect(replay).toMatchObject({ replayed: true, check_in: { attendance_check_in_id: first.check_in.attendance_check_in_id } });
    const soon = await checkInAt("staff", `${actorDay}T09:04:00Z`, at(HALL, 20));
    expect(soon).toMatchObject({ replayed: true, check_in: { attendance_check_in_id: first.check_in.attendance_check_in_id } });
    for (let i = 0; i < 15; i += 1) await checkInAt("staff", `${actorDay}T${String(10 + Math.floor(i / 6)).padStart(2, "0")}:${String((i % 6) * 10).padStart(2, "0")}:00Z`, at(i % 2 ? HALL : ANNEX));
    await expect(checkInAt("staff", `${actorDay}T13:00:00Z`, at(HALL))).rejects.toMatchObject({ code: "CHECK_IN_LIMIT", status: 422 });
    expect(await q("SELECT count(*)::int AS n FROM attendance_check_in WHERE employee_id = $1 AND work_date = $2", [id("staff"), actorDay]).then((r) => r.rows[0].n)).toBe(20);

    // Never the shift: no punch, the day as it was.
    expect(await punches()).toBe(before);
    const dayAfter = await q("SELECT * FROM attendance_day WHERE employee_id = $1 AND attendance_date = $2", [id("staff"), actorDay]);
    expect(dayAfter.rows[0]).toMatchObject({
      first_clock_in_at: dayBefore.rows[0].first_clock_in_at, last_clock_out_at: null,
      worked_minutes: dayBefore.rows[0].worked_minutes, status: dayBefore.rows[0].status,
    });

    // The day's route, in time order, for People and for the person; no coordinates anywhere.
    const route = await as("ops").get(`/attendance/check-ins?employee_id=${id("staff")}&date=${actorDay}`);
    expect(route.body.page).toMatchObject({ size: 25, total: 20 });
    expect(route.body.data[0]).toMatchObject({ location_name: "Annex", verdict: "inside" });
    expect(JSON.stringify(route.body)).not.toMatch(/latitude|longitude/);
    const own = await as("staff").get(`/attendance/me/check-ins?date=${actorDay}`);
    expect(own.body.data.map((c) => c.occurred_at)).toEqual(route.body.data.map((c) => c.occurred_at));
    expect((await as("manager").get(`/attendance/check-ins?employee_id=${id("staff")}&date=${actorDay}`)).status).toBe(200);
    expect((await as("manager").get(`/attendance/check-ins?employee_id=${id("outsider")}&date=${actorDay}`)).status).toBe(404);
    expect((await as("staff").get(`/attendance/check-ins?employee_id=${id("staff")}&date=${actorDay}`)).status).toBe(403);
  });

  test("a check-in's flag is decided on the exception's route: accept clears it, reject keeps it, a clock-out time is refused; the day is never touched", async () => {
    const flags = await q(
      "SELECT attendance_exception_id FROM attendance_exception WHERE attendance_check_in_id IS NOT NULL AND status = 'open' ORDER BY created_at",
      [],
    );
    const [a, b, c] = flags.rows.map((r) => r.attendance_exception_id);
    const listed = await as("ops").get(`/attendance/exceptions?employee_id=${id("staff")}&status=open`);
    expect(listed.body.data.find((x) => x.attendance_exception_id === a)).toMatchObject({ attendance_event_id: null, detail: expect.stringMatching(/^Check-in: /) });
    const decide = (x, decision, extra = {}) =>
      as("ops").post(`/attendance/exceptions/${x}/decision`, { decision, resolution: "Checked with the partner's front desk", ...extra });
    const day0 = await q("SELECT updated_at FROM attendance_day WHERE employee_id = $1 AND attendance_date = $2", [id("staff"), day(3)]);
    expect((await decide(a, "add_clock_out", { clock_out_time: "17:00" })).body.error.code).toBe("DECISION_INVALID");
    expect((await decide(a, "accept")).body).toMatchObject({ status: "resolved", outcome: "accepted" });
    expect((await decide(b, "reject")).body).toMatchObject({ status: "resolved", outcome: "rejected" });
    expect((await decide(c, "accept")).status).toBe(200);
    const day1 = await q("SELECT updated_at FROM attendance_day WHERE employee_id = $1 AND attendance_date = $2", [id("staff"), day(3)]);
    expect(day1.rows[0].updated_at).toEqual(day0.rows[0].updated_at);
    await drain();
    const heard = (await told("staff", "attendance.exception_decided")).map((r) => r.body);
    expect(heard).toEqual(expect.arrayContaining([expect.stringContaining("the check-in's flag is cleared"), expect.stringContaining("the check-in's flag stands")]));
  });

  test("a check-in is refused only when it is not one: no key, no site that day, no shift open", async () => {
    const send = (who, headers = { "Idempotency-Key": key() }) =>
      as(who).post("/attendance/check-ins", { device_at: new Date().toISOString(), ...at(HALL), accuracy_m: 10 }, headers);
    expect((await send("outsider", {})).status).toBe(428);
    const none = await send("outsider");
    expect([none.status, none.body.error.code]).toEqual([422, "NO_TEMPORARY_SITE"]);
    // Today's site, added by People for Zainab; she has not clocked in.
    const added = await as("ops").post("/attendance/temporary-sites", body({ name: "Site Survey Today", purpose: "site_inspection", starts_on: day(0), ends_on: day(0), employee_ids: [id("other")] }));
    expect(added.status).toBe(201);
    const out = await send("other");
    expect([out.status, out.body.error.code]).toEqual([409, "NOT_CLOCKED_IN"]);
    const clockIn = await as("other").post("/attendance/punches", { event_type: "clock_in", device_at: new Date().toISOString(), ...at(HALL, 10), accuracy_m: 10 }, { "Idempotency-Key": key() });
    expect([clockIn.status, clockIn.body.validation_state]).toEqual([201, "accepted"]);
    const done = await send("other");
    expect(done.status).toBe(201);
    expect(done.body.today.check_ins.map((c) => c.attendance_check_in_id)).toEqual([done.body.check_in.attendance_check_in_id]);
    expect((await as("other").get("/attendance/me/today")).body.check_ins).toHaveLength(1);
  });

  test("one site a person a day: refused naming the person and the other site, and two sent at once take the day once", async () => {
    const clash = await as("staff").post("/attendance/me/temporary-sites", body({ starts_on: day(3), ends_on: day(5), employee_ids: [id("other")] }));
    expect([clash.status, clash.body.error.code]).toEqual([409, "SITE_OVERLAPS"]);
    expect(clash.body.error.message).toBe(`Zainab Lawal is already on ${site.number}`);
    const both = await Promise.all([
      as("remote").post("/attendance/me/temporary-sites", body({ name: "Coworking Week", purpose: "coworking_space", starts_on: day(30), ends_on: day(31), employee_ids: [id("remote")] })),
      as("remote").post("/attendance/me/temporary-sites", body({ name: "Coworking Again", purpose: "coworking_space", starts_on: day(31), ends_on: day(32), employee_ids: [id("remote")] })),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(both.find((r) => r.status === 409).body.error.code).toBe("SITE_OVERLAPS");
  });

  test("approved after its first day, a site clears the location flags it covers; one outside its addresses stays", async () => {
    await setPolicy("warn");
    const sent = await as("staff").post("/attendance/me/temporary-sites", body({ name: "Expo Stand", purpose: "exhibition", starts_on: day(6), ends_on: day(7), employee_ids: [id("staff")] }));
    expect(sent.status).toBe(201);
    // Waiting on its first day: the office still judges, and the hall is outside it.
    const atHall = await punchAt("staff", `${day(6)}T07:00:00Z`, at(HALL, 30));
    expect(atHall).toMatchObject({ validation_state: "review", reasons: ["outside_worksite"], worksite_name: "Sites Office" });
    const elsewhere = await punchAt("staff", `${day(7)}T07:00:00Z`, at(OFFICE, 5000));
    expect(elsewhere.reasons).toEqual(["outside_worksite"]);
    expect((await approve("ops", sent.body.workflow_instance_id)).status).toBe(200);
    await drain();
    const x = await q(
      `SELECT ad.attendance_date::text AS d, x.status, x.outcome, x.resolution FROM attendance_exception x
         JOIN attendance_day ad ON ad.attendance_day_id = x.attendance_day_id
        WHERE ad.employee_id = $1 AND ad.attendance_date IN ($2, $3) ORDER BY ad.attendance_date`,
      [id("staff"), day(6), day(7)],
    );
    expect(x.rows).toEqual([
      { d: day(6), status: "resolved", outcome: "accepted", resolution: `Covered by ${sent.body.number}` },
      { d: day(7), status: "open", outcome: null, resolution: null },
    ]);
    // The punch kept its judgement.
    const kept = await q("SELECT validation_state FROM attendance_event WHERE attendance_event_id = $1", [atHall.attendance_event_id]);
    expect(kept.rows[0].validation_state).toBe("review");
  });

  test("a Temporary Home: one address, judged as a home, read remote on the roster, its line and point only for its people and scope all", async () => {
    await setPolicy("block");
    const res = await as("ops").post("/attendance/temporary-sites", body({
      purpose: "temporary_home", name: "Ibadan stay", starts_on: day(8), ends_on: day(9), employee_ids: [id("remote")],
      locations: [{ address: pick("12 Hidden Close, Ibadan", HOME), radius_m: 200 }],
    }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "approved", approved_by_name: "Tunde Bakare" });
    expect(res.body.locations[0]).toMatchObject({ address: null, latitude: null, home_address: "12 Hidden Close, Ibadan", radius_m: 200 });
    const sid = res.body.temporary_site_id;
    const team = await as("manager").get(`/attendance/temporary-sites/${sid}`);
    expect(team.body.locations[0]).toMatchObject({ address: null, latitude: null, home_address: null, home_latitude: null });
    const own = await as("remote").get(`/attendance/me/temporary-sites/${sid}`);
    expect(own.body.locations[0].home_latitude).toBeCloseTo(HOME.lat, 5);

    const inside = await punchAt("remote", `${day(8)}T07:00:00Z`, at(HOME, 120));
    expect(inside).toMatchObject({ validation_state: "accepted", worksite_name: "Temporary Home" });
    expect(inside.today.location).toMatchObject({ kind: "temporary_home", name: "Temporary Home", radius_m: 200 });
    const out = await punchAt("remote", `${day(9)}T07:00:00Z`, at(HOME, 900));
    expect(out).toMatchObject({ validation_state: "rejected", reasons: ["outside_home"] });
    expect(out.message).toBe("Not counted: you were 900 m from your temporary home.");
    expect((await roster.page(pool, { date: day(8), q: "Femi" }, ALL, {})).data[0]).toMatchObject({ status: "remote", worksite: null });
    const reg = await as("ops").get(`/attendance/register?date=${day(8)}&q=femi`);
    expect(reg.body.data[0].expected_location).toBe("Temporary Home");
  });

  test("a site abroad: the work date and the wall clock are read in its zone", async () => {
    const first = weekday(12);
    const res = await as("ops").post("/attendance/temporary-sites", body({
      purpose: "partner_meeting", name: "Gaborone Partner Days", starts_on: first, ends_on: lagos.addDays(first, 1), employee_ids: [id("other")],
      locations: [{ address: pick("Plot 50, Main Mall, Gaborone", GABORONE, { timezone: "Africa/Gaborone" }), radius_m: 300 }],
    }));
    expect(res.status).toBe(201);
    expect(res.body.locations[0].timezone).toBe("Africa/Gaborone");
    // 07:30 UTC is 08:30 in Lagos and 09:30 in Gaborone: 30 minutes past the 09:00 start there.
    const late = await punchAt("other", `${first}T07:30:00Z`, at(GABORONE, 20));
    expect(late).toMatchObject({ validation_state: "accepted", work_date: first, worksite_name: "Gaborone Partner Days" });
    expect(late.today.timezone).toBe("Africa/Gaborone");
    const dayRow = await q("SELECT late_minutes FROM attendance_day WHERE employee_id = $1 AND attendance_date = $2", [id("other"), first]);
    expect(dayRow.rows[0].late_minutes).toBe(30);
    // 22:30 UTC on the first day is already the second day in Gaborone, and that is the work date.
    await q("UPDATE attendance_day SET closed_at = now() WHERE employee_id = $1 AND attendance_date = $2", [id("other"), first]);
    const night = await punchAt("other", `${first}T22:30:00Z`, at(GABORONE, 20));
    expect(night.work_date).toBe(lagos.addDays(first, 1));
  });

  test("withdrawn by its submitter while it waits, with the approval; anyone else's is not theirs to withdraw", async () => {
    const res = await as("staff").post("/attendance/me/temporary-sites", body({ name: "Workshop Days", purpose: "workshop", starts_on: day(25), ends_on: day(26) }));
    const sid = res.body.temporary_site_id;
    expect((await as("other").post(`/attendance/me/temporary-sites/${sid}/withdraw`, { reason: "Not going after all" })).status).toBe(404);
    expect((await as("staff").post(`/attendance/me/temporary-sites/${sid}/withdraw`, { reason: "short" })).status).toBe(422);
    const out = await as("staff").post(`/attendance/me/temporary-sites/${sid}/withdraw`, { reason: "The workshop moved online" });
    expect(out.body).toMatchObject({ status: "withdrawn", state: "withdrawn", cancel_reason: "The workshop moved online", can_withdraw: false });
    const instance = await q("SELECT state FROM workflow_instance WHERE workflow_instance_id = $1", [res.body.workflow_instance_id]);
    expect(instance.rows[0].state).toBe("cancelled");
    const again = await as("staff").post(`/attendance/me/temporary-sites/${sid}/withdraw`, { reason: "The workshop moved online" });
    expect([again.status, again.body.error.code]).toEqual([409, "SITE_NOT_WAITING"]);
    await drain();
    expect((await told("other", "temporary_site.withdrawn")).map((r) => r.title)).toEqual(["Temporary Site Withdrawn"]);
  });

  test("People cancel one or take someone off with a reason, until its last day, never on a site they are on; the days to come go back", async () => {
    await setPolicy("warn");
    const res = await as("ops").post("/attendance/temporary-sites", body({ name: "Market Week", purpose: "market_activation", starts_on: day(20), ends_on: day(22), employee_ids: [id("staff"), id("other")] }));
    const sid = res.body.temporary_site_id;
    expect(res.body).toMatchObject({ can_change: true });
    expect((await as("manager").post(`/attendance/temporary-sites/${sid}/cancel`, { reason: "The market was called off" })).status).toBe(403);
    const ownSite = await as("ops").post("/attendance/temporary-sites", body({ name: "Ops Offsite", purpose: "event", starts_on: day(20), ends_on: day(20), employee_ids: [id("ops2")] }));
    expect((await as("ops2").post(`/attendance/temporary-sites/${ownSite.body.temporary_site_id}/cancel`, { reason: "The market was called off" })).body.error.code).toBe("OWN_RECORD");

    const off = await as("ops").post(`/attendance/temporary-sites/${sid}/remove`, { employee_id: id("other"), reason: "Needed at the office that week" });
    expect(off.body).toMatchObject({ people: 1 });
    expect(off.body.members.find((m) => m.employee.display_name === "Zainab Lawal")).toMatchObject({ removed_reason: "Needed at the office that week" });
    const last = await as("ops").post(`/attendance/temporary-sites/${sid}/remove`, { employee_id: id("staff"), reason: "Needed at the office that week" });
    expect([last.status, last.body.error.code]).toEqual([409, "SITE_LAST_PERSON"]);
    expect((await punchAt("other", `${day(20)}T07:00:00Z`, at(OFFICE, 10))).worksite_name).toBe("Sites Office");

    const cancelled = await as("ops").post(`/attendance/temporary-sites/${sid}/cancel`, { reason: "The market was called off" });
    expect(cancelled.body).toMatchObject({ status: "cancelled", state: "cancelled", cancel_reason: "The market was called off", can_change: false });
    expect((await punchAt("staff", `${day(21)}T07:00:00Z`, at(OFFICE, 10))).worksite_name).toBe("Sites Office");
    const again = await as("ops").post(`/attendance/temporary-sites/${sid}/cancel`, { reason: "The market was called off" });
    expect([again.status, again.body.error.code]).toEqual([409, "SITE_NOT_APPROVED"]);

    const waiting = await as("staff").post("/attendance/me/temporary-sites", body({ name: "Survey Days", purpose: "field_survey", starts_on: day(40), ends_on: day(40), employee_ids: [id("staff")] }));
    expect((await as("ops").post(`/attendance/temporary-sites/${waiting.body.temporary_site_id}/cancel`, { reason: "Decide it instead please" })).body.error.code).toBe("SITE_NOT_APPROVED");
    const ended = await as("ops").post("/attendance/temporary-sites", body({ name: "Long Ago", purpose: "event", starts_on: day(50), ends_on: day(50), employee_ids: [id("outsider")] }));
    await q("UPDATE attendance_temporary_site SET starts_on = $2, ends_on = $2 WHERE temporary_site_id = $1", [ended.body.temporary_site_id, day(-3)]);
    const late = await as("ops").post(`/attendance/temporary-sites/${ended.body.temporary_site_id}/cancel`, { reason: "The market was called off" });
    expect([late.status, late.body.error.code]).toEqual([409, "SITE_ENDED"]);
    expect((await as("ops").get(`/attendance/temporary-sites/${ended.body.temporary_site_id}`)).body.state).toBe("done");

    await drain();
    expect((await told("other", "temporary_site.%")).map((r) => r.title)).toEqual(
      expect.arrayContaining(["Added to a Temporary Site", "Taken off a Temporary Site"]),
    );
    expect((await told("staff", "temporary_site.cancelled")).map((r) => r.body)).toEqual([expect.stringContaining("The market was called off")]);
  });

  test("who reads what: the person their own, People in scope, paged at 25, found by number or name or person, never by an address", async () => {
    const mine = await as("other").get("/attendance/me/temporary-sites");
    expect(mine.body.page.size).toBe(25);
    for (const s of mine.body.data) expect(s.members.some((m) => m.employee.display_name === "Zainab Lawal") || s.submitted_by_name === "Zainab Lawal").toBe(true);
    expect((await as("staff").get("/attendance/temporary-sites")).status).toBe(403);
    const team = await as("manager").get("/attendance/temporary-sites");
    expect(team.body.data.length).toBeGreaterThan(0);
    for (const s of team.body.data) expect(s.members.some((m) => ["Musa Danjuma", "Zainab Lawal", "Femi Oke"].includes(m.employee.display_name))).toBe(true);
    expect(team.body.data.map((s) => s.name)).not.toContain("Long Ago");
    const waiting = await as("ops").get("/attendance/temporary-sites");
    expect(waiting.body.data[0].state).toBe("submitted");
    expect((await as("ops").get("/attendance/temporary-sites?purpose=temporary_home")).body.data.map((s) => s.name)).toEqual(["Ibadan stay"]);
    expect((await as("ops").get("/attendance/temporary-sites?q=zainab")).body.data.length).toBeGreaterThan(0);
    expect((await as("ops").get("/attendance/temporary-sites?q=Hidden")).body.data).toEqual([]);

    const byNumber = await as("ops").get(`/search?q=${site.number}`);
    expect((byNumber.body.groups || []).map((g) => g.type)).toContain("attendance_temporary_site");
    const byAddress = await as("ops").get("/search?q=Sample Road");
    expect((byAddress.body.groups || []).map((g) => g.type)).not.toContain("attendance_temporary_site");
    const ownSearch = await as("other").get("/search?q=Partner Training");
    const ownGroup = (ownSearch.body.groups || []).find((g) => g.type === "attendance_own_temporary_site");
    expect(ownGroup.items[0]).toMatchObject({ ref: site.number, link: `/ess?tab=work-location-requests&site=${site.temporary_site_id}` });
    const action = await as("staff").get("/search?q=work site");
    expect((action.body.groups || []).flatMap((g) => g.items).map((i) => i.title)).toContain("Add Work Site");

    // The bell opens a site on the person's own screen.
    const notices = await as("other").get("/notifications");
    const onSite = notices.body.data.find((n) => n.title === "Temporary Site Approved");
    expect(onSite.link.path).toBe(`/ess?tab=work-location-requests&site=${site.temporary_site_id}`);
  });

  test("the assistant reads a page of sites in scope with no address; events, audit and notices carry none", async () => {
    const ai = require("../../src/shared/ai/registry");
    const read = ai.read("attendance.temporary_sites");
    const page = await read.run(pool, { page: 1 }, { ...(await actorOf("manager")), scope: { scope: "team", scope_ids: [id("manager"), id("staff"), id("other"), id("remote")] } });
    expect(page.page.size).toBe(25);
    expect(Object.keys(page.data[0]).sort()).toEqual(["days", "ends_on", "name", "number", "people", "purpose", "starts_on", "state", "temporary_site_id"]);
    await drain();
    const logged = await q(
      `SELECT l.payload, a.before, a.after FROM event_log l LEFT JOIN audit_ledger a ON a.event_id = l.event_id
        WHERE l.event_key LIKE 'temporary_site.%' OR l.event_key = 'attendance.checked_in'`,
      [],
    );
    expect(logged.rows.length).toBeGreaterThan(5);
    const notices = await q("SELECT title, body FROM notification WHERE event_key LIKE 'temporary_site.%'", []);
    const text = JSON.stringify([logged.rows, notices.rows]);
    for (const secret of ["Sample Road", "Hidden Close", "Main Mall", "6.6", "6.62", "6.44", "-24.65", "out-of-station letter"]) expect(text).not.toContain(secret);
    const failed = await q("SELECT count(*)::int AS n FROM event_outbox WHERE status = 'failed'", []);
    expect(failed.rows[0].n).toBe(0);
  });
});
