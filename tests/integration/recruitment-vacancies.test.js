"use strict";
/**
 * Recruitment · Vacancies and the careers page end to end (docs/guides/recruitment.md §3 steps 1 to
 * 4, §5, §6.1, §9): the real migrations on a throwaway database, the whole app through HTTP, every
 * response parsed with its contract (APP_ENV=test), the cards through Praxis AI with Gemini
 * answering from a script.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/recruitment-vacancies
 *
 * Refuses to run unless the database name ends in "_test". Every person here is invented.
 */
process.env.GEMINI_API_KEY = "test-key";
const request = require("supertest");
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
const lagos = require("../../src/shared/time/lagos");
const registry = require("../../src/shared/ai/registry");
const token = require("../../src/shared/places/token");
const geoapify = require("../../src/services/maps/geoapify.service");
const { q, one, drain, fresh, script, say, harness } = require("./helpers/ai-actions");
const service = require("../../src/modules/vacancies/vacancies.service");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

/** An area as our search signs it. */
const area = (formatted, city = "Lagos") =>
  token.sign({ source: "search", formatted, lat: 6.45, lon: 3.42, provider_id: `test:${formatted}`, kind: "area", city, state: "Lagos", country_code: "ng", timezone: "Africa/Lagos", verified: true, pending: false });

/** MyCity's ten traits, as Careers Settings would hold them. */
const TRAITS = [
  "Appearance and Grooming",
  "Level of Confidence",
  "Oral Communication Skills",
  "Clarity of Thought and Expression",
  "Accuracy in Language",
  "Job Knowledge and Experience",
  "Experience in Sales and Marketing",
  "Stability Level in Career",
  "Suitability for Target Assignment",
  "Future Growth Potential in Career",
];

