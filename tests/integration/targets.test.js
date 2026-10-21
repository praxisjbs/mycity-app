"use strict";
/**
 * Performance · Targets end to end (A16; docs/guides/performance.md §3 steps 3, 5 and 6): the
 * real migrations on a throwaway database, the whole app through HTTP, every response parsed
 * with its contract. A head of department sets their department's targets for the month under
 * an approved monthly goal; the month goes to Management, Operations & People and the CEO as
 * one; a return comes back with its reason; the CEO's approval makes the targets and KPIs
 * binding and tells each person; a done task recounts the KPI it counts towards.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/targets
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
const PASSWORD = "Dept-Targets9Test";
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

describeDb("a department's month against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  let ip = 0;

  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
    post: (path, body = {}) =>
      request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
  });
  const emp = (who) => people[who].employee.employee_id;
  let monthly;
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
    await make("pm", "Tunde", "Bello", "management", "Program Manager", "Leadership");
    await make("ops", "Ngozi", "Eze", "operations_people", "Operations Lead", "Operations");
    await make("head", "Ifeoma", "Chukwu", "head_of_department", "Head of Programmes", "Programmes");
    await make("staff", "Musa", "Danjuma", "employee", "Field Officer", "Programmes");
    await make("other", "Bisi", "Ade", "head_of_department", "Head of Finance", "Finance");
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [emp("head"), emp("staff")]);
    await require("../../src/shared/rbac/grants-cache").bumpTeamVersion();
    await drain();
    programmes = (await q("SELECT department_id FROM employee WHERE employee_id = $1", [emp("head")])).rows[0].department_id;

    for (const key of Object.keys(people)) {
      ip += 1;
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.64.0.${ip}`)
        .send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }

    // The cascade above the month: the CEO sets and approves each level.
    const org = await as("ceo").post("/performance/goals", { level: "organisation", title: "Reach more families", year });
    const annual = await as("ceo").post("/performance/goals", {
      level: "annual",
      title: "Run 120 outreach sessions",
      parent_goal_id: org.body.organisational_goal_id,
      year,
    });
    const passAll = async (id) => {
      await as("ceo").post(`/performance/goals/${id}/submit`);
      for (let i = 0; i < 3; i += 1) await as("ceo").post(`/performance/goals/${id}/decide`, { decision: "approve" });
    };
    await passAll(annual.body.organisational_goal_id);
    const m = await as("ceo").post("/performance/goals", {
      level: "monthly",
      title: "Run 10 outreach sessions",
      parent_goal_id: annual.body.organisational_goal_id,
      month,
    });
    await passAll(m.body.organisational_goal_id);
    monthly = (await as("ceo").get(`/performance/goals/${m.body.organisational_goal_id}`)).body;
    expect(monthly.status).toBe("active");
  });

  afterAll(async () => {
    await pool.end();
  });

  let target;
  let plan;

  test("a head of department sets their own department's targets, nobody else's", async () => {
    const body = { title: "Hold 6 school sessions", success_measure: "Sessions held", month, parent_goal_id: monthly.organisational_goal_id };
    expect((await as("staff").post("/performance/targets", body)).status).toBe(403);
    expect((await as("head").post("/performance/targets", { ...body, department_id: emp("other") })).status).toBe(403);

    const r = await as("head").post("/performance/targets", body);
    expect(r.status).toBe(201);
    expect(r.body.code).toBe(`DT-${year}-001`);
    expect(r.body.department).toBe("Programmes");
    expect(r.body.status).toBe("draft");
    expect(r.body.rolls_up_to.organisational_goal_id).toBe(monthly.organisational_goal_id);
    target = r.body;

    const list = await as("head").get(`/performance/targets?month=${month}`);
    expect(list.body.data.map((t) => t.organisational_goal_id)).toEqual([target.organisational_goal_id]);
    const finance = await as("other").get(`/performance/targets?month=${month}`);
    expect(finance.status).toBe(200);
  });

  test("the month goes to approval as one, and a person's weights must total 100", async () => {
    // A KPI under the target, short of 100%: the month is refused.
    await q(
      `INSERT INTO employee_target (organisational_goal_id, employee_id, title, month, target_value, weight, status,
                                    progress_source, set_by_employee_id, performance_plan_id)
       VALUES ($1, $2, 'Sessions delivered', $3::date, 3, 60, 'draft', 'tasks', $4, $5)`,
      [target.organisational_goal_id, emp("staff"), `${month}-01`, emp("head"), target.performance_plan_id],
    );
    const short = await as("head").post(`/performance/plans/${programmes}/${month}/submit`);
    expect(short.status).toBe(422);
    expect(short.body.error.code).toBe("WEIGHTS_NOT_100");
    await q("UPDATE employee_target SET weight = 100 WHERE performance_plan_id = $1", [target.performance_plan_id]);

    expect((await as("other").post(`/performance/plans/${programmes}/${month}/submit`)).status).toBe(403);
    const sent = await as("head").post(`/performance/plans/${programmes}/${month}/submit`);
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe("pending_approval");
    expect(sent.body.waiting_on).toBe("Management");
    expect(sent.body.kpis).toBe(1);
    plan = sent.body;

    const locked = await as("head").post("/performance/targets", {
      title: "Too late",
      month,
      parent_goal_id: monthly.organisational_goal_id,
    });
    expect(locked.status).toBe(409);
  });

  test("returned at any stage, it comes back with the reason; resubmitted, the CEO's approval binds it", async () => {
    const back = await as("pm").post(`/performance/plans/${plan.performance_plan_id}/decide`, {
      decision: "return",
      reason: "Add a clinic target",
    });
    expect(back.status).toBe(200);
    expect(back.body.status).toBe("returned");
    const draft = await q("SELECT status FROM organisational_goal WHERE organisational_goal_id = $1", [target.organisational_goal_id]);
    expect(draft.rows[0].status).toBe("returned");

    await as("head").post(`/performance/plans/${programmes}/${month}/submit`);
    expect((await as("pm").post(`/performance/plans/${plan.performance_plan_id}/decide`, { decision: "approve" })).body.waiting_on).toBe(
      "Operations & People",
    );
    await as("ops").post(`/performance/plans/${plan.performance_plan_id}/decide`, { decision: "approve" });
    const done = await as("ceo").post(`/performance/plans/${plan.performance_plan_id}/decide`, { decision: "approve" });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe("active");

    const kpi = await q("SELECT status, approved_at FROM employee_target WHERE performance_plan_id = $1", [plan.performance_plan_id]);
    expect(kpi.rows[0].status).toBe("active");
    expect(kpi.rows[0].approved_at).not.toBeNull();

    await drain();
    const told = await q(
      `SELECT n.title FROM notification n JOIN app_user u ON u.user_id = n.user_id WHERE u.employee_id = $1`,
      [emp("staff")],
    );
    expect(told.rows.map((r) => r.title)).toContain(`Your KPIs for ${new Date(`${month}-15`).toLocaleString("en-GB", { month: "long" })} are set`);

    const summary = await as("ceo").get(`/performance/targets/summary?month=${month}`);
    expect(summary.status).toBe(200);
    expect(summary.body.approved).toBe(1);
    expect(summary.body.trail.length).toBeGreaterThanOrEqual(4);
    const mine = await as("head").get(`/performance/targets/summary?month=${month}`);
    expect(mine.body.my_plan.performance_plan_id).toBe(plan.performance_plan_id);
  });

  test("a done task linked to a KPI counts towards it", async () => {
    const kpiId = (await q("SELECT employee_target_id FROM employee_target WHERE performance_plan_id = $1", [plan.performance_plan_id]))
      .rows[0].employee_target_id;
    const t = await request(app)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${tokens.head}`)
      .send({ title: "Session at Ikeja Primary", primary_assignee_id: emp("staff"), employee_target_id: kpiId });
    expect(t.status).toBe(201);
    const moved = await request(app)
      .post(`/api/v1/tasks/${t.body.task_id}/move`)
      .set("Authorization", `Bearer ${tokens.staff}`)
      .send({ status: "done" });
    expect(moved.status).toBe(200);
    await drain();
    const after = await q("SELECT actual_value::text AS v FROM employee_target WHERE employee_target_id = $1", [kpiId]);
    expect(Number(after.rows[0].v)).toBe(1);

    const list = await as("ceo").get(`/performance/targets?month=${month}`);
    expect(list.body.data[0].progress.attainment).toBeCloseTo(1 / 3, 3);
  });
});
