"use strict";
/**
 * How an employee gets, keeps and loses a login (docs/guides/identity.md §6.1; the employee
 * creation audit of 25/10/2026, docs/guides/foundation.md §6.16), against the real migrations:
 *
 *  - archiving a record closes its login at once and for good: sign-in, the session, open links
 *    and Forgot Password all refuse; Restore does not reopen it; Reactivate waits for Restore;
 *  - a login nobody has used follows a corrected work email; one in use moves only with Use
 *    Work Email, after a fresh sign-in, and both addresses are told;
 *  - Invite All Pending emails every roster login nobody has invited yet;
 *  - a second login for one person is refused on the field the form shows;
 *  - someone who may only view Settings is refused every change.
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
const identity = require("../../src/modules/identity/identity.service");
const access = require("../../src/modules/access/access.service");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

const OPS_PASSWORD = "Opera!ions2026";
const MGMT_PASSWORD = "Manage#ment2026";
const LEFT_PASSWORD = "Leaving-soon9!";

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

describeDb("an employee's login, from invitation to leaving", () => {
  let app;
  let dept;
  const people = {};
  let ipSeq = 0;
  const ip = () => `10.40.${Math.floor((ipSeq += 1) / 250)}.${(ipSeq % 250) + 1}`;
  const signIn = (email, password) => request(app).post("/api/v1/auth/login").set("X-Forwarded-For", ip()).send({ email, password });
  const as = (token) => (r) => r.set("Authorization", `Bearer ${token}`).set("X-Forwarded-For", ip());
  let ops;
  let mgmt;

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

  /** A person with a record and, unless `login` is false, an invited login nobody has emailed (as the roster makes them). */
  async function person(first, email, { login = true } = {}) {
    return tx(async (client) => {
      const employee = await organisation.createEmployee(
        client,
        {
          first_name: first,
          last_name: "Test",
          work_email: email,
          phone: "+2348031234570",
          job_title: "Analyst",
          start_date: "2026-03-02",
          employment_type: "full_time",
          work_pattern: "remote",
          department_id: dept.department_id,
        },
        null,
      );
      if (!login) return { employee };
      const user = await identity.createUserForEmployee(client, { employee_id: employee.employee_id, email }, null);
      await access.setRoles(client, user.user_id, ["employee"], null);
      return { employee, user };
    });
  }

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    await tx(async (client) => {
      people.ops = await createAdmin(client, { employee: sample("Ada", "Obi", "ops@mycity.test", "Operations & People Lead"), role_code: "operations_people", is_ceo: false }, OPS_PASSWORD);
      people.mgmt = await createAdmin(client, { employee: sample("Kola", "Ade", "mgmt@mycity.test", "Head of Finance"), role_code: "management", is_ceo: false }, MGMT_PASSWORD);
      people.leaving = await createAdmin(client, { employee: sample("Bisi", "Lawal", "bisi@mycity.test", "Analyst"), role_code: "employee", is_ceo: false }, LEFT_PASSWORD, { allowAdditional: true });
    });
    dept = await one("SELECT department_id FROM department WHERE name = 'HR & Operations'");
    await drain();
    ops = (await signIn("ops@mycity.test", OPS_PASSWORD)).body.access_token;
    mgmt = (await signIn("mgmt@mycity.test", MGMT_PASSWORD)).body.access_token;
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  describe("leaving: archiving a record closes its login", () => {
    let token;
    let reset;

    test("the person can sign in before", async () => {
      const res = await signIn("bisi@mycity.test", LEFT_PASSWORD);
      expect(res.status).toBe(200);
      token = res.body.access_token;
      // An administrator's reset link, still open when they leave.
      const link = await as(ops)(request(app).post(`/api/v1/users/${people.leaving.user.user_id}/reset-link`)).send({});
      expect(link.status).toBe(200);
      await drain();
      reset = new URL(sent.filter((s) => s.data && s.data.template === "password-reset").pop().data.data.link_url).searchParams.get("token");
    });

    test("once archived, sign-in, Forgot Password and their open link refuse at once, before any job runs", async () => {
      const res = await as(ops)(request(app).post(`/api/v1/employees/${people.leaving.employee.employee_id}/archive`)).send({ archive_reason: "Left the company" });
      expect(res.status).toBe(200);
      expect(res.body.login.state).toBe("left");
      const again = await signIn("bisi@mycity.test", LEFT_PASSWORD);
      expect(again.status).toBe(403);
      expect(again.body.error.message).toBe("This account is closed.");
      const link = await request(app).post("/api/v1/auth/link").send({ token: reset });
      expect(link.status).toBe(404);
      const before = sent.length;
      await request(app).post("/api/v1/auth/forgot").set("X-Forwarded-For", ip()).send({ email: "bisi@mycity.test" });
      await drain();
      expect(sent.slice(before).filter((s) => s.data && s.data.template === "password-reset")).toHaveLength(0);
    });

    test("the job closes the login, ends every session and spends every link", async () => {
      await drain();
      expect(await one("SELECT status FROM app_user WHERE user_id = $1", [people.leaving.user.user_id])).toEqual({ status: "left" });
      expect(await one("SELECT count(*)::int AS n FROM user_session WHERE user_id = $1 AND killed_at IS NULL", [people.leaving.user.user_id])).toEqual({ n: 0 });
      expect(await one("SELECT count(*)::int AS n FROM password_reset WHERE user_id = $1 AND used_at IS NULL", [people.leaving.user.user_id])).toEqual({ n: 0 });
      const me = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${token}`);
      expect(me.status).toBe(401);
      const row = await as(ops)(request(app).get(`/api/v1/users/${people.leaving.user.user_id}`));
      expect(row.body.status).toBe("left");
      const left = await as(ops)(request(app).get("/api/v1/users?status=left"));
      expect(left.body.data.map((u) => u.user_id)).toContain(people.leaving.user.user_id);
      const summary = await as(ops)(request(app).get("/api/v1/users/summary"));
      expect(summary.status).toBe(200);
    });

    test("Reactivate waits for Restore, and Restore alone does not reopen the login", async () => {
      const early = await as(ops)(request(app).post(`/api/v1/users/${people.leaving.user.user_id}/reactivate`)).send({});
      expect(early.status).toBe(422);
      expect(early.body.error.code).toBe("EMPLOYEE_NOT_ACTIVE");
      await as(ops)(request(app).post(`/api/v1/employees/${people.leaving.employee.employee_id}/restore`)).send({});
      expect((await signIn("bisi@mycity.test", LEFT_PASSWORD)).status).toBe(403);
      const now = await as(ops)(request(app).post(`/api/v1/users/${people.leaving.user.user_id}/reactivate`)).send({});
      expect(now.status).toBe(200);
      expect((await signIn("bisi@mycity.test", LEFT_PASSWORD)).status).toBe(200);
    });
  });

  describe("a corrected work email", () => {
    test("a login nobody has used follows it, and its old invitation stops working", async () => {
      const { employee, user } = await person("Chinyere", "chinyere@gheil.com");
      await as(ops)(request(app).post(`/api/v1/users/${user.user_id}/invite`)).send({});
      await drain();
      const res = await as(ops)(request(app).patch(`/api/v1/employees/${employee.employee_id}`)).send({ work_email: "chinyere@gmail.com" });
      expect(res.status).toBe(200);
      await drain();
      expect(await one("SELECT email::text AS email FROM app_user WHERE user_id = $1", [user.user_id])).toEqual({ email: "chinyere@gmail.com" });
      expect(await one("SELECT count(*)::int AS n FROM password_reset WHERE user_id = $1 AND used_at IS NULL", [user.user_id])).toEqual({ n: 0 });
    });

    test("a login in use stays until Use Work Email, which tells both addresses and signs them out", async () => {
      const { employee, user } = await person("Dayo", "dayo@mycity.test");
      await q("UPDATE app_user SET password_changed_at = now() WHERE user_id = $1", [user.user_id]);
      await as(ops)(request(app).patch(`/api/v1/employees/${employee.employee_id}`)).send({ work_email: "dayo.ade@mycity.test" });
      await drain();
      const row = await as(ops)(request(app).get(`/api/v1/users/${user.user_id}`));
      expect(row.body).toMatchObject({ email: "dayo@mycity.test", work_email: "dayo.ade@mycity.test" });
      const before = sent.length;
      const moved = await as(ops)(request(app).post(`/api/v1/users/${user.user_id}/use-work-email`)).send({});
      expect(moved.status).toBe(200);
      expect(moved.body.email).toBe("dayo.ade@mycity.test");
      await drain();
      const told = sent.slice(before).filter((s) => s.data && s.data.template === "notification").map((s) => s.data.to.email);
      expect(told.sort()).toEqual(["dayo.ade@mycity.test", "dayo@mycity.test"]);
    });

    test("a new record cannot take an address another person's login still signs in with", async () => {
      const { employee } = await person("Emeka", "emeka@mycity.test");
      await q("UPDATE app_user SET password_changed_at = now() WHERE employee_id = $1", [employee.employee_id]);
      await as(ops)(request(app).patch(`/api/v1/employees/${employee.employee_id}`)).send({ work_email: "emeka.obi@mycity.test" });
      await drain();
      const res = await as(ops)(request(app).post("/api/v1/employees")).send({
        first_name: "New",
        last_name: "Hire",
        work_email: "emeka@mycity.test",
        phone: "08031234575",
        job_title: "Analyst",
        start_date: "2026-04-01",
        employment_type: "full_time",
        work_pattern: "remote",
        department_id: dept.department_id,
      });
      expect(res.status).toBe(409);
      expect(res.body.error.fields).toEqual({ work_email: ["Used by a login"] });
    });
  });

  describe("invitations", () => {
    test("Invite All Pending emails every login nobody has invited, once", async () => {
      const a = await person("Femi", "femi@mycity.test");
      const b = await person("Gbenga", "gbenga@mycity.test");
      const first = await as(ops)(request(app).post("/api/v1/users/invite-pending")).send({});
      expect(first.status).toBe(200);
      expect(first.body.sent).toBeGreaterThanOrEqual(2);
      await drain();
      const invited = sent.filter((s) => s.data && s.data.template === "user-invite").map((s) => s.data.to.email);
      expect(invited).toEqual(expect.arrayContaining(["femi@mycity.test", "gbenga@mycity.test"]));
      const row = await as(ops)(request(app).get(`/api/v1/users/${a.user.user_id}`));
      expect(row.body.invited_at).not.toBeNull();
      const second = await as(ops)(request(app).post("/api/v1/users/invite-pending")).send({});
      expect(second.body.sent).toBe(0);
      expect(b.user.user_id).toBeTruthy();
    });

    test("a second login for one person is refused on the Employee field", async () => {
      const { employee } = await person("Halima", "halima@mycity.test", { login: false });
      const first = await as(ops)(request(app).post("/api/v1/users")).send({ employee_id: employee.employee_id, role_codes: ["employee"] });
      expect(first.status).toBe(201);
      const second = await as(ops)(request(app).post("/api/v1/users")).send({ employee_id: employee.employee_id, role_codes: ["employee"] });
      expect(second.status).toBe(409);
      expect(second.body.error.fields).toEqual({ employee_id: ["Already has a login"] });
    });

    test("one employee never holds two logins, even past the service's checks (migration 0500)", async () => {
      const { employee } = await person("Ibrahim", "ibrahim@mycity.test");
      await expect(
        q("INSERT INTO app_user (employee_id, email, password_hash) VALUES ($1, 'ibrahim.two@mycity.test', 'test-only')", [employee.employee_id]),
      ).rejects.toMatchObject({ code: "23505" });
    });
  });

  describe("view only", () => {
    test("someone who may only view Settings is refused every change to a login", async () => {
      const target = people.ops.user.user_id;
      for (const path of ["invite", "reset-link", "use-work-email", "reactivate"]) {
        const res = await as(mgmt)(request(app).post(`/api/v1/users/${target}/${path}`)).send({});
        expect([path, res.status]).toEqual([path, 403]);
      }
      expect((await as(mgmt)(request(app).post("/api/v1/users/invite-pending")).send({})).status).toBe(403);
    });
  });
});
