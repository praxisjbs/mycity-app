"use strict";
/**
 * Maps end to end (docs/guides/foundation.md §6.12): the address search, the tiles and a
 * worksite's address on the real migrations, through HTTP. Anyone signed in may search and
 * load a tile; nobody else; only those who set worksites up may look an address up for a
 * point; the contract refuses a short search, a tile that cannot exist and a point that is
 * not degrees; and an environment without a Geoapify key answers 503 MAPS_OFF rather than
 * asking the provider. What the provider's answers become is the unit test's
 * (src/modules/maps/maps.test.js): nothing here leaves the machine.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/maps
 *
 * Refuses to run unless the database name ends in "_test". The people here are invented.
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
  const tokens = {};

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    const roster = [
      ["staff", "Kelechi", "employee", "Field Officer", "08031230000"],
      ["ops", "Halima", "operations_people", "Operations Lead", "08031230001"],
    ];
    let ip = 0;
    for (const [key, first, role, job, phone] of roster) {
      const client = await pool.connect();
      try {
        await atomically(client, () =>
          createAdmin(
            client,
            {
              employee: {
                first_name: first,
                last_name: "Testbed",
                work_email: `${key}@mycity.test`,
                phone,
                job_title: job,
                department_name: "Operations",
                start_date: "2026-02-02",
                employment_type: "full_time",
                work_pattern: "on_site",
              },
              role_code: role,
              is_ceo: false,
            },
            PASSWORD,
            { allowAdditional: true },
          ),
        );
      } finally {
        client.release();
      }
      ip += 1;
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.71.0.${ip}`)
        .send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  const as = (who, req) => (who ? req.set("Authorization", `Bearer ${tokens[who]}`) : req);
  const search = (q, who = "staff") => as(who, request(app).get("/api/v1/maps/search").query({ q }));
  const tile = (path, who = "staff") => as(who, request(app).get(`/api/v1/maps/tiles/${path}`));
  const reverse = (query, who) => as(who, request(app).get("/api/v1/maps/reverse").query(query));

  test("nobody signed out may search", async () => {
    expect((await search("Admiralty Way", null)).status).toBe(401);
    expect((await tile("15/18525/15632.png", null)).status).toBe(401);
    expect((await reverse({ lat: "6.4321", lon: "3.4219" }, null)).status).toBe(401);
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

  test("a tile that cannot exist is refused by the contract; a real one with no key is 503", async () => {
    expect((await tile("2/4/0.png")).status).toBe(422);
    expect((await tile("a/b/c.png")).status).toBe(422);
    if (config.GEOAPIFY_API_KEY) return;
    const res = await tile("15/18525/15632.png");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("MAPS_OFF");
  });

  test("an address for a point is only for those who set worksites up", async () => {
    const staff = await reverse({ lat: "6.4321", lon: "3.4219" }, "staff");
    expect(staff.status).toBe(403);
    const bad = await reverse({ lat: "", lon: "3.4219" }, "ops");
    expect(bad.status).toBe(422);
    if (config.GEOAPIFY_API_KEY) return;
    const ops = await reverse({ lat: "6.4321", lon: "3.4219" }, "ops");
    expect(ops.status).toBe(503);
    expect(ops.body.error.code).toBe("MAPS_OFF");
  });
});
