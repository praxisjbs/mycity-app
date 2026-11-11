"use strict";
/**
 * Recruitment · the hand-over to M5 (docs/guides/recruitment.md §6.3, §6.1; #79, 06/11/2026): Offer
 * and the stages after it set only by M5's steps (candidates.advanceIn, offerEndedIn, hireIn), the
 * hire filling the vacancy's Organogram seat and closing the vacancy as filled, the board's Offer
 * column, and Close Vacancy's Not Progress All leaving a candidate at Offer as they stand. The real
 * migrations on a throwaway database, the whole app through HTTP for what a screen reads.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/recruitment-hire
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

const { rebuild } = require("./helpers/schema");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const lagos = require("../../src/shared/time/lagos");
const token = require("../../src/shared/places/token");
const { atomically } = require("../../src/shared/db/tx");
const { one, drain, harness } = require("./helpers/ai-actions");
const candidates = require("../../src/modules/candidates/candidates.service");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const area = (formatted) =>
  token.sign({ source: "search", formatted, lat: 6.45, lon: 3.42, provider_id: `test:${formatted}`, kind: "area", city: "Lagos", state: "Lagos", country_code: "ng", timezone: "Africa/Lagos", verified: true, pending: false });

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<< /Type /Catalog >>endobj\ntrailer<< /Root 1 0 R >>\n%%EOF\n");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

describeDb("Recruitment · the hand-over to M5 against the real migrations", () => {
  let app;
  let h;
  let dept;
  let actor;
  const pub = () => ({ post: (path) => request(app).post(`/api/public/v1${path}`).set("X-Forwarded-For", h.nextIp()) });

  /** A published role, from a seat when one is named. */
  const role = async (title, over = {}) => {
    const made = await h.as("ops").post("/recruitment/vacancies").send({
      title,
      department_id: dept,
      hiring_manager_id: h.people.ops.employee_id,
      positions: 1,
      employment_type: "full_time",
      work_pattern: "hybrid",
      location: { token: area("Yaba, Lagos") },
      description: "The role plans and runs the partnerships that bring Lagos's restaurants, venues and shops onto MyCityApp each week.",
      requirements: "Three years in partnerships or sales, in Lagos.",
      closes_on: lagos.addDays(lagos.today(), 30),
      publish: true,
      ...over,
    });
    expect(made.status).toBe(201);
    return made.body;
  };

  /** One application through Apply, as a stranger makes it; its id. */
  const apply = async (slug, name, email) => {
    const tok = (await pub().post(`/jobs/${slug}/apply`).send({})).body.token;
    const cv = await pub().post(`/apply/${tok}/cv`).field("purpose", "cv").attach("file", PDF, { filename: "cv.pdf", contentType: "application/pdf" });
    const made = await pub()
      .post(`/apply/${tok}`)
      .send({ full_name: name, email, phone: "+2348031234567", years_experience: 4, cover_letter: "I have built partnerships for two Lagos brands and want to do it for the whole city.", answers: {}, consent: true, cv_document_id: cv.body.document_id });
    expect(made.status).toBe(201);
    return (await one("SELECT application_id FROM application WHERE number = $1", [made.body.reference])).application_id;
  };

  const shortlist = async (id) => expect((await h.as("ops").post(`/recruitment/candidates/${id}/move`).send({ stage: "shortlist" })).status).toBe(200);
  const stageOf = async (id) => one("SELECT stage, status FROM application WHERE application_id = $1", [id]);

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    h = harness(app);
    await h.makePeople([
      { who: "ops", first: "Ada", last: "Obi", email: "ops@mycity.test", job: "Operations & People Lead", role: "operations_people", password: "Opera!ions2026", department: "Operations" },
      { who: "hire", first: "Bisi", last: "Ade", email: "bisi.ade@mycity.test", job: "Partnerships Associate", role: "employee", password: "Partner$hips2026", department: "Programmes" },
      { who: "team", first: "Femi", last: "Eze", email: "femi.eze@mycity.test", job: "Partnerships Officer", role: "employee", password: "Officer#Lagos2026", department: "Operations" },
    ]);
    await grantsCache.bumpTeamVersion();
    await drain();
    dept = (await one("SELECT department_id FROM department WHERE name = 'Operations'")).department_id;
    actor = { user_id: h.people.ops.user_id, employee_id: h.people.ops.employee_id };
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

  test("Offer is a column of the board, never a hand move; Not Progress All leaves a candidate at Offer", async () => {
    const v = await role("Sales Associate");
    expect(v.board_stages).toEqual(["application", "screening", "assessment", "interview", "shortlist", "offer"]);
    const offered = await apply(v.slug, "Kemi Bello", "kemi.bello@example.test");
    const waiting = await apply(v.slug, "Tobi Lawal", "tobi.lawal@example.test");
    await shortlist(offered);

    // By hand, nobody reaches Offer, and Shortlist offers no move into it.
    const sheet = await h.as("ops").get(`/recruitment/candidates/${offered}`);
    expect(sheet.body.next_stages).not.toContain("offer");
    expect((await h.as("ops").post(`/recruitment/candidates/${offered}/move`).send({ stage: "offer" })).status).toBe(422);

    // M5's step: an offer sent moves the card to Offer; it skips no stage.
    expect(await tx((c) => candidates.advanceIn(c, actor, waiting, "offer"))).toBe(false);
    expect(await tx((c) => candidates.advanceIn(c, actor, offered, "documentation"))).toBe(false);
    expect(await tx((c) => candidates.advanceIn(c, actor, offered, "offer"))).toBe(true);
    const column = await h.as("ops").get(`/recruitment/candidates?vacancy_id=${v.vacancy_id}&stage=offer&status=active`);
    expect(column.body.data).toEqual([expect.objectContaining({ application_id: offered, stage: "offer", next_stages: [] })]);
    expect((await h.as("ops").post(`/recruitment/candidates/${offered}/move`).send({ stage: "shortlist" })).status).toBe(409);

    // An offer that ends unsigned takes the card back to Shortlist, so another can be made.
    expect(await tx((c) => candidates.offerEndedIn(c, actor, offered, "The offer was declined"))).toBe(true);
    expect(await stageOf(offered)).toEqual({ stage: "shortlist", status: "active" });
    expect(await tx((c) => candidates.advanceIn(c, actor, offered, "offer"))).toBe(true);

    // Only the one still at an M4 stage counts as in progress, and only they are told at Close.
    expect((await h.as("ops").get(`/recruitment/vacancies/${v.vacancy_id}`)).body.in_progress).toBe(1);
    const closed = await h.as("ops").post(`/recruitment/vacancies/${v.vacancy_id}/close`).send({ close_reason: "on_hold", not_progress: true });
    expect(closed.status).toBe(200);
    expect(await stageOf(waiting)).toEqual({ stage: "application", status: "not_progressed" });
    expect(await stageOf(offered)).toEqual({ stage: "offer", status: "active" });
  });

  test("the hire: onboarding to Hired, the seat filled by the new employee, the vacancy closed as filled", async () => {
    const seat = await one(
      "INSERT INTO org_seat (title, department_id, status, line_manager_id) VALUES ('Partnerships Associate', $1, 'vacant', $2) RETURNING org_seat_id",
      [dept, h.people.ops.employee_id],
    );
    // Someone already reports to the empty seat; they will report to whoever fills it.
    await pool.query("UPDATE employee SET line_manager_id = NULL, line_manager_seat_id = $1 WHERE employee_id = $2", [seat.org_seat_id, h.people.team.employee_id]);
    const v = await role("Partnerships Associate", { org_seat_id: seat.org_seat_id });
    const id = await apply(v.slug, "Bisi Ade", "bisi.ade@example.test");
    await shortlist(id);

    // Hired comes only from Onboarding, one step at a time.
    await expect(tx((c) => candidates.hireIn(c, actor, id, { employee_id: h.people.hire.employee_id }))).rejects.toMatchObject({ status: 409 });
    for (const stage of ["offer", "documentation", "pre_onboarding", "onboarding"])
      expect(await tx((c) => candidates.advanceIn(c, actor, id, stage))).toBe(true);
    expect(await tx((c) => candidates.advanceIn(c, actor, id, "hired"))).toBe(false);

    const done = await tx((c) => candidates.hireIn(c, actor, id, { employee_id: h.people.hire.employee_id }));
    expect(done).toEqual({ application_id: id, seat_filled: true, vacancy_closed: true });
    expect(await stageOf(id)).toEqual({ stage: "hired", status: "hired" });
    const moves = await pool.query(
      "SELECT to_state FROM entity_state_history WHERE entity_type = 'application' AND entity_id = $1 ORDER BY changed_at",
      [id],
    );
    expect(moves.rows.map((r) => r.to_state).slice(-6)).toEqual(["shortlist", "offer", "documentation", "pre_onboarding", "onboarding", "hired"]);

    // The seat is filled and leaves the chart; the person stands in its place.
    expect(await one("SELECT status, filled_by_employee_id FROM org_seat WHERE org_seat_id = $1", [seat.org_seat_id])).toEqual({ status: "filled", filled_by_employee_id: h.people.hire.employee_id });
    expect(await one("SELECT department_id, line_manager_id FROM employee WHERE employee_id = $1", [h.people.hire.employee_id])).toEqual({ department_id: dept, line_manager_id: h.people.ops.employee_id });
    expect(await one("SELECT line_manager_id, line_manager_seat_id FROM employee WHERE employee_id = $1", [h.people.team.employee_id])).toEqual({ line_manager_id: h.people.hire.employee_id, line_manager_seat_id: null });

    // Every opening is filled: the vacancy closes as filled, and the board no longer shows the hire.
    expect(await one("SELECT status, close_reason FROM vacancy WHERE vacancy_id = $1", [v.vacancy_id])).toEqual({ status: "closed", close_reason: "filled" });
    const board = await h.as("ops").get(`/recruitment/candidates?vacancy_id=${v.vacancy_id}&status=active`);
    expect(board.body.data).toEqual([]);
    const events = await pool.query("SELECT event_key FROM event_log WHERE event_key IN ('application.hired', 'org_seat.filled', 'vacancy.closed')");
    expect(events.rows.map((r) => r.event_key)).toEqual(expect.arrayContaining(["application.hired", "org_seat.filled", "vacancy.closed"]));
  });

  test("Candidate Emails lists M5's three with M4's five", async () => {
    const list = await h.as("ops").get("/recruitment/candidates/emails");
    expect(list.status).toBe(200);
    expect(list.body.data.map((e) => e.key)).toEqual([
      "application-received",
      "apply-invite",
      "assessment-invite",
      "interview-invite",
      "candidate-not-progressed",
      "offer-sent",
      "offer-signed",
      "contract-sent",
      "onboarding-documents",
    ]);
    const offer = list.body.data.find((e) => e.key === "offer-sent");
    expect(offer).toMatchObject({ name: "Offer Sent", is_default: true });
    expect(offer.variables).toEqual(expect.arrayContaining(["vacancy_title", "reference", "sign_url", "expires_at"]));
    expect(offer.body).toContain("[Read and Sign Your Offer]({{ sign_url }})");
  });
});
