"use strict";
/**
 * Charts in the Overview, PR 5 on the real migrations (docs/guides/praxis-ai.md §6.13 Recruitment and
 * onboarding, §6.19 item 9): `vacancies.summary`, `candidates.summary`, `interviews.summary`,
 * `assessments.summary`, `offers.summary`, `onboarding.summary` and `talent_pool.summary` answer the
 * CEO with figures and never a row; a head of department's figures are their own vacancies' (and, for
 * interviews, their seats on a panel); a member of staff without Recruitment is refused; an offer's
 * pay is left out for a role that does not see pay, never zero; a part only some rows have is drawn
 * only where one does; a period narrows a summary only when asked; the reads name their summaries.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/ai-summaries-recruitment
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public schema.
 * Every person here is invented.
 */
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
const grantsCache = require("../../src/shared/rbac/grants-cache");
const authorise = require("../../src/shared/ai/authorise");
const registry = require("../../src/shared/ai/registry");
const engine = require("../../src/services/ai/engine");
const lagos = require("../../src/shared/time/lagos");
const { vacancyFor, applicationFor } = require("../../src/modules/vacancies/vacancies.matrix");
const authoring = require("../../src/modules/assessments/assessments.authoring");
const sittings = require("../../src/modules/assessments/assessments.service");
const { q, one, drain, harness } = require("./helpers/ai-actions");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const SUMMARIES = ["vacancies.summary", "candidates.summary", "interviews.summary", "assessments.summary", "offers.summary", "onboarding.summary", "talent_pool.summary"];

