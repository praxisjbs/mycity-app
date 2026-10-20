"use strict";
/**
 * Addresses end to end (docs/guides/addresses.md): the address search, the pin and the tiles on
 * the real migrations, through HTTP, and an address saved by the owners a person edits. Anyone
 * signed in may search, pin and load a tile; nobody else. With no Geoapify key the search says it
 * is off (503 MAPS_OFF) rather than asking anyone; with a key the provider is a fake fetch, so
 * nothing leaves the machine. A typed, altered or too coarse address is refused on its field; a
 * pick is kept with its line, details first; the device's location stands in while search is
 * down and the places-name job names it once search is back; every address saved before the
 * rule is kept as typed and unverified.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/maps
 *
 * Refuses to run unless the database name ends in "_test". The people and places are invented.
 */
const fs = require("node:fs");
const path = require("node:path");
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const integrations = require("../../src/shared/integrations/settings");
const geoapify = require("../../src/services/maps/geoapify.service");
const maps = require("../../src/modules/maps/maps.service");
const token = require("../../src/shared/places/token");
const { device } = require("../helpers/places");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;
const PASSWORD = "Find-The-Place9";

/** What the fake provider knows: three places for any text, and one building for any point. */
const FOUND = [
  { place_id: "g-1", formatted: "12 Testbed Road, Ikeja, Lagos", lat: 6.6018, lon: 3.3515, result_type: "building", city: "Lagos", state: "Lagos State", country_code: "ng" },
  { place_id: "g-2", formatted: "Testbed Mall, Ikeja, Lagos", lat: 6.6031, lon: 3.3502, result_type: "amenity", city: "Lagos" },
  { place_id: "g-3", formatted: "Ikeja, Lagos", lat: 6.6059, lon: 3.3491, result_type: "suburb", city: "Lagos" },
];
const NEAR = { place_id: "g-9", formatted: "7 Pinned Close, Yaba, Lagos", lat: 6.5095, lon: 3.3711, result_type: "building", city: "Lagos" };

