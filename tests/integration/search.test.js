"use strict";
/**
 * ⌘K end to end (docs/guides/foundation.md §6.7): GET /search on the real migrations,
 * through HTTP, as people with different grants. Screens and actions come from the
 * catalogues; records from the providers (logins and approval flows exist on every
 * database; employees and departments join when their provider lands).
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/search
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
const { SCREENS } = require("../../src/shared/search/screens");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;
const PASSWORD = "Find-It-Fast9";

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

describeDb("⌘K search against the real migrations", () => {
  let app;
  const tokens = {};

  /** GET /search as one person, the body checked against the contract. */
  async function search(who, query = {}) {
    const res = await request(app).get("/api/v1/search").query(query).set("Authorization", `Bearer ${tokens[who]}`);
    expect(res.status).toBe(200);
    return c.search.SearchResult.parse(res.body);
  }
  const group = (r, type) => r.groups.find((g) => g.type === type);
  const titles = (r, type) => (group(r, type) ? group(r, type).items.map((i) => i.title) : []);

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
      department_name: "Operations",
      start_date: "2026-02-02",
      employment_type: "full_time",
      work_pattern: "hybrid",
    });
    const people = [
      ["ops", "Halima", "Garba", "operations_people", "Operations Lead"],
      ["staff", "Obinna", "Eke", "employee", "Field Officer"],
    ];
    let ip = 0;
    for (const [key, first, last, role, job] of people) {
      await tx((client) =>
        createAdmin(client, { employee: sample(first, last, `${key}@mycity.test`, job), role_code: role, is_ceo: false }, PASSWORD, {
          allowAdditional: true,
        }),
      );
      ip += 1;
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.70.0.${ip}`)
        .send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("signed out, search answers 401", async () => {
    expect((await request(app).get("/api/v1/search").query({ q: "leave" })).status).toBe(401);
  });

  test("with nothing typed: the screens and actions this person may open, 25 a page", async () => {
    const r = await search("staff");
    expect(r.groups.map((g) => g.kind)).toEqual(["screen", "action"]);
    const screens = group(r, "screen");
    expect(screens.items).toHaveLength(25);
    expect(screens.page).toMatchObject({ number: 1, size: 25 });
    expect(screens.page.total).toBeLessThan(SCREENS.length);
    const next = await search("staff", { type: "screen", page: 2 });
    expect(next.groups.map((g) => g.type)).toEqual(["screen"]);
    expect(next.groups[0].page.number).toBe(2);
    expect(next.groups[0].items[0].title).not.toBe(screens.items[0].title);
  });

  test("a synonym finds the screen, and only the tabs the shell shows the reader", async () => {
    const staff = await search("staff", { q: "holiday" });
    expect(titles(staff, "screen")).toContain("My Leave");
    expect(titles(staff, "screen")).not.toContain("Leave");
    const ops = await search("ops", { q: "holiday" });
    expect(titles(ops, "screen")).toEqual(expect.arrayContaining(["My Leave", "Leave", "Organisation"]));
    const leave = group(ops, "screen").items.find((i) => i.title === "Leave");
    expect(leave).toMatchObject({ kind: "screen", sub: "People", link: "/people?tab=leave", run: null });
  });

  test("a screen a person cannot open is never offered", async () => {
    expect(titles(await search("staff", { q: "roles and permissions" }), "screen")).toEqual([]);
    expect(titles(await search("ops", { q: "roles & permissions" }), "screen")).toEqual(["Roles & Permissions"]);
    expect(titles(await search("staff", { q: "audit" }), "screen")).toEqual([]);
  });

  test("actions open the screen that does them, or run in the app", async () => {
    const staff = await search("staff", { q: "leave" });
    const request_ = group(staff, "action").items.find((i) => i.title === "Request Leave");
    expect(request_).toMatchObject({ kind: "action", link: "/ess?tab=my-leave&action=new", run: null, sub: "My Leave" });
    expect(titles(staff, "action")).not.toContain("Add Employee");

    const clock = group(await search("staff", { q: "clock out" }), "action").items[0];
    expect(clock).toMatchObject({ title: "Clock In", run: "clock", link: "/ess?tab=my-attendance" });
    const read = group(await search("staff", { q: "notifications" }), "action").items.find((i) => i.title === "Mark All Read");
    expect(read).toMatchObject({ run: "read_all", link: null });
    expect(titles(await search("staff", { q: "pin" }), "action")).toContain("Set PIN");
    expect(titles(await search("staff", { q: "password" }), "action")).toContain("Change Password");

    const ops = await search("ops", { q: "invite" });
    expect(group(ops, "action").items.find((i) => i.title === "Invite User").link).toBe("/settings?tab=users&action=new");
    expect(titles(await search("ops", { q: "staff sheet" }), "action")).toContain("Import Staff");
    expect(titles(await search("staff", { q: "invite" }), "action")).toEqual([]);
  });

  test("records come grouped, by the reader's grants", async () => {
    const ops = await search("ops", { q: "leave request" });
    const flows = group(ops, "workflow_definition");
    expect(flows).toMatchObject({ kind: "record", label: "Approval Flows", module: "settings" });
    expect(flows.items[0]).toMatchObject({ title: "Leave Request", ref: "leave.approval", run: null });
    expect(flows.items[0].link).toMatch(/^\/settings\?tab=approvals&id=/);
    expect(group(await search("staff", { q: "leave request" }), "workflow_definition")).toBeUndefined();

    const logins = await search("ops", { q: "obinna" });
    expect(titles(logins, "app_user")).toEqual(["Obinna Eke"]);
    expect(group(await search("staff", { q: "halima" }), "app_user")).toBeUndefined();
  });

  test("a type word narrows to that kind of record", async () => {
    const r = await search("ops", { q: "login halima" });
    expect(r).toMatchObject({ q: "halima", hint: "app_user" });
    expect(r.groups.map((g) => g.type)).toEqual(["app_user"]);
  });

  test("one group at a time, to page through it", async () => {
    const r = await search("ops", { q: "leave", type: "action" });
    expect(r.groups.map((g) => g.kind)).toEqual(["action"]);
    expect((await search("ops", { q: "leave", type: "workflow_definition" })).groups.map((g) => g.type)).toEqual([
      "workflow_definition",
    ]);
    for (const g of (await search("ops")).groups) expect(g.items.length).toBeLessThanOrEqual(25);
  });

  test("a page size is not the caller's to choose", async () => {
    const res = await request(app).get("/api/v1/search").query({ q: "leave", limit: 100 }).set("Authorization", `Bearer ${tokens.ops}`);
    expect(res.status).toBe(422);
  });
});
