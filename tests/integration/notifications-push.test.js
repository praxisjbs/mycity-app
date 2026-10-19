"use strict";
/**
 * Web push, end to end (docs/guides/notifications.md): the real migrations on a throwaway
 * database, the routes through HTTP, the fan-out drained as the worker would, and the push job
 * against a fake push service. Every response is checked against its contract by route().
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/notifications-push
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
const realtime = require("../../src/services/realtime/emitter");
const active = require("../../src/services/realtime/active");
const webPush = require("../../src/services/push/web-push");
const vapid = require("../../src/services/push/vapid");

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

/** A browser's subscription as PushSubscription.toJSON() gives it, flattened. */
function browser(n) {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    endpoint: `https://push.example.test/send/device-${n}-${crypto.randomBytes(6).toString("hex")}`,
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: crypto.randomBytes(16).toString("base64url"),
  };
}

describeDb("Web push against the real migrations", () => {
  let app;
  let sender;
  let deliver;
  const people = {};
  const tokens = {};
  let ipSeq = 0;
  const nextIp = () => {
    ipSeq += 1;
    return `10.62.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
  };
  const as = (who) => {
    const auth = (r) => r.set("Authorization", `Bearer ${tokens[who]}`).set("X-Forwarded-For", nextIp());
    return {
      get: (path) => auth(request(app).get(`/api/v1${path}`)),
      post: (path) => auth(request(app).post(`/api/v1${path}`)),
      put: (path) => auth(request(app).put(`/api/v1${path}`)),
    };
  };
  const anonymous = (path) => request(app).post(`/api/v1${path}`).set("X-Forwarded-For", nextIp());

  /** The push service: records each send and answers with the status the test sets per endpoint. */
  const sent = [];
  const answers = new Map();
  let restore;

  /** New mail for a person, through the real event and fan-out; returns their notice. */
  async function mailFor(userId, subject) {
    const threadId = crypto.randomUUID();
    await tx((client) =>
      emit(client, {
        key: "mail_message.received",
        entity: { type: "mail_thread", id: threadId },
        actor: null,
        payload: { mail_thread_id: threadId, user_id: userId, from: "Tom-Blake Asaah", subject, preview: "The signed copy is attached." },
      }),
    );
    await drain();
    return one("SELECT * FROM notification WHERE user_id = $1 AND entity_id = $2", [userId, threadId]);
  }

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    sender = require("../../src/modules/notifications/notifications.push");
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
      people.bola = await createAdmin(
        client,
        { employee: sample("Bola", "Ade", "bola@mycity.test", "Content Associate"), role_code: "employee", is_ceo: false },
        PASSWORD,
        { allowAdditional: true },
      );
    });
    await drain();
    for (const who of ["ceo", "bola"]) {
      const res = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", nextIp()).send({ email: `${who}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[who] = res.body.access_token;
    }
    vapid.resetForTest();
    restore = webPush.useTransportForTest(async (subscription, body, options) => {
      sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(body), options });
      const status = answers.get(subscription.endpoint) ?? 201;
      if (status >= 400) {
        const err = new Error(`push service said ${status}`);
        err.statusCode = status;
        err.body = "";
        throw err;
      }
      return { statusCode: status };
    });
  });

  afterAll(async () => {
    restore();
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  beforeEach(() => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    sent.length = 0;
    answers.clear();
    queues.enqueue.mockClear();
  });
  afterEach(() => jest.restoreAllMocks());

  const userOf = (who) => people[who].user.user_id;

  test("signed out: the config needs a session, and a device call with a wrong token is refused", async () => {
    expect((await request(app).get("/api/v1/notifications/push/config")).status).toBe(401);
    const res = await anonymous("/notifications/push/read").send({
      push_subscription_id: crypto.randomUUID(),
      device_token: "x".repeat(43),
      notification_ids: [crypto.randomUUID()],
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("DEVICE_NOT_RECOGNISED");
  });

  test("the environment's key pair is made once, kept encrypted, and its public half handed out", async () => {
    const first = await as("bola").get("/notifications/push/config");
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ enabled: true });
    expect(first.body.public_key).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    const row = await one("SELECT ciphertext FROM integration_secret WHERE provider = 'web_push' AND key = 'vapid'");
    expect(row.ciphertext).not.toContain(first.body.public_key);
    vapid.resetForTest();
    const again = await as("ceo").get("/notifications/push/config");
    expect(again.body.key_id).toBe(first.body.key_id);
  });

  test("a browser is one device: a token once, kept when shown again, and moved to whoever signs in there", async () => {
    const b = browser(1);
    const saved = await as("bola").post("/notifications/push/subscriptions").set("User-Agent", "Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36").send(b);
    expect(saved.status).toBe(200);
    expect(saved.body.label).toBe("Chrome on Android");
    expect(saved.body.device_token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const again = await as("bola")
      .post("/notifications/push/subscriptions")
      .send({ ...b, push_subscription_id: saved.body.push_subscription_id, device_token: saved.body.device_token });
    expect(again.body).toMatchObject({ push_subscription_id: saved.body.push_subscription_id, device_token: null });

    const moved = await as("ceo").post("/notifications/push/subscriptions").send(b);
    expect(moved.body.push_subscription_id).toBe(saved.body.push_subscription_id);
    expect(moved.body.device_token).toBeTruthy();
    expect((await one("SELECT user_id FROM push_subscription WHERE endpoint = $1", [b.endpoint])).user_id).toBe(userOf("ceo"));
    expect((await as("bola").get("/notifications/push/devices")).body.data).toHaveLength(0);
    expect((await as("ceo").get("/notifications/push/devices")).body.data).toHaveLength(1);
  });

  test("preferences: every category with its defaults, one switch saved, Security stays on", async () => {
    const prefs = await as("bola").get("/notifications/preferences");
    expect(prefs.status).toBe(200);
    expect(prefs.body.categories.map((c) => c.category)).toContain("comms");
    expect(prefs.body.categories.find((c) => c.category === "comms")).toMatchObject({ channels: { in_app: true, email: false, push: true } });
    const off = await as("bola").put("/notifications/preferences").send({ category: "comms", channel: "push", enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.categories.find((c) => c.category === "comms").channels.push).toBe(false);
    const locked = await as("bola").put("/notifications/preferences").send({ category: "security", channel: "push", enabled: false });
    expect(locked.status).toBe(422);
    expect(locked.body.error.code).toBe("CATEGORY_LOCKED");
    expect((await as("bola").put("/notifications/preferences").send({ category: "nothing", channel: "push", enabled: false })).status).toBe(404);
    await as("bola").put("/notifications/preferences").send({ category: "comms", channel: "push", enabled: true });
  });

  test("new mail is pushed once per device with the sender, subject and first line; a refusing device is revoked", async () => {
    const live = browser(2);
    const dead = browser(3);
    await as("ceo").post("/notifications/push/subscriptions").send(live);
    await as("ceo").post("/notifications/push/subscriptions").send(dead);
    answers.set(dead.endpoint, 410);

    const notice = await mailFor(userOf("ceo"), "Re: Test mail");
    expect(notice.channels).toEqual(expect.arrayContaining(["in_app", "push"]));
    expect(notice.body).toBe("Re: Test mail\nThe signed copy is attached.");

    const out = await sender.pushNotice(notice.notification_id);
    expect(out.retry).toBe(0);
    const toLive = sent.filter((s) => s.endpoint === live.endpoint);
    expect(toLive).toHaveLength(1);
    expect(toLive[0].payload).toMatchObject({
      v: 1,
      id: notice.notification_id,
      title: "Tom-Blake Asaah",
      body: "Re: Test mail\nThe signed copy is attached.",
      tag: `mail_thread:${notice.entity_id}`,
      mode: "alert",
      category: "comms",
      test: false,
    });
    expect(toLive[0].payload.path).toMatch(/^\/mailbox\?tab=inbox&id=/);
    expect(toLive[0].options).toMatchObject({ urgency: "normal", TTL: 86400 });
    expect(await one("SELECT revoked_reason FROM push_subscription WHERE endpoint = $1", [dead.endpoint])).toEqual({ revoked_reason: "refused" });

    // Again: nothing more goes, the live device has it and the dead one is off. (The CEO also
    // holds the browser moved to them above, which is sent its own copy.)
    sent.length = 0;
    await sender.pushNotice(notice.notification_id);
    expect(sent).toHaveLength(0);
    const log = await q(
      "SELECT s.endpoint, d.status FROM push_delivery d JOIN push_subscription s USING (push_subscription_id) WHERE d.notification_id = $1",
      [notice.notification_id],
    );
    const statusOf = Object.fromEntries(log.rows.map((r) => [r.endpoint, r.status]));
    expect(statusOf).toMatchObject({ [live.endpoint]: "sent", [dead.endpoint]: "gone" });
  });

  test("a busy push service is tried again, and only the device still owed; a notice read meanwhile is skipped", async () => {
    const b = browser(4);
    await as("bola").post("/notifications/push/subscriptions").send(b);
    const notice = await mailFor(userOf("bola"), "Quarterly plan");
    answers.set(b.endpoint, 503);
    const job = require("../../src/jobs/handlers/notification-push");
    await expect(job({ data: { notification_id: notice.notification_id } })).rejects.toThrow(/try again/);
    answers.delete(b.endpoint);
    await job({ data: { notification_id: notice.notification_id } });
    expect(sent.filter((s) => s.endpoint === b.endpoint)).toHaveLength(2);
    expect((await one("SELECT status, attempts FROM push_delivery WHERE notification_id = $1", [notice.notification_id])).status).toBe("sent");

    const later = await mailFor(userOf("bola"), "Read on the laptop");
    await as("bola").post(`/notifications/${later.notification_id}/read`).send({});
    sent.length = 0;
    expect(await sender.pushNotice(later.notification_id)).toEqual({ skipped: "read" });
    expect(sent).toHaveLength(0);
  });

  test("the delivery job queues every push at once, whether or not its person is in the app (TB, 19/10/2026)", async () => {
    jest.spyOn(active, "isActive").mockResolvedValue(true);
    const base = { user_id: userOf("bola"), priority: "normal", title: "Hello", body: null, entity_type: null, entity_id: null, created_at: new Date().toISOString() };
    const rows = [
      { ...base, notification_id: crypto.randomUUID(), category: "comms", channels: ["in_app", "push"] },
      { ...base, notification_id: crypto.randomUUID(), category: "security", channels: ["in_app", "push"] },
    ];
    const out = await deliver({ data: { notifications: rows, event: { key: "x.y" }, push: null }, updateData: jest.fn() });
    expect(out).toMatchObject({ push_queued: 2 });
    const pushes = queues.enqueue.mock.calls.filter((c) => c[0] === "notification-push");
    expect(pushes.map((c) => c[3].jobId)).toEqual(rows.map((r) => `push-${r.notification_id}`));
    for (const c of pushes) expect(c[3].delay).toBeUndefined();
    expect(realtime.toUser).toHaveBeenCalledWith(
      userOf("bola"),
      "notification",
      expect.objectContaining({ notification_id: rows[0].notification_id, read_at: null, urgency: "normal", repeat_count: 0 }),
    );
  });

  /** A change to who can do what: the CEO watches it, so it reaches them as an urgent notice. */
  async function securityNotice() {
    const roleId = crypto.randomUUID();
    await tx((client) =>
      emit(client, {
        key: "role.created",
        entity: { type: "role", id: roleId },
        actor: userOf("bola"),
        payload: { role_id: roleId, name: "Field Auditors" },
      }),
    );
    await drain();
    return one("SELECT * FROM notification WHERE user_id = $1 AND entity_id = $2", [userOf("ceo"), roleId]);
  }

  test("a Security notice is urgent: in the urgent bar until opened; Acknowledge is not for it", async () => {
    const notice = await securityNotice();
    expect(notice).toMatchObject({ urgency: "urgent", acknowledge_required: false, repeat_count: 0 });
    const bar = await as("ceo").get("/notifications/urgent");
    expect(bar.status).toBe(200);
    expect(bar.body.data.map((n) => n.notification_id)).toContain(notice.notification_id);
    expect(bar.body.data.find((n) => n.notification_id === notice.notification_id)).toMatchObject({ urgency: "urgent", acknowledge_required: false });
    expect((await as("ceo").post(`/notifications/${notice.notification_id}/acknowledge`).send({})).status).toBe(422);
    expect((await as("bola").get("/notifications/urgent")).body.data.map((n) => n.notification_id)).not.toContain(notice.notification_id);

    await as("ceo").post(`/notifications/${notice.notification_id}/read`).send({});
    expect((await as("ceo").get("/notifications/urgent")).body.data.map((n) => n.notification_id)).not.toContain(notice.notification_id);
  });

  test("an open urgent notice comes back every 30 minutes from 08:00 to 18:00 Lagos, at most 8 times a day, until opened", async () => {
    const service = require("../../src/modules/notifications/notifications.service");
    const b = browser(8);
    await as("ceo").post("/notifications/push/subscriptions").send(b);
    const notice = await securityNotice();
    const id = notice.notification_id;
    const lagosAt = (day, hhmm) => new Date(`${day}T${hhmm}:00+01:00`);
    const state = () => one("SELECT repeat_count, repeats_on_day, to_char(repeat_day, 'YYYY-MM-DD') AS repeat_day FROM notification WHERE notification_id = $1", [id]);

    expect(await service.repeatUrgent(lagosAt("2026-10-20", "07:55"))).toEqual({ repeated: 0, outside_hours: true });
    expect(await service.repeatUrgent(lagosAt("2026-10-20", "18:00"))).toEqual({ repeated: 0, outside_hours: true });
    await service.repeatUrgent(lagosAt("2026-10-20", "09:00"));
    expect((await state()).repeat_count).toBe(0); // its first alert is not 30 minutes old yet

    await q("UPDATE notification SET created_at = now() - interval '31 minutes' WHERE notification_id = $1", [id]);
    await service.repeatUrgent(lagosAt("2026-10-20", "09:00"));
    expect(await state()).toEqual({ repeat_count: 1, repeats_on_day: 1, repeat_day: "2026-10-20" });
    expect(realtime.toUser).toHaveBeenCalledWith(userOf("ceo"), "notification", expect.objectContaining({ notification_id: id, urgency: "urgent", repeat_count: 1 }));
    const push = queues.enqueue.mock.calls.find((c) => c[0] === "notification-push" && c[2].notification_id === id);
    expect(push[2]).toMatchObject({ round: 1 });
    expect(push[3]).toMatchObject({ jobId: `push-${id}-r1` });
    await service.repeatUrgent(lagosAt("2026-10-20", "09:05"));
    expect((await state()).repeat_count).toBe(1); // not again within 30 minutes

    // The repeat's push reaches every device as round 1, once.
    await sender.pushNotice(id, null, 1);
    await sender.pushNotice(id, null, 1);
    const toDevice = sent.filter((s) => s.endpoint === b.endpoint);
    expect(toDevice).toHaveLength(1);
    expect(toDevice[0].payload).toMatchObject({ id, urgency: "urgent", round: 1 });
    expect(toDevice[0].options.urgency).toBe("high");
    expect(await one("SELECT round, status FROM push_delivery WHERE notification_id = $1", [id])).toEqual({ round: 1, status: "sent" });

    // Eight in a day, then nothing until the next morning, when the count starts again.
    await q("UPDATE notification SET repeats_on_day = 8, last_alert_at = now() - interval '31 minutes' WHERE notification_id = $1", [id]);
    await service.repeatUrgent(lagosAt("2026-10-20", "11:00"));
    expect((await state()).repeat_count).toBe(1);
    await service.repeatUrgent(lagosAt("2026-10-21", "08:05"));
    expect(await state()).toEqual({ repeat_count: 2, repeats_on_day: 1, repeat_day: "2026-10-21" });

    // Opened: no more repeats, and a repeat already queued sends nothing.
    await as("ceo").post(`/notifications/${id}/read`).send({});
    await q("UPDATE notification SET last_alert_at = now() - interval '31 minutes' WHERE notification_id = $1", [id]);
    await service.repeatUrgent(lagosAt("2026-10-21", "09:00"));
    expect((await state()).repeat_count).toBe(2);
    expect(await sender.pushNotice(id, null, 3)).toEqual({ skipped: "read" });
  });

  test("the service worker's calls: Mark Read with its token, renewal with a new endpoint", async () => {
    const b = browser(5);
    const saved = (await as("bola").post("/notifications/push/subscriptions").send(b)).body;
    const notice = await mailFor(userOf("bola"), "Mark me read");
    const proof = { push_subscription_id: saved.push_subscription_id, device_token: saved.device_token };
    expect((await anonymous("/notifications/push/read").send({ ...proof, notification_ids: [notice.notification_id] })).status).toBe(204);
    expect((await one("SELECT read_at FROM notification WHERE notification_id = $1", [notice.notification_id])).read_at).not.toBeNull();

    const fresh = browser(6);
    expect((await anonymous("/notifications/push/renew").send({ ...proof, ...fresh })).status).toBe(204);
    expect((await one("SELECT endpoint FROM push_subscription WHERE push_subscription_id = $1", [saved.push_subscription_id])).endpoint).toBe(fresh.endpoint);
    expect((await anonymous("/notifications/push/renew").send({ ...proof, device_token: "y".repeat(43), ...browser(7) })).status).toBe(403);
  });

  test("read state for the shade, and reading a mail conversation reads its notices", async () => {
    const a = await mailFor(userOf("bola"), "First");
    const b = await mailFor(userOf("bola"), "Second");
    const notifications = require("../../src/modules/notifications/notifications.service");
    await tx((client) => notifications.markReadForRecord(client, { user_id: userOf("bola") }, "mail_thread", a.entity_id));
    const state = await as("bola").get(`/notifications/read-state?ids=${a.notification_id},${b.notification_id}`);
    expect(state.body.read).toEqual([a.notification_id]);
    // Someone else's ids are simply not read for them.
    expect((await as("ceo").get(`/notifications/read-state?ids=${a.notification_id}`)).body.read).toEqual([]);
  });

  test("Send Test goes through the worker to the person's devices, and a device stops when its person is suspended", async () => {
    const test = await as("bola").post("/notifications/push/test").send({});
    expect(test.status).toBe(200);
    expect(test.body.devices).toBeGreaterThan(0);
    await drain();
    expect(queues.enqueue).toHaveBeenCalledWith("notification-push", "test", expect.objectContaining({ test: true, user_id: userOf("bola") }), expect.any(Object));
    await sender.pushTest(userOf("bola"));
    expect(sent.some((s) => s.payload.test === true && s.payload.title === "Test notification")).toBe(true);

    await tx((client) => emit(client, { key: "app_user.suspended", entity: { type: "app_user", id: userOf("bola") }, actor: null, payload: { reason: "test" } }));
    await drain();
    const live = await q("SELECT 1 FROM push_subscription WHERE user_id = $1 AND revoked_at IS NULL", [userOf("bola")]);
    expect(live.rowCount).toBe(0);
    expect((await one("SELECT revoked_reason FROM push_subscription WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1", [userOf("bola")])).revoked_reason).toBe("suspended");
  });
});
