"use strict";
/**
 * Performance PR 5 end to end (docs/guides/performance.md §6.21): Analytics and Home's performance
 * figures, on the real migrations, every answer parsed with its contract.
 *
 * The quarter's OKR tree, scorecards and their lines are written here as PR 2 writes them; the
 * rounds, reviews and their items as PR 3 will (§4: `check_in_submitted_at`, `closed_at`, `rating`,
 * the items' `self_score`, `proposed_score` and final `score`); and commitments as PR 4 will (a task
 * with `is_commitment`, `commitment_month`, `original_due_at` fixed on approval, `completed_at`,
 * `rescoped_at`). Figures that depend on the day are read at a fixed moment through the service.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/performance-analytics
 */
const request = require("supertest");
const c = require("@mycity/contract");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const { scopeFor } = require("../../src/middleware/rbac");
const analytics = require("../../src/modules/goals/goals.analytics");
const dashboard = require("../../src/modules/dashboard/dashboard.service");
const team = require("../../src/modules/dashboard/dashboard.team");
const kpi = require("../../src/modules/dashboard/kpi-catalog");
const eligibility = require("../../src/modules/dashboard/kpi-catalog/eligibility");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const wire = (value) => JSON.parse(JSON.stringify(value));
const PASSWORD = "Perf-Analytics9Test";
/** 13:00 on Saturday 5 December 2026 in Lagos: November's check-ins are due, its reviews not yet. */
const NOW = new Date("2026-12-05T12:00:00Z");

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

