"use strict";
/**
 * Who reads the OKR tree, and sharing a company goal (docs/guides/performance.md §6.23, §6.24; P25, P26):
 * the real migrations, the whole app through HTTP, every response parsed with its contract.
 *
 * Each person reads their own department's goals, OKRs and KPIs; the organisational goals and the company's
 * objectives only the CEO, Management, Operations & People, the Implementation Team and everyone in General
 * Management (P27: they also share and edit them); a key result a person owns is theirs to read wherever it
 * sits; the company key result a function feeds is named by code and statement alone. Whoever holds the
 * authority shares an organisational goal or a company objective with all staff or chosen departments, read
 * only, and may stop; the people newly reached are told. ⌘K, the assistant and Home read the same rule.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/performance-goal-scope
 */
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const c = require("@mycity/contract");
const goalsAi = require("../../src/modules/goals/goals.ai");
const kpisAi = require("../../src/modules/kpis/kpis.ai");
const visibility = require("../../src/modules/goals/goals.visibility");
const homeGoals = require("../../src/modules/dashboard/sources/goals.source");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const PASSWORD = "Perf-Scope9Test";

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

describeDb("who reads the OKR tree, and sharing a company goal, against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  const ids = {};
  let ip = 0;

  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
    post: (path, body = {}) => request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    put: (path, body = {}) => request(app).put(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    patch: (path, body = {}) => request(app).patch(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    del: (path) => request(app).delete(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
  });
  const emp = (who) => people[who].employee.employee_id;

  /** What `req.user` is for a person: what the assistant and Home read the tree with. */
  const actorOf = async (who) => {
    const roles = (await q("SELECT role_id FROM user_role WHERE user_id = $1", [people[who].user.user_id])).rows.map((r) => r.role_id);
    const user = await one("SELECT is_ceo FROM app_user WHERE user_id = $1", [people[who].user.user_id]);
    return { user_id: people[who].user.user_id, employee_id: emp(who), role_ids: roles, is_ceo: user.is_ceo === true };
  };
  // In code order: the tree lists a function by its department's id, which is no order a person reads.
  const codes = async (who, path = "/performance/okrs") => (await as(who).get(`${path}?period_id=${ids.q4}`)).body.data.map((o) => o.code).sort();
  const told = async (who, key) =>
    (await q("SELECT title, body FROM notification WHERE user_id = $1 AND event_key = $2 ORDER BY created_at", [people[who].user.user_id, key])).rows;

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
    // A role that reads every function across Performance and holds none of the plan's capabilities: what
    // Operations & People were before P27, kept so the "every function, not the company" reach stays covered.
    const auditor = await one("INSERT INTO role (code, name, description, is_system, home_view, rank) VALUES ('auditor', 'Auditor', 'Reads every function.', false, 'staff', 30) RETURNING role_id");
    await q("INSERT INTO permission (role_id, module_key, can_view, scope) VALUES ($1, 'performance', true, 'all')", [auditor.role_id]);
    await make("ceo", "Amaka", "Obi", "management", "Chief Executive Officer", "General Management", true);
    await make("pm", "Kunle", "Bello", "management", "Program Manager", "General Management");
    await make("ops", "Ngozi", "Eze", "operations_people", "Operations & People Lead", "People & Culture");
    await make("audit", "Chidi", "Okoro", "auditor", "Performance Auditor", "People & Culture");
    await make("mgr", "Bode", "Ibe", "management", "Chief Technology Officer", "Technology & Back-office Ops");
    await make("tech", "Yemi", "Cole", "employee", "Technical Assistant", "General Management");
    await make("head", "Tolu", "Ade", "head_of_department", "Head, Brand", "Branding & Marketing");
    await make("ada", "Ada", "Nwosu", "employee", "Social Media Manager", "Branding & Marketing");
    await make("other", "Bisi", "Lawal", "head_of_department", "Head, Tech", "Technology & Back-office Ops");
    await make("dev", "Femi", "Ola", "employee", "Content Associate", "Technology & Back-office Ops");
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [emp("head"), emp("ada")]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [emp("other"), emp("dev")]);
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
        .set("X-Forwarded-For", `10.67.0.${ip}`)
        .send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }

    // Q4 2026 with the CEO's goals, the company's objective, and each function's own.
    ids.q4 = (await as("ops").post("/performance/periods", { starts_on: "2026-10-01", status: "active" })).body.performance_period_id;
    const goal = async (title) =>
      (await as("ceo").post("/performance/goals", { title, strategic_theme: "Growth", plan_year_starts_on: "2026-01-01" })).body.organisational_goal_id;
    ids.goalA = await goal("Grow monthly active users");
    ids.goalB = await goal("Earn two billion in revenue");
    ids.co = (await as("pm").post("/performance/objectives", { performance_period_id: ids.q4, title: "One trusted view", organisational_goal_id: ids.goalA })).body.okr_objective_id;
    ids.coKr1 = (await as("pm").post("/performance/key-results", { okr_objective_id: ids.co, statement: "64,000 monthly active users", target_value: "64000", unit: "users" })).body.okr_key_result_id;
    ids.coKr2 = (await as("pm").post("/performance/key-results", { okr_objective_id: ids.co, statement: "Sign off the baseline", measure: "dated" })).body.okr_key_result_id;
    ids.bmO = (await as("head").post("/performance/objectives", { performance_period_id: ids.q4, department_id: ids.bm, title: "Be the first app residents open" })).body.okr_objective_id;
    ids.bmKr = (
      await as("head").post("/performance/key-results", {
        okr_objective_id: ids.bmO,
        statement: "Grow app downloads",
        target_value: "64000",
        unit: "downloads",
        accountable_employee_id: emp("ada"),
        linked_company_key_result_ids: [ids.coKr1],
      })
    ).body.okr_key_result_id;
    ids.tboO = (await as("other").post("/performance/objectives", { performance_period_id: ids.q4, department_id: ids.tbo, title: "Keep the platform up" })).body.okr_objective_id;
    ids.tboKr = (await as("other").post("/performance/key-results", { okr_objective_id: ids.tboO, statement: "99.9% uptime", target_value: "99.9", unit: "%" })).body.okr_key_result_id;
    ids.bmKpi = (await as("head").post("/performance/kpis", { department_id: ids.bm, name: "Assets on time", target_text: "95%", target_value: "95", unit: "%" })).body.kpi_definition_id;
    ids.tboKpi = (await as("other").post("/performance/kpis", { department_id: ids.tbo, name: "Tickets closed", target_text: "90%", target_value: "90", unit: "%" })).body.kpi_definition_id;
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("a person reads their own department's objectives; a wider grant every function's; Management, Operations & People and the CEO everything", async () => {
    expect(await codes("ada")).toEqual(["BM-O1"]);
    expect(await codes("head")).toEqual(["BM-O1"]);
    expect(await codes("dev")).toEqual(["TBO-O1"]);
    expect(await codes("other")).toEqual(["TBO-O1"]);
    // A grant whose scope is all, with none of the plan's capabilities: every function's, never the company's.
    expect(await codes("audit")).toEqual(["BM-O1", "TBO-O1"]);
    // Operations & People hold the plan's capabilities (P27): the whole of it.
    expect(await codes("ops")).toEqual(["BM-O1", "CO-O1", "TBO-O1"]);
    expect(await codes("mgr")).toEqual(["BM-O1", "CO-O1", "TBO-O1"]);
    expect(await codes("pm")).toEqual(["BM-O1", "CO-O1", "TBO-O1"]);
    expect(await codes("ceo")).toEqual(["BM-O1", "CO-O1", "TBO-O1"]);
    // One objective by its id: 404 outside the reach, not 403.
    expect((await as("ada").get(`/performance/objectives/${ids.bmO}`)).status).toBe(200);
    expect((await as("ada").get(`/performance/objectives/${ids.tboO}`)).status).toBe(404);
    expect((await as("ada").get(`/performance/objectives/${ids.co}`)).status).toBe(404);
    expect((await as("audit").get(`/performance/objectives/${ids.co}`)).status).toBe(404);
    expect((await as("pm").get(`/performance/objectives/${ids.co}`)).status).toBe(200);
    // The company is asked for by name and a reader outside it gets nothing, not a refusal.
    expect((await as("ada").get(`/performance/okrs?period_id=${ids.q4}&department_id=company`)).body.data).toEqual([]);
    expect((await as("ada").get(`/performance/okrs?period_id=${ids.q4}&department_id=${ids.tbo}`)).body.data).toEqual([]);
    // A search of the tree is filtered in SQL, not on the page.
    expect((await as("ada").get(`/performance/okrs?period_id=${ids.q4}&q=uptime`)).body.data).toEqual([]);
    expect((await as("dev").get(`/performance/okrs?period_id=${ids.q4}&q=uptime`)).body.data.map((o) => o.code)).toEqual(["TBO-O1"]);
  });

  test("organisational goals and the key results behind a function's: the whole plan's until shared", async () => {
    const listed = async (who) => (await as(who).get("/performance/goals")).body.data.map((g) => g.title).sort();
    expect(await listed("ceo")).toEqual(["Earn two billion in revenue", "Grow monthly active users"]);
    expect(await listed("pm")).toHaveLength(2);
    expect(await listed("audit")).toEqual([]);
    expect(await listed("ada")).toEqual([]);
    expect((await as("ada").get(`/performance/goals/${ids.goalA}`)).status).toBe(404);
    expect((await as("audit").get(`/performance/goals/${ids.goalA}`)).status).toBe(404);
    expect((await as("pm").get(`/performance/goals/${ids.goalA}`)).status).toBe(200);
    // The same key results: a function's own, and not another's or the company's.
    expect((await as("ada").get(`/performance/key-results/${ids.bmKr}`)).status).toBe(200);
    expect((await as("ada").get(`/performance/key-results/${ids.tboKr}`)).status).toBe(404);
    expect((await as("ada").get(`/performance/key-results/${ids.coKr1}`)).status).toBe(404);
    expect((await as("audit").get(`/performance/key-results/${ids.tboKr}`)).status).toBe(200);
    expect((await as("audit").get(`/performance/key-results/${ids.coKr1}`)).status).toBe(404);
    // The summary counts what the reader reads, and gives the company score to the whole plan alone.
    const own = c.goals.OkrSummary.parse((await as("ada").get(`/performance/okrs/summary?period_id=${ids.q4}`)).body);
    expect(own).toMatchObject({ company_score: null, key_results: 1 });
    const all = c.goals.OkrSummary.parse((await as("pm").get(`/performance/okrs/summary?period_id=${ids.q4}`)).body);
    expect(all.key_results).toBe(4);
    // The functions a reader may pick are the ones they read; the company is the whole plan's.
    const functions = async (who) => (await as(who).get(`/performance/functions?period_id=${ids.q4}`)).body.data.map((f) => f.name ?? "Company");
    expect(await functions("ada")).toEqual(["Branding & Marketing"]);
    expect(await functions("other")).toEqual(["Technology & Back-office Ops"]);
    expect(await functions("pm")).toEqual(expect.arrayContaining(["Company", "Branding & Marketing", "Technology & Back-office Ops"]));
    expect(await functions("audit")).not.toContain("Company");
    expect(await functions("audit")).toEqual(expect.arrayContaining(["Branding & Marketing", "Technology & Back-office Ops"]));
    // Plans: a function's reads its own plan; the company's plan is the whole plan's.
    const plans = async (who) => (await as(who).get(`/performance/plans?period_id=${ids.q4}`)).body.data.map((p) => p.department ?? "Company");
    expect(await plans("ada")).toEqual(["Branding & Marketing"]);
    expect(await plans("pm")).toEqual(expect.arrayContaining(["Company", "Branding & Marketing"]));
    const bmPlan = (await as("pm").get(`/performance/plans?period_id=${ids.q4}&department_id=${ids.bm}`)).body.data[0];
    expect((await as("ada").get(`/performance/plans/${bmPlan.performance_plan_id}`)).status).toBe(200);
    expect((await as("dev").get(`/performance/plans/${bmPlan.performance_plan_id}`)).status).toBe(404);
    const coPlan = (await as("pm").get(`/performance/plans?period_id=${ids.q4}&department_id=company`)).body.data[0];
    expect((await as("audit").get(`/performance/plans/${coPlan.performance_plan_id}`)).status).toBe(404);
    expect((await as("pm").get(`/performance/plans/${coPlan.performance_plan_id}`)).status).toBe(200);
  });

  test("a function's key result names the company key result it feeds by code and statement, and no further", async () => {
    const head = (await as("head").get(`/performance/key-results/${ids.bmKr}`)).body;
    expect(head.linked_company_key_results).toEqual([{ okr_key_result_id: ids.coKr1, code: "CO-KR1.1", statement: "64,000 monthly active users" }]);
    const trace = (await as("ada").get(`/performance/key-results/${ids.bmKr}/trace`)).body.steps;
    expect(trace.map((s) => s.kind)).toEqual(["key_result", "company_key_result"]);
    expect((await as("pm").get(`/performance/key-results/${ids.bmKr}/trace`)).body.steps.map((s) => s.kind)).toEqual([
      "key_result",
      "company_key_result",
      "objective",
      "organisational_goal",
    ]);
    // A head sets Feeds from the company's key results (code and statement); staff are offered none.
    const picker = async (who) => (await as(who).get(`/performance/key-results?period_id=${ids.q4}&level=company`)).body.data.map((k) => k.code);
    expect(await picker("head")).toEqual(["CO-KR1.1", "CO-KR1.2"]);
    expect(await picker("ada")).toEqual([]);
    expect((await as("ada").get(`/performance/key-results?period_id=${ids.q4}&level=function`)).body.data.map((k) => k.code)).toEqual(["BM-KR1.1"]);
    // The company key result lists only the function key results its reader may read as Fed By.
    expect((await as("pm").get(`/performance/key-results/${ids.coKr1}`)).body.contributing).toEqual([
      expect.objectContaining({ code: "BM-KR1.1" }),
    ]);
  });

  test("a key result a person owns is theirs to read wherever it sits, and its objective shows that key result alone", async () => {
    await q("UPDATE okr_key_result SET accountable_employee_id = $2 WHERE okr_key_result_id = $1", [ids.coKr1, emp("dev")]);
    const tree = (await as("dev").get(`/performance/okrs?period_id=${ids.q4}`)).body.data.sort((a, b) => a.code.localeCompare(b.code));
    expect(tree.map((o) => o.code)).toEqual(["CO-O1", "TBO-O1"]);
    const company = c.goals.ObjectivePage.parse({ data: tree, page: { number: 1, size: 25, total: tree.length, pages: 1, has_next: false } }).data[0];
    expect(company.key_results[0].latest).toBeNull();
    expect(company).toMatchObject({ code: "CO-O1", score: null, can_edit: false, can_share: false, share: null });
    expect(company.key_results.map((k) => k.code)).toEqual(["CO-KR1.1"]);
    expect((await as("dev").get(`/performance/key-results/${ids.coKr1}`)).status).toBe(200);
    expect((await as("dev").get(`/performance/key-results/${ids.coKr2}`)).status).toBe(404);
    expect((await as("dev").get(`/performance/objectives/${ids.co}`)).body.key_results.map((k) => k.code)).toEqual(["CO-KR1.1"]);
    // The goal it serves is not theirs: the trace stops at the objective.
    expect((await as("dev").get(`/performance/key-results/${ids.coKr1}/trace`)).body.steps.map((s) => s.kind)).toEqual(["key_result", "objective"]);
    expect((await as("dev").get(`/performance/goals/${ids.goalA}`)).status).toBe(404);
    // Fed By lists only the function key results the reader may read: Femi reads none of Branding's.
    expect((await as("dev").get(`/performance/key-results/${ids.coKr1}`)).body.contributing).toEqual([]);
    await q("UPDATE okr_key_result SET accountable_employee_id = NULL WHERE okr_key_result_id = $1", [ids.coKr1]);
    expect(await codes("dev")).toEqual(["TBO-O1"]);
  });

  test("KPIs follow the same rule", async () => {
    const names = async (who) => (await as(who).get(`/performance/kpis?period_id=${ids.q4}`)).body.data.map((k) => k.code);
    expect(await names("ada")).toEqual(["BM-K01"]);
    expect(await names("dev")).toEqual(["TBO-K01"]);
    expect(await names("audit")).toEqual(["BM-K01", "TBO-K01"]);
    expect(await names("pm")).toEqual(["BM-K01", "TBO-K01"]);
    expect((await as("ada").get(`/performance/kpis/${ids.tboKpi}`)).status).toBe(404);
    expect((await as("ada").get(`/performance/kpis/${ids.bmKpi}`)).status).toBe(200);
    const month = "2026-10-01";
    expect((await as("ada").get(`/performance/kpis/summary?month=${month}`)).body.kpis).toBe(1);
    expect((await as("pm").get(`/performance/kpis/summary?month=${month}`)).body.kpis).toBe(2);
  });

  test("Share Goal: whoever holds goals.organisation; all staff or chosen departments; a department's people read it, the others do not", async () => {
    const body = { audience: "departments", department_ids: [ids.bm] };
    // The capability decides: Management set the company's objectives, not the organisational goals (those in
    // General Management hold it through the department, P27).
    expect((await as("mgr").put(`/performance/goals/${ids.goalA}/share`, body)).status).toBe(403);
    expect((await as("ada").put(`/performance/goals/${ids.goalA}/share`, body)).status).toBe(403);
    // A department chosen must be an active one, and an all-staff share names none.
    expect((await as("ceo").put(`/performance/goals/${ids.goalA}/share`, { audience: "departments", department_ids: [] })).status).toBe(422);
    expect((await as("ceo").put(`/performance/goals/${ids.goalA}/share`, { audience: "all", department_ids: [ids.bm] })).status).toBe(422);
    const unknown = await as("ceo").put(`/performance/goals/${ids.goalA}/share`, { audience: "departments", department_ids: ["8a6e0804-2bd0-4672-b79d-d97027f9071a"] });
    expect([unknown.status, unknown.body.error.fields]).toEqual([422, { department_ids: ["Not a department"] }]);
    expect((await as("ceo").put("/performance/goals/8a6e0804-2bd0-4672-b79d-d97027f9071a/share", body)).status).toBe(404);

    const shared = await as("ceo").put(`/performance/goals/${ids.goalA}/share`, body);
    expect(shared.status).toBe(200);
    const share = c.goals.GoalShare.parse(shared.body);
    expect(share).toMatchObject({ organisational_goal_id: ids.goalA, okr_objective_id: null, audience: "departments" });
    expect(share.departments.map((d) => d.department_id)).toEqual([ids.bm]);
    expect(share.shared_by.employee_id).toBe(emp("ceo"));

    // Branding & Marketing read it, read only; Technology & Back-office Ops do not; nothing else is shared with them.
    const ada = await as("ada").get(`/performance/goals/${ids.goalA}`);
    expect(ada.status).toBe(200);
    expect(c.goals.OrganisationalGoalDetail.parse(ada.body)).toMatchObject({ can_share: false, share: null, title: "Grow monthly active users" });
    expect(ada.body.objectives).toEqual([]);
    expect((await as("ada").get("/performance/goals")).body.data.map((g) => g.title)).toEqual(["Grow monthly active users"]);
    expect((await as("ada").get(`/performance/goals/${ids.goalB}`)).status).toBe(404);
    expect((await as("dev").get(`/performance/goals/${ids.goalA}`)).status).toBe(404);
    expect((await as("audit").get(`/performance/goals/${ids.goalA}`)).status).toBe(404);
    // The sharer sees how it is shared; read only for the reader.
    const mine = (await as("ceo").get("/performance/goals")).body.data.find((g) => g.organisational_goal_id === ids.goalA);
    expect(mine).toMatchObject({ can_share: true, share: { audience: "departments" } });
    expect((await as("ada").patch(`/performance/goals/${ids.goalA}`, { title: "x" })).status).toBe(403);
    expect((await as("ada").del(`/performance/goals/${ids.goalA}/share`)).status).toBe(403);
    // Search finds it for them, and for no one else outside.
    const found = async (who) =>
      ((await as(who).get("/search?q=monthly active")).body.groups || []).filter((g) => g.type === "organisational_goal").flatMap((g) => g.items.map((i) => i.id));
    expect(await found("ada")).toEqual([ids.goalA]);
    expect(await found("dev")).toEqual([]);
    expect(await found("ceo")).toEqual([ids.goalA]);
    // Home's goals read the same rule.
    const reach = async (who) => visibility.readerOf(pool, await actorOf(who));
    const homeTitles = async (who) =>
      (await homeGoals.organisationGoals(pool, { from: "2026-10-01", to: "2026-12-31" }, {}, await reach(who))).data.map((g) => g.title);
    expect(await homeTitles("ada")).toEqual(["Grow monthly active users"]);
    expect(await homeTitles("dev")).toEqual([]);
    expect((await homeTitles("pm")).sort()).toEqual(["Earn two billion in revenue", "Grow monthly active users"]);
    await drain();
    // Branding & Marketing's people were told once; the sharer and Technology were not.
    expect(await told("ada", "organisational_goal.shared")).toEqual([{ title: "A goal was shared with you", body: expect.stringContaining("Grow monthly active users") }]);
    expect(await told("head", "organisational_goal.shared")).toHaveLength(1);
    expect(await told("dev", "organisational_goal.shared")).toEqual([]);
    expect(await told("ceo", "organisational_goal.shared")).toEqual([]);
    expect(await told("pm", "organisational_goal.shared")).toEqual([]);
  });

  test("widening a share tells only the people it newly reaches; stopping tells nobody and takes it back", async () => {
    const wider = await as("ceo").put(`/performance/goals/${ids.goalA}/share`, { audience: "all", department_ids: [] });
    expect(wider.status).toBe(200);
    expect(wider.body).toMatchObject({ audience: "all", departments: [] });
    await drain();
    expect(await told("dev", "organisational_goal.shared")).toHaveLength(1);
    expect(await told("audit", "organisational_goal.shared")).toHaveLength(1);
    // Whoever reads the whole plan reads it already: Operations & People, Management, General Management.
    for (const who of ["ops", "mgr", "tech", "pm"]) expect(await told(who, "organisational_goal.shared")).toEqual([]);
    // Branding & Marketing already had it: still one notice each.
    expect(await told("ada", "organisational_goal.shared")).toHaveLength(1);
    expect((await as("dev").get(`/performance/goals/${ids.goalA}`)).status).toBe(200);
    expect((await as("audit").get(`/performance/goals/${ids.goalA}`)).status).toBe(200);
    // One share per goal: saving again replaced it.
    expect(Number((await one("SELECT count(*) AS n FROM goal_share WHERE organisational_goal_id = $1", [ids.goalA])).n)).toBe(1);
    expect(Number((await one("SELECT count(*) AS n FROM goal_share_department")).n)).toBe(0);

    expect((await as("mgr").del(`/performance/goals/${ids.goalA}/share`)).status).toBe(403);
    expect((await as("ceo").del(`/performance/goals/${ids.goalA}/share`)).status).toBe(204);
    expect((await as("ceo").del(`/performance/goals/${ids.goalA}/share`)).status).toBe(204);
    expect((await as("ada").get(`/performance/goals/${ids.goalA}`)).status).toBe(404);
    expect((await as("dev").get("/performance/goals")).body.data).toEqual([]);
    await drain();
    expect(await told("dev", "organisational_goal.shared")).toHaveLength(1);
    expect((await one("SELECT count(*)::int AS n FROM event_outbox WHERE event_key = 'organisational_goal.unshared'")).n).toBe(1);
    // Deleting a goal takes its share with it.
    await as("ceo").put(`/performance/goals/${ids.goalB}/share`, { audience: "all", department_ids: [] });
    expect((await as("ceo").del(`/performance/goals/${ids.goalB}`)).status).toBe(204);
    expect(Number((await one("SELECT count(*) AS n FROM goal_share WHERE organisational_goal_id = $1", [ids.goalB])).n)).toBe(0);
  });

  test("Share Objective: Management's; a company objective with its key results, read only; a function's is refused", async () => {
    const body = { audience: "departments", department_ids: [ids.tbo] };
    expect((await as("head").put(`/performance/objectives/${ids.co}/share`, body)).status).toBe(403);
    expect((await as("ada").put(`/performance/objectives/${ids.co}/share`, body)).status).toBe(403);
    const refused = await as("pm").put(`/performance/objectives/${ids.bmO}/share`, body);
    expect([refused.status, refused.body.error.code]).toEqual([409, "NOT_A_COMPANY_OBJECTIVE"]);

    const shared = await as("pm").put(`/performance/objectives/${ids.co}/share`, body);
    expect(shared.status).toBe(200);
    expect(c.goals.GoalShare.parse(shared.body)).toMatchObject({ okr_objective_id: ids.co, organisational_goal_id: null, audience: "departments" });

    // Technology & Back-office Ops read the objective with every key result; Branding & Marketing do not.
    const dev = await as("dev").get(`/performance/objectives/${ids.co}`);
    expect(dev.status).toBe(200);
    expect(c.goals.Objective.parse(dev.body)).toMatchObject({ code: "CO-O1", can_edit: false, can_share: false, share: null });
    expect(dev.body.key_results.map((k) => k.code)).toEqual(["CO-KR1.1", "CO-KR1.2"]);
    expect(await codes("dev")).toEqual(["CO-O1", "TBO-O1"]);
    expect(await codes("ada")).toEqual(["BM-O1"]);
    expect((await as("dev").get(`/performance/key-results/${ids.coKr2}`)).status).toBe(200);
    expect((await as("ada").get(`/performance/key-results/${ids.coKr2}`)).status).toBe(404);
    // Its goal is not shared with them, so the trace stops at the objective; Fed By names only what they read.
    expect((await as("dev").get(`/performance/key-results/${ids.coKr1}/trace`)).body.steps.map((s) => s.kind)).toEqual(["key_result", "objective"]);
    expect((await as("dev").get(`/performance/goals/${ids.goalA}`)).status).toBe(404);
    // The sharer sees it; the reader does not.
    const tree = (await as("pm").get(`/performance/okrs?period_id=${ids.q4}`)).body.data.find((o) => o.okr_objective_id === ids.co);
    expect(tree).toMatchObject({ can_share: true, share: { audience: "departments" } });
    expect((await as("dev").patch(`/performance/objectives/${ids.co}`, { title: "x" })).status).toBe(403);
    // Search and the summary read it for them; the company score stays the whole plan's.
    const found = async (who) =>
      ((await as(who).get("/search?q=trusted view")).body.groups || []).filter((g) => g.type === "objective").flatMap((g) => g.items.map((i) => i.id));
    expect(await found("dev")).toEqual([ids.co]);
    expect(await found("ada")).toEqual([]);
    expect((await as("dev").get(`/performance/okrs/summary?period_id=${ids.q4}`)).body.company_score).toBeNull();
    await drain();
    expect(await told("dev", "objective.shared")).toEqual([{ title: "An objective was shared with you", body: expect.stringContaining("One trusted view") }]);
    expect(await told("other", "objective.shared")).toHaveLength(1);
    expect(await told("ada", "objective.shared")).toEqual([]);
    expect(await told("pm", "objective.shared")).toEqual([]);

    expect((await as("pm").del(`/performance/objectives/${ids.co}/share`)).status).toBe(204);
    expect((await as("dev").get(`/performance/objectives/${ids.co}`)).status).toBe(404);
    expect(await codes("dev")).toEqual(["TBO-O1"]);
  });

  test("the assistant reads the tree as the asker does", async () => {
    const read = (module, key) => module.reads.find((r) => r.key === key);
    const okrs = async (who) => {
      const actor = { ...(await actorOf(who)), scope: { scope: "own", scope_ids: [], employee_id: emp(who) } };
      return (await read(goalsAi, "goals.okrs").run(pool, { period_id: ids.q4 }, actor)).data.map((o) => o.code);
    };
    expect(await okrs("ada")).toEqual(["BM-O1"]);
    expect((await okrs("pm")).sort()).toEqual(["BM-O1", "CO-O1", "TBO-O1"]);
    const kpis = async (who) => {
      const actor = { ...(await actorOf(who)), scope: { scope: "own", scope_ids: [], employee_id: emp(who) } };
      return (await read(kpisAi, "kpis.list").run(pool, {}, actor)).data.map((k) => k.code);
    };
    expect(await kpis("dev")).toEqual(["TBO-K01"]);
    expect(await kpis("audit")).toEqual(["BM-K01", "TBO-K01"]);
  });

  test("a reviewer reads the function of the scorecards they review: a manager of someone in another function links that scorecard's lines to its key results", async () => {
    expect(await codes("dev")).toEqual(["TBO-O1"]);
    const card = await as("head").post("/performance/scorecards", { employee_id: emp("ada"), performance_period_id: ids.q4 });
    expect(card.status).toBe(201);
    // Operations & People name Femi, of Technology, as the reviewer of a Branding & Marketing scorecard.
    const named = await as("ops").patch(`/performance/scorecards/${card.body.scorecard_id}`, { reviewer_employee_id: emp("dev"), reviewer_reason: "Cross-function project" });
    expect(named.status).toBe(200);
    expect(await codes("dev")).toEqual(["BM-O1", "TBO-O1"]);
    expect((await as("dev").get(`/performance/key-results/${ids.bmKr}`)).status).toBe(200);
    // Only the function of what they review: not the company, and nothing of another function's.
    expect((await as("dev").get(`/performance/objectives/${ids.co}`)).status).toBe(404);
    expect((await as("ada").get(`/performance/okrs?period_id=${ids.q4}`)).body.data.map((o) => o.code)).toEqual(["BM-O1"]);
    await q("DELETE FROM scorecard WHERE scorecard_id = $1", [card.body.scorecard_id]);
    expect(await codes("dev")).toEqual(["TBO-O1"]);
  });

  test("Operations & People read the whole plan, and share and edit it (P27)", async () => {
    expect(await codes("ops")).toEqual(["BM-O1", "CO-O1", "TBO-O1"]);
    expect((await as("ops").get(`/performance/objectives/${ids.co}`)).status).toBe(200);
    expect((await as("ops").get(`/performance/key-results/${ids.coKr1}`)).status).toBe(200);
    expect((await as("ops").get("/performance/goals")).body.data.length).toBeGreaterThanOrEqual(1);
    // They record an organisational goal, share it, change it and stop sharing it.
    const made = await as("ops").post("/performance/goals", { title: "Open three new cities", strategic_theme: "Growth", plan_year_starts_on: "2026-01-01" });
    expect(made.status).toBe(201);
    const goal = made.body.organisational_goal_id;
    expect(c.goals.OrganisationalGoalDetail.parse((await as("ops").get(`/performance/goals/${goal}`)).body)).toMatchObject({ can_share: true });
    expect((await as("ops").put(`/performance/goals/${goal}/share`, { audience: "all", department_ids: [] })).status).toBe(200);
    expect((await as("ops").patch(`/performance/goals/${goal}`, { title: "Open four new cities" })).status).toBe(200);
    expect((await as("ada").get(`/performance/goals/${goal}`)).status).toBe(200);
    expect((await as("ops").del(`/performance/goals/${goal}/share`)).status).toBe(204);
    expect((await as("ada").get(`/performance/goals/${goal}`)).status).toBe(404);
    // They set the company's objectives and share one with its key results.
    expect((await as("ops").patch(`/performance/objectives/${ids.co}`, { title: "One trusted view of MyCity" })).status).toBe(200);
    expect((await as("ops").patch(`/performance/objectives/${ids.co}`, { title: "One trusted view" })).status).toBe(200);
    expect((await as("ops").put(`/performance/objectives/${ids.co}/share`, { audience: "departments", department_ids: [ids.tbo] })).status).toBe(200);
    expect((await as("dev").get(`/performance/objectives/${ids.co}`)).status).toBe(200);
    expect((await as("ops").del(`/performance/objectives/${ids.co}/share`)).status).toBe(204);
    expect((await as("ops").del(`/performance/goals/${goal}`)).status).toBe(204);
  });

  test("everyone in General Management holds the plan through the department, not a role (P27)", async () => {
    const grantsCache = require("../../src/shared/rbac/grants-cache");
    const held = (who) => grantsCache.getCapabilities(pool, people[who].user.user_id);
    const GM = ["goals.company", "goals.organisation", "goals.view_all"];
    // A Technical Assistant with only the staff role, in the CEO's department.
    expect(await held("tech")).toEqual(GM);
    expect(await held("ada")).toEqual([]);
    expect(await codes("tech")).toEqual(["BM-O1", "CO-O1", "TBO-O1"]);
    expect((await visibility.readerOf(pool, await actorOf("tech"))).full).toBe(true);
    // They record, share, change and delete an organisational goal, and set the company's objectives.
    const made = await as("tech").post("/performance/goals", { title: "Reach every state capital", strategic_theme: "Growth", plan_year_starts_on: "2026-01-01" });
    expect(made.status).toBe(201);
    const goal = made.body.organisational_goal_id;
    expect((await as("tech").put(`/performance/goals/${goal}/share`, { audience: "departments", department_ids: [ids.bm] })).status).toBe(200);
    expect((await as("ada").get(`/performance/goals/${goal}`)).status).toBe(200);
    expect((await as("dev").get(`/performance/goals/${goal}`)).status).toBe(404);
    expect((await as("tech").patch(`/performance/goals/${goal}`, { title: "Reach every capital" })).status).toBe(200);
    expect((await as("tech").patch(`/performance/objectives/${ids.co}`, { title: "One trusted view" })).status).toBe(200);
    // A function's own goals stay its head's: General Management do not set Branding & Marketing's.
    expect((await as("tech").post("/performance/objectives", { performance_period_id: ids.q4, department_id: ids.bm, title: "Not theirs" })).status).toBe(403);

    // The rule is the CEO's department, however it is named or coded.
    await q("UPDATE department SET name = 'Executive Office', code = 'EXEC' WHERE department_id = $1", [(await one("SELECT department_id FROM employee WHERE employee_id = $1", [emp("ceo")])).department_id]);
    await grantsCache.invalidateUser(people.tech.user.user_id);
    expect(await held("tech")).toEqual(GM);

    // A person moved out of it loses the three, and with them the plan.
    await q("UPDATE employee SET department_id = $2 WHERE employee_id = $1", [emp("tech"), ids.tbo]);
    await grantsCache.invalidateUser(people.tech.user.user_id);
    expect(await held("tech")).toEqual([]);
    expect(await codes("tech")).toEqual(["TBO-O1"]);
    expect((await as("tech").put(`/performance/goals/${goal}/share`, { audience: "all", department_ids: [] })).status).toBe(403);
    expect((await as("tech").get(`/performance/goals/${goal}`)).status).toBe(404);
    expect((await as("ceo").del(`/performance/goals/${goal}`)).status).toBe(204);
  });

  test("a person with no login, or no grant, reads nothing", async () => {
    expect((await visibility.readerOf(pool, null)).none).toBe(true);
    expect((await visibility.readerOf(pool, { user_id: people.ada.user.user_id, role_ids: [] })).none).toBe(true);
    const reach = await visibility.readerOf(pool, await actorOf("ada"));
    expect(reach).toMatchObject({ none: false, full: false, all_functions: false, department_ids: [ids.bm] });
    expect(await visibility.readerOf(pool, await actorOf("audit"))).toMatchObject({ all_functions: true, full: false });
    expect((await visibility.readerOf(pool, await actorOf("ops"))).full).toBe(true);
    expect((await visibility.readerOf(pool, await actorOf("pm"))).full).toBe(true);
    expect((await visibility.readerOf(pool, await actorOf("ceo"))).full).toBe(true);
    // A head's reach includes the department they head, whatever their own record says.
    expect((await visibility.readerOf(pool, await actorOf("other"))).department_ids).toEqual([ids.tbo]);
  });
});
