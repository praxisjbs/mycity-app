"use strict";
/**
 * Settings · Notifications, the reminders, the daily digest and quiet hours, end to end
 * (docs/guides/notifications.md §6, §7.1): the real migrations on a throwaway database, the
 * routes through HTTP, the fan-out drained as the worker would, and the reminder engine's tick
 * run on a clock the test sets. Every response is checked against its contract by route().
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/notifications-rules
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public schema.
 */
const crypto = require("node:crypto");
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { emit } = require("../../src/shared/events/emit");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const lagos = require("../../src/shared/time/lagos");
const realtime = require("../../src/services/realtime/emitter");
const systemMail = require("../../src/services/mail/system-mail.service");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => undefined),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));
const queues = require("../../src/jobs/queues");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const PASSWORD = "Brand-new9Pass";

async function drain() {
  for (let i = 0; i < 10; i += 1) {
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
    const r = await outbox.dispatchDue({ db: pool });
    if (r.claimed === 0) return;
  }
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** A rule body: as declared unless the test says otherwise. */
const ruleBody = (over = {}) => ({
  enabled: true,
  urgency: null,
  in_app: true,
  email: false,
  push: true,
  role_codes: [],
  employee_ids: [],
  ...over,
});

describeDb("Settings · Notifications, reminders, the digest and quiet hours", () => {
  let app;
  let reminders;
  let deliver;
  const people = {};
  const tokens = {};
  let ipSeq = 0;
  const nextIp = () => {
    ipSeq += 1;
    return `10.63.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
  };
  const as = (who) => {
    const auth = (r) => r.set("Authorization", `Bearer ${tokens[who]}`).set("X-Forwarded-For", nextIp());
    return {
      get: (path) => auth(request(app).get(`/api/v1${path}`)),
      post: (path) => auth(request(app).post(`/api/v1${path}`)),
      put: (path) => auth(request(app).put(`/api/v1${path}`)),
    };
  };
  const userOf = (who) => people[who].user.user_id;
  const employeeOf = (who) => people[who].employee.employee_id;

  /** An event through the real emit and fan-out; the notices it wrote. */
  async function notify(key, payload, entity = { type: "employee", id: employeeOf("dayo") }) {
    const event = await tx((client) => emit(client, { key, entity, actor: null, payload }));
    await drain();
    return (await q("SELECT * FROM notification WHERE event_id = $1 ORDER BY user_id", [event.event_id])).rows;
  }

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    reminders = require("../../src/modules/notifications/notifications.reminders");
    deliver = require("../../src/jobs/handlers/notification-deliver");
    const sample = (first, last, email, job) => ({
      first_name: first,
      last_name: last,
      work_email: email,
      phone: "08031234567",
      job_title: job,
      department_name: "HR & Operations",
      start_date: "2024-01-05",
      employment_type: "full_time",
      work_pattern: "on_site",
    });
    await tx(async (client) => {
      people.ceo = await createAdmin(
        client,
        { employee: sample("Amaka", "Eze", "ceo@mycity.test", "Chief Executive Officer"), role_code: "management", is_ceo: true },
        PASSWORD,
      );
      people.pat = await createAdmin(
        client,
        { employee: sample("Pat", "Okon", "pat@mycity.test", "People Lead"), role_code: "operations_people", is_ceo: false },
        PASSWORD,
        { allowAdditional: true },
      );
      people.bola = await createAdmin(
        client,
        { employee: sample("Bola", "Ade", "bola@mycity.test", "Content Lead"), role_code: "employee", is_ceo: false },
        PASSWORD,
        { allowAdditional: true },
      );
      people.dayo = await createAdmin(
        client,
        { employee: sample("Dayo", "Ola", "dayo@mycity.test", "Content Associate"), role_code: "employee", is_ceo: false },
        PASSWORD,
        { allowAdditional: true },
      );
    });
    // Bola manages Dayo, so Bola approves Dayo's requests (test.threshold's first stage).
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [employeeOf("bola"), employeeOf("dayo")]);
    await drain();
    for (const who of ["ceo", "pat", "bola"]) {
      const res = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", nextIp()).send({ email: `${who}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[who] = res.body.access_token;
    }
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  beforeEach(() => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    queues.enqueue.mockClear();
  });
  afterEach(() => jest.restoreAllMocks());

  describe("the notices", () => {
    test("settings view reads every notice, 25 a page, Security first; anyone else is refused", async () => {
      expect((await as("bola").get("/notifications/rules")).status).toBe(403);
      const res = await as("ceo").get("/notifications/rules");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(25);
      expect(res.body.page.total).toBeGreaterThan(60);
      expect(res.body.data[0]).toMatchObject({ category: "security", locked: true, enabled: true, changed: false });

      const approvals = await as("pat").get("/notifications/rules?category=approvals");
      const reminded = approvals.body.data.find((n) => n.event_key === "workflow.reminded");
      expect(reminded).toMatchObject({ who: ["Approvers"], copies: true, urgency: "important", category_label: "Approvals" });
      expect(approvals.body.data.every((n) => n.category === "approvals")).toBe(true);

      const found = await as("pat").get("/notifications/rules?q=probation");
      expect(found.body.data.map((n) => n.event_key)).toEqual(["employee.probation_ending"]);
      expect(found.body.data[0].who).toEqual(["People · Approve"]);

      const posts = await as("pat").get("/notifications/rules?q=posted%20in%20a%20channel");
      expect(posts.body.data[0]).toMatchObject({ event_key: "channel_message.posted", copies: false, who: ["The channel's members"] });
    });

    test("Off tells nobody; Reset to Default tells them again", async () => {
      const key = "attendance.home_requested";
      const off = await as("pat").put(`/notifications/rules/${key}`).send(ruleBody({ enabled: false }));
      expect(off.status).toBe(200);
      expect(off.body).toMatchObject({ event_key: key, enabled: false, changed: true });
      expect(await notify(key, { employee_name: "Dayo Ola" })).toHaveLength(0);

      expect((await as("bola").post(`/notifications/rules/${key}/reset`).send({})).status).toBe(403);
      const back = await as("pat").post(`/notifications/rules/${key}/reset`).send({});
      expect(back.body).toMatchObject({ enabled: true, changed: false, updated_at: null });
      const rows = await notify(key, { employee_name: "Dayo Ola" });
      expect(rows.map((r) => r.user_id)).toContain(userOf("pat"));
    });

    test("Security stays on; a personal notice takes no copies; an announcement keeps its poster's level", async () => {
      const locked = await as("pat").put("/notifications/rules/role.created").send(ruleBody({ enabled: false, email: true }));
      expect(locked.status).toBe(422);
      expect(locked.body.error.code).toBe("NOTICE_LOCKED");
      const mail = await as("pat").put("/notifications/rules/direct_message.sent").send(ruleBody({ role_codes: ["management"] }));
      expect(mail.body.error.code).toBe("NOTICE_TAKES_NO_COPIES");
      const level = await as("pat").put("/notifications/rules/announcement.published").send(ruleBody({ urgency: "urgent" }));
      expect(level.body.error.code).toBe("URGENCY_SET_BY_POSTER");
      const unknown = await as("pat").put("/notifications/rules/no_such.notice").send(ruleBody());
      expect(unknown.status).toBe(404);
      const noRole = await as("pat").put("/notifications/rules/employee.bank_details_changed").send(ruleBody({ role_codes: ["no_such_role"] }));
      expect(noRole.status).toBe(422);
      expect(noRole.body.error.fields).toHaveProperty("role_codes");
      expect((await as("bola").put("/notifications/rules/employee.bank_details_changed").send(ruleBody())).status).toBe(403);
    });

    test("copies, urgency and default channels reach the fan-out; a person's own switch still wins", async () => {
      const key = "employee.bank_details_changed";
      const saved = await as("pat")
        .put(`/notifications/rules/${key}`)
        .send(ruleBody({ urgency: "urgent", email: false, push: false, role_codes: ["management"], employee_ids: [employeeOf("dayo")] }));
      expect(saved.status).toBe(200);
      expect(saved.body).toMatchObject({ urgency: "urgent", channels: { in_app: true, email: false, push: false }, changed: true });
      expect(saved.body.roles).toEqual([{ code: "management", name: expect.any(String) }]);
      expect(saved.body.people.map((p) => p.employee_id)).toEqual([employeeOf("dayo")]);

      // Dayo turned push on for the category; Pat never chose.
      await q("INSERT INTO notification_preference (user_id, category, channel, enabled) VALUES ($1, 'people', 'push', true)", [userOf("dayo")]);
      const rows = await notify(key, { display_name: "Bola Ade", employee_id: employeeOf("bola") }, { type: "employee", id: employeeOf("bola") });
      const by = new Map(rows.map((r) => [r.user_id, r]));
      expect([...by.keys()].sort()).toEqual([userOf("ceo"), userOf("dayo"), userOf("pat")].sort());
      for (const r of rows) expect(r.urgency).toBe("urgent");
      expect(by.get(userOf("pat")).channels).toEqual(["in_app"]);
      expect(by.get(userOf("dayo")).channels).toEqual(["in_app", "push"]);
      expect(by.get(userOf("ceo")).title).toBe("Bank details changed");

      // Saved back to what the code declares: no rule at all.
      const plain = await as("pat").put(`/notifications/rules/${key}`).send(ruleBody({ email: false, push: true }));
      expect(plain.body).toMatchObject({ changed: false, urgency: "normal" });
      expect(await one("SELECT count(*)::int AS n FROM notification_rule WHERE event_key = $1", [key])).toEqual({ n: 0 });
    });
  });

  describe("the reminders", () => {
    test("defaults, then saved; settings view reads, settings edit saves", async () => {
      const res = await as("ceo").get("/notifications/reminders");
      expect(res.body).toEqual({
        approvals: { enabled: true, every_hours: 24 },
        probation: { enabled: true, days_ahead: 14 },
        digest: { enabled: true, at_time: "07:30" },
      });
      expect((await as("bola").get("/notifications/reminders")).status).toBe(403);
      expect((await as("bola").put("/notifications/reminders").send(res.body)).status).toBe(403);
      const saved = await as("pat")
        .put("/notifications/reminders")
        .send({ ...res.body, probation: { enabled: true, days_ahead: 10 } });
      expect(saved.body.probation).toEqual({ enabled: true, days_ahead: 10 });
      await as("pat").put("/notifications/reminders").send(res.body);
    });

    test("Approvals Waiting: the approvers again after the interval, in working hours, until it is decided", async () => {
      const engine = require("../../src/shared/workflow/engine");
      const dayo = { user_id: userOf("dayo"), employee_id: employeeOf("dayo"), is_ceo: false, role_ids: [] };
      const inst = await tx((c) =>
        engine.openInstance(c, {
          definition_key: "test.threshold",
          entity: { type: "expense", id: `exp-${crypto.randomUUID()}` },
          subject_employee_id: employeeOf("dayo"),
          context: { amount: "1000.00" },
          actor: dayo,
        }),
      );
      await drain();
      const monday9 = lagos.instant("2026-10-12", "09:00");
      await q("UPDATE workflow_instance SET stage_entered_at = $2 WHERE workflow_instance_id = $1", [inst.workflow_instance_id, monday9]);

      const at = (day, time) => lagos.instant(day, time);
      expect(await reminders.tick({ now: at("2026-10-12", "10:00") })).toMatchObject({ found: 1, fired: 0 });
      expect((await reminders.tick({ now: at("2026-10-13", "10:00") })).fired).toBe(1);
      await drain();
      const first = await one(
        "SELECT * FROM notification WHERE event_key = 'workflow.reminded' AND user_id = $1 ORDER BY created_at DESC LIMIT 1",
        [userOf("bola")],
      );
      expect(first).toMatchObject({ title: "Reminder: Threshold Test", body: "Line Manager has waited 25 hours on you.", urgency: "important" });

      // Not again within the interval; after it, outside working hours, it waits for 08:00.
      expect((await reminders.tick({ now: at("2026-10-13", "11:00") })).fired).toBe(0);
      expect(await reminders.tick({ now: at("2026-10-14", "19:00") })).toMatchObject({ fired: 0, moved: 1 });
      const row = await one("SELECT due_at FROM reminder WHERE entity_id = $1", [inst.workflow_instance_id]);
      expect(new Date(row.due_at).toISOString()).toBe(at("2026-10-15", "08:00").toISOString());
      expect((await reminders.tick({ now: at("2026-10-15", "08:05") })).fired).toBe(1);
      await drain();
      const second = await one(
        "SELECT body FROM notification WHERE event_key = 'workflow.reminded' AND user_id = $1 ORDER BY created_at DESC LIMIT 1",
        [userOf("bola")],
      );
      expect(second.body).toBe("Line Manager has waited 2 days on you.");

      // A new interval moves the next reminder; a decided approval ends it.
      await as("pat").put("/notifications/reminders").send({
        approvals: { enabled: true, every_hours: 4 },
        probation: { enabled: true, days_ahead: 14 },
        digest: { enabled: true, at_time: "07:30" },
      });
      const moved = await one("SELECT every_minutes FROM reminder WHERE entity_id = $1", [inst.workflow_instance_id]);
      expect(moved.every_minutes).toBe(240);
      const bola = { user_id: userOf("bola"), employee_id: employeeOf("bola"), is_ceo: false, role_ids: [] };
      await tx((c) => engine.act(c, { instance_id: inst.workflow_instance_id, actor: bola, decision: "approve" }));
      // The new interval counts from the real clock, so the next tick is the next working minute.
      const next = reminders.inWorkHours(new Date(Date.now() + 5 * 60 * 1000));
      expect(await reminders.tick({ now: next })).toMatchObject({ fired: 0, finished: 1 });
      expect(await one("SELECT state FROM reminder WHERE entity_id = $1", [inst.workflow_instance_id])).toEqual({ state: "done" });
    });

    test("Probation Ending: at 09:00 once per date, to People; a new date reminds again; never once confirmed", async () => {
      const dayo = employeeOf("dayo");
      await q("UPDATE employee SET confirmation_due_on = '2026-10-20', confirmed_on = NULL WHERE employee_id = $1", [dayo]);
      const at = (day, time) => lagos.instant(day, time);
      expect(await reminders.tick({ now: at("2026-10-12", "08:00") })).toMatchObject({ found: 1, fired: 0 });
      expect((await reminders.tick({ now: at("2026-10-12", "09:05") })).fired).toBe(1);
      await drain();
      const told = await q("SELECT user_id, title, body FROM notification WHERE event_key = 'employee.probation_ending'");
      expect(told.rows.map((r) => r.user_id)).toContain(userOf("pat"));
      expect(told.rows[0]).toMatchObject({ title: "Probation ending: Dayo Ola", body: "Confirmation is due on 20/10/2026." });
      expect((await reminders.tick({ now: at("2026-10-13", "09:05") })).fired).toBe(0);

      await q("UPDATE employee SET confirmation_due_on = '2026-10-24' WHERE employee_id = $1", [dayo]);
      expect(await reminders.tick({ now: at("2026-10-14", "09:05") })).toMatchObject({ found: 1, fired: 1 });

      await q("UPDATE employee SET confirmation_due_on = '2026-10-27', confirmed_on = '2026-10-14' WHERE employee_id = $1", [dayo]);
      expect(await reminders.tick({ now: at("2026-10-15", "09:05") })).toMatchObject({ found: 0, fired: 0 });
    });
  });

  describe("the daily digest", () => {
    test("queued once a day from its time; lists what arrived unread in the last day; off when the person says so", async () => {
      const now = new Date();
      const threadId = crypto.randomUUID();
      await notify(
        "mail_message.received",
        { mail_thread_id: threadId, user_id: userOf("bola"), from: "Tom-Blake Asaah", subject: "Rota", preview: "Here is next week." },
        { type: "mail_thread", id: threadId },
      );
      const day = lagos.today(now);
      // The reminder tests' ticks ran on other days' clocks and decided those days' digests.
      await q("UPDATE notification_setting SET digest_sent_on = NULL");
      // Before its time nothing is queued; from it, each person once.
      const before = new Date(lagos.instant(day, "07:29").getTime());
      expect((await reminders.tick({ now: before })).digests).toBe(0);
      const after = lagos.instant(day, "07:31");
      const queued = await reminders.tick({ now: after });
      expect(queued.digests).toBeGreaterThanOrEqual(4);
      const calls = queues.enqueue.mock.calls.filter(([queue]) => queue === "reminders");
      expect(calls.find(([, , data]) => data.user_id === userOf("bola"))).toEqual([
        "reminders",
        "digest",
        { user_id: userOf("bola"), day, until: after.toISOString() },
        { jobId: `digest-${userOf("bola")}-${day}` },
      ]);
      expect((await reminders.tick({ now: lagos.instant(day, "08:00") })).digests).toBe(0);

      systemMail.__reset();
      const sent = await reminders.sendDigest({ user_id: userOf("bola"), until: new Date(Date.now() + 1000).toISOString() });
      expect(sent).toMatchObject({ sent: true });
      const mail = systemMail.capturedMail().find((m) => m.template === "digest");
      expect(mail.subject).toMatch(/^Unread in MyCity App: \d+$/);
      expect(mail.html).toContain("Tom-Blake Asaah");

      expect((await as("bola").put("/notifications/preferences/digest").send({ digest: false })).body.settings).toMatchObject({ digest: false, digest_offered: true, digest_at: "07:30" });
      expect(await reminders.sendDigest({ user_id: userOf("bola") })).toEqual({ sent: false, reason: "person_off" });
      expect(await reminders.sendDigest({ user_id: userOf("ceo"), until: new Date(Date.now() - 48 * 3600 * 1000).toISOString() })).toEqual({ sent: false, reason: "nothing_unread" });
    });
  });

  describe("quiet hours", () => {
    test("off until turned on; the same time twice is refused", async () => {
      const prefs = await as("bola").get("/notifications/preferences");
      expect(prefs.body.settings).toMatchObject({ quiet_enabled: false, quiet_from: "21:00", quiet_to: "07:00" });
      const same = await as("bola").put("/notifications/preferences/quiet-hours").send({ quiet_enabled: true, quiet_from: "22:00", quiet_to: "22:00" });
      expect(same.status).toBe(422);
    });

    test("a push waits until they end; an urgent notice goes at once", async () => {
      const now = Date.now();
      const from = lagos.timeOf(new Date(now - 3600 * 1000));
      const to = lagos.timeOf(new Date(now + 3600 * 1000));
      const res = await as("bola").put("/notifications/preferences/quiet-hours").send({ quiet_enabled: true, quiet_from: from, quiet_to: to });
      expect(res.status).toBe(200);
      expect(res.body.settings).toMatchObject({ quiet_enabled: true, quiet_from: from, quiet_to: to });

      const row = (urgency) => ({
        notification_id: crypto.randomUUID(),
        user_id: userOf("bola"),
        category: "comms",
        priority: "normal",
        urgency,
        acknowledge_required: false,
        acknowledged_at: null,
        repeat_count: 0,
        title: "Rota",
        body: "Here is next week.",
        entity_type: "mail_thread",
        entity_id: crypto.randomUUID(),
        channels: ["in_app", "push"],
        created_at: new Date(),
      });
      const normal = row("normal");
      const urgent = row("urgent");
      const job = { data: { event: { key: "mail_message.received" }, notifications: [normal, urgent] }, updateData: async () => undefined };
      expect(await deliver(job)).toMatchObject({ push_queued: 2, push_held: 1 });
      const opts = new Map(queues.enqueue.mock.calls.map(([, , data, o]) => [data.notification_id, o]));
      expect(opts.get(normal.notification_id).delay).toBeGreaterThan(0);
      expect(opts.get(normal.notification_id).delay).toBeLessThanOrEqual(3600 * 1000 + 60 * 1000);
      expect(opts.get(urgent.notification_id).delay).toBeUndefined();
    });
  });
});
