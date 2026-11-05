"use strict";
/**
 * Recruitment · Assessments end to end (docs/guides/recruitment.md §3 step 7, §6.7): the library,
 * sittings, the public page and its clock, marking and scoring, on the real migrations through
 * HTTP, every response parsed with its contract (APP_ENV=test). The mail queue is mocked.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/recruitment-assessments
 *
 * Refuses to run unless the database name ends in "_test". Every person here is invented.
 */
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(() => ({ getDelayed: async () => [] })),
  closeQueues: jest.fn(async () => {}),
  DEFAULTS: {},
}));

const queues = require("../../src/jobs/queues");
const { rebuild } = require("./helpers/schema");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const lagos = require("../../src/shared/time/lagos");
const token = require("../../src/shared/places/token");
const timer = require("../../src/modules/assessments/assessments.timer");
const { q, one, drain, harness } = require("./helpers/ai-actions");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const area = (formatted) =>
  token.sign({ source: "search", formatted, lat: 6.45, lon: 3.42, provider_id: `test:${formatted}`, kind: "area", city: "Lagos", state: "Lagos", country_code: "ng", timezone: "Africa/Lagos", verified: true, pending: false });

/** The newest assessment link mailed, as the token in its address. */
const lastLink = () => {
  const calls = queues.enqueue.mock.calls.filter((c) => c[0] === "email-send" && c[1] === "assessment-invite");
  return calls[calls.length - 1][2].data.assess_url.split("/assess/")[1];
};

