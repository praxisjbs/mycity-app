"use strict";
/**
 * Recruitment · Candidates and Apply end to end (docs/guides/recruitment.md §3 steps 4 to 6, §6.2 to
 * §6.5, §6.8): the real migrations on a throwaway database, the whole app through HTTP, every
 * response parsed with its contract (APP_ENV=test). The mail queue is mocked: what is queued is
 * what would be sent. The AI read answers from a stub.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/recruitment-candidates
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
const ai = require("../../src/services/ai/llm.service");
const drafts = require("../../src/services/ai/drafts");
const { one, drain, harness } = require("./helpers/ai-actions");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const area = (formatted) =>
  token.sign({ source: "search", formatted, lat: 6.45, lon: 3.42, provider_id: `test:${formatted}`, kind: "area", city: "Lagos", state: "Lagos", country_code: "ng", timezone: "Africa/Lagos", verified: true, pending: false });

/** A PDF as small as one can be: what the type check reads. */
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<< /Type /Catalog >>endobj\ntrailer<< /Root 1 0 R >>\n%%EOF\n");

/** The emails queued so far, by template. */
const queued = (template) => queues.enqueue.mock.calls.filter((call) => call[0] === "email-send" && call[1] === template).map((call) => call[2]);

describeDb("Recruitment · Candidates against the real migrations", () => {
  let app;
  let h;
  let dept;
  let vacancyId;
  let weekendsId;
  let linkId;
  const pub = () => ({
    get: (path) => request(app).get(`/api/public/v1${path}`).set("X-Forwarded-For", h.nextIp()),
    post: (path) => request(app).post(`/api/public/v1${path}`).set("X-Forwarded-For", h.nextIp()),
  });

  /** A fresh Apply link for the role, as Apply for This Role makes one. */
  const startApply = async () => (await pub().post("/jobs/content-producer-lagos/apply").send({})).body.token;
  const sendCv = (tok) => pub().post(`/apply/${tok}/cv`).attach("file", PDF, { filename: "cv.pdf", contentType: "application/pdf" });
  const form = (over = {}) => ({
    full_name: "Kemi Bello",
    email: "kemi.bello@example.test",
    phone: "+2348031234567",
    years_experience: 3,
    cover_letter: "I have produced weekly video for two Lagos food brands and want to do it for the whole city.",
    answers: {},
    consent: true,
    ...over,
  });

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
    dept = (await one("SELECT department_id FROM department WHERE name = 'Operations'")).department_id;
    const made = await h.as("ops").post("/recruitment/vacancies").send({
      title: "Content Producer",
      department_id: dept,
      hiring_manager_id: h.people.ops.employee_id,
      positions: 1,
      employment_type: "full_time",
      work_pattern: "hybrid",
      location: { token: area("Yaba, Lagos") },
      min_experience_years: 2,
      description: "The Content Producer plans, shoots and edits the videos and posts that show Lagos on MyCityApp every week, with the brand team.",
      requirements: "Two years making video for social media, and a portfolio.",
      closes_on: lagos.addDays(lagos.today(), 30),
      publish: true,
    });
    expect(made.status).toBe(201);
    vacancyId = made.body.vacancy_id;
    const qs = await h.as("ops").put(`/recruitment/vacancies/${vacancyId}/questions`).send({
      questions: [
        { purpose: "application", question_type: "yes_no", prompt: "Can you work weekends in Lagos?" },
        { purpose: "application", question_type: "text", prompt: "A link to your portfolio", required: false },
      ],
    });
    weekendsId = qs.body.questions.find((x) => x.question_type === "yes_no").vacancy_question_id;
    linkId = qs.body.questions.find((x) => x.question_type === "text").vacancy_question_id;
  }, 120_000);

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  afterEach(() => jest.restoreAllMocks());

  test("Apply: the link shows the role and its questions, the CV is kept against it, and Submit answers only a reference", async () => {
    const tok = await startApply();
    const link = await pub().get(`/apply/${tok}`);
    expect(link.status).toBe(200);
    expect(link.body.vacancy_title).toBe("Content Producer");
    expect(link.body.questions.map((x) => [x.question_type, x.required])).toEqual([
      ["yes_no", true],
      ["text", false],
    ]);

    const cv = await sendCv(tok);
    expect(cv.status).toBe(201);
    expect(cv.body).toMatchObject({ file_name: "cv.pdf", mime_type: "application/pdf" });

    // A required question left out is named; nothing is made and the link still works.
    const missing = await pub().post(`/apply/${tok}`).send(form({ cv_document_id: cv.body.document_id }));
    expect(missing.status).toBe(422);
    expect(Object.keys(missing.body.error.fields)).toEqual([`answers.${weekendsId}`]);

    const sent = await pub()
      .post(`/apply/${tok}`)
      .send(form({ cv_document_id: cv.body.document_id, answers: { [weekendsId]: "Yes", [linkId]: "https://example.test/reel" } }));
    expect(sent.status).toBe(201);
    expect(sent.body).toEqual({ reference: "APP-0001", submitted_at: expect.any(String) });
    // Spent: the same link is the same 404 as any bad one.
    expect((await pub().get(`/apply/${tok}`)).status).toBe(404);

    const row = await one(
      "SELECT a.source, a.stage, a.status, a.provisional_score::float AS estimate, d.entity_type, d.scan_status FROM application a JOIN document d ON d.document_id = a.cv_document_id",
    );
    // experience 3 of 2 → 100; a CV, a link and a cover letter → 100; the one yes or no answered yes → 100
    expect(row).toEqual({ source: "careers", stage: "application", status: "active", estimate: 100, entity_type: "application", scan_status: "pending" });

    await drain();
    expect(queued("application-received")).toEqual([
      expect.objectContaining({ to: { name: "Kemi Bello", email: "kemi.bello@example.test" }, data: { vacancy_title: "Content Producer", reference: "APP-0001" } }),
    ]);
    const notice = await one("SELECT count(*)::int AS n FROM notification_delivery nd JOIN app_user u ON u.user_id = nd.user_id WHERE u.employee_id = $1", [h.people.ops.employee_id]).catch(() => null);
    if (notice) expect(notice.n).toBeGreaterThanOrEqual(1);
  });

  test("applying twice makes nothing new, and a CV sent on another link is refused", async () => {
    const again = await startApply();
    const other = await startApply();
    const cv = await sendCv(other);
    const stolen = await pub().post(`/apply/${again}`).send(form({ email: "someone.else@example.test", cv_document_id: cv.body.document_id, answers: { [weekendsId]: "no" } }));
    expect(stolen.status).toBe(422);
    expect(stolen.body.error.fields).toHaveProperty("cv_document_id");

    const own = await sendCv(again);
    const twice = await pub().post(`/apply/${again}`).send(form({ email: "KEMI.BELLO@example.test", cv_document_id: own.body.document_id, answers: { [weekendsId]: "yes" } }));
    expect(twice.status).toBe(201);
    expect(twice.body.reference).toBe("APP-0001");
    // Answered as now, like any submission: the first application's date is not given away.
    expect(Date.now() - Date.parse(twice.body.submitted_at)).toBeLessThan(60_000);
    expect(await one("SELECT count(*)::int AS n FROM application")).toEqual({ n: 1 });
    // A second press on the same spent link gets the receipt, not a 404; another email on it gets the 404.
    expect((await pub().post(`/apply/${again}`).send(form({ email: "KEMI.BELLO@example.test", cv_document_id: own.body.document_id, answers: { [weekendsId]: "yes" } }))).status).toBe(201);
    expect((await pub().post(`/apply/${again}`).send(form({ email: "nobody@example.test", cv_document_id: own.body.document_id, answers: { [weekendsId]: "yes" } }))).status).toBe(404);
  });

  test("the board shows the estimate as Provisional, the scorecard over the parts on, and the CV waits for its check", async () => {
    const board = await h.as("ops").get(`/recruitment/candidates?vacancy_id=${vacancyId}&sort=-weighted_total`);
    expect(board.status).toBe(200);
    expect(board.body.data).toEqual([
      expect.objectContaining({ number: "APP-0001", name: "Kemi Bello", stage: "application", score: 100, score_provisional: true, weighted_total: 100, parts_scored: 1, parts_active: 5, cv_state: "checking" }),
    ]);
    const id = board.body.data[0].application_id;
    const sheet = await h.as("ops").get(`/recruitment/candidates/${id}`);
    expect(sheet.body.answers.map((a) => a.answer)).toEqual(["yes", "https://example.test/reel"]);
    expect(sheet.body.scorecard.find((p) => p.code === "screening")).toMatchObject({ score: 100, provisional: true });
    expect(sheet.body.next_stages).toEqual(["screening", "assessment", "interview", "shortlist"]);
    expect(sheet.body.history.map((m) => m.to_state)).toEqual(["application"]);
    expect((await h.as("ops").get(`/recruitment/candidates/${id}/cv`)).status).toBe(409);

    const figures = await h.as("ops").get(`/recruitment/candidates/summary?vacancy_id=${vacancyId}`);
    expect(figures.body).toMatchObject({ candidates: 1, to_screen: 1, in_interview: 0, shortlisted: 0 });
    // A Head of Department sees only the candidates of vacancies they manage.
    expect((await h.as("hod").get(`/recruitment/candidates/${id}`)).status).toBe(404);
    expect((await h.as("hod").get("/recruitment/candidates")).body.page.total).toBe(0);
  });

  test("moves go ahead or one back within the board; Not Progressing stops and mails, Reopen puts it back", async () => {
    const { application_id: id } = await one("SELECT application_id FROM application WHERE number = 'APP-0001'");
    expect((await h.as("ops").post(`/recruitment/candidates/${id}/move`).send({ stage: "interview" })).status).toBe(200);
    const back = await h.as("ops").post(`/recruitment/candidates/${id}/move`).send({ stage: "application" });
    expect(back.status).toBe(409);
    expect(back.body.error.message).toBe("Move one stage back at most");
    const moved = await h.as("ops").post(`/recruitment/candidates/${id}/move`).send({ stage: "assessment", reason: "Sent the brief first" });
    expect(moved.body).toMatchObject({ stage: "assessment", days_at_stage: 0 });

    // The role drops its assessment parts: the board loses the column, and nobody moves into it.
    const off = { active: false, weight: 0 };
    await h.as("ops").put(`/recruitment/vacancies/${vacancyId}/scorecard`).send({
      parts: { screening: { active: true, weight: 40 }, psychometric: off, technical: off, case_study: off, interview: { active: true, weight: 60 } },
    });
    expect((await h.as("ops").post(`/recruitment/candidates/${id}/move`).send({ stage: "interview" })).status).toBe(200);
    expect((await h.as("ops").post(`/recruitment/candidates/${id}/move`).send({ stage: "assessment" })).status).toBe(409);

    const stopped = await h.as("ops").post(`/recruitment/candidates/${id}/not-progressed`).send({ rejection_reason: "Portfolio shows no long-form video work" });
    expect(stopped.body).toMatchObject({ status: "not_progressed", stage: "interview", next_stages: [], rejection_reason: "Portfolio shows no long-form video work" });
    expect((await h.as("ops").post(`/recruitment/candidates/${id}/move`).send({ stage: "shortlist" })).status).toBe(409);
    await drain();
    expect(queued("candidate-not-progressed")).toEqual([
      expect.objectContaining({ data: { vacancy_title: "Content Producer", careers_url: expect.stringMatching(/\/jobs$/) } }),
    ]);

    const reopened = await h.as("ops").post(`/recruitment/candidates/${id}/reopen`).send({});
    expect(reopened.body).toMatchObject({ status: "active", stage: "interview", rejection_reason: null });
    expect(reopened.body.history.map((m) => m.to_state)).toEqual(["application", "interview", "assessment", "interview", "not_progressed", "interview"]);
    expect(reopened.body.history[2].reason).toBe("Sent the brief first");
  });

  test("Score With AI keeps the read and its summary; Screen With AI keeps its conditions and refuses an unfair one", async () => {
    const { application_id: id } = await one("SELECT application_id FROM application WHERE number = 'APP-0001'");
    jest.spyOn(drafts, "availability").mockResolvedValue({ available: true, reason: null });
    const complete = jest.spyOn(ai, "complete").mockResolvedValue({ output: { score: 72, summary: "Two years of weekly video for food brands. Lives in Lagos: met." }, run_id: null });
    const pressed = await h.as("ops").post(`/recruitment/candidates/${id}/score`).send({});
    expect(pressed.status).toBe(200);
    await drain();
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ purpose: "cv-screen", module: "recruitment", egress: "external" }));
    const input = complete.mock.calls[0][0].input;
    expect(input.role.title).toBe("Content Producer");
    expect(input.candidate.answers).toEqual([
      { question: "Can you work weekends in Lagos?", answer: "yes" },
      { question: "A link to your portfolio", answer: "https://example.test/reel" },
    ]);
    // The CV is still being checked, so nothing of it is read.
    expect(input.cv_text).toBe(null);
    expect(JSON.stringify(input)).not.toContain("kemi.bello@example.test");
    const sheet = await h.as("ops").get(`/recruitment/candidates/${id}`);
    expect(sheet.body).toMatchObject({ score: 72, score_provisional: false, screening_score: 72, provisional_score: 100 });
    expect(sheet.body.screening_summary).toMatch(/^Two years/);

    const unfair = await h.as("ops").post("/recruitment/candidates/score-all").send({ vacancy_id: vacancyId, screening_conditions: ["Lives in Lagos", "Under 30 years old"] });
    expect(unfair.status).toBe(422);
    expect(Object.keys(unfair.body.error.fields)).toEqual(["screening_conditions.1"]);
    const all = await h.as("ops").post("/recruitment/candidates/score-all").send({ vacancy_id: vacancyId, screening_conditions: ["Lives in Lagos"] });
    expect(all.body).toEqual({ queued: 0 });
    expect(await one("SELECT screening_conditions FROM vacancy WHERE vacancy_id = $1", [vacancyId])).toEqual({ screening_conditions: ["Lives in Lagos"] });
    // Pressed again with none given, the kept ones stand.
    expect((await h.as("ops").post("/recruitment/candidates/score-all").send({ vacancy_id: vacancyId })).status).toBe(200);
  });

  test("Invite to Apply mails a 7-day link after commit, and the application it leads to is marked invited", async () => {
    const sent = await h.as("ops").post("/recruitment/candidates/invitations").send({ first_name: "Tobi", last_name: "Lawal", email: "tobi.lawal@example.test", vacancy_id: vacancyId });
    expect(sent.status).toBe(201);
    expect(sent.body.email).toBe("tobi.lawal@example.test");
    await drain();
    const [mail] = queued("apply-invite");
    expect(mail.data.vacancy_title).toBe("Content Producer");
    const tok = mail.data.apply_url.split("/apply/")[1];
    expect((await pub().get(`/apply/${tok}`)).status).toBe(200);
    const cv = await sendCv(tok);
    const made = await pub().post(`/apply/${tok}`).send(form({ full_name: "Tobi Lawal", email: "tobi.lawal@example.test", cv_document_id: cv.body.document_id, answers: { [weekendsId]: "no" } }));
    expect(made.status).toBe(201);
    expect(await one("SELECT source FROM application WHERE number = $1", [made.body.reference])).toEqual({ source: "invited" });
    // Inviting them again to the same role is refused.
    expect((await h.as("ops").post("/recruitment/candidates/invitations").send({ first_name: "Tobi", last_name: "Lawal", email: "tobi.lawal@example.test", vacancy_id: vacancyId })).status).toBe(422);
  });

  test("Candidate Emails: five, each saved as the next version and checked against its variables; Restore Default keeps the history", async () => {
    const list = await h.as("ops").get("/recruitment/candidates/emails");
    expect(list.body.data.map((e) => [e.key, e.version, e.is_default])).toEqual([
      ["application-received", 0, true],
      ["apply-invite", 0, true],
      ["assessment-invite", 0, true],
      ["interview-invite", 0, true],
      ["candidate-not-progressed", 0, true],
    ]);
    const typo = await h.as("ops").put("/recruitment/candidates/emails/application-received").send({ subject: "We have your application", body: "Thank you. Your reference is {{ referance }}." });
    expect(typo.status).toBe(422);
    const saved = await h.as("ops").put("/recruitment/candidates/emails/application-received").send({
      subject: "We have your application for {{ vacancy_title }}",
      body: "Thank you for applying. Your reference is {{ reference }}.",
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ version: 1, is_default: false, body: "Thank you for applying. Your reference is {{ reference }}." });
    const restored = await h.as("ops").post("/recruitment/candidates/emails/application-received/restore").send({});
    expect(restored.body.version).toBe(2);
    expect(await one("SELECT count(*)::int AS n FROM template_version WHERE kind = 'email' AND key = 'application-received'")).toEqual({ n: 2 });
    expect((await h.as("hod").put("/recruitment/candidates/emails/application-received").send({ subject: "Hello there", body: "Thank you for applying to us." })).status).toBe(403);
  });
});