describeDb("Recruitment and onboarding summaries against the real migrations", () => {
  let h;
  const dept = {};
  const v = {};
  const app = {};

  const userOf = (who) => grantsCache.getAuthUser(pool, h.people[who].user_id);
  const summaryOf = async (who, key, params = {}) => (await authorise.runSummary(pool, await userOf(who), key, params)).result;
  const figuresOf = (result) => Object.fromEntries(result.figures.map((x) => [x.key, x.value]));
  const groupOf = (result, by) => result.groups.find((g) => g.by === by);
  const ALL = { scope: "all", scope_ids: null };

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    const { app: server } = buildApp({ strict: true, accessLog: false });
    h = harness(server);
    await h.makePeople([
      { who: "ceo", first: "Amaka", last: "Eze", email: "ceo@mycity.test", job: "Chief Executive Officer", role: "management", ceo: true, password: "Chief#Officer26" },
      { who: "ops", first: "Ada", last: "Obi", email: "ops@mycity.test", job: "Operations & People Lead", role: "operations_people", password: "Opera!ions2026", department: "Operations" },
      { who: "head", first: "Kemi", last: "Alade", email: "head@mycity.test", job: "Head of Programmes", role: "head_of_department", password: "Programme#Lead2026", department: "Programmes" },
      { who: "staff", first: "Musa", last: "Danjuma", email: "staff@mycity.test", job: "Field Officer", role: "employee", password: "Field#Officer2026", department: "Programmes" },
    ]);
    dept.programmes = (await one("SELECT department_id FROM employee WHERE employee_id = $1", [h.people.head.employee_id])).department_id;
    dept.operations = (await one("SELECT department_id FROM employee WHERE employee_id = $1", [h.people.ops.employee_id])).department_id;
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [h.people.head.employee_id, h.people.staff.employee_id]);
    await grantsCache.bumpTeamVersion();
    const ops = await userOf("ops");

    // Three roles: the head's open one in Programmes, two of Operations', one paused and one closed.
    v.officer = await vacancyFor(ops, h.people.head.employee_id, "Programme Officer");
    v.sales = await vacancyFor(ops, h.people.ops.employee_id, "Sales Lead");
    v.driver = await vacancyFor(ops, h.people.ops.employee_id, "Driver");
    await q("UPDATE vacancy SET department_id = $2 WHERE vacancy_id = $1", [v.officer.vacancy_id, dept.programmes]);
    await q("UPDATE vacancy SET department_id = $2 WHERE vacancy_id = ANY($1::uuid[])", [[v.sales.vacancy_id, v.driver.vacancy_id], dept.operations]);
    await q("UPDATE vacancy SET status = 'paused', paused_at = now() WHERE vacancy_id = $1", [v.sales.vacancy_id]);
    await q("UPDATE vacancy SET status = 'closed', closed_at = now(), close_reason = 'cancelled' WHERE vacancy_id = $1", [v.driver.vacancy_id]);

    // Six applications: four to the head's role (applied, at interview, not progressing, hired), two to Sales.
    for (const [key, vacancy] of [["new", v.officer], ["interview", v.officer], ["ended", v.officer], ["hired", v.officer], ["screening", v.sales], ["offer", v.sales]])
      app[key] = await applicationFor(vacancy, `Summary ${key}`);

    // Two sittings of one assessment, through the sittings' own send; one scored.
    const made = await authoring.create(ops, { name: "Writing Test", assessment_type: "technical", duration_minutes: 30, instructions: "Write a short note about a Lagos venue for the summaries suite." });
    await authoring.saveQuestions(ops, made.assessment_definition_id, { questions: [{ question_type: "text", prompt: "Write the note here.", max_score: 10 }] });
    await authoring.activate(ops, made.assessment_definition_id);
    const sent = [];
    for (const a of [app.new, app.screening])
      sent.push(await sittings.send(ops, ALL, { application_id: a.application_id, assessment_definition_id: made.assessment_definition_id, start_within_days: 3 }));
    await q("UPDATE application_assessment SET status = 'scored', score = 80, started_at = now() - interval '1 hour', submitted_at = now(), scored_at = now() WHERE application_assessment_id = $1", [sent[0].application_assessment_id]);

    // Where each application stands now.
    const stand = (a, stage, status = "active") => q("UPDATE application SET stage = $2, status = $3 WHERE application_id = $1", [a.application_id, stage, status]);
    await stand(app.new, "application");
    await stand(app.interview, "interview");
    await stand(app.ended, "screening", "not_progressed");
    await stand(app.hired, "hired", "hired");
    await stand(app.screening, "screening");
    await stand(app.offer, "offer");

    // Three interviews: one past its end with a card still to come, one upcoming, one held and reported Select.
    const interview = async (a, { start, end, round = "open", status = "scheduled", decision = null, panel }) => {
      const r = await one(
        `INSERT INTO interview_round (application_id, round_number, title, status, decision, closed_at)
         VALUES ($1, 1, 'First Interview', $2, $3, CASE WHEN $2 = 'closed' THEN now() END) RETURNING interview_round_id`,
        [a.application_id, round, decision],
      );
      const i = await one(
        `INSERT INTO interview (interview_round_id, interview_type, scheduled_start, scheduled_end, status, created_by)
         VALUES ($1, 'video', now() + $2::interval, now() + $3::interval, $4, $5) RETURNING interview_id`,
        [r.interview_round_id, start, end, status, h.people.ops.user_id],
      );
      for (const [who, submitted] of panel)
        await q("INSERT INTO interview_panelist (interview_id, employee_id, submitted_at) VALUES ($1, $2, CASE WHEN $3 THEN now() END)", [i.interview_id, h.people[who].employee_id, submitted]);
    };
    await interview(app.interview, { start: "-2 hours", end: "-1 hour", panel: [["head", false], ["ops", true]] });
    await interview(app.screening, { start: "2 days", end: "2 days 1 hour", panel: [["ops", false]] });
    await interview(app.hired, { start: "-240 hours", end: "-239 hours", round: "closed", status: "done", decision: "select", panel: [["ops", true]] });

    // Two offers: Sales' with the candidate (outside its range), the hire's accepted.
    const offer = async (a, number, status, department, pay, outside) =>
      one(
        `INSERT INTO offer (application_id, number, job_title, currency, annual_compensation, created_by, status, department_id, outside_range,
                            sent_at, accepted_at)
         VALUES ($1, $2, 'The Role', 'NGN', $3, $4, $5, $6, $7, now() - interval '3 days', CASE WHEN $5 = 'accepted' THEN now() END)
         RETURNING offer_id`,
        [a.application_id, number, pay, h.people.ops.user_id, status, department, outside],
      );
    const salesOffer = await offer(app.offer, "OFF-0901", "sent", dept.operations, "6000000.00", true);
    const hireOffer = await offer(app.hired, "OFF-0902", "accepted", dept.programmes, "4800000.00", false);

    // Two cases: the hire's at onboarding owned by the head, starting within a week; one at documentation owing a document.
    await q("INSERT INTO onboarding_case (application_id, offer_id, owner_id, status, starts_on) VALUES ($1, $2, $3, 'onboarding', $4)", [
      app.hired.application_id,
      hireOffer.offer_id,
      h.people.head.employee_id,
      lagos.addDays(lagos.today(), 7),
    ]);
    const docCase = await one("INSERT INTO onboarding_case (application_id, offer_id, owner_id, status, starts_on) VALUES ($1, $2, $3, 'documentation', $4) RETURNING onboarding_case_id", [
      app.offer.application_id,
      salesOffer.offer_id,
      h.people.ops.employee_id,
      lagos.addDays(lagos.today(), 40),
    ]);
    await q("INSERT INTO onboarding_checklist_item (onboarding_case_id, title, status) VALUES ($1, 'Passport Photograph', 'pending')", [docCase.onboarding_case_id]);

    // Two kept for later: one from the head's role leaving within 30 days, one from Sales invited back; one reason in two spellings.
    await q(
      `INSERT INTO talent_pool_entry (candidate_id, application_id, reason, added_by, expires_at)
       VALUES ($1, $2, 'Strong writer', $3, now() + interval '20 days')`,
      [app.ended.candidate_id, app.ended.application_id, h.people.ops.user_id],
    );
    await q(
      `INSERT INTO talent_pool_entry (candidate_id, application_id, reason, added_by, expires_at, invited_at, invited_vacancy_id)
       VALUES ($1, $2, ' strong writer ', $3, now() + interval '24 months', now(), $4)`,
      [app.screening.candidate_id, app.screening.application_id, h.people.ops.user_id, v.officer.vacancy_id],
    );
    await drain();
  }, 180_000);

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("each summary answers the CEO with figures and never a row", async () => {
    for (const key of SUMMARIES) {
      const res = await authorise.runSummary(pool, await userOf("ceo"), key, {});
      expect([key, c.assistant.AiSummaryResult.safeParse(res.result).success]).toEqual([key, true]);
      expect([key, "data" in res, "rows" in res.result]).toEqual([key, false, false]);
    }
  });

  test("vacancies.summary: the CEO's by status and department, stacked Open, Paused, Closed with no Drafts part; the head's are their own role's", async () => {
    const all = await summaryOf("ceo", "vacancies.summary");
    expect(figuresOf(all)).toMatchObject({ vacancies: 3, open: 1, paused: 1, closed: 1, draft: 0, applicants: 6 });
    expect(groupOf(all, "status").rows.map((r) => [r.label, r.value])).toEqual([["Open", 1], ["Paused", 1], ["Closed", 1]]);
    const operations = groupOf(all, "department").rows.find((r) => r.key === dept.operations);
    // No vacancy is a draft, so the legend never names Drafts.
    expect(operations.parts.map((p) => [p.label, p.value])).toEqual([["Open", 0], ["Paused", 1], ["Closed", 1]]);
    expect(operations.value).toBe(2);
    expect(groupOf(all, "applicants").rows[0]).toMatchObject({ key: v.officer.vacancy_id, value: 4 });
    expect(all.series[0].points.length).toBe(1);
    const byManager = await summaryOf("ceo", "vacancies.summary", { by: "hiring_manager" });
    expect(groupOf(byManager, "hiring_manager").rows.map((r) => r.label).sort()).toEqual(["Ada Obi", "Kemi Alade"]);
    const head = await summaryOf("head", "vacancies.summary");
    expect([head.total, figuresOf(head).applicants]).toEqual([1, 4]);
  });

  test("candidates.summary: the funnel in the pipeline's order, each vacancy stacked by stage group, Ended where some row has one", async () => {
    const all = await summaryOf("ceo", "candidates.summary");
    expect(figuresOf(all)).toMatchObject({ candidates: 6, active: 4, hired: 1, not_progressed: 1, withdrawn: 0 });
    const stages = groupOf(all, "stage").rows;
    expect(stages.map((r) => r.key)).toEqual(["application", "screening", "assessment", "interview", "shortlist", "offer", "documentation", "pre_onboarding", "onboarding", "hired"]);
    expect(Object.fromEntries(stages.map((r) => [r.key, r.value]))).toMatchObject({ application: 1, screening: 1, interview: 1, offer: 1, hired: 1 });
    const officer = groupOf(all, "vacancy").rows.find((r) => r.key === v.officer.vacancy_id);
    expect(officer.parts.map((p) => [p.label, p.value])).toEqual([["Screening", 1], ["Assessment", 0], ["Interview", 1], ["Offer", 0], ["Hired", 1], ["Ended", 1]]);
    expect(groupOf(all, "source").rows).toEqual([expect.objectContaining({ label: "Careers Page", value: 6 })]);
    // The parts reach the pane as a stacked bar, one series a part.
    const o = engine.pane.overviewOf(
      { summary: "candidates.summary", figures: ["candidates", "active", "hired"], chart: { kind: "stacked_bar", title: "Candidates by vacancy", group: "vacancy" } },
      [{ n: 1, key: "candidates.summary", kind: "summary", ok: true, result: all }],
    );
    expect(() => c.assistant.AiOverview.parse(o)).not.toThrow();
    expect(o.chart.series.map((s) => s.label)).toEqual(["Screening", "Assessment", "Interview", "Offer", "Hired", "Ended"]);
    const weekly = await summaryOf("ceo", "candidates.summary", { by: "week" });
    expect(weekly.series[0].label).toBe("Applications by week");
    const head = await summaryOf("head", "candidates.summary");
    expect(head.total).toBe(4);
  });

  test("interviews.summary: by status, the held ones by outcome, each interviewer's cards; the head sees their roles' and their seats", async () => {
    const all = await summaryOf("ceo", "interviews.summary");
    expect(figuresOf(all)).toMatchObject({ interviews: 3, upcoming: 1, awaiting_feedback: 1, held: 1, cancelled: 0, selected: 1 });
    expect(groupOf(all, "status").rows.map((r) => [r.label, r.value])).toEqual([["Upcoming", 1], ["Awaiting Feedback", 1], ["Held", 1]]);
    expect(groupOf(all, "outcome").rows.map((r) => [r.label, r.value])).toEqual([["Select", 1]]);
    const cards = Object.fromEntries(groupOf(all, "interviewer").rows.map((r) => [r.label, r.parts.map((p) => p.value)]));
    expect(cards).toEqual({ "Ada Obi": [2, 1], "Kemi Alade": [0, 1] });
    const head = await summaryOf("head", "interviews.summary");
    expect(head.total).toBe(2);
    expect((await summaryOf("head", "interviews.summary", { mine: "true" })).total).toBe(1);
  });

  test("assessments.summary: the average score by assessment over its scored sittings; the head's are their role's", async () => {
    const all = await summaryOf("ceo", "assessments.summary");
    expect(figuresOf(all)).toMatchObject({ sittings: 2, not_started: 1, scored: 1, average_score: 80 });
    expect(groupOf(all, "assessment").rows).toEqual([expect.objectContaining({ label: "Writing Test", value: 80, count: 1 })]);
    expect((await summaryOf("head", "assessments.summary")).total).toBe(1);
  });

  test("offers.summary: by status and outcome, the pay in naira for a role that sees pay and left out, never zero, for one that does not", async () => {
    const all = await summaryOf("ceo", "offers.summary");
    const f = figuresOf(all);
    expect(f).toMatchObject({ offers: 2, sent: 2, accepted: 1, acceptance_rate: 100, outside_range: 1, accepted_pay: "4800000.00", average_pay: "5400000.00" });
    const operations = groupOf(all, "department").rows.find((r) => r.key === dept.operations);
    expect(operations.parts.map((p) => [p.label, p.value])).toEqual([["Accepted", 0], ["Declined", 0], ["Waiting", 1]]);
    const head = await summaryOf("head", "offers.summary");
    expect(head.total).toBe(1);
    expect(head.figures.map((x) => x.key)).toEqual(expect.arrayContaining(["offers", "accepted", "acceptance_rate"]));
    expect(head.figures.map((x) => x.key)).not.toContain("accepted_pay");
    expect(head.figures.map((x) => x.key)).not.toContain("average_pay");
  });

  test("onboarding.summary: cases by status, by department stacked, starting soon and documents outstanding; the head's are the cases they own", async () => {
    const all = await summaryOf("ceo", "onboarding.summary");
    expect(figuresOf(all)).toMatchObject({ cases: 2, documentation: 1, onboarding: 1, starting_soon: 1, outstanding: 1 });
    const programmes = groupOf(all, "department").rows.find((r) => r.key === dept.programmes);
    expect(programmes.parts.map((p) => p.label)).toEqual(["Documentation", "Pre-Onboarding", "Onboarding", "Completed"]);
    expect((await summaryOf("head", "onboarding.summary")).total).toBe(1);
  });

  test("talent_pool.summary: by role and by why kept, one reason in two spellings one row; the head's are their role's", async () => {
    const all = await summaryOf("ceo", "talent_pool.summary");
    expect(figuresOf(all)).toMatchObject({ kept: 2, invited: 1, leaving_soon: 1 });
    expect(groupOf(all, "reason").rows).toEqual([expect.objectContaining({ key: "strong writer", value: 2 })]);
    expect((await summaryOf("head", "talent_pool.summary")).total).toBe(1);
  });

  test("a period narrows a summary only when asked: a month long past counts nothing", async () => {
    const lastYear = `${Number(lagos.today().slice(0, 4)) - 1}-01`;
    for (const key of ["vacancies.summary", "candidates.summary", "interviews.summary", "assessments.summary", "offers.summary", "talent_pool.summary"])
      expect([key, (await summaryOf("ceo", key, { month: lastYear })).total]).toEqual([key, 0]);
  });

  test("a member of staff without Recruitment is refused every one", async () => {
    const staff = await userOf("staff");
    for (const key of SUMMARIES) await expect(authorise.runSummary(pool, staff, key, {})).rejects.toMatchObject({ code: "AI_READ_FORBIDDEN" });
  });

  test("every read names its summary: the recruitment lists name theirs, and none waits in the gaps file", () => {
    const named = {
      "vacancies.list": "vacancies.summary",
      "candidates.list": "candidates.summary",
      "interviews.list": "interviews.summary",
      "assessments.sittings": "assessments.summary",
      "offers.list": "offers.summary",
      "onboarding.list": "onboarding.summary",
      "talent_pool.list": "talent_pool.summary",
    };
    for (const [read, summary] of Object.entries(named)) expect([read, registry.read(read).summary]).toEqual([read, summary]);
    const gaps = require("../../scripts/check/ai-summary-gaps.json").gaps.map((g) => g.read);
    expect(gaps.filter((r) => r in named)).toEqual([]);
  });
});
