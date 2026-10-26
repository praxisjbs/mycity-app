"use strict";
/**
 * Policies end to end (docs/guides/policies.md): the Attendance policy's draft and versions, a
 * written policy for some people only, publishing with a signature, the CEO's approval, withdrawing
 * a version waiting to start, archiving, acknowledgement with Later, the reminder, and the version a
 * punch is judged by, on the real migrations and through HTTP (every response parsed with its
 * contract, APP_ENV=test).
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/policies
 *
 * Dates are read from today in Lagos, so the file runs on any day. Every person is invented.
 */
const crypto = require("node:crypto");
const request = require("supertest");
const sharp = require("sharp");
const c = require("@mycity/contract");
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
const attendance = require("../../src/modules/attendance/attendance.service");
const calendar = require("../../src/modules/attendance/attendance.calendar");
const attendanceRepo = require("../../src/modules/attendance/attendance.repo");
const policies = require("../../src/modules/policies/policies.service");
const policyRepo = require("../../src/modules/policies/policies.repo");
const attendanceType = require("../../src/modules/attendance/attendance.policy-type");
const realtime = require("../../src/services/realtime/emitter");
const reminders = require("../../src/modules/notifications/notifications.reminders");

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
const EVERYONE = { everyone: true, department_ids: [], work_patterns: [], employee_ids: [] };

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

