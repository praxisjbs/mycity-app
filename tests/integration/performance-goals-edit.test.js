"use strict";
/**
 * Performance · Goals, set and changed on screen (docs/guides/performance.md §3.1, §3.2, §3.5, §6.3,
 * §6.7): the real migrations, the whole app through HTTP, every response parsed with its contract.
 *
 * Operations & People set up the next quarter while this one runs, with its own rules, each rule
 * checked on its field; the objectives and key results of a draft plan are edited and deleted by
 * whoever sets them, and nobody else, and not once the plan binds; a TBC target is set in place by
 * its owner or the head before its lock date, and only asked of the CEO after it; the CEO edits an
 * organisational goal and deletes one no company objective serves.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/performance-goals-edit
 */
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const { scoring } = require("@mycity/contract");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const PASSWORD = "Perf-Edit9Test";

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

describeDb("performance goals set and changed on screen, against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  const ids = {};
  let ip = 0;

  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
    post: (path, body = {}) => request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    patch: (path, body = {}) => request(app).patch(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    del: (path) => request(app).delete(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
  });
  const emp = (who) => people[who].employee.employee_id;
  const rulesWith = (patch) => {
    const r = JSON.parse(JSON.stringify(scoring.DEFAULT_RULES));
    for (const [group, values] of Object.entries(patch)) Object.assign(r[group], values);
    return r;
  };

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
    await make("pm", "Kunle", "Bello", "management", "Program Manager", "General Management");
    await make("ops", "Ngozi", "Eze", "operations_people", "Operations & People Lead", "People & Culture");
    await make("head", "Tolu", "Ade", "head_of_department", "Head, Brand", "Branding & Marketing");
    await make("ada", "Ada", "Nwosu", "employee", "Social Media Manager", "Branding & Marketing");
    await make("other", "Bisi", "Lawal", "head_of_department", "Head, Tech", "Technology & Back-office Ops");
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [emp("head"), emp("ada")]);
    ids.bm = (await one("SELECT department_id FROM department WHERE name = 'Branding & Marketing'")).department_id;
    ids.tbo = (await one("SELECT department_id FROM department WHERE name = 'Technology & Back-office Ops'")).department_id;
    await q("UPDATE department SET code = 'BM', head_employee_id = $2 WHERE department_id = $1", [ids.bm, emp("head")]);
    await q("UPDATE department SET code = 'TBO', head_employee_id = $2 WHERE department_id = $1", [ids.tbo, emp("other")]);
    await require("../../src/shared/rbac/grants-cache").bumpTeamVersion();
    await drain();
    for (const key of Object.keys(people)) {
      ip += 1;
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.65.0.${ip}`)
        .send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("Set Up Quarter: Q1 2027 is set up planning while Q4 2026 runs, with its own rules, each checked on its field", async () => {
    expect((await as("head").post("/performance/periods", { starts_on: "2026-10-01" })).status).toBe(403);
    const q4 = await as("ops").post("/performance/periods", { starts_on: "2026-10-01", targets_lock_on: "2026-11-07", status: "active" });
    expect(q4.status).toBe(201);
    expect(q4.body).toMatchObject({ name: "Q4 2026", ends_on: "2026-12-31", status: "active", rules: scoring.DEFAULT_RULES });
    ids.q4 = q4.body.performance_period_id;

    // The next quarter, set up in October with rules of its own.
    const rules = rulesWith({ bands: { exceeds: 0.85 }, sections: { results: 50, kpis: 30, accountability: 20 }, key_results: { band_watch: 0.45 } });
    const q1 = await as("ops").post("/performance/periods", { starts_on: "2027-01-01", targets_lock_on: "2027-02-07", rules });
    expect(q1.status).toBe(201);
    expect(q1.body).toMatchObject({ name: "Q1 2027", status: "planning", plan_year_starts_on: "2027-01-01", months: ["2027-01-01", "2027-02-01", "2027-03-01"] });
    expect(q1.body.rules).toEqual(rules);
    ids.q1 = q1.body.performance_period_id;
    // The active quarter stays the current one; one active at a time.
    expect((await as("ada").get("/performance/periods/current")).body.performance_period_id).toBe(ids.q4);
    const second = await as("ops").post("/performance/periods", { starts_on: "2027-04-01", status: "active" });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("PERIOD_ACTIVE_EXISTS");

    // Rules that do not hold land on the field they name.
    const bad = await as("ops").post("/performance/periods", {
      starts_on: "2027-04-01",
      rules: rulesWith({ sections: { results: 60, kpis: 25, accountability: 10 }, bands: { meets: 0.4 }, key_results: { band_good: 0.3 } }),
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error.fields).toMatchObject({
      "rules.sections.results": ["Sections must total 100"],
      "rules.bands.meets": ["Must exceed Partly Meets"],
      "rules.key_results.band_good": ["Must exceed Watch"],
    });
    expect((await as("ops").post("/performance/periods", { starts_on: "2027-02-01" })).status).toBe(422);

    // A plan year's quarters, for a goal's targets.
    const year = await as("ada").get("/performance/periods?plan_year=2027");
    expect(year.body.data.map((p) => p.name)).toEqual(["Q1 2027"]);

    // Edit Quarter: its name, lock date and rules; the lock date stays inside the quarter.
    const edited = await as("ops").patch(`/performance/periods/${ids.q1}`, { name: "Q1 2027 Plan", rules: rulesWith({ sections: { results: 70, kpis: 20, accountability: 10 } }) });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ name: "Q1 2027 Plan", rules: { sections: { results: 70, kpis: 20, accountability: 10 } } });
    const outside = await as("ops").patch(`/performance/periods/${ids.q1}`, { targets_lock_on: "2026-12-01" });
    expect(outside.status).toBe(422);
    expect(outside.body.error.fields).toEqual({ targets_lock_on: ["Outside the quarter"] });
    // A quarter opened in October takes objectives at once.
    const early = await as("pm").post("/performance/objectives", { performance_period_id: ids.q1, title: "Plan the year's second half" });
    expect(early.status).toBe(201);
    expect(early.body).toMatchObject({ code: "CO-O1", plan_status: "draft", can_edit: true });
  });

  test("objectives and key results of a draft plan: edited and deleted by whoever sets them, not once the plan binds", async () => {
    const co = await as("pm").post("/performance/objectives", { performance_period_id: ids.q4, title: "One trusted view" });
    ids.coObjective = co.body.okr_objective_id;
    const coKr = await as("pm").post("/performance/key-results", { okr_objective_id: ids.coObjective, statement: "64,000 monthly active users", target_value: "64000", unit: "users" });
    ids.coKr = coKr.body.okr_key_result_id;
    const o = await as("head").post("/performance/objectives", { performance_period_id: ids.q4, department_id: ids.bm, title: "Be the app residents open first" });
    ids.objective = o.body.okr_objective_id;
    expect(o.body.can_edit).toBe(true);

    // Every field of the form, at once.
    const kr = await as("head").post("/performance/key-results", {
      okr_objective_id: ids.objective,
      statement: "Grow app downloads",
      kr_type: "outcome",
      measure: "numeric",
      direction: "higher",
      unit: "downloads",
      baseline_text: "38,000 in Q3",
      target_value: "64000",
      target_text: "64,000 downloads",
      target_provisional: true,
      starts_on: "2026-10-01",
      finishes_on: "2026-12-31",
      accountable_employee_id: emp("ada"),
      co_accountable_employee_id: emp("head"),
      accountable_note: "Ada with the head",
      linked_company_key_result_ids: [ids.coKr],
    });
    expect(kr.status).toBe(201);
    expect(kr.body).toMatchObject({ code: "BM-KR1.1", target_provisional: true, baseline_text: "38,000 in Q3", linked_company_key_results: [{ code: "CO-KR1.1" }] });
    ids.kr = kr.body.okr_key_result_id;
    const extra = await as("head").post("/performance/key-results", { okr_objective_id: ids.objective, statement: "Launch in two cities", measure: "dated" });
    ids.extra = extra.body.okr_key_result_id;

    // Who may edit: the head for the function, Management for the company; nobody else.
    const tree = async (who) => (await as(who).get(`/performance/okrs?period_id=${ids.q4}`)).body.data.map((x) => [x.code, x.can_edit]);
    expect(await tree("head")).toEqual([["CO-O1", false], ["BM-O1", true]]);
    expect(await tree("pm")).toEqual([["CO-O1", true], ["BM-O1", false]]);
    expect(await tree("ada")).toEqual([["CO-O1", false], ["BM-O1", false]]);
    expect(await tree("ops")).toEqual([["CO-O1", false], ["BM-O1", true]]);
    expect((await as("other").get(`/performance/objectives/${ids.objective}`)).body).toMatchObject({ code: "BM-O1", can_edit: false });
    const detail = async (who) => {
      const body = (await as(who).get(`/performance/key-results/${ids.kr}`)).body;
      return [body.can_edit, body.can_set_target, body.can_change_target];
    };
    expect([await detail("head"), await detail("ada"), await detail("other")]).toEqual([[true, false, false], [false, false, false], [false, false, false]]);

    // The pickers: the company's key results (Feeds) and the functions' (Scored From), 25 a page.
    const company = await as("head").get(`/performance/key-results?period_id=${ids.q4}&level=company`);
    expect(company.body.data.map((k) => k.code)).toEqual(["CO-KR1.1"]);
    const functions = await as("pm").get(`/performance/key-results?period_id=${ids.q4}&level=function&q=downloads`);
    expect(functions.body).toMatchObject({ data: [{ code: "BM-KR1.1", statement: "Grow app downloads" }], page: { total: 1, size: 25 } });

    // Edit Key Result: an empty field clears it; links are replaced.
    expect((await as("other").patch(`/performance/key-results/${ids.kr}`, { statement: "x" })).status).toBe(403);
    const edited = await as("head").patch(`/performance/key-results/${ids.kr}`, {
      statement: "Grow app downloads to 64,000",
      unit: "",
      baseline_text: "",
      co_accountable_employee_id: "",
      kr_type: "",
      target_provisional: false,
      linked_company_key_result_ids: [],
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ statement: "Grow app downloads to 64,000", unit: null, baseline_text: null, co_accountable: null, kr_type: null, target_provisional: false, linked_company_key_results: [] });
    const backwards = await as("head").patch(`/performance/key-results/${ids.kr}`, { starts_on: "2026-12-01", finishes_on: "2026-11-01" });
    expect(backwards.status).toBe(422);
    expect(backwards.body.error.fields).toHaveProperty("finishes_on");
    // Scored From is a company key result's only.
    const wrong = await as("head").patch(`/performance/key-results/${ids.kr}`, { scored_from_key_result_id: ids.extra });
    expect(wrong.status).toBe(422);
    expect((await as("pm").patch(`/performance/key-results/${ids.coKr}`, { scored_from_key_result_id: ids.kr })).body.scored_from_key_result_id).toBe(ids.kr);
    expect((await as("pm").patch(`/performance/key-results/${ids.coKr}`, { scored_from_key_result_id: null })).body.scored_from_key_result_id).toBeNull();

    // Edit Objective and Delete Key Result.
    expect((await as("ada").patch(`/performance/objectives/${ids.objective}`, { title: "x" })).status).toBe(403);
    expect((await as("head").patch(`/performance/objectives/${ids.objective}`, { title: "Be the first app residents open" })).body).toMatchObject({ title: "Be the first app residents open", can_edit: true });
    expect((await as("other").del(`/performance/key-results/${ids.extra}`)).status).toBe(403);
    expect((await as("head").del(`/performance/key-results/${ids.extra}`)).status).toBe(204);
    expect((await as("head").get(`/performance/key-results/${ids.extra}`)).status).toBe(404);

    // A deleted objective takes its key results with it.
    const spare = await as("head").post("/performance/objectives", { performance_period_id: ids.q4, department_id: ids.bm, title: "Spare" });
    const spareKr = await as("head").post("/performance/key-results", { okr_objective_id: spare.body.okr_objective_id, statement: "Spare result" });
    expect((await as("head").del(`/performance/objectives/${spare.body.okr_objective_id}`)).status).toBe(204);
    expect((await as("head").get(`/performance/key-results/${spareKr.body.okr_key_result_id}`)).status).toBe(404);

    // Once the plan binds, nothing is edited or deleted, and nobody is offered it.
    await q("UPDATE performance_plan SET status = 'binding', binding_at = now() WHERE department_id = $1", [ids.bm]);
    expect(await tree("head")).toEqual([["CO-O1", false], ["BM-O1", false]]);
    expect((await as("head").get(`/performance/key-results/${ids.kr}`)).body.can_edit).toBe(false);
    const late = await as("head").patch(`/performance/objectives/${ids.objective}`, { title: "Again" });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("PLAN_BINDING");
    // New Objective on that function: refused on Function, the field at fault (QA DEF-10).
    const shut = await as("head").post("/performance/objectives", { performance_period_id: ids.q4, department_id: ids.bm, title: "One more" });
    expect(shut.status).toBe(409);
    expect(shut.body.error).toMatchObject({ code: "PLAN_BINDING", fields: { department_id: ["Plan is binding"] } });
    expect((await as("head").del(`/performance/key-results/${ids.kr}`)).status).toBe(409);
    expect((await as("head").patch(`/performance/key-results/${ids.kr}`, { statement: "Again" })).body.error.code).toBe("KEY_RESULT_BINDING");
  });

  test("Set Target: a TBC target is set in place before its lock date by its owner or the head; after it, the CEO is asked", async () => {
    // A quarter whose lock date has not come, whatever day the suite runs.
    const later = await as("ops").post("/performance/periods", { starts_on: "2099-01-01", targets_lock_on: "2099-03-31" });
    ids.later = later.body.performance_period_id;
    const o = await as("head").post("/performance/objectives", { performance_period_id: ids.later, department_id: ids.bm, title: "Reach every state" });
    const kr = await as("head").post("/performance/key-results", {
      okr_objective_id: o.body.okr_objective_id,
      statement: "Active partners per state",
      target_provisional: true,
      unit: "partners",
      accountable_employee_id: emp("ada"),
    });
    ids.tbc = kr.body.okr_key_result_id;
    await q("UPDATE performance_plan SET status = 'binding', binding_at = now() WHERE performance_period_id = $1 AND department_id = $2", [ids.later, ids.bm]);
    const flags = async (who) => {
      const body = (await as(who).get(`/performance/key-results/${ids.tbc}`)).body;
      return { edit: body.can_edit, set: body.can_set_target, change: body.can_change_target };
    };
    expect(await flags("ada")).toEqual({ edit: false, set: true, change: false });
    expect(await flags("head")).toEqual({ edit: false, set: true, change: false });
    expect(await flags("other")).toEqual({ edit: false, set: false, change: false });

    // The owner sets it, then the head; it stays TBC until the lock date, and no approval opens.
    const byOwner = await as("ada").patch(`/performance/key-results/${ids.tbc}`, { target_value: "12", target_text: "12 partners" });
    expect(byOwner.status).toBe(200);
    expect(byOwner.body).toMatchObject({ target_value: "12", target_text: "12 partners", target_provisional: true });
    const byHead = await as("head").patch(`/performance/key-results/${ids.tbc}`, { target_value: "15", target_text: "" });
    expect(byHead.body).toMatchObject({ target_value: "15", target_text: null, target_provisional: true });
    expect(Number((await one("SELECT count(*) AS n FROM target_change WHERE okr_key_result_id = $1", [ids.tbc])).n)).toBe(0);
    // Only the target, and only by them.
    expect((await as("ada").patch(`/performance/key-results/${ids.tbc}`, { statement: "Other" })).body.error.code).toBe("KEY_RESULT_BINDING");
    expect((await as("other").patch(`/performance/key-results/${ids.tbc}`, { target_value: "20" })).status).toBe(403);
    // Before the lock date the CEO is not asked.
    const asked = await as("head").post("/performance/target-changes", { okr_key_result_id: ids.tbc, to_value: "20", from_month: "2099-02-01", reason: "More states" });
    expect(asked.status).toBe(409);
    expect(asked.body.error.code).toBe("TARGET_TBC");

    // Once the lock date has passed, Set Target is gone and Change Target is the way.
    await q("UPDATE performance_period SET targets_lock_on = '2020-01-01' WHERE performance_period_id = $1", [ids.later]);
    expect(await flags("ada")).toEqual({ edit: false, set: false, change: true });
    expect((await as("ada").patch(`/performance/key-results/${ids.tbc}`, { target_value: "16" })).body.error.code).toBe("KEY_RESULT_BINDING");
    const change = await as("head").post("/performance/target-changes", { okr_key_result_id: ids.tbc, to_value: "20", from_month: "2099-02-01", reason: "More states" });
    expect(change.status).toBe(201);
    expect(change.body).toMatchObject({ from_value: "15", to_value: "20", status: "pending" });
  });

  test("organisational goals: the CEO edits a goal's title, description and quarterly targets, and deletes one no company objective serves", async () => {
    const goal = await as("ceo").post("/performance/goals", {
      code: "OG1",
      title: "Grow active users",
      detail: "Residents first",
      plan_year_starts_on: "2026-01-01",
      targets: [{ performance_period_id: ids.q4, target_text: "40,000 users", target_value: "40000" }],
    });
    ids.goal = goal.body.organisational_goal_id;
    expect((await as("pm").patch(`/performance/goals/${ids.goal}`, { title: "x" })).status).toBe(403);
    const edited = await as("ceo").patch(`/performance/goals/${ids.goal}`, {
      title: "Grow monthly active users",
      detail: "",
      targets: [{ performance_period_id: ids.q4, target_text: "64,000 users", target_value: "64000" }],
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ title: "Grow monthly active users", detail: null });
    expect((await as("ada").get(`/performance/goals/${ids.goal}`)).body.targets).toEqual([
      expect.objectContaining({ period_name: "Q4 2026", target_text: "64,000 users", target_value: "64000" }),
    ]);

    // A company objective serves it: it stays until that link goes.
    expect((await as("pm").patch(`/performance/objectives/${ids.coObjective}`, { organisational_goal_id: ids.goal })).status).toBe(200);
    expect((await as("pm").del(`/performance/goals/${ids.goal}`)).status).toBe(403);
    const refused = await as("ceo").del(`/performance/goals/${ids.goal}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("GOAL_IN_USE");
    expect((await as("pm").patch(`/performance/objectives/${ids.coObjective}`, { organisational_goal_id: null })).status).toBe(200);
    expect((await as("ceo").del(`/performance/goals/${ids.goal}`)).status).toBe(204);
    expect((await as("ceo").get(`/performance/goals/${ids.goal}`)).status).toBe(404);
    expect(Number((await one("SELECT count(*) AS n FROM organisational_goal_target WHERE organisational_goal_id = $1", [ids.goal])).n)).toBe(0);
    expect((await as("ceo").del(`/performance/goals/${ids.goal}`)).status).toBe(404);
    await drain();
    const logged = await one("SELECT count(*)::int AS n FROM event_outbox WHERE event_key = 'organisational_goal.deleted'");
    expect(logged.n).toBe(1);
  });
});
