"use strict";
/**
 * The User Guide end to end (docs/guides/user-guide.md §5, §6.3): GET /user-guide on the real
 * migrations and the real chapters of docs/manual, through HTTP, as people with different
 * roles. Each reader receives only the chapters, sections, tasks and pictures their grants open.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/user-guide
 *
 * Refuses to run unless the database name ends in "_test". Every person here is invented.
 */
const request = require("supertest");
const c = require("@mycity/contract");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;
const PASSWORD = "Read-The-Guide7";

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

describeDb("the User Guide against the real migrations and chapters", () => {
  let app;
  const tokens = {};

  const get = (who, path) => {
    const req = request(app).get(`/api/v1/user-guide${path}`);
    return who ? req.set("Authorization", `Bearer ${tokens[who]}`) : req;
  };
  async function contents(who) {
    const res = await get(who, "/");
    expect(res.status).toBe(200);
    return c.user_guide.GuideContents.parse(res.body);
  }
  async function chapter(who, slug) {
    const res = await get(who, `/chapters/${slug}`);
    expect(res.status).toBe(200);
    return c.user_guide.GuideChapter.parse(res.body);
  }
  /** Every section and task slug in a chapter. */
  const slugsOf = (ch) => ch.sections.flatMap((s) => [s.slug, ...s.tasks.map((t) => t.slug)]);

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    const roster = [
      ["staff", "Obinna", "Eke", "employee", "Field Officer", "0809 765 4321"],
      ["ops", "Halima", "Garba", "operations_people", "Operations Lead", "08031234567"],
      ["admin", "Tunde", "Bello", "administrator", "Systems Lead", "0805 111 2222"],
    ];
    let ip = 0;
    for (const [key, first, last, role, job, phone] of roster) {
      await tx((client) =>
        createAdmin(
          client,
          {
            employee: {
              first_name: first,
              last_name: last,
              work_email: `${key}@mycity.test`,
              phone,
              job_title: job,
              department_name: "Operations",
              start_date: "2026-02-02",
              employment_type: "full_time",
              work_pattern: "hybrid",
            },
            role_code: role,
            is_ceo: false,
          },
          PASSWORD,
          { allowAdditional: true },
        ),
      );
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

  test("signed out, the guide answers 401", async () => {
    expect((await get(null, "/")).status).toBe(401);
    expect((await get(null, "/images/people/people-employees.desktop.png")).status).toBe(401);
  });

  test("everyone reads Getting Started; only who may open People and Settings reads theirs", async () => {
    const staff = (await contents("staff")).chapters.map((ch) => ch.slug);
    expect(staff[0]).toBe("getting-started");
    expect(staff).not.toContain("people");
    expect(staff).not.toContain("settings");

    const ops = (await contents("ops")).chapters.map((ch) => ch.slug);
    expect(ops).toEqual(expect.arrayContaining(["getting-started", "people", "settings"]));
  });

  test("a chapter the reader may not read is not there, and neither is one that does not exist", async () => {
    expect((await get("staff", "/chapters/people")).status).toBe(404);
    expect((await get("ops", "/chapters/nothing-here")).status).toBe(404);
    expect((await get("ops", "/chapters/Not_A_Slug")).status).toBe(422);
  });

  test("Settings · Integrations is read only by who holds the integrations grant", async () => {
    const ops = slugsOf(await chapter("ops", "settings"));
    expect(ops).toContain("settings-users");
    expect(ops).not.toContain("settings-integrations");
    expect(ops).not.toContain("settings-integrations-edit");

    const admin = slugsOf(await chapter("admin", "settings"));
    expect(admin).toEqual(expect.arrayContaining(["settings-integrations", "settings-integrations-check", "settings-integrations-edit"]));
  });

  test("a task is read only by who holds what it needs", async () => {
    const ops = slugsOf(await chapter("ops", "people"));
    expect(ops).toEqual(expect.arrayContaining(["people-employees", "people-add-employee", "people-add-refused"]));
  });

  test("the Quick Start shows each reader only the cards they can follow", async () => {
    const cards = async (who) => {
      const res = await get(who, "/quick-start");
      expect(res.status).toBe(200);
      return c.user_guide.GuideChapter.parse(res.body).sections.map((s) => s.slug);
    };
    const staff = await cards("staff");
    expect(staff).toEqual(expect.arrayContaining(["qs-sign-in", "qs-search", "qs-notifications", "qs-help"]));
    expect(staff).not.toContain("qs-add-employee");
    expect(staff).not.toContain("qs-roles");
    expect(await cards("ops")).toEqual(expect.arrayContaining(["qs-add-employee", "qs-import"]));
  });

  test("a picture is sent only for a part the reader may read", async () => {
    const ok = await get("ops", "/images/settings/settings-users.desktop.png");
    expect(ok.status).toBe(200);
    expect(ok.headers["content-type"]).toMatch(/^image\/png/);
    expect(ok.headers["cache-control"]).toBe("private, max-age=3600");

    expect((await get("ops", "/images/settings/settings-integrations.desktop.png")).status).toBe(404);
    expect((await get("admin", "/images/settings/settings-integrations.desktop.png")).status).toBe(200);
    expect((await get("staff", "/images/people/people-employees.phone.png")).status).toBe(404);
    expect((await get("ops", "/images/people/no-such-picture.desktop.png")).status).toBe(404);
    expect((await get("ops", "/images/people/..%2F..%2Fsecret.desktop.png")).status).toBe(422);
  });

  test("⌘K finds the guide's sections the reader may read, and opens the guide at them", async () => {
    const search = async (who, q) => {
      const res = await request(app).get("/api/v1/search").query({ q, type: "guide_section" }).set("Authorization", `Bearer ${tokens[who]}`);
      expect(res.status).toBe(200);
      const group = c.search.SearchResult.parse(res.body).groups.find((g) => g.type === "guide_section");
      return group ? group.items : [];
    };
    const add = (await search("ops", "add an employee")).find((i) => i.id === "people-add-employee");
    expect(add).toMatchObject({ title: "Add an employee", sub: "People · Employees" });
    expect(add.link).toMatch(/^\/knowledge\?tab=user-guide&id=people-add-employee$/);

    expect((await search("staff", "add an employee")).map((i) => i.id)).not.toContain("people-add-employee");
    expect((await search("ops", "integrations")).map((i) => i.id)).not.toContain("settings-integrations");
    expect((await search("admin", "integrations")).map((i) => i.id)).toContain("settings-integrations");
  });
});
