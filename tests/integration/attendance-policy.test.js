"use strict";
/**
 * The attendance policy's versions end to end (docs/guides/attendance.md §6.15): the draft,
 * publishing from a first day, a version waiting and withdrawn, the version a punch is judged by,
 * the location mode of each place, acknowledgement and the reminder, on the real migrations and
 * through HTTP (every response parsed with its contract, APP_ENV=test).
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/attendance-policy
 *
 * Dates are read from today in Lagos, so the file runs on any day. Every person is invented.
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
const lagos = require("../../src/shared/time/lagos");
const service = require("../../src/modules/attendance/attendance.service");
const policy = require("../../src/modules/attendance/attendance.policy");
const calendar = require("../../src/modules/attendance/attendance.calendar");
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
const PASSWORD = "Policy-Rules9Test";
const TODAY = lagos.today();
const day = (n) => lagos.addDays(TODAY, n);

/** Every rule, the code's defaults with the changes given. */
const rules = (changes = {}) => ({
  grace_minutes: 0,
  office_geofence_mode: "warn",
  home_geofence_mode: "warn",
  site_geofence_mode: "warn",
  device_mode: "off",
  max_accuracy_m: 100,
  home_radius_m: 100,
  ...changes,
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

describeDb("the attendance policy against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  const versions = {};
  let ip = 0;

  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
    post: (path, body = {}) =>
      request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    put: (path, body = {}) =>
      request(app).put(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
  });

  const employeeId = (who) => people[who].employee.employee_id;
  const noticesOf = (who, key) =>
    q("SELECT title, body, entity_type, entity_id, read_at FROM notification WHERE user_id = $1 AND event_key = $2 ORDER BY created_at", [
      people[who].user.user_id,
      key,
    ]).then((r) => r.rows);

  async function signIn(who) {
    ip += 1;
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", `10.73.0.${ip}`)
      .send({ email: `${who}@mycity.test`, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body.access_token;
  }

  async function publishVersion(changes, from, note = "Grace and checks changed") {
    expect((await as("ops").put("/attendance/policy/draft", rules(changes))).status).toBe(200);
    const res = await as("ops").post("/attendance/policy/publish", { effective_from: from, note });
    expect(res.status).toBe(200);
    return res.body;
  }

  beforeAll(async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    aiRegistry.load();
    ({ app } = buildApp({ strict: true, accessLog: false }));

    const make = (who, first, last, role, pattern = "on_site") =>
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
              work_pattern: pattern,
            },
            role_code: role,
            is_ceo: false,
          },
          PASSWORD,
          { allowAdditional: true },
        );
      });
    await make("ops", "Ngozi", "Eze", "operations_people");
    await make("staff", "Femi", "Ola", "employee");
    await make("remote", "Hauwa", "Bello", "employee", "remote");
    await grantsCache.bumpTeamVersion();
    await drain();
    for (const who of Object.keys(people)) tokens[who] = await signIn(who);
  });

  // The socket emitter would hold a Redis connection open past the run.
  beforeEach(() => jest.spyOn(realtime, "toUser").mockReturnValue(true));
  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("with no version, the code's rules are in force, and 1099's Standard policy is gone (A26)", async () => {
    expect((await q("SELECT count(*)::int AS n FROM attendance_policy WHERE name = 'Standard'")).rows[0].n).toBe(0);

    const res = await as("ops").get("/attendance/policy");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ today: TODAY, current: rules(), in_force: null, waiting: null, draft: null, can_edit: true });

    expect((await as("staff").get("/attendance/policy")).status).toBe(403);
    const mine = await as("staff").get("/attendance/me/policy");
    expect(mine.body).toMatchObject({ current: rules(), latest: null, in_force_version: null });
  });

  test("the draft holds every rule, says what it changes, and only settings edit saves it", async () => {
    expect((await as("staff").put("/attendance/policy/draft", rules())).status).toBe(403);
    const bad = await as("ops").put("/attendance/policy/draft", rules({ grace_minutes: 61 }));
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.error.fields)).toContain("grace_minutes");

    const saved = await as("ops").put("/attendance/policy/draft", rules({ grace_minutes: 10, office_geofence_mode: "block", device_mode: "warn" }));
    expect(saved.status).toBe(200);
    expect(saved.body.draft).toMatchObject({ grace_minutes: 10, changed: ["grace_minutes", "office_geofence_mode", "device_mode"] });
    expect(saved.body.current.grace_minutes).toBe(0);

    await as("ops").put("/attendance/policy/draft", rules({ grace_minutes: 15 }));
    expect((await q("SELECT count(*)::int AS n FROM attendance_policy WHERE status = 'draft'")).rows[0].n).toBe(1);

    const gone = await as("ops").post("/attendance/policy/draft/discard");
    expect(gone.body.draft).toBeNull();
    expect((await as("ops").post("/attendance/policy/draft/discard")).body.error.code).toBe("NO_DRAFT");
    await drain();
    expect(await noticesOf("staff", "attendance.policy_draft_saved")).toEqual([]);
  });

  test("publishing makes the draft Version 1 from its first day, and everyone else is told", async () => {
    expect((await as("ops").post("/attendance/policy/publish", { effective_from: TODAY, note: "First written policy" })).body.error.code).toBe("NO_DRAFT");
    await as("ops").put("/attendance/policy/draft", rules({ grace_minutes: 10, office_geofence_mode: "block", device_mode: "warn" }));
    const past = await as("ops").post("/attendance/policy/publish", { effective_from: day(-1), note: "First written policy" });
    expect(past.status).toBe(422);
    expect(past.body.error.code).toBe("POLICY_IN_THE_PAST");
    const far = await as("ops").post("/attendance/policy/publish", { effective_from: day(91), note: "First written policy" });
    expect(far.body.error.code).toBe("POLICY_TOO_FAR");
    const short = await as("ops").post("/attendance/policy/publish", { effective_from: TODAY, note: "Short" });
    expect(short.status).toBe(422);

    const res = await as("ops").post("/attendance/policy/publish", { effective_from: TODAY, note: "First written policy" });
    expect(res.status).toBe(200);
    expect(res.body.draft).toBeNull();
    expect(res.body.in_force).toMatchObject({ version: 1, state: "in_force", effective_from: TODAY, grace_minutes: 10, changed: [], acknowledged: 0, asked: 3 });
    expect(res.body.current).toEqual(rules({ grace_minutes: 10, office_geofence_mode: "block", device_mode: "warn" }));
    versions.v1 = res.body.in_force.attendance_policy_id;

    await drain();
    const [notice] = await noticesOf("staff", "attendance.policy_published");
    expect(notice).toMatchObject({ title: "Attendance policy updated", entity_type: "attendance_policy", entity_id: versions.v1, read_at: null });
    expect(notice.body).toMatch(/^Version 1 applies from \d{2}\/\d{2}\/\d{4}\. Read and acknowledge it\.$/);
    expect(await noticesOf("ops", "attendance.policy_published")).toEqual([]);
  });

  test("each place has its own location mode, and a punch keeps the version it was judged by", async () => {
    const office = await calendar.contextFor(pool, await repo.person(pool, employeeId("staff")), TODAY);
    expect(office.policy).toMatchObject({ geofence_mode: "block", version: 1 });
    const home = await calendar.contextFor(pool, await repo.person(pool, employeeId("remote")), TODAY);
    expect(home.policy.geofence_mode).toBe("warn");

    const u = await grantsCache.getAuthUser(pool, people.staff.user.user_id);
    const s = await q("SELECT session_id FROM user_session WHERE user_id = $1 ORDER BY issued_at DESC LIMIT 1", [u.user_id]);
    const now = new Date();
    const r = await service.punch(
      { ...u, session_id: s.rows[0].session_id },
      { event_type: "clock_in", device_at: now.toISOString(), latitude: null, longitude: null, accuracy_m: null, location_error: "denied" },
      { idempotencyKey: crypto.randomUUID(), now },
    );
    const { rows } = await q("SELECT attendance_policy_id FROM attendance_event WHERE attendance_event_id = $1", [r.attendance_event_id]);
    expect(rows[0].attendance_policy_id).toBe(versions.v1);
    // No office assigned is unverified: reviewed under block, never refused.
    expect(r.validation_state).toBe("review");
  });

  test("a later version waits for its first day, must change something and start after any waiting", async () => {
    await as("ops").put("/attendance/policy/draft", rules({ grace_minutes: 10, office_geofence_mode: "block", device_mode: "warn" }));
    expect((await as("ops").post("/attendance/policy/publish", { effective_from: day(7), note: "Nothing really changed" })).body.error.code).toBe(
      "NO_CHANGES",
    );

    const two = await publishVersion({ grace_minutes: 5, office_geofence_mode: "block", device_mode: "warn" }, day(7));
    expect(two.in_force.version).toBe(1);
    expect(two.waiting).toMatchObject({ version: 2, state: "waiting", effective_from: day(7), changed: ["grace_minutes"] });
    versions.v2 = two.waiting.attendance_policy_id;
    expect((await calendar.policyFor(pool, employeeId("staff"), TODAY)).version).toBe(1);
    expect((await calendar.policyFor(pool, employeeId("staff"), day(7))).version).toBe(2);

    await as("ops").put("/attendance/policy/draft", rules({ grace_minutes: 20, office_geofence_mode: "block", device_mode: "warn" }));
    const early = await as("ops").post("/attendance/policy/publish", { effective_from: day(7), note: "Grace raised again" });
    expect(early.body.error.code).toBe("POLICY_BEFORE_WAITING");
    const three = await as("ops").post("/attendance/policy/publish", { effective_from: day(8), note: "Grace raised again" });
    expect(three.body.waiting).toMatchObject({ version: 3, changed: ["grace_minutes"] });
    versions.v3 = three.body.waiting.attendance_policy_id;
  });

  test("a waiting version can be withdrawn, its rules return to the draft, and its number is not reused", async () => {
    expect((await as("ops").post(`/attendance/policy/versions/${versions.v1}/withdraw`, { reason: "Not this one, it is in force" })).body.error.code).toBe(
      "POLICY_NOT_WAITING",
    );
    const res = await as("ops").post(`/attendance/policy/versions/${versions.v3}/withdraw`, { reason: "Grace stays at five minutes" });
    expect(res.status).toBe(200);
    expect(res.body.waiting).toMatchObject({ version: 2 });
    expect(res.body.draft).toMatchObject({ grace_minutes: 20, changed: ["grace_minutes"] });
    const v3 = await as("ops").get(`/attendance/policy/versions/${versions.v3}`);
    expect(v3.body).toMatchObject({ state: "withdrawn", withdraw_reason: "Grace stays at five minutes" });
    expect(await repo.nextVersion(pool)).toBe(4);
    await as("ops").post("/attendance/policy/draft/discard");

    await drain();
    const [notice] = await noticesOf("staff", "attendance.policy_withdrawn");
    expect(notice).toMatchObject({ title: "Attendance policy version withdrawn", entity_id: versions.v3 });
  });

  test("staff read the newest version and acknowledge it once; People see who has", async () => {
    const mine = await as("staff").get("/attendance/me/policy");
    expect(mine.body).toMatchObject({ in_force_version: 1, latest: { version: 2, state: "waiting", acknowledged_at: null } });

    expect((await as("staff").post(`/attendance/me/policy/versions/${versions.v1}/acknowledge`)).body.error.code).toBe("POLICY_NOT_LATEST");
    const done = await as("staff").post(`/attendance/me/policy/versions/${versions.v2}/acknowledge`);
    expect(done.status).toBe(200);
    const at = done.body.latest.acknowledged_at;
    expect(at).not.toBeNull();
    const again = await as("staff").post(`/attendance/me/policy/versions/${versions.v2}/acknowledge`);
    expect(again.body.latest.acknowledged_at).toBe(at);

    const list = await as("staff").get("/attendance/me/policy/versions");
    expect(list.body.data.map((v) => [v.version, v.state, Boolean(v.acknowledged_at)])).toEqual([
      [3, "withdrawn", false],
      [2, "waiting", true],
      [1, "in_force", false],
    ]);
    const draftId = (await as("ops").put("/attendance/policy/draft", rules({ grace_minutes: 30 }))).body.draft.attendance_policy_id;
    expect((await as("staff").get(`/attendance/me/policy/versions/${draftId}`)).status).toBe(404);
    await as("ops").post("/attendance/policy/draft/discard");

    const report = await as("ops").get(`/attendance/policy/versions/${versions.v2}/acknowledgements`);
    expect(report.body.page.total).toBe(3);
    const acked = await as("ops").get(`/attendance/policy/versions/${versions.v2}/acknowledgements?status=acknowledged`);
    expect(acked.body.data.map((r) => r.employee.employee_id)).toEqual([employeeId("staff")]);
    const waiting = await as("ops").get(`/attendance/policy/versions/${versions.v2}/acknowledgements?status=pending`);
    expect(waiting.body.page.total).toBe(2);
    const all = await as("ops").get("/attendance/policy/versions?state=waiting");
    expect(all.body.data).toEqual([expect.objectContaining({ version: 2, acknowledged: 1, asked: 3 })]);
  });

  test("the reminder goes once, 3 days after publishing, to whoever has not acknowledged", async () => {
    expect(await policy.remind({ now: new Date() })).toEqual({ reminded: 0 });
    const later = new Date(Date.now() + 4 * 86_400_000);
    expect(await policy.remind({ now: later })).toEqual({ reminded: 2 });
    expect(await policy.remind({ now: later })).toEqual({ reminded: 0 });

    await drain();
    const [notice] = await noticesOf("remote", "attendance.policy_reminder_due");
    expect(notice).toMatchObject({ title: "Acknowledge the attendance policy", entity_id: versions.v2 });
    expect(await noticesOf("staff", "attendance.policy_reminder_due")).toEqual([]);

    // Acknowledging reads the person's notices about that version.
    await as("remote").post(`/attendance/me/policy/versions/${versions.v2}/acknowledge`);
    const [read] = await noticesOf("remote", "attendance.policy_reminder_due");
    expect(read.read_at).not.toBeNull();
  });
});
