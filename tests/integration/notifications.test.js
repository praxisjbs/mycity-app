"use strict";
/**
 * The bell, end to end: the real migrations on a throwaway database, the whole app
 * through HTTP, the outbox drained as the worker would. Real notices come from the
 * fan-out (a password change); the edge cases (another person's row, an email-only
 * row, a record the reader cannot open, a second page) are rows written here.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/notifications
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the
 * public schema.
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
const realtime = require("../../src/services/realtime/emitter");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

const CEO_PASSWORD = "Chief#Officer26";
const STAFF_PASSWORD = "Brand-new9Pass";

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

let seq = 0;
/** A bell row as the fan-out writes it, minutes ago (later rows are newer). */
async function notify(userId, { title, entity_type = null, entity_id = null, channels = ["in_app"], read = false } = {}) {
  seq += 1;
  const ev = await one(
    `INSERT INTO event_log (event_key, module_key, entity_type, entity_id, payload)
     VALUES ('test.happened', 'settings', $1, $2, '{}') RETURNING event_id`,
    [entity_type || "test", entity_id || String(seq)],
  );
  return one(
    `INSERT INTO notification (user_id, event_id, event_key, category, title, body, entity_type, entity_id,
                               channels, read_at, created_at)
     VALUES ($1, $2, 'test.happened', 'system', $3, 'What happened.', $4, $5, $6::text[],
             CASE WHEN $7 THEN now() END, now() - make_interval(mins => 1000 - $8::int))
     RETURNING notification_id`,
    [userId, ev.event_id, title || `Notice ${seq}`, entity_type, entity_id, channels, read, seq],
  );
}

