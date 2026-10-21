"use strict";
/**
 * Performance · KPIs end to end (A16; docs/guides/performance.md §3 steps 4, 6 and 7, §6): the
 * real migrations on a throwaway database, the whole app through HTTP, every response parsed
 * with its contract. A line manager sets a report's monthly KPIs with weights under their
 * department's targets; nobody sets their own or someone outside their scope; once the month
 * is approved a manual KPI takes its figure and the person's score moves; any KPI traces up to
 * the organisational goal.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/kpis
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
const lagos = require("../../src/shared/time/lagos");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const PASSWORD = "Kpi-Weights9Test";
const year = Number(lagos.today().slice(0, 4));
const month = lagos.today().slice(0, 7);

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

describeDb("KPIs against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  let ip = 0;

  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
    post: (path, body = {}) =>
      request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    put: (path, body = {}) =>
      request(app).put(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
  });
  const emp = (who) => people[who].employee.employee_id;
  let targetId;
  let programmes;

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
    await make("ceo", "Cynthia", "Okafor", "management", "Chief Executive", "Leadership", true);
    await make("head", "Ifeoma", "Chukwu", "head_of_department", "Head of Programmes", "Programmes");
    await make("lead", "Tunde", "Bello", "manager", "Programme Lead", "Programmes");
    await make("staff", "Musa", "Danjuma", "employee", "Field Officer", "Programmes");
    await make("peer", "Zainab", "Lawal", "employee", "Field Officer", "Programmes");
    await make("outsider", "Bisi", "Ade", "employee", "Accounts Officer", "Finance");
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [emp("head"), emp("lead")]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = ANY($2::uuid[])", [emp("lead"), [emp("staff"), emp("peer")]]);
    await require("../../src/shared/rbac/grants-cache").bumpTeamVersion();
    await drain();
    programmes = (await q("SELECT department_id FROM employee WHERE employee_id = $1", [emp("head")])).rows[0].department_id;

    for (const key of Object.keys(people)) {
      ip += 1;
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.65.0.${ip}`)
        .send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }

    const passAll = async (id) => {
      await as("ceo").post(`/performance/goals/${id}/submit`);
      for (let i = 0; i < 3; i += 1) await as("ceo").post(`/performance/goals/${id}/decide`, { decision: "approve" });
    };
    const org = await as("ceo").post("/performance/goals", { level: "organisation", title: "Reach more families", year });
    const annual = await as("ceo").post("/performance/goals", {
      level: "annual",
      title: "Run 120 outreach sessions",
      parent_goal_id: org.body.organisational_goal_id,
      year,
    });
    await passAll(annual.body.organisational_goal_id);
    const monthly = await as("ceo").post("/performance/goals", {
      level: "monthly",
      title: "Run 10 outreach sessions",
      parent_goal_id: annual.body.organisational_goal_id,
      month,
    });
    await passAll(monthly.body.organisational_goal_id);
    const target = await as("head").post("/performance/targets", {
      title: "Hold 6 school sessions",
      month,
      parent_goal_id: monthly.body.organisational_goal_id,
    });
    expect(target.status).toBe(201);
    targetId = target.body.organisational_goal_id;
  });

  afterAll(async () => {
    await pool.end();
  });

  const twoKpis = () => ({
    month,
    items: [
      { organisational_goal_id: targetId, title: "Sessions delivered", target_value: "4", progress_source: "tasks", weight: "60" },
      { organisational_goal_id: targetId, title: "Parents reached", target_value: "50", unit: "parents", weight: "30.00" },
    ],
  });

  test("a line manager sets a report's KPIs; nobody sets their own or someone outside their line", async () => {
    expect((await as("staff").put(`/performance/kpis/employees/${emp("staff")}`, twoKpis())).status).toBe(403);
    expect((await as("lead").put(`/performance/kpis/employees/${emp("outsider")}`, twoKpis())).status).toBe(404);
    expect((await as("lead").put(`/performance/kpis/employees/${emp("lead")}`, twoKpis())).status).toBe(403);

    const r = await as("lead").put(`/performance/kpis/employees/${emp("staff")}`, twoKpis());
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(2);
    expect(r.body.total_weight).toBe("90.00");
    expect(r.body.items.map((k) => k.status)).toEqual(["draft", "draft"]);
    expect(r.body.items[0].set_by.employee_id).toBe(emp("lead"));
    expect(r.body.targets.map((t) => t.organisational_goal_id)).toEqual([targetId]);

    // Saving again replaces the month: keep one, change its weight, drop the other, add one.
    const keep = r.body.items.find((k) => k.title === "Sessions delivered");
    const again = await as("lead").put(`/performance/kpis/employees/${emp("staff")}`, {
      month,
      items: [
        { employee_target_id: keep.employee_target_id, organisational_goal_id: targetId, title: "Sessions delivered", target_value: "4", progress_source: "tasks", weight: "70" },
        { organisational_goal_id: targetId, title: "Reports filed", target_value: "4", weight: "30" },
      ],
    });
    expect(again.status).toBe(200);
    expect(again.body.total_weight).toBe("100.00");
    expect(again.body.items.map((k) => k.title).sort()).toEqual(["Reports filed", "Sessions delivered"]);
    expect(again.body.items.find((k) => k.title === "Sessions delivered").employee_target_id).toBe(keep.employee_target_id);

    const twice = await as("lead").put(`/performance/kpis/employees/${emp("peer")}`, {
      month,
      items: [
        { organisational_goal_id: targetId, title: "Visits", target_value: "4", weight: "50" },
        { organisational_goal_id: targetId, title: "visits", target_value: "4", weight: "50" },
      ],
    });
    expect(twice.status).toBe(422);
  });

  test("the list and the figures keep to the reader's scope", async () => {
    await as("lead").put(`/performance/kpis/employees/${emp("peer")}`, {
      month,
      items: [{ organisational_goal_id: targetId, title: "Visits", target_value: "4", weight: "80" }],
    });
    const team = await as("lead").get(`/performance/kpis?month=${month}`);
    expect(team.status).toBe(200);
    expect(new Set(team.body.data.map((k) => k.employee.employee_id))).toEqual(new Set([emp("staff"), emp("peer")]));
    const own = await as("staff").get(`/performance/kpis?month=${month}`);
    expect(own.body.data.every((k) => k.employee.employee_id === emp("staff"))).toBe(true);
    expect((await as("outsider").get(`/performance/kpis/employees/${emp("staff")}`)).status).toBe(404);

    const figures = await as("head").get(`/performance/kpis/summary?month=${month}&department_id=${programmes}`);
    expect(figures.status).toBe(200);
    expect(figures.body.with_kpis).toBe(2);
    expect(figures.body.weights_off).toBe(1);
  });

  test("approved with the month, a manual KPI takes its figure and the score moves; a KPI traces to the top", async () => {
    await as("lead").put(`/performance/kpis/employees/${emp("peer")}`, {
      month,
      items: [{ organisational_goal_id: targetId, title: "Visits", target_value: "4", weight: "100" }],
    });
    const sent = await as("head").post(`/performance/plans/${programmes}/${month}/submit`);
    expect(sent.status).toBe(200);
    const locked = await as("lead").put(`/performance/kpis/employees/${emp("staff")}`, twoKpis());
    expect(locked.status).toBe(409);
    for (let i = 0; i < 3; i += 1) await as("ceo").post(`/performance/plans/${sent.body.performance_plan_id}/decide`, { decision: "approve" });

    const month1 = await as("staff").get(`/performance/kpis/employees/${emp("staff")}?month=${month}`);
    const manual = month1.body.items.find((k) => k.title === "Reports filed");
    expect(manual.status).toBe("active");
    expect(manual.can_record_actual).toBe(true);
    const fromTasks = month1.body.items.find((k) => k.title === "Sessions delivered");
    expect((await as("staff").post(`/performance/kpis/${fromTasks.employee_target_id}/actual`, { actual_value: "2" })).status).toBe(409);

    const rec = await as("staff").post(`/performance/kpis/${manual.employee_target_id}/actual`, { actual_value: "4" });
    expect(rec.status).toBe(200);
    expect(rec.body.attainment).toBe(1);
    expect(rec.body.progress_status).toBe("met");
    const after = await as("lead").get(`/performance/kpis/employees/${emp("staff")}?month=${month}`);
    expect(after.body.kpi_score).toBeCloseTo(0.3, 5);

    const trace = await as("staff").get(`/performance/kpis/${manual.employee_target_id}/trace`);
    expect(trace.status).toBe(200);
    expect(trace.body.chain.map((g) => g.level)).toEqual(["department", "monthly", "annual", "organisation"]);
  });
});
