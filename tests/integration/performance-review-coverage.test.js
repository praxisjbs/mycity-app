"use strict";
/**
 * The weight a rating rests on (BG-012; docs/guides/performance.md §6.9, §6.14, §6.15): the real
 * migrations, the whole app through HTTP, every response parsed with its contract (APP_ENV=test).
 *
 * The case the QA audit found: Ada's 60-weight Results line has no evidence (Not Assessable) and
 * her commitments line has no score, so only the KPI (25) and Monthly Update On Time (7.5) lines
 * score 1. The rating rules stand as agreed (P16): the score to date is 1 and the rating Exceeds.
 * What changes is that the review, the scorecard, My Performance and the review's PDF now say it
 * rests on 32.5 of 100.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/performance-review-coverage
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

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const PASSWORD = "Perf-Coverage9Test";

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

describeDb("a rating and the weight it rests on, against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  const ids = {};

  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
    post: (path, body = {}) => request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    put: (path, body = {}) => request(app).put(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    patch: (path, body = {}) => request(app).patch(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
  });
  const emp = (who) => people[who].employee.employee_id;
  const actor = (who) => ({ user_id: people[who].user.user_id, employee_id: emp(who), role_ids: [people[who].role.role_id], is_ceo: who === "ceo" });
  const act = (instanceId, who, decision) => tx((c) => workflow.act(c, { instance_id: instanceId, actor: actor(who), decision }));
  const pending = (entityId) => one("SELECT workflow_instance_id, current_stage FROM workflow_instance WHERE entity_id = $1 AND state = 'pending'", [entityId]);

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    const make = (key, first, last, role, job, department, isCeo = false) =>
      tx(async (client) => {
        people[key] = await createAdmin(
          client,
          {
            employee: {
              first_name: first,
              last_name: last,
              work_email: `${key}@mycity.test`,
              phone: "08031234567",
              job_title: job,
              department_name: department,
              start_date: "2026-01-05",
              employment_type: "full_time",
              work_pattern: "on_site",
            },
            role_code: role,
            is_ceo: isCeo,
          },
          PASSWORD,
          { allowAdditional: true },
        );
      });
    await make("ceo", "Amaka", "Obi", "management", "Chief Executive Officer", "General Management", true);
    await make("pm", "Kunle", "Bello", "management", "Program Manager", "General Management");
    await make("ops", "Ngozi", "Eze", "operations_people", "Operations & People Lead", "People & Culture");
    await make("head", "Tolu", "Ade", "head_of_department", "Head, Brand", "Branding & Marketing");
    await make("ada", "Ada", "Nwosu", "employee", "Social Media Manager", "Branding & Marketing");
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [emp("head"), emp("ada")]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = ANY($2::uuid[])", [emp("pm"), [emp("head"), emp("ops")]]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [emp("ceo"), emp("pm")]);
    ids.bm = (await one("SELECT department_id FROM department WHERE name = 'Branding & Marketing'")).department_id;
    await q("UPDATE department SET code = 'BM', head_employee_id = $2 WHERE department_id = $1", [ids.bm, emp("head")]);
    await require("../../src/shared/rbac/grants-cache").bumpTeamVersion();
    await drain();
    let ip = 0;
    for (const key of Object.keys(people)) {
      ip += 1;
      const res = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", `10.66.0.${ip}`).send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }

    // Q3 2026, planned and bound: Results 60, the function's KPI 25, and the two default
    // Accountability lines (On-time commitment delivery and Monthly update on time, 7.5 each).
    const period = await as("ops").post("/performance/periods", { starts_on: "2026-07-01" });
    expect(period.status).toBe(201);
    ids.period = period.body.performance_period_id;
    expect((await as("ops").patch(`/performance/periods/${ids.period}`, { status: "active" })).status).toBe(200);
    const o = await as("head").post("/performance/objectives", { performance_period_id: ids.period, department_id: ids.bm, title: "Be the app residents open first" });
    expect(o.status).toBe(201);
    expect((await as("head").post("/performance/key-results", { okr_objective_id: o.body.okr_objective_id, statement: "Publish 36 city stories", target_value: "36", accountable_employee_id: emp("head") })).status).toBe(201);
    const kpi = await as("head").post("/performance/kpis", { department_id: ids.bm, name: "Assets on time", unit: "%", target_value: "95", target_text: "≥95%" });
    expect(kpi.status).toBe(201);
    ids.kpi = kpi.body.kpi_definition_id;
    const card = await as("head").post("/performance/scorecards", { employee_id: emp("ada"), performance_period_id: ids.period });
    expect(card.status).toBe(201);
    ids.card = card.body.scorecard_id;
    const accountability = card.body.lines.map((l) =>
      Object.fromEntries(Object.entries({ section: l.section, title: l.title, measure: l.measure, source: l.source, target_value: l.target_value, unit: l.unit, weight: l.weight }).filter(([, v]) => v !== null)),
    );
    const saved = await as("head").put(`/performance/scorecards/${ids.card}/lines`, {
      lines: [
        { section: "results", title: "Stories published", measure: "numeric", source: "own", target_value: "10", weight: "60" },
        { section: "kpis", title: "Assets on time", measure: "standard", source: "function_kpi", kpi_definition_id: ids.kpi, target_value: "95", unit: "%", weight: "25" },
        ...accountability,
      ],
    });
    expect(saved.status).toBe(200);
    expect(saved.body.lines.map((l) => l.weight)).toEqual(["60", "25", "7.5", "7.5"]);
    const plan = (await as("head").get(`/performance/plans?period_id=${ids.period}&department_id=${ids.bm}`)).body.data[0];
    expect((await as("head").post(`/performance/plans/${plan.performance_plan_id}/submit`)).status).toBe(200);
    const instance = await pending(plan.performance_plan_id);
    for (const who of ["pm", "ops", "ceo"]) await act(instance.workflow_instance_id, who, "approve");
    await drain();
    await q("UPDATE performance_plan SET binding_at = '2026-06-30T12:00:00Z' WHERE performance_plan_id = $1", [plan.performance_plan_id]);
    expect((await as("head").post(`/performance/kpis/${ids.kpi}/actuals`, { month: "2026-09-01", result: "met", actual_value: "96" })).status).toBe(200);
    const round = await as("ops").post("/performance/rounds", { performance_period_id: ids.period, month: "2026-09-01" });
    expect(round.status).toBe(201);
    ids.review = (await one("SELECT performance_review_id FROM performance_review WHERE scorecard_id = $1", [ids.card])).performance_review_id;
    await drain();
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("before it closes, a review and its scorecard carry no coverage", async () => {
    expect((await as("head").get(`/performance/scorecards/${ids.card}`)).body).toMatchObject({ score_to_date: null, weight_scored: null, weight_total: null });
    expect((await as("ops").get(`/performance/reviews/${ids.review}`)).body).toMatchObject({ score_to_date: null, weight_scored: null, weight_total: null });
  });

  test("32.5 of 100 weight scored 1 reads Exceeds, as agreed, and says it rests on 32.5 of 100", async () => {
    // Ada gives her Results figure with no evidence: Not Assessable, no score.
    const open = await as("ada").get("/ess/performance/check-in");
    expect(open.status).toBe(200);
    const results = open.body.items.find((i) => i.line.section === "results");
    const saved = await as("ada").put("/ess/performance/check-in", { items: [{ performance_review_item_id: results.performance_review_item_id, actual_value: "8" }] });
    expect(saved.status).toBe(200);
    expect(saved.body.items.find((i) => i.performance_review_item_id === results.performance_review_item_id)).toMatchObject({ assessable: false, proposed_score: null });
    expect((await as("ada").post("/ess/performance/check-in/submit")).status).toBe(200);

    // The reviewer keeps the proposed scores but counts the late update as on time, with a reason.
    const items = (await as("head").get(`/performance/reviews/${ids.review}`)).body.items;
    const scores = items.map((i) =>
      i.line.source === "update_on_time"
        ? { performance_review_item_id: i.performance_review_item_id, score: "1", override_reason: "Sent on time by email" }
        : { performance_review_item_id: i.performance_review_item_id, score: i.proposed_score },
    );
    expect((await as("head").put(`/performance/reviews/${ids.review}/scores`, { items: scores, actions: [] })).status).toBe(200);
    expect((await as("head").post(`/performance/reviews/${ids.review}/submit`)).status).toBe(200);
    const instance = await pending(ids.review);
    await act(instance.workflow_instance_id, "pm", "approve");
    await drain();
    await act(instance.workflow_instance_id, "ops", "approve");
    await drain();

    // The audit's figures: the rule is unchanged, so 1 and Exceeds; the coverage says on what.
    const review = (await as("ada").get(`/performance/reviews/${ids.review}`)).body;
    expect(review.items.map((i) => i.score)).toEqual([null, "1", null, "1"]);
    expect(review).toMatchObject({ status: "closed", score_month: "1", score_to_date: "1", rating: "exceeds", weight_scored: "32.5", weight_total: "100" });
    const listed = (await as("ops").get(`/performance/reviews?round_id=${review.performance_cycle_id}`)).body.data.find((r) => r.performance_review_id === ids.review);
    expect(listed).toMatchObject({ weight_scored: "32.5", weight_total: "100" });
    const card = (await as("head").get(`/performance/scorecards/${ids.card}`)).body;
    expect(card).toMatchObject({ score_to_date: "1", rating: "exceeds", weight_scored: "32.5", weight_total: "100" });
    const mine = (await as("ada").get("/ess/performance")).body;
    expect(mine.scorecard).toMatchObject({ score_to_date: "1", rating: "exceeds", weight_scored: "32.5", weight_total: "100" });
    const audited = await one("SELECT after FROM audit_ledger WHERE action LIKE '%review.closed' AND entity_id = $1", [ids.review]);
    expect(audited.after).toMatchObject({ rating: "exceeds", weight_scored: "32.5", weight_total: "100" });

    // The review's PDF prints it beside Score to Date and Rating.
    const doc = await one("SELECT doc_type, render_status, render_html FROM document WHERE document_id = $1", [review.document_id]);
    expect(doc.doc_type).toBe("review_summary");
    // Rendered by the worker after commit; until then the page it will print is on the row.
    expect(doc.render_status).toBe("pending");
    expect(doc.render_html).toContain("32.5 of 100 scored");
    const pdf = require("../../src/modules/reviews/reviews.pdf");
    const closed = await require("../../src/modules/reviews/reviews.repo").get(pool, ids.review);
    expect(pdf.coverage(closed)).toBe("32.5 of 100 scored");

    // A conduct breach recaps the rating; the coverage stays with the scorecard.
    expect((await as("ops").post(`/performance/reviews/${ids.review}/conduct`, { conduct_breach: true, conduct_note: "Upheld caution, 12 September" })).status).toBe(200);
    expect((await as("head").get(`/performance/scorecards/${ids.card}`)).body).toMatchObject({ rating: "partly_meets", weight_scored: "32.5", weight_total: "100" });
  });

  test("the migration fills a review closed before it, from its scorecard's lines, and its scorecard", async () => {
    await q("UPDATE performance_review SET weight_scored = NULL, weight_total = NULL WHERE performance_review_id = $1", [ids.review]);
    await q("UPDATE scorecard SET weight_scored = NULL, weight_total = NULL WHERE scorecard_id = $1", [ids.card]);
    const fs = require("node:fs");
    const path = require("node:path");
    const sql = fs.readFileSync(path.join(__dirname, "../../migrations/2330_performance_score_coverage.sql"), "utf8");
    const up = sql.slice(sql.indexOf("-- UP"), sql.indexOf("-- DOWN"));
    await q(up);
    // Run again: nothing changes.
    await q(up);
    const r = await one("SELECT trim_scale(weight_scored)::text AS s, trim_scale(weight_total)::text AS t FROM performance_review WHERE performance_review_id = $1", [ids.review]);
    expect(r).toEqual({ s: "32.5", t: "100" });
    const c = await one("SELECT trim_scale(weight_scored)::text AS s, trim_scale(weight_total)::text AS t FROM scorecard WHERE scorecard_id = $1", [ids.card]);
    expect(c).toEqual({ s: "32.5", t: "100" });
  });
});