describeDb("the bell against the real migrations", () => {
  let app;
  const people = {};
  let ipSeq = 0;
  const nextIp = () => {
    ipSeq += 1;
    return `10.40.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
  };

  async function tokenOf(email, password) {
    const res = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", nextIp()).send({ email, password });
    expect(res.status).toBe(200);
    return res.body.access_token;
  }
  const as = (token) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${token}`),
    post: (path) => request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${token}`),
  });

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));

    const sample = (first, last, email, job) => ({
      first_name: first,
      last_name: last,
      work_email: email,
      phone: "08031234567",
      job_title: job,
      department_name: "HR & Operations",
      start_date: "2026-01-05",
      employment_type: "full_time",
      work_pattern: "on_site",
    });
    await tx(async (client) => {
      people.ceo = await createAdmin(
        client,
        { employee: sample("Amaka", "Eze", "ceo@mycity.test", "Chief Executive Officer"), role_code: "management", is_ceo: true },
        CEO_PASSWORD,
      );
      people.staff = await createAdmin(
        client,
        { employee: sample("Bola", "Ade", "bola@mycity.test", "Content Associate"), role_code: "employee", is_ceo: false },
        STAFF_PASSWORD,
      );
    });
    await drain();
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  afterEach(() => jest.restoreAllMocks());

  test("signed out, the bell answers 401", async () => {
    expect((await request(app).get("/api/v1/notifications")).status).toBe(401);
    expect((await request(app).post("/api/v1/notifications/read-all").send({})).status).toBe(401);
  });

  test("a real notice reaches the bell: a password change, linked to My Security", async () => {
    const token = await tokenOf("bola@mycity.test", STAFF_PASSWORD);
    const changed = await as(token).post("/auth/password").send({ current_password: STAFF_PASSWORD, new_password: "Another-pass9" });
    expect(changed.status).toBe(200);
    await drain();

    const me = as(await tokenOf("bola@mycity.test", "Another-pass9"));
    const list = await me.get("/notifications");
    expect(list.status).toBe(200);
    const row = list.body.data.find((n) => n.title === "Your password was changed");
    expect(row).toMatchObject({
      category: "security",
      priority: "high",
      read_at: null,
      entity_type: "account",
      entity_id: people.staff.user.user_id,
      link: { module: "ess", tab: "my-security", path: `/ess?tab=my-security&id=${people.staff.user.user_id}` },
    });
    expect((await me.get("/notifications/unread-count")).body.unread).toBeGreaterThanOrEqual(1);
  });

  describe("reading and marking", () => {
    let staff;
    let ceo;
    let staffId;
    let ceoId;

    beforeAll(async () => {
      staffId = people.staff.user.user_id;
      ceoId = people.ceo.user.user_id;
      await q("UPDATE notification SET read_at = now()");
      staff = as(await tokenOf("bola@mycity.test", "Another-pass9"));
      ceo = as(await tokenOf("ceo@mycity.test", CEO_PASSWORD));
    });

    test("only the caller's own bell rows, newest first, links only to modules the reader may open", async () => {
      const mine = await notify(staffId, { title: "About my account", entity_type: "account", entity_id: staffId });
      await notify(staffId, { title: "About a login", entity_type: "app_user", entity_id: ceoId });
      await notify(staffId, { title: "Email only", channels: ["email"] });
      await notify(ceoId, { title: "The CEO's own", entity_type: "app_user", entity_id: staffId });

      const res = await staff.get("/notifications?status=unread");
      expect(res.status).toBe(200);
      expect(res.body.data.map((n) => n.title)).toEqual(["About a login", "About my account"]);
      expect(res.body.data[0].link).toBeNull(); // Settings · Users: Staff cannot open it
      expect(res.body.data[1].notification_id).toBe(mine.notification_id);
      expect(res.body.data[1].link.path).toBe(`/ess?tab=my-security&id=${staffId}`);

      const theirs = await ceo.get("/notifications?status=unread");
      expect(theirs.body.data.map((n) => n.title)).toEqual(["The CEO's own"]);
      expect(theirs.body.data[0].link).toEqual({ module: "settings", tab: "users", path: `/settings?tab=users&id=${staffId}` });

      expect((await staff.get("/notifications/unread-count")).body).toEqual({ unread: 2 });
    });

    test("badges count unread rows per module and tab the reader may open", async () => {
      expect((await staff.get("/notifications/badges")).body).toEqual({ modules: { ess: 1 }, tabs: { ess: { "my-security": 1 } } });
      expect((await ceo.get("/notifications/badges")).body).toEqual({ modules: { settings: 1 }, tabs: { settings: { users: 1 } } });
    });

    test("a module's count splits by the tab its notices open on; a list's rows are marked, and opening one reads it", async () => {
      const [leaveA, leaveB, person, other] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
      await notify(ceoId, { title: "Leave request", entity_type: "leave_request", entity_id: leaveA });
      await notify(ceoId, { title: "Leave request, a reminder", entity_type: "leave_request", entity_id: leaveA });
      await notify(ceoId, { title: "Another leave request", entity_type: "leave_request", entity_id: leaveB });
      await notify(ceoId, { title: "Probation ending", entity_type: "employee", entity_id: person });
      const mine = await notify(staffId, { title: "Your leave", entity_type: "leave_request", entity_id: leaveB });

      const before = (await ceo.get("/notifications/badges")).body;
      expect(before.modules.people).toBe(4);
      expect(before.tabs.people).toEqual({ leave: 3, employees: 1 });
      // Staff cannot open People: their own leave counts where it opens for them, Self-Service · My Leave.
      expect((await staff.get("/notifications/badges")).body).toEqual({
        modules: { ess: 2 },
        tabs: { ess: { "my-security": 1, "my-leave": 1 } },
      });

      const leaveMarks = await ceo.get(`/notifications/unread-records?module=people&tab=leave&ids=${leaveA},${leaveB},${other},${person}`);
      expect(leaveMarks.status).toBe(200);
      expect(leaveMarks.body.ids.sort()).toEqual([leaveA, leaveB].sort());
      expect((await ceo.get(`/notifications/unread-records?module=people&tab=employees&ids=${person},${leaveA}`)).body).toEqual({ ids: [person] });
      expect((await staff.get(`/notifications/unread-records?module=people&tab=leave&ids=${leaveB}`)).body).toEqual({ ids: [] });
      expect((await staff.get(`/notifications/unread-records?module=ess&tab=my-leave&ids=${leaveB}`)).body).toEqual({ ids: [leaveB] });
      expect((await ceo.get("/notifications/unread-records?module=people&tab=leave&ids=not-a-uuid")).status).toBe(422);

      const told = jest.spyOn(realtime, "toUser").mockReturnValue(true);
      expect((await ceo.post("/notifications/read-record").send({ module: "people", tab: "leave", entity_id: leaveA })).status).toBe(204);
      const after = (await ceo.get("/notifications/badges")).body;
      expect(after.modules.people).toBe(2);
      expect(after.tabs.people).toEqual({ leave: 1, employees: 1 });
      await drain();
      expect(told).toHaveBeenCalledWith(ceoId, "notification_read", expect.objectContaining({ notification_id: expect.any(String) }));

      // Opened on a screen its notices do not open on, nothing is read; nor is another person's notice.
      expect((await ceo.post("/notifications/read-record").send({ module: "people", tab: "employees", entity_id: leaveB })).status).toBe(204);
      expect((await ceo.get("/notifications/badges")).body.tabs.people).toEqual({ leave: 1, employees: 1 });
      expect((await one("SELECT read_at FROM notification WHERE notification_id = $1", [mine.notification_id])).read_at).toBeNull();
      expect((await staff.post("/notifications/read-record").send({ module: "ess", tab: "my-leave", entity_id: leaveB })).status).toBe(204);
      expect((await one("SELECT read_at FROM notification WHERE notification_id = $1", [mine.notification_id])).read_at).not.toBeNull();
      expect((await staff.get("/notifications/badges")).body.tabs.ess["my-leave"]).toBeUndefined();
      expect((await ceo.post("/notifications/read-record").send({ module: "people", tab: "leave", entity_id: "nope" })).status).toBe(422);
    });

    test("inside a tab, each view counts the notices about the records it holds, and those below it; reading a record leaves them (§6, Where it waits)", async () => {
      const [card, set, plan] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
      await notify(ceoId, { title: "Scorecard to agree", entity_type: "scorecard", entity_id: card });
      await notify(ceoId, { title: "Scorecard, a reminder", entity_type: "scorecard", entity_id: card });
      await notify(ceoId, { title: "Commitments sent", entity_type: "commitment_set", entity_id: set });
      await notify(ceoId, { title: "Commitments, read", entity_type: "commitment_set", entity_id: set, read: true });
      const urgent = await notify(ceoId, { title: "Improvement plan started", entity_type: "improvement_plan", entity_id: plan, read: true });
      await q("UPDATE notification SET urgency = 'urgent', acknowledge_required = true WHERE notification_id = $1", [urgent.notification_id]);

      const targets = await ceo.get("/notifications/views?module=performance&tab=targets");
      expect(targets.status).toBe(200);
      expect(targets.body).toEqual({ views: { scorecards: { unread: 2, urgent: false }, commitments: { unread: 1, urgent: false } } });
      // Read but not yet acknowledged, an urgent notice is still open there: red, with nothing unread.
      expect((await ceo.get("/notifications/views?module=performance&tab=reviews")).body).toEqual({ views: { pips: { unread: 0, urgent: true } } });
      // A screen nobody's records wait on, and another person's screen, place nothing.
      expect((await ceo.get("/notifications/views?module=people&tab=organogram")).body).toEqual({ views: {} });
      expect((await staff.get("/notifications/views?module=performance&tab=targets")).body).toEqual({ views: {} });
      expect((await ceo.get("/notifications/views?module=performance&tab=Not%20A%20Tab")).status).toBe(422);

      expect((await ceo.post("/notifications/read-record").send({ module: "performance", tab: "targets", entity_id: card })).status).toBe(204);
      expect((await ceo.get("/notifications/views?module=performance&tab=targets")).body).toEqual({ views: { commitments: { unread: 1, urgent: false } } });
    });

    test("marking one read: recorded once, other tabs told, and another person's row is a 404", async () => {
      const row = await notify(staffId, { title: "Read me" });
      const others = await notify(ceoId, { title: "Not yours" });
      const told = jest.spyOn(realtime, "toUser").mockReturnValue(true);

      expect((await staff.post(`/notifications/${row.notification_id}/read`).send({})).status).toBe(204);
      expect((await staff.post(`/notifications/${row.notification_id}/read`).send({})).status).toBe(204);
      const after = await one("SELECT read_at FROM notification WHERE notification_id = $1", [row.notification_id]);
      expect(after.read_at).not.toBeNull();
      const events = await one(
        "SELECT count(*)::int AS n FROM event_log WHERE event_key = 'notification.read' AND entity_id = $1",
        [row.notification_id],
      );
      expect(events.n).toBe(1);
      const audit = await one("SELECT actor_user_id FROM audit_ledger WHERE action = 'notification.read' AND entity_id = $1", [row.notification_id]);
      expect(audit.actor_user_id).toBe(staffId);

      await drain();
      expect(told).toHaveBeenCalledWith(staffId, "notification_read", { notification_id: row.notification_id });

      expect((await staff.post(`/notifications/${others.notification_id}/read`).send({})).status).toBe(404);
      expect((await one("SELECT read_at FROM notification WHERE notification_id = $1", [others.notification_id])).read_at).toBeNull();
      expect((await staff.post("/notifications/not-a-uuid/read").send({})).status).toBe(404);
    });

    test("read and unread filter the list", async () => {
      const read = await staff.get("/notifications?status=read");
      expect(read.body.data.some((n) => n.title === "Read me")).toBe(true);
      expect(read.body.data.every((n) => n.read_at !== null)).toBe(true);
      const unread = await staff.get("/notifications?status=unread");
      expect(unread.body.data.every((n) => n.read_at === null)).toBe(true);
      expect((await staff.get("/notifications?status=maybe")).status).toBe(422);
    });

    test("mark all read touches only the caller's unread bell rows, and records nothing when there are none", async () => {
      const emailOnly = await notify(staffId, { title: "Mail only", channels: ["email"] });
      const ceoUnread = await one("SELECT count(*)::int AS n FROM notification WHERE user_id = $1 AND read_at IS NULL", [ceoId]);

      expect((await staff.post("/notifications/read-all").send({})).status).toBe(204);
      expect((await staff.get("/notifications/unread-count")).body).toEqual({ unread: 0 });
      expect((await staff.get("/notifications/badges")).body).toEqual({ modules: {}, tabs: {} });
      expect((await one("SELECT read_at FROM notification WHERE notification_id = $1", [emailOnly.notification_id])).read_at).toBeNull();
      expect((await one("SELECT count(*)::int AS n FROM notification WHERE user_id = $1 AND read_at IS NULL", [ceoId])).n).toBe(ceoUnread.n);

      const recorded = await one(
        "SELECT count(*)::int AS n FROM event_log WHERE event_key = 'notification.read_all' AND entity_id = $1",
        [staffId],
      );
      expect(recorded.n).toBe(1);
      expect((await staff.post("/notifications/read-all").send({})).status).toBe(204);
      const again = await one(
        "SELECT count(*)::int AS n FROM event_log WHERE event_key = 'notification.read_all' AND entity_id = $1",
        [staffId],
      );
      expect(again.n).toBe(1);
    });

    test("the bell pages at 25", async () => {
      await q("DELETE FROM notification WHERE user_id = $1", [staffId]);
      for (let i = 0; i < 30; i += 1) await notify(staffId, { title: `Bulk ${i}` });
      const first = await staff.get("/notifications");
      expect(first.body.data).toHaveLength(25);
      expect(first.body.page).toMatchObject({ number: 1, size: 25, total: 30, pages: 2, has_next: true });
      expect(first.body.data[0].title).toBe("Bulk 29");
      const second = await staff.get("/notifications?page=2");
      expect(second.body.data.map((n) => n.title)).toEqual(["Bulk 4", "Bulk 3", "Bulk 2", "Bulk 1", "Bulk 0"]);
    });
  });
});
