"use strict";
/**
 * Performance's Department and Function filters are role-sensitive (docs/guides/performance.md §8):
 * GET /performance/departments offers a reader the departments their `performance` scope reaches,
 * on the real migrations, every answer parsed with its contract.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/performance-departments
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
const grantsCache = require("../../src/shared/rbac/grants-cache");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const PASSWORD = "Perf-Departments9Test";
const BM = "Branding & Marketing";
const TBO = "Technology & Back-office Ops";

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

describeDb("performance department filters against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  const ids = {};
  let ip = 0;

  const as = (who) => ({ get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`) });
  const emp = (who) => people[who].employee.employee_id;

  /** The names a reader is offered, the response parsed with its contract. */
  async function offered(who) {
    const res = await as(who).get("/performance/departments");
    expect(res.status).toBe(200);
    const page = c.goals.PerformanceDepartmentPage.parse(res.body);
    expect(page.page.total).toBe(page.data.length);
    return page.data.map((d) => d.name);
  }

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    const sample = (first, last, email, job, department) => ({
      first_name: first,
      last_name: last,
      work_email: email,
      phone: "08031234567",
      job_title: job,
      department_name: department,
      start_date: "2026-01-05",
      employment_type: "full_time",
      work_pattern: "on_site",
    });
    const make = (key, first, last, role, job, department, isCeo = false) =>
      tx(async (client) => {
        people[key] = await createAdmin(
          client,
          { employee: sample(first, last, `${key}@mycity.test`, job, department), role_code: role, is_ceo: isCeo },
          PASSWORD,
          { allowAdditional: true },
        );
      });
    await make("ceo", "Amaka", "Obi", "management", "Chief Executive Officer", "General Management", true);
    await make("ops", "Ngozi", "Eze", "operations_people", "Operations & People Lead", "People & Culture");
    await make("head", "Tolu", "Ade", "head_of_department", "Head, Brand", BM);
    await make("ada", "Ada", "Nwosu", "employee", "Social Media Manager", BM);
    await make("musa", "Musa", "Danjuma", "employee", "Graphics Associate", BM);
    await make("other", "Bisi", "Lawal", "head_of_department", "Head, Tech", TBO);
    await make("dev", "Femi", "Ola", "employee", "Content Associate", TBO);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = ANY($2::uuid[])", [emp("head"), [emp("ada"), emp("musa")]]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [emp("other"), emp("dev")]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = ANY($2::uuid[])", [emp("ceo"), [emp("head"), emp("other"), emp("ops")]]);
    ids.bm = (await one("SELECT department_id FROM department WHERE name = $1", [BM])).department_id;
    ids.tbo = (await one("SELECT department_id FROM department WHERE name = $1", [TBO])).department_id;
    await q("UPDATE department SET code = 'BM', head_employee_id = $2 WHERE department_id = $1", [ids.bm, emp("head")]);
    await q("UPDATE department SET code = 'TBO', head_employee_id = $2 WHERE department_id = $1", [ids.tbo, emp("other")]);
    await grantsCache.bumpTeamVersion();
    for (const key of Object.keys(people)) {
      ip += 1;
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.66.0.${ip}`)
        .send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }
    const period = await as("ops").get("/performance/periods");
    expect(period.status).toBe(200);
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("the CEO and Operations & People are offered every active department", async () => {
    const every = (await q("SELECT name FROM department WHERE active ORDER BY name")).rows.map((r) => r.name);
    expect(every).toEqual(expect.arrayContaining(["General Management", "People & Culture", BM, TBO]));
    expect(await offered("ceo")).toEqual(every);
    expect(await offered("ops")).toEqual(every);
  });

  test("a member of staff is offered only their own department", async () => {
    expect(await offered("ada")).toEqual([BM]);
    expect(await offered("dev")).toEqual([TBO]);
  });

  test("a line manager is offered their team's departments, not the company's", async () => {
    expect(await offered("head")).toEqual([BM]);
    expect(await offered("other")).toEqual([TBO]);
  });

  test("a department the reader heads is offered with nobody in it", async () => {
    const empty = await one("INSERT INTO department (code, name, head_employee_id) VALUES ('STR', 'Strategy', $1) RETURNING department_id", [emp("ada")]);
    expect(await offered("ada")).toEqual([BM, "Strategy"]);
    await q("UPDATE department SET head_employee_id = NULL WHERE department_id = $1", [empty.department_id]);
    expect(await offered("ada")).toEqual([BM]);
  });

  test("a reviewer is offered the departments of those whose scorecards name them", async () => {
    const quarter = await request(app)
      .post("/api/v1/performance/periods")
      .set("Authorization", `Bearer ${tokens.ops}`)
      .send({ starts_on: "2026-10-01" });
    expect(quarter.status).toBe(201);
    ids.period = quarter.body.performance_period_id;
    const card = await one(
      `INSERT INTO scorecard (performance_period_id, employee_id, department_id, dotted_employee_id)
       VALUES ($1, $2, $3, $4) RETURNING scorecard_id`,
      [ids.period, emp("dev"), ids.tbo, emp("head")],
    );
    expect(await offered("head")).toEqual([BM, TBO]);
    expect(await offered("ada")).toEqual([BM]);
    await q("DELETE FROM scorecard WHERE scorecard_id = $1", [card.scorecard_id]);
    expect(await offered("head")).toEqual([BM]);
  });

  test("a holder of the reviewing role is offered the departments of the scorecards that name it", async () => {
    await q("INSERT INTO scorecard (performance_period_id, employee_id, department_id, reviewer_role_code) VALUES ($1, $2, $3, 'head_of_department')", [ids.period, emp("ada"), ids.bm]);
    expect(await offered("other")).toEqual([BM, TBO]);
    expect(await offered("dev")).toEqual([TBO]);
    await q("DELETE FROM scorecard WHERE employee_id = $1", [emp("ada")]);
    expect(await offered("other")).toEqual([TBO]);
  });

  test("a department kept on a scorecard after someone moves stays offered to those who see it", async () => {
    await q("INSERT INTO scorecard (performance_period_id, employee_id, department_id) VALUES ($1, $2, $3)", [ids.period, emp("musa"), ids.tbo]);
    expect(await offered("head")).toEqual([BM, TBO]);
    expect(await offered("musa")).toEqual([BM, TBO]);
    expect(await offered("ada")).toEqual([BM]);
    await q("DELETE FROM scorecard WHERE employee_id = $1", [emp("musa")]);
  });

  test("a retired department is offered to no one", async () => {
    await q("UPDATE department SET active = false WHERE department_id = $1", [ids.tbo]);
    expect(await offered("ceo")).not.toContain(TBO);
    expect(await offered("other")).toEqual([]);
    await q("UPDATE department SET active = true WHERE department_id = $1", [ids.tbo]);
  });
});
