"use strict";
/**
 * Praxis AI's Performance cards on the real migrations (docs/guides/praxis-ai.md §6.11, decisions 33
 * and 40): every form of Goals, KPIs, Scorecards, Reviews and the check-in, each drawn by the model
 * (scripted), named, and pressed through the service function the screen's own button calls, in the
 * order a quarter runs: Set Up Quarter and Save Quarter; Record Goal, Save Goal (a quarter's target)
 * and Share Goal; Set Objective, Save Objective and Share Objective; Set Key Result and Save Key
 * Result; Set KPI and Save KPI; Draft Scorecard, Add Line and Save Line; the plan bound; Change
 * Target (a key result by its code, a line by its person and words) and Request To Unbind; Open
 * Round; Save Check-In (one line, saved to the draft); Save Score and Start PIP and Save PIP behind
 * Confirm It's You; Change Reviewer. A record is named by its words; a card is refused where the
 * screen refuses it, and offered only to whoever holds the capability its route holds.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/ai-actions-performance
 */
process.env.GEMINI_API_KEY = "test-key";
const c = require("@mycity/contract");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(() => ({ getDelayed: async () => [] })),
  closeQueues: jest.fn(async () => {}),
  DEFAULTS: {},
}));

const { rebuild } = require("./helpers/schema");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const registry = require("../../src/shared/ai/registry");
const lagos = require("../../src/shared/time/lagos");
const { q, one, drain, fresh, script, say, harness } = require("./helpers/ai-actions");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

