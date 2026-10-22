"use strict";
/**
 * Performance PR 2 end to end (docs/guides/performance.md §3.1, §3.2, §3.5, §6.3 to §6.8): the real
 * migrations, the whole app through HTTP, every response parsed with its contract (APP_ENV=test).
 *
 * The CEO records an organisational goal; Management set the company's objective; the head of
 * Branding & Marketing sets the function's objectives, key results and a KPI and drafts two
 * scorecards; Send Plan refuses a contribution that does not add up and section weights that do
 * not fill; the plan goes to the Program Manager, Operations & People and the CEO, and a refusal
 * returns it; once binding the scorecards are agreed or disagreed; the head reports the month,
 * Recovery needs an owner, the company key result scored from the function's takes its month; the
 * CEO confirms; a target change applies on the CEO's approval; TBC targets lock on the lock date.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/performance-plan
 */
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const goals = require("../../src/modules/goals/goals.service");
const homeGoals = require("../../src/modules/dashboard/sources/goals.source");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const PASSWORD = "Perf-Plan9Test";

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

describeDb("performance plan against the real migrations", () => {
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
    await make("musa", "Musa", "Danjuma", "employee", "Graphics Associate", "Branding & Marketing");
    await make("other", "Bisi", "Lawal", "head_of_department", "Head, Tech", "Technology & Back-office Ops");
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = ANY($2::uuid[])", [emp("head"), [emp("ada"), emp("musa")]]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = ANY($2::uuid[])", [emp("pm"), [emp("head"), emp("ops")]]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = ANY($2::uuid[])", [emp("ceo"), [emp("pm"), emp("other")]]);
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
        .set("X-Forwarded-For", `10.64.0.${ip}`)
        .send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }
    const period = await as("ops").post("/performance/periods", { starts_on: "2026-10-01", targets_lock_on: "2026-10-31" });
    expect(period.status).toBe(201);
    ids.period = period.body.performance_period_id;
    expect((await as("ops").patch(`/performance/periods/${ids.period}`, { status: "active" })).status).toBe(200);
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("the CEO records an organisational goal, active at once, with a target per quarter; Home reads it", async () => {
    expect((await as("pm").post("/performance/goals", { title: "x", plan_year_starts_on: "2026-01-01" })).status).toBe(403);
    const res = await as("ceo").post("/performance/goals", {
      code: "OG1",
      title: "Grow active users",
      strategic_theme: "Growth",
      success_measure: "Monthly active users",
      plan_year_starts_on: "2026-01-01",
      targets: [{ performance_period_id: ids.period, target_text: "64,000 users", target_value: "64000" }],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ code: "OG1", status: "active", starts_on: "2026-01-01", ends_on: "2026-12-31" });
    ids.goal = res.body.organisational_goal_id;
    const detail = await as("ada").get(`/performance/goals/${ids.goal}`);
    expect(detail.body.targets).toEqual([expect.objectContaining({ period_name: "Q4 2026", target_value: "64000" })]);
    const home = await homeGoals.organisationGoals(pool, { from: "2026-10-01", to: "2026-12-31" }, {});
    expect(home.data.map((g) => g.title)).toContain("Grow active users");
  });

  test("Management set the company objective; staff cannot", async () => {
    expect((await as("ada").post("/performance/objectives", { performance_period_id: ids.period, title: "x" })).status).toBe(403);
    const o = await as("pm").post("/performance/objectives", { performance_period_id: ids.period, title: "One trusted view", organisational_goal_id: ids.goal });
    expect(o.status).toBe(201);
    expect(o.body).toMatchObject({ code: "CO-O1", department_id: null, plan_status: "draft" });
    ids.coObjective = o.body.okr_objective_id;
    const kr = await as("pm").post("/performance/key-results", { okr_objective_id: ids.coObjective, statement: "64,000 monthly active users", target_value: "64000", unit: "users" });
    expect(kr.status).toBe(201);
    expect(kr.body.code).toBe("CO-KR1.1");
    ids.coKr = kr.body.okr_key_result_id;
  });

  test("the head sets the function's objectives, key results and a KPI; another head cannot", async () => {
    expect((await as("other").post("/performance/objectives", { performance_period_id: ids.period, department_id: ids.bm, title: "x" })).status).toBe(403);
    const o = await as("head").post("/performance/objectives", { performance_period_id: ids.period, department_id: ids.bm, title: "Be the app residents open first" });
    expect(o.status).toBe(201);
    expect(o.body.code).toBe("BM-O1");
    ids.objective = o.body.okr_objective_id;
    const kr1 = await as("head").post("/performance/key-results", {
      okr_objective_id: ids.objective,
      statement: "Grow monthly active users to 64,000",
      target_value: "64000",
      unit: "users",
      accountable_employee_id: emp("head"),
      linked_company_key_result_ids: [ids.coKr],
    });
    expect(kr1.status).toBe(201);
    expect(kr1.body).toMatchObject({ code: "BM-KR1.1", linked_company_key_results: [expect.objectContaining({ code: "CO-KR1.1" })] });
    ids.kr1 = kr1.body.okr_key_result_id;
    const kr2 = await as("head").post("/performance/key-results", {
      okr_objective_id: ids.objective,
      statement: "Publish 36 city stories",
      target_value: "36",
      target_provisional: true,
      accountable_employee_id: emp("head"),
    });
    expect(kr2.body.code).toBe("BM-KR1.2");
    ids.kr2 = kr2.body.okr_key_result_id;
    // The company key result is wholly delivered by the function's.
    expect((await as("pm").patch(`/performance/key-results/${ids.coKr}`, { scored_from_key_result_id: ids.kr1 })).status).toBe(200);
    const kpi = await as("head").post("/performance/kpis", { department_id: ids.bm, name: "Assets on time", unit: "%", target_value: "95" });
    expect(kpi.status).toBe(201);
    expect(kpi.body.code).toBe("BM-K01");
    ids.kpi = kpi.body.kpi_definition_id;
    const trace = await as("ada").get(`/performance/key-results/${ids.kr1}/trace`);
    expect(trace.body.steps.map((s) => s.kind)).toEqual(["key_result", "company_key_result", "objective", "organisational_goal"]);
  });

  test("the head drafts two scorecards, never their own; Send Plan refuses what would be wrong", async () => {
    expect((await as("ada").post("/performance/scorecards", { employee_id: emp("ada"), performance_period_id: ids.period })).status).toBe(403);
    const a = await as("head").post("/performance/scorecards", { employee_id: emp("ada"), performance_period_id: ids.period });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ status: "draft", reviewer: expect.objectContaining({ employee_id: emp("head") }) });
    expect(a.body.lines.map((l) => l.source)).toEqual(["commitments", "update_on_time"]);
    ids.cardA = a.body.scorecard_id;
    const b = await as("head").post("/performance/scorecards", { employee_id: emp("musa"), performance_period_id: ids.period, copy_from: ids.cardA });
    ids.cardB = b.body.scorecard_id;

    const accountability = a.body.lines.map((l) => ({ ...l, team_key_result_ids: [], key_result: undefined, kpi: undefined, team_key_results: undefined, months: undefined, score: undefined, can_change_target: undefined, pending_change: undefined, scorecard_id: undefined, position: undefined }));
    const strip = (l) => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined && v !== null));
    const lines = (share, kpiWeight = "25") => [
      { section: "results", title: "Users in my territories", measure: "numeric", source: "own", target_value: share, weight: "60", okr_key_result_id: ids.kr1, share_value: share },
      { section: "kpis", title: "Assets on time", measure: "standard", source: "function_kpi", kpi_definition_id: ids.kpi, target_value: "95", unit: "%", weight: kpiWeight },
      ...accountability.map((l) => strip({ ...l, employee_target_id: undefined })),
    ];
    const bad = await as("head").put(`/performance/scorecards/${ids.cardA}/lines`, { lines: [{ section: "results", title: "x", measure: "standard", weight: "60" }] });
    expect(bad.status).toBe(422);
    expect((await as("head").put(`/performance/scorecards/${ids.cardA}/lines`, { lines: lines("40000") })).status).toBe(200);
    expect((await as("head").put(`/performance/scorecards/${ids.cardB}/lines`, { lines: lines("20000", "20") })).status).toBe(200);

    const plan = (await as("head").get(`/performance/plans?period_id=${ids.period}&department_id=${ids.bm}`)).body.data[0];
    ids.plan = plan.performance_plan_id;
    let detail = await as("head").get(`/performance/plans/${ids.plan}`);
    expect(detail.body.problems.map((p) => p.code).sort()).toEqual(["CONTRIBUTION_REBALANCE", "WEIGHTS_NOT_100"]);
    expect(detail.body.contributions[0]).toMatchObject({ code: "BM-KR1.1", total: "60000", difference: "4000", status: "rebalance" });
    expect(detail.body.can_submit).toBe(false);
    const refused = await as("head").post(`/performance/plans/${ids.plan}/submit`);
    expect(refused.status).toBe(409);

    expect((await as("head").put(`/performance/scorecards/${ids.cardB}/lines`, { lines: lines("24000") })).status).toBe(200);
    detail = await as("head").get(`/performance/plans/${ids.plan}`);
    expect(detail.body.problems.filter((p) => p.blocking)).toEqual([]);
    expect(detail.body.can_submit).toBe(true);
    expect(detail.body.scorecards).toHaveLength(2);
    expect(detail.body.kpis.map((k) => k.code)).toEqual(["BM-K01"]);
  });

  test("Send Plan: the Program Manager, Operations & People, then the CEO; a refusal returns it", async () => {
    const sent = await as("head").post(`/performance/plans/${ids.plan}/submit`);
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe("submitted");
    expect(sent.body.submitted_by).toMatchObject({ employee_id: emp("head") });
    const instance = await one("SELECT workflow_instance_id, current_stage FROM workflow_instance WHERE entity_id = $1 AND state = 'pending'", [ids.plan]);
    expect(instance.current_stage).toBe("line_manager");
    // Goals · Waiting On You: the stage's approver, and nobody else, has the plan to decide.
    const waiting = async (who, search = "") => (await as(who).get(`/performance/approvals${search}`)).body.data;
    expect(await waiting("pm")).toEqual([
      expect.objectContaining({
        kind: "plan",
        record_id: ids.plan,
        workflow_instance_id: instance.workflow_instance_id,
        department: "Branding & Marketing",
        stage_name: "Line Manager",
        requested_by: expect.objectContaining({ employee_id: emp("head") }),
      }),
    ]);
    expect((await waiting("pm", "?q=brand")).map((r) => r.record_id)).toEqual([ids.plan]);
    expect(await waiting("pm", "?q=finance")).toEqual([]);
    for (const who of ["ops", "ceo", "head", "ada"]) expect(await waiting(who)).toEqual([]);
    // Only the stage's approver decides; Request Changes is a refusal with a reason (§6.4).
    expect((await as("ada").post(`/workflow/instances/${instance.workflow_instance_id}/approve`)).status).toBe(404);
    expect((await as("head").post(`/workflow/instances/${instance.workflow_instance_id}/approve`)).status).toBe(403);
    expect((await as("pm").post(`/workflow/instances/${instance.workflow_instance_id}/reject`, { reason: "" })).status).toBe(422);
    expect((await as("pm").post(`/workflow/instances/${instance.workflow_instance_id}/reject`, { reason: "Tighten BM-KR1.2" })).status).toBe(200);
    expect(await waiting("pm")).toEqual([]);
    await drain();
    let plan = (await as("head").get(`/performance/plans/${ids.plan}`)).body;
    expect(plan).toMatchObject({ status: "returned", returned_reason: "Tighten BM-KR1.2" });

    expect((await as("head").patch(`/performance/key-results/${ids.kr2}`, { target_value: "40" })).status).toBe(200);
    expect((await as("head").post(`/performance/plans/${ids.plan}/submit`)).status).toBe(200);
    const again = await one("SELECT workflow_instance_id FROM workflow_instance WHERE entity_id = $1 AND state = 'pending'", [ids.plan]);
    const decide = (who) => as(who).post(`/workflow/instances/${again.workflow_instance_id}/approve`);
    expect((await decide("pm")).body.stage_name).toBe("Operations & People");
    expect((await waiting("ops")).map((r) => r.stage_name)).toEqual(["Operations & People"]);
    expect((await decide("ops")).body.stage_name).toBe("CEO");
    expect((await waiting("ceo")).map((r) => [r.kind, r.stage_name])).toEqual([["plan", "CEO"]]);
    expect((await decide("ceo")).body.state).toBe("approved");
    expect(await waiting("ceo")).toEqual([]);
    await drain();
    plan = (await as("head").get(`/performance/plans/${ids.plan}`)).body;
    expect(plan.status).toBe("binding");
    expect((await as("ada").get(`/performance/scorecards/${ids.cardA}`)).body).toMatchObject({ status: "binding", can_agree: true });
    const notice = await one(
      "SELECT title FROM notification n JOIN app_user u ON u.user_id = n.user_id WHERE u.employee_id = $1 ORDER BY n.created_at DESC LIMIT 1",
      [emp("ada")],
    );
    expect(notice.title).toMatch(/scorecard is ready to agree/);
    // Binding: the tree and the lines change only through a target change.
    expect((await as("head").post("/performance/key-results", { okr_objective_id: ids.objective, statement: "x" })).status).toBe(409);
    expect((await as("head").put(`/performance/scorecards/${ids.cardA}/lines`, { lines: [] })).status).toBe(409);
  });

  test("agreement: one tap each; a disagreement clears both and tells the reviewer", async () => {
    expect((await as("musa").post(`/performance/scorecards/${ids.cardA}/agree`)).status).toBe(403);
    expect((await as("ada").post(`/performance/scorecards/${ids.cardA}/agree`)).body.status).toBe("binding");
    const both = await as("head").post(`/performance/scorecards/${ids.cardA}/agree`);
    expect(both.body).toMatchObject({ status: "agreed", can_agree: false });
    expect((await as("musa").post(`/performance/scorecards/${ids.cardB}/agree`)).status).toBe(200);
    const no = await as("musa").post(`/performance/scorecards/${ids.cardB}/disagree`, { disagree_reason: "My share is too high" });
    expect(no.body).toMatchObject({ status: "binding", employee_agreed_at: null, disagree_reason: "My share is too high" });
    const list = await as("head").get(`/performance/scorecards?period_id=${ids.period}`);
    expect(list.body.data.map((s) => s.status).sort()).toEqual(["agreed", "binding"]);
    expect((await as("ada").get("/performance/scorecards")).body.data.map((s) => s.scorecard_id)).toEqual([ids.cardA]);
    const home = await homeGoals.targetsOf(pool, { employee_id: emp("ada"), from: "2026-10-01", to: "2026-12-31" }, {});
    expect(home.data.length).toBe(4);

    // The agreement reminder: scheduled for both scorecards when the plan bound, asking only whoever
    // has not agreed, and ended once both have.
    const due = await q(
      "SELECT entity_id, reminder_id FROM reminder WHERE reminder_key = 'scorecard_agree_due' AND state = 'pending' ORDER BY entity_id",
    );
    expect(due.rows.map((r) => r.entity_id).sort()).toEqual([ids.cardA, ids.cardB].sort());
    const targetsService = require("../../src/modules/targets/targets.service");
    const check = (cardId) => tx((c) => targetsService.agreementCheck(c, { entity_id: cardId }));
    expect(await check(ids.cardA)).toBeNull();
    const waiting = await check(ids.cardB);
    expect(waiting.payload.waiting_employee_ids.sort()).toEqual([emp("musa"), emp("head")].sort());
  });

  test("a role reviews: its first holder to agree becomes the reviewer; who reads which scorecards; a binding plan takes a new one as a draft", async () => {
    expect((await as("head").patch(`/performance/scorecards/${ids.cardB}`, { reviewer_role_code: "operations_people", reviewer_reason: "Head on leave" })).status).toBe(403);
    const changed = await as("ops").patch(`/performance/scorecards/${ids.cardB}`, { reviewer_role_code: "operations_people", reviewer_reason: "Head on leave" });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ reviewer: null, reviewer_role_code: "operations_people" });
    expect((await as("musa").post(`/performance/scorecards/${ids.cardB}/agree`)).body.status).toBe("binding");
    const agreed = await as("ops").post(`/performance/scorecards/${ids.cardB}/agree`);
    expect(agreed.status).toBe(200);
    expect(agreed.body).toMatchObject({ status: "agreed", reviewer: expect.objectContaining({ employee_id: emp("ops") }), reviewer_role_code: null });

    // The CEO and Operations & People read every scorecard; an employee reads their own, in the plan too.
    for (const who of ["ceo", "ops"]) expect((await as(who).get(`/performance/scorecards?period_id=${ids.period}`)).body.data).toHaveLength(2);
    expect((await as("ada").get(`/performance/plans/${ids.plan}`)).body.scorecards.map((c) => c.scorecard_id)).toEqual([ids.cardA]);
    expect((await as("head").get(`/performance/plans/${ids.plan}`)).body.scorecards).toHaveLength(2);

    // A binding plan takes a mid-quarter scorecard as a draft, sent on its own (PR 3, §11).
    const late = await as("pm").post("/performance/scorecards", { employee_id: emp("head"), performance_period_id: ids.period });
    expect(late.status).toBe(201);
    expect(late.body).toMatchObject({ status: "draft", can_edit: true, can_send: false, amendment_instance_id: null });
  });

  test("Report Month: one save; Recovery needs an owner and date; a TBC target waits; Scored From takes the month; the CEO confirms", async () => {
    const month = "2026-10-01";
    const report = (kr1) => ({
      month,
      department_id: ids.bm,
      key_results: [
        { okr_key_result_id: ids.kr1, status: "at_risk", actual_value: "38400", update_text: "Two cities slipped", ...kr1 },
        { okr_key_result_id: ids.kr2, status: "off_track", actual_value: "8" },
      ],
      kpis: [{ kpi_definition_id: ids.kpi, result: "met", actual_value: "96" }],
    });
    expect((await as("ada").post("/performance/reports", report({}))).status).toBe(403);
    const figures = async () => (await as("ada").get(`/performance/okrs/summary?period_id=${ids.period}`)).body;
    expect(await figures()).toMatchObject({ key_results: 3, awaiting_report: 3, in_recovery: 0 });
    const refused = await as("head").post("/performance/reports", report({ actual_value: "20000" }));
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe("RECOVERY_REQUIRED");
    const recovering = await as("head").post(
      "/performance/reports",
      report({ actual_value: "20000", recovery_employee_id: emp("ada"), recovery_due_on: "2026-11-14" }),
    );
    expect(recovering.status).toBe(200);
    expect(recovering.body.key_results[0]).toMatchObject({ proposed_score: "0.3125", band: "recovery" });
    // BM-KR1.1 and the company key result Scored From it are in Recovery; nothing awaits a report.
    expect(await figures()).toMatchObject({ in_recovery: 2, on_track: 0, awaiting_report: 0 });
    const ok = await as("head").post("/performance/reports", report({}));
    expect(ok.status).toBe(200);
    expect(ok.body.key_results[0]).toMatchObject({ proposed_score: "0.6", band: "watch", confirmed: false });
    // BM-KR1.2's target is TBC until the lock date: its month is kept, unscored.
    expect(ok.body.key_results[1]).toMatchObject({ status: "off_track", actual_value: "8", proposed_score: null });
    expect(ok.body.kpis[0]).toMatchObject({ result: "met", actual_value: "96" });
    const company = await as("pm").get(`/performance/key-results/${ids.coKr}`);
    expect(company.body.latest).toMatchObject({ month, actual_value: "38400", proposed_score: "0.6" });

    expect((await as("head").post(`/performance/key-results/${ids.kr1}/confirm`, { month, score: "0.6" })).status).toBe(403);
    const confirmed = await as("ceo").post(`/performance/key-results/${ids.kr1}/confirm`, { month, score: "0.65" });
    expect(confirmed.body).toMatchObject({ confirmed_score: "0.65", score: "0.65", confirmed: true });
    // The company key result Scored From BM-KR1.1 takes the confirmed score too.
    expect((await as("pm").get(`/performance/key-results/${ids.coKr}`)).body.latest).toMatchObject({ confirmed_score: "0.65" });
    // Reporting the month again with only a new status keeps its actual, its recovery owner and,
    // the score being the same, the CEO's confirmation.
    const again = await as("head").post("/performance/reports", { month, department_id: ids.bm, key_results: [{ okr_key_result_id: ids.kr1, status: "on_track" }], kpis: [] });
    expect(again.status).toBe(200);
    expect(again.body.key_results[0]).toMatchObject({ status: "on_track", actual_value: "38400", recovery_employee_id: emp("ada"), proposed_score: "0.6", confirmed_score: "0.65" });
    const tree = await as("ada").get(`/performance/okrs?period_id=${ids.period}&department_id=${ids.bm}`);
    expect(tree.body.data[0].key_results.map((k) => k.latest.score)).toEqual(["0.65", null]);
    expect(tree.body.data[0]).toMatchObject({ code: "BM-O1", score: "0.65" });

    // The figures count the whole quarter, or one function, on the server.
    const all = await as("ada").get(`/performance/okrs/summary?period_id=${ids.period}`);
    expect(all.body).toEqual({ company_score: "0.65", key_results: 3, on_track: 0, in_recovery: 0, awaiting_report: 0 });
    const bm = await as("ada").get(`/performance/okrs/summary?period_id=${ids.period}&department_id=${ids.bm}`);
    expect(bm.body).toMatchObject({ company_score: "0.65", key_results: 2 });
    const kpis = await as("ada").get(`/performance/kpis/summary?month=${month}`);
    expect(kpis.body).toEqual({ kpis: 1, met: 1, not_met: 0, awaiting: 0 });
    expect((await as("ada").get("/performance/kpis/summary?month=2026-11-01")).body).toMatchObject({ met: 0, awaiting: 1 });

    // What each reader is offered is what the API would let them do.
    const mayChange = async (who, kr = ids.kr1) => (await as(who).get(`/performance/key-results/${kr}`)).body.can_change_target;
    expect([await mayChange("head"), await mayChange("ceo"), await mayChange("ada"), await mayChange("other")]).toEqual([true, true, false, false]);
    // The accountable person may ask, though they set no goals for the function.
    await q("UPDATE okr_key_result SET accountable_employee_id = $2 WHERE okr_key_result_id = $1", [ids.kr2, emp("other")]);
    expect(await mayChange("other", ids.kr2)).toBe(true);
    await q("UPDATE okr_key_result SET accountable_employee_id = $2 WHERE okr_key_result_id = $1", [ids.kr2, emp("head")]);
    const mayEdit = async (who) => (await as(who).get(`/performance/kpis/${ids.kpi}`)).body.can_edit;
    expect([await mayEdit("head"), await mayEdit("ops"), await mayEdit("ada"), await mayEdit("other")]).toEqual([true, true, false, false]);
  });

  test("a target change applies on the CEO's approval and keeps the original beside it", async () => {
    const res = await as("head").post("/performance/target-changes", {
      okr_key_result_id: ids.kr1,
      to_value: "60000",
      from_month: "2026-11-01",
      reason: "Two cities moved to Q1",
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "pending", from_value: "64000", to_value: "60000" });
    // One change to a target waits at a time.
    const second = await as("head").post("/performance/target-changes", { okr_key_result_id: ids.kr1, to_value: "50000", from_month: "2026-12-01", reason: "Again" });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("CHANGE_PENDING");
    const instance = await one("SELECT workflow_instance_id, current_stage FROM workflow_instance WHERE entity_id = $1", [res.body.target_change_id]);
    expect(instance.current_stage).toBe("ceo");
    // While it waits, the key result offers no second Change Target.
    expect((await as("head").get(`/performance/key-results/${ids.kr1}`)).body.can_change_target).toBe(false);
    // The CEO's Waiting On You names it, and its sheet reads the key result it changes.
    const kr1Code = (await one("SELECT code::text AS code FROM okr_key_result WHERE okr_key_result_id = $1", [ids.kr1])).code;
    expect((await as("ceo").get("/performance/approvals")).body.data).toEqual([
      expect.objectContaining({
        kind: "target_change",
        record_id: res.body.target_change_id,
        key_result_code: kr1Code,
        department: "Branding & Marketing",
        stage_name: "CEO",
      }),
    ]);
    const sheet = await as("ceo").get(`/performance/target-changes/${res.body.target_change_id}`);
    expect(sheet.status).toBe(200);
    expect(sheet.body).toMatchObject({
      key_result: { okr_key_result_id: ids.kr1, code: kr1Code },
      line: null,
      department: "Branding & Marketing",
      reason: "Two cities moved to Q1",
    });
    expect((await as("ada").get(`/performance/target-changes/${res.body.target_change_id}`)).status).toBe(200);
    expect((await as("head").post(`/workflow/instances/${instance.workflow_instance_id}/approve`)).status).toBe(403);
    expect((await as("ceo").post(`/workflow/instances/${instance.workflow_instance_id}/approve`)).status).toBe(200);
    await drain();
    const kr = await as("head").get(`/performance/key-results/${ids.kr1}`);
    expect(kr.body.target_value).toBe("60000");
    expect(kr.body.target_history).toEqual([expect.objectContaining({ status: "approved", from_value: "64000", to_value: "60000" })]);
    expect(kr.body.months[0].proposed_score).toBe("0.6");
    expect(kr.body.can_change_target).toBe(true);
  });

  test("a line's target change: the CEO decides it; whoever reads its scorecard reads it, nobody else", async () => {
    const line = await one("SELECT employee_target_id FROM employee_target WHERE scorecard_id = $1 ORDER BY position LIMIT 1", [ids.cardA]);
    const lineOf = async (who) => (await as(who).get(`/performance/scorecards/${ids.cardA}`)).body.lines.find((l) => l.employee_target_id === line.employee_target_id);
    // A line's own link (a task's Counts Towards) opens its scorecard.
    expect((await as("head").get(`/performance/scorecards/${line.employee_target_id}`)).body.scorecard_id).toBe(ids.cardA);
    // Change Target is the reviewer's or the function head's, never the employee's, nor anyone else's.
    expect([(await lineOf("head")).can_change_target, (await lineOf("ada")).can_change_target, (await lineOf("ops")).can_change_target]).toEqual([true, false, false]);
    const body = { employee_target_id: line.employee_target_id, to_value: "12", from_month: "2026-11-01", reason: "Fewer events in November" };
    expect((await as("ada").post("/performance/target-changes", body)).status).toBe(403);
    expect((await as("ops").post("/performance/target-changes", body)).status).toBe(403);
    const res = await as("head").post("/performance/target-changes", body);
    expect(res.status).toBe(201);
    const id = res.body.target_change_id;
    // While it waits, the line shows it and offers no second Change Target.
    expect(await lineOf("head")).toMatchObject({ can_change_target: false, pending_change: { target_change_id: id, to_value: "12", from_month: "2026-11-01" } });
    expect((await as("head").post("/performance/target-changes", { ...body, to_value: "11" })).body.error.code).toBe("CHANGE_PENDING");
    const [row] = (await as("ceo").get("/performance/approvals")).body.data;
    expect(row).toMatchObject({ kind: "target_change", record_id: id, key_result_code: null, department: "Branding & Marketing", employee: { employee_id: emp("ada") } });
    expect(row.line_title).toEqual(expect.any(String));
    const sheet = await as("ceo").get(`/performance/target-changes/${id}`);
    expect(sheet.body).toMatchObject({ key_result: null, line: { employee_target_id: line.employee_target_id, employee: { employee_id: emp("ada") } } });
    expect((await as("ada").get(`/performance/target-changes/${id}`)).status).toBe(200);
    expect((await as("head").get(`/performance/target-changes/${id}`)).status).toBe(200);
    expect((await as("musa").get(`/performance/target-changes/${id}`)).status).toBe(404);
    // A dotted manager out of scope reads it as they read the scorecard.
    await q("UPDATE scorecard SET dotted_employee_id = $1 WHERE scorecard_id = $2", [emp("musa"), ids.cardA]);
    expect((await as("musa").get(`/performance/target-changes/${id}`)).status).toBe(200);
    await q("UPDATE scorecard SET dotted_employee_id = NULL WHERE scorecard_id = $1", [ids.cardA]);
    // The list keeps a line's change to the reader's scope, as the sheet does.
    const listed = async (who) => (await as(who).get(`/performance/target-changes?employee_target_id=${line.employee_target_id}`)).body.data.length;
    expect([await listed("ada"), await listed("head"), await listed("ceo"), await listed("musa")]).toEqual([1, 1, 1, 0]);
    // The CEO refuses it with a reason; the target stays as it was.
    const instance = res.body.workflow_instance_id;
    expect((await as("ceo").post(`/workflow/instances/${instance}/reject`, { reason: "Keep the quarter's figure" })).status).toBe(200);
    await drain();
    expect((await as("ceo").get(`/performance/target-changes/${id}`)).body.status).toBe("rejected");
    expect((await as("ceo").get("/performance/approvals")).body.data).toEqual([]);
  });

  test("TBC targets lock on the quarter's lock date, once", async () => {
    expect(await goals.lockTargets("2026-10-30")).toEqual({ locked: 0 });
    expect(await goals.lockTargets("2026-11-01")).toEqual({ locked: 1 });
    expect(await goals.lockTargets("2026-11-02")).toEqual({ locked: 0 });
    const kr = await one("SELECT target_provisional, target_locked_at FROM okr_key_result WHERE okr_key_result_id = $1", [ids.kr2]);
    expect(kr.target_provisional).toBe(false);
    expect(kr.target_locked_at).not.toBeNull();
    // October was reported while the target was TBC (8 against 40): it is scored now it is firm.
    const october = await one("SELECT trim_scale(proposed_score)::text AS proposed FROM okr_key_result_month WHERE okr_key_result_id = $1 AND month = '2026-10-01'", [ids.kr2]);
    expect(october.proposed).toBe("0.2");
  });
});
