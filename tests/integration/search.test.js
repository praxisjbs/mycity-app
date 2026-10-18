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
const crypto = require("node:crypto");
const outbox = require("../../src/shared/events/outbox");
const engine = require("../../src/shared/workflow/engine");
const { SCREENS } = require("../../src/shared/search/screens");
const grantsCache = require("../../src/shared/rbac/grants-cache");

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
  const people = {};

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
    const sample = (first, last, email, job, phone) => ({
      first_name: first,
      last_name: last,
      work_email: email,
      phone,
      job_title: job,
      department_name: "Operations",
      start_date: "2026-02-02",
      employment_type: "full_time",
      work_pattern: "hybrid",
    });
    const roster = [
      ["ops", "Halima", "Garba", "operations_people", "Operations Lead", "08031234567"],
      ["staff", "Obinna", "Eke", "employee", "Field Officer", "0809 765 4321"],
    ];
    let ip = 0;
    for (const [key, first, last, role, job, phone] of roster) {
      people[key] = await tx((client) =>
        createAdmin(client, { employee: sample(first, last, `${key}@mycity.test`, job, phone), role_code: role, is_ceo: false }, PASSWORD, {
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

  test("Home's Team, Alerts and Reports are offered to whoever holds their capability", async () => {
    const offered = async (who) => {
      const out = [];
      for (const [q, title] of [["my team", "Team"], ["red flags", "Alerts"], ["insights", "Reports"]])
        if (titles(await search(who, { q }), "screen").includes(title)) out.push(title);
      return out;
    };
    expect(await offered("staff")).toEqual([]);
    expect(await offered("ops")).toEqual(["Team", "Alerts", "Reports"]);

    const staffId = people.staff.user.user_id;
    await pool.query(
      "INSERT INTO user_capability (user_id, capability_id) SELECT $1, capability_id FROM capability WHERE code = 'home.team'",
      [staffId],
    );
    await grantsCache.invalidateUser(staffId);
    try {
      expect(await offered("staff")).toEqual(["Team"]);
    } finally {
      await pool.query("DELETE FROM user_capability WHERE user_id = $1", [staffId]);
      await grantsCache.invalidateUser(staffId);
    }
    expect(await offered("staff")).toEqual([]);
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

  test("an employee is found by their work phone, typed any way", async () => {
    for (const q of ["0809 765 4321", "08097654321", "+234 809 765 4321", "4321"])
      expect(titles(await search("ops", { q }), "employee")).toEqual(["Obinna Eke"]);
    const halima = group(await search("ops", { q: "0803 123 4567" }), "employee").items;
    expect(halima.map((i) => i.title)).toEqual(["Halima Garba"]);
    expect(halima[0].link).toMatch(/^\/people\?tab=employees&id=/);
    // Staff hold no people grant: a number finds nobody for them.
    expect(group(await search("staff", { q: "0803 123 4567" }), "employee")).toBeUndefined();
  });

  test("an employee is found by the name they go by, and by a middle name", async () => {
    await pool.query("UPDATE employee SET preferred_name = 'Lima', middle_name = 'Zainab' WHERE employee_id = $1", [
      people.ops.employee.employee_id,
    ]);
    expect(titles(await search("ops", { q: "lima" }), "employee")).toEqual(["Halima Garba"]);
    expect(titles(await search("ops", { q: "zainab" }), "employee")).toEqual(["Halima Garba"]);
  });

  test("an open seat is found by its title, and opens on the Organogram", async () => {
    const { rows } = await pool.query(
      `INSERT INTO org_seat (title, department_id) VALUES ('Head Sales & Revenue', $1) RETURNING org_seat_id`,
      [people.ops.employee.department_id],
    );
    const seats = group(await search("ops", { q: "head sales" }), "org_seat");
    expect(seats).toMatchObject({ kind: "record", label: "Open Seats", module: "people" });
    expect(seats.items[0]).toMatchObject({ title: "Head Sales & Revenue", sub: "Vacant · Operations" });
    expect(seats.items[0].link).toBe(`/people?tab=organogram&id=${rows[0].org_seat_id}`);
    expect(group(await search("staff", { q: "head sales" }), "org_seat")).toBeUndefined();
  });

  test("the theme, density, Install App and Sign Out are actions the app runs", async () => {
    const run = async (q, title) => group(await search("staff", { q }), "action").items.find((i) => i.title === title);
    expect(await run("dark mode", "Use Dark Theme")).toMatchObject({ run: "theme_dark", link: null });
    expect(await run("light mode", "Use Light Theme")).toMatchObject({ run: "theme_light" });
    expect(await run("compact", "Change Density")).toMatchObject({ run: "density" });
    expect(await run("install", "Install App")).toMatchObject({ run: "install" });
    expect(await run("log out", "Sign Out")).toMatchObject({ run: "sign_out" });
  });

  test("a screen forgives one slip", async () => {
    expect(titles(await search("staff", { q: "payslp" }), "screen")).toContain("My Payslips");
  });

  test("what waits on the reader comes first, with nothing typed", async () => {
    await pool.query("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [
      people.ops.employee.employee_id,
      people.staff.employee.employee_id,
    ]);
    const leave = crypto.randomUUID();
    await tx((client) =>
      engine.openInstance(client, {
        definition_key: "leave.approval",
        entity: { type: "leave_request", id: leave },
        subject_employee_id: people.staff.employee.employee_id,
        context: { days: 2 },
        actor: people.staff.user,
      }),
    );
    const ops = await search("ops");
    expect(ops.groups[0]).toMatchObject({ kind: "record", type: "approval", label: "Waiting on You" });
    expect(ops.groups[0].items[0]).toMatchObject({
      title: "Obinna Eke",
      sub: "Leave Request · Line Manager",
      status: "waiting",
      link: `/people?tab=leave&id=${leave}`,
    });
    expect(ops.groups.map((g) => g.kind)).toEqual(["record", "screen", "action"]);
    expect(group(await search("ops", { q: "obinna" }), "approval").items).toHaveLength(1);
    expect(group(await search("ops", { q: "halima" }), "approval")).toBeUndefined();
    expect(group(await search("staff"), "approval")).toBeUndefined();
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