describeDb("Praxis AI's Performance cards against the real migrations", () => {
  let app;
  let h;
  const ids = {};
  const emp = (who) => h.people[who].employee_id;

  /** The card the model drafts for a question, as the answer carries it. */
  const drawn = async (who, key, values, question = "Do it.") => {
    script(say({ text: "Here it is.", action: { key, values, suggested: false } }));
    const asked = await h.ask(who, { question, shows: ["cards"] });
    expect(asked.status).toBe(200);
    expect(c.assistant.AiAnswer.safeParse(asked.body).success).toBe(true);
    return asked.body.card;
  };
  /** What the answer asks instead of a card when the model left out a field the card needs (decision 34). */
  const askedFor = async (who, key, values, question = "Do it.") => {
    script(say({ text: "Here it is.", action: { key, values, suggested: false } }));
    const asked = await h.ask(who, { question, shows: ["cards"] });
    expect(asked.status).toBe(200);
    expect(asked.body.card).toBeNull();
    return asked.body;
  };
  /** Draw it and press it: the press must run. */
  const done = async (who, key, values, question) => {
    const card = await drawn(who, key, values, question);
    expect([key, card && card.problems]).toEqual([key, {}]);
    const pressed = await h.press(who, card.ai_action_draft_id);
    expect([key, pressed.status, pressed.body.error || null]).toEqual([key, 200, null]);
    return { card, pressed: pressed.body };
  };
  /** Draw it and press it: the press is refused, with this status. */
  const refused = async (who, key, values, status) => {
    const card = await drawn(who, key, values);
    const pressed = await h.press(who, card.ai_action_draft_id);
    expect([key, pressed.status]).toEqual([key, status]);
    return pressed.body.error;
  };

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    h = harness(app);
    await h.makePeople([
      { who: "ceo", first: "Amaka", last: "Obi", email: "ceo@mycity.test", job: "Chief Executive Officer", role: "management", ceo: true, password: "Chief#Officer26", department: "General Management" },
      { who: "pm", first: "Kunle", last: "Bello", email: "pm@mycity.test", job: "Program Manager", role: "management", password: "Program#Lead2026", department: "General Management" },
      { who: "ops", first: "Ngozi", last: "Eze", email: "ops@mycity.test", job: "Operations & People Lead", role: "operations_people", password: "Opera!ions2026", department: "People & Culture" },
      { who: "head", first: "Tolu", last: "Ade", email: "head@mycity.test", job: "Head, Brand", role: "head_of_department", password: "Brand#Lead2026", department: "Branding & Marketing" },
      { who: "ada", first: "Ada", last: "Nwosu", email: "ada@mycity.test", job: "Social Media Manager", role: "employee", password: "Social#Media2026", department: "Branding & Marketing" },
      { who: "musa", first: "Musa", last: "Danjuma", email: "musa@mycity.test", job: "Graphics Associate", role: "employee", password: "Graphics#Desk2026", department: "Branding & Marketing" },
    ]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = ANY($2::uuid[])", [emp("head"), [emp("ada"), emp("musa")]]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = ANY($2::uuid[])", [emp("pm"), [emp("head"), emp("ops")]]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [emp("ceo"), emp("pm")]);
    ids.bm = (await one("SELECT department_id FROM department WHERE name = 'Branding & Marketing'")).department_id;
    await q("UPDATE department SET code = 'BM', head_employee_id = $2 WHERE department_id = $1", [ids.bm, emp("head")]);
    await require("../../src/shared/rbac/grants-cache").bumpTeamVersion();
    registry.load();
    fresh();
  }, 120_000);

  afterAll(async () => {
    registry.reset();
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fresh();
  });

  test("quarters.create and quarters.edit: Set Up Quarter and Save Quarter for performance.manage alone; the quarter by its name; a status never goes back", async () => {
    expect(await drawn("head", "quarters.create", { starts_on: "2026-07-01" })).toBeNull();
    const { card, pressed } = await done("ops", "quarters.create", { starts_on: "2026-07-01", rules: { sections: {} } }, "Set up Q3 2026.");
    expect(card).toMatchObject({ action_key: "quarters.create", label: "Set Up Quarter", schema: "goals.PeriodCreate", records: [] });
    // The rules are the last quarter's: the card never carries them, whatever the model wrote.
    expect(card.values).toEqual({ starts_on: "2026-07-01" });
    expect(card.fields.map((f) => f.name)).toEqual(["starts_on", "name", "status"]);
    expect(pressed.lines).toEqual([expect.objectContaining({ type: "performance_period", label: "Q3 2026", ok: true, message: "set up" })]);
    ids.period = pressed.lines[0].id;

    const active = await done("ops", "quarters.edit", { performance_period_id: "Q3 2026", status: "active" }, "Make Q3 2026 active.");
    expect(active.card).toMatchObject({ label: "Save Quarter", schema: "goals.PeriodChange", values: { performance_period_id: ids.period, status: "active" } });
    expect(active.card.records).toEqual([expect.objectContaining({ type: "performance_period", id: ids.period, label: "Q3 2026" })]);
    expect(await one("SELECT status FROM performance_period WHERE performance_period_id = $1", [ids.period])).toEqual({ status: "active" });

    const back = await refused("ops", "quarters.edit", { performance_period_id: ids.period, status: "planning" }, 409);
    expect(back).toMatchObject({ code: "PERIOD_STATUS", fields: { status: ["Cannot go back"] } });
    expect((await drawn("ops", "quarters.edit", { performance_period_id: "Q9 2031", name: "A quarter" })).problems).toMatchObject({ performance_period_id: ["No such quarter"] });
  });

  test("goals.create, goals.edit and goals.share: an organisational goal recorded, its quarter's target written by the goal's ID, and shared with a department", async () => {
    expect(await drawn("head", "goals.create", { title: "Grow city stories", plan_year_starts_on: "2026" })).toBeNull();
    const { card, pressed } = await done("ops", "goals.create", { title: "Grow city stories", plan_year_starts_on: "2026", strategic_theme: "Content" }, "Record a goal for 2026: grow city stories.");
    expect(card).toMatchObject({ label: "Record Goal", schema: "goals.OrganisationalGoalCreate", values: { title: "Grow city stories", plan_year_starts_on: "2026-01-01", strategic_theme: "Content" } });
    const goal = await one("SELECT organisational_goal_id, code::text AS code FROM organisational_goal WHERE title = 'Grow city stories'");
    expect(goal.code).toBe("ORG-2026-01");
    expect(pressed.lines).toEqual([expect.objectContaining({ id: goal.organisational_goal_id, label: "ORG-2026-01 Grow city stories", message: "recorded" })]);
    ids.goal = goal.organisational_goal_id;

    const target = await done("ops", "goals.edit", { organisational_goal_id: "ORG-2026-01", performance_period_id: "Q3 2026", target_text: "36 stories" }, "Q3's target for ORG-2026-01 is 36 stories.");
    expect(target.card).toMatchObject({ label: "Save Goal", schema: "goals.OrganisationalGoalChange", values: { organisational_goal_id: ids.goal, performance_period_id: ids.period, target_text: "36 stories" } });
    expect(target.card.records).toEqual([expect.objectContaining({ type: "organisational_goal", label: "ORG-2026-01 Grow city stories" })]);
    expect(target.card.names).toEqual([expect.objectContaining({ type: "performance_period", id: ids.period, label: "Q3 2026" })]);
    expect(await one("SELECT target_text FROM organisational_goal_target WHERE organisational_goal_id = $1 AND performance_period_id = $2", [ids.goal, ids.period])).toEqual({ target_text: "36 stories" });
    await done("ops", "goals.edit", { organisational_goal_id: "grow city stories", title: "Grow city stories and guides" });
    expect(await one("SELECT title FROM organisational_goal WHERE organisational_goal_id = $1", [ids.goal])).toEqual({ title: "Grow city stories and guides" });
    // A quarter's target with no quarter: the quarter is asked first, the open quarters to tap (decision 34).
    const quarter = await askedFor("ops", "goals.edit", { organisational_goal_id: ids.goal, target_text: "40 stories" });
    expect(quarter).toMatchObject({ content: "Which quarter's target is it?" });
    expect(quarter.choices).toContain("Q3 2026");

    const shared = await done("ops", "goals.share", { organisational_goal_id: ids.goal, audience: "departments", department_ids: [ids.bm] }, "Share it with Branding & Marketing.");
    expect(shared.card).toMatchObject({ label: "Share Goal", schema: "goals.GoalShareChange" });
    expect(shared.card.names).toEqual([expect.objectContaining({ type: "department", id: ids.bm, label: "Branding & Marketing" })]);
    expect(await one("SELECT gs.audience, array_agg(gd.department_id)::text[] AS departments FROM goal_share gs JOIN goal_share_department gd ON gd.goal_share_id = gs.goal_share_id WHERE gs.organisational_goal_id = $1 GROUP BY gs.audience", [ids.goal])).toEqual({ audience: "departments", departments: [ids.bm] });
    expect((await drawn("ops", "goals.share", { organisational_goal_id: ids.goal, audience: "all_staff", department_ids: [ids.bm] })).problems).toEqual({ department_ids: ["All staff names none"] });
  });

  test("objectives: Set Objective for whoever holds goals.company or goals.function, named by its words; Save Objective by its code; Share Objective for a company objective alone", async () => {
    expect(await drawn("musa", "objectives.create", { performance_period_id: ids.period, title: "Mine" })).toBeNull();
    const set = await done("head", "objectives.create", { performance_period_id: "Q3 2026", department_id: "Branding & Marketing", title: "Be the app residents open first", organisational_goal_id: "ORG-2026-01" }, "Set BM's objective.");
    expect(set.card).toMatchObject({ label: "Set Objective", schema: "goals.ObjectiveCreate", values: { performance_period_id: ids.period, department_id: ids.bm, organisational_goal_id: ids.goal } });
    expect(set.card.names.map((n) => n.label).sort()).toEqual(["Branding & Marketing", "ORG-2026-01 Grow city stories and guides", "Q3 2026"]);
    expect(set.pressed.lines).toEqual([expect.objectContaining({ type: "objective", label: "BM-O1 Be the app residents open first", message: "set" })]);
    ids.objective = set.pressed.lines[0].id;

    const saved = await done("head", "objectives.edit", { okr_objective_id: "BM-O1", title: "Be the app residents open first, every day" });
    expect(saved.card).toMatchObject({ label: "Save Objective", schema: "goals.ObjectiveChange", values: { okr_objective_id: ids.objective } });
    expect(saved.card.records).toEqual([expect.objectContaining({ type: "objective", label: "BM-O1 Be the app residents open first" })]);
    expect(await one("SELECT title FROM okr_objective WHERE okr_objective_id = $1", [ids.objective])).toEqual({ title: "Be the app residents open first, every day" });

    const company = await done("ops", "objectives.create", { performance_period_id: ids.period, title: "Reach every Lagos resident" });
    expect(company.pressed.lines[0].label).toBe("CO-O1 Reach every Lagos resident");
    const share = await done("ops", "objectives.share", { okr_objective_id: "CO-O1", audience: "all_staff" }, "Share CO-O1 with all staff.");
    expect(share.card).toMatchObject({ label: "Share Objective", schema: "goals.ObjectiveShareChange" });
    expect(await one("SELECT audience FROM goal_share WHERE okr_objective_id = $1", [company.pressed.lines[0].id])).toEqual({ audience: "all" });
    // A function's objective is never shared: refused by the sharing service's own rule, on the card's field.
    const fn = await refused("ops", "objectives.share", { okr_objective_id: ids.objective, audience: "all_staff" }, 409);
    expect(fn).toMatchObject({ code: "NOT_A_COMPANY_OBJECTIVE", fields: { okr_objective_id: ["Not a company objective"] } });
  });

  test("key results and KPIs: Set Key Result on an objective by its code, Save Key Result by its code, refused to someone who sets no goals; Set KPI by the function's code, Save KPI by its code", async () => {
    const set = await done("head", "key_results.create", { okr_objective_id: "BM-O1", statement: "Publish 36 city stories", target_value: "36", accountable_employee_id: emp("head") }, "Add a key result to BM-O1.");
    expect(set.card).toMatchObject({ label: "Set Key Result", schema: "goals.KeyResultCreate", values: { okr_objective_id: ids.objective } });
    expect(set.card.names.map((n) => n.label).sort()).toEqual(["BM-O1 Be the app residents open first, every day", "Tolu Ade"]);
    expect(set.card.fields.find((f) => f.name === "accountable_employee_id")).toMatchObject({ label: "Owner", picks: "colleague" });
    expect(set.pressed.lines[0].label).toBe("BM-KR1.1 Publish 36 city stories");
    ids.kr = set.pressed.lines[0].id;
    await done("head", "key_results.edit", { okr_key_result_id: "BM-KR1.1", target_text: "36 stories" });
    expect(await one("SELECT target_text FROM okr_key_result WHERE okr_key_result_id = $1", [ids.kr])).toEqual({ target_text: "36 stories" });
    // Save Key Result names no capability, as its route does not: the service's own rule refuses Musa.
    expect(await refused("musa", "key_results.edit", { okr_key_result_id: ids.kr, statement: "Mine now" }, 403)).toMatchObject({ code: "PERMISSION_DENIED" });

    expect(await drawn("musa", "kpis.create", { department_id: ids.bm, name: "Mine", target_text: "All" })).toBeNull();
    const kpi = await done("head", "kpis.create", { department_id: "BM", name: "Assets on time", unit: "%", target_value: "95", target_text: "95% on time" }, "Set BM's KPI: assets on time.");
    expect(kpi.card).toMatchObject({ label: "Set KPI", schema: "kpis.KpiCreate", values: { department_id: ids.bm } });
    expect(kpi.pressed.lines[0].label).toBe("BM-K01 Assets on time");
    ids.kpi = kpi.pressed.lines[0].id;
    const saved = await done("head", "kpis.edit", { kpi_definition_id: "BM-K01", formula: "Assets on time over assets due" });
    expect(saved.card).toMatchObject({ label: "Save KPI", schema: "kpis.KpiChange", records: [expect.objectContaining({ type: "kpi", label: "BM-K01 Assets on time" })] });
    expect(await one("SELECT formula FROM kpi_definition WHERE kpi_definition_id = $1", [ids.kpi])).toEqual({ formula: "Assets on time over assets due" });
  });

  test("scorecards: Draft Scorecard for a report, never one's own nor someone outside the team; Add Line and Save Line keep every other line as it stands", async () => {
    const draft = await done("head", "scorecards.create", { employee_id: emp("ada"), performance_period_id: "Q3 2026", copy_from: "none" }, "Draft Ada's Q3 scorecard.");
    expect(draft.card).toMatchObject({ label: "Draft Scorecard", schema: "targets.ScorecardDraft", records: [] });
    expect(draft.card.names.map((n) => n.label).sort()).toEqual(["Ada Nwosu", "Q3 2026"]);
    expect(draft.pressed.lines[0]).toMatchObject({ type: "scorecard", label: "Ada Nwosu, Q3 2026", message: "drafted" });
    ids.card = draft.pressed.lines[0].id;
    expect(await refused("head", "scorecards.create", { employee_id: emp("head"), performance_period_id: ids.period }, 403)).toMatchObject({ code: "SCORECARD_OWN", fields: { employee_id: ["Not your own"] } });
    expect(await refused("musa", "scorecards.create", { employee_id: emp("ada"), performance_period_id: ids.period }, 404)).toMatchObject({ fields: { employee_id: ["Not in your team"] } });

    const before = (await q("SELECT employee_target_id, title, weight FROM employee_target WHERE scorecard_id = $1 ORDER BY employee_target_id", [ids.card])).rows;
    const add = await done("head", "scorecards.add_line", { scorecard_id: "Ada Nwosu", section: "results", title: "Stories published", measure: "numeric", target_value: "10", weight: "60" }, "Add a line to Ada's scorecard.");
    expect(add.card).toMatchObject({ label: "Add Line", schema: "targets.ScorecardLineAdd", values: { scorecard_id: ids.card }, records: [expect.objectContaining({ label: "Ada Nwosu, Q3 2026" })] });
    await done("head", "scorecards.add_line", { scorecard_id: ids.card, section: "kpis", title: "Assets on time", measure: "standard", kpi_definition_id: "BM-K01", target_value: "95", weight: "25" });
    const lines = (await q("SELECT employee_target_id, title, source, kpi_definition_id, trim_scale(target_value)::text AS target FROM employee_target WHERE scorecard_id = $1", [ids.card])).rows;
    expect(lines.length).toBe(before.length + 2);
    expect(lines.find((l) => l.title === "Assets on time")).toMatchObject({ source: "function_kpi", kpi_definition_id: ids.kpi });
    for (const held of before) expect(lines.some((l) => l.employee_target_id === held.employee_target_id && l.title === held.title)).toBe(true);

    const change = await done("head", "scorecards.edit_line", { scorecard_id: ids.card, employee_target_id: "Stories published", target_value: "12" }, "Make Ada's stories target 12.");
    expect(change.card).toMatchObject({ label: "Save Line", schema: "targets.ScorecardLineChange" });
    expect(change.card.names).toEqual([expect.objectContaining({ type: "target", label: "Ada Nwosu: Stories published" })]);
    expect(await one("SELECT trim_scale(target_value)::text AS target FROM employee_target WHERE scorecard_id = $1 AND title = 'Stories published'", [ids.card])).toEqual({ target: "12" });
    expect((await q("SELECT 1 FROM employee_target WHERE scorecard_id = $1", [ids.card])).rows.length).toBe(before.length + 2);
    expect((await drawn("head", "scorecards.edit_line", { scorecard_id: ids.card, employee_target_id: "Videos made", weight: "10" })).problems).toMatchObject({ employee_target_id: ["No such line"] });
  });

  test("once the plan binds: Change Target by a key result's code and by a line's person and words, nothing twice; Request To Unbind by the plan's function", async () => {
    const plan = await one("SELECT performance_plan_id FROM performance_plan WHERE performance_period_id = $1 AND department_id = $2", [ids.period, ids.bm]);
    ids.plan = plan.performance_plan_id;
    expect((await h.as("head").post(`/performance/plans/${ids.plan}/submit`).send({})).status).toBe(200);
    for (const who of ["pm", "ops", "ceo"]) {
      const flow = await one("SELECT workflow_instance_id FROM workflow_instance WHERE entity_id = $1 AND state = 'pending'", [ids.plan]);
      const res = await h.as(who).post(`/workflow/instances/${flow.workflow_instance_id}/approve`).send({});
      expect([who, res.status]).toEqual([who, 200]);
    }
    await drain();
    expect(await one("SELECT status FROM scorecard WHERE scorecard_id = $1", [ids.card])).toEqual({ status: "binding" });
    // As if it bound before the quarter began: a round reviews the scorecards bound by its month's end.
    await q("UPDATE performance_plan SET binding_at = '2026-06-30T12:00:00Z' WHERE performance_plan_id = $1", [ids.plan]);

    const kr = await done("head", "target_changes.request", { okr_key_result_id: "BM-KR1.1", to_value: "40", from_month: "2026-09-01", reason: "The September push" }, "Change BM-KR1.1's target to 40.");
    expect(kr.card).toMatchObject({ label: "Change Target", schema: "goals.TargetChangeCreate", records: [expect.objectContaining({ type: "key_result", label: "BM-KR1.1 Publish 36 city stories" })] });
    expect(kr.pressed.lines[0]).toMatchObject({ type: "target_change", message: "sent to the CEO" });
    expect(await refused("head", "target_changes.request", { okr_key_result_id: ids.kr, to_value: "42", from_month: "2026-09-01", reason: "Again" }, 409)).toMatchObject({ code: "CHANGE_PENDING" });
    const line = await done("head", "target_changes.request", { employee_target_id: "Ada Nwosu: Stories published", to_value: "14", from_month: "2026-09-01", reason: "Two more stories" });
    expect(line.card.records).toEqual([expect.objectContaining({ type: "target", label: "Ada Nwosu: Stories published" })]);
    expect((await one("SELECT count(*)::int AS n FROM target_change WHERE status = 'pending'")).n).toBe(2);
    // Ada's own target is her reviewer's to change.
    expect(await refused("ada", "target_changes.request", { employee_target_id: line.card.values.employee_target_id, to_value: "8", from_month: "2026-09-01", reason: "Too many" }, 403)).toMatchObject({ code: "PERMISSION_DENIED" });

    const unbind = await done("head", "plans.unbind", { performance_plan_id: "Branding & Marketing", reason: "A new campaign changes the quarter" }, "Ask to unbind Branding & Marketing's plan.");
    expect(unbind.card).toMatchObject({ label: "Request To Unbind", schema: "goals.PlanUnbindRequest", values: { performance_plan_id: ids.plan } });
    expect(unbind.card.records).toEqual([expect.objectContaining({ type: "performance_plan", label: "Branding & Marketing · Q3 2026" })]);
    expect(await one("SELECT status FROM plan_unbind WHERE performance_plan_id = $1", [ids.plan])).toEqual({ status: "pending" });
    expect(await refused("head", "plans.unbind", { performance_plan_id: ids.plan, reason: "Again" }, 409)).toMatchObject({ code: "UNBIND_PENDING" });
  });

  test("rounds.open, check_ins.save and reviews.score: Open Round by the month's name; one line of Ada's check-in saved to the draft; one line scored by her reviewer after Confirm It's You", async () => {
    expect(await drawn("head", "rounds.open", { performance_period_id: ids.period, month: "2026-09-01" })).toBeNull();
    const round = await done("ops", "rounds.open", { performance_period_id: "Q3 2026", month: "September 2026" }, "Open September's round.");
    expect(round.card).toMatchObject({ label: "Open Round", schema: "reviews.RoundCreate", values: { performance_period_id: ids.period, month: "2026-09-01" } });
    expect(round.pressed.lines[0]).toMatchObject({ label: "September 2026", message: "opened" });
    ids.review = (await one("SELECT performance_review_id FROM performance_review WHERE employee_id = $1", [emp("ada")])).performance_review_id;
    // No line said: the lines of her own check-in she fills are asked (decision 34).
    const which = await askedFor("ada", "check_ins.save", { actual_value: "9" });
    expect(which).toMatchObject({ content: "Which line is it?" });
    expect(which.choices).toContain("Stories published");

    const checkIn = await done("ada", "check_ins.save", { performance_review_item_id: "Stories published", actual_value: "9", action_text: "Two stories moved to October", evidence_url: "https://mycity.test/stories" }, "Nine stories this month.");
    expect(checkIn.card).toMatchObject({ label: "Save Check-In", schema: "reviews.CheckInLineChange", records: [expect.objectContaining({ type: "review", id: ids.review, label: "My check-in, September 2026" })] });
    expect(checkIn.card.names).toEqual([expect.objectContaining({ type: "performance_review_item", label: "Stories published" })]);
    const item = await one("SELECT i.performance_review_item_id, trim_scale(i.actual_value)::text AS actual, i.action_text, i.evidence_kind, i.evidence_url FROM performance_review_item i JOIN employee_target t ON t.employee_target_id = i.employee_target_id WHERE i.performance_review_id = $1 AND t.title = 'Stories published'", [ids.review]);
    expect(item).toMatchObject({ actual: "9", action_text: "Two stories moved to October", evidence_kind: "link", evidence_url: "https://mycity.test/stories" });
    // A self score away from the proposed one needs its reason, said on the card's own field.
    const reason = await refused("ada", "check_ins.save", { performance_review_item_id: item.performance_review_item_id, self_score: "1" }, 422);
    expect(reason.fields).toEqual({ self_reason: ["Give a reason"] });
    expect((await h.as("ada").post("/ess/performance/check-in/submit").send({})).status).toBe(200);
    // No review said: those waiting on the head as reviewer, by person and month; then its lines.
    expect(await askedFor("head", "reviews.score", { score: "0.8" })).toMatchObject({ content: "Whose review is it?", choices: ["Ada Nwosu, September 2026"] });
    const line = await askedFor("head", "reviews.score", { performance_review_id: "Ada Nwosu, September 2026", score: "0.8" });
    expect(line).toMatchObject({ content: "Which line?" });
    expect(line.choices).toContain("Stories published");
    // An owner with no action, and an action with no due day: each asked once the card holds the rest.
    expect(await askedFor("head", "reviews.score", { performance_review_id: ids.review, performance_review_item_id: "Stories published", corrective_owner_id: emp("ada") })).toMatchObject({ content: "What is the corrective action?" });
    expect(await askedFor("head", "reviews.score", { performance_review_id: ids.review, performance_review_item_id: "Stories published", corrective_title: "Plan the stories a week ahead" })).toMatchObject({ content: "When is the action due?", choices: ["Next Friday", "In Two Weeks"] });

    const card = await drawn("head", "reviews.score", { performance_review_id: "Ada Nwosu", performance_review_item_id: "Stories published", score: "0.8", override_reason: "Two stories late", comment: "A good month otherwise" }, "Score Ada's stories 0.8.");
    expect(card).toMatchObject({ label: "Save Score", schema: "reviews.ReviewScoreChange", risk: "approval", confirm: "fresh_sign_in", values: { performance_review_id: ids.review, performance_review_item_id: item.performance_review_item_id }, problems: {} });
    expect(card.records).toEqual([expect.objectContaining({ type: "review", label: "Ada Nwosu, September 2026" })]);
    const others = (await q("SELECT performance_review_item_id, trim_scale(score)::text AS score FROM performance_review_item WHERE performance_review_id = $1 AND performance_review_item_id <> $2", [ids.review, item.performance_review_item_id])).rows;
    await h.stale("head");
    const stale = await h.press("head", card.ai_action_draft_id);
    expect([stale.status, stale.body.error.code]).toEqual([403, "REAUTH_REQUIRED"]);
    await h.confirmPassword("head");
    const pressed = await h.press("head", card.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines[0]).toMatchObject({ type: "review", message: "score saved" });
    expect(await one("SELECT trim_scale(score)::text AS score, override_reason, comment FROM performance_review_item WHERE performance_review_item_id = $1", [item.performance_review_item_id])).toEqual({ score: "0.8", override_reason: "Two stories late", comment: "A good month otherwise" });
    expect((await q("SELECT performance_review_item_id, trim_scale(score)::text AS score FROM performance_review_item WHERE performance_review_id = $1 AND performance_review_item_id <> $2", [ids.review, item.performance_review_item_id])).rows).toEqual(others);
    // Musa is not Ada's reviewer: the review's own rule refuses him.
    await h.confirmPassword("musa");
    const notHis = await drawn("musa", "reviews.score", { performance_review_id: ids.review, performance_review_item_id: item.performance_review_item_id, score: "1" });
    expect([404, 403]).toContain((await h.press("musa", notHis.ai_action_draft_id)).status);
  });

  test("pips.start and pips.edit: an improvement plan from Ada's closed review rated Below, its lines the ones scored under target, then changed by its person, each after Confirm It's You", async () => {
    await q("UPDATE performance_review SET status = 'closed', rating = 'below', closed_at = now() WHERE performance_review_id = $1", [ids.review]);
    expect(await drawn("head", "pips.start", { performance_review_id: ids.review, starts_on: "2026-11-09" })).toBeNull();
    // No review said: the closed reviews rated Below in scope; then the plan's first day.
    expect(await askedFor("ops", "pips.start", { starts_on: "2026-11-09" })).toMatchObject({ content: "Whose review is it from?", choices: ["Ada Nwosu, September 2026"] });
    expect(await askedFor("ops", "pips.start", { performance_review_id: "Ada Nwosu" })).toMatchObject({ content: "When does the plan start?", choices: ["Today", "Next Monday"] });
    const card = await drawn("ops", "pips.start", { performance_review_id: "Ada Nwosu", starts_on: "2026-11-09", summary: "Thirty days to steady the stories" }, "Start a PIP for Ada.");
    expect(card).toMatchObject({ label: "Start PIP", schema: "reviews.PipStart", risk: "approval", values: { performance_review_id: ids.review }, problems: {} });
    expect(card.records).toEqual([expect.objectContaining({ type: "review", label: "Ada Nwosu, September 2026" })]);
    await h.confirmPassword("ops");
    const started = await h.press("ops", card.ai_action_draft_id);
    expect(started.status).toBe(200);
    expect(started.body.lines[0]).toMatchObject({ type: "improvement_plan", label: "Ada Nwosu's plan", message: "started" });
    ids.pip = started.body.lines[0].id;
    const lines = (await q("SELECT text, employee_target_id FROM improvement_plan_line WHERE improvement_plan_id = $1 ORDER BY position", [ids.pip])).rows;
    expect(lines.map((l) => l.text)).toEqual(["Stories published"]);
    expect(lines[0].employee_target_id).not.toBeNull();
    expect((await one("SELECT count(*)::int AS n FROM task WHERE entity_type = 'improvement_plan' AND entity_id = $1", [ids.pip])).n).toBe(1);

    const edit = await drawn("ops", "pips.edit", { improvement_plan_id: "Ada Nwosu", review_on: "2026-12-04", lines: ["Stories published", "Publish two city guides"] }, "Add a line to Ada's plan.");
    expect(edit).toMatchObject({ label: "Save PIP", schema: "reviews.PipChange", values: { improvement_plan_id: ids.pip }, records: [expect.objectContaining({ label: "Ada Nwosu's plan" })] });
    await h.confirmPassword("ops");
    expect((await h.press("ops", edit.ai_action_draft_id)).status).toBe(200);
    const after = (await q("SELECT text, employee_target_id FROM improvement_plan_line WHERE improvement_plan_id = $1 ORDER BY position", [ids.pip])).rows;
    expect(after.map((l) => l.text)).toEqual(["Stories published", "Publish two city guides"]);
    // The line kept by its words keeps its scorecard line; the new one has none.
    expect([after[0].employee_target_id, after[1].employee_target_id]).toEqual([lines[0].employee_target_id, null]);
    expect(await one("SELECT to_char(review_on, 'YYYY-MM-DD') AS review_on FROM improvement_plan WHERE improvement_plan_id = $1", [ids.pip])).toEqual({ review_on: "2026-12-04" });
  });

  test("scorecards.edit: Change Reviewer through the scorecard's own update, held to performance.manage by its rule", async () => {
    const changed = await done("ops", "scorecards.edit", { scorecard_id: "Ada Nwosu", reviewer_employee_id: emp("musa"), reviewer_reason: "Musa leads the stories desk" }, "Make Musa Ada's reviewer.");
    expect(changed.card).toMatchObject({ label: "Change Reviewer", schema: "targets.ScorecardChange", values: { scorecard_id: ids.card } });
    expect(changed.card.names).toEqual([expect.objectContaining({ type: "employee", label: "Musa Danjuma" })]);
    expect(await one("SELECT reviewer_employee_id, reviewer_reason FROM scorecard WHERE scorecard_id = $1", [ids.card])).toEqual({ reviewer_employee_id: emp("musa"), reviewer_reason: "Musa leads the stories desk" });
    expect(await refused("head", "scorecards.edit", { scorecard_id: ids.card, reviewer_employee_id: emp("head"), reviewer_reason: "Me" }, 403)).toMatchObject({ code: "CAPABILITY_REQUIRED" });
    // A new reviewer with no reason: the reason is asked first, as the form asks Give a reason (decision 34).
    expect(await askedFor("ops", "scorecards.edit", { scorecard_id: ids.card, reviewer_employee_id: emp("musa") })).toMatchObject({ content: "Why change the reviewer?" });
  });

  test("a figure written with its unit or words (95%, 40 stories, 60%) is read as its number; one with no number or two stays as written, marked", async () => {
    const kpi = await drawn("head", "kpis.create", { department_id: ids.bm, name: "Briefs on time", target_text: "95% on time", target_value: "95%" });
    expect(kpi).toMatchObject({ values: { target_value: "95" }, problems: {} });
    const change = await drawn("head", "target_changes.request", { okr_key_result_id: "BM-KR1.1", to_value: "40 stories", from_month: "2026-09-01", reason: "The desk grew" });
    expect(change.values).toMatchObject({ to_value: "40" });
    const line = await drawn("head", "scorecards.add_line", { scorecard_id: ids.card, section: "results", title: "Guides written", measure: "numeric", target_value: "12 guides", weight: "10%" });
    expect(line.values).toMatchObject({ target_value: "12", weight: "10" });
    const unclear = await drawn("head", "kpis.create", { department_id: ids.bm, name: "Briefs on time", target_text: "95% on time", target_value: "between 90 and 95" });
    expect(unclear.problems).toEqual({ target_value: ["Like 64000 or 0.95"] });
  });

  test("the evaluation fills its questions from the asker's own records on the real migrations, and says what staging lacks", async () => {
    const evaluation = require("../../scripts/ai/eval-assistant");
    const asker = async (who) => {
      const u = await require("../../src/shared/rbac/grants-cache").getAuthUser(pool, h.people[who].user_id);
      return { user_id: u.user_id, employee_id: u.employee_id, email: u.email, display_name: u.display_name, role_ids: u.role_ids || [], is_ceo: u.is_ceo === true };
    };
    const head = await asker("head");
    const ops = await asker("ops");
    // Every fill's query runs here as it would on staging, whatever it finds.
    for (const [name, f] of Object.entries(evaluation.FILLS)) {
      const got = await f.find(pool, head);
      expect([name, got === null || typeof got === "string"]).toEqual([name, true]);
    }
    // The head's own report, never someone outside their team; a card's answer, as its question offers it.
    expect(await evaluation.FILLS.person.find(pool, head)).toMatch(/^(Ada Nwosu|Musa Danjuma)$/);
    const kase = (id) => evaluation.CASES.find((k) => k.id === id);
    expect(await evaluation.fill(pool, kase("card.quarter-edit"), ops)).toEqual({ question: "Rename Q3 2026 to The Big Push." });
    expect(await evaluation.fill(pool, kase("card.reviewer"), ops)).toEqual({ question: "Make me the reviewer on the scorecard Ada Nwosu, Q3 2026: their manager is on leave." });
    expect(await evaluation.fill(pool, kase("card.pip-edit"), ops)).toEqual({ question: "Move the review date of Ada Nwosu's plan to 4 December." });
    // A key result of a binding plan is not Save Key Result's to change: the question is skipped, saying why.
    expect(await evaluation.fill(pool, kase("card.key-result-edit"), head)).toEqual({ missing: "answer to key_results.edit's okr_key_result_id question" });
    expect(await evaluation.fill(pool, kase("card.message-edit"), head)).toEqual({ missing: "channel with a message of theirs" });
  });

  test("a Performance card naming no record asks which first, with the person's own to tap; the answer tapped is matched by its words (decision 34)", async () => {
    // Save Quarter: the quarters not yet closed, by name.
    const quarter = await askedFor("ops", "quarters.edit", { name: "The third quarter" });
    expect(quarter).toMatchObject({ content: "Which quarter?" });
    expect(quarter.choices).toContain("Q3 2026");
    expect(await drawn("ops", "quarters.edit", { performance_period_id: "Q3 2026", name: "The third quarter" })).toMatchObject({ values: { performance_period_id: ids.period }, problems: {} });

    // Save KPI: the KPIs of the functions the head sets, by code and name, the one tapped matched.
    const kpi = await askedFor("head", "kpis.edit", { formula: "Assets on time over all assets" });
    expect(kpi).toMatchObject({ content: "Which KPI?", choices: ["BM-K01 Assets on time"] });
    expect(await drawn("head", "kpis.edit", { kpi_definition_id: kpi.choices[0], formula: "Assets on time over all assets" })).toMatchObject({ values: { kpi_definition_id: ids.kpi }, problems: {} });

    // Draft Scorecard: the people in the head's team, never the head; a name tapped is matched.
    const whom = await askedFor("head", "scorecards.create", { performance_period_id: "Q3 2026" });
    expect(whom).toMatchObject({ content: "Who is it for?" });
    expect(whom.choices).toEqual(expect.arrayContaining(["Ada Nwosu", "Musa Danjuma"]));
    expect(whom.choices).not.toContain("Tolu Ade");
    expect(await drawn("head", "scorecards.create", { employee_id: "Musa Danjuma", performance_period_id: "Q3 2026" })).toMatchObject({ values: { employee_id: emp("musa"), performance_period_id: ids.period }, problems: {} });

    // Change Reviewer: this quarter's scorecards, by person and quarter.
    const card = await askedFor("ops", "scorecards.edit", { reviewer_employee_id: emp("head"), reviewer_reason: "Tolu leads the desk" });
    expect(card).toMatchObject({ content: "Whose scorecard is it?" });
    expect(card.choices).toContain("Ada Nwosu, Q3 2026");
    expect(await drawn("ops", "scorecards.edit", { scorecard_id: "Ada Nwosu, Q3 2026", reviewer_employee_id: emp("head"), reviewer_reason: "Tolu leads the desk" })).toMatchObject({ values: { scorecard_id: ids.card }, problems: {} });

    // Add Line: its section, then the measures that section takes, each written as the screen names it.
    expect(await askedFor("head", "scorecards.add_line", { scorecard_id: ids.card, title: "Guides written", weight: "10" })).toMatchObject({ content: "Which section is it in?", choices: ["Results", "KPIs", "Accountability"] });
    expect(await askedFor("head", "scorecards.add_line", { scorecard_id: ids.card, title: "Guides written", section: "kpis", weight: "10" })).toMatchObject({ content: "How is it measured?", choices: ["Standard", "Yes or No"] });
    expect((await drawn("head", "scorecards.add_line", { scorecard_id: ids.card, title: "Guides written", section: "KPIs", measure: "Yes or No", weight: "10" })).values).toMatchObject({ section: "kpis", measure: "binary" });

    // Share Objective: who sees it, then which departments only for chosen departments, matched by name.
    expect(await askedFor("ops", "objectives.share", { okr_objective_id: "CO-O1" })).toMatchObject({ content: "Who should see it?", choices: ["All Staff", "Departments"] });
    const departments = await askedFor("ops", "objectives.share", { okr_objective_id: "CO-O1", audience: "departments" });
    expect(departments).toMatchObject({ content: "Which departments?" });
    expect(departments.choices).toContain("Branding & Marketing");
    expect(await drawn("ops", "objectives.share", { okr_objective_id: "CO-O1", audience: "departments", department_ids: ["Branding & Marketing"] })).toMatchObject({ values: { department_ids: [ids.bm] }, problems: {} });

    // Change Target: the month it applies from, this month and the next to tap, read as its first day.
    const month = await askedFor("head", "target_changes.request", { okr_key_result_id: "BM-KR1.1", to_value: "40", reason: "The desk grew" });
    expect(month).toMatchObject({ content: "From which month?" });
    expect(month.choices).toHaveLength(2);
    const next = lagos.addMonths(`${lagos.today().slice(0, 7)}-01`, 1);
    expect((await drawn("head", "target_changes.request", { okr_key_result_id: "BM-KR1.1", to_value: "40", reason: "The desk grew", from_month: month.choices[1] })).values).toMatchObject({ from_month: next });

    // Save PIP: the running plans in scope, by person.
    expect(await askedFor("ops", "pips.edit", { summary: "Steady the stories" })).toMatchObject({ content: "Whose plan is it?", choices: ["Ada Nwosu's plan"] });
  });
});
