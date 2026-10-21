"use strict";
/**
 * Settings · Integrations end to end (docs/guides/integrations.md): who may open it, the
 * registry as a list, a save that tests first and keeps its secret encrypted and bound to its
 * record, the field a failed test lands on, the rules a secret is held to (a fresh sign-in, a
 * password never sent to a new server), Test, Remove, Replace Keys, a staff mail server change
 * moving every mailbox, and counted use with its daily warning.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/integrations
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public
 * schema. No provider is reached: Geoapify, Gemini, Groq and the exchange rate service answer
 * through a fake fetch, the mail servers through fakes of the sign-in and the TLS check. The keys
 * are invented.
 */
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");

const sent = [];
jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async (queue, name, data, opts) => {
    sent.push({ queue, name, data, opts });
    return { id: String(sent.length) };
  }),
  getQueue: jest.fn(() => ({ getDelayed: async () => [] })),
  closeQueues: jest.fn(async () => {}),
  DEFAULTS: {},
}));

const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const encryption = require("../../src/services/secrets/encryption.service");
const systemMail = require("../../src/services/mail/system-mail.service");
const tlsCheck = require("../../src/services/mail/tls-check");
const geoapify = require("../../src/services/maps/geoapify.service");
const vapid = require("../../src/services/push/vapid");
const settings = require("../../src/shared/integrations/settings");
const usage = require("../../src/shared/integrations/usage");
const service = require("../../src/modules/integrations/integrations.service");
require("../../src/modules/integrations/integrations.events");
require("../../src/modules/mailbox/mailbox.events");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0] || null;

const PASSWORD = { ceo: "Chief#Officer26", ops: "Opera!ions2026", admin: "Admin#Pass2026x" };

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

/** Geoapify as a fake: every answer `status`, or the three calls answered well. */
let geoStatus = 200;
const asked = [];
async function fakeFetch(input) {
  const url = new URL(String(input));
  asked.push(url);
  if (url.hostname === "api.groq.com" && url.pathname.endsWith("/models"))
    return Response.json({
      data: [
        { id: "whisper-large-v3", active: true },
        { id: "llama-3.3-70b-versatile", active: true },
        { id: "playai-tts", active: true },
      ],
    });
  if (url.hostname === "v6.exchangerate-api.com")
    return Response.json({
      result: "success",
      base_code: "USD",
      time_last_update_unix: 1760918401,
      conversion_rates: { USD: 1, NGN: 1534.21, EUR: 0.92, GBP: 0.79 },
    });
  if (geoStatus !== 200) return new Response("{}", { status: geoStatus, headers: { "content-type": "application/json" } });
  if (url.pathname.includes("/autocomplete"))
    return Response.json({ results: [{ place_id: "p1", formatted: "Admiralty Way, Lekki, Lagos", lat: 6.4335, lon: 3.4501 }] });
  if (url.pathname.includes("/reverse")) return Response.json({ results: [{ formatted: "Lekki Phase 1, Lagos" }] });
  if (url.pathname.includes("/tile/")) return new Response(Buffer.from([137, 80, 78, 71]), { status: 200, headers: { "content-type": "image/png" } });
  return new Response("{}", { status: 404 });
}

