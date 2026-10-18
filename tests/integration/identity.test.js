"use strict";
/**
 * Sign-in, sessions, passwords, invitations and Settings · Users, end to end: the
 * real migrations on a throwaway database, the whole app through HTTP, the outbox
 * drained as the worker would, the email queue captured.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/identity
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the
 * public schema.
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
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => {}),
  DEFAULTS: {},
}));

const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const organisation = require("../../src/modules/organisation/organisation.service");
const catalog = require("../../src/shared/access/access.catalog");
const grantsCache = require("../../src/shared/rbac/grants-cache");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

const OPS_PASSWORD = "Opera!ions2026";
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

/** The cookie a response set, as "name=value", or null. */
function cookieOf(res, name) {
  const all = res.headers["set-cookie"] || [];
  const hit = all.find((c) => c.startsWith(`${name}=`));
  return hit ? hit.split(";")[0] : null;
}

/** The token from the last captured email of this template. */
function lastLinkToken(template) {
  const job = [...sent].reverse().find((s) => s.data && s.data.template === template);
  if (!job) return null;
  return new URL(job.data.data.link_url).searchParams.get("token");
}

describeDb("identity against the real migrations", () => {
  let app;
  const people = {};

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
    await tx(async (client) => {
      people.ceo = await createAdmin(
        client,
        { employee: sample("Amaka", "Eze", "ceo@mycity.test", "Chief Executive Officer"), role_code: "management", is_ceo: true },
        CEO_PASSWORD,
      );
      people.ops = await createAdmin(
        client,
        { employee: sample("Ada", "Obi", "ops@mycity.test", "Operations & People Lead"), role_code: "operations_people", is_ceo: false },
        OPS_PASSWORD,
      );
      const dept = await organisation.findDepartmentByName(client, "HR & Operations");
      people.staffEmployee = await organisation.createEmployee(
        client,
        {
          first_name: "Bola",
          last_name: "Ade",
          work_email: "bola@mycity.test",
          phone: "+2348031234568",
          job_title: "Content Associate",
          start_date: "2026-03-02",
          employment_type: "full_time",
          work_pattern: "remote",
          department_id: dept.department_id,
          line_manager_id: people.ops.employee.employee_id,
        },
        { user_id: null, source: "test" },
      );
    });
    await drain();
  });

  afterAll(async () => {
    // Errors the suite provoked are written now, while the pool is open, rather than on the
    // reporter's timer after the test environment is gone.
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  // Each sign-in comes from its own address, so the per-address limit is tested on purpose, below.
  let ipSeq = 0;
  const nextIp = () => {
    ipSeq += 1;
    return `10.20.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
  };
  const loginReq = (agent = request(app)) => agent.post("/api/v1/auth/login").set("X-Forwarded-For", nextIp());

  async function signIn(email, password, agent = request.agent(app)) {
    const res = await loginReq(agent).send({ email, password });
    return { res, agent, token: res.body && res.body.access_token };
  }

  describe("signing in", () => {
    test("a wrong password and an unknown email get the same answer", async () => {
      const a = await loginReq().send({ email: "ops@mycity.test", password: "nope" });
      const b = await loginReq().send({ email: "nobody@mycity.test", password: "nope" });
      expect(a.status).toBe(401);
      expect(b.status).toBe(401);
      expect(a.body.error.code).toBe("INVALID_CREDENTIALS");
      expect(b.body.error).toEqual(expect.objectContaining({ code: a.body.error.code, message: a.body.error.message }));
      await q("UPDATE app_user SET failed_login_count = 0, last_failed_login_at = NULL");
    });

    test("the right password opens a session with both cookies and the person's grants", async () => {
      const { res } = await signIn("ops@mycity.test", OPS_PASSWORD);
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe("ops@mycity.test");
      expect(res.body.user.home_view).toBe("operations");
      expect(res.body.user.grants.settings).toEqual(expect.arrayContaining(["view", "create", "edit"]));
      expect(res.body.user.roles).toEqual([{ code: "operations_people", name: "Operations & People" }]);
      expect(res.body.user.manages_people).toBe(true);
      expect(res.body.session_max_age).toBe(120 * 60);
      expect(res.body.session_expires_in).toBeLessThanOrEqual(120 * 60);
      expect(res.body.expires_in).toBe(15 * 60);
      const rt = (res.headers["set-cookie"] || []).find((c) => c.startsWith("mycity_rt="));
      expect(rt).toMatch(/HttpOnly/);
      expect(rt).toMatch(/Path=\/api\/v1\/auth/);
      expect(rt).toMatch(/SameSite=Strict/);
      expect(cookieOf(res, "mycity_device")).not.toBeNull();
    });

    test("/me answers for the bearer, and the CEO holds every action and every capability", async () => {
      const { token } = await signIn("ceo@mycity.test", CEO_PASSWORD);
      const me = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${token}`);
      expect(me.status).toBe(200);
      expect(me.body.is_ceo).toBe(true);
      expect(me.body.home_view).toBe("ceo");
      expect(me.body.grants.payroll).toEqual(["view", "create", "edit", "delete", "approve", "export"]);
      const every = (await q("SELECT code::text AS code FROM capability ORDER BY code")).rows.map((r) => r.code);
      expect(every).toEqual(expect.arrayContaining(catalog.CAPABILITIES));
      expect(me.body.capabilities).toEqual(every);
    });

    test("/me lists the capabilities the person's roles hold, A to Z, the same codes the routes check", async () => {
      const { res, token } = await signIn("ops@mycity.test", OPS_PASSWORD);
      const held = (
        await q(
          `SELECT c.code::text AS code
             FROM role_capability rc
             JOIN role r ON r.role_id = rc.role_id
             JOIN capability c ON c.capability_id = rc.capability_id
            WHERE r.code = 'operations_people'
            ORDER BY c.code`,
        )
      ).rows.map((r) => r.code);
      expect(held).toEqual(expect.arrayContaining(["alerts.clear", "announcements.post"]));
      expect(res.body.user.capabilities).toEqual(held);
      expect(await grantsCache.getCapabilities(pool, people.ops.user.user_id)).toEqual(held);
      const me = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${token}`);
      expect(me.body.capabilities).toEqual(held);
    });

    test("a capability given to the person directly shows on /me beside their roles'", async () => {
      const { token } = await signIn("ops@mycity.test", OPS_PASSWORD);
      const userId = people.ops.user.user_id;
      const capabilities = async () => (await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${token}`)).body.capabilities;
      const refresh = async () => {
        await grantsCache.invalidateGrants();
        await grantsCache.invalidateUser(userId);
      };
      // The role's home.team is set aside for the test, so only the direct grant can show it.
      const taken = await q(
        `DELETE FROM role_capability rc USING role r, capability c
          WHERE r.role_id = rc.role_id AND c.capability_id = rc.capability_id
            AND r.code = 'operations_people' AND c.code = 'home.team'
         RETURNING rc.role_id, rc.capability_id`,
      );
      try {
        await refresh();
        expect(await capabilities()).not.toContain("home.team");
        await q("INSERT INTO user_capability (user_id, capability_id) SELECT $1, capability_id FROM capability WHERE code = 'home.team'", [userId]);
        await refresh();
        const held = await capabilities();
        expect(held).toContain("home.team");
        expect(held).toEqual([...held].sort());
      } finally {
        await q("DELETE FROM user_capability WHERE user_id = $1", [userId]);
        for (const row of taken.rows)
          await q("INSERT INTO role_capability (role_id, capability_id) VALUES ($1, $2)", [row.role_id, row.capability_id]);
        await refresh();
      }
    });

    test("the browser greets the last person who signed in on it", async () => {
      const { agent } = await signIn("ops@mycity.test", OPS_PASSWORD);
      const res = await agent.get("/api/v1/auth/device");
      expect(res.status).toBe(200);
      expect(res.body.account).toEqual({
        email: "ops@mycity.test",
        display_name: "Ada Obi",
        first_name: "Ada",
        has_pin: false,
        has_passkey: false,
      });
      const stranger = await request(app).get("/api/v1/auth/device");
      expect(stranger.body.account).toBeNull();
    });

    test("one address gets ten wrong guesses in fifteen minutes, then waits", async () => {
      const from = (r) => r.set("X-Forwarded-For", "10.99.0.1");
      for (let i = 0; i < 10; i += 1) {
        const r = await from(request(app).post("/api/v1/auth/login")).send({ email: `guess${i}@mycity.test`, password: "nope" });
        expect(r.status).toBe(401);
      }
      const limited = await from(request(app).post("/api/v1/auth/login")).send({ email: "ops@mycity.test", password: OPS_PASSWORD });
      expect(limited.status).toBe(429);
      expect(limited.body.error.code).toBe("RATE_LIMITED");
    });

    test("wrong passwords slow the account down instead of locking it", async () => {
      for (let i = 0; i < 6; i += 1) {
        await loginReq().send({ email: "ceo@mycity.test", password: `wrong-${i}` });
      }
      const blocked = await loginReq().send({ email: "ceo@mycity.test", password: CEO_PASSWORD });
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe("LOGIN_THROTTLED");
      const row = await one("SELECT failed_login_count FROM app_user WHERE email = 'ceo@mycity.test'");
      expect(row.failed_login_count).toBe(6);
      expect(await one("SELECT count(*)::int AS n FROM event_log WHERE event_key = 'auth.sign_in_throttled'")).toEqual({ n: 1 });

      // The wait passes on its own; the right password then clears the count.
      await q("UPDATE app_user SET last_failed_login_at = now() - interval '1 hour' WHERE email = 'ceo@mycity.test'");
      const ok = await loginReq().send({ email: "ceo@mycity.test", password: CEO_PASSWORD });
      expect(ok.status).toBe(200);
      expect((await one("SELECT failed_login_count FROM app_user WHERE email = 'ceo@mycity.test'")).failed_login_count).toBe(0);
    });
  });

  describe("the session", () => {
    test("refresh rotates the cookie, and the rotated-away one ends the session", async () => {
      const { res: login, agent } = await signIn("ops@mycity.test", OPS_PASSWORD);
      const first = cookieOf(login, "mycity_rt");
      const r1 = await agent.post("/api/v1/auth/refresh").send({});
      expect(r1.status).toBe(200);
      expect(r1.body.access_token).toEqual(expect.any(String));
      const second = cookieOf(r1, "mycity_rt");
      expect(second).not.toEqual(first);

      // Presenting the first cookie again is a replay: the whole session ends.
      const replay = await request(app).post("/api/v1/auth/refresh").set("Cookie", first).send({});
      expect(replay.status).toBe(401);
      const after = await request(app).post("/api/v1/auth/refresh").set("Cookie", second).send({});
      expect(after.status).toBe(401);
      const me = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${r1.body.access_token}`);
      expect(me.status).toBe(401);
      expect(me.body.error.code).toBe("SESSION_ENDED");
    });

    test("a session past its two hours ends at the next refresh", async () => {
      const { res, agent } = await signIn("ops@mycity.test", OPS_PASSWORD);
      const sid = JSON.parse(Buffer.from(res.body.access_token.split(".")[1], "base64url")).sid;
      await q("UPDATE user_session SET issued_at = now() - interval '121 minutes', last_seen_at = now() WHERE session_id = $1", [sid]);
      const r = await agent.post("/api/v1/auth/refresh").send({});
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe("SESSION_TIME_LIMIT");
      expect((await one("SELECT end_reason FROM user_session WHERE session_id = $1", [sid])).end_reason).toBe("session_max_age");
    });

    test("a session idle past thirty minutes ends at the next refresh", async () => {
      const { res, agent } = await signIn("ops@mycity.test", OPS_PASSWORD);
      const sid = JSON.parse(Buffer.from(res.body.access_token.split(".")[1], "base64url")).sid;
      await q("UPDATE user_session SET last_seen_at = now() - interval '31 minutes' WHERE session_id = $1", [sid]);
      const r = await agent.post("/api/v1/auth/refresh").send({});
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe("SESSION_IDLE");
    });

    test("signing out ends the session for the access token and the cookie", async () => {
      const { agent, token } = await signIn("ops@mycity.test", OPS_PASSWORD);
      const out = await agent.post("/api/v1/auth/logout").set("Authorization", `Bearer ${token}`).send({});
      expect(out.status).toBe(204);
      expect((await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${token}`)).status).toBe(401);
      expect((await agent.post("/api/v1/auth/refresh").send({})).status).toBe(401);
    });

    test("a screen that locked itself when idle records the session as ended for inactivity", async () => {
      const { agent, token } = await signIn("ops@mycity.test", OPS_PASSWORD);
      const sid = JSON.parse(Buffer.from(token.split(".")[1], "base64url")).sid;
      const out = await agent.post("/api/v1/auth/logout").send({ reason: "idle" });
      expect(out.status).toBe(204);
      expect((await one("SELECT end_reason FROM user_session WHERE session_id = $1", [sid])).end_reason).toBe("inactivity_timeout");
      expect((await agent.post("/api/v1/auth/logout").send({ reason: "away" })).status).toBe(422);
    });

    test("My Security lists the sign-ins, marks this one, and ends another", async () => {
      const other = await signIn("ops@mycity.test", OPS_PASSWORD);
      const mine = await signIn("ops@mycity.test", OPS_PASSWORD);
      const list = await request(app).get("/api/v1/auth/sessions?status=active").set("Authorization", `Bearer ${mine.token}`);
      expect(list.status).toBe(200);
      expect(list.body.page.size).toBe(25);
      const current = list.body.data.filter((s) => s.current);
      expect(current).toHaveLength(1);
      const otherSid = JSON.parse(Buffer.from(other.token.split(".")[1], "base64url")).sid;
      const end = await request(app).post(`/api/v1/auth/sessions/${otherSid}/end`).set("Authorization", `Bearer ${mine.token}`).send({});
      expect(end.status).toBe(204);
      expect((await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${other.token}`)).status).toBe(401);
      const self = await request(app).post(`/api/v1/auth/sessions/${current[0].session_id}/end`).set("Authorization", `Bearer ${mine.token}`).send({});
      expect(self.status).toBe(422);
      const others = await request(app).post("/api/v1/auth/sessions/end-others").set("Authorization", `Bearer ${mine.token}`).send({});
      expect(others.status).toBe(200);
      const summary = await request(app).get("/api/v1/auth/security").set("Authorization", `Bearer ${mine.token}`);
      expect(summary.body).toEqual(expect.objectContaining({ active_sessions: 1, session_max_age: 7200, session_idle_limit: 1800 }));
    });
  });

  describe("passwords", () => {
    test("changing a password needs the current one, applies the rules, and signs out the other sessions", async () => {
      const elsewhere = await signIn("ops@mycity.test", OPS_PASSWORD);
      const here = await signIn("ops@mycity.test", OPS_PASSWORD);
      const auth = (r) => r.set("Authorization", `Bearer ${here.token}`);

      const wrong = await auth(request(app).post("/api/v1/auth/password")).send({ current_password: "nope", new_password: "Another-pass9" });
      expect(wrong.status).toBe(422);
      expect(wrong.body.error.fields.current_password).toEqual(["Not your password"]);

      const weak = await auth(request(app).post("/api/v1/auth/password")).send({ current_password: OPS_PASSWORD, new_password: "alllowercase1!" });
      expect(weak.status).toBe(422);
      expect(weak.body.error.fields.new_password).toEqual(["Add an uppercase letter"]);

      const named = await auth(request(app).post("/api/v1/auth/password")).send({ current_password: OPS_PASSWORD, new_password: "Ops-mail-pass9" });
      expect(named.status).toBe(422);
      expect(named.body.error.fields.new_password).toEqual(["Contains your email name"]);

      const okRes = await auth(request(app).post("/api/v1/auth/password")).send({ current_password: OPS_PASSWORD, new_password: "Fresh+Start2026" });
      expect(okRes.status).toBe(200);
      expect(okRes.body.sessions_signed_out).toBeGreaterThanOrEqual(1);
      expect((await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${elsewhere.token}`)).status).toBe(401);
      expect((await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${here.token}`)).status).toBe(200);

      // Back to the known password through the same route, for the tests that follow.
      const back = await auth(request(app).post("/api/v1/auth/password")).send({ current_password: "Fresh+Start2026", new_password: OPS_PASSWORD });
      expect(back.status).toBe(200);
    });

    test("forgot password answers the same for any email and mails a working link to a real one", async () => {
      const before = sent.length;
      const unknown = await request(app).post("/api/v1/auth/forgot").send({ email: "nobody@mycity.test" });
      expect(unknown.status).toBe(200);
      expect(unknown.body).toEqual({ ok: true });
      const known = await request(app).post("/api/v1/auth/forgot").send({ email: "ops@mycity.test" });
      expect(known.body).toEqual({ ok: true });
      await drain();
      expect(sent.length).toBe(before + 1);
      const job = sent[sent.length - 1];
      expect(job).toEqual(expect.objectContaining({ queue: "email-send", name: "password-reset" }));
      expect(job.opts.removeOnComplete).toBe(true);
      expect(job.data.data.minutes).toBe(30);
      expect(job.data.data.link_url).toMatch(/\/reset\?token=/);

      const token = lastLinkToken("password-reset");
      // The secret appears nowhere but the email.
      const leaked = await one("SELECT count(*)::int AS n FROM event_log WHERE payload::text LIKE '%' || $1 || '%'", [token]);
      expect(leaked.n).toBe(0);

      const check = await request(app).post("/api/v1/auth/link").send({ token });
      expect(check.status).toBe(200);
      expect(check.body).toEqual(expect.objectContaining({ purpose: "reset", email: "ops@mycity.test", first_name: "Ada" }));

      const session = await signIn("ops@mycity.test", OPS_PASSWORD);
      const reset = await request(app).post("/api/v1/auth/reset").send({ token, new_password: "Reset+Done2026" });
      expect(reset.status).toBe(200);
      expect(reset.body).toEqual({ email: "ops@mycity.test" });
      expect((await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${session.token}`)).status).toBe(401);
      expect((await signIn("ops@mycity.test", OPS_PASSWORD)).res.status).toBe(401);
      expect((await signIn("ops@mycity.test", "Reset+Done2026")).res.status).toBe(200);

      const again = await request(app).post("/api/v1/auth/reset").send({ token, new_password: "Second+Use2026" });
      expect(again.status).toBe(404);
      expect(again.body.error.code).toBe("LINK_INVALID");

      // A second request inside two minutes sends nothing new: one live link at a time.
      const repeat = sent.length;
      await request(app).post("/api/v1/auth/forgot").send({ email: "ops@mycity.test" });
      await drain();
      expect(sent.length).toBe(repeat);

      // Restore the known password, through the signed-in route.
      const { token: fresh } = await signIn("ops@mycity.test", "Reset+Done2026");
      const restore = await request(app)
        .post("/api/v1/auth/password")
        .set("Authorization", `Bearer ${fresh}`)
        .send({ current_password: "Reset+Done2026", new_password: OPS_PASSWORD });
      expect(restore.status).toBe(200);
      await q("UPDATE app_user SET failed_login_count = 0, last_failed_login_at = NULL");
    });
  });

  describe("Settings · Users", () => {
    let opsToken;
    beforeAll(async () => {
      opsToken = (await signIn("ops@mycity.test", OPS_PASSWORD)).token;
    });
    const asOps = (r) => r.set("Authorization", `Bearer ${opsToken}`);

    test("an employee is invited, chooses a password from the link, and signs in as Staff", async () => {
      const cands = await asOps(request(app).get("/api/v1/users/candidates"));
      expect(cands.status).toBe(200);
      expect(cands.body.data.map((c) => c.email)).toContain("bola@mycity.test");

      const invited = await asOps(request(app).post("/api/v1/users")).send({ employee_id: people.staffEmployee.employee_id, role_codes: ["employee"] });
      expect(invited.status).toBe(201);
      expect(invited.body).toEqual(expect.objectContaining({ email: "bola@mycity.test", status: "invited", roles: [{ code: "employee", name: "Staff" }] }));
      people.staffUserId = invited.body.user_id;

      // An invited login cannot sign in with anything until the password is chosen.
      expect((await signIn("bola@mycity.test", "!invited")).res.status).toBe(401);

      await drain();
      const job = sent[sent.length - 1];
      expect(job.data.template).toBe("user-invite");
      expect(job.data.data).toEqual(expect.objectContaining({ hours: 72, job_title: "Content Associate", invited_by: "Ada Obi" }));
      expect(job.data.data.link_url).toMatch(/\/welcome\?token=/);

      const token = lastLinkToken("user-invite");
      const link = await request(app).post("/api/v1/auth/link").send({ token });
      expect(link.body.purpose).toBe("invite");
      const set = await request(app).post("/api/v1/auth/reset").send({ token, new_password: STAFF_PASSWORD });
      expect(set.status).toBe(200);

      const { res } = await signIn("bola@mycity.test", STAFF_PASSWORD);
      expect(res.status).toBe(200);
      expect(res.body.user.home_view).toBe("staff");
      expect(res.body.user.grants.settings).toBeUndefined();
      expect(res.body.user.grants.ess).toEqual(["view", "create", "edit"]);
      expect(res.body.user.capabilities).toEqual([]);

      const row = await asOps(request(app).get(`/api/v1/users/${people.staffUserId}`));
      expect(row.body.status).toBe("active");
    });

    test("Staff cannot open Settings · Users", async () => {
      const { token } = await signIn("bola@mycity.test", STAFF_PASSWORD);
      const res = await request(app).get("/api/v1/users").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    test("the list, the summary and the roles answer in pages", async () => {
      const list = await asOps(request(app).get("/api/v1/users?status=active&sort=display_name"));
      expect(list.status).toBe(200);
      expect(list.body.data.map((u) => u.email)).toEqual(expect.arrayContaining(["ops@mycity.test", "bola@mycity.test"]));
      const summary = await asOps(request(app).get("/api/v1/users/summary"));
      expect(summary.body).toEqual(expect.objectContaining({ users: 3, invited: 0, suspended: 0 }));
      const roles = await asOps(request(app).get("/api/v1/access/roles"));
      expect(roles.body.data[0].code).toBe("implementation");
      expect(roles.body.data.map((r) => r.code)).toEqual(expect.arrayContaining(["operations_people", "management", "head_of_department", "administrator", "manager", "employee"]));
    });

    test("roles change, a suspension ends every session and stops sign-in, reactivation restores it", async () => {
      const staff = await signIn("bola@mycity.test", STAFF_PASSWORD);
      const roles = await asOps(request(app).post(`/api/v1/users/${people.staffUserId}/roles`)).send({ role_codes: ["manager"] });
      expect(roles.body.roles).toEqual([{ code: "manager", name: "Line Manager" }]);

      const suspended = await asOps(request(app).post(`/api/v1/users/${people.staffUserId}/suspend`)).send({ reason: "Left the project" });
      expect(suspended.body.status).toBe("suspended");
      expect((await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${staff.token}`)).status).toBe(401);
      const refused = await signIn("bola@mycity.test", STAFF_PASSWORD);
      expect(refused.res.status).toBe(403);
      expect(refused.res.body.error.code).toBe("ACCOUNT_SUSPENDED");
      // Before the right password, a suspended account looks like any wrong guess.
      expect((await signIn("bola@mycity.test", "Wrong-guess9")).res.status).toBe(401);

      const back = await asOps(request(app).post(`/api/v1/users/${people.staffUserId}/reactivate`)).send({});
      expect(back.body.status).toBe("active");
      await q("UPDATE app_user SET failed_login_count = 0, last_failed_login_at = NULL");
      expect((await signIn("bola@mycity.test", STAFF_PASSWORD)).res.status).toBe(200);

      const ended = await asOps(request(app).post(`/api/v1/users/${people.staffUserId}/end-sessions`)).send({});
      expect(ended.body.ended).toBeGreaterThanOrEqual(1);

      const audit = await q(
        `SELECT action, count(*)::int AS n FROM audit_ledger
          WHERE action IN ('access.roles_set', 'app_user.suspended', 'app_user.reactivated') AND entity_id = $1
          GROUP BY action ORDER BY action`,
        [people.staffUserId],
      );
      // The roles were set twice: when the invitation was sent, and changed here.
      expect(audit.rows).toEqual([
        { action: "access.roles_set", n: 2 },
        { action: "app_user.reactivated", n: 1 },
        { action: "app_user.suspended", n: 1 },
      ]);
      const sensitive = await one("SELECT bool_and(is_sensitive) AS all_marked FROM audit_ledger WHERE action = 'app_user.suspended'");
      expect(sensitive.all_marked).toBe(true);
    });

    test("nobody suspends or re-roles their own login here", async () => {
      const self = await asOps(request(app).post(`/api/v1/users/${people.ops.user.user_id}/suspend`)).send({ reason: "Testing myself" });
      expect(self.status).toBe(422);
    });

    test("a sign-in from a new browser tells the person, when they have used another before", async () => {
      await signIn("bola@mycity.test", STAFF_PASSWORD);
      await drain();
      const notes = await q(
        "SELECT title FROM notification n JOIN app_user u ON u.user_id = n.user_id WHERE u.email = 'bola@mycity.test' AND n.event_key = 'auth.signed_in'",
      );
      expect(notes.rows.length).toBeGreaterThanOrEqual(1);
      expect(notes.rows[0].title).toBe("New sign-in to your account");
    });
  });

  describe("create-admin", () => {
    test("refuses a weak password and an existing login", async () => {
      const payload = {
        employee: {
          first_name: "Tobi",
          last_name: "Dada",
          work_email: "tobi@mycity.test",
          phone: "08031234569",
          job_title: "Associate",
          department_name: "Backend Operations",
          start_date: "2026-03-02",
          employment_type: "full_time",
          work_pattern: "remote",
        },
        role_code: "employee",
        is_ceo: false,
      };
      await expect(tx((c) => createAdmin(c, payload, "weakpassword", { allowAdditional: true }))).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
      await expect(
        tx((c) => createAdmin(c, { ...payload, employee: { ...payload.employee, work_email: "ops@mycity.test" } }, "Strong-pass99", { allowAdditional: true })),
      ).rejects.toMatchObject({ code: "LOGIN_EXISTS" });
      const ok = await tx((c) => createAdmin(c, payload, "Strong-pass99", { allowAdditional: true }));
      expect(ok.employee.staff_number).toMatch(/^\d{5}$/);
      expect(ok.user.email).toBe("tobi@mycity.test");
    });

    test("the build account is a complete employee with the implementation role, and signs in", async () => {
      const { buildAccount } = require("../../scripts/db/create-admin");
      const made = await tx((c) => createAdmin(c, buildAccount("build@mycity.test"), "Implement#2026x"));
      expect(made.role.code).toBe("implementation");
      // Every column is filled except the references a first, remote account has nothing to
      // point at, and left_on.
      const whole = await one(`SELECT to_jsonb(e) AS e FROM employee e WHERE employee_id = $1`, [
        made.employee.employee_id,
      ]);
      const empty = Object.keys(whole.e).filter((k) => whole.e[k] === null).sort();
      expect(empty).toEqual([
        /* 0300 added archiving: a record that was never archived carries neither. */
        "archive_reason",
        "archived_at",
        "dotted_manager_id",
        "dotted_manager_seat_id",
        "left_on",
        "line_manager_id",
        "line_manager_seat_id",
        "worksite_id",
      ]);
      const row = await one(
        `SELECT e.first_name, e.middle_name, e.last_name, e.preferred_name, e.work_email::text AS work_email,
                e.personal_email::text AS personal_email, e.job_title, e.employment_type, e.work_pattern,
                e.phone, e.status, e.start_date::text AS start_date, e.contract_ends_on::text AS contract_ends_on,
                e.confirmation_due_on::text AS confirmation_due_on, e.confirmed_on::text AS confirmed_on,
                e.home_address, e.gender, e.date_of_birth::text AS date_of_birth, e.next_of_kin_name,
                e.next_of_kin_phone, e.next_of_kin_relationship, e.bank_name, e.account_number,
                e.gross_monthly::text AS gross_monthly, d.name AS department
           FROM employee e JOIN department d USING (department_id) WHERE e.employee_id = $1`,
        [made.employee.employee_id],
      );
      expect(row).toEqual({
        first_name: "JBS Praxis",
        middle_name: "Implementation",
        last_name: "Team",
        preferred_name: "JBS Praxis",
        work_email: "build@mycity.test",
        personal_email: "build@mycity.test",
        job_title: "Implementation Partner",
        employment_type: "consultant",
        work_pattern: "remote",
        phone: "+2348027492738",
        status: "active",
        start_date: "2026-10-09",
        contract_ends_on: "2026-12-09",
        confirmation_due_on: "2026-10-09",
        confirmed_on: "2026-10-09",
        home_address: "14 Adeola Odeku Street, Victoria Island, Lagos",
        gender: "male",
        date_of_birth: "1990-03-12",
        next_of_kin_name: "JBS Praxis Office",
        next_of_kin_phone: "+2348027492738",
        next_of_kin_relationship: "Employer",
        bank_name: "Zenith Bank",
        account_number: "0000000000",
        gross_monthly: "1850000.00",
        department: "Implementation",
      });
      const { res } = await signIn("build@mycity.test", "Implement#2026x");
      expect(res.status).toBe(200);
      expect(res.body.user.roles).toEqual([expect.objectContaining({ code: "implementation" })]);
    });
  });
});
