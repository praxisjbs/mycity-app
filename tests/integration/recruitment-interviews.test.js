"use strict";
/**
 * Recruitment · Interviews end to end (docs/guides/recruitment.md §3 steps 8 to 11, §6.6): scheduling
 * with its calendar entry and the candidate's .ics, the blind card, the closing rule, the report and the
 * Interview Assessment Form, on the real migrations through HTTP, every response parsed with its
 * contract (APP_ENV=test). The mail queue is mocked.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/recruitment-interviews
 *
 * Refuses to run unless the database name ends in "_test". Every person here is invented.
 */
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
const reminders = require("../../src/modules/interviews/interviews.reminders");
const { q, one, drain, harness } = require("./helpers/ai-actions");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const area = (formatted) =>
  token.sign({ source: "search", formatted, lat: 6.45, lon: 3.42, provider_id: `test:${formatted}`, kind: "area", city: "Lagos", state: "Lagos", country_code: "ng", timezone: "Africa/Lagos", verified: true, pending: false });

const mails = (template) => queues.enqueue.mock.calls.filter((c) => c[0] === "email-send" && c[1] === template).map((c) => c[2]);
const at = (days, hour) => new Date(Date.now() + days * 86_400_000 + hour * 3_600_000).toISOString();

describeDb("Recruitment · Interviews against the real migrations", () => {
  let app;
  let h;
  let vacancyId;
  let traits;
  let applicationId;
  let interviewId;

  async function applicant(first, email, stage = "screening") {
    const k = await one("INSERT INTO candidate (first_name, last_name, email) VALUES ($1, 'Okafor', $2) RETURNING candidate_id", [first, email]);
    const n = (await one("SELECT count(*)::int AS n FROM application")).n + 1;
    const a = await one(
      "INSERT INTO application (number, vacancy_id, candidate_id, source, stage, status) VALUES ($1, $2, $3, 'careers', $4, 'active') RETURNING application_id",
      [`APP-${String(n).padStart(4, "0")}`, vacancyId, k.candidate_id, stage],
    );
    return a.application_id;
  }

  const panelOf = () => [h.people.ops.employee_id, h.people.hod.employee_id];

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    h = harness(app);
    await h.makePeople([
      { who: "ops", first: "Ada", last: "Obi", email: "ops@mycity.test", job: "Operations & People Lead", role: "operations_people", password: "Opera!ions2026", department: "Operations" },
      { who: "hod", first: "Ife", last: "Ojo", email: "hod@mycity.test", job: "Head of Programmes", role: "head_of_department", password: "Head#Programmes26", department: "Programmes" },
      { who: "staff", first: "Tunde", last: "Ade", email: "tunde@mycity.test", job: "Field Officer", role: "employee", password: "Staff#Member2026", department: "Programmes" },
    ]);
    await grantsCache.bumpTeamVersion();
    await drain();
    const dept = (await one("SELECT department_id FROM department WHERE name = 'Operations'")).department_id;
    const made = await h.as("ops").post("/recruitment/vacancies").send({
      title: "Partnerships Manager",
      department_id: dept,
      hiring_manager_id: h.people.ops.employee_id,
      positions: 1,
      employment_type: "full_time",
      work_pattern: "hybrid",
      location: { token: area("Lekki, Lagos") },
      description: "The Partnerships Manager signs and grows the venues, brands and creators that make MyCityApp's city guides worth opening.",
      requirements: "Five years closing partnerships in media or hospitality.",
      closes_on: lagos.addDays(lagos.today(), 30),
      publish: true,
    });
    vacancyId = made.body.vacancy_id;
    const qs = await h.as("ops").put(`/recruitment/vacancies/${vacancyId}/questions`).send({
      questions: [
        { purpose: "interview", question_type: "rating", prompt: "Level of Confidence" },
        { purpose: "interview", question_type: "rating", prompt: "Job Knowledge and Experience" },
      ],
    });
    traits = qs.body.questions.map((x) => x.vacancy_question_id);
    applicationId = await applicant("Chidi", "chidi.okafor@example.test");
  }, 120_000);

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("Schedule: the panel holds Recruitment, the candidate moves to Interview, the panel's calendars and the candidate's .ics follow", async () => {
    const base = { application_id: applicationId, interview_type: "video", scheduled_start: at(2, 0), scheduled_end: at(2, 1), meeting_url: "https://meet.example.test/abc" };
    const refused = await h.as("ops").post("/recruitment/interviews").send({ ...base, panel_employee_ids: [h.people.staff.employee_id] });
    expect(refused.status).toBe(422);
    expect(refused.body.error.fields).toHaveProperty("panel_employee_ids");
    expect((await h.as("ops").post("/recruitment/interviews").send({ ...base, interview_type: "in_person", meeting_url: undefined, panel_employee_ids: panelOf() })).status).toBe(422);

    const made = await h.as("ops").post("/recruitment/interviews").send({ ...base, panel_employee_ids: panelOf() });
    expect(made.status).toBe(201);
    interviewId = made.body.interview_id;
    expect(made.body).toMatchObject({ status: "scheduled", round_status: "open", panel_size: 2, on_panel: true, can_close: false, can_report: false });
    expect(made.body.round).toMatchObject({ round_number: 1, title: "Interview 1" });
    expect(made.body.questions.map((x) => x.prompt)).toEqual(["Level of Confidence", "Job Knowledge and Experience"]);
    expect(await one("SELECT stage FROM application WHERE application_id = $1", [applicationId])).toEqual({ stage: "interview" });
    const entry = await one(
      "SELECT ce.event_type, ce.entity_type, (SELECT count(*)::int FROM calendar_event_attendee x WHERE x.calendar_event_id = ce.calendar_event_id) AS attendees FROM calendar_event ce JOIN interview i ON i.calendar_event_id = ce.calendar_event_id WHERE i.interview_id = $1",
      [interviewId],
    ).catch(() => one("SELECT ce.event_type, ce.entity_type FROM calendar_event ce JOIN interview i ON i.calendar_event_id = ce.calendar_event_id WHERE i.interview_id = $1", [interviewId]));
    expect(entry).toMatchObject({ event_type: "interview", entity_type: "interview" });
    // The entry is kept by the interview: Calendar refuses to move or call it off on its own.
    const { calendar_event_id: entryId } = await one("SELECT calendar_event_id FROM interview WHERE interview_id = $1", [interviewId]);
    expect((await h.as("ops").post(`/calendar/${entryId}/cancel`).send({})).status).toBe(409);
    expect((await h.as("ops").patch(`/calendar/${entryId}`).send({ title: "Something else" })).status).toBe(409);

    await drain();
    const [invite] = mails("interview-invite");
    expect(invite.to.email).toBe("chidi.okafor@example.test");
    expect(invite.data).toMatchObject({ vacancy_title: "Partnerships Manager", by_video: true, in_person: false, meeting_url: "https://meet.example.test/abc", rescheduled: false, cancelled: false });
    expect(invite.attachments).toHaveLength(1);
    // The Head of Department, invited by the scheduler, hears through their calendar.
    expect(mails("calendar-invite").map((m) => m.to.email)).toContain("hod@mycity.test");
  });

  test("the card is blind while the round is open: a panelist reads only their own, private notes never travel", async () => {
    const draft = await h.as("hod").put(`/recruitment/interviews/${interviewId}/feedback`).send({
      ratings: [{ vacancy_question_id: traits[0], rating: 9 }],
      decision: "select",
      comments: "Clear about how she would open hotel partnerships.",
      private_notes: "Ask the hiring manager about the notice period",
    });
    expect(draft.status).toBe(200);
    expect(draft.body.my_feedback).toMatchObject({ decision: "select", private_notes: "Ask the hiring manager about the notice period" });

    const seen = await h.as("ops").get(`/recruitment/interviews/${interviewId}`);
    const theirs = seen.body.panel.find((s) => s.panelist.employee_id === h.people.hod.employee_id);
    expect(theirs).toMatchObject({ score: null, decision: null, comments: null, ratings: null, submitted_at: null });
    expect(JSON.stringify(seen.body)).not.toContain("notice period");
    expect(JSON.stringify(seen.body)).not.toContain("hotel partnerships");

    const early = await h.as("hod").post(`/recruitment/interviews/${interviewId}/feedback/submit`).send({});
    expect(early.status).toBe(422);
    expect(early.body.error.fields).toHaveProperty("ratings");
    expect((await h.as("hod").put(`/recruitment/interviews/${interviewId}/feedback`).send({ ratings: [{ vacancy_question_id: applicationId, rating: 5 }] })).status).toBe(422);
    expect((await h.as("staff").put(`/recruitment/interviews/${interviewId}/feedback`).send({ decision: "select" })).status).toBe(403);
  });

  test("the last card closes the round: score × 10, every submitted card and each trait's average then shown, notes still private", async () => {
    // A mis-tapped star is taken back off the draft, then the right one given.
    await h.as("hod").put(`/recruitment/interviews/${interviewId}/feedback`).send({ ratings: [{ vacancy_question_id: traits[1], rating: 3 }] });
    const cleared = await h.as("hod").put(`/recruitment/interviews/${interviewId}/feedback`).send({ ratings: [{ vacancy_question_id: traits[1], rating: null }] });
    expect(cleared.body.my_feedback.ratings.map((r) => r.vacancy_question_id)).toEqual([traits[0]]);
    await h.as("hod").put(`/recruitment/interviews/${interviewId}/feedback`).send({ ratings: [{ vacancy_question_id: traits[1], rating: 7 }] });
    const first = await h.as("hod").post(`/recruitment/interviews/${interviewId}/feedback/submit`).send({});
    expect(first.body).toMatchObject({ round_status: "open", submitted_count: 1, my_submitted: true });
    expect((await h.as("hod").put(`/recruitment/interviews/${interviewId}/feedback`).send({ decision: "reject" })).status).toBe(409);
    // The other panelist still sees no rating of the submitted card.
    expect((await h.as("ops").get(`/recruitment/interviews/${interviewId}`)).body.panel.find((s) => s.submitted_at).score).toBe(null);

    await h.as("ops").put(`/recruitment/interviews/${interviewId}/feedback`).send({
      ratings: [
        { vacancy_question_id: traits[0], rating: 6 },
        { vacancy_question_id: traits[1], rating: 8 },
      ],
      decision: "on_hold",
    });
    const closed = await h.as("ops").post(`/recruitment/interviews/${interviewId}/feedback/submit`).send({});
    // Cards 8 (9 and 7) and 7 (6 and 8): (8 + 7) ÷ 2 × 10
    expect(closed.body).toMatchObject({ round_status: "closed", status: "done", can_report: true });
    expect(closed.body.round.interview_score).toBe(75);
    expect(closed.body.trait_averages.map((t) => t.average)).toEqual([7.5, 7.5]);
    expect(closed.body.panel.map((s) => s.score).sort()).toEqual([7, 8]);
    expect(JSON.stringify(closed.body)).not.toContain("notice period");
    // The interview part of the candidate's scorecard is the round's score.
    const candidate = await h.as("ops").get(`/recruitment/candidates/${applicationId}`);
    expect(candidate.body.scorecard.find((p) => p.code === "interview")).toMatchObject({ score: 75 });
  });

  test("the report, once closed, makes the Interview Assessment Form; Candidate Details are checked against the total", async () => {
    expect((await h.as("ops").put(`/recruitment/interviews/${interviewId}/details`).send({ total_experience_months: 60, relevant_experience_months: 72 })).status).toBe(422);
    const details = await h.as("ops").put(`/recruitment/interviews/${interviewId}/details`).send({ current_employer: "A Lagos events company", academics: "very_good", total_experience_months: 72, relevant_experience_months: 48 });
    expect(details.body.round).toMatchObject({ academics: "very_good", relevant_experience_months: 48 });

    const reported = await h.as("ops").put(`/recruitment/interviews/${interviewId}/report`).send({
      report: "Strong on partner pipelines and confident with brands; needs support on hospitality contracts.",
      decision: "select",
    });
    expect(reported.status).toBe(200);
    expect(reported.body.round).toMatchObject({ decision: "select", reported_by_name: "Ada Obi" });
    const form = await one("SELECT doc_type, render_status, entity_type FROM document WHERE document_id = $1", [reported.body.round.form_document_id]);
    expect(form).toMatchObject({ doc_type: "interview_assessment_form", entity_type: "interview" });
    expect((await h.as("staff").put(`/recruitment/interviews/${interviewId}/report`).send({ report: "x".repeat(50), decision: "reject" })).status).toBe(403);
    // A panelist with only their team's grant, on a role they do not manage, cannot write it.
    expect([403, 404]).toContain((await h.as("hod").put(`/recruitment/interviews/${interviewId}/report`).send({ report: "x".repeat(50), decision: "reject" })).status);
  });

  test("Reschedule tells the candidate only of a new time or place; Not Progressing cancels what is still scheduled", async () => {
    const second = await applicant("Ngozi", "ngozi.okafor@example.test", "interview");
    const made = await h.as("ops").post("/recruitment/interviews").send({
      application_id: second,
      interview_type: "phone",
      scheduled_start: at(3, 0),
      scheduled_end: at(3, 1),
      panel_employee_ids: [h.people.ops.employee_id],
    });
    const id = made.body.interview_id;
    await drain();
    queues.enqueue.mockClear();
    await h.as("ops").patch(`/recruitment/interviews/${id}`).send({ panel_employee_ids: panelOf() });
    await drain();
    expect(mails("interview-invite")).toEqual([]);
    await h.as("ops").patch(`/recruitment/interviews/${id}`).send({ scheduled_start: at(4, 0), scheduled_end: at(4, 1) });
    await drain();
    expect(mails("interview-invite")).toEqual([expect.objectContaining({ data: expect.objectContaining({ rescheduled: true, by_phone: true }) })]);
    // A report before the round closes is refused.
    expect((await h.as("ops").put(`/recruitment/interviews/${id}/report`).send({ report: "x".repeat(50), decision: "reject" })).status).toBe(409);

    queues.enqueue.mockClear();
    await h.as("ops").post(`/recruitment/candidates/${second}/not-progressed`).send({ rejection_reason: "Took a role elsewhere before the interview" });
    await drain();
    expect(await one("SELECT status FROM interview WHERE interview_id = $1", [id])).toEqual({ status: "cancelled" });
    expect(await one("SELECT cancelled_at IS NOT NULL AS off FROM calendar_event ce JOIN interview i ON i.calendar_event_id = ce.calendar_event_id WHERE i.interview_id = $1", [id])).toEqual({ off: true });
    expect(mails("interview-invite")).toEqual([expect.objectContaining({ data: expect.objectContaining({ cancelled: true }) })]);
  });

  test("a panelist outside the vacancy's scope sees the interviews they sit on; Close Round scores the cards that are in; reminders name no candidate", async () => {
    const third = await applicant("Emeka", "emeka.okafor@example.test");
    const made = await h.as("ops").post("/recruitment/interviews").send({
      application_id: third,
      interview_type: "phone",
      scheduled_start: at(-1, 0),
      scheduled_end: at(-1, 1),
      panel_employee_ids: panelOf(),
    });
    const id = made.body.interview_id;
    const mine = await h.as("hod").get("/recruitment/interviews?mine=true");
    expect(mine.body.data.map((x) => x.interview_id)).toContain(id);
    expect((await h.as("hod").get(`/recruitment/interviews/${id}`)).status).toBe(200);

    await q("DELETE FROM event_outbox WHERE event_key = 'interview.feedback_due'");
    expect(await reminders.remind()).toEqual({ reminded: 2 });
    await reminders.remind();
    expect(await one("SELECT count(*)::int AS n FROM event_outbox WHERE event_key = 'interview.feedback_due'")).toEqual({ n: 2 });
    const payload = await one("SELECT payload::text AS p FROM event_log WHERE event_key = 'interview.feedback_due' LIMIT 1");
    expect(payload.p).not.toContain("Emeka");

    await h.as("hod").put(`/recruitment/interviews/${id}/feedback`).send({
      ratings: [
        { vacancy_question_id: traits[0], rating: 5 },
        { vacancy_question_id: traits[1], rating: 6 },
      ],
      decision: "reject",
    });
    await h.as("hod").post(`/recruitment/interviews/${id}/feedback/submit`).send({});
    await h.as("ops").put(`/recruitment/interviews/${id}/feedback`).send({ decision: "select" });
    const closed = await h.as("ops").post(`/recruitment/interviews/${id}/close`).send({});
    expect(closed.body.round).toMatchObject({ status: "closed", interview_score: 55 });
    // The draft never became a card: it stays the author's.
    const theirs = (await h.as("hod").get(`/recruitment/interviews/${id}`)).body.panel.find((s) => s.panelist.employee_id === h.people.ops.employee_id);
    expect(theirs).toMatchObject({ decision: null, submitted_at: null });
    expect((await h.as("ops").post(`/recruitment/interviews/${id}/close`).send({})).status).toBe(409);
  });
});
