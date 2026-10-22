"use strict";
/**
 * Performance PR 3 end to end (docs/guides/performance.md §3.3, §6.9 to §6.17): the real migrations,
 * the whole app through HTTP, every response parsed with its contract (APP_ENV=test).
 *
 * A quarter that has ended (Q3 2026) is planned and bound, so its September round can be opened by
 * hand. The employee checks in first and the reviewer is refused until then (A17); the system
 * proposes each score and fills the automatic lines; the reviewer scores, needs a reason to differ
 * and a corrective action on each missed line, which becomes a task; the second level and then
 * Operations & People approve through the engine and the review closes with its score, rating and
 * PDF; a refusal returns it to the reviewer; a conduct breach caps the rating; a Below rating
 * starts a PIP; a probation review closes with its outcome; Tidy answers on the stub; a scorecard
 * drafted after its plan bound is sent on its own and binds; the job opens the rounds still due.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/performance-reviews
 */
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const workflow = require("../../src/shared/workflow/engine");
const homeReviews = require("../../src/modules/dashboard/sources/reviews.source");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const PASSWORD = "Perf-Reviews9Test";

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

describeDb("performance reviews against the real migrations", () => {
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
  });
  const emp = (who) => people[who].employee.employee_id;
  const actor = (who) => ({
    user_id: people[who].user.user_id,
    employee_id: emp(who),
    role_ids: [people[who].role.role_id],
    is_ceo: who === "ceo",
  });
  const act = (instanceId, who, decision, reason) =>
    tx((c) => workflow.act(c, { instance_id: instanceId, actor: actor(who), decision, reason }));
  const pending = (entityId) => one("SELECT workflow_instance_id, current_stage FROM workflow_instance WHERE entity_id = $1 AND state = 'pending'", [entityId]);
  const reviewOf = (who) => one("SELECT performance_review_id FROM performance_review WHERE employee_id = $1 AND performance_cycle_id = $2", [emp(who), ids.round]);

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
    await make("dot", "Chi", "Okafor", "head_of_department", "Head, Partnerships", "Partnership & Growth");
    await make("newbie", "Bayo", "Lawal", "employee", "Graphics Associate", "Branding & Marketing");
    await make("late", "Efe", "Odia", "employee", "Content Associate", "Branding & Marketing");
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = ANY($2::uuid[])", [emp("head"), [emp("ada"), emp("musa"), emp("newbie"), emp("late")]]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = ANY($2::uuid[])", [emp("pm"), [emp("head"), emp("ops"), emp("dot")]]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [emp("ceo"), emp("pm")]);
    await q("UPDATE employee SET dotted_manager_id = $1 WHERE employee_id = $2", [emp("dot"), emp("ada")]);
    await q("UPDATE employee SET confirmation_due_on = '2026-11-01' WHERE employee_id = $1", [emp("newbie")]);
    ids.bm = (await one("SELECT department_id FROM department WHERE name = 'Branding & Marketing'")).department_id;
    await q("UPDATE department SET code = 'BM', head_employee_id = $2 WHERE department_id = $1", [ids.bm, emp("head")]);
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

    // Q3 2026: planned, bound and agreed, as PR 2 leaves a quarter.
    const period = await as("ops").post("/performance/periods", { starts_on: "2026-07-01", targets_lock_on: "2026-07-31" });
    expect(period.status).toBe(201);
    ids.period = period.body.performance_period_id;
    expect((await as("ops").patch(`/performance/periods/${ids.period}`, { status: "active" })).status).toBe(200);
    const o = await as("head").post("/performance/objectives", { performance_period_id: ids.period, department_id: ids.bm, title: "Be the app residents open first" });
    expect(o.status).toBe(201);
    const kr = await as("head").post("/performance/key-results", { okr_objective_id: o.body.okr_objective_id, statement: "Publish 36 city stories", target_value: "36", accountable_employee_id: emp("head") });
    expect(kr.status).toBe(201);
    const kpi = await as("head").post("/performance/kpis", { department_id: ids.bm, name: "Assets on time", unit: "%", target_value: "95" });
    expect(kpi.status).toBe(201);
    ids.kpi = kpi.body.kpi_definition_id;
    for (const who of ["ada", "musa"]) {
      const card = await as("head").post("/performance/scorecards", { employee_id: emp(who), performance_period_id: ids.period });
      expect(card.status).toBe(201);
      ids[`card_${who}`] = card.body.scorecard_id;
      const accountability = card.body.lines.map((l) =>
        Object.fromEntries(
          Object.entries({ ...l, employee_target_id: undefined, key_result: undefined, kpi: undefined, team_key_results: undefined, months: undefined, score: undefined, scorecard_id: undefined, position: undefined, team_key_result_ids: [] })
            .filter(([, v]) => v !== undefined && v !== null),
        ),
      );
      const saved = await as("head").put(`/performance/scorecards/${card.body.scorecard_id}/lines`, {
        lines: [
          { section: "results", title: "Stories published", measure: "numeric", source: "own", target_value: "10", weight: "60" },
          { section: "kpis", title: "Assets on time", measure: "standard", source: "function_kpi", kpi_definition_id: ids.kpi, target_value: "95", unit: "%", weight: "25" },
          ...accountability,
        ],
      });
      expect(saved.status).toBe(200);
    }
    const plan = (await as("head").get(`/performance/plans?period_id=${ids.period}&department_id=${ids.bm}`)).body.data[0];
    ids.plan = plan.performance_plan_id;
    expect((await as("head").post(`/performance/plans/${ids.plan}/submit`)).status).toBe(200);
    const instance = await pending(ids.plan);
    await act(instance.workflow_instance_id, "pm", "approve");
    await act(instance.workflow_instance_id, "ops", "approve");
    await act(instance.workflow_instance_id, "ceo", "approve");
    await drain();
    expect((await as("ada").get(`/performance/scorecards/${ids.card_ada}`)).body.status).toBe("binding");
    // As if it bound before the quarter began: a round reviews the scorecards bound by its month's end.
    await q("UPDATE performance_plan SET binding_at = '2026-06-30T12:00:00Z' WHERE performance_plan_id = $1", [ids.plan]);
    // September's KPI result, which the KPI line reads.
    expect((await as("head").post(`/performance/kpis/${ids.kpi}/actuals`, { month: "2026-09-01", result: "met", actual_value: "96" })).status).toBe(200);
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("Operations & People open September's round by hand: one review per binding scorecard, its deadlines in business days", async () => {
    expect((await as("head").post("/performance/rounds", { performance_period_id: ids.period, month: "2026-09-01" })).status).toBe(403);
    const r = await as("ops").post("/performance/rounds", { performance_period_id: ids.period, month: "2026-09-01" });
    expect(r.status).toBe(201);
    ids.round = r.body.performance_cycle_id;
    // 1 October is a public holiday: the 1st business day is the 2nd, the 2nd the 5th.
    expect(r.body).toMatchObject({ name: "September 2026", status: "open", check_in_due_on: "2026-10-05", head_check_in_due_on: "2026-10-06" });
    expect((await as("ops").post("/performance/rounds", { performance_period_id: ids.period, month: "2026-09-01" })).body.error.code).toBe("ROUND_EXISTS");
    const list = await as("ops").get(`/performance/rounds?period_id=${ids.period}`);
    expect(list.body.data[0].counts).toMatchObject({ total: 2, check_in: 2 });
    await drain();
    const notice = await one(
      "SELECT title FROM notification n JOIN app_user u ON u.user_id = n.user_id WHERE u.employee_id = $1 ORDER BY n.created_at DESC LIMIT 1",
      [emp("ada")],
    );
    expect(notice.title).toBe("Your September 2026 check-in is open");
    const reminders = await q("SELECT occurrence FROM reminder WHERE reminder_key = 'check_in_due' AND entity_id = $1 ORDER BY occurrence", [(await reviewOf("ada")).performance_review_id]);
    // The round's dates have passed in this test's clock, so nothing is scheduled behind them.
    expect(reminders.rows).toEqual([]);
  });

  test("self first: the reviewer is refused until the check-in is in (A17)", async () => {
    ids.reviewAda = (await reviewOf("ada")).performance_review_id;
    const refused = await as("head").get(`/performance/reviews/${ids.reviewAda}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("CHECK_IN_FIRST");
    expect((await as("head").put(`/performance/reviews/${ids.reviewAda}/scores`, { items: [], actions: [] })).body.error.code).toBe("CHECK_IN_FIRST");
    // Someone the review does not name and their scope does not reach: not found.
    expect((await as("musa").get(`/performance/reviews/${ids.reviewAda}`)).status).toBe(404);
    const mine = await as("ada").get("/ess/performance");
    expect(mine.body).toMatchObject({ scorecard: expect.objectContaining({ status: "binding" }), check_in: { status: "check_in" } });
  });

  test("the check-in: proposed scores, automatic lines, a changed score needs a reason, no evidence is Not Assessable", async () => {
    const open = await as("ada").get("/ess/performance/check-in");
    expect(open.status).toBe(200);
    const [results, kpi, commitments, update] = open.body.items;
    expect(results.line).toMatchObject({ section: "results", source: "own" });
    expect(results).toMatchObject({ assessable: false, proposed_score: null, auto: false });
    expect(kpi).toMatchObject({ auto: true, proposed_score: "1", actual_value: "96" });
    expect(commitments).toMatchObject({ auto: true, proposed_score: null });
    expect(update.line.source).toBe("update_on_time");
    ids.items = { results: results.performance_review_item_id, kpi: kpi.performance_review_item_id, update: update.performance_review_item_id };

    const noReason = await as("ada").put("/ess/performance/check-in", {
      items: [{ performance_review_item_id: ids.items.results, actual_value: "8", evidence_kind: "note", evidence_note: "Stories log", self_score: "0.9" }],
    });
    expect(noReason.status).toBe(422);
    expect(Object.keys(noReason.body.error.fields)).toContain("items.0.self_reason");
    const saved = await as("ada").put("/ess/performance/check-in", {
      items: [
        {
          performance_review_item_id: ids.items.results,
          actual_value: "8",
          evidence_kind: "note",
          evidence_note: "Stories log",
          action_text: "Two stories slipped to October",
          self_score: "0.9",
          self_reason: "Two more are with the editor",
        },
      ],
    });
    expect(saved.status).toBe(200);
    expect(saved.body.items[0]).toMatchObject({ assessable: true, proposed_score: "0.8", self_score: "0.9" });

    // Musa enters a figure with no evidence: Not Assessable, no proposed score.
    const musa = await as("musa").get("/ess/performance/check-in");
    const m = await as("musa").put("/ess/performance/check-in", { items: [{ performance_review_item_id: musa.body.items[0].performance_review_item_id, actual_value: "3" }] });
    expect(m.body.items[0]).toMatchObject({ assessable: false, proposed_score: null });

    // Tidy runs on the stub only when pressed, for the writer of the text; a week is Workspace's.
    const tidy = await as("ada").post("/performance/tidy", { kind: "check_in", performance_review_item_id: ids.items.results, text: "um so two stories slipped" });
    expect(tidy.status).toBe(200);
    expect(tidy.body).toMatchObject({ available: true, original: "um so two stories slipped" });
    expect((await as("musa").post("/performance/tidy", { kind: "check_in", performance_review_item_id: ids.items.results, text: "x" })).status).toBe(404);
    expect((await as("ada").post("/performance/tidy", { kind: "week", text: "x" })).status).toBe(422);
  });

  test("Submit Check-In: with the reviewer, the dotted manager asked, Monthly Update On Time scored late", async () => {
    const sent = await as("ada").post("/ess/performance/check-in/submit");
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe("with_reviewer");
    expect((await as("ada").post("/ess/performance/check-in/submit")).status).toBe(409);
    await drain();
    const asked = await one(
      "SELECT title FROM notification n JOIN app_user u ON u.user_id = n.user_id WHERE u.employee_id = $1 ORDER BY n.created_at DESC LIMIT 1",
      [emp("dot")],
    );
    expect(asked.title).toBe("Input asked: Ada Nwosu");

    const review = await as("head").get(`/performance/reviews/${ids.reviewAda}`);
    expect(review.status).toBe(200);
    expect(review.body.can).toMatchObject({ score: true, submit: true, return_check_in: true, ask_input: true, give_input: false });
    expect(review.body.items[0]).toMatchObject({ actual_value: "8", evidence_note: "Stories log", self_reason: "Two more are with the editor" });
    // Submitted long after its 5 October deadline in this test's clock: late, 0.
    expect(review.body.items.find((i) => i.performance_review_item_id === ids.items.update).proposed_score).toBe("0");
    expect(review.body.context).toMatchObject({ recognitions: 0 });
    expect(review.body.chain.map((s) => [s.key, s.state])).toEqual([["check_in", "done"], ["reviewer", "current"], ["second_level", "waiting"], ["hr", "waiting"]]);

    // The dotted manager reads the check-in, never the reviewer's scores, and gives input.
    const dotted = await as("dot").get(`/performance/reviews/${ids.reviewAda}`);
    expect(dotted.body.can.give_input).toBe(true);
    expect(dotted.body.items[0].self_reason).toBe("Two more are with the editor");
    expect((await as("dot").post(`/performance/reviews/${ids.reviewAda}/input`, { dotted_input: "Strong on the Lagos launch" })).status).toBe(200);
  });

  test("the reviewer: a reason to differ, a corrective action on each missed line (a task), Submit Review opens the chain", async () => {
    const items = (await as("head").get(`/performance/reviews/${ids.reviewAda}`)).body.items;
    const scores = items.map((i) => ({ performance_review_item_id: i.performance_review_item_id, score: i.proposed_score }));
    const differ = await as("head").put(`/performance/reviews/${ids.reviewAda}/scores`, {
      items: scores.map((s) => (s.performance_review_item_id === ids.items.kpi ? { ...s, score: "0.5" } : s)),
      actions: [],
    });
    expect(differ.status).toBe(422);
    const saved = await as("head").put(`/performance/reviews/${ids.reviewAda}/scores`, { items: scores, actions: [] });
    expect(saved.status).toBe(200);
    // September is the quarter's last month: the Results line under target and the late update are missed.
    const missing = await as("head").post(`/performance/reviews/${ids.reviewAda}/submit`);
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe("CORRECTIVE_ACTION_REQUIRED");
    const actions = [
      { performance_review_item_id: ids.items.results, title: "Publish the two slipped stories", owner_employee_id: emp("ada"), due_on: "2026-10-30" },
      { performance_review_item_id: ids.items.update, title: "Send the October update on time", owner_employee_id: emp("ada"), due_on: "2026-11-04" },
    ];
    expect((await as("head").put(`/performance/reviews/${ids.reviewAda}/scores`, { items: scores, actions })).status).toBe(200);
    const sent = await as("head").post(`/performance/reviews/${ids.reviewAda}/submit`);
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ status: "second_level", second_level: expect.objectContaining({ employee_id: emp("pm") }) });
    expect(sent.body.actions.map((a) => a.task_number).every(Boolean)).toBe(true);
    const tasks = await q("SELECT title, primary_assignee_id FROM task WHERE entity_type = 'performance_review' AND entity_id = $1 ORDER BY title", [ids.reviewAda]);
    expect(tasks.rows).toEqual([
      { title: "Publish the two slipped stories", primary_assignee_id: emp("ada") },
      { title: "Send the October update on time", primary_assignee_id: emp("ada") },
    ]);
    expect((await as("head").post(`/performance/reviews/${ids.reviewAda}/submit`)).status).toBe(409);
    // The employee sees none of the reviewer's scores before it closes.
    const mine = await as("ada").get(`/performance/reviews/${ids.reviewAda}`);
    expect(mine.body.items.map((i) => i.score)).toEqual([null, null, null, null]);
    expect(mine.body.actions).toEqual([]);
    expect(mine.body.dotted_input).toBeNull();
  });

  test("second level, then Operations & People close it: score, rating, scorecard, PDF, the employee told", async () => {
    const instance = await pending(ids.reviewAda);
    expect(instance.current_stage).toBe("second_level");
    // The reviewee decides no stage of their own review.
    await expect(act(instance.workflow_instance_id, "ada", "approve")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await act(instance.workflow_instance_id, "pm", "approve");
    await drain();
    let review = (await as("ops").get(`/performance/reviews/${ids.reviewAda}`)).body;
    expect(review.status).toBe("with_hr");
    expect(review.can.decide).toBe(true);
    await act(instance.workflow_instance_id, "ops", "approve");
    await drain();
    review = (await as("ada").get(`/performance/reviews/${ids.reviewAda}`)).body;
    // (60 × 0.8 + 25 × 1 + 7.5 × 0) ÷ 92.5: the blank commitments line leaves the denominator.
    expect(review).toMatchObject({ status: "closed", score_month: "0.7892", score_to_date: "0.7892", rating: "meets" });
    expect(review.document_id).toBeTruthy();
    expect(review.items.map((i) => i.score)).toEqual(["0.8", "1", null, "0"]);
    expect(review.dotted_input).toBe("Strong on the Lagos launch");
    const card = (await as("ada").get(`/performance/scorecards/${ids.card_ada}`)).body;
    expect(card).toMatchObject({ score_to_date: "0.7892", rating: "meets" });
    expect(card.lines[0].months).toEqual([{ month: "2026-09-01", score: "0.8" }]);
    const doc = await one("SELECT doc_type, render_status, subject_employee_id FROM document WHERE document_id = $1", [review.document_id]);
    expect(doc).toMatchObject({ doc_type: "review_summary", subject_employee_id: emp("ada") });
    const told = await one(
      "SELECT title FROM notification n JOIN app_user u ON u.user_id = n.user_id WHERE u.employee_id = $1 ORDER BY n.created_at DESC LIMIT 1",
      [emp("ada")],
    );
    expect(told.title).toBe("Your September 2026 review is closed");
    const mine = await as("ada").get("/ess/performance/reviews");
    expect(mine.body.data[0]).toMatchObject({ status: "closed", rating: "meets", document_id: review.document_id });
  });

  test("a returned check-in, a refusal back to the reviewer, a conduct breach capping the rating, a PIP from Below", async () => {
    const id = (await reviewOf("musa")).performance_review_id;
    const musaItems = (await as("musa").get("/ess/performance/check-in")).body.items;
    await as("musa").put("/ess/performance/check-in", {
      items: [{ performance_review_item_id: musaItems[0].performance_review_item_id, actual_value: "2", evidence_kind: "link", evidence_url: "https://mycityapp.io/stories" }],
    });
    expect((await as("musa").post("/ess/performance/check-in/submit")).status).toBe(200);
    const back = await as("head").post(`/performance/reviews/${id}/return`, { returned_reason: "Add the September figure" });
    expect(back.body.status).toBe("check_in");
    expect((await as("musa").get("/ess/performance/check-in")).body).toMatchObject({ status: "check_in", returned_reason: "Add the September figure" });
    expect((await as("musa").post("/ess/performance/check-in/submit")).status).toBe(200);

    const items = (await as("head").get(`/performance/reviews/${id}`)).body.items;
    const scores = items.map((i) => ({ performance_review_item_id: i.performance_review_item_id, score: i.proposed_score }));
    const actions = items
      .filter((i) => i.proposed_score !== null && Number(i.proposed_score) < 1)
      .map((i) => ({ performance_review_item_id: i.performance_review_item_id, title: "Catch up", owner_employee_id: emp("musa"), due_on: "2026-10-30" }));
    expect((await as("head").put(`/performance/reviews/${id}/scores`, { items: scores, actions })).status).toBe(200);
    expect((await as("head").post(`/performance/reviews/${id}/submit`)).status).toBe(200);
    const first = await pending(id);
    await act(first.workflow_instance_id, "pm", "reject", "Score the KPI line again");
    await drain();
    expect((await as("head").get(`/performance/reviews/${id}`)).body).toMatchObject({ status: "returned", returned_reason: "Score the KPI line again" });
    expect((await as("head").post(`/performance/reviews/${id}/submit`)).status).toBe(200);
    const second = await pending(id);
    await act(second.workflow_instance_id, "pm", "approve");
    await drain();
    expect((await as("ops").post(`/performance/reviews/${id}/conduct`, { conduct_breach: true, conduct_note: "Upheld caution, 12 September" })).status).toBe(200);
    expect((await as("head").post(`/performance/reviews/${id}/conduct`, { conduct_breach: false, conduct_note: "x" })).status).toBe(403);
    await act(second.workflow_instance_id, "ops", "approve");
    await drain();
    const closed = (await as("ops").get(`/performance/reviews/${id}`)).body;
    // (60 × 0.2 + 25 × 1 + 7.5 × 0) ÷ 92.5 = 0.4: Below, which no cap lifts.
    expect(closed).toMatchObject({ status: "closed", rating: "below", conduct_breach: true });
    expect(closed.can.start_pip).toBe(true);

    const pip = await as("ops").post("/performance/pips", {
      performance_review_id: id,
      starts_on: "2026-10-26",
      summary: "Stories and assets on time",
      lines: [{ text: "Publish four stories a month", target_text: "4 a month" }],
    });
    expect(pip.status).toBe(201);
    expect(pip.body).toMatchObject({ status: "open", ends_on: "2026-11-25", review_on: "2026-11-25" });
    expect((await as("ops").post("/performance/pips", { performance_review_id: id, starts_on: "2026-10-26", lines: [{ text: "x" }] })).body.error.code).toBe("PIP_EXISTS");
    const tasks = await q("SELECT title FROM task WHERE entity_type = 'improvement_plan' AND entity_id = $1", [pip.body.improvement_plan_id]);
    expect(tasks.rows).toEqual([{ title: "Improve: Publish four stories a month" }]);
    expect((await q("SELECT 1 FROM reminder WHERE reminder_key = 'pip_review_due' AND entity_id = $1", [pip.body.improvement_plan_id])).rowCount).toBe(1);
    expect((await as("musa").get("/ess/performance")).body.open_pip).toMatchObject({ improvement_plan_id: pip.body.improvement_plan_id });
    const done = await as("ops").post(`/performance/pips/${pip.body.improvement_plan_id}/close`, { status: "passed", outcome_note: "Four stories in November" });
    expect(done.body.status).toBe("passed");
    expect((await as("musa").get("/ess/performance")).body.open_pip).toBeNull();
  });

  test("a probation review opens on Probation Ending, on the five criteria, and Confirm records the confirmation", async () => {
    const service = require("../../src/modules/reviews/reviews.service");
    const id = await service.openProbation(emp("newbie"), "2026-11-01");
    expect(id).toBeTruthy();
    expect(await service.openProbation(emp("newbie"), "2026-11-01")).toBeNull();
    const open = await as("newbie").get("/ess/performance/check-in");
    expect(open.body.items.map((i) => i.criterion)).toEqual(["objectives", "quality", "timeliness", "attendance", "conduct"]);
    expect((await as("newbie").post("/ess/performance/check-in/submit")).status).toBe(200);
    const items = (await as("head").get(`/performance/reviews/${id}`)).body.items;
    const scores = items.map((i) => ({ performance_review_item_id: i.performance_review_item_id, score: "1", override_reason: "Seen at work" }));
    expect((await as("head").put(`/performance/reviews/${id}/scores`, { items: scores, actions: [] })).status).toBe(200);
    expect((await as("head").post(`/performance/reviews/${id}/submit`)).status).toBe(200);
    const instance = await pending(id);
    await act(instance.workflow_instance_id, "pm", "approve");
    await drain();
    const outcome = await as("ops").post(`/performance/reviews/${id}/probation-outcome`, { probation_outcome: "confirm" });
    expect(outcome.status).toBe(200);
    expect(outcome.body.probation_outcome).toBe("confirm");
    await act(instance.workflow_instance_id, "ops", "approve");
    await drain();
    expect((await one("SELECT confirmed_on FROM employee WHERE employee_id = $1", [emp("newbie")])).confirmed_on).toBeTruthy();
    expect((await as("newbie").get(`/performance/reviews/${id}`)).body).toMatchObject({ status: "closed", review_kind: "probation", rating: "exceeds" });
  });

  test("a scorecard drafted after its plan bound is sent on its own and binds on the CEO's approval", async () => {
    const card = await as("head").post("/performance/scorecards", { employee_id: emp("late"), performance_period_id: ids.period });
    expect(card.status).toBe(201);
    expect(card.body).toMatchObject({ status: "draft", can_edit: true, can_send: false });
    const lines = card.body.lines.map((l) =>
      Object.fromEntries(Object.entries({ section: l.section, title: l.title, measure: l.measure, source: l.source, target_value: l.target_value, unit: l.unit, weight: l.weight }).filter(([, v]) => v !== null)),
    );
    const saved = await as("head").put(`/performance/scorecards/${card.body.scorecard_id}/lines`, {
      lines: [{ section: "results", title: "Listings checked", measure: "numeric", source: "own", target_value: "50", weight: "60" }, { section: "kpis", title: "Assets on time", measure: "standard", source: "function_kpi", kpi_definition_id: ids.kpi, target_value: "95", unit: "%", weight: "25" }, ...lines],
    });
    expect(saved.body.can_send).toBe(true);
    const sent = await as("head").post(`/performance/scorecards/${card.body.scorecard_id}/submit`);
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ can_edit: false, can_send: false, amendment_instance_id: expect.any(String) });
    const instance = await pending(card.body.scorecard_id);
    expect(instance.current_stage).toBe("line_manager");
    await act(instance.workflow_instance_id, "pm", "approve");
    await act(instance.workflow_instance_id, "ops", "approve");
    await act(instance.workflow_instance_id, "ceo", "approve");
    await drain();
    expect((await as("late").get(`/performance/scorecards/${card.body.scorecard_id}`)).body).toMatchObject({ status: "binding", can_agree: true });
    // September's round opened before it bound: September is not reviewed for it.
    expect((await q("SELECT 1 FROM performance_review WHERE scorecard_id = $1", [card.body.scorecard_id])).rowCount).toBe(0);
  });

  test("the job opens every round still due, once; Home counts the reviews due and the ones to write", async () => {
    const cycle = require("../../src/modules/reviews/reviews.cycle");
    // The scorecard that bound today is in neither: it starts with October's round.
    expect(await cycle.openDueRounds("2026-10-22")).toBe("opened July 2026 (2 reviews), August 2026 (2 reviews)");
    expect(await cycle.openDueRounds("2026-10-22")).toBe("no round due");
    const all = { scope: "all", scope_ids: null };
    expect(await homeReviews.dueCount(pool, { today: "2026-10-22" }, all)).toBe(4);
    expect(await homeReviews.reviewerDueCount(pool, { today: "2026-10-22", employee_id: emp("head") })).toBe(0);
    const waiting = await as("head").get("/performance/reviews?waiting_on_me=true");
    expect(waiting.body.page.total).toBe(0);
    expect((await as("head").get(`/performance/reviews?round_id=${ids.round}`)).body.data.map((r) => r.status).sort()).toEqual(["closed", "closed"]);
  });
});
