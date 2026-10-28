"use strict";
/**
 * Performance · Goals, who a plan awaiting approval is with and who is told (docs/guides/performance.md
 * §6.4, §7): the real migrations, the whole app through HTTP, every response parsed with its contract.
 *
 * General Management's head is the CEO, so its plan skips Line Manager; sent from the build account (the
 * Implementation Team does not hold Operations & People) it goes to Operations & People first, and the
 * CEO, whose stage is last, is neither told nor shown it until Operations & People approve. The plan's
 * `approval` names the stage it is with the whole way. Sent by Operations & People, a function whose head
 * reports to the CEO goes to the CEO at once, and the CEO is told.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/performance-plan-stage
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
const one = async (sql, params) => (await q(sql, params)).rows[0];
const PASSWORD = "Perf-Stage9Test";

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

describeDb("a plan awaiting approval names its stage and tells that stage's approvers, against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  const ids = {};
  let ip = 0;

  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
    post: (path, body = {}) => request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
  });
  const emp = (who) => people[who].employee.employee_id;
  const waiting = async (who) => (await as(who).get("/performance/approvals")).body.data;
  const plan = async (who, id) => (await as(who).get(`/performance/plans/${id}`)).body;
  /** The approval notices a person was sent about one plan, oldest first. */
  const notices = async (who, planId) =>
    (
      await q(
        `SELECT n.title, n.body, n.entity_type
           FROM notification n JOIN app_user u ON u.user_id = n.user_id
          WHERE u.employee_id = $1 AND n.entity_id = $2 AND n.event_key IN ('workflow.opened', 'workflow.advanced')
          ORDER BY n.created_at, n.notification_id`,
        [emp(who), planId],
      )
    ).rows;
  const instanceOf = (planId) =>
    one("SELECT workflow_instance_id, current_stage FROM workflow_instance WHERE entity_id = $1 AND state = 'pending'", [planId]);
  /** A plan with one objective and one key result: nothing blocks it, and the one-result warning does not stop Send Plan. */
  async function draftPlan(who, departmentId, title) {
    const objective = await as(who).post("/performance/objectives", { performance_period_id: ids.q4, department_id: departmentId, title });
    expect(objective.status).toBe(201);
    const kr = await as(who).post("/performance/key-results", {
      okr_objective_id: objective.body.okr_objective_id,
      statement: "Reach the target",
      measure: "numeric",
      target_value: "100",
      unit: "units",
      accountable_employee_id: emp("other"),
    });
    expect(kr.status).toBe(201);
    return objective.body.performance_plan_id;
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
    await make("other", "Bisi", "Lawal", "head_of_department", "Head, Tech", "Technology & Back-office Ops");
    // The build account: the Implementation Team holds every capability but is not Operations & People.
    await make("impl", "Seun", "Phillips", "implementation", "Implementation Partner", "General Management");
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [emp("ceo"), emp("other")]);
    ids.gm = (await one("SELECT department_id FROM department WHERE name = 'General Management'")).department_id;
    ids.tbo = (await one("SELECT department_id FROM department WHERE name = 'Technology & Back-office Ops'")).department_id;
    await q("UPDATE department SET code = 'GM', head_employee_id = $2 WHERE department_id = $1", [ids.gm, emp("ceo")]);
    await q("UPDATE department SET code = 'TBO', head_employee_id = $2 WHERE department_id = $1", [ids.tbo, emp("other")]);
    await require("../../src/shared/rbac/grants-cache").bumpTeamVersion();
    await drain();
    for (const key of Object.keys(people)) {
      ip += 1;
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.67.0.${ip}`)
        .send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }
    ids.q4 = (await as("ops").post("/performance/periods", { starts_on: "2026-10-01", status: "active" })).body.performance_period_id;
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("General Management's plan sent from the build account goes to Operations & People, not the CEO", async () => {
    ids.gmPlan = await draftPlan("ceo", ids.gm, "Run MyCity as one team");
    // Not sent: it is with nobody.
    expect(await plan("impl", ids.gmPlan)).toMatchObject({ status: "draft", approval: null, can_submit: true });

    const sent = await as("impl").post(`/performance/plans/${ids.gmPlan}/submit`);
    expect(sent.status).toBe(200);
    // The answer says where it went, so the sender is not left to guess.
    expect(sent.body).toMatchObject({
      status: "submitted",
      approval: { stage_key: "operations_people", stage_name: "Operations & People" },
    });
    expect(await plan("ceo", ids.gmPlan)).toMatchObject({ approval: { stage_key: "operations_people", stage_name: "Operations & People" } });
    const instance = await instanceOf(ids.gmPlan);
    expect(instance.current_stage).toBe("operations_people");

    await drain();
    // Operations & People are told and have it to decide; nobody else is, the CEO and the sender included.
    expect(await notices("ops", ids.gmPlan)).toEqual([
      { title: "Approval needed: Quarter Plan", body: "Operations & People is waiting on you.", entity_type: "performance_plan" },
    ]);
    expect((await waiting("ops")).map((r) => [r.kind, r.record_id, r.stage_name])).toEqual([["plan", ids.gmPlan, "Operations & People"]]);
    for (const who of ["ceo", "impl", "other"]) {
      expect(await notices(who, ids.gmPlan)).toEqual([]);
      expect((await waiting(who)).filter((r) => r.record_id === ids.gmPlan)).toEqual([]);
    }
  });

  test("the CEO is told and shown the plan once Operations & People approve it, and the card follows", async () => {
    const instance = await instanceOf(ids.gmPlan);
    const approved = await as("ops").post(`/workflow/instances/${instance.workflow_instance_id}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.stage_name).toBe("CEO");
    await drain();

    expect(await plan("impl", ids.gmPlan)).toMatchObject({ status: "submitted", approval: { stage_key: "ceo", stage_name: "CEO" } });
    expect(await notices("ceo", ids.gmPlan)).toEqual([
      { title: "Approval needed: Quarter Plan", body: "CEO is waiting on you.", entity_type: "performance_plan" },
    ]);
    expect((await waiting("ceo")).map((r) => [r.kind, r.record_id, r.stage_name])).toEqual([["plan", ids.gmPlan, "CEO"]]);
    // Operations & People are not asked again, and not told twice.
    expect((await waiting("ops")).filter((r) => r.record_id === ids.gmPlan)).toEqual([]);
    expect(await notices("ops", ids.gmPlan)).toHaveLength(1);

    expect((await as("ceo").post(`/workflow/instances/${instance.workflow_instance_id}/approve`)).body.state).toBe("approved");
    await drain();
    // Binding: nothing awaits anyone, so the plan is with nobody.
    expect(await plan("impl", ids.gmPlan)).toMatchObject({ status: "binding", approval: null });
  });

  test("a plan Operations & People send goes to the CEO at once, and the CEO is told; a refusal returns it to nobody", async () => {
    ids.tboPlan = await draftPlan("other", ids.tbo, "Keep the platform up");
    const sent = await as("ops").post(`/performance/plans/${ids.tboPlan}/submit`);
    expect(sent.status).toBe(200);
    // Line Manager is skipped (the head reports to the CEO) and so is Operations & People (they sent it).
    expect(sent.body.approval).toEqual({ stage_key: "ceo", stage_name: "CEO" });
    await drain();
    expect(await notices("ceo", ids.tboPlan)).toEqual([
      { title: "Approval needed: Quarter Plan", body: "CEO is waiting on you.", entity_type: "performance_plan" },
    ]);
    expect((await waiting("ceo")).map((r) => [r.record_id, r.stage_name])).toEqual([[ids.tboPlan, "CEO"]]);
    // The sender decides nothing of their own and is told nothing about it being sent.
    expect(await notices("ops", ids.tboPlan)).toEqual([]);
    expect((await waiting("ops")).filter((r) => r.record_id === ids.tboPlan)).toEqual([]);

    const instance = await instanceOf(ids.tboPlan);
    expect((await as("ceo").post(`/workflow/instances/${instance.workflow_instance_id}/reject`, { reason: "Add a recovery target" })).status).toBe(200);
    await drain();
    expect(await plan("other", ids.tboPlan)).toMatchObject({ status: "returned", approval: null, returned_reason: "Add a recovery target" });
  });
});