describeDb("Recruitment · Assessments against the real migrations", () => {
  let app;
  let h;
  let vacancyId;
  let applicationId;
  let otherApplicationId;
  let briefId;
  const pub = () => ({
    get: (path) => request(app).get(`/api/public/v1${path}`).set("X-Forwarded-For", h.nextIp()),
    post: (path) => request(app).post(`/api/public/v1${path}`).set("X-Forwarded-For", h.nextIp()),
    put: (path) => request(app).put(`/api/public/v1${path}`).set("X-Forwarded-For", h.nextIp()),
  });

  /** An application made straight in the table, at a stage: Apply itself is tested in recruitment-candidates. */
  async function applicant(first, email, stage) {
    const k = await one("INSERT INTO candidate (first_name, last_name, email) VALUES ($1, 'Adeyemi', $2) RETURNING candidate_id", [first, email]);
    const n = (await one("SELECT count(*)::int AS n FROM application")).n + 1;
    const a = await one(
      "INSERT INTO application (number, vacancy_id, candidate_id, source, stage, status) VALUES ($1, $2, $3, 'careers', $4, 'active') RETURNING application_id",
      [`APP-${String(n).padStart(4, "0")}`, vacancyId, k.candidate_id, stage],
    );
    return a.application_id;
  }

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    h = harness(app);
    await h.makePeople([
      { who: "ops", first: "Ada", last: "Obi", email: "ops@mycity.test", job: "Operations & People Lead", role: "operations_people", password: "Opera!ions2026", department: "Operations" },
      { who: "hod", first: "Ife", last: "Ojo", email: "hod@mycity.test", job: "Head of Programmes", role: "head_of_department", password: "Head#Programmes26", department: "Programmes" },
    ]);
    await grantsCache.bumpTeamVersion();
    await drain();
    const dept = (await one("SELECT department_id FROM department WHERE name = 'Operations'")).department_id;
    const made = await h.as("ops").post("/recruitment/vacancies").send({
      title: "Graphics Designer",
      department_id: dept,
      hiring_manager_id: h.people.ops.employee_id,
      positions: 1,
      employment_type: "full_time",
      work_pattern: "on_site",
      location: { token: area("Ikeja, Lagos") },
      description: "The Graphics Designer makes the posters, motion pieces and campaign art that put Lagos events in front of MyCityApp users.",
      requirements: "Three years of brand and motion design, and a portfolio.",
      closes_on: lagos.addDays(lagos.today(), 30),
      publish: true,
    });
    vacancyId = made.body.vacancy_id;
    applicationId = await applicant("Bisi", "bisi.adeyemi@example.test", "assessment");
    otherApplicationId = await applicant("Femi", "femi.adeyemi@example.test", "assessment");
  }, 120_000);

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  afterEach(() => jest.restoreAllMocks());

  test("the library: an assessment starts off, needs a question to go on, and keeps each option's points out of its options", async () => {
    const made = await h.as("ops").post("/recruitment/assessments").send({
      name: "Design Fundamentals",
      assessment_type: "technical",
      duration_minutes: 30,
      instructions: "Answer each question in your own words. You have thirty minutes.",
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ code: "ASM-0001", active: false, scoring_method: "manual", duration_minutes: 30, in_use: false });
    briefId = made.body.assessment_definition_id;
    expect((await h.as("ops").post(`/recruitment/assessments/${briefId}/activate`).send({})).status).toBe(422);

    const saved = await h.as("ops").put(`/recruitment/assessments/${briefId}/questions`).send({
      questions: [
        { question_type: "choice", prompt: "Which file format keeps a logo sharp at any size?", options: [{ text: "SVG", points: 2 }, { text: "JPEG", points: 0 }, { text: "GIF", points: 0 }] },
        { question_type: "text", prompt: "Explain how you would build a colour palette for a night event poster.", max_score: 10 },
        { question_type: "file", prompt: "Upload a poster you designed, or a link to it.", max_score: 8 },
      ],
    });
    expect(saved.status).toBe(200);
    expect(saved.body.scoring_method).toBe("mixed");
    expect(saved.body.questions.map((x) => x.max_score)).toEqual([2, 10, 8]);
    expect(saved.body.questions[0].options.map((o) => o.points)).toEqual([2, 0, 0]);
    const stored = await one("SELECT options::text AS options, answer_key_enc FROM assessment_question WHERE question_type = 'choice'");
    expect(stored.options).not.toContain("points");
    expect(stored.answer_key_enc).not.toContain("SVG");

    const on = await h.as("ops").post(`/recruitment/assessments/${briefId}/activate`).send({});
    expect(on.body.active).toBe(true);
  });

  test("Export and Import carry an assessment to another environment as a new one, switched off", async () => {
    const file = await h.as("ops").get(`/recruitment/assessments/${briefId}/export`);
    expect(file.status).toBe(200);
    expect(file.headers["content-disposition"]).toMatch(/attachment; filename="design-fundamentals.json"/);
    expect(file.body.questions[0]).toEqual({ question_type: "choice", prompt: "Which file format keeps a logo sharp at any size?", options: expect.any(Array) });
    const copy = await h.as("ops").post("/recruitment/assessments/import").send({ ...file.body, name: "Design Fundamentals II" });
    expect(copy.status).toBe(201);
    expect(copy.body).toMatchObject({ code: "ASM-0002", active: false, question_count: 3 });
    expect(copy.body.questions[0].options.map((o) => o.points)).toEqual([2, 0, 0]);
    expect((await h.as("ops").post("/recruitment/assessments/import").send({ ...file.body, format: "something-else" })).status).toBe(422);
  });

  test("Send makes one live sitting a candidate; the link is mailed after commit and the questions are then fixed", async () => {
    const sent = await h.as("ops").post("/recruitment/assessments/sittings").send({ application_id: applicationId, assessment_definition_id: briefId });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ status: "sent", start_by: lagos.addDays(lagos.today(), 3), due_days: null, can_cancel: true });
    expect((await h.as("ops").post("/recruitment/assessments/sittings").send({ application_id: applicationId, assessment_definition_id: briefId })).status).toBe(409);
    await drain();
    const mail = queues.enqueue.mock.calls.find((c) => c[1] === "assessment-invite")[2];
    expect(mail.data).toMatchObject({ vacancy_title: "Graphics Designer", assessment_name: "Design Fundamentals", duration_minutes: 30, due_days: null });
    const locked = await h.as("ops").put(`/recruitment/assessments/${briefId}/questions`).send({ questions: [{ question_type: "text", prompt: "Anything at all here", max_score: 5 }] });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe("ASSESSMENT_IN_USE");
    // A Head of Department does not see a sitting of a role they do not manage.
    expect((await h.as("hod").get(`/recruitment/assessments/sittings/${sent.body.application_assessment_id}`)).status).toBe(404);
  });

  test("the candidate starts on the server's clock, answers as they go, never sees a point, and Submit ends the link", async () => {
    const tok = lastLink();
    const before = await pub().get(`/assess/${tok}`);
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ candidate_first_name: "Bisi", state: "not_started", timed: true, questions: null, ends_at: null });

    const started = await pub().post(`/assess/${tok}/start`).send({});
    expect(started.body.state).toBe("in_progress");
    expect(new Date(started.body.ends_at) - new Date(started.body.server_now)).toBeGreaterThan(29 * 60_000);
    expect(JSON.stringify(started.body)).not.toMatch(/points|max_score/);
    const [choice, text, file] = started.body.questions;

    expect((await pub().put(`/assess/${tok}/answers/${choice.assessment_question_id}`).send({ answer: "not-an-option", current_question: 0 })).status).toBe(422);
    const svg = choice.options.find((o) => o.text === "SVG").id;
    expect((await pub().put(`/assess/${tok}/answers/${choice.assessment_question_id}`).send({ answer: svg, current_question: 1 })).status).toBe(200);
    await pub().put(`/assess/${tok}/answers/${text.assessment_question_id}`).send({ answer: "Start from the venue's lights, then pick two accents that read at night.", current_question: 2 });
    expect((await pub().put(`/assess/${tok}/answers/${file.assessment_question_id}`).send({ answer: "a poster I made", current_question: 2 })).status).toBe(422);
    await pub().put(`/assess/${tok}/answers/${file.assessment_question_id}`).send({ answer: "https://example.test/poster", current_question: 2 });

    const resumed = await pub().get(`/assess/${tok}`);
    expect(resumed.body).toMatchObject({ current_question: 2 });
    expect(resumed.body.questions[0].answer).toBe(svg);

    const done = await pub().post(`/assess/${tok}/submit`).send({});
    expect(done.body.state).toBe("submitted");
    expect((await pub().get(`/assess/${tok}`)).status).toBe(404);
    await drain();
    expect(await one("SELECT count(*)::int AS n FROM event_log WHERE event_key = 'assessment.to_mark'")).toEqual({ n: 1 });
  });

  test("Mark Answers: written and file answers only, at most their worth; the sitting is scored and the scorecard follows", async () => {
    const { application_assessment_id: id } = await one("SELECT application_assessment_id FROM application_assessment WHERE application_id = $1", [applicationId]);
    const sheet = await h.as("ops").get(`/recruitment/assessments/sittings/${id}`);
    expect(sheet.body).toMatchObject({ status: "submitted", to_mark: 2, can_mark: true });
    const [choice, text, file] = sheet.body.answers;
    expect(choice).toMatchObject({ awarded_score: 2, response: expect.any(String) });
    expect(file.response).toBe("https://example.test/poster");

    const refused = await h.as("ops").put(`/recruitment/assessments/sittings/${id}/marks`).send({
      marks: [
        { assessment_question_id: choice.assessment_question_id, awarded_score: 1 },
        { assessment_question_id: text.assessment_question_id, awarded_score: 11 },
      ],
    });
    expect(refused.status).toBe(422);
    expect(Object.keys(refused.body.error.fields).sort()).toEqual(["marks.0.assessment_question_id", "marks.1.awarded_score"]);
    expect((await h.as("ops").put(`/recruitment/assessments/sittings/${id}/marks`).send({ marks: [{ assessment_question_id: text.assessment_question_id, awarded_score: "" }] })).status).toBe(422);

    const half = await h.as("ops").put(`/recruitment/assessments/sittings/${id}/marks`).send({ marks: [{ assessment_question_id: text.assessment_question_id, awarded_score: 8, reviewer_comment: "Clear and practical" }] });
    expect(half.body).toMatchObject({ status: "submitted", score: null, to_mark: 1 });
    const scored = await h.as("ops").put(`/recruitment/assessments/sittings/${id}/marks`).send({ marks: [{ assessment_question_id: file.assessment_question_id, awarded_score: 6 }] });
    // (2 + 8 + 6) of (2 + 10 + 8)
    expect(scored.body).toMatchObject({ status: "scored", score: 80, to_mark: 0 });
    const candidate = await h.as("ops").get(`/recruitment/candidates/${applicationId}`);
    expect(candidate.body.scorecard.find((p) => p.code === "technical")).toMatchObject({ score: 80 });
    expect(candidate.body.assessments).toEqual([expect.objectContaining({ name: "Design Fundamentals", status: "scored", score: 80 })]);
  });

  test("the clock: an answer after due_at is refused and the sitting times out; a link never started expires", async () => {
    const sent = await h.as("ops").post("/recruitment/assessments/sittings").send({ application_id: otherApplicationId, assessment_definition_id: briefId, start_within_days: 1 });
    await drain();
    const tok = lastLink();
    const started = await pub().post(`/assess/${tok}/start`).send({});
    await q("UPDATE application_assessment SET due_at = now() - interval '1 minute' WHERE application_assessment_id = $1", [sent.body.application_assessment_id]);
    const late = await pub().put(`/assess/${tok}/answers/${started.body.questions[0].assessment_question_id}`).send({ answer: "x", current_question: 0 });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("TIME_UP");
    // Timed out with nothing answered, so nothing waits for a mark: it is scored at once, an unanswered question counting zero.
    expect(await one("SELECT status, score::float AS score, submitted_at IS NOT NULL AS ended FROM application_assessment WHERE application_assessment_id = $1", [sent.body.application_assessment_id])).toEqual({
      status: "scored",
      score: 0,
      ended: true,
    });

    const copy = await one("SELECT assessment_definition_id FROM assessment_definition WHERE code = 'ASM-0002'");
    await h.as("ops").post(`/recruitment/assessments/${copy.assessment_definition_id}/activate`).send({});
    const unstarted = await h.as("ops").post("/recruitment/assessments/sittings").send({ application_id: otherApplicationId, assessment_definition_id: copy.assessment_definition_id });
    await drain();
    const lapsed = lastLink();
    await q("UPDATE application_assessment SET start_by = current_date - 2 WHERE application_assessment_id = $1", [unstarted.body.application_assessment_id]);
    expect(await timer.sweep()).toEqual({ ended: 1 });
    expect(await one("SELECT status FROM application_assessment WHERE application_assessment_id = $1", [unstarted.body.application_assessment_id])).toEqual({ status: "expired" });
    expect((await pub().get(`/assess/${lapsed}`)).status).toBe(404);
  });

  test("Send to Candidates sends one role at one stage and skips those who have it live; Cancel stops a sitting", async () => {
    const copy = await one("SELECT assessment_definition_id FROM assessment_definition WHERE code = 'ASM-0002'");
    const third = await applicant("Tolu", "tolu.adeyemi@example.test", "assessment");
    const first = await h.as("ops").post("/recruitment/assessments/sittings/bulk").send({ vacancy_id: vacancyId, assessment_definition_id: copy.assessment_definition_id });
    // Bisi and Tolu get it; Femi's lapsed one is no longer live, so Femi gets it again.
    expect(first.body).toEqual({ sent: 3, skipped: 0 });
    expect((await h.as("ops").post("/recruitment/assessments/sittings/bulk").send({ vacancy_id: vacancyId, assessment_definition_id: copy.assessment_definition_id })).body).toEqual({ sent: 0, skipped: 3 });
    expect((await h.as("hod").post("/recruitment/assessments/sittings/bulk").send({ vacancy_id: vacancyId, assessment_definition_id: copy.assessment_definition_id })).status).toBe(404);

    const { application_assessment_id: id } = await one(
      "SELECT application_assessment_id FROM application_assessment WHERE application_id = $1 AND assessment_definition_id = $2",
      [third, copy.assessment_definition_id],
    );
    const cancelled = await h.as("ops").post(`/recruitment/assessments/sittings/${id}/cancel`).send({});
    expect(cancelled.body).toMatchObject({ status: "cancelled", can_cancel: false });
    const marking = await h.as("ops").get("/recruitment/assessments/sittings?marking=true");
    expect(marking.body.page.total).toBe(0);
    const figures = await h.as("ops").get("/recruitment/assessments/summary");
    // The scored sittings are 80 and the timed-out 0.
    expect(figures.body).toMatchObject({ active: 2, average_score: 40 });
  });

  test("Suggest With AI reads a role only in the asker's scope", async () => {
    const res = await h.as("hod").post("/recruitment/assessments/assist").send({ assessment_type: "technical", vacancy_id: vacancyId, instruction: "Test brand and motion design basics" });
    expect(res.status).toBe(404);
  });
});
