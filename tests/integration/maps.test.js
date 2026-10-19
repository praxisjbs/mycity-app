"use strict";
/**
 * The address search end to end (docs/guides/foundation.md §6.12): GET /maps/search on the
 * real migrations, through HTTP. Anyone signed in may ask; nobody else; a search under three
 * characters is refused by the contract; and an environment without a Geoapify key answers
 * 503 MAPS_OFF rather than asking the provider. What the provider's answers become is the
 * unit test's (src/modules/maps/maps.test.js): nothing here leaves the machine.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/maps
 *
 * Refuses to run unless the database name ends in "_test". The person here is invented.
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
const PASSWORD = "Find-The-Place9";

describeDb("the address search against the real migrations", () => {
  let app;
  let token;

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    const client = await pool.connect();
    try {
      await atomically(client, () =>
        createAdmin(
          client,
          {
            employee: {
              first_name: "Kelechi",
              last_name: "Testbed",
              work_email: "kelechi@mycity.test",
              phone: "08031230000",
              job_title: "Field Officer",
              department_name: "Operations",
              start_date: "2026-02-02",
              employment_type: "full_time",
              work_pattern: "on_site",
            },
            role_code: "employee",
            is_ceo: false,
          },
          PASSWORD,
          { allowAdditional: true },
        ),
      );
    } finally {
      client.release();
    }
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", "10.71.0.1")
      .send({ email: "kelechi@mycity.test", password: PASSWORD });
    expect(res.status).toBe(200);
    token = res.body.access_token;
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  const search = (q, auth = true) => {
    const req = request(app).get("/api/v1/maps/search").query({ q });
    return auth ? req.set("Authorization", `Bearer ${token}`) : req;
  };

  test("nobody signed out may search", async () => {
    expect((await search("Admiralty Way", false)).status).toBe(401);
  });

  test("fewer than three characters is a 422 naming the query's q", async () => {
    const res = await search("ab");
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.fields)).toContain("query.q");
  });

  test("an employee with no module grant may search; with no key it says the search is off", async () => {
    if (config.GEOAPIFY_API_KEY) return;
    const res = await search("Admiralty Way");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("MAPS_OFF");
  });
});