describeDb("performance analytics against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  const users = {};
  const ids = {};
  let ip = 0;

  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
    post: (path, body = {}) => request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
  });
  const emp = (who) => people[who].employee.employee_id;
  const scopeOf = (who) => scopeFor(users[who], "performance", "view");

  /** A plan, binding, of the company (department null) or a function. */
  const plan = (departmentId) =>
    one(
      `INSERT INTO performance_plan (performance_period_id, department_id, status, binding_at)
       VALUES ($1, $2, 'binding', now()) RETURNING performance_plan_id`,
      [ids.period, departmentId],
    ).then((r) => r.performance_plan_id);

  const objective = (planId, departmentId, code, goalId = null) =>
    one(
      `INSERT INTO okr_objective (performance_period_id, performance_plan_id, department_id, code, title, organisational_goal_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING okr_objective_id`,
      [ids.period, planId, departmentId, code, `Objective ${code}`, goalId],
    ).then((r) => r.okr_objective_id);

  /** A key result with its months: [month, status, proposed, confirmed]. */
  async function keyResult(objectiveId, code, months = [], accountable = null) {
    const kr = await one(
      `INSERT INTO okr_key_result (okr_objective_id, code, statement, target_value, accountable_employee_id)
       VALUES ($1, $2, $3, 100, $4) RETURNING okr_key_result_id`,
      [objectiveId, code, `Key result ${code}`, accountable],
    );
    for (const [month, status, proposed, confirmed = null] of months)
      await q(
        `INSERT INTO okr_key_result_month (okr_key_result_id, month, status, proposed_score, confirmed_score)
         VALUES ($1, $2, $3, $4, $5)`,
        [kr.okr_key_result_id, month, status, proposed, confirmed],
      );
    return kr.okr_key_result_id;
  }

  const scorecard = (who, departmentId, reviewer, status, score, rating) =>
    one(
      `INSERT INTO scorecard (performance_period_id, employee_id, department_id, reviewer_employee_id, status,
                              score_to_date, rating)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING scorecard_id`,
      [ids.period, emp(who), departmentId, reviewer ? emp(reviewer) : null, status, score, rating],
    ).then((r) => r.scorecard_id);

  const line = (scorecardId, who, section, title, weight) =>
    one(
      `INSERT INTO employee_target (scorecard_id, employee_id, title, weight, section, measure, source, due_on, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'own', '2026-12-31', 'active') RETURNING employee_target_id`,
      [scorecardId, emp(who), title, weight, section, section === "results" ? "numeric" : "standard"],
    ).then((r) => r.employee_target_id);

  const round = (name, month, status, due) =>
    one(
      `INSERT INTO performance_cycle (name, starts_on, ends_on, status, performance_period_id, month, check_in_due_on,
                                      head_check_in_due_on, review_due_on, second_level_due_on, close_due_on)
       VALUES ($1, $2, ($2::date + interval '1 month' - interval '1 day')::date, $3, $4, $2, $5, $6, $7, $8, $9)
       RETURNING performance_cycle_id`,
      [name, month, status, ids.period, ...due],
    ).then((r) => r.performance_cycle_id);

  const review = (roundId, scorecardId, who, reviewer, status, checkInAt, closedAt = null, rating = null) =>
    one(
      `INSERT INTO performance_review (performance_cycle_id, employee_id, reviewer_employee_id, review_type, status,
                                       scorecard_id, review_kind, check_in_submitted_at, closed_at, rating)
       VALUES ($1, $2, $3, 'manager', $4, $5, 'monthly', $6, $7, $8) RETURNING performance_review_id`,
      [roundId, emp(who), emp(reviewer), status, scorecardId, checkInAt, closedAt, rating],
    ).then((r) => r.performance_review_id);

  const item = (reviewId, lineId, self, proposed, score) =>
    q(
      `INSERT INTO performance_review_item (performance_review_id, employee_target_id, self_score, proposed_score, score)
       VALUES ($1, $2, $3, $4, $5)`,
      [reviewId, lineId, self, proposed, score],
    );

  /** A commitment as PR 4 will write it: approved (its original date fixed) unless `original` is null. */
  const commitment = (who, month, original, completed = null, rescoped = null) =>
    q(
      `INSERT INTO task (title, status, created_by, primary_assignee_id, due_at, completed_at, is_commitment,
                         commitment_month, original_due_at, rescoped_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7, $5, $8)`,
      [`Commitment of ${who}`, completed ? "done" : "todo", people[who].user.user_id, emp(who), original, completed, month, rescoped],
    );

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
    await make("dev", "Femi", "Ola", "employee", "Content Associate", "Technology & Back-office Ops");
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = ANY($2::uuid[])", [emp("head"), [emp("ada"), emp("musa")]]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [emp("other"), emp("dev")]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = ANY($2::uuid[])", [emp("pm"), [emp("head"), emp("ops")]]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = ANY($2::uuid[])", [emp("ceo"), [emp("pm"), emp("other")]]);
    ids.bm = (await one("SELECT department_id FROM department WHERE name = 'Branding & Marketing'")).department_id;
    ids.tbo = (await one("SELECT department_id FROM department WHERE name = 'Technology & Back-office Ops'")).department_id;
    await q("UPDATE department SET code = 'BM', head_employee_id = $2 WHERE department_id = $1", [ids.bm, emp("head")]);
    await q("UPDATE department SET code = 'TBO', head_employee_id = $2 WHERE department_id = $1", [ids.tbo, emp("other")]);
    await grantsCache.bumpTeamVersion();
    await drain();
    for (const key of Object.keys(people)) {
      ip += 1;
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.65.0.${ip}`)
        .send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
      users[key] = await grantsCache.getAuthUser(pool, people[key].user.user_id);
    }
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("before the first quarter, Analytics is empty rather than an error", async () => {
    const res = await as("ops").get("/performance/analytics");
    expect(res.status).toBe(200);
    expect(c.goals.PerformanceAnalytics.parse(res.body)).toMatchObject({ period: null, scores: [], company_score: null });
    const people = await as("ops").get("/performance/analytics/people");
    expect(people.body.page.total).toBe(0);
  });

  test("the quarter, its OKR tree, scorecards, rounds, reviews and commitments", async () => {
    const period = await as("ops").post("/performance/periods", { starts_on: "2026-10-01", targets_lock_on: "2026-10-31" });
    expect(period.status).toBe(201);
    ids.period = period.body.performance_period_id;
    const goal = await as("ceo").post("/performance/goals", { code: "OG1", title: "Grow active users", plan_year_starts_on: "2026-01-01" });
    expect(goal.status).toBe(201);
    ids.goal = goal.body.organisational_goal_id;

    // The company: CO-KR1.1 at November's confirmed 0.65, CO-KR1.2 at October's 0.5.
    const co = await objective(await plan(null), null, "CO-O1", ids.goal);
    await keyResult(co, "CO-KR1.1", [["2026-10-01", "on_track", 0.8], ["2026-11-01", "at_risk", 0.6, 0.65]]);
    await keyResult(co, "CO-KR1.2", [["2026-10-01", "on_track", 0.5]]);
    // Branding & Marketing: one done, one never reported.
    const bm = await objective(await plan(ids.bm), ids.bm, "BM-O1");
    await keyResult(bm, "BM-KR1.1", [["2026-10-01", "done", 0.9]], emp("head"));
    ids.awaiting = await keyResult(bm, "BM-KR1.2");
    // Technology & Back-office Ops: one in recovery, one at risk.
    const tboPlan = await plan(ids.tbo);
    await keyResult(await objective(tboPlan, ids.tbo, "TBO-O1"), "TBO-KR1.1", [["2026-10-01", "off_track", 0.3]]);
    await keyResult(await objective(tboPlan, ids.tbo, "TBO-O2"), "TBO-KR2.1", [["2026-10-01", "on_track", 0.7], ["2026-11-01", "at_risk", 0.5]]);

    const cards = {
      head: await scorecard("head", ids.bm, "pm", "agreed", 0.92, "exceeds"),
      ada: await scorecard("ada", ids.bm, "head", "agreed", 0.82, "meets"),
      musa: await scorecard("musa", ids.bm, "head", "binding", 0.4, "below"),
      dev: await scorecard("dev", ids.tbo, "other", "agreed", 0.6, "partly_meets"),
    };
    await scorecard("other", ids.tbo, "ceo", "draft", null, null);
    ids.cards = cards;
    const lines = {
      ada1: await line(cards.ada, "ada", "results", "Grow followers", 60),
      ada2: await line(cards.ada, "ada", "kpis", "Assets on time", 25),
      ada3: await line(cards.ada, "ada", "accountability", "Monthly update on time", 15),
      musa1: await line(cards.musa, "musa", "results", "Ship the campaign", 60),
      head1: await line(cards.head, "head", "results", "Brand reach", 60),
      dev1: await line(cards.dev, "dev", "results", "Listings live", 60),
      dev2: await line(cards.dev, "dev", "kpis", "Listings accurate", 25),
    };

    // October: closed. The head checks in by the head deadline (the 4th); staff by the 3rd; close by the 13th.
    const oct = await round("October 2026", "2026-10-01", "closed", ["2026-11-03", "2026-11-04", "2026-11-09", "2026-11-11", "2026-11-13"]);
    const headOct = await review(oct, cards.head, "head", "pm", "closed", "2026-11-04T13:00:00Z", "2026-11-12T10:00:00Z", "exceeds");
    const adaOct = await review(oct, cards.ada, "ada", "head", "closed", "2026-11-02T09:00:00Z", "2026-11-13T21:00:00Z", "meets");
    const musaOct = await review(oct, cards.musa, "musa", "head", "closed", "2026-11-05T09:00:00Z", "2026-11-20T09:00:00Z", "below");
    // 23:30 on the 3rd in Lagos is on time; 00:30 on the 14th is a day late.
    const devOct = await review(oct, cards.dev, "dev", "other", "closed", "2026-11-03T22:30:00Z", "2026-11-13T23:30:00Z", "partly_meets");
    await item(adaOct, lines.ada1, 0.9, 0.85, 0.8);
    await item(adaOct, lines.ada2, null, 0.7, 0.7);
    await item(adaOct, lines.ada3, null, 1, 1);
    await item(musaOct, lines.musa1, 0.6, 0.5, 0.4);
    await item(headOct, lines.head1, 1, 0.9, 0.9);
    await item(devOct, lines.dev1, 0.5, 0.5, 0.6);
    await item(devOct, lines.dev2, null, null, null);
    // November: open. Ada is in on time; nobody else yet.
    const nov = await round("November 2026", "2026-11-01", "open", ["2026-12-02", "2026-12-03", "2026-12-07", "2026-12-09", "2026-12-14"]);
    await review(nov, cards.ada, "ada", "head", "with_reviewer", "2026-12-01T10:00:00Z");
    await review(nov, cards.musa, "musa", "head", "check_in", null);
    await review(nov, cards.head, "head", "pm", "check_in", null);
    await review(nov, cards.dev, "dev", "other", "check_in", null);

    // October's commitments: on time, late, missed, rescoped and one never approved; November's done early and one not yet due.
    await commitment("ada", "2026-10-01", "2026-10-10T16:00:00Z", "2026-10-10T20:00:00Z");
    await commitment("ada", "2026-10-01", "2026-10-15T16:00:00Z", "2026-10-17T10:00:00Z");
    await commitment("ada", "2026-10-01", "2026-10-20T16:00:00Z");
    await commitment("ada", "2026-10-01", "2026-10-22T16:00:00Z", null, "2026-10-21T10:00:00Z");
    await commitment("ada", "2026-10-01", null);
    await commitment("musa", "2026-11-01", "2026-11-25T16:00:00Z", "2026-11-24T10:00:00Z");
    await commitment("musa", "2026-11-01", "2026-12-20T16:00:00Z");
    await commitment("dev", "2026-10-01", "2026-10-05T16:00:00Z", "2026-10-05T17:00:00Z");
  });

  test("the OKR figures read the whole tree: scores by month, the company score, key results by status", async () => {
    const res = await as("ada").get(`/performance/analytics?period_id=${ids.period}`);
    expect(res.status).toBe(200);
    const a = c.goals.PerformanceAnalytics.parse(res.body);
    expect(a.period).toEqual({ performance_period_id: ids.period, name: "Q4 2026", starts_on: "2026-10-01", ends_on: "2026-12-31" });
    expect(a.months).toEqual(["2026-10-01", "2026-11-01", "2026-12-01"]);
    // Latest: CO-O1 is the mean of 0.65 and 0.5, to two places.
    expect(a.company_score).toBe("0.58");
    const month = (scores) => scores.map((m) => m.score);
    expect(a.scores.map((s) => [s.department, month(s.months)])).toEqual([
      [null, ["0.65", "0.65", null]],
      ["Branding & Marketing", ["0.9", null, null]],
      ["Technology & Back-office Ops", ["0.5", "0.5", null]],
    ]);
    expect(a.key_results).toEqual({
      key_results: 6,
      not_started: 0,
      on_track: 1,
      at_risk: 2,
      off_track: 1,
      done: 1,
      missed: 0,
      awaiting_report: 1,
      recovery: 1,
    });

    const tbo = c.goals.PerformanceAnalytics.parse((await as("ops").get(`/performance/analytics?department_id=${ids.tbo}`)).body);
    expect(tbo.scores.map((s) => s.department)).toEqual([null, "Technology & Back-office Ops"]);
    expect(tbo.company_score).toBe("0.58");
    expect(tbo.key_results).toMatchObject({ key_results: 2, off_track: 1, at_risk: 1, recovery: 1, awaiting_report: 0 });
  });

  test("ratings at the latest closed round and Self Against Final, in the reader's scope", async () => {
    const all = c.goals.PerformanceAnalytics.parse((await as("ops").get("/performance/analytics")).body);
    expect(all.ratings).toEqual({
      month: "2026-10-01",
      counts: [
        { rating: "exceeds", count: 1 },
        { rating: "meets", count: 1 },
        { rating: "partly_meets", count: 1 },
        { rating: "below", count: 1 },
      ],
    });
    // Branding & Marketing: 0.1, 0, 0, 0.2 and 0.1 over five lines; Technology: -0.1; a line with no score is left out.
    expect(all.self_against_final).toEqual([
      { department_id: ids.bm, department: "Branding & Marketing", gap: "0.08", lines: 5 },
      { department_id: ids.tbo, department: "Technology & Back-office Ops", gap: "-0.1", lines: 1 },
    ]);

    // The head's team: themselves, Ada and Musa.
    const mine = c.goals.PerformanceAnalytics.parse((await as("head").get("/performance/analytics")).body);
    expect(mine.ratings.counts.map((r) => r.count)).toEqual([1, 1, 0, 1]);
    expect(mine.self_against_final.map((r) => r.department)).toEqual(["Branding & Marketing"]);
    // Their own alone, for a member of staff; the OKR figures are everyone's.
    const own = c.goals.PerformanceAnalytics.parse((await as("ada").get("/performance/analytics")).body);
    expect(own.ratings.counts.map((r) => r.count)).toEqual([0, 1, 0, 0]);
    expect(own.self_against_final).toEqual([{ department_id: ids.bm, department: "Branding & Marketing", gap: "0.03", lines: 3 }]);
    expect(own.company_score).toBe("0.58");
  });

  test("check-ins, reviews closed and commitments on time, against their deadlines in Lagos", async () => {
    const a = c.goals.PerformanceAnalytics.parse(wire(await analytics.figures({}, await scopeOf("ops"), { now: NOW })));
    // October: all four in, Musa late. November: due on the 2nd (the head the 3rd), only Ada in.
    expect(a.check_ins).toEqual({ due: 8, on_time: 4 });
    expect(a.check_ins_by_month).toEqual([
      { month: "2026-10-01", due: 4, on_time: 3 },
      { month: "2026-11-01", due: 4, on_time: 1 },
      { month: "2026-12-01", due: 0, on_time: 0 },
    ]);
    // October's close was due on the 13th: Musa's and Femi's (00:30 on the 14th) are late. November's is not due yet.
    expect(a.reviews_closed).toEqual({ due: 4, on_time: 2 });
    expect(a.reviews_closed_by_month.map((m) => [m.due, m.on_time])).toEqual([[4, 2], [0, 0], [0, 0]]);
    // Approved commitments, rescoped ones out, a commitment not yet due out.
    expect(a.commitments).toEqual({ due: 5, on_time: 3 });
    expect(a.commitments_by_function).toEqual([
      {
        department_id: ids.bm,
        department: "Branding & Marketing",
        months: [
          { month: "2026-10-01", due: 3, on_time: 1 },
          { month: "2026-11-01", due: 1, on_time: 1 },
          { month: "2026-12-01", due: 0, on_time: 0 },
        ],
      },
      {
        department_id: ids.tbo,
        department: "Technology & Back-office Ops",
        months: [
          { month: "2026-10-01", due: 1, on_time: 1 },
          { month: "2026-11-01", due: 0, on_time: 0 },
          { month: "2026-12-01", due: 0, on_time: 0 },
        ],
      },
    ]);

    const head = await analytics.figures({ department_id: ids.bm }, await scopeOf("head"), { now: NOW });
    expect(head.commitments).toEqual({ due: 4, on_time: 2 });
    expect(head.check_ins).toEqual({ due: 6, on_time: 3 });
    // Before November's deadlines nothing of November is due.
    const early = await analytics.figures({}, await scopeOf("ops"), { now: new Date("2026-11-20T12:00:00Z") });
    expect(early.check_ins_by_month[1]).toEqual({ month: "2026-11-01", due: 1, on_time: 1 });
  });

  test("People: the quarter's scorecards past draft, in scope, sorted by score, filtered on the server", async () => {
    const names = (res) => res.body.data.map((p) => p.employee.display_name);
    const all = await as("ops").get("/performance/analytics/people?sort=-score_to_date");
    expect(all.status).toBe(200);
    c.goals.AnalyticsPersonPage.parse(all.body);
    expect(names(all)).toEqual(["Tolu Ade", "Ada Nwosu", "Femi Ola", "Musa Danjuma"]);
    expect(all.body.data[1]).toMatchObject({
      scorecard_id: ids.cards.ada,
      department: "Branding & Marketing",
      reviewer: expect.objectContaining({ display_name: "Tolu Ade" }),
      score_to_date: "0.82",
      rating: "meets",
      months_scored: 1,
    });
    expect(names(await as("ops").get("/performance/analytics/people"))).toEqual(["Musa Danjuma", "Femi Ola", "Ada Nwosu", "Tolu Ade"]);
    expect(names(await as("ops").get("/performance/analytics/people?rating=below"))).toEqual(["Musa Danjuma"]);
    expect(names(await as("ops").get(`/performance/analytics/people?department_id=${ids.tbo}`))).toEqual(["Femi Ola"]);
    expect(names(await as("ops").get("/performance/analytics/people?q=nwosu"))).toEqual(["Ada Nwosu"]);
    expect(names(await as("head").get("/performance/analytics/people?sort=employee"))).toEqual(["Ada Nwosu", "Musa Danjuma", "Tolu Ade"]);
    expect(names(await as("ada").get("/performance/analytics/people"))).toEqual(["Ada Nwosu"]);
    expect((await as("ops").get("/performance/analytics/people?page_size=100")).status).toBe(422);
  });

  test("Export: the people table as a workbook for the person who asked, never for one who may not export", async () => {
    expect((await as("ada").post("/performance/analytics/people/export", {})).status).toBe(403);
    const asked = await as("head").post("/performance/analytics/people/export", { rating: "below" });
    expect(asked.status).toBe(202);
    const file = c.documents.ExportFile.parse(asked.body);
    expect(file.status).toBe("pending");
    await drain();
    const done = await as("head").get(`/exports/${file.document_id}`);
    expect(done.status).toBe(200);
    expect(done.body.status).toBe("done");
    const gathered = await analytics.gather(pool, { rating: "below" }, await scopeOf("head"));
    expect(gathered.rows.map((r) => r.employee.display_name)).toEqual(["Musa Danjuma"]);
  });

  test("the assistant reads Analytics in the asker's scope, scores and counts only, citing nothing", async () => {
    const authorise = require("../../src/shared/ai/authorise");
    const r = await authorise.runRead(pool, users.head, "goals.analytics", {});
    expect(r.list).toBe(false);
    expect(c.goals.PerformanceAnalytics.parse(wire(r.data)).ratings.counts.map((x) => x.count)).toEqual([1, 1, 0, 1]);
    expect(r.citations).toEqual([]);
  });

  test("Home: goal progress, the Org KPI and Goals On Track, for the CEO", async () => {
    const o = c.dashboard.HomeOverview.parse(wire(await dashboard.overview({ ...users.ceo, session_id: null }, { now: NOW })));
    expect(o.chart.goals).toEqual([expect.objectContaining({ title: "Grow active users", progress: 58 })]);
    expect(o.donut.percent).toBe(58);
    const byName = Object.fromEntries(o.donut.departments.map((d) => [d.department, d.percent]));
    expect(byName).toMatchObject({ "Branding & Marketing": 90, "Technology & Back-office Ops": 40, "People & Culture": null });
    const card = o.cards.find((x) => x.key === "goals_on_track");
    expect(card).toMatchObject({ title: "Goals On Track", unit: "pair", value: 2, denominator: 6, measurable: true });

    const reader = await eligibility.forUser(pool, users.ceo);
    const ctx = kpi.context({ user: users.ceo, scopes: reader.scopes, now: NOW });
    const entry = kpi.BY_ID.get("goals_on_track");
    const meta = kpi.metaOf(entry, await kpi.figureOf(entry, pool, ctx));
    expect(meta.groups.find((g) => g.value === "awaiting_report")).toEqual({ value: "awaiting_report", label: "Awaiting Report", count: 1 });
    const page = c.dashboard.HomeKpiDetailPage.parse(wire(await kpi.detailPage(entry, pool, { page: 1, group: "awaiting_report" }, ctx)));
    expect(page.data.map((r) => r.id)).toEqual([ids.awaiting]);
  });

  test("Home: My Scorecard and My Goals for a member of staff, and the Team roster's score", async () => {
    const o = c.dashboard.HomeOverview.parse(wire(await dashboard.overview({ ...users.ada, session_id: null }, { now: NOW })));
    // Grow followers 0.8 and the update 1 are at Meets or above; Assets on time 0.7 is behind.
    expect(o.cards.find((x) => x.key === "my_targets_on_track")).toMatchObject({
      title: "My Scorecard",
      value: 2,
      denominator: 3,
      caption: "1 behind",
    });
    expect(o.my_goals.map((g) => [g.title, g.progress]).sort()).toEqual([
      ["Assets on time", 70],
      ["Grow followers", 80],
      ["Monthly update on time", 100],
    ]);

    const homeScope = { scope: "team", scope_ids: [emp("head"), emp("ada"), emp("musa")], employee_id: emp("head") };
    const roster = await team.roster(homeScope, { page: 1 }, { now: NOW, performance: await scopeOf("head") });
    const kpis = Object.fromEntries(roster.data.map((r) => [r.employee.display_name, r.kpi_percent]));
    expect(kpis).toEqual({ "Tolu Ade": 92, "Ada Nwosu": 82, "Musa Danjuma": 40 });
    // A reader whose Performance view does not reach someone sees no score for them.
    const ownOnly = await team.roster(homeScope, { page: 1 }, { now: NOW, performance: await scopeOf("ada") });
    expect(Object.fromEntries(ownOnly.data.map((r) => [r.employee.display_name, r.kpi_percent]))).toEqual({
      "Tolu Ade": null,
      "Ada Nwosu": 82,
      "Musa Danjuma": null,
    });
  });
});