describeDb("Recruitment · Vacancies against the real migrations", () => {
  let app;
  let h;
  let dept;
  let programmes;
  const closesOn = () => lagos.addDays(lagos.today(), 30);
  const pub = () => ({
    get: (path) => request(app).get(`/api/public/v1${path}`).set("X-Forwarded-For", h.nextIp()),
    post: (path) => request(app).post(`/api/public/v1${path}`).set("X-Forwarded-For", h.nextIp()),
  });

  const salesRole = (over = {}) => ({
    title: "Head, Sales & Revenue",
    department_id: dept,
    hiring_manager_id: h.people.ops.employee_id,
    positions: 1,
    employment_type: "full_time",
    work_pattern: "hybrid",
    work_pattern_note: "2 days in office, 3 from home",
    location: { token: area("Victoria Island, Lagos") },
    working_days: "Monday to Saturday",
    min_experience_years: 8,
    salary_min: "900000.00",
    salary_max: "1400000.00",
    description:
      "The Head, Sales & Revenue will lead MyCityApp's commercial growth by developing and executing the company's sales and revenue strategy.\n\n## Key Responsibilities\n\n### 1. Sales & Revenue Strategy\n\n- Set clear sales targets.",
    requirements: "A degree in Business Administration, Marketing or a related field, and 8 years in B2B sales.",
    nice_to_have: "A commercial leader, not simply a sales administrator.",
    closes_on: closesOn(),
    ...over,
  });

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    h = harness(app);
    await h.makePeople([
      { who: "ceo", first: "Amaka", last: "Eze", email: "ceo@mycity.test", job: "Chief Executive Officer", role: "management", ceo: true, password: "Chief#Officer26", department: "Management" },
      { who: "ops", first: "Ada", last: "Obi", email: "ops@mycity.test", job: "Operations & People Lead", role: "operations_people", password: "Opera!ions2026", department: "Operations" },
      { who: "hod", first: "Ife", last: "Ojo", email: "hod@mycity.test", job: "Head of Programmes", role: "head_of_department", password: "Head#Programmes26", department: "Programmes" },
      { who: "staff", first: "Tunde", last: "Ade", email: "tunde@mycity.test", job: "Field Officer", role: "employee", password: "Staff#Member2026", department: "Programmes" },
    ]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [h.people.hod.employee_id, h.people.staff.employee_id]);
    await grantsCache.bumpTeamVersion();
    await drain();
    dept = (await one("SELECT department_id FROM department WHERE name = 'Operations'")).department_id;
    programmes = (await one("SELECT department_id FROM department WHERE name = 'Programmes'")).department_id;
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

  test("Careers Settings hold About MyCityApp and the Default Traits; staff without the grant are refused", async () => {
    expect((await h.as("staff").get("/recruitment/vacancies/settings")).status).toBe(403);
    const twice = await h.as("ops").put("/recruitment/vacancies/settings").send({ default_traits: ["Level of Confidence", "level of confidence"] });
    expect(twice.status).toBe(422);
    const saved = await h.as("ops").put("/recruitment/vacancies/settings").send({
      about_company: "MyCityApp is a digital city and lifestyle platform connecting people, businesses and experiences across Nigerian cities.",
      default_traits: TRAITS,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.default_traits).toEqual(TRAITS);
    expect((await h.as("ops").get("/recruitment/vacancies/settings")).body.about_company).toMatch(/^MyCityApp is a digital city/);
  });

  test("New Vacancy keeps a draft: VAC numbered, the place picked, the five parts on, MyCity's traits on its card", async () => {
    const res = await h.as("ops").post("/recruitment/vacancies").send(salesRole());
    expect(res.status).toBe(201);
    const v = res.body;
    expect(v).toMatchObject({ number: "VAC-0001", status: "draft", slug: null, public_url: null, location: "Victoria Island, Lagos", working_days: "Monday to Saturday" });
    expect(v.location_place).toMatchObject({ formatted: "Victoria Island, Lagos", kind: "area" });
    expect(v.scorecard.map((p) => [p.code, p.active, p.weight])).toEqual([
      ["screening", true, 15],
      ["psychometric", true, 15],
      ["technical", true, 25],
      ["case_study", true, 20],
      ["interview", true, 25],
    ]);
    expect(v.questions.filter((x) => x.purpose === "interview").map((x) => x.prompt)).toEqual(TRAITS);
    expect(v.board_stages).toEqual(["application", "screening", "assessment", "interview", "shortlist"]);
    expect(v.closes_at).toBe(new Date(lagos.endOfDayExclusive(closesOn()).getTime() - 1000).toISOString());
  });

  test("a hybrid role needs its place, a missing department is named, and publish says what it lacks", async () => {
    const noPlace = await h.as("ops").post("/recruitment/vacancies").send({ ...salesRole(), location: undefined });
    expect(noPlace.status).toBe(422);
    expect(noPlace.body.error.fields).toHaveProperty("location");
    const short = await h.as("ops").post("/recruitment/vacancies").send({ ...salesRole({ title: "Content Producer", description: "Too short to publish." }) });
    expect(short.status).toBe(422);
    expect(short.body.error.fields).toHaveProperty("description");
  });

  test("Publish puts it live at its slug; the careers page names only what a stranger may read", async () => {
    const draft = await one("SELECT vacancy_id FROM vacancy WHERE number = 'VAC-0001'");
    const live = await h.as("ops").post(`/recruitment/vacancies/${draft.vacancy_id}/publish`).send({});
    expect(live.status).toBe(200);
    expect(live.body).toMatchObject({ status: "open", slug: "head-sales-revenue-lagos" });
    expect(live.body.public_url).toMatch(/\/jobs\/head-sales-revenue-lagos$/);
    expect(live.body.published_at).toBeTruthy();

    const careers = await pub().get("/jobs");
    expect(careers.status).toBe(200);
    expect(careers.body.data).toEqual([
      { slug: "head-sales-revenue-lagos", title: "Head, Sales & Revenue", department: "Operations", location: "Victoria Island, Lagos", work_pattern: "hybrid" },
    ]);
    expect((await pub().get("/jobs?q=revenue")).body.page.total).toBe(1);
    expect((await pub().get("/jobs?q=engineer")).body.page.total).toBe(0);

    const role = await pub().get("/jobs/head-sales-revenue-lagos");
    expect(role.status).toBe(200);
    expect(role.body).toMatchObject({ state: "open", how_we_hire: ["apply", "screening", "assessment", "interview"], working_days: "Monday to Saturday", applicants: 0 });
    // The role's Markdown texts arrive as blocks from the one renderer, so the page draws elements, never HTML.
    const text = (spans) => spans.map((x) => x.text).join("");
    expect(role.body.about_company).toHaveLength(1);
    expect(role.body.about_company[0].kind).toBe("paragraph");
    expect(text(role.body.about_company[0].spans)).toMatch(/^MyCityApp is a digital city/);
    expect(role.body.description.map((b) => b.kind)).toEqual(["paragraph", "heading", "heading", "bullets"]);
    expect(role.body.description[1]).toMatchObject({ kind: "heading", level: 2 });
    expect(text(role.body.description[1].spans)).toBe("Key Responsibilities");
    expect(text(role.body.requirements[0].spans)).toMatch(/^A degree in Business Administration/);
    expect(text(role.body.nice_to_have[0].spans)).toBe("A commercial leader, not simply a sales administrator.");
    // The band is not shown: left out, not null; and no internal id ever leaves.
    expect(role.body).not.toHaveProperty("salary_min");
    expect(role.body).not.toHaveProperty("vacancy_id");
    expect(JSON.stringify(role.body)).not.toContain(draft.vacancy_id);
    expect((await pub().get("/jobs/no-such-role")).status).toBe(404);
    expect((await pub().get("/jobs/Bad_Slug")).status).toBe(404);
  });

  test("Apply for This Role mints a single-use Apply link; a draft or paused role gives the same 404", async () => {
    const started = await pub().post("/jobs/head-sales-revenue-lagos/apply").send({});
    expect(started.status).toBe(201);
    expect(started.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await one("SELECT scope, subject_type, single_use, expires_at > now() + interval '47 hours' AS lives FROM public_token ORDER BY created_at DESC LIMIT 1");
    expect(row).toEqual({ scope: "application.apply", subject_type: "vacancy", single_use: true, lives: true });

    const v = await one("SELECT vacancy_id FROM vacancy WHERE number = 'VAC-0001'");
    const paused = await h.as("ops").post(`/recruitment/vacancies/${v.vacancy_id}/pause`).send({});
    expect(paused.body).toMatchObject({ status: "paused", slug: "head-sales-revenue-lagos" });
    expect((await pub().get("/jobs/head-sales-revenue-lagos")).body.state).toBe("paused");
    expect((await pub().post("/jobs/head-sales-revenue-lagos/apply").send({})).status).toBe(404);
    expect((await pub().get("/jobs")).body.page.total).toBe(0);
    expect((await h.as("ops").post(`/recruitment/vacancies/${v.vacancy_id}/publish`).send({})).status).toBe(409);

    const resumed = await h.as("ops").post(`/recruitment/vacancies/${v.vacancy_id}/resume`).send({});
    expect(resumed.body).toMatchObject({ status: "open", slug: "head-sales-revenue-lagos", paused_at: null });
    const history = await q("SELECT to_state FROM entity_state_history WHERE entity_type = 'vacancy' AND entity_id = $1 ORDER BY changed_at, entity_state_history_id", [v.vacancy_id]);
    expect(history.rows.map((r) => r.to_state)).toEqual(["draft", "open", "paused", "open"]);
  });

  test("questions and traits are saved whole; the scorecard switches parts off and the board and How We Hire follow", async () => {
    const v = await one("SELECT vacancy_id FROM vacancy WHERE number = 'VAC-0001'");
    const detail = (await h.as("ops").get(`/recruitment/vacancies/${v.vacancy_id}`)).body;
    const traits = detail.questions.filter((x) => x.purpose === "interview");
    const sales = traits.find((t) => t.prompt === "Experience in Sales and Marketing");
    const keep = traits.filter((t) => t !== sales).map((t) => ({ vacancy_question_id: t.vacancy_question_id, purpose: "interview", question_type: "rating", prompt: t.prompt }));
    const saved = await h.as("ops").put(`/recruitment/vacancies/${v.vacancy_id}/questions`).send({
      questions: [
        { purpose: "application", question_type: "text", prompt: "A link to a deal you closed and your part in it" },
        ...keep,
        { purpose: "interview", question_type: "rating", prompt: "Experience in B2B Sales" },
      ],
    });
    expect(saved.status).toBe(200);
    const after = saved.body.questions;
    expect(after.filter((x) => x.purpose === "application").map((x) => x.prompt)).toEqual(["A link to a deal you closed and your part in it"]);
    expect(after.some((x) => x.prompt === "Experience in Sales and Marketing")).toBe(false);
    expect(after.filter((x) => x.purpose === "interview" && x.active)).toHaveLength(10);
    // A trait is rated, never answered as text.
    const wrong = await h.as("ops").put(`/recruitment/vacancies/${v.vacancy_id}/questions`).send({ questions: [{ purpose: "interview", question_type: "text", prompt: "Tell us about yourself" }] });
    expect(wrong.status).toBe(422);

    const off = { active: false, weight: 0 };
    const bad = await h.as("ops").put(`/recruitment/vacancies/${v.vacancy_id}/scorecard`).send({
      parts: { screening: { active: true, weight: 30 }, psychometric: off, technical: off, case_study: off, interview: { active: true, weight: 60 } },
    });
    expect(bad.status).toBe(422);
    const card = await h.as("ops").put(`/recruitment/vacancies/${v.vacancy_id}/scorecard`).send({
      parts: { screening: { active: true, weight: 30 }, psychometric: off, technical: off, case_study: off, interview: { active: true, weight: 70 } },
    });
    expect(card.status).toBe(200);
    expect(card.body.board_stages).toEqual(["application", "screening", "interview", "shortlist"]);
    expect((await pub().get("/jobs/head-sales-revenue-lagos")).body.how_we_hire).toEqual(["apply", "screening", "interview"]);
  });

  test("scope is the hiring manager: a Head of Department sees their own vacancies and names only people they lead", async () => {
    const theirs = await h.as("hod").post("/recruitment/vacancies").send(
      salesRole({ title: "Field Coordinator", department_id: programmes, hiring_manager_id: h.people.hod.employee_id, work_pattern: "on_site", location: { token: area("Ikeja, Lagos") } }),
    );
    expect(theirs.status).toBe(201);
    const outside = await h.as("hod").post("/recruitment/vacancies").send(salesRole({ title: "Another Role" }));
    expect(outside.status).toBe(422);
    expect(outside.body.error.fields).toHaveProperty("hiring_manager_id");

    const list = await h.as("hod").get("/recruitment/vacancies");
    expect(list.body.data.map((v) => v.title)).toEqual(["Field Coordinator"]);
    const ops = await one("SELECT vacancy_id FROM vacancy WHERE number = 'VAC-0001'");
    expect((await h.as("hod").get(`/recruitment/vacancies/${ops.vacancy_id}`)).status).toBe(404);
    expect((await h.as("hod").post(`/recruitment/vacancies/${ops.vacancy_id}/pause`).send({})).status).toBe(404);
    expect((await h.as("hod").patch(`/recruitment/vacancies/${ops.vacancy_id}`).send({ positions: 3 })).status).toBe(404);
    expect((await h.as("ops").get("/recruitment/vacancies")).body.page.total).toBe(2);
    // The summary counts only their vacancies; Careers Settings shape every vacancy, so they read them only.
    expect((await h.as("hod").get("/recruitment/vacancies/summary")).body.open).toBe(0);
    expect((await h.as("ops").get("/recruitment/vacancies/summary")).body.open).toBe(1);
    expect((await h.as("hod").get("/recruitment/vacancies/settings")).status).toBe(200);
    expect((await h.as("hod").put("/recruitment/vacancies/settings").send({ default_traits: ["Level of Confidence"] })).status).toBe(403);
    // A card never names a vacancy outside the asker's scope, by id or by number.
    const hodScope = { scope: "team", scope_ids: [h.people.hod.employee_id, h.people.staff.employee_id] };
    expect(await service.idOf(pool, ops.vacancy_id, hodScope)).toBe(null);
    expect(await service.idOf(pool, "VAC-0001", hodScope)).toBe(null);
    expect(await service.cardVacancy(pool, ops.vacancy_id, hodScope)).toEqual([]);
    expect(await service.idOf(pool, theirs.body.vacancy_id, hodScope)).toBe(theirs.body.vacancy_id);
  });

  test("Suggested From Organogram lists vacant seats until a vacancy takes one", async () => {
    const seat = await one("INSERT INTO org_seat (title, department_id, status) VALUES ('Partnerships Associate', $1, 'vacant') RETURNING org_seat_id", [dept]);
    const before = await h.as("ops").get("/recruitment/vacancies/suggested");
    expect(before.body.data).toEqual([expect.objectContaining({ org_seat_id: seat.org_seat_id, title: "Partnerships Associate", department: "Operations" })]);
    // A Head of Department sees only the seats of people they lead.
    expect((await h.as("hod").get("/recruitment/vacancies/suggested")).body.data).toEqual([]);
    const made = await h.as("ops").post("/recruitment/vacancies").send(salesRole({ title: "Partnerships Associate", org_seat_id: seat.org_seat_id }));
    expect(made.status).toBe(201);
    expect(made.body.org_seat_id).toBe(seat.org_seat_id);
    // One live vacancy a seat.
    const again = await h.as("ops").post("/recruitment/vacancies").send(salesRole({ title: "Partnerships Associate II", org_seat_id: seat.org_seat_id }));
    expect(again.status).toBe(422);
    expect(again.body.error.fields).toHaveProperty("org_seat_id");
    // Saving the vacancy that holds the seat keeps it.
    expect((await h.as("ops").patch(`/recruitment/vacancies/${made.body.vacancy_id}`).send({ org_seat_id: seat.org_seat_id, positions: 2 })).status).toBe(200);
    expect((await h.as("ops").get("/recruitment/vacancies/suggested")).body.data).toEqual([]);
  });

  test("closed as filled says filled on the careers page and is not edited again; the summary counts what is open", async () => {
    const v = await one("SELECT vacancy_id FROM vacancy WHERE number = 'VAC-0001'");
    const closed = await h.as("ops").post(`/recruitment/vacancies/${v.vacancy_id}/close`).send({ close_reason: "filled" });
    expect(closed.body).toMatchObject({ status: "closed", close_reason: "filled", can_edit: false });
    expect((await pub().get("/jobs/head-sales-revenue-lagos")).body.state).toBe("filled");
    expect((await h.as("ops").patch(`/recruitment/vacancies/${v.vacancy_id}`).send({ title: "Head of Sales" })).status).toBe(409);
    expect((await h.as("ops").post(`/recruitment/vacancies/${v.vacancy_id}/resume`).send({})).status).toBe(409);
    const s = await h.as("ops").get("/recruitment/vacancies/summary");
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ open: 0, applicants: 0, in_interview: 0 });
    expect(s.body.funnel.map((f) => f.stage)).toEqual(["application", "screening", "assessment", "interview", "shortlist"]);
  });

  test("vacancies.create and vacancies.edit: the cards ask what they need, pick the area, and save through the screen's own functions", async () => {
    // The area in words: our search signs the one area it finds.
    jest.spyOn(geoapify, "searchPlaces").mockResolvedValue([
      { place_id: "test:yaba", formatted: "Yaba, Lagos", lat: 6.51, lon: 3.38, kind: "area", city: "Lagos", state: "Lagos", country_code: "ng", timezone: "Africa/Lagos" },
    ]);
    script(
      say({
        text: "Here it is.",
        action: {
          key: "vacancies.create",
          values: {
            title: "Content Producer",
            department_id: "Operations",
            hiring_manager_id: h.people.ops.employee_id,
            employment_type: "full_time",
            work_pattern: "hybrid",
            location: "Yaba",
            description: "The Content Producer plans, shoots and edits the videos and posts that show Lagos on MyCityApp every week.",
            requirements: "Two years making video for social media, and a portfolio.",
            closes_on: closesOn(),
          },
          suggested: false,
        },
      }),
    );
    const asked = await h.ask("ops", { question: "Open a vacancy for a Content Producer in Operations, hybrid in Yaba.", shows: ["cards"] });
    expect(asked.status).toBe(200);
    expect(c.assistant.AiAnswer.safeParse(asked.body).success).toBe(true);
    const card = asked.body.card;
    expect(card).toMatchObject({ action_key: "vacancies.create", label: "New Vacancy", schema: "vacancies.VacancyAdd", problems: {} });
    expect(card.names).toEqual(expect.arrayContaining([expect.objectContaining({ type: "department", label: "Operations" }), expect.objectContaining({ type: "place", label: "Yaba, Lagos" })]));
    const pressed = await h.press("ops", card.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    const made = await one("SELECT vacancy_id, number::text AS number, status, location FROM vacancy WHERE title = 'Content Producer'");
    expect(made).toMatchObject({ status: "draft", location: "Yaba, Lagos" });

    script(say({ text: "Here it is.", action: { key: "vacancies.edit", values: { vacancy_id: made.number, positions: 2 }, suggested: false } }));
    const edit = await h.ask("ops", { question: `Make ${made.number} two openings.`, shows: ["cards"] });
    expect(edit.body.card).toMatchObject({ action_key: "vacancies.edit", label: "Save Vacancy", values: { vacancy_id: made.vacancy_id, positions: 2 }, problems: {} });
    expect(edit.body.card.records).toEqual([expect.objectContaining({ type: "vacancy", id: made.vacancy_id })]);
    expect((await h.press("ops", edit.body.card.ai_action_draft_id)).status).toBe(200);
    expect(await one("SELECT positions FROM vacancy WHERE vacancy_id = $1", [made.vacancy_id])).toEqual({ positions: 2 });
  });

  test("an answered question is retired, never rewritten: reworded it is a new question, left out it stays on its answers", async () => {
    const made = await h.as("ops").post("/recruitment/vacancies").send(salesRole({ title: "Events Lead" }));
    const id = made.body.vacancy_id;
    const asked = await h.as("ops").put(`/recruitment/vacancies/${id}/questions`).send({
      questions: [
        { purpose: "application", question_type: "yes_no", prompt: "Can you work weekends in Lagos?" },
        { purpose: "application", question_type: "text", prompt: "A link to an event you ran" },
      ],
    });
    const [weekends, link] = asked.body.questions;
    const person = await one("INSERT INTO candidate (first_name, last_name, email) VALUES ('Kemi', 'Bello', 'kemi.events@example.test') RETURNING candidate_id");
    await q("INSERT INTO application (number, vacancy_id, candidate_id, answers) VALUES ('APP-9001', $1, $2, $3::jsonb)", [
      id,
      person.candidate_id,
      JSON.stringify({ [weekends.vacancy_question_id]: "yes", [link.vacancy_question_id]: "https://example.test/event" }),
    ]);
    const saved = await h.as("ops").put(`/recruitment/vacancies/${id}/questions`).send({
      questions: [{ vacancy_question_id: weekends.vacancy_question_id, purpose: "application", question_type: "yes_no", prompt: "Can you work weekends and evenings in Lagos?" }],
    });
    expect(saved.status).toBe(200);
    expect(saved.body.questions.map((x) => x.prompt)).toEqual(["Can you work weekends and evenings in Lagos?"]);
    expect(saved.body.questions[0].vacancy_question_id).not.toBe(weekends.vacancy_question_id);
    const kept = await q("SELECT prompt, active FROM vacancy_question WHERE vacancy_question_id = ANY($1::uuid[]) ORDER BY prompt", [[weekends.vacancy_question_id, link.vacancy_question_id]]);
    expect(kept.rows).toEqual([
      { prompt: "A link to an event you ran", active: false },
      { prompt: "Can you work weekends in Lagos?", active: false },
    ]);
  });

  test("Edit clears what it is sent empty, a remote role drops its place, and pay is checked against what is kept", async () => {
    const made = await h.as("ops").post("/recruitment/vacancies").send(salesRole({ title: "Community Manager" }));
    const id = made.body.vacancy_id;
    const cleared = await h.as("ops").patch(`/recruitment/vacancies/${id}`).send({ nice_to_have: "", working_days: null, min_experience_years: "" });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ nice_to_have: null, working_days: null, min_experience_years: null });
    const remote = await h.as("ops").patch(`/recruitment/vacancies/${id}`).send({ work_pattern: "remote" });
    expect(remote.body).toMatchObject({ work_pattern: "remote", location: null, location_place: null });
    expect(await one("SELECT count(*)::int AS n FROM place WHERE owner = 'vacancy.location' AND owner_key = $1", [id])).toEqual({ n: 0 });
    const low = await h.as("ops").patch(`/recruitment/vacancies/${id}`).send({ salary_max: "500000.00" });
    expect(low.status).toBe(422);
    expect(low.body.error.fields).toHaveProperty("salary_max");
    expect((await h.as("ops").patch(`/recruitment/vacancies/${id}`).send({})).status).toBe(422);
  });

  test("a draft can be closed; a role past its closing day reads closed and takes no one; resuming one says its day has passed", async () => {
    const draft = await h.as("ops").post("/recruitment/vacancies").send(salesRole({ title: "Draft To Drop" }));
    const dropped = await h.as("ops").post(`/recruitment/vacancies/${draft.body.vacancy_id}/close`).send({ close_reason: "cancelled" });
    expect(dropped.status).toBe(200);
    expect(dropped.body).toMatchObject({ status: "closed", slug: null, public_url: null });

    const made = await h.as("ops").post("/recruitment/vacancies").send(salesRole({ title: "Brand Designer", publish: true }));
    expect(made.body).toMatchObject({ status: "open", slug: "brand-designer-lagos" });
    const id = made.body.vacancy_id;
    await q("UPDATE vacancy SET closes_at = now() - interval '1 hour' WHERE vacancy_id = $1", [id]);
    expect((await pub().get("/jobs/brand-designer-lagos")).body.state).toBe("closed");
    expect((await pub().get("/jobs?q=brand")).body.page.total).toBe(0);
    expect((await pub().post("/jobs/brand-designer-lagos/apply").send({})).status).toBe(404);
    expect((await h.as("ops").get(`/recruitment/vacancies/${id}`)).body.past_closing).toBe(true);

    await h.as("ops").post(`/recruitment/vacancies/${id}/pause`).send({});
    const resumed = await h.as("ops").post(`/recruitment/vacancies/${id}/resume`).send({});
    expect(resumed.status).toBe(422);
    expect(resumed.body.error.fields.closes_on).toEqual(["Its closing day has passed"]);
    const later = await h.as("ops").patch(`/recruitment/vacancies/${id}`).send({ closes_on: closesOn() });
    expect(later.status).toBe(200);
    expect((await h.as("ops").post(`/recruitment/vacancies/${id}/resume`).send({})).body.status).toBe("open");

    const cancelled = await h.as("ops").post(`/recruitment/vacancies/${id}/close`).send({ close_reason: "cancelled" });
    expect(cancelled.body.status).toBe("closed");
    expect((await pub().get("/jobs/brand-designer-lagos")).body.state).toBe("closed");
  });

  test("the careers page pages in 25s; two roles of the same title and city get their own slugs", async () => {
    for (let i = 0; i < 26; i += 1) {
      const r = await h.as("ops").post("/recruitment/vacancies").send(salesRole({ title: "Sales Associate", publish: true }));
      expect(r.status).toBe(201);
    }
    const slugsMade = (await q("SELECT slug::text FROM vacancy WHERE title = 'Sales Associate' ORDER BY slug")).rows.map((r) => r.slug);
    expect(new Set(slugsMade).size).toBe(26);
    expect(slugsMade).toContain("sales-associate-lagos");
    expect(slugsMade).toContain("sales-associate-lagos-26");
    const first = await pub().get("/jobs?q=sales%20associate");
    expect(first.body.data).toHaveLength(25);
    expect(first.body.page.total).toBe(26);
    expect((await pub().get("/jobs?q=sales%20associate&page=2")).body.data).toHaveLength(1);
  });
});
