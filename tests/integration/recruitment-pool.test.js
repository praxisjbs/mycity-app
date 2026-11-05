"use strict";
/**
 * Recruitment · Talent Pool end to end (docs/guides/recruitment.md §3 step 13, §6.9): Add to Pool and
 * renewing, Invite to Apply through the candidates module (source pool), Remove, the 24-month purge and
 * the export, on the real migrations through HTTP, every response parsed with its contract.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/recruitment-pool
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
const retention = require("../../src/modules/talent_pool/talent_pool.retention");
const { q, one, drain, harness } = require("./helpers/ai-actions");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const area = (formatted) =>
  token.sign({ source: "search", formatted, lat: 6.45, lon: 3.42, provider_id: `test:${formatted}`, kind: "area", city: "Lagos", state: "Lagos", country_code: "ng", timezone: "Africa/Lagos", verified: true, pending: false });

/** A PDF as small as one can be: what the type check reads. */
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<< /Type /Catalog >>endobj\ntrailer<< /Root 1 0 R >>\n%%EOF\n");

describeDb("Recruitment · Talent Pool against the real migrations", () => {
  let app;
  let h;
  let first;
  let second;
  let applicationId;
  let entryId;
  const pub = () => ({
    get: (path) => request(app).get(`/api/public/v1${path}`).set("X-Forwarded-For", h.nextIp()),
    post: (path) => request(app).post(`/api/public/v1${path}`).set("X-Forwarded-For", h.nextIp()),
  });

  async function role(title) {
    const dept = (await one("SELECT department_id FROM department WHERE name = 'Operations'")).department_id;
    const made = await h.as("ops").post("/recruitment/vacancies").send({
      title,
      department_id: dept,
      hiring_manager_id: h.people.ops.employee_id,
      positions: 1,
      employment_type: "full_time",
      work_pattern: "hybrid",
      location: { token: area("Surulere, Lagos") },
      description: `The ${title} keeps MyCityApp's city guides full, accurate and worth opening every week, working with venues and creators.`,
      requirements: "Three years in a related role in Lagos.",
      closes_on: lagos.addDays(lagos.today(), 30),
      publish: true,
    });
    return made.body;
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
    first = await role("City Editor");
    second = await role("Venue Partnerships Lead");
    const k = await one("INSERT INTO candidate (first_name, last_name, email) VALUES ('Funke', 'Adebayo', 'funke.adebayo@example.test') RETURNING candidate_id");
    applicationId = (
      await one(
        "INSERT INTO application (number, vacancy_id, candidate_id, source, stage, status, provisional_score) VALUES ('APP-9001', $1, $2, 'careers', 'interview', 'not_progressed', 64) RETURNING application_id",
        [first.vacancy_id, k.candidate_id],
      )
    ).application_id;
  }, 120_000);

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("Add to Pool keeps a person 24 months with why; adding them again renews it, never twice", async () => {
    const added = await h.as("ops").post("/recruitment/pool").send({ application_id: applicationId, reason: "Strong writer, the role went to an internal move" });
    expect(added.status).toBe(201);
    entryId = added.body.talent_pool_entry_id;
    expect(added.body).toMatchObject({ name: "Funke Adebayo", score: 64, score_provisional: true, applied_for: { title: "City Editor" }, invited_at: null });
    const years = (Date.parse(added.body.expires_at) - Date.parse(added.body.created_at)) / (365 * 86_400_000);
    expect(years).toBeGreaterThan(1.99);
    const again = await h.as("ops").post("/recruitment/pool").send({ application_id: applicationId, reason: "Still the strongest writer we met" });
    expect(again.body).toMatchObject({ talent_pool_entry_id: entryId, reason: "Still the strongest writer we met" });
    expect(await one("SELECT count(*)::int AS n FROM talent_pool_entry")).toEqual({ n: 1 });
    const figures = await h.as("ops").get("/recruitment/pool/summary");
    expect(figures.body).toEqual({ in_pool: 1, invited_back: 0, hired_from_pool: 0, average_score: 64 });
    // Scope is the hiring manager of the role applied for.
    expect((await h.as("hod").get("/recruitment/pool")).body.page.total).toBe(0);
    // One entry by its id (a ⌘K link past the first page), within the same scope.
    expect((await h.as("ops").get(`/recruitment/pool/${entryId}`)).body).toMatchObject({ talent_pool_entry_id: entryId, name: "Funke Adebayo" });
    expect((await h.as("hod").get(`/recruitment/pool/${entryId}`)).status).toBe(404);
    expect((await h.as("hod").post(`/recruitment/pool/${entryId}/invite`).send({ vacancy_id: second.vacancy_id })).status).toBe(404);
    // Two adds at once for one person: one entry, renewed, never a 500.
    const both = await Promise.all([
      h.as("ops").post("/recruitment/pool").send({ application_id: applicationId, reason: "Pressed on one screen" }),
      h.as("ops").post("/recruitment/pool").send({ application_id: applicationId, reason: "Pressed on another screen" }),
    ]);
    expect(both.map((r) => r.status)).toEqual([201, 201]);
    expect(await one("SELECT count(*)::int AS n FROM talent_pool_entry WHERE removed_at IS NULL")).toEqual({ n: 1 });
  });

  test("Invite to Apply mails an Apply link for an open role; the application it leads to comes from the pool", async () => {
    const invited = await h.as("ops").post(`/recruitment/pool/${entryId}/invite`).send({ vacancy_id: second.vacancy_id });
    expect(invited.status).toBe(200);
    expect(invited.body).toMatchObject({ invited_vacancy: { title: "Venue Partnerships Lead" } });
    expect(invited.body.invited_at).toBeTruthy();
    // Inviting them to the role they already applied for is refused.
    expect((await h.as("ops").post(`/recruitment/pool/${entryId}/invite`).send({ vacancy_id: first.vacancy_id })).status).toBe(422);
    await drain();
    const mail = queues.enqueue.mock.calls.filter((c) => c[1] === "apply-invite").map((c) => c[2]);
    expect(mail).toHaveLength(1);
    expect(mail[0].to.email).toBe("funke.adebayo@example.test");
    const tok = mail[0].data.apply_url.split("/apply/")[1];
    const cv = await pub().post(`/apply/${tok}/cv`).attach("file", PDF, { filename: "cv.pdf", contentType: "application/pdf" });
    const applied = await pub().post(`/apply/${tok}`).send({
      full_name: "Funke Adebayo",
      email: "funke.adebayo@example.test",
      phone: "+2348031234567",
      years_experience: 4,
      cover_letter: "I would love another go at MyCityApp, this time with venues and partners across Lagos.",
      cv_document_id: cv.body.document_id,
      answers: {},
      consent: true,
    });
    expect(applied.status).toBe(201);
    expect(await one("SELECT source FROM application WHERE number = $1", [applied.body.reference])).toEqual({ source: "pool" });
    expect(await one("SELECT count(*)::int AS n FROM talent_pool_invite")).toEqual({ n: 1 });
    expect((await h.as("ops").get("/recruitment/pool?invited=true")).body.page.total).toBe(1);
  });

  test("Export makes the whole pool a workbook for the person who pressed it", async () => {
    const started = await h.as("ops").post("/recruitment/pool/exports").send({});
    expect(started.status).toBe(202);
    await drain();
    const doc = await one("SELECT doc_type, sensitivity FROM document WHERE document_id = $1", [started.body.document_id]);
    expect(doc).toEqual({ doc_type: "talent_pool_export", sensitivity: "restricted" });
    // The file is for the person who asked: another holder of Recruitment cannot open it.
    expect((await h.as("hod").get(`/documents/${started.body.document_id}/content`)).status).not.toBe(200);
  });

  test("Remove takes a person off early; talent-pool-purge takes off those whose 24 months have ended", async () => {
    const removed = await h.as("ops").post(`/recruitment/pool/${entryId}/remove`).send({ removed_reason: "Took a role elsewhere" });
    expect(removed.status).toBe(200);
    expect(removed.body.removed_at).toBeTruthy();
    expect((await h.as("ops").get("/recruitment/pool")).body.page.total).toBe(0);
    expect((await h.as("ops").post(`/recruitment/pool/${entryId}/remove`).send({})).status).toBe(404);

    const back = await h.as("ops").post("/recruitment/pool").send({ application_id: applicationId, reason: "Back in the pool after all" });
    expect(back.body.talent_pool_entry_id).not.toBe(entryId);
    await q("UPDATE talent_pool_entry SET expires_at = now() - interval '1 minute', created_at = now() - interval '25 months' WHERE talent_pool_entry_id = $1", [
      back.body.talent_pool_entry_id,
    ]);
    expect(await retention.purge()).toEqual({ removed: 1 });
    expect(await one("SELECT removed_reason FROM talent_pool_entry WHERE talent_pool_entry_id = $1", [back.body.talent_pool_entry_id])).toEqual({
      removed_reason: "Kept 24 months",
    });
    expect(await retention.purge()).toEqual({ removed: 0 });
  });
});
