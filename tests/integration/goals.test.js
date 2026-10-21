"use strict";
/**
 * Performance · Goals end to end (A16; docs/guides/performance.md §3 steps 1 and 2, §6): the
 * real migrations on a throwaway database, the whole app through HTTP, every response parsed
 * with its contract (APP_ENV=test). The CEO records an organisational goal, active at once;
 * Management sets an annual and a monthly goal under it, which pass Management, Operations &
 * People and the CEO before they bind; a return sends one back with its reason; any goal
 * traces up to the organisational goal it serves.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/goals
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
const PASSWORD = "Goal-Cascade9Test";
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

describeDb("the goal cascade against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  let ip = 0;

  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
    post: (path, body = {}) =>
      request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    patch: (path, body = {}) =>
      request(app).patch(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
  });

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
      department_name: "Leadership",
      start_date: "2026-01-05",
      employment_type: "full_time",
      work_pattern: "on_site",
    });
    const make = (key, first, last, role, job, isCeo = false) =>
      tx(async (client) => {
        people[key] = await createAdmin(
          client,
          { employee: sample(first, last, `${key}@mycity.test`, job), role_code: role, is_ceo: isCeo },
          PASSWORD,
          { allowAdditional: true },
        );
      });
    await make("ceo", "Cynthia", "Okafor", "management", "Chief Executive", true);
    await make("pm", "Tunde", "Bello", "management", "Program Manager");
    await make("cto", "Kemi", "Adeyemi", "management", "Chief Technology Officer");
    await make("ops", "Ngozi", "Eze", "operations_people", "Operations Lead");
    await make("staff", "Musa", "Danjuma", "employee", "Field Officer");
    await drain();

    for (const key of Object.keys(people)) {
      ip += 1;
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.63.0.${ip}`)
        .send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  let org;
  let annual;
  let monthly;

  test("only the CEO records an organisational goal, and it is active at once", async () => {
    const body = {
      level: "organisation",
      title: "Grow active partners across Lagos",
      strategic_theme: "Partnerships",
      success_measure: "Active partners at year end",
      baseline: "40 partners",
      year,
      quarters: [
        { quarter: 1, milestone: "50 partners" },
        { quarter: 4, milestone: "80 partners" },
      ],
    };
    const refused = await as("pm").post("/performance/goals", body);
    expect(refused.status).toBe(403);
    expect((await as("staff").post("/performance/goals", body)).status).toBe(403);

    const r = await as("ceo").post("/performance/goals", body);
    expect(r.status).toBe(201);
    expect(r.body.status).toBe("active");
    expect(r.body.code).toBe(`OG-${year}-01`);
    expect(r.body.starts_on).toBe(`${year}-01-01`);
    org = r.body;

    const detail = await as("staff").get(`/performance/goals/${org.organisational_goal_id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.quarters.map((x) => x.quarter)).toEqual([1, 4]);
    expect(detail.body.can_edit).toBe(false);
  });

  test("Management sets an annual goal, which waits on Management, Operations & People and the CEO", async () => {
    const r = await as("pm").post("/performance/goals", {
      level: "annual",
      title: "Sign 40 new partners",
      parent_goal_id: org.organisational_goal_id,
      year,
    });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe("draft");
    expect(r.body.code).toBe(`AG-${year}-01`);
    annual = r.body;

    const sent = await as("pm").post(`/performance/goals/${annual.organisational_goal_id}/submit`);
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe("pending_approval");
    expect(sent.body.route.map((s) => [s.key, s.state])).toEqual([
      ["management", "now"],
      ["operations_people", "todo"],
      ["ceo", "todo"],
    ]);

    // Whoever submitted it cannot decide its stage; the other Management member can.
    const own = await as("pm").post(`/performance/goals/${annual.organisational_goal_id}/decide`, { decision: "approve" });
    expect(own.status).toBe(403);
    const first = await as("cto").post(`/performance/goals/${annual.organisational_goal_id}/decide`, { decision: "approve" });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("pending_approval");

    const second = await as("ops").post(`/performance/goals/${annual.organisational_goal_id}/decide`, { decision: "approve" });
    expect(second.status).toBe(200);
    expect(second.body.status).toBe("pending_approval");

    const last = await as("ceo").post(`/performance/goals/${annual.organisational_goal_id}/decide`, { decision: "approve" });
    expect(last.status).toBe(200);
    expect(last.body.status).toBe("active");
    expect(last.body.decisions).toHaveLength(3);
    annual = last.body;
  });

  test("a monthly goal needs an approved annual goal, and a return sends it back with the reason", async () => {
    const r = await as("pm").post("/performance/goals", {
      level: "monthly",
      title: "Sign 4 partners this month",
      parent_goal_id: annual.organisational_goal_id,
      month,
    });
    expect(r.status).toBe(201);
    monthly = r.body;
    expect(monthly.rolls_up_to.organisational_goal_id).toBe(annual.organisational_goal_id);

    await as("pm").post(`/performance/goals/${monthly.organisational_goal_id}/submit`);
    const noReason = await as("cto").post(`/performance/goals/${monthly.organisational_goal_id}/decide`, { decision: "return" });
    expect(noReason.status).toBe(422);
    const back = await as("cto").post(`/performance/goals/${monthly.organisational_goal_id}/decide`, {
      decision: "return",
      reason: "Name the partner types",
    });
    expect(back.status).toBe(200);
    expect(back.body.status).toBe("returned");
    expect(back.body.can_edit).toBe(true);
    expect(back.body.decisions.at(-1).reason).toBe("Name the partner types");

    const edited = await as("pm").patch(`/performance/goals/${monthly.organisational_goal_id}`, {
      title: "Sign 4 schools and clinics this month",
    });
    expect(edited.status).toBe(200);
    expect(edited.body.title).toBe("Sign 4 schools and clinics this month");

    const again = await as("pm").post(`/performance/goals/${monthly.organisational_goal_id}/submit`);
    expect(again.status).toBe(200);
    expect(again.body.status).toBe("pending_approval");
  });

  test("a goal under a goal that is not approved is refused", async () => {
    const r = await as("pm").post("/performance/goals", {
      level: "monthly",
      title: "Under a waiting goal",
      parent_goal_id: monthly.organisational_goal_id,
      month,
    });
    expect(r.status).toBe(422);
  });

  test("any goal traces up to its organisational goal, and the lists and summary read it back", async () => {
    const detail = await as("staff").get(`/performance/goals/${monthly.organisational_goal_id}`);
    expect(detail.body.trace.map((g) => g.level)).toEqual(["annual", "organisation"]);
    expect(detail.body.trace.at(-1).organisational_goal_id).toBe(org.organisational_goal_id);

    const orgDetail = await as("staff").get(`/performance/goals/${org.organisational_goal_id}`);
    expect(orgDetail.body.children.map((g) => g.organisational_goal_id)).toEqual([annual.organisational_goal_id]);

    const list = await as("staff").get(`/performance/goals?level=annual&year=${year}`);
    expect(list.status).toBe(200);
    expect(list.body.data.map((g) => g.code)).toEqual([`AG-${year}-01`]);

    const all = await as("staff").get(`/performance/goals?q=partners`);
    expect(all.body.page.total).toBeGreaterThanOrEqual(2);

    const summary = await as("staff").get(`/performance/goals/summary?year=${year}`);
    expect(summary.status).toBe(200);
    const of = (level) => summary.body.cascade.find((c) => c.level === level);
    expect(of("organisation").active).toBe(1);
    expect(of("annual").active).toBe(1);
    expect(of("monthly").pending).toBe(1);
    expect(summary.body.progress.map((p) => p.organisational_goal_id)).toEqual([org.organisational_goal_id]);
  });
});
