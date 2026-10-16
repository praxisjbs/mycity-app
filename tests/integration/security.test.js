"use strict";
/**
 * Two-step sign-in, passkeys and the PIN, end to end: the real migrations on a
 * throwaway database, the whole app through HTTP, the outbox drained as the worker
 * would. Passkeys are made and used by a software authenticator
 * (tests/helpers/soft-authenticator.js), so every WebAuthn check runs for real; only
 * the phone's fingerprint is simulated.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/security
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the
 * public schema.
 */
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => {}),
  DEFAULTS: {},
}));

const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const mfa = require("../../src/modules/security/security.mfa");
const { softAuthenticator } = require("../helpers/soft-authenticator");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

// None contains the name part of its email.
const OPS_PASSWORD = "Opera!ions2026";
const CEO_PASSWORD = "Chief#Officer26";
const STAFF_PASSWORD = "Brand-new9Pass";

const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

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

const sidOf = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url")).sid;

/** The session last proved who it is `minutes` ago. */
const provedAgo = (token, minutes) =>
  q(
    `UPDATE user_session SET issued_at = now() - make_interval(mins => $2), reauthenticated_at = NULL
      WHERE session_id = $1`,
    [sidOf(token), minutes],
  );

/** The last code this person used was a minute ago, so the current one is new. */
const aMinuteLater = (email) =>
  q("UPDATE app_user SET mfa_last_step = mfa_last_step - 2 WHERE email = $1 AND mfa_last_step IS NOT NULL", [email]);

/** The notices a person was given for one event key, oldest first. */
async function noticesFor(email, key) {
  const r = await q(
    `SELECT n.title, n.body, n.channels FROM notification n JOIN app_user u ON u.user_id = n.user_id
      WHERE u.email = $1 AND n.event_key = $2 ORDER BY n.created_at`,
    [email, key],
  );
  return r.rows;
}

const countEvents = async (key, userId) =>
  (await one("SELECT count(*)::int AS n FROM event_log WHERE event_key = $1 AND entity_id = $2", [key, userId])).n;