describeDb("policies against the real migrations", () => {
  let app;
  let signature;
  let attendanceId;
  let itId;
  let salesId;
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

  /** The Attendance draft: the code's suggestions with the changes given. */
  const attendanceDraft = (rules = {}) => ({
    title: "Attendance Policy",
    applies_to: EVERYONE,
    needs_acknowledgement: true,
    acknowledge_within_days: 7,
    needs_approval: false,
    rules: { ...attendanceType.suggestions(), ...rules },
  });
  /** The IT policy's draft: for Sales only, unless told otherwise. */
  const itDraft = (over = {}) => ({
    title: "IT Equipment",
    applies_to: { ...EVERYONE, everyone: false, department_ids: [salesId] },
    needs_acknowledgement: true,
    acknowledge_within_days: 7,
    needs_approval: false,
    body_html: "<h1>Laptops</h1><p>Return your laptop on your last day.</p>",
    ...over,
  });
  const publish = (who, id, from = TODAY, note = "First written policy") =>
    as(who).post(`/policies/${id}/publish`, { effective_from: from, note, signature });

  async function signIn(who) {
    ip += 1;
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", `10.74.0.${ip}`)
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
    const png = await sharp({ create: { width: 120, height: 40, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 1 } } })
      .png()
      .toBuffer();
    signature = `data:image/png;base64,${png.toString("base64")}`;

    const make = (who, first, last, role, { pattern = "on_site", department = "Programmes", ceo = false } = {}) =>
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
              work_pattern: pattern,
            },
            role_code: role,
            is_ceo: ceo,
          },
          PASSWORD,
          { allowAdditional: true },
        );
      });
    await make("ops", "Ngozi", "Eze", "operations_people");
    await make("staff", "Femi", "Ola", "employee");
    await make("remote", "Hauwa", "Bello", "employee", { pattern: "remote" });
    await make("sales", "Tayo", "Ade", "employee", { department: "Sales" });
    await make("ceo", "Bola", "Okeke", "management", { ceo: true });
    salesId = people.sales.employee.department_id;
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

  test("the Attendance policy is always listed, with the code's rules until its first version; only policies.manage sees the list", async () => {
    const list = await as("ops").get("/policies");
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([
      expect.objectContaining({ kind: "attendance", title: "Attendance Policy", state: "draft", version_in_force: null, number: "POL-0001" }),
    ]);
    attendanceId = list.body.data[0].policy_id;

    expect((await as("staff").get("/policies")).status).toBe(403);
    // management holds the knowledge grant but not the capability.
    expect((await as("ceo").get("/policies")).status).toBe(200); // the CEO holds every capability

    const one = await as("ops").get(`/policies/${attendanceId}`);
    expect(one.body).toMatchObject({ today: TODAY, in_force: null, waiting: null, draft: null, can_edit: true, can_archive: false });
    expect(one.body.current_rules).toEqual(c.attendance.AttendanceRules.parse({}));
    expect(one.body.suggested_rules).toMatchObject({ grace_minutes: 5, device_mode: "warn", home_radius_m: 150 });
    expect(await policies.rulesFor(pool, "attendance", TODAY)).toMatchObject({ policy_version_id: null, version: null });
  });

  test("the Attendance draft holds every rule, and refuses what a new version may not set", async () => {
    expect((await as("staff").put(`/policies/${attendanceId}/draft`, attendanceDraft())).status).toBe(403);
    // A home's check and radius are checked while Home Location is on, when the worksheet shows them (attendance.md §1.3).
    const homes = { home_location: { on: true } };
    const narrow = await as("ops").put(`/policies/${attendanceId}/draft`, attendanceDraft({ ...homes, home_radius_m: 100 }));
    expect(narrow.status).toBe(422);
    expect(Object.keys(narrow.body.error.fields)).toContain("rules.home_radius_m");
    const homeOff = await as("ops").put(`/policies/${attendanceId}/draft`, attendanceDraft({ ...homes, home_geofence_mode: "off" }));
    expect(homeOff.status).toBe(422);
    const text = await as("ops").put(`/policies/${attendanceId}/draft`, { ...attendanceDraft(), body_html: "<p>Words</p>" });
    expect(text.body.error.code).toBe("NO_TEXT_ON_RULES");

    const saved = await as("ops").put(`/policies/${attendanceId}/draft`, attendanceDraft({ office_geofence_mode: "block" }));
    expect(saved.status).toBe(200);
    expect(saved.body.draft).toMatchObject({ body_html: null, changed: [], rules: expect.objectContaining({ grace_minutes: 5 }) });
    expect(saved.body.state).toBe("draft");

    await as("ops").put(`/policies/${attendanceId}/draft`, attendanceDraft({ office_geofence_mode: "block", grace_minutes: 10 }));
    expect((await q("SELECT count(*)::int AS n FROM policy_version WHERE status = 'draft'")).rows[0].n).toBe(1);
    // Off, an older version's Off and 100 m are kept, hidden, and the draft still saves.
    const kept = await as("ops").put(
      `/policies/${attendanceId}/draft`,
      attendanceDraft({ office_geofence_mode: "block", home_geofence_mode: "off", home_radius_m: 100 }),
    );
    expect(kept.status).toBe(200);
    expect(kept.body.draft.rules).toMatchObject({ home_location: { on: false }, home_geofence_mode: "off", home_radius_m: 100 });
    await as("ops").put(`/policies/${attendanceId}/draft`, attendanceDraft({ office_geofence_mode: "block" }));
  });

  test("publishing signs and numbers Version 1 from its first day; everyone is told, and a punch keeps the version", async () => {
    expect((await publish("ops", attendanceId, day(-1))).body.error.code).toBe("POLICY_IN_THE_PAST");
    expect((await publish("ops", attendanceId, day(91))).body.error.code).toBe("POLICY_TOO_FAR");
    expect((await publish("ops", attendanceId, TODAY, "Short")).status).toBe(422);
    const unsigned = await as("ops").post(`/policies/${attendanceId}/publish`, { effective_from: TODAY, note: "First written policy", signature: "x" });
    expect(Object.keys(unsigned.body.error.fields)).toContain("signature");

    const res = await publish("ops", attendanceId);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: "in_force", draft: null });
    expect(res.body.in_force).toMatchObject({ version: 1, state: "in_force", effective_from: TODAY, changed: [], acknowledged: 0, asked: 5 });
    expect(res.body.in_force.signatures).toEqual([expect.objectContaining({ role: "publisher", signer_name: "Ngozi Eze" })]);
    expect(res.body.in_force.sections.map((s) => s.title)).toContain("Your Location");
    versions.att1 = res.body.in_force.policy_version_id;

    await drain();
    const [notice] = await noticesOf("staff", "policy.published");
    expect(notice).toMatchObject({ title: "New policy", entity_type: "policy_version", entity_id: versions.att1, read_at: null });
    expect(notice.body).toMatch(/^Attendance Policy, Version 1, applies from \d{2}\/\d{2}\/\d{4}\. Read and acknowledge it\.$/);
    expect(await noticesOf("ops", "policy.published")).toEqual([]);

    expect(await policies.rulesFor(pool, "attendance", TODAY)).toMatchObject({ policy_version_id: versions.att1, version: 1 });
    const office = await calendar.contextFor(pool, await attendanceRepo.person(pool, employeeId("staff")), TODAY);
    expect(office.policy).toMatchObject({ geofence_mode: "block", version: 1, policy_version_id: versions.att1 });

    const u = await grantsCache.getAuthUser(pool, people.staff.user.user_id);
    const s = await q("SELECT session_id FROM user_session WHERE user_id = $1 ORDER BY issued_at DESC LIMIT 1", [u.user_id]);
    const now = new Date();
    const r = await attendance.punch(
      { ...u, session_id: s.rows[0].session_id },
      { event_type: "clock_in", device_at: now.toISOString(), latitude: null, longitude: null, accuracy_m: null, location_error: "denied" },
      { idempotencyKey: crypto.randomUUID(), now },
    );
    const { rows } = await q("SELECT policy_version_id FROM attendance_event WHERE attendance_event_id = $1", [r.attendance_event_id]);
    expect(rows[0].policy_version_id).toBe(versions.att1);
  });

  test("a written policy reaches only the people it applies to, and its text keeps headings and lists only", async () => {
    const created = await as("ops").post("/policies", {
      title: "IT Equipment",
      applies_to: { ...EVERYONE, everyone: false, department_ids: [salesId] },
      needs_acknowledgement: true,
      acknowledge_within_days: 7,
      needs_approval: false,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ kind: "document", number: "POL-0002", state: "draft", can_archive: true });
    itId = created.body.policy_id;
    expect((await publish("ops", itId)).body.error.code).toBe("POLICY_EMPTY");

    const saved = await as("ops").put(
      `/policies/${itId}/draft`,
      itDraft({ body_html: '<h1>Laptops</h1><p>Return it <script>alert(1)</script><b>on your last day</b>.</p><p onclick="x()">Thanks</p>' }),
    );
    expect(saved.status).toBe(200);
    expect(saved.body.draft.body_html).toBe("<h2>Laptops</h2>\n<p>Return it <strong>on your last day</strong>.</p>\n<p>Thanks</p>");
    const named = await as("ops").put(`/policies/${itId}/draft`, itDraft({ applies_to: { ...EVERYONE, everyone: false, department_ids: [salesId], employee_ids: [employeeId("staff")] } }));
    expect(named.body.draft.applies_to_people).toEqual([expect.objectContaining({ employee_id: employeeId("staff"), display_name: "Femi Ola" })]);
    await as("ops").put(`/policies/${itId}/draft`, itDraft());
    expect((await as("ops").put(`/policies/${itId}/draft`, { ...itDraft(), rules: attendanceDraft().rules })).body.error.code).toBe("NO_RULES_ON_TEXT");

    const res = await publish("ops", itId);
    expect(res.status).toBe(200);
    expect(res.body.in_force).toMatchObject({ version: 1, applies_to_text: "Sales", asked: 1 });
    expect(res.body.in_force.body[0]).toEqual({ kind: "heading", level: 2, spans: [{ text: "Laptops", bold: false, italic: false, href: null }] });
    versions.it1 = res.body.in_force.policy_version_id;

    const salesList = await as("sales").get("/policies/me");
    expect(salesList.body.data.map((r) => r.title).sort()).toEqual(["Attendance Policy", "IT Equipment"]);
    const staffList = await as("staff").get("/policies/me");
    expect(staffList.body.data.map((r) => r.title)).toEqual(["Attendance Policy"]);
    expect((await as("staff").get(`/policies/me/versions/${versions.it1}`)).status).toBe(404);
    expect((await as("sales").get(`/policies/me/versions/${versions.it1}`)).body).toMatchObject({ can_acknowledge: true, can_later: true });
  });

  test("the acknowledge sheet: what is owed, Later until its due date, and acknowledged once", async () => {
    const owed = await as("staff").get("/policies/me/due");
    expect(owed.body.items).toEqual([
      expect.objectContaining({ policy_version_id: versions.att1, first: true, due_on: day(7), overdue: false, can_later: true }),
    ]);
    const later = await as("staff").post(`/policies/me/versions/${versions.att1}/later`);
    expect(later.status).toBe(200);
    expect(later.body.items).toEqual([]);

    const done = await as("staff").post(`/policies/me/versions/${versions.att1}/acknowledge`);
    expect(done.status).toBe(200);
    const at = done.body.acknowledged_at;
    expect(at).not.toBeNull();
    expect(done.body.can_acknowledge).toBe(false);
    const again = await as("staff").post(`/policies/me/versions/${versions.att1}/acknowledge`);
    expect(again.body.acknowledged_at).toBe(at);
    expect((await as("staff").get("/policies/me?state=to_acknowledge")).body.data).toEqual([]);

    const report = await as("ops").get(`/policies/versions/${versions.att1}/acknowledgements`);
    expect(report.body.page.total).toBe(5);
    const acked = await as("ops").get(`/policies/versions/${versions.att1}/acknowledgements?status=acknowledged`);
    expect(acked.body.data.map((r) => r.employee.employee_id)).toEqual([employeeId("staff")]);
    expect((await as("ops").get(`/policies/versions/${versions.att1}/acknowledgements?status=pending`)).body.page.total).toBe(4);
    const row = (await as("ops").get("/policies?kind=attendance")).body.data[0];
    expect(row).toMatchObject({ version_in_force: 1, asked: 5, acknowledged: 1 });
  });

  test("a later version waits for its first day; withdrawing it returns its content to the draft", async () => {
    await as("ops").put(`/policies/${attendanceId}/draft`, attendanceDraft({ office_geofence_mode: "block" }));
    expect((await publish("ops", attendanceId, day(7), "Nothing really changed")).body.error.code).toBe("NO_CHANGES");

    await as("ops").put(`/policies/${attendanceId}/draft`, attendanceDraft({ office_geofence_mode: "block", grace_minutes: 10 }));
    const two = await publish("ops", attendanceId, day(7), "Grace raised to ten");
    expect(two.body.in_force.version).toBe(1);
    expect(two.body.waiting).toMatchObject({ version: 2, state: "waiting", effective_from: day(7), changed: ["grace_minutes"] });
    expect(two.body.waiting.change_lines).toEqual(["Grace Minutes: 5 minutes to 10 minutes"]);
    versions.att2 = two.body.waiting.policy_version_id;
    expect((await calendar.policyFor(pool, employeeId("staff"), TODAY)).version).toBe(1);
    expect((await calendar.policyFor(pool, employeeId("staff"), day(7))).version).toBe(2);

    await as("ops").put(`/policies/${attendanceId}/draft`, attendanceDraft({ office_geofence_mode: "block", grace_minutes: 20 }));
    expect((await publish("ops", attendanceId, day(7), "Grace raised again")).body.error.code).toBe("POLICY_BEFORE_WAITING");
    await as("ops").post(`/policies/${attendanceId}/draft/discard`);
    expect((await as("ops").post(`/policies/${attendanceId}/draft/discard`)).body.error.code).toBe("NO_DRAFT");

    expect((await as("ops").post(`/policies/versions/${versions.att1}/withdraw`, { reason: "Not this one, it is in force" })).body.error.code).toBe(
      "POLICY_NOT_WAITING",
    );
    const res = await as("ops").post(`/policies/versions/${versions.att2}/withdraw`, { reason: "Grace stays at five minutes" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ waiting: null, state: "in_force" });
    expect(res.body.draft).toMatchObject({ rules: expect.objectContaining({ grace_minutes: 10 }), changed: ["grace_minutes"] });
    expect((await as("ops").get(`/policies/versions/${versions.att2}`)).body).toMatchObject({ state: "withdrawn", withdraw_reason: "Grace stays at five minutes" });
    expect(await policyRepo.nextVersion(pool, attendanceId)).toBe(3);
    await as("ops").post(`/policies/${attendanceId}/draft/discard`);

    await drain();
    const [notice] = await noticesOf("staff", "policy.withdrawn");
    expect(notice).toMatchObject({ title: "Policy version withdrawn", entity_id: versions.att2 });
  });

  test("with Needs Approval on, the CEO approves and signs, and the version is published", async () => {
    await as("ops").put(`/policies/${itId}/draft`, itDraft({ needs_approval: true, body_html: "<p>Return your laptop and charger.</p>" }));
    expect((await publish("ops", itId, TODAY, "Chargers added")).body.error.code).toBe("POLICY_NEEDS_APPROVAL");
    const sent = await as("ops").post(`/policies/${itId}/submit`, { effective_from: TODAY, note: "Chargers added", signature });
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ state: "awaiting_approval", draft: null });
    expect(sent.body.submission).toMatchObject({ stage_name: "CEO", submitted_by_name: "Ngozi Eze" });
    const id = sent.body.submission.policy_version_id;
    expect((await as("ops").put(`/policies/${itId}/draft`, itDraft())).body.error.code).toBe("POLICY_SUBMITTED");

    expect((await as("staff").post(`/policies/me/versions/${id}/approve`, { signature })).status).toBe(403);
    const waiting = await as("ceo").get("/policies/me?state=waiting_on_me");
    expect(waiting.body.data).toEqual([expect.objectContaining({ policy_version_id: id, waiting_on_me: true, state: "awaiting_approval" })]);
    expect((await as("ceo").get(`/policies/me/versions/${id}`)).body.approval).toEqual({ stage_name: "CEO", waiting_on_me: true });

    const ok = await as("ceo").post(`/policies/me/versions/${id}/approve`, { signature });
    expect(ok.status).toBe(204);
    await drain();
    const after = await as("ops").get(`/policies/${itId}`);
    expect(after.body).toMatchObject({ state: "in_force", submission: null });
    expect(after.body.in_force).toMatchObject({ version: 2, policy_version_id: id, changed: ["text"], published_by_name: "Ngozi Eze" });
    expect(after.body.in_force.signatures.map((s) => [s.role, s.signer_name, s.stage_name])).toEqual([
      ["publisher", "Ngozi Eze", null],
      ["approver", "Bola Okeke", "CEO"],
    ]);
  });

  test("a rejection returns the submission to the draft and tells the submitter why; a recall does the same quietly", async () => {
    await as("ops").put(`/policies/${itId}/draft`, itDraft({ needs_approval: true, body_html: "<p>Return everything you were given.</p>" }));
    const sent = await as("ops").post(`/policies/${itId}/submit`, { effective_from: day(1), note: "Everything returned", signature });
    const id = sent.body.submission.policy_version_id;
    expect((await as("ceo").post(`/policies/me/versions/${id}/reject`, { reason: "Name what must be returned" })).status).toBe(204);
    await drain();
    const back = await as("ops").get(`/policies/${itId}`);
    expect(back.body).toMatchObject({ state: "in_force", submission: null, draft: expect.objectContaining({ policy_version_id: id }) });
    const [notice] = await noticesOf("ops", "policy.rejected");
    // It opens the policy, where the draft is: the version it named is a draft again.
    expect(notice).toMatchObject({ title: "Policy not approved", body: "IT Equipment: Name what must be returned", entity_type: "policy", entity_id: itId });

    await as("ops").post(`/policies/${itId}/submit`, { effective_from: day(1), note: "Everything returned", signature });
    // While it waits, the editor shows what was sent, and only its sender (or the CEO) may recall it.
    expect((await as("ops").get(`/policies/${itId}`)).body.submission).toMatchObject({
      can_recall: true,
      content: expect.objectContaining({ policy_version_id: id, needs_approval: true, body_html: expect.stringContaining("Return everything") }),
    });
    // An approval still open would publish a version of an archived policy: recall it first (the owner, 26/10/2026).
    const archiving = await as("ops").post(`/policies/${itId}/archive`, { reason: "Replaced by the handbook" });
    expect(archiving.status).toBe(409);
    expect(archiving.body.error.code).toBe("SUBMISSION_WAITING");
    const recalled = await as("ops").post(`/policies/${itId}/recall`, { reason: "Adding the list first" });
    expect(recalled.body).toMatchObject({ submission: null, draft: expect.objectContaining({ policy_version_id: id }) });
    expect((await as("ceo").get("/policies/me?state=waiting_on_me")).body.data).toEqual([]);
    await as("ops").post(`/policies/${itId}/draft/discard`);
  });

  test("the reminder goes once, 3 days after publishing, in the working day, to whoever has not acknowledged", async () => {
    const attendanceReminders = async () =>
      (
        await q("SELECT occurrence, fired_count FROM reminder WHERE reminder_key = 'policy_unacknowledged' AND entity_id = $1 ORDER BY occurrence", [
          versions.att1,
        ])
      ).rows;
    await reminders.tick({ now: lagos.instant(day(1), "10:00") });
    expect(await attendanceReminders()).toEqual([]);

    // Due on the fourth day, but found at night: it waits for 08:00.
    await reminders.tick({ now: lagos.instant(day(4), "20:00") });
    expect((await attendanceReminders()).map((r) => r.fired_count)).toEqual([0, 0, 0, 0]);
    await reminders.tick({ now: lagos.instant(day(5), "08:05") });
    expect((await attendanceReminders()).map((r) => r.fired_count)).toEqual([1, 1, 1, 1]);
    await reminders.tick({ now: lagos.instant(day(5), "10:00") });
    expect((await attendanceReminders()).map((r) => r.fired_count)).toEqual([1, 1, 1, 1]);
    expect((await attendanceReminders()).map((r) => r.occurrence)).not.toContain(employeeId("staff"));

    await drain();
    const [notice] = await noticesOf("remote", "policy.reminder_due");
    expect(notice).toMatchObject({ title: "Acknowledge a policy", entity_id: versions.att1 });

    // Acknowledging reads the person's notices about that version.
    await as("remote").post(`/policies/me/versions/${versions.att1}/acknowledge`);
    const [read] = await noticesOf("remote", "policy.reminder_due");
    expect(read.read_at).not.toBeNull();
  });

  test("the PDF is queued for whoever may read the version", async () => {
    const res = await as("ops").post(`/policies/versions/${versions.it1}/pdf`);
    expect(res.status).toBe(202);
    expect((await as("sales").post(`/policies/me/versions/${versions.it1}/pdf`)).status).toBe(202);
    expect((await as("staff").post(`/policies/me/versions/${versions.it1}/pdf`)).status).toBe(404);
  });

  test("only a written policy is archived, and then nobody is asked about it", async () => {
    expect((await as("ops").post(`/policies/${attendanceId}/archive`, { reason: "We stop using it now" })).body.error.code).toBe("CANNOT_ARCHIVE");
    const res = await as("ops").post(`/policies/${itId}/archive`, { reason: "Replaced by the handbook" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: "archived", can_edit: false, can_archive: false });
    expect((await as("sales").get("/policies/me")).body.data.map((r) => r.title)).toEqual(["Attendance Policy"]);
    expect((await as("ops").put(`/policies/${itId}/draft`, itDraft())).body.error.code).toBe("POLICY_ARCHIVED");
  });
});
