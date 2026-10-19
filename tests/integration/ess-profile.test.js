"use strict";
/**
 * ESS · My Profile end to end (docs/guides/ess.md §6, §10): the real migrations on a
 * throwaway database, the whole app through HTTP, every response parsed with its
 * contract (APP_ENV=test).
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/ess-profile
 *
 * Refuses to run unless the database name ends in "_test". Every person here is invented.
 */
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const PASSWORD = "Profile-Page9Test";

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

describeDb("My Profile against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  let ip = 0;

  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
    patch: (path, body = {}) =>
      request(app).patch(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
  });

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    const make = (key, first, last, role, job) =>
      tx(async (client) => {
        people[key] = await createAdmin(
          client,
          {
            employee: {
              first_name: first,
              last_name: last,
              work_email: `${key}@mycity.test`,
              phone: "08031234567",
              job_title: job,
              department_name: "Programmes",
              start_date: "2026-01-05",
              employment_type: "full_time",
              work_pattern: "hybrid",
            },
            role_code: role,
            is_ceo: false,
          },
          PASSWORD,
          { allowAdditional: true },
        );
      });
    await make("ops", "Tunde", "Bakare", "operations_people", "Operations Lead");
    await make("manager", "Kemi", "Alade", "manager", "Programme Lead");
    await make("staff", "Musa", "Danjuma", "employee", "Field Officer");
    await q(
      "UPDATE employee SET line_manager_id = $1, bank_name = 'Zenith', account_number = '0123456789' WHERE employee_id = $2",
      [people.manager.employee.employee_id, people.staff.employee.employee_id],
    );
    await require("../../src/shared/rbac/grants-cache").bumpTeamVersion();
    await drain();
    for (const key of Object.keys(people)) {
      ip += 1;
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.62.0.${ip}`)
        .send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("signed out is a 401", async () => {
    expect((await request(app).get("/api/v1/ess/profile")).status).toBe(401);
  });

  test("my record: my job, my manager, the last four of my account, the organisation's week", async () => {
    const res = await as("staff").get("/ess/profile");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      display_name: "Musa Danjuma",
      job_title: "Field Officer",
      department: "Programmes",
      work_pattern: "hybrid",
      bank_name: "Zenith",
      account_last4: "6789",
      line_manager: { display_name: "Kemi Alade", vacant: false },
    });
    expect(JSON.stringify(res.body)).not.toContain("0123456789");
    const week = res.body.working_week;
    expect(week.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // A22: Saturday is a working day, 09:00 to 15:00; Sunday is not.
    // Each day's place is the attendance module's: an on-site employee works every working day at the office.
    expect(week[5]).toEqual({ weekday: 6, is_working_day: true, starts_at: "09:00", ends_at: "15:00", place: "office" });
    expect(week[6]).toMatchObject({ weekday: 7, is_working_day: false, starts_at: null, place: "off" });
  });

  test("I change my contact and next of kin; nothing else is mine to change", async () => {
    const res = await as("staff").patch("/ess/profile", {
      phone: "0803 765 4321",
      home_address: "12 Bode Thomas Street, Surulere",
      next_of_kin_name: "Aisha Danjuma",
      next_of_kin_relationship: "Sister",
      next_of_kin_phone: "08051112222",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      phone: "+2348037654321",
      home_address: "12 Bode Thomas Street, Surulere",
      next_of_kin_name: "Aisha Danjuma",
    });
    expect((await as("staff").patch("/ess/profile", { job_title: "Director" })).status).toBe(422);
    expect((await as("staff").patch("/ess/profile", {})).status).toBe(422);
    expect((await as("staff").patch("/ess/profile", { account_number: "123" })).status).toBe(422);
    // A field the form left empty changes nothing.
    const kept = await as("staff").patch("/ess/profile", { phone: "", home_address: "", next_of_kin_name: "Aisha Danjuma" });
    expect(kept.status).toBe(200);
    expect(kept.body).toMatchObject({ phone: "+2348037654321", home_address: "12 Bode Thomas Street, Surulere" });
    expect((await as("staff").patch("/ess/profile", { phone: "", account_number: "" })).status).toBe(422);

    const history = await as("staff").get("/ess/profile/history");
    expect(history.status).toBe(200);
    expect(history.body.data[0].summary).toMatch(/^Record changed/);
  });

  test("a bank change tells Operations & People, not my manager", async () => {
    const res = await as("staff").patch("/ess/profile", { bank_name: "GTBank", account_number: "9988776655" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ bank_name: "GTBank", account_last4: "6655" });
    await drain();
    const told = async (who) =>
      (
        await q("SELECT title FROM notification WHERE user_id = $1 AND event_key = 'employee.bank_details_changed'", [
          people[who].user.user_id,
        ])
      ).rows.map((r) => r.title);
    expect(await told("ops")).toEqual(["Bank details changed"]);
    expect(await told("manager")).toEqual([]);
    expect(await told("staff")).toEqual([]);

    // A change that leaves the bank as it is tells nobody.
    await as("staff").patch("/ess/profile", { phone: "08037654321" });
    await drain();
    expect(await told("ops")).toHaveLength(1);
  });

  test("each person reads only their own record", async () => {
    const mine = await as("manager").get("/ess/profile");
    expect(mine.body.display_name).toBe("Kemi Alade");
    expect(mine.body.line_manager).toBeNull();
  });
});
