"use strict";
/**
 * Performance · Goals, Request To Unbind (docs/guides/performance.md §3.2, §5, §6.22): the real
 * migrations, the whole app through HTTP, every response parsed with its contract.
 *
 * The head of a function whose plan is binding asks the CEO to unbind it with a reason; refused, the
 * plan stays binding and the head may ask again; approved, the plan is unbound: live, open for
 * objectives and key results to be added and changed, nothing with a reported month deleted. Send
 * Plan then goes to the CEO alone, the plan revising (locked, still live) while they decide, binding
 * again on their approval and unbound with the reason on Request Changes.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/performance-plan-unbind
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
const PASSWORD = "Perf-Unbind9Test";

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

describeDb("performance plans unbound for changes, against the real migrations", () => {
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
  const bmRow = async (who) =>
    (await as(who).get(`/performance/functions?period_id=${ids.q4}`)).body.data.find((f) => f.department_id === ids.bm);
  const planStatus = async () => (await one("SELECT status FROM performance_plan WHERE performance_plan_id = $1", [ids.plan])).status;
  const waiting = async (who) => (await as(who).get("/performance/approvals")).body.data;

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
    // The build account: the Implementation Team holds every capability, goals.organisation among them, but is not the CEO.
    await make("impl", "Seun", "Phillips", "implementation", "Implementation Partner", "General Management");
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
        .set("X-Forwarded-For", `10.66.0.${ip}`)
        .send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }
    ids.q4 = (
      await as("ops").post("/performance/periods", { starts_on: "2026-10-01", targets_lock_on: "2026-11-07", status: "active" })
    ).body.performance_period_id;
    // Branding & Marketing's plan: one objective, one key result with October reported, binding.
    const objective = await as("head").post("/performance/objectives", { performance_period_id: ids.q4, department_id: ids.bm, title: "Be the first app residents open" });
    ids.objective = objective.body.okr_objective_id;
    const kr = await as("head").post("/performance/key-results", {
      okr_objective_id: ids.objective,
      statement: "Grow app downloads",
      measure: "numeric",
      target_value: "64000",
      unit: "downloads",
      accountable_employee_id: emp("ada"),
    });
    ids.kr = kr.body.okr_key_result_id;
    ids.plan = objective.body.performance_plan_id;
    await q("UPDATE performance_plan SET status = 'binding', binding_at = now() WHERE performance_plan_id = $1", [ids.plan]);
    const reported = await as("head").post("/performance/reports", {
      month: "2026-10-01",
      department_id: ids.bm,
      key_results: [{ okr_key_result_id: ids.kr, status: "on_track", actual_value: "38400" }],
      kpis: [],
    });
    expect(reported.status).toBe(200);
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("Request To Unbind is offered to whoever sets a binding plan, and to nobody else", async () => {
    expect(await bmRow("head")).toMatchObject({ may_set: true, plan_status: "binding", can_request_unbind: true });
    // Another function's head does not set this plan; staff and the CEO (who keeps New Goal) are not offered it.
    expect(await bmRow("other")).toMatchObject({ may_set: false, can_request_unbind: false });
    expect(await bmRow("ada")).toMatchObject({ may_set: false, can_request_unbind: false });
    expect(await bmRow("ceo")).toMatchObject({ may_set: true, can_request_unbind: false });
    // The company's plan has no row of its own yet: Management's would be offered only once it binds.
    const company = (await as("pm").get(`/performance/functions?period_id=${ids.q4}`)).body.data.find((f) => f.department_id === null);
    expect(company).toMatchObject({ may_set: true, plan_status: null, can_request_unbind: false });

    const body = { reason: "A new partner programme needs an objective" };
    expect((await as("ada").post(`/performance/plans/${ids.plan}/unbind`, body)).status).toBe(403);
    expect((await as("other").post(`/performance/plans/${ids.plan}/unbind`, body)).status).toBe(403);
    const blank = await as("head").post(`/performance/plans/${ids.plan}/unbind`, { reason: " " });
    expect(blank.status).toBe(422);
    expect(blank.body.error.fields).toHaveProperty("reason");
  });

  test("the request goes to the CEO alone; refused, the plan stays binding and the head may ask again", async () => {
    const asked = await as("head").post(`/performance/plans/${ids.plan}/unbind`, { reason: "A new partner programme needs an objective" });
    expect(asked.status).toBe(201);
    expect(asked.body).toMatchObject({ status: "pending", reason: "A new partner programme needs an objective", decision_reason: null });
    expect(asked.body.requested_by.display_name).toContain("Tolu");
    ids.unbind = asked.body.plan_unbind_id;
    expect(await planStatus()).toBe("binding");

    // One waits at a time, and the button goes while it does.
    const twice = await as("head").post(`/performance/plans/${ids.plan}/unbind`, { reason: "Again" });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe("UNBIND_PENDING");
    expect(await bmRow("head")).toMatchObject({ plan_status: "binding", can_request_unbind: false });
    expect((await as("head").get(`/performance/plans/${ids.plan}`)).body.unbind).toMatchObject({ plan_unbind_id: ids.unbind, status: "pending" });

    // The CEO has it on Waiting On You; the head and the Program Manager do not.
    const mine = await waiting("ceo");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ kind: "unbind", record_id: ids.unbind, department: "Branding & Marketing", stage_name: "CEO" });
    expect(mine[0].requested_by.display_name).toContain("Tolu");
    expect(await waiting("head")).toEqual([]);
    expect(await waiting("pm")).toEqual([]);
    const sheet = await as("head").get(`/performance/unbinds/${ids.unbind}`);
    expect(sheet.body).toMatchObject({ department: "Branding & Marketing", period_name: "Q4 2026", status: "pending" });

    const instance = (await one("SELECT workflow_instance_id, definition_key, entity_type FROM workflow_instance WHERE entity_id = $1", [ids.unbind]));
    expect(instance).toMatchObject({ definition_key: "performance.plan_change", entity_type: "plan_unbind" });
    expect((await as("head").post(`/workflow/instances/${instance.workflow_instance_id}/approve`)).status).toBe(403);
    expect((await as("ceo").post(`/workflow/instances/${instance.workflow_instance_id}/reject`, { reason: "Not this quarter" })).status).toBe(200);
    await drain();
    expect(await planStatus()).toBe("binding");
    expect((await as("head").get(`/performance/unbinds/${ids.unbind}`)).body).toMatchObject({ status: "rejected", decision_reason: "Not this quarter" });
    expect((await as("head").get(`/performance/plans/${ids.plan}`)).body.unbind).toMatchObject({ status: "rejected", decision_reason: "Not this quarter" });
    const told = await q(
      `SELECT title, body FROM notification WHERE user_id = (SELECT user_id FROM app_user WHERE employee_id = $1) AND title LIKE 'Unbind request%'`,
      [emp("head")],
    );
    expect(told.rows).toEqual([{ title: "Unbind request refused", body: "Not this quarter" }]);

    // Asking again is allowed.
    expect(await bmRow("head")).toMatchObject({ can_request_unbind: true });
    const again = await as("head").post(`/performance/plans/${ids.plan}/unbind`, { reason: "A new partner programme, with a plan" });
    expect(again.status).toBe(201);
    ids.unbind = again.body.plan_unbind_id;
  });

  test("approved, the plan is unbound: live, open for additions and changes, nothing reported is deleted", async () => {
    const instance = await one("SELECT workflow_instance_id FROM workflow_instance WHERE entity_id = $1", [ids.unbind]);
    expect((await as("ceo").post(`/workflow/instances/${instance.workflow_instance_id}/approve`)).status).toBe(200);
    await drain();
    expect(await planStatus()).toBe("unbound");
    expect((await as("head").get(`/performance/unbinds/${ids.unbind}`)).body.status).toBe("approved");
    // No second request while unbound: the button is New Goal again.
    expect(await bmRow("head")).toMatchObject({ plan_status: "unbound", can_request_unbind: false });
    const toldHead = await q(
      `SELECT title FROM notification WHERE user_id = (SELECT user_id FROM app_user WHERE employee_id = $1) AND title = 'Unbind request approved'`,
      [emp("head")],
    );
    expect(toldHead.rows).toHaveLength(1);

    // Live: the month still reports, and the tree is the head's to change.
    const report = await as("head").post("/performance/reports", {
      month: "2026-10-01",
      department_id: ids.bm,
      key_results: [{ okr_key_result_id: ids.kr, status: "on_track", actual_value: "40000" }],
      kpis: [],
    });
    expect(report.status).toBe(200);
    const live = await as("ada").get(`/performance/okrs?period_id=${ids.q4}&department_id=${ids.bm}&status=live`);
    expect(live.body.data.map((o) => [o.code, o.plan_status, o.can_edit])).toEqual([["BM-O1", "unbound", false]]);
    expect((await as("head").get(`/performance/okrs?period_id=${ids.q4}&department_id=${ids.bm}&status=live`)).body.data[0].can_edit).toBe(true);
    expect((await as("ada").get(`/performance/okrs?period_id=${ids.q4}&department_id=${ids.bm}&status=binding`)).body.data).toEqual([]);

    // Add: the next free codes, none already given changes.
    const added = await as("head").post("/performance/objectives", { performance_period_id: ids.q4, department_id: ids.bm, title: "Open every state" });
    expect(added.status).toBe(201);
    expect(added.body.code).toBe("BM-O2");
    ids.added = added.body.okr_objective_id;
    const addedKr = await as("head").post("/performance/key-results", { okr_objective_id: ids.added, statement: "Active partners per state" });
    expect(addedKr.body.code).toBe("BM-KR2.1");
    ids.addedKr = addedKr.body.okr_key_result_id;
    expect((await as("head").get(`/performance/key-results/${ids.kr}`)).body.code).toBe("BM-KR1.1");
    expect((await as("ada").post("/performance/objectives", { performance_period_id: ids.q4, department_id: ids.bm, title: "Nope" })).status).toBe(403);

    // Edit: any field of a key result nothing was reported on; on a reported one, not what it was scored on.
    expect((await as("head").patch(`/performance/key-results/${ids.addedKr}`, { measure: "numeric", target_value: "36", unit: "partners" })).body).toMatchObject({ target_value: "36" });
    expect((await as("head").patch(`/performance/key-results/${ids.kr}`, { statement: "Grow app downloads to 64,000", target_value: "64000" })).body.statement).toBe("Grow app downloads to 64,000");
    const scored = await as("head").patch(`/performance/key-results/${ids.kr}`, { target_value: "70000" });
    expect(scored.status).toBe(409);
    expect(scored.body.error).toMatchObject({ code: "KEY_RESULT_REPORTED", fields: { target_value: ["Use Change Target"] } });
    expect((await as("head").patch(`/performance/objectives/${ids.objective}`, { title: "Be the first app residents open, every day" })).status).toBe(200);
    // A reported key result's target changes through Change Target, which keeps the original beside it.
    const detail = (await as("head").get(`/performance/key-results/${ids.kr}`)).body;
    expect(detail).toMatchObject({ plan_status: "unbound", can_edit: true, can_change_target: true });
    const change = await as("head").post("/performance/target-changes", { okr_key_result_id: ids.kr, to_value: "70000", from_month: "2026-11-01", reason: "Wider launch" });
    expect(change.status).toBe(201);

    // Delete: what nothing was reported on, and nothing else.
    const heldKr = await as("head").del(`/performance/key-results/${ids.kr}`);
    expect(heldKr.status).toBe(409);
    expect(heldKr.body.error.code).toBe("KEY_RESULT_REPORTED");
    const heldObjective = await as("head").del(`/performance/objectives/${ids.objective}`);
    expect(heldObjective.status).toBe(409);
    expect(heldObjective.body.error.code).toBe("KEY_RESULT_REPORTED");
    const spare = await as("head").post("/performance/objectives", { performance_period_id: ids.q4, department_id: ids.bm, title: "Spare" });
    expect((await as("head").del(`/performance/objectives/${spare.body.okr_objective_id}`)).status).toBe(204);
    // A key result a company key result is Scored From stays too, until it is pointed elsewhere.
    const company = await as("pm").post("/performance/objectives", { performance_period_id: ids.q4, title: "Company objective" });
    const companyKr = await as("pm").post("/performance/key-results", { okr_objective_id: company.body.okr_objective_id, statement: "Company result" });
    const feeder = await as("head").post("/performance/key-results", { okr_objective_id: ids.added, statement: "Feeder" });
    const feederId = feeder.body.okr_key_result_id;
    const scoredFrom = (id) => as("pm").patch(`/performance/key-results/${companyKr.body.okr_key_result_id}`, { scored_from_key_result_id: id });
    expect((await scoredFrom(feederId)).status).toBe(200);
    const relied = await as("head").del(`/performance/key-results/${feederId}`);
    expect(relied.status).toBe(409);
    expect(relied.body.error.code).toBe("KEY_RESULT_IN_USE");
    expect((await scoredFrom(null)).status).toBe(200);
    expect((await as("head").del(`/performance/key-results/${feederId}`)).status).toBe(204);
  });

  test("Send Plan goes to the CEO alone; revising is locked and live; Request Changes returns it unbound; approval binds it", async () => {
    const bindingAt = (await one("SELECT binding_at FROM performance_plan WHERE performance_plan_id = $1", [ids.plan])).binding_at;
    const detail = await as("head").get(`/performance/plans/${ids.plan}`);
    expect(detail.body).toMatchObject({ status: "unbound", can_submit: true });
    expect((await as("ada").post(`/performance/plans/${ids.plan}/submit`)).status).toBe(403);
    const sent = await as("head").post(`/performance/plans/${ids.plan}/submit`);
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe("revising");
    const instance = await one(
      "SELECT workflow_instance_id, definition_key, current_stage, entity_type FROM workflow_instance WHERE entity_id = $1 AND state = 'pending'",
      [ids.plan],
    );
    expect(instance).toMatchObject({ definition_key: "performance.plan_change", current_stage: "ceo", entity_type: "performance_plan" });
    expect((await as("head").post(`/performance/plans/${ids.plan}/submit`)).status).toBe(409);

    // Awaiting the CEO: Send Plan is gone, but the plan stays the head's to change, what is added joining the
    // plan sent with the request still the CEO's alone (§6.4, §6.22). Still live: the month reports.
    expect((await as("head").get(`/performance/plans/${ids.plan}`)).body.can_submit).toBe(false);
    const more = await as("head").post("/performance/objectives", { performance_period_id: ids.q4, department_id: ids.bm, title: "More" });
    expect(more.status).toBe(201);
    expect(more.body).toMatchObject({ plan_status: "revising", can_edit: true });
    expect((await as("head").patch(`/performance/objectives/${ids.added}`, { title: "Changed" })).status).toBe(200);
    expect((await as("head").patch(`/performance/objectives/${ids.added}`, { title: "Open every state" })).status).toBe(200);
    expect((await one("SELECT workflow_instance_id FROM workflow_instance WHERE entity_id = $1 AND state = 'pending'", [ids.plan])).workflow_instance_id).toBe(instance.workflow_instance_id);
    // What a reported month sits on is kept while the changes wait, as when unbound.
    expect((await as("head").del(`/performance/objectives/${ids.objective}`)).status).toBe(409);
    expect((await as("head").patch(`/performance/key-results/${ids.kr}`, { target_value: "70000" })).body.error.code).toBe("KEY_RESULT_REPORTED");
    expect((await as("head").del(`/performance/objectives/${more.body.okr_objective_id}`)).status).toBe(204);
    const report = await as("head").post("/performance/reports", {
      month: "2026-10-01",
      department_id: ids.bm,
      key_results: [{ okr_key_result_id: ids.kr, status: "on_track", actual_value: "41000" }],
      kpis: [],
    });
    expect(report.status).toBe(200);

    // The CEO has the plan, as any plan stage; Request Changes returns it unbound with the reason.
    // (The target change asked for while unbound is still on their list too.)
    const mine = (await waiting("ceo")).filter((r) => r.kind === "plan");
    expect(mine.map((r) => [r.kind, r.record_id, r.department])).toEqual([["plan", ids.plan, "Branding & Marketing"]]);
    expect((await as("ceo").post(`/workflow/instances/${instance.workflow_instance_id}/reject`, { reason: "Cut BM-KR2.1's target" })).status).toBe(200);
    await drain();
    expect(await planStatus()).toBe("unbound");
    expect((await as("head").get(`/performance/plans/${ids.plan}`)).body).toMatchObject({ status: "unbound", returned_reason: "Cut BM-KR2.1's target", can_submit: true });
    expect((await as("head").patch(`/performance/key-results/${ids.addedKr}`, { target_value: "30" })).status).toBe(200);

    // Sent again and approved, the plan is binding, its first approval date untouched.
    expect((await as("head").post(`/performance/plans/${ids.plan}/submit`)).body.status).toBe("revising");
    const again = await one("SELECT workflow_instance_id FROM workflow_instance WHERE entity_id = $1 AND state = 'pending'", [ids.plan]);
    expect((await as("head").post(`/workflow/instances/${again.workflow_instance_id}/approve`)).status).toBe(403);
    expect((await as("ceo").post(`/workflow/instances/${again.workflow_instance_id}/approve`)).status).toBe(200);
    await drain();
    const after = await one("SELECT status, binding_at, returned_reason FROM performance_plan WHERE performance_plan_id = $1", [ids.plan]);
    expect(after).toMatchObject({ status: "binding", returned_reason: null });
    expect(after.binding_at).toEqual(bindingAt);
    expect(await bmRow("head")).toMatchObject({ plan_status: "binding", can_request_unbind: true });
    expect((await as("head").patch(`/performance/objectives/${ids.added}`, { title: "Changed" })).body.error.code).toBe("PLAN_BINDING");
    const toldBinding = await q(
      `SELECT title FROM notification WHERE user_id = (SELECT user_id FROM app_user WHERE employee_id = $1) AND title LIKE '% plan is binding'`,
      [emp("head")],
    );
    expect(toldBinding.rows).toHaveLength(1);
  });

  test("approved for a plan that is no longer binding, the request closes refused and says so", async () => {
    const asked = await as("head").post(`/performance/plans/${ids.plan}/unbind`, { reason: "Add a programme" });
    expect(asked.status).toBe(201);
    await q("UPDATE performance_plan SET status = 'draft' WHERE performance_plan_id = $1", [ids.plan]);
    const instance = await one("SELECT workflow_instance_id FROM workflow_instance WHERE entity_id = $1", [asked.body.plan_unbind_id]);
    expect((await as("ceo").post(`/workflow/instances/${instance.workflow_instance_id}/approve`)).status).toBe(200);
    await drain();
    expect((await as("head").get(`/performance/unbinds/${asked.body.plan_unbind_id}`)).body).toMatchObject({
      status: "rejected",
      decision_reason: "The plan is no longer binding",
    });
    expect(await planStatus()).toBe("draft");
    await q("UPDATE performance_plan SET status = 'binding' WHERE performance_plan_id = $1", [ids.plan]);
  });

  test("a plan awaiting approval takes objectives and key results into the plan sent, and its approval carries on (JBS Praxis, 27/10/2026)", async () => {
    // Technology & Back-office Ops: one objective, sent, then added to and changed while its approvers hold it.
    const first = await as("other").post("/performance/objectives", { performance_period_id: ids.q4, department_id: ids.tbo, title: "Keep every service up" });
    expect(first.status).toBe(201);
    const planId = first.body.performance_plan_id;
    expect((await as("other").post(`/performance/plans/${planId}/submit`)).body.status).toBe("submitted");
    const instance = await one("SELECT workflow_instance_id FROM workflow_instance WHERE entity_id = $1 AND state = 'pending'", [planId]);
    const tboRow = async (who) => (await as(who).get(`/performance/functions?period_id=${ids.q4}`)).body.data.find((f) => f.department_id === ids.tbo);
    // Sent: not sent twice and not unbound, yet the head's to change.
    expect(await tboRow("other")).toMatchObject({ plan_status: "submitted", can_request_unbind: false });
    expect((await as("other").get(`/performance/plans/${planId}`)).body).toMatchObject({ status: "submitted", can_submit: false });
    expect((await as("other").post(`/performance/plans/${planId}/submit`)).status).toBe(409);

    const added = await as("other").post("/performance/objectives", { performance_period_id: ids.q4, department_id: ids.tbo, title: "Ship the release calendar" });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ code: "TBO-O2", plan_status: "submitted", can_edit: true });
    const result = await as("other").post("/performance/key-results", { okr_objective_id: added.body.okr_objective_id, statement: "A release every fortnight" });
    expect(result.status).toBe(201);
    expect(result.body.code).toBe("TBO-KR2.1");
    expect((await as("other").patch(`/performance/objectives/${first.body.okr_objective_id}`, { title: "Keep every service up, always" })).status).toBe(200);
    expect((await as("other").patch(`/performance/key-results/${result.body.okr_key_result_id}`, { statement: "A release every two weeks" })).status).toBe(200);
    // Not for anyone who does not set this function's goals.
    expect((await as("head").post("/performance/objectives", { performance_period_id: ids.q4, department_id: ids.tbo, title: "Nope" })).status).toBe(403);
    expect((await as("ada").patch(`/performance/objectives/${added.body.okr_objective_id}`, { title: "Nope" })).status).toBe(403);

    // The plan it joined is the one sent: the same request, still pending, and the approvers read it as it now stands.
    expect((await one("SELECT workflow_instance_id FROM workflow_instance WHERE entity_id = $1 AND state = 'pending'", [planId])).workflow_instance_id).toBe(instance.workflow_instance_id);
    const read = (await as("ops").get(`/performance/plans/${planId}`)).body;
    expect(read).toMatchObject({ status: "submitted", objective_count: 2 });
    expect(read.objectives.map((o) => [o.code, o.title, o.key_results.length])).toEqual([["TBO-O1", "Keep every service up, always", 0], ["TBO-O2", "Ship the release calendar", 1]]);
    expect((await as("other").get(`/performance/okrs?period_id=${ids.q4}&department_id=${ids.tbo}&status=editable`)).body.data).toHaveLength(2);

    // It was sent holding something to approve, and keeps it.
    expect((await as("other").del(`/performance/objectives/${added.body.okr_objective_id}`)).status).toBe(204);
    const last = await as("other").del(`/performance/objectives/${first.body.okr_objective_id}`);
    expect(last.status).toBe(409);
    expect(last.body.error.code).toBe("PLAN_EMPTY");
    expect((await as("other").post("/performance/objectives", { performance_period_id: ids.q4, department_id: ids.tbo, title: "Ship the release calendar" })).body.code).toBe("TBO-O2");

    // Approved, it binds with what was added, and is then shut as any binding plan.
    const approve = (who) => as(who).post(`/workflow/instances/${instance.workflow_instance_id}/approve`);
    expect((await approve("ops")).status).toBe(200);
    expect((await approve("ceo")).status).toBe(200);
    await drain();
    expect((await one("SELECT status FROM performance_plan WHERE performance_plan_id = $1", [planId])).status).toBe("binding");
    expect((await as("other").get(`/performance/okrs?period_id=${ids.q4}&department_id=${ids.tbo}&status=binding`)).body.data.map((o) => o.code)).toEqual(["TBO-O1", "TBO-O2"]);
    const shut = await as("other").post("/performance/objectives", { performance_period_id: ids.q4, department_id: ids.tbo, title: "Too late" });
    expect(shut.status).toBe(409);
    expect(shut.body.error).toMatchObject({ code: "PLAN_BINDING", fields: { department_id: ["Plan is binding"] } });
    expect(await tboRow("other")).toMatchObject({ plan_status: "binding", can_request_unbind: true });
    ids.tboPlan = planId;
  });

  test("only the CEO is left out of Request To Unbind: the build account, which holds goals.organisation too, asks and the CEO decides (JBS Praxis, 27/10/2026)", async () => {
    const row = async (who) => (await as(who).get(`/performance/functions?period_id=${ids.q4}`)).body.data.find((f) => f.department_id === ids.tbo);
    // It holds the capability the CEO's exclusion used to key on, and sets every function: offered it all the same.
    expect(await row("impl")).toMatchObject({ may_set: true, plan_status: "binding", can_request_unbind: true });
    expect(await row("ceo")).toMatchObject({ may_set: true, plan_status: "binding", can_request_unbind: false });

    const asked = await as("impl").post(`/performance/plans/${ids.tboPlan}/unbind`, { reason: "Add a platform objective" });
    expect(asked.status).toBe(201);
    expect(await row("impl")).toMatchObject({ can_request_unbind: false });
    const mine = (await waiting("ceo")).filter((r) => r.kind === "unbind");
    expect(mine.map((r) => [r.record_id, r.department])).toEqual([[asked.body.plan_unbind_id, "Technology & Back-office Ops"]]);
    expect(mine[0].requested_by.display_name).toContain("Seun");
    const instance = await one("SELECT workflow_instance_id FROM workflow_instance WHERE entity_id = $1", [asked.body.plan_unbind_id]);
    expect((await as("impl").post(`/workflow/instances/${instance.workflow_instance_id}/approve`)).status).toBe(403);
    expect((await as("ceo").post(`/workflow/instances/${instance.workflow_instance_id}/approve`)).status).toBe(200);
    await drain();
    expect((await one("SELECT status FROM performance_plan WHERE performance_plan_id = $1", [ids.tboPlan])).status).toBe("unbound");
  });

  test("a closed quarter, or a plan that is not binding, takes no request", async () => {
    await q("UPDATE performance_plan SET status = 'draft' WHERE performance_plan_id = $1", [ids.plan]);
    const draft = await as("head").post(`/performance/plans/${ids.plan}/unbind`, { reason: "Not binding yet" });
    expect(draft.status).toBe(409);
    expect(draft.body.error.code).toBe("PLAN_NOT_BINDING");
    await q("UPDATE performance_plan SET status = 'binding' WHERE performance_plan_id = $1", [ids.plan]);
    await q("UPDATE performance_period SET status = 'closed' WHERE performance_period_id = $1", [ids.q4]);
    const closed = await as("head").post(`/performance/plans/${ids.plan}/unbind`, { reason: "Too late" });
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe("PERIOD_CLOSED");
  });
});