describeDb("addresses against the real migrations", () => {
  let app;
  const tokens = {};

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    const roster = [
      ["staff", "Kelechi", "employee", "Field Officer", "08031230000", false],
      ["ops", "Halima", "operations_people", "Operations Lead", "08031230001", false],
      ["ceo", "Amaka", "management", "Chief Executive Officer", "08031230002", true],
    ];
    let ip = 0;
    for (const [key, first, role, job, phone, isCeo] of roster) {
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
              is_ceo: isCeo,
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
  const search = (q, who = "staff", level) => as(who, request(app).get("/api/v1/maps/search").query(level ? { q, level } : { q }));
  const pin = (query, who = "staff") => as(who, request(app).get("/api/v1/maps/pin").query(query));
  const tile = (where, who = "staff") => as(who, request(app).get(`/api/v1/maps/tiles/${where}`));
  const api = (who) => ({
    get: (p) => as(who, request(app).get(`/api/v1${p}`)),
    post: (p, body) => as(who, request(app).post(`/api/v1${p}`)).send(body),
    patch: (p, body) => as(who, request(app).patch(`/api/v1${p}`)).send(body),
  });
  const q = (sql, params) => pool.query(sql, params);

  test("nobody signed out may search, pin or load a map", async () => {
    expect((await search("Admiralty Way", null)).status).toBe(401);
    expect((await pin({ lat: "6.4321", lon: "3.4219" }, null)).status).toBe(401);
    expect((await tile("15/18525/15632.png", null)).status).toBe(401);
  });

  test("one character is a 422 naming the query's q; a pin must be degrees; a tile must exist", async () => {
    const res = await search("a");
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.fields)).toContain("query.q");
    expect((await pin({ lat: "", lon: "3.4219" })).status).toBe(422);
    expect((await pin({ lat: "6.4", lon: "3.4", level: "town" })).status).toBe(422);
    expect((await tile("2/4/0.png")).status).toBe(422);
    expect((await tile("a/b/c.png")).status).toBe(422);
  });

  test("with no key, an employee with no module grant is told search is off, never an error page", async () => {
    if (config.GEOAPIFY_API_KEY) return;
    for (const res of [await search("Admiralty Way"), await pin({ lat: "6.4321", lon: "3.4219" }), await tile("15/18525/15632.png")]) {
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("MAPS_OFF");
    }
  });

  describe("with a key, against a fake provider", () => {
    const asked = [];
    let up = true;
    const secret = integrations.secret;

    beforeEach(() => {
      jest.spyOn(integrations, "secret").mockImplementation((code, name) => (code === "geoapify" ? Promise.resolve("test-key") : secret(code, name)));
      jest.spyOn(global, "fetch").mockImplementation(async (url) => {
        const u = new URL(String(url));
        asked.push(u);
        if (!up) return { ok: false, status: 503, json: async () => ({}) };
        const results = u.pathname.endsWith("/reverse") ? [NEAR] : FOUND;
        return { ok: true, status: 200, json: async () => ({ results }) };
      });
      geoapify.clearCache();
      asked.length = 0;
      up = true;
    });
    afterEach(() => jest.restoreAllMocks());

    const pick = async (formatted, level) => {
      const res = await search("Testbed", "staff", level);
      return res.body.places.find((p) => p.formatted === formatted);
    };

    test("a search answers signed places of the field's level, and the same text again asks nobody", async () => {
      const res = await search("Testbed");
      expect(res.status).toBe(200);
      expect(res.body.places.map((p) => [p.place_id, p.kind])).toEqual([["g-1", "building"], ["g-2", "landmark"]]);
      for (const p of res.body.places) expect(token.verify(p.token)).toBe(true);
      expect(asked[0].searchParams.get("apiKey")).toBe("test-key");
      await search("  testbed ");
      expect(asked).toHaveLength(1);
      const wider = await search("Testbed", "staff", "area");
      expect(wider.body.places.map((p) => p.place_id)).toEqual(["g-1", "g-2", "g-3"]);
      expect(asked).toHaveLength(2);
    });

    test("a pin names the nearest address and keeps the point tapped", async () => {
      const res = await pin({ lat: "6.50951", lon: "3.37112" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ formatted: "7 Pinned Close, Yaba, Lagos", lat: 6.50951, lon: 3.37112, kind: "building" });
      expect(token.verify(res.body.token)).toBe(true);
    });

    test("a worksite keeps the address picked, details first; typed, altered or too coarse is refused on the field", async () => {
      const road = await pick("12 Testbed Road, Ikeja, Lagos");
      const site = { name: "Testbed Depot", latitude: 6.6018, longitude: 3.3515, radius_m: 100 };
      const made = await api("ops").post("/worksites", { ...site, address: { token: road.token, details: "Gate 2" } });
      expect(made.status).toBe(201);
      expect(made.body.address).toBe("Gate 2, 12 Testbed Road, Ikeja, Lagos");
      expect(made.body.address_place).toMatchObject({ formatted: road.formatted, details: "Gate 2", source: "search", kind: "building", verified: true, pending: false });

      const refused = async (address) => {
        const res = await api("ops").post("/worksites", { ...site, name: "Refused Depot", address });
        expect(res.status).toBe(422);
        return res.body.error.fields;
      };
      expect(await refused("12 Testbed Road")).toEqual({ address: ["Pick an address"] });
      expect(await refused({ details: "Gate 2" })).toEqual({ address: ["Pick an address"] });
      const [v, , sig] = road.token.split(".");
      const forged = Buffer.from(JSON.stringify({ s: "search", f: "1 Forged Lane", la: 6.6, lo: 3.3, k: "building", v: true, p: false })).toString("base64url");
      expect(await refused({ token: `${v}.${forged}.${sig}` })).toEqual({ address: ["Pick an address"] });
      const suburb = await pick("Ikeja, Lagos", "area");
      expect(await refused({ token: suburb.token })).toEqual({ address: ["Pick a street or building"] });
      expect((await q("SELECT count(*)::int AS n FROM worksite WHERE name = 'Refused Depot'")).rows[0].n).toBe(0);

      // Opened for editing, the address goes back as it came; a new Details line needs no new pick.
      const id = made.body.worksite_id;
      const open = (await api("ops").get(`/worksites/${id}`)).body;
      const moved = await api("ops").patch(`/worksites/${id}`, { address: { token: open.address_place.token, details: "Gate 3" } });
      expect(moved.status).toBe(200);
      expect(moved.body.address).toBe("Gate 3, 12 Testbed Road, Ikeja, Lagos");
      const listed = (await api("ops").get("/worksites")).body.data.find((w) => w.worksite_id === id);
      expect(listed.address_place).toMatchObject({ details: "Gate 3", source: "search" });

      const cleared = await api("ops").patch(`/worksites/${id}`, { address: null });
      expect(cleared.body).toMatchObject({ address: null, address_place: null });
      expect((await q("SELECT count(*)::int AS n FROM place WHERE owner = 'worksite.address' AND owner_key = $1", [id])).rows[0].n).toBe(0);
    });

    test("the company's address and my home address are picked the same way", async () => {
      const road = await pick("12 Testbed Road, Ikeja, Lagos");
      const org = await api("ceo").patch("/settings/organisation", { address: { token: road.token } });
      expect(org.status).toBe(200);
      expect(org.body).toMatchObject({ address: "12 Testbed Road, Ikeja, Lagos", address_place: { source: "search", verified: true } });
      expect((await api("ceo").patch("/settings/organisation", { address: "12 Testbed Road" })).status).toBe(422);

      const spot = (await pin({ lat: "6.50951", lon: "3.37112" })).body;
      const mine = await api("staff").patch("/ess/profile", { home_address: { token: spot.token, details: "Flat 3" } });
      expect(mine.status).toBe(200);
      expect(mine.body).toMatchObject({ home_address: "Flat 3, 7 Pinned Close, Yaba, Lagos", home_address_place: { source: "pin", details: "Flat 3" } });
      const typed = await api("staff").patch("/ess/profile", { home_address: "7 Pinned Close" });
      expect([typed.status, typed.body.error.fields]).toEqual([422, { home_address: ["Pick an address"] }]);
      // A field the form leaves out is left as it is.
      const kept = await api("staff").patch("/ess/profile", { next_of_kin_name: "Aisha Testbed" });
      expect(kept.body.home_address).toBe("Flat 3, 7 Pinned Close, Yaba, Lagos");
    });

    test("while search is down the device's location stands in, and is named once search is back", async () => {
      up = false;
      const down = await search("Testbed Lane");
      expect([down.status, down.body.error.code]).toEqual([502, "MAPS_UNAVAILABLE"]);

      const made = await api("ops").post("/worksites", {
        name: "Outage Depot",
        latitude: 6.51,
        longitude: 3.37,
        radius_m: 100,
        address: device(6.51, 3.37, 14, "Gate 4"),
      });
      expect(made.status).toBe(201);
      expect(made.body.address).toBe("Gate 4, Near 6.51000, 3.37000");
      expect(made.body.address_place).toMatchObject({ source: "device", formatted: null, pending: true, verified: false });

      expect(await maps.nameWaiting()).toEqual({ named: 0, stopped: true });
      up = true;
      expect(await maps.nameWaiting()).toEqual({ named: 1, stopped: false });
      const named = (await api("ops").get(`/worksites/${made.body.worksite_id}`)).body;
      expect(named.address).toBe("Gate 4, 7 Pinned Close, Yaba, Lagos");
      expect(named.address_place).toMatchObject({ source: "device", formatted: "7 Pinned Close, Yaba, Lagos", pending: false, verified: true });

      const { rows } = await q("SELECT payload, actor_user_id FROM event_log WHERE event_key = 'place.named'");
      expect(rows).toEqual([{ payload: { owner: "worksite.address" }, actor_user_id: null }]);
      expect(await maps.nameWaiting()).toEqual({ named: 0, stopped: false });
    });
  });

  test("every address saved before the rule is kept as typed and unverified, with the record's own point", async () => {
    const { rows } = await q(
      `INSERT INTO worksite (code, name, address, latitude, longitude, radius_m, timezone)
       VALUES ('OLD-YARD', 'Old Yard', jsonb_build_object('text', '4 Typed Long Ago Street'), 6.45, 3.39, 150, 'Africa/Lagos')
       RETURNING worksite_id`,
    );
    const migration = fs.readFileSync(path.join(__dirname, "../../migrations/0490_place.sql"), "utf8");
    const up = migration.slice(migration.indexOf("-- UP"), migration.indexOf("-- DOWN"));
    await q(up);
    await q(up);
    const old = (await api("ops").get(`/worksites/${rows[0].worksite_id}`)).body;
    expect(old.address).toBe("4 Typed Long Ago Street");
    expect(old.address_place).toMatchObject({ formatted: "4 Typed Long Ago Street", source: "typed", verified: false, lat: 6.45, lon: 3.39 });
    expect((await q("SELECT count(*)::int AS n FROM place WHERE owner_key = $1", [rows[0].worksite_id])).rows[0].n).toBe(1);
  });
});
