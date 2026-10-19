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
/** A one-pixel PNG: enough for the image pipeline to crop and size as an avatar. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

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
    // As the app's UploadField sends it: the file and its purpose.
    upload: (path, file, name) =>
      request(app)
        .post(`/api/v1${path}`)
        .set("Authorization", `Bearer ${tokens[who]}`)
        .field("purpose", "avatar")
        .attach("file", file, name),
    del: (path) => request(app).delete(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
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
    expect(week[5]).toEqual({ weekday: 6, is_working_day: true, starts_at: "09:00", ends_at: "15:00" });
    expect(week[6]).toMatchObject({ weekday: 7, is_working_day: false, starts_at: null });
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

  test("my photo: uploaded, shown to colleagues and in my session, then removed", async () => {
    expect((await as("staff").get("/ess/profile")).body.photo_url).toBeNull();
    // Not a picture: refused by the upload engine.
    expect((await as("staff").upload("/ess/profile/photo", Buffer.from("not an image"), "me.png")).status).toBe(415);

    // Answered as every upload is, with the stored file: the app's upload engine waits for its id.
    const set = await as("staff").upload("/ess/profile/photo", PNG, "me.png");
    expect(set.status).toBe(200);
    expect(set.body.document_id).toMatch(/^[0-9a-f-]{36}$/);
    const url = (await as("staff").get("/ess/profile")).body.photo_url;
    expect(url).toBe(`/api/v1/documents/${set.body.document_id}/variant/webp-384`);
    expect((await as("staff").get("/auth/me")).body.photo_url).toBe(url);
    // Any colleague may see it.
    const seen = await request(app).get(url).set("Authorization", `Bearer ${tokens.ops}`);
    expect(seen.status).toBe(200);
    expect(seen.headers["content-type"]).toMatch(/image\/webp/);
    const changed = await q(
      "SELECT count(*)::int AS n FROM event_outbox WHERE event_key = 'employee.photo_updated'",
    );
    expect(changed.rows[0].n).toBe(1);

    const gone = await as("staff").del("/ess/profile/photo");
    expect(gone.status).toBe(200);
    expect(gone.body.photo_url).toBeNull();
    expect((await as("staff").get("/auth/me")).body.photo_url).toBeNull();
  });

  test("my photo shows wherever I appear: the register, leave, Community and the org chart", async () => {
    const staff = people.staff.employee.employee_id;
    // A leave request, so People · Leave has a row of mine.
    const types = (await as("staff").get("/leave/types?active=true")).body.data;
    const annual = types.find((t) => t.code === "annual");
    const day = new Date(Date.now() + 21 * 86_400_000);
    while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() + 1);
    const on = day.toISOString().slice(0, 10);
    const asked = await request(app)
      .post("/api/v1/ess/leave")
      .set("Authorization", `Bearer ${tokens.staff}`)
      .send({ leave_type_id: annual.leave_type_id, starts_on: on, ends_on: on });
    expect(asked.status).toBe(201);

    /** My photo_url on each list a colleague reads. */
    const seen = async () => {
      const register = (await as("ops").get("/employees")).body.data.find((r) => r.employee_id === staff);
      const leave = (await as("ops").get("/leave/requests")).body.data.find((r) => r.employee.employee_id === staff);
      const colleagues = (await as("ops").get("/community/people")).body.data.find((p) => p.employee_id === staff);
      const node = (await as("ops").get("/org-chart")).body.nodes.find((n) => n.employee_id === staff);
      return [register.photo_url, leave.employee.photo_url, colleagues.photo_url, node.photo_url];
    };
    expect(await seen()).toEqual([null, null, null, null]);

    const set = await as("staff").upload("/ess/profile/photo", PNG, "me.png");
    expect(set.status).toBe(200);
    // Lists read the 192 px size; My Profile keeps the 384 px one.
    const small = `/api/v1/documents/${set.body.document_id}/variant/webp-192`;
    expect(await seen()).toEqual([small, small, small, small]);
    expect((await request(app).get(small).set("Authorization", `Bearer ${tokens.manager}`)).status).toBe(200);
    // Someone without a photo still reads null beside mine.
    const manager = (await as("ops").get("/employees")).body.data.find((r) => r.employee_id === people.manager.employee.employee_id);
    expect(manager.photo_url).toBeNull();

    await as("staff").del("/ess/profile/photo");
    expect(await seen()).toEqual([null, null, null, null]);
  });
});