describeDb("Settings · Integrations against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};

  let ipSeq = 0;
  const nextIp = () => {
    ipSeq += 1;
    return `10.70.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
  };
  const as = (who) => {
    const auth = (r) => r.set("Authorization", `Bearer ${tokens[who]}`).set("X-Forwarded-For", nextIp());
    return {
      get: (path) => auth(request(app).get(`/api/v1${path}`)),
      post: (path) => auth(request(app).post(`/api/v1${path}`)),
      put: (path) => auth(request(app).put(`/api/v1${path}`)),
      delete: (path) => auth(request(app).delete(`/api/v1${path}`)),
    };
  };

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
      work_pattern: "remote",
    });
    const make = (client, who, first, last, email, job, role_code, is_ceo = false) =>
      createAdmin(client, { employee: sample(first, last, email, job), role_code, is_ceo }, PASSWORD[who], { allowAdditional: true });
    await tx(async (client) => {
      people.ceo = await make(client, "ceo", "Amaka", "Eze", "ceo@mycity.test", "Chief Executive Officer", "management", true);
      people.ops = await make(client, "ops", "Ada", "Obi", "ops@mycity.test", "Operations & People Lead", "operations_people");
      people.admin = await make(client, "admin", "Femi", "Bello", "femi@mycity.test", "Systems Officer", "administrator");
    });
    await drain();
    for (const [who, email] of [["ceo", "ceo@mycity.test"], ["ops", "ops@mycity.test"], ["admin", "femi@mycity.test"]]) {
      const res = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", nextIp()).send({ email, password: PASSWORD[who] });
      expect(res.status).toBe(200);
      tokens[who] = res.body.access_token;
    }
    settings.forget();
  });

  beforeEach(() => {
    jest.spyOn(global, "fetch").mockImplementation(fakeFetch);
    geoStatus = 200;
    asked.length = 0;
    geoapify.clearCache();
  });
  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    usage.__reset();
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  const geoSave = (over = {}) => ({ code: "geoapify", api_key: "geo-key-0001-abcd", daily_limit: 3000, saved_at: null, ...over });

  describe("who may open it", () => {
    test("the System Administrator may; Operations & People may not see or change it", async () => {
      expect((await as("admin").get("/integrations")).status).toBe(200);
      expect((await as("ops").get("/integrations")).status).toBe(403);
      expect((await as("ops").get("/integrations/geoapify")).status).toBe(403);
      expect((await as("ops").put("/integrations/geoapify").send(geoSave())).status).toBe(403);
    });

    test("the CEO passes every check", async () => {
      expect((await as("ceo").get("/integrations")).status).toBe(200);
    });
  });

  describe("the list", () => {
    test("every connection of the registry, in its order, with where its values come from", async () => {
      const res = await as("admin").get("/integrations");
      expect(res.status).toBe(200);
      expect(res.body.data.map((r) => r.code)).toEqual([
        "mail_sender",
        "mailbox_server",
        "geoapify",
        "gemini",
        "groq",
        "openai",
        "anthropic",
        "deepseek",
        "exchange_rates",
        "web_push",
      ]);
      const byCode = Object.fromEntries(res.body.data.map((r) => [r.code, r]));
      // The staff mail server always has the file's defaults; nothing is saved yet.
      expect(byCode.mailbox_server).toMatchObject({ source: "file", group: "mail", watched: true });
      if (!config.GEOAPIFY_API_KEY) expect(byCode.geoapify).toMatchObject({ source: "none", state: "not_set" });
      expect(res.body.page.total).toBe(10);
      expect((await as("admin").get("/integrations?group=maps")).body.data.map((r) => r.code)).toEqual(["geoapify"]);
    });

    test("the summary counts every connection by its state, whatever the list's filter", async () => {
      const [list, summary] = await Promise.all([as("admin").get("/integrations"), as("admin").get("/integrations/summary")]);
      expect(summary.status).toBe(200);
      const count = (s) => list.body.data.filter((r) => r.state === s).length;
      expect(summary.body).toEqual({ working: count("ok"), failing: count("failing"), unchecked: count("unchecked"), not_set: count("not_set") });
      expect(Object.values(summary.body).reduce((a, n) => a + n, 0)).toBe(10);
      expect((await as("ops").get("/integrations/summary")).status).toBe(403);
    });
  });

  describe("saving tests first, and keeps a secret encrypted and bound to its row", () => {
    test("a working key is saved; the page shows its last four, never the key", async () => {
      const res = await as("admin").put("/integrations/geoapify").send(geoSave());
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ source: "saved", state: "ok", daily_limit: 3000 });
      expect(res.body.secrets).toEqual([
        expect.objectContaining({ key: "api_key", set: true, hint: "abcd", set_by_name: "Femi Bello" }),
      ]);
      expect(JSON.stringify(res.body)).not.toContain("geo-key-0001");
      // The test ran with the typed key, and its three steps passed.
      expect(asked.every((u) => u.searchParams.get("apiKey") === "geo-key-0001-abcd")).toBe(true);
      expect(res.body.last_check).toMatchObject({ kind: "save", ok: true });
      expect(res.body.last_check.steps.map((s) => s.key)).toEqual(["search", "reverse", "tile"]);

      const row = await one("SELECT ciphertext, hint FROM integration_secret WHERE provider = 'geoapify' AND key = 'api_key'");
      expect(row.ciphertext.startsWith("a1.")).toBe(true);
      expect(row.ciphertext).not.toContain("geo-key");
      expect(encryption.decrypt(row.ciphertext, { aad: "integration_secret:geoapify:api_key" })).toBe("geo-key-0001-abcd");
      // Bound: the same ciphertext read as another record's does not decrypt.
      expect(() => encryption.decrypt(row.ciphertext, { aad: "integration_secret:gemini:api_key" })).toThrow();

      expect(await settings.secret("geoapify", "api_key")).toBe("geo-key-0001-abcd");
    });

    test("the audit row says what changed, and never the key", async () => {
      const audit = await one(
        "SELECT before, after, actor_user_id FROM audit_ledger WHERE action = 'integration.saved' ORDER BY occurred_at DESC LIMIT 1",
      );
      expect(audit.actor_user_id).toBe(people.admin.user.user_id);
      expect(JSON.stringify(audit)).not.toContain("geo-key");
    });

    test("a refused key lands on its field, and nothing is saved", async () => {
      const saved = (await as("admin").get("/integrations/geoapify")).body;
      geoStatus = 401;
      const res = await as("admin").put("/integrations/geoapify").send(geoSave({ api_key: "geo-key-0002-wxyz", saved_at: saved.saved_at }));
      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({ code: "TEST_FAILED", fields: { api_key: ["Key refused"] } });
      settings.forget();
      expect(await settings.secret("geoapify", "api_key")).toBe("geo-key-0001-abcd");
      const failed = await one(
        `SELECT k.ok, k.kind, k.error_code FROM integration_check k
           JOIN integration_connection c ON c.integration_connection_id = k.integration_connection_id
          WHERE c.code = 'geoapify' ORDER BY k.created_at DESC LIMIT 1`,
      );
      expect(failed).toEqual({ ok: false, kind: "save", error_code: "KEY_REFUSED" });
    });

    test("a save over somebody else's newer one is refused", async () => {
      const res = await as("admin").put("/integrations/geoapify").send(geoSave({ saved_at: null }));
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("STALE");
    });

    test("a key typed outside the fresh sign-in window asks the person to confirm it is them", async () => {
      await q("UPDATE user_session SET issued_at = now() - interval '1 hour', reauthenticated_at = NULL WHERE user_id = $1", [
        people.admin.user.user_id,
      ]);
      try {
        const saved = (await as("admin").get("/integrations/geoapify")).body;
        const res = await as("admin").put("/integrations/geoapify").send(geoSave({ api_key: "geo-key-0003-qrst", saved_at: saved.saved_at }));
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("REAUTH_REQUIRED");
        // Changing only the daily limit sends no secret, so it needs no confirming.
        const limit = await as("admin").put("/integrations/geoapify").send({ code: "geoapify", daily_limit: 2500, saved_at: saved.saved_at });
        expect(limit.status).toBe(200);
        expect(limit.body.daily_limit).toBe(2500);
      } finally {
        await q("UPDATE user_session SET issued_at = now() WHERE user_id = $1", [people.admin.user.user_id]);
      }
    });
  });

  describe("the system sender", () => {
    const sender = (over = {}) => ({
      code: "mail_sender",
      host: "mail.example.test",
      port: 465,
      security: "tls",
      username: "no-reply@example.test",
      password: "S3cret pass!",
      from: "MyCity App <no-reply@example.test>",
      reply_to: null,
      per_hour: 40,
      saved_at: null,
      ...over,
    });

    test("is saved after signing in, and its password shows no characters at all", async () => {
      const verify = jest.spyOn(systemMail, "verifyWith").mockResolvedValue(undefined);
      const res = await as("admin").put("/integrations/mail_sender").send(sender());
      expect(res.status).toBe(200);
      expect(res.body.secrets).toEqual([expect.objectContaining({ key: "password", set: true, hint: null })]);
      expect(res.body.settings).toMatchObject({ host: "mail.example.test", security: "tls", per_hour: 40 });
      expect(verify).toHaveBeenLastCalledWith(expect.objectContaining({ host: "mail.example.test" }), "S3cret pass!");
    });

    test("a saved password is never sent to a new server: changing the host needs it again", async () => {
      const verify = jest.spyOn(systemMail, "verifyWith").mockResolvedValue(undefined);
      const saved = (await as("admin").get("/integrations/mail_sender")).body;
      const moved = await as("admin").put("/integrations/mail_sender").send(sender({ host: "evil.example.test", password: undefined, saved_at: saved.saved_at }));
      expect(moved.status).toBe(422);
      expect(moved.body.error).toMatchObject({ code: "SECRET_REQUIRED", fields: { password: ["Type the password again"] } });
      expect(verify).not.toHaveBeenCalled();
      // Same server, a new limit: the saved password is used and kept.
      const same = await as("admin").put("/integrations/mail_sender").send(sender({ per_hour: 30, password: undefined, saved_at: saved.saved_at }));
      expect(same.status).toBe(200);
      expect(verify).toHaveBeenLastCalledWith(expect.objectContaining({ host: "mail.example.test" }), "S3cret pass!");
      expect((await settings.of("mail_sender")).values.per_hour).toBe(30);
    });

    test("a refused password lands on the password field", async () => {
      jest.spyOn(systemMail, "verifyWith").mockImplementation(async (v, password) => {
        if (password !== null) throw Object.assign(new Error("Invalid login: 535 Authentication failed"), { code: "EAUTH", responseCode: 535 });
      });
      const saved = (await as("admin").get("/integrations/mail_sender")).body;
      const res = await as("admin").put("/integrations/mail_sender").send(sender({ password: "wrong", saved_at: saved.saved_at }));
      expect(res.status).toBe(422);
      expect(res.body.error.fields).toEqual({ password: ["Password refused"] });
    });
  });

  describe("testing what is in use", () => {
    test("Geoapify's test runs the typed address and shows what it found", async () => {
      const res = await as("admin").post("/integrations/geoapify/test").send({ address: "Admiralty Way" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ kind: "test", ok: true, checked_by_name: "Femi Bello" });
      expect(res.body.steps[0]).toMatchObject({ key: "search", ok: true, found: ["Admiralty Way, Lekki, Lagos"] });
      expect(asked[0].searchParams.get("text")).toBe("Admiralty Way");
      const checks = await as("admin").get("/integrations/geoapify/checks?kind=test");
      expect(checks.status).toBe(200);
      expect(checks.body.data[0].integration_check_id).toBe(res.body.integration_check_id);
    });

    test("a failing test moves the connection's state, and the readiness check follows it", async () => {
      geoStatus = 403;
      const res = await as("admin").post("/integrations/geoapify/test").send({});
      expect(res.body).toMatchObject({ ok: false, error_code: "KEY_REFUSED" });
      const row = (await as("admin").get("/integrations")).body.data.find((r) => r.code === "geoapify");
      expect(row).toMatchObject({ state: "failing", last_error_code: "KEY_REFUSED" });
      const { runChecks } = require("../../src/http/health");
      const { checks } = await runChecks();
      expect(checks.maps).toMatchObject({ status: "degraded", error: "KEY_REFUSED" });
      geoStatus = 200;
      await as("admin").post("/integrations/geoapify/test").send({});
      expect((await runChecks()).checks.maps.status).toBe("up");
    });
  });

  describe("counted use and the daily limit", () => {
    test("real calls are counted per day and kind, and IT is warned once at 80%", async () => {
      // Under the limit the search box's calls count, from memory to the database.
      await geoapify.searchPlaces("Adeola Odeku Street");
      await geoapify.tile(15, 16695, 15797);
      await usage.flush();
      const row = (await as("admin").get("/integrations")).body.data.find((r) => r.code === "geoapify");
      expect(row.units_today).toBeGreaterThanOrEqual(1.25);

      const saved = (await as("admin").get("/integrations/geoapify")).body;
      expect((await as("admin").put("/integrations/geoapify").send({ code: "geoapify", daily_limit: 5, saved_at: saved.saved_at })).status).toBe(200);
      for (let i = 0; i < 6; i += 1) usage.record("geoapify", "search", { ok: true });
      await usage.flush();
      expect((await service.watch()).warned).toBe(1);
      expect((await service.watch()).warned).toBe(0);
      await drain();
      const told = await q(
        `SELECT e.work_email FROM notification n
           JOIN app_user u ON u.user_id = n.user_id
           JOIN employee e ON e.employee_id = u.employee_id
          WHERE n.event_key = 'integration.quota_warning'`,
      );
      expect(told.rows.map((r) => r.work_email)).toEqual(["femi@mycity.test"]);
    });

  });

  describe("removing what was saved", () => {
    test("the server file applies again, and the key is gone", async () => {
      expect((await as("admin").delete("/integrations/geoapify")).status).toBe(204);
      const res = await as("admin").get("/integrations/geoapify");
      expect(res.body.source).toBe(config.GEOAPIFY_API_KEY ? "file" : "none");
      expect(await one("SELECT 1 FROM integration_secret WHERE provider = 'geoapify'")).toBeNull();
      expect((await as("admin").delete("/integrations/geoapify")).status).toBe(404);
    });
  });

  describe("web push keys", () => {
    test("Replace Keys makes a new pair that every process reads at once", async () => {
      const before = await vapid.keys();
      const res = await as("admin").post("/integrations/web_push/replace-keys").send({});
      expect(res.status).toBe(200);
      expect(res.body.settings.key_id).not.toBe(before.keyId);
      expect((await vapid.keys()).keyId).toBe(res.body.settings.key_id);
      expect(res.body.secrets[0]).toMatchObject({ key: "vapid", set: true, hint: res.body.settings.key_id });
    });
  });

  describe("AI connections, their model lists, and exchange rates", () => {
    const quota = require("../../src/shared/integrations/quota");
    const fx = require("../../src/shared/money/fx");

    test("a list starts from the seed; saving Groq's key reads its own list, marks what it can use, adds the rest", async () => {
      const seeded = await as("admin").get("/integrations/groq/models");
      expect(seeded.status).toBe(200);
      expect(seeded.body.data.map((m) => [m.model, m.source, m.available])).toEqual([
        ["whisper-large-v3", "seed", null],
        ["whisper-large-v3-turbo", "seed", null],
      ]);
      const res = await as("admin")
        .put("/integrations/groq")
        .send({ code: "groq", api_key: "gsk_test_key_0001", daily_limit: 23040, plan: "free", saved_at: null });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ plan: "free", daily_limit: 23040, state: "ok", source: "saved" });
      expect(res.body.settings).toMatchObject({
        code: "groq",
        in_use: [{ job: "transcription", position: 1, model: "whisper-large-v3" }],
        models: 3,
        available: 2,
      });
      expect(res.body.last_check.steps.map((st) => st.key)).toEqual(["key", "models"]);
      const list = (await as("admin").get("/integrations/groq/models")).body.data;
      const by = Object.fromEntries(list.map((m) => [m.model, m]));
      expect(by["whisper-large-v3"]).toMatchObject({ available: true, source: "seed", usd_per_audio_hour: "0.1110" });
      expect(by["whisper-large-v3"].in_use).toEqual([expect.objectContaining({ job: "transcription", position: 1 })]);
      // Not on this key's list any more; speech out is no use to the ERP and is left off.
      expect(by["whisper-large-v3-turbo"].available).toBe(false);
      expect(by["llama-3.3-70b-versatile"]).toMatchObject({ source: "provider", available: true, capabilities: ["text"] });
      expect(by["playai-tts"]).toBeUndefined();
      expect((await as("admin").get("/integrations/groq/models?available=false")).body.data.map((m) => m.model)).toEqual([
        "whisper-large-v3-turbo",
      ]);
      expect((await as("ops").get("/integrations/groq/models")).status).toBe(403);
    });

    test("Add Model keeps a model with its own endpoint; Anthropic takes Sonnet and Haiku only; only an added model comes off", async () => {
      const added = await as("admin")
        .post("/integrations/gemini/models")
        .send({ model: "gemini-custom-1", display_name: "", capabilities: ["text", "image"], endpoint_url: "https://proxy.test/v1" });
      expect(added.status).toBe(200);
      expect(added.body).toMatchObject({ source: "added", display_name: "gemini-custom-1", endpoint_url: "https://proxy.test/v1", added_by_name: "Femi Bello" });
      const again = await as("admin").post("/integrations/gemini/models").send({ model: "gemini-custom-1", capabilities: ["text"] });
      expect(again.status).toBe(409);
      expect(again.body.error.fields).toEqual({ model: ["Already on the list"] });
      const opus = await as("admin").post("/integrations/anthropic/models").send({ model: "claude-opus-5-5", capabilities: ["text"] });
      expect(opus.status).toBe(422);
      expect(opus.body.error.fields).toEqual({ model: ["Sonnet or Haiku only"] });
      expect((await as("admin").post("/integrations/mail_sender/models").send({ model: "x1", capabilities: ["text"] })).status).toBe(404);
      const seed = (await as("admin").get("/integrations/gemini/models")).body.data.find((m) => m.source === "seed");
      expect((await as("admin").delete(`/integrations/gemini/models/${seed.ai_model_id}`)).status).toBe(404);
      expect((await as("admin").delete(`/integrations/gemini/models/${added.body.ai_model_id}`)).status).toBe(204);
      const audit = await q("SELECT action FROM audit_ledger WHERE action LIKE 'integration.model_%' ORDER BY occurred_at");
      expect(audit.rows.map((r) => r.action)).toEqual(["integration.model_added", "integration.model_removed"]);
    });

    test("saving the rate key keeps today's table; the job fetches only while it is missing; Sync Rates always does", async () => {
      const res = await as("admin")
        .put("/integrations/exchange_rates")
        .send({ code: "exchange_rates", api_key: "fx-key-0001-abcd", daily_limit: 40, saved_at: null });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ group: "finance", plan: "free" });
      expect(res.body.settings).toMatchObject({ code: "exchange_rates", base: "USD", usd_ngn: "1534.2100000000", currencies: 4 });
      expect(res.body.last_check.steps[0].found).toEqual(["1 USD = ₦1,534.21", "4 currencies"]);
      // The key went as a bearer token, never in the address.
      expect(asked.filter((u) => u.hostname === "v6.exchangerate-api.com").map((u) => u.pathname)).toEqual(["/v6/latest/USD"]);
      expect(await fx.rate("USD", "NGN")).toBe("1534.21");
      expect(await fx.rate("EUR", "NGN")).toBe("1667.6195652174");
      expect(await fx.rate("NGN", "NGN")).toBe("1");
      expect(await fx.rate("USD", "XYZ")).toBeNull();
      asked.length = 0;
      expect(await service.syncRates(null)).toBeNull();
      expect(asked).toHaveLength(0);
      const sync = await as("admin").post("/integrations/exchange_rates/sync").send({});
      expect(sync.status).toBe(200);
      expect(sync.body).toMatchObject({ kind: "sync", ok: true, checked_by_name: "Femi Bello" });
      const { checks } = await require("../../src/http/health").runChecks();
      expect(checks.exchange_rates).toMatchObject({ status: "up" });
    });

    test("on the Free plan the daily limit is a hard stop; on Paid it never stops a call", async () => {
      quota.forget();
      expect(await quota.spent("groq")).toBe(false);
      usage.record("groq", "transcribe", { ok: true, units: 23040 });
      expect(await quota.spent("groq")).toBe(true);
      await usage.flush();
      quota.forget();
      expect(await quota.spent("groq")).toBe(true);
      expect(await quota.spent("gemini")).toBe(false);
      expect(await quota.spent("mail_sender")).toBe(false);
    });

    test("an AI provider past 80% warns nobody (ai-control.md decision 26)", async () => {
      const saved = (await as("admin").get("/integrations/groq")).body;
      expect((await as("admin").put("/integrations/groq").send({ code: "groq", daily_limit: 100, plan: "free", saved_at: saved.saved_at })).status).toBe(200);
      usage.record("groq", "transcribe", { ok: true, units: 95 });
      await usage.flush();
      expect((await as("admin").get("/integrations")).body.data.find((r) => r.code === "groq").units_today).toBeGreaterThanOrEqual(95);
      expect((await service.watch()).warned).toBe(0);
      expect(await one("SELECT count(*)::int AS n FROM event_log WHERE event_key = 'integration.quota_warning' AND payload->>'code' = 'groq'")).toEqual({ n: 0 });
    });
  });

  describe("a change of staff mail server", () => {
    test("moves every mailbox to it and syncs each with its saved password", async () => {
      jest.spyOn(tlsCheck, "check").mockResolvedValue({ greeting: "* OK ready" });
      const secret = await one(
        `INSERT INTO integration_secret (provider, key, ciphertext) VALUES ('mailbox', 'mail_conn:test', $1) RETURNING integration_secret_id`,
        [encryption.encrypt("pw")],
      );
      const account = await one(
        `INSERT INTO mail_account (user_id, email, incoming_protocol, incoming_host, incoming_port, outgoing_host, outgoing_port, username, integration_secret_id, tls, status)
         VALUES ($1, 'femi@mycity.test', 'imap', 'mycity.test', 993, 'mycity.test', 465, 'femi@mycity.test', $2, true, 'connected')
         RETURNING mail_account_id`,
        [people.admin.user.user_id, secret.integration_secret_id],
      );
      sent.length = 0;
      const res = await as("admin").put("/integrations/mailbox_server").send({
        code: "mailbox_server",
        imap_host: "mail.newhost.test",
        imap_port: 993,
        smtp_host: "mail.newhost.test",
        smtp_port: 465,
        per_person_per_hour: 50,
        sync_every_min: 3,
        live_connections: 4,
        saved_at: null,
      });
      expect(res.status).toBe(200);
      await drain();
      const moved = await one("SELECT incoming_host, outgoing_host, status FROM mail_account WHERE mail_account_id = $1", [account.mail_account_id]);
      expect(moved).toEqual({ incoming_host: "mail.newhost.test", outgoing_host: "mail.newhost.test", status: "connected" });
      expect(sent.filter((j) => j.queue === "mail-sync").map((j) => j.data.mail_account_id)).toContain(account.mail_account_id);
    });
  });
});