describeDb("two-step sign-in, passkeys and the PIN against the real migrations", () => {
  let app;
  const people = {};

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));

    const sample = (first, last, email, job, extra = {}) => ({
      first_name: first,
      last_name: last,
      work_email: email,
      phone: "08031234567",
      job_title: job,
      department_name: "HR & Operations",
      start_date: "2026-01-05",
      employment_type: "full_time",
      work_pattern: "remote",
      ...extra,
    });
    await tx(async (client) => {
      people.ceo = await createAdmin(
        client,
        {
          employee: sample("Ifeoma", "Mbonu", "ceo@mycity.test", "Chief Executive Officer", { date_of_birth: "1988-07-24" }),
          role_code: "management",
          is_ceo: true,
        },
        CEO_PASSWORD,
      );
      people.ops = await createAdmin(
        client,
        { employee: sample("Ada", "Obi", "ops@mycity.test", "Operations & People Lead"), role_code: "operations_people", is_ceo: false },
        OPS_PASSWORD,
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

  // Each request comes from its own address, so the per-address limits never decide a test.
  let ipSeq = 0;
  const nextIp = () => {
    ipSeq += 1;
    return `10.30.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
  };
  const post = (agent, path) => agent.post(`/api/v1${path}`).set("X-Forwarded-For", nextIp());
  const as = (token) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${token}`),
    post: (path) => request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${token}`),
  });

  /** The password step, on a browser of its own unless one is given. */
  async function passwordStep(email, password, agent = request.agent(app), ua = undefined) {
    const r = post(agent, "/auth/login");
    if (ua) r.set("User-Agent", ua);
    const res = await r.send({ email, password });
    return { res, agent };
  }

  /** Signed in all the way: the password, then the code when one is asked for. */
  async function signIn(email, password, { key = null, agent = request.agent(app), ua } = {}) {
    const first = await passwordStep(email, password, agent, ua);
    if (first.res.body.step !== "code") return { res: first.res, agent, token: first.res.body.access_token };
    if (!key) throw new Error(`${email} was asked for a code and the test has no key`);
    await aMinuteLater(email);
    const res = await post(agent, "/auth/two-step").send({
      challenge_token: first.res.body.challenge_token,
      code: mfa.codeAt(key),
    });
    return { res, agent, token: res.body.access_token };
  }

  const methodOf = async (token) =>
    (await one("SELECT method FROM user_session WHERE session_id = $1", [sidOf(token)])).method;

  /* ------------------------------------------------------------------ */

  describe("two-step sign-in", () => {
    const email = "ops@mycity.test";
    let key;
    let codes;
    let opsId;

    beforeAll(() => {
      opsId = people.ops.user.user_id;
    });

    test("set-up waits for a valid code: a wrong one changes nothing, the right one turns it on", async () => {
      const { token } = await signIn(email, OPS_PASSWORD);
      const me = as(token);

      const before = await me.get("/security");
      expect(before.status).toBe(200);
      expect(before.body.two_step).toEqual({ on: false, mfa_frequency: "daily", mfa_enrolled_at: null, recovery_codes_left: 0 });
      expect(before.body.confirmed_for).toBeGreaterThan(14 * 60);

      const setup = await me.post("/security/two-step/setup").send({});
      expect(setup.status).toBe(200);
      expect(setup.body.secret).toMatch(/^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/);
      key = setup.body.secret.replace(/ /g, "");
      expect(setup.body.otpauth_url).toBe(`otpauth://totp/MyCity%20App:ops%40mycity.test?secret=${key}&issuer=MyCity%20App`);
      expect(setup.body.qr_code).toMatch(/^data:image\/png;base64,/);
      expect(setup.body.expires_in).toBe(900);

      // Only the encrypted key is stored, and nothing is on yet.
      const row = await one("SELECT mfa_secret_enc, mfa_pending_secret_enc, mfa_enrolled_at FROM app_user WHERE user_id = $1", [opsId]);
      expect(row.mfa_secret_enc).toBeNull();
      expect(row.mfa_enrolled_at).toBeNull();
      expect(row.mfa_pending_secret_enc).not.toContain(key);

      const wrongCode = mfa.codeAt(key) === "000000" ? "111111" : "000000";
      const wrong = await me.post("/security/two-step").send({ code: wrongCode });
      expect(wrong.status).toBe(422);
      expect(wrong.body.error.code).toBe("INVALID_CODE");
      expect(wrong.body.error.fields.code).toEqual(["Not the right code"]);
      expect((await passwordStep(email, OPS_PASSWORD)).res.body.access_token).toEqual(expect.any(String));

      const on = await me.post("/security/two-step").send({ code: mfa.codeAt(key) });
      expect(on.status).toBe(200);
      codes = on.body.recovery_codes;
      expect(codes).toHaveLength(10);
      for (const code of codes) expect(code).toMatch(/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);

      const stored = await q("SELECT code_hash FROM mfa_recovery_code WHERE user_id = $1 AND used_at IS NULL", [opsId]);
      expect(stored.rows).toHaveLength(10);
      for (const r of stored.rows) expect(r.code_hash).toMatch(/^\$argon2id\$/);

      const after = await me.get("/security");
      expect(after.body.two_step).toEqual(expect.objectContaining({ on: true, recovery_codes_left: 10 }));

      await drain();
      const notes = await noticesFor(email, "auth.two_step_on");
      expect(notes).toHaveLength(1);
      expect(notes[0].title).toBe("Two-step sign-in is on");
      expect(notes[0].channels).toEqual(expect.arrayContaining(["in_app", "email"]));
    });

    test("signing in now asks for the code; a wrong code is refused and counted", async () => {
      const { res, agent } = await passwordStep(email, OPS_PASSWORD);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ step: "code", challenge_token: expect.any(String), expires_in: 300 });
      // Nobody is signed in yet: no refresh cookie.
      expect((res.headers["set-cookie"] || []).some((c) => c.startsWith("mycity_rt="))).toBe(false);

      const wrongCode = mfa.codeAt(key) === "000000" ? "111111" : "000000";
      const wrong = await post(agent, "/auth/two-step").send({ challenge_token: res.body.challenge_token, code: wrongCode });
      expect(wrong.status).toBe(401);
      expect(wrong.body.error.code).toBe("INVALID_CODE");
      expect((await one("SELECT failed_login_count FROM app_user WHERE user_id = $1", [opsId])).failed_login_count).toBe(1);
      const failed = await one(
        "SELECT payload FROM event_log WHERE event_key = 'auth.sign_in_failed' AND entity_id = $1 ORDER BY occurred_at DESC LIMIT 1",
        [opsId],
      );
      expect(failed.payload.reason).toBe("bad_code");

      // A ticket is not a session.
      expect((await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${res.body.challenge_token}`)).status).toBe(401);
    });

    test("the right code opens the session; the code and the ticket each work once", async () => {
      const { res: first, agent } = await passwordStep(email, OPS_PASSWORD);
      await aMinuteLater(email);
      const code = mfa.codeAt(key);
      const ok = await post(agent, "/auth/two-step").send({ challenge_token: first.body.challenge_token, code });
      expect(ok.status).toBe(200);
      expect(ok.body.user.email).toBe(email);
      expect(await methodOf(ok.body.access_token)).toBe("password_totp");
      // The right code clears the count of wrong ones.
      expect((await one("SELECT failed_login_count FROM app_user WHERE user_id = $1", [opsId])).failed_login_count).toBe(0);

      // The same code on a new ticket: already spent.
      const again = await passwordStep(email, OPS_PASSWORD);
      const reused = await post(again.agent, "/auth/two-step").send({ challenge_token: again.res.body.challenge_token, code });
      expect(reused.status).toBe(401);
      expect(reused.body.error.code).toBe("INVALID_CODE");

      // The same ticket with a new code: already spent.
      await aMinuteLater(email);
      const replay = await post(agent, "/auth/two-step").send({ challenge_token: first.body.challenge_token, code: mfa.codeAt(key) });
      expect(replay.status).toBe(400);
      expect(replay.body.error.code).toBe("CHALLENGE_USED");
      await q("UPDATE app_user SET failed_login_count = 0, last_failed_login_at = NULL WHERE user_id = $1", [opsId]);

      // Once a day by default: the browser that proved a code is not asked again today.
      const trusted = await one(
        "SELECT mfa_trusted_until > now() + interval '23 hours' AS a_day FROM known_device d JOIN user_session s USING (known_device_id) WHERE s.session_id = $1",
        [sidOf(ok.body.access_token)],
      );
      expect(trusted.a_day).toBe(true);
      const next = await passwordStep(email, OPS_PASSWORD, agent);
      expect(next.res.body.access_token).toEqual(expect.any(String));
      expect(await methodOf(next.res.body.access_token)).toBe("password");
    });

    test("every sign-in asks when the person chooses it, and a change of rule clears every browser", async () => {
      const { token, agent } = await signIn(email, OPS_PASSWORD, { key });
      const set = await as(token).post("/security/two-step/frequency").send({ mfa_frequency: "every_sign_in" });
      expect(set.status).toBe(200);
      expect(set.body.two_step.mfa_frequency).toBe("every_sign_in");
      expect((await one("SELECT count(*)::int AS n FROM known_device WHERE user_id = $1 AND mfa_trusted_until IS NOT NULL", [opsId])).n).toBe(0);

      const asked = await signIn(email, OPS_PASSWORD, { key, agent });
      expect(asked.res.status).toBe(200);
      expect(await methodOf(asked.token)).toBe("password_totp");
      expect((await passwordStep(email, OPS_PASSWORD, agent)).res.body.step).toBe("code");

      const audit = await one(
        "SELECT before, after, is_sensitive FROM audit_ledger WHERE action = 'auth.two_step_frequency_set' AND entity_id = $1",
        [opsId],
      );
      expect(audit).toEqual({ before: { frequency: "daily" }, after: { frequency: "every_sign_in" }, is_sensitive: false });
      await drain();
      const notes = await noticesFor(email, "auth.two_step_frequency_set");
      expect(notes[0].body).toMatch(/^Two-step now asks at every sign-in\./);

      const back = await as(asked.token).post("/security/two-step/frequency").send({ mfa_frequency: "daily" });
      expect(back.body.two_step.mfa_frequency).toBe("daily");
    });

    test("a recovery code signs in once; new codes replace the old set", async () => {
      const first = await passwordStep(email, OPS_PASSWORD);
      // Typed as people type them: lower case, no dash.
      const typed = codes[0].toLowerCase().replace("-", "");
      const ok = await post(first.agent, "/auth/two-step").send({ challenge_token: first.res.body.challenge_token, code: typed });
      expect(ok.status).toBe(200);
      expect(await methodOf(ok.body.access_token)).toBe("password_totp");
      expect((await as(ok.body.access_token).get("/security")).body.two_step.recovery_codes_left).toBe(9);

      const again = await passwordStep(email, OPS_PASSWORD);
      const reused = await post(again.agent, "/auth/two-step").send({ challenge_token: again.res.body.challenge_token, code: codes[0] });
      expect(reused.status).toBe(401);
      expect(reused.body.error.code).toBe("INVALID_CODE");
      await q("UPDATE app_user SET failed_login_count = 0, last_failed_login_at = NULL WHERE user_id = $1", [opsId]);

      await drain();
      const notes = await noticesFor(email, "auth.recovery_code_used");
      expect(notes).toHaveLength(1);
      expect(notes[0].body).toContain("9 left");

      const renewed = await as(ok.body.access_token).post("/security/two-step/recovery-codes").send({});
      expect(renewed.status).toBe(200);
      expect(renewed.body.recovery_codes).toHaveLength(10);
      const old = await passwordStep(email, OPS_PASSWORD);
      const stale = await post(old.agent, "/auth/two-step").send({ challenge_token: old.res.body.challenge_token, code: codes[1] });
      expect(stale.status).toBe(401);
      codes = renewed.body.recovery_codes;
      const fresh = await post(old.agent, "/auth/two-step").send({ challenge_token: old.res.body.challenge_token, code: codes[1] });
      expect(fresh.status).toBe(200);
      await q("UPDATE app_user SET failed_login_count = 0, last_failed_login_at = NULL WHERE user_id = $1", [opsId]);
    });

    test("the PIN is the first step on a known browser, and the code still follows", async () => {
      const { token, agent } = await signIn(email, OPS_PASSWORD, { key });
      expect((await as(token).post("/security/pin").send({ pin: "5038" })).status).toBe(200);
      // A new rule makes every browser prove a code again.
      await as(token).post("/security/two-step/frequency").send({ mfa_frequency: "monthly" });

      const first = await post(agent, "/auth/pin").send({ email, pin: "5038" });
      expect(first.status).toBe(200);
      expect(first.body.step).toBe("code");
      await aMinuteLater(email);
      const ok = await post(agent, "/auth/two-step").send({ challenge_token: first.body.challenge_token, code: mfa.codeAt(key) });
      expect(ok.status).toBe(200);
      expect(await methodOf(ok.body.access_token)).toBe("pin_totp");

      // Once a month now: the next PIN sign-in on this browser goes straight in.
      const trusted = await one(
        "SELECT mfa_trusted_until > now() + interval '29 days' AS a_month FROM known_device d JOIN user_session s USING (known_device_id) WHERE s.session_id = $1",
        [sidOf(ok.body.access_token)],
      );
      expect(trusted.a_month).toBe(true);
      const next = await post(agent, "/auth/pin").send({ email, pin: "5038" });
      expect(next.status).toBe(200);
      expect(await methodOf(next.body.access_token)).toBe("pin");
    });

    test("a passkey is both steps: no code after it", async () => {
      const device = softAuthenticator({ origin: config.WEBAUTHN_ORIGIN, rpId: config.WEBAUTHN_RP_ID });
      const { token } = await signIn(email, OPS_PASSWORD, { key });
      const start = await as(token).post("/security/passkeys/options").send({});
      const added = await as(token).post("/security/passkeys").send({ challenge_token: start.body.challenge_token, credential: device.create(start.body.options) });
      expect(added.status).toBe(201);

      const begin = await post(request(app), "/auth/passkey/options").send({});
      const res = await post(request.agent(app), "/auth/passkey").send({ challenge_token: begin.body.challenge_token, credential: device.get(begin.body.options) });
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(email);
      expect(await methodOf(res.body.access_token)).toBe("passkey");
    });

    test("wrong codes slow the account down like wrong passwords", async () => {
      const { res } = await passwordStep(email, OPS_PASSWORD);
      const ticket = res.body.challenge_token;
      const wrongCode = () => {
        const near = [-30_000, 0, 30_000].map((d) => mfa.codeAt(key, Date.now() + d));
        let c = 100000;
        while (near.includes(String(c))) c += 1;
        return String(c);
      };
      for (let i = 0; i < 6; i += 1) {
        const r = await post(request(app), "/auth/two-step").send({ challenge_token: ticket, code: wrongCode() });
        expect(r.status).toBe(401);
      }
      const blocked = await post(request(app), "/auth/two-step").send({ challenge_token: ticket, code: wrongCode() });
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe("LOGIN_THROTTLED");
      // One count for the account: the password waits too.
      expect((await passwordStep(email, OPS_PASSWORD)).res.status).toBe(429);

      await drain();
      const notes = await noticesFor(email, "auth.sign_in_throttled");
      expect(notes[notes.length - 1].title).toBe("Several wrong codes on your account");
      await q("UPDATE app_user SET failed_login_count = 0, last_failed_login_at = NULL WHERE user_id = $1", [opsId]);
    });

    test("a new authenticator app takes over only once its code is proved", async () => {
      const { token } = await signIn(email, OPS_PASSWORD, { key, agent: request.agent(app) });
      const setup = await as(token).post("/security/two-step/setup").send({});
      const newKey = setup.body.secret.replace(/ /g, "");

      // Until the new app proves a code, the old one still signs in.
      expect((await signIn(email, OPS_PASSWORD, { key })).res.status).toBe(200);

      const moved = await as(token).post("/security/two-step").send({ code: mfa.codeAt(newKey) });
      expect(moved.status).toBe(200);
      expect(await countEvents("auth.two_step_changed", opsId)).toBe(1);

      await aMinuteLater(email);
      const old = await passwordStep(email, OPS_PASSWORD);
      const refused = await post(old.agent, "/auth/two-step").send({ challenge_token: old.res.body.challenge_token, code: mfa.codeAt(key) });
      expect(refused.status).toBe(401);
      await q("UPDATE app_user SET failed_login_count = 0, last_failed_login_at = NULL WHERE user_id = $1", [opsId]);
      key = newKey;
      codes = moved.body.recovery_codes;
      expect((await signIn(email, OPS_PASSWORD, { key })).res.status).toBe(200);
    });

    test("turning it off needs a fresh sign-in: within the window it goes ahead, past it the person confirms", async () => {
      const { token } = await signIn(email, OPS_PASSWORD, { key });
      const me = as(token);

      // Fourteen minutes after signing in is still inside the window.
      await provedAgo(token, 14);
      const inside = (await me.get("/security")).body.confirmed_for;
      expect(inside).toBeGreaterThan(0);
      expect(inside).toBeLessThanOrEqual(60);

      await provedAgo(token, 16);
      expect((await me.get("/security")).body.confirmed_for).toBe(0);
      const refused = await me.post("/security/two-step/off").send({});
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe("REAUTH_REQUIRED");

      const wrong = await me.post("/security/confirm").send({ method: "password", password: "Not-my-pass9" });
      expect(wrong.status).toBe(422);
      expect(wrong.body.error.fields.password).toEqual(["Not your password"]);
      const ok = await me.post("/security/confirm").send({ method: "password", password: OPS_PASSWORD });
      expect(ok.status).toBe(200);
      expect(ok.body.confirmed_for).toBeGreaterThan(14 * 60);
      const proof = await one("SELECT payload FROM event_log WHERE event_key = 'auth.reauthenticated' AND entity_id = $1", [opsId]);
      expect(proof.payload).toEqual({ method: "password" });

      const off = await me.post("/security/two-step/off").send({});
      expect(off.status).toBe(200);
      expect(off.body.two_step).toEqual(expect.objectContaining({ on: false, recovery_codes_left: 0 }));
      const row = await one(
        `SELECT u.mfa_secret_enc, u.mfa_enrolled_at,
                (SELECT count(*)::int FROM mfa_recovery_code r WHERE r.user_id = u.user_id) AS codes,
                (SELECT count(*)::int FROM known_device d WHERE d.user_id = u.user_id AND d.mfa_trusted_until IS NOT NULL) AS trusted
           FROM app_user u WHERE u.user_id = $1`,
        [opsId],
      );
      expect(row).toEqual({ mfa_secret_enc: null, mfa_enrolled_at: null, codes: 0, trusted: 0 });
      expect((await passwordStep(email, OPS_PASSWORD)).res.body.access_token).toEqual(expect.any(String));

      await drain();
      expect((await noticesFor(email, "auth.two_step_off"))[0].title).toBe("Two-step sign-in is off");
    });

    test("no key, code or recovery code reaches an event or the audit", async () => {
      const leaks = await one(
        `SELECT count(*)::int AS n FROM event_log e LEFT JOIN audit_ledger a USING (event_id)
          WHERE e.payload::text ~ $1 OR coalesce(a.before::text, '') ~ $1 OR coalesce(a.after::text, '') ~ $1`,
        [[key, ...codes.map((c) => c.replace("-", ""))].join("|")],
      );
      expect(leaks.n).toBe(0);
    });
  });

  /* ------------------------------------------------------------------ */

  describe("the PIN", () => {
    const email = "ceo@mycity.test";
    let ceoId;
    let token;
    let agent;

    beforeAll(async () => {
      ceoId = people.ceo.user.user_id;
      ({ token, agent } = await signIn(email, CEO_PASSWORD));
    });

    test("weak PINs and the person's birthday are refused; a good one is set, then changed", async () => {
      const me = as(token);
      const run = await me.post("/security/pin").send({ pin: "1234" });
      expect(run.status).toBe(422);
      expect(run.body.error.fields.pin).toEqual(["Not a run like 1234"]);
      expect((await me.post("/security/pin").send({ pin: "12a4" })).body.error.fields.pin).toEqual(["Enter 4 digits"]);

      // Born 24 July 1988: 2407, 0724 and 1988 are the first a colleague would try.
      for (const pin of ["2407", "0724", "1988"]) {
        const r = await me.post("/security/pin").send({ pin });
        expect(r.status).toBe(422);
        expect(r.body.error.code).toBe("WEAK_PIN");
        expect(r.body.error.fields.pin).toEqual(["Not your birthday"]);
      }

      const set = await me.post("/security/pin").send({ pin: "5821" });
      expect(set.status).toBe(200);
      expect(set.body.pin).toEqual({ on: true, pin_changed_at: expect.any(String) });
      const row = await one("SELECT pin_hash FROM app_user WHERE user_id = $1", [ceoId]);
      expect(row.pin_hash).toMatch(/^\$argon2id\$/);

      expect((await me.post("/security/pin").send({ pin: "4826" })).status).toBe(200);
      expect(await countEvents("auth.pin_set", ceoId)).toBe(1);
      expect(await countEvents("auth.pin_changed", ceoId)).toBe(1);
      await drain();
      expect((await noticesFor(email, "auth.pin_set"))[0].title).toBe("PIN set");
      expect((await noticesFor(email, "auth.pin_changed"))[0].title).toBe("PIN changed");
    });

    test("the PIN signs in on a browser the person has used, and nowhere else", async () => {
      const greeting = await agent.get("/api/v1/auth/device");
      expect(greeting.body.account).toEqual(expect.objectContaining({ email, has_pin: true, has_passkey: false }));

      const ok = await post(agent, "/auth/pin").send({ email, pin: "4826" });
      expect(ok.status).toBe(200);
      expect(await methodOf(ok.body.access_token)).toBe("pin");

      const stranger = await post(request.agent(app), "/auth/pin").send({ email, pin: "4826" });
      expect(stranger.status).toBe(401);
      expect(stranger.body.error.code).toBe("PIN_UNAVAILABLE");

      // Someone else's browser is not this person's either.
      const { agent: opsBrowser } = await signIn("ops@mycity.test", OPS_PASSWORD);
      const borrowed = await post(opsBrowser, "/auth/pin").send({ email, pin: "4826" });
      expect(borrowed.status).toBe(401);
      expect(borrowed.body.error.code).toBe("PIN_UNAVAILABLE");

      const nobody = await post(agent, "/auth/pin").send({ email: "nobody@mycity.test", pin: "4826" });
      expect(nobody.status).toBe(401);
      expect(nobody.body.error.code).toBe("PIN_UNAVAILABLE");
    });

    test("wrong PINs wait like wrong passwords, and ten in a row switch the PIN off", async () => {
      const wrong = () => post(agent, "/auth/pin").send({ email, pin: "9157" });
      for (let i = 1; i <= 6; i += 1) {
        const r = await wrong();
        expect(r.status).toBe(401);
        expect(r.body.error.code).toBe("INVALID_PIN");
      }
      const waiting = await wrong();
      expect(waiting.status).toBe(429);
      expect(waiting.body.error.code).toBe("PIN_THROTTLED");
      // The wait applies to the right PIN too.
      expect((await post(agent, "/auth/pin").send({ email, pin: "4826" })).status).toBe(429);
      expect(await countEvents("auth.pin_throttled", ceoId)).toBe(1);

      // Once the wait passes, the right PIN works and the run of wrong ones ends.
      await q("UPDATE app_user SET pin_last_failed_at = now() - interval '1 hour' WHERE user_id = $1", [ceoId]);
      expect((await post(agent, "/auth/pin").send({ email, pin: "4826" })).status).toBe(200);
      expect((await one("SELECT pin_failed_count FROM app_user WHERE user_id = $1", [ceoId])).pin_failed_count).toBe(0);

      let last;
      for (let i = 1; i <= 10; i += 1) {
        await q("UPDATE app_user SET pin_last_failed_at = now() - interval '1 hour' WHERE user_id = $1", [ceoId]);
        last = await wrong();
        if (i < 10) expect(last.body.error.code).toBe("INVALID_PIN");
        if (i === 9) expect(last.body.error.message).toBe("That PIN is not right. 1 try left.");
      }
      expect(last.status).toBe(401);
      expect(last.body.error.code).toBe("PIN_SWITCHED_OFF");
      expect((await one("SELECT pin_hash FROM app_user WHERE user_id = $1", [ceoId])).pin_hash).toBeNull();
      const gone = await post(agent, "/auth/pin").send({ email, pin: "4826" });
      expect(gone.status).toBe(401);
      expect(gone.body.error.code).toBe("PIN_UNAVAILABLE");

      await drain();
      expect((await noticesFor(email, "auth.pin_throttled"))[0].title).toBe("Several wrong PINs on your account");
      expect((await noticesFor(email, "auth.pin_switched_off"))[0].title).toBe("Your PIN was switched off");
      // The password still works: a PIN is never the only way in.
      expect((await signIn(email, CEO_PASSWORD)).res.status).toBe(200);
    });

    test("the PIN confirms it is you, and removing it needs the window", async () => {
      ({ token, agent } = await signIn(email, CEO_PASSWORD, { agent }));
      const me = as(token);
      expect((await me.post("/security/pin").send({ pin: "4826" })).status).toBe(200);
      expect((await me.post("/security/confirm/options").send({})).body.error.code).toBe("NO_PASSKEY");

      await provedAgo(token, 30);
      const refused = await me.post("/security/pin/remove").send({});
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe("REAUTH_REQUIRED");

      const wrong = await me.post("/security/confirm").send({ method: "pin", pin: "9157" });
      expect(wrong.status).toBe(422);
      expect(wrong.body.error.fields.pin).toEqual(["Not the right PIN"]);
      const ok = await me.post("/security/confirm").send({ method: "pin", pin: "4826" });
      expect(ok.status).toBe(200);
      expect((await one("SELECT pin_failed_count FROM app_user WHERE user_id = $1", [ceoId])).pin_failed_count).toBe(0);

      const removed = await me.post("/security/pin/remove").send({});
      expect(removed.status).toBe(200);
      expect(removed.body.pin).toEqual({ on: false, pin_changed_at: null });
      await drain();
      expect((await noticesFor(email, "auth.pin_removed"))[0].title).toBe("PIN removed");
    });

    test("no PIN reaches an event or the audit", async () => {
      const leaks = await one(
        `SELECT count(*)::int AS n FROM event_log e LEFT JOIN audit_ledger a USING (event_id)
          WHERE e.entity_id = $1 AND (e.payload::text ~ '4826|5821|9157' OR coalesce(a.after::text, '') ~ '4826|5821|9157')`,
        [ceoId],
      );
      expect(leaks.n).toBe(0);
    });
  });

  /* ------------------------------------------------------------------ */

  describe("passkeys", () => {
    const email = "bola@mycity.test";
    const device = softAuthenticator({ origin: config.WEBAUTHN_ORIGIN, rpId: config.WEBAUTHN_RP_ID });
    let staffId;
    let token;
    let agent;
    let passkeyId;

    beforeAll(async () => {
      staffId = people.staff.user.user_id;
      ({ token, agent } = await signIn(email, STAFF_PASSWORD, { ua: PHONE }));
    });

    test("a passkey is added from a fresh session, listed and renamed; its ceremony works once", async () => {
      const me = as(token);
      const start = await me.post("/security/passkeys/options").send({});
      expect(start.status).toBe(200);
      const options = start.body.options;
      expect(options.rp).toEqual({ name: "MyCity App", id: config.WEBAUTHN_RP_ID });
      expect(options.authenticatorSelection).toEqual(expect.objectContaining({ residentKey: "required", userVerification: "required" }));
      expect(options.excludeCredentials).toEqual([]);

      const answer = device.create(options);
      const added = await me.post("/security/passkeys").set("User-Agent", PHONE).send({ challenge_token: start.body.challenge_token, credential: answer });
      expect(added.status).toBe(201);
      expect(added.body).toEqual({
        passkey_id: expect.any(String),
        label: "Safari on iPhone",
        backed_up: false,
        created_at: expect.any(String),
        last_used_at: null,
        this_device: true,
      });
      passkeyId = added.body.passkey_id;

      const replay = await me.post("/security/passkeys").send({ challenge_token: start.body.challenge_token, credential: answer });
      expect(replay.status).toBe(400);
      expect(replay.body.error.code).toBe("CHALLENGE_USED");

      const list = await me.get("/security/passkeys");
      expect(list.status).toBe(200);
      expect(list.body.page.size).toBe(25);
      expect(list.body.data.map((p) => p.passkey_id)).toEqual([passkeyId]);

      const renamed = await me.post(`/security/passkeys/${passkeyId}/rename`).send({ label: "Work Phone" });
      expect(renamed.status).toBe(200);
      expect(renamed.body.label).toBe("Work Phone");
      const audit = await one("SELECT before, after FROM audit_ledger WHERE action = 'auth.passkey_renamed' AND entity_id = $1", [staffId]);
      expect(audit).toEqual({ before: { label: "Safari on iPhone" }, after: { label: "Work Phone" } });

      // The same device cannot add a second passkey for the same person.
      const next = await me.post("/security/passkeys/options").send({});
      expect(next.body.options.excludeCredentials.map((c) => c.id)).toEqual([device.credentials[0].id]);

      await drain();
      const notes = await noticesFor(email, "auth.passkey_added");
      expect(notes[0].title).toBe("Passkey added");
      expect(notes[0].body).toContain("Safari on iPhone can now sign you in.");
      expect((await agent.get("/api/v1/auth/device")).body.account).toEqual(expect.objectContaining({ has_passkey: true, has_pin: false }));
    });

    test("a passkey without the fingerprint or face is refused", async () => {
      const other = softAuthenticator({ origin: config.WEBAUTHN_ORIGIN, rpId: config.WEBAUTHN_RP_ID });
      const start = await as(token).post("/security/passkeys/options").send({});
      const res = await as(token).post("/security/passkeys").send({
        challenge_token: start.body.challenge_token,
        credential: other.create(start.body.options, { userVerified: false }),
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("PASSKEY_FAILED");
    });

    test("a passkey made for another site is refused", async () => {
      const elsewhere = softAuthenticator({ origin: "https://hub.example.test", rpId: "hub.example.test" });
      const start = await as(token).post("/security/passkeys/options").send({});
      const res = await as(token).post("/security/passkeys").send({
        challenge_token: start.body.challenge_token,
        credential: elsewhere.create(start.body.options),
      });
      expect(res.status).toBe(422);
    });

    test("a passkey signs in without the password; a replayed answer is refused", async () => {
      const begin = await post(request(app), "/auth/passkey/options").send({});
      expect(begin.status).toBe(200);
      expect(begin.body.options.userVerification).toBe("required");
      // Signing in names no passkeys, so the options say nothing about who has one.
      expect(begin.body.options.allowCredentials || []).toEqual([]);

      const signed = device.get(begin.body.options);
      const ok = await post(request.agent(app), "/auth/passkey").send({ challenge_token: begin.body.challenge_token, credential: signed });
      expect(ok.status).toBe(200);
      expect(ok.body.user.email).toBe(email);
      expect(await methodOf(ok.body.access_token)).toBe("passkey");
      const row = await one("SELECT sign_count::int AS n, last_used_at FROM passkey WHERE passkey_id = $1", [passkeyId]);
      expect(row.n).toBe(1);
      expect(row.last_used_at).not.toBeNull();

      // The same answer again: the counter has moved past it.
      const replay = await post(request.agent(app), "/auth/passkey").send({ challenge_token: begin.body.challenge_token, credential: signed });
      expect(replay.status).toBe(401);
      expect(replay.body.error.code).toBe("PASSKEY_FAILED");
    });

    test("a synced passkey keeps its counter at 0, and the ticket still works once", async () => {
      const synced = softAuthenticator({ origin: config.WEBAUTHN_ORIGIN, rpId: config.WEBAUTHN_RP_ID, syncedCounter: true });
      const { token: fresh } = await signIn(email, STAFF_PASSWORD);
      const start = await as(fresh).post("/security/passkeys/options").send({});
      const added = await as(fresh).post("/security/passkeys").send({ challenge_token: start.body.challenge_token, credential: synced.create(start.body.options), label: "Password Manager" });
      expect(added.status).toBe(201);
      expect(added.body.label).toBe("Password Manager");

      const begin = await post(request(app), "/auth/passkey/options").send({});
      const signed = synced.get(begin.body.options);
      expect((await post(request.agent(app), "/auth/passkey").send({ challenge_token: begin.body.challenge_token, credential: signed })).status).toBe(200);
      const replay = await post(request.agent(app), "/auth/passkey").send({ challenge_token: begin.body.challenge_token, credential: signed });
      expect(replay.status).toBe(400);
      expect(replay.body.error.code).toBe("CHALLENGE_USED");

      const removed = await as(fresh).post(`/security/passkeys/${added.body.passkey_id}/remove`).send({});
      expect(removed.status).toBe(200);
    });

    test("options for one person (the lock screen) finish only with that person's passkey", async () => {
      const forOps = await post(request(app), "/auth/passkey/options").send({ email: "ops@mycity.test" });
      const notYours = await post(request.agent(app), "/auth/passkey").send({ challenge_token: forOps.body.challenge_token, credential: device.get(forOps.body.options) });
      expect(notYours.status).toBe(401);
      expect(notYours.body.error.code).toBe("PASSKEY_NOT_YOURS");

      const forMe = await post(request(app), "/auth/passkey/options").send({ email });
      const mine = await post(agent, "/auth/passkey").send({ challenge_token: forMe.body.challenge_token, credential: device.get(forMe.body.options) });
      expect(mine.status).toBe(200);
      expect(mine.body.user.email).toBe(email);
    });

    test("the passkey confirms it is you; removing it needs the window, and then it signs in nowhere", async () => {
      const me = as(token);
      await provedAgo(token, 20);
      const refused = await me.post(`/security/passkeys/${passkeyId}/remove`).send({});
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe("REAUTH_REQUIRED");
      // Renaming changes no way in, so it needs no window.
      expect((await me.post(`/security/passkeys/${passkeyId}/rename`).send({ label: "My Phone" })).status).toBe(200);

      const start = await me.post("/security/confirm/options").send({});
      expect(start.status).toBe(200);
      expect(start.body.options.allowCredentials.map((c) => c.id)).toEqual([device.credentials[0].id]);
      const confirmed = await me.post("/security/confirm").send({
        method: "passkey",
        challenge_token: start.body.challenge_token,
        credential: device.get(start.body.options),
      });
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.confirmed_for).toBeGreaterThan(14 * 60);

      const removed = await me.post(`/security/passkeys/${passkeyId}/remove`).send({});
      expect(removed.status).toBe(200);
      expect(removed.body.passkeys).toBe(0);
      await drain();
      const notes = await noticesFor(email, "auth.passkey_removed");
      expect(notes.map((n) => n.body.split(" can ")[0])).toEqual(["Password Manager", "My Phone"]);

      const begin = await post(request(app), "/auth/passkey/options").send({});
      const gone = await post(request.agent(app), "/auth/passkey").send({ challenge_token: begin.body.challenge_token, credential: device.get(begin.body.options) });
      expect(gone.status).toBe(401);
      expect(gone.body.error.code).toBe("PASSKEY_UNKNOWN");
    });
  });

  /* ------------------------------------------------------------------ */

  describe("Settings · Users: Reset Two-Step", () => {
    const email = "bola@mycity.test";
    let staffId;
    let opsId;
    let staffToken;

    beforeAll(async () => {
      staffId = people.staff.user.user_id;
      opsId = people.ops.user.user_id;
      const { token } = await signIn(email, STAFF_PASSWORD);
      const setup = await as(token).post("/security/two-step/setup").send({});
      const key = setup.body.secret.replace(/ /g, "");
      expect((await as(token).post("/security/two-step").send({ code: mfa.codeAt(key) })).status).toBe(200);
      staffToken = (await signIn(email, STAFF_PASSWORD, { key })).token;
    });

    test("Staff cannot reset anyone's two-step", async () => {
      const res = await as(staffToken).post(`/users/${opsId}/reset-two-step`).send({});
      expect(res.status).toBe(403);
    });

    test("an administrator confirms, resets, and the person is signed out and told", async () => {
      const { token } = await signIn("ops@mycity.test", OPS_PASSWORD);
      const admin = as(token);
      expect((await admin.get(`/users/${staffId}`)).body.two_step).toBe(true);

      // Nobody resets their own here: My Security is for that.
      const self = await admin.post(`/users/${opsId}/reset-two-step`).send({});
      expect(self.status).toBe(422);

      await provedAgo(token, 20);
      const stale = await admin.post(`/users/${staffId}/reset-two-step`).send({});
      expect(stale.status).toBe(403);
      expect(stale.body.error.code).toBe("REAUTH_REQUIRED");
      expect((await admin.post("/security/confirm").send({ method: "password", password: OPS_PASSWORD })).status).toBe(200);

      const reset = await admin.post(`/users/${staffId}/reset-two-step`).send({});
      expect(reset.status).toBe(200);
      expect(reset.body).toEqual(expect.objectContaining({ user_id: staffId, two_step: false }));
      expect((await as(staffToken).get("/auth/me")).status).toBe(401);

      const row = await one(
        `SELECT u.mfa_secret_enc,
                (SELECT count(*)::int FROM mfa_recovery_code r WHERE r.user_id = u.user_id) AS codes,
                (SELECT count(*)::int FROM user_session s WHERE s.user_id = u.user_id AND s.killed_at IS NULL) AS live
           FROM app_user u WHERE u.user_id = $1`,
        [staffId],
      );
      expect(row).toEqual({ mfa_secret_enc: null, codes: 0, live: 0 });

      const audit = await one(
        "SELECT actor_user_id, is_sensitive, metadata FROM audit_ledger WHERE action = 'auth.two_step_reset' AND entity_id = $1",
        [staffId],
      );
      expect(audit).toEqual(expect.objectContaining({ actor_user_id: opsId, is_sensitive: true }));

      await drain();
      const told = await noticesFor(email, "auth.two_step_reset");
      expect(told).toHaveLength(1);
      expect(told[0].title).toBe("Two-step sign-in was reset");
      expect(told[0].channels).toEqual(expect.arrayContaining(["in_app", "email"]));
      const watchers = await noticesFor("ceo@mycity.test", "auth.two_step_reset");
      expect(watchers[0].title).toBe("Access change: Two-step sign-in was reset");

      const again = await admin.post(`/users/${staffId}/reset-two-step`).send({});
      expect(again.status).toBe(422);
      expect(again.body.error.code).toBe("TWO_STEP_OFF");

      // The person signs in with the password alone and sets two-step up again.
      const back = await signIn(email, STAFF_PASSWORD);
      expect(back.res.status).toBe(200);
      expect(await methodOf(back.token)).toBe("password");
    });
  });

  /* ------------------------------------------------------------------ */

  describe("Recent Sign-Ins", () => {
    test("each session records how it began, and My Security lists it", async () => {
      const methods = await q("SELECT DISTINCT method FROM user_session ORDER BY method");
      expect(methods.rows.map((r) => r.method)).toEqual(["passkey", "password", "password_totp", "pin", "pin_totp"]);

      const { token } = await signIn("ops@mycity.test", OPS_PASSWORD);
      const list = await as(token).get("/auth/sessions");
      expect(list.status).toBe(200);
      expect(list.body.data[0]).toEqual(expect.objectContaining({ method: expect.stringMatching(/^(password|password_totp|pin|pin_totp|passkey)$/) }));
    });
  });
});
