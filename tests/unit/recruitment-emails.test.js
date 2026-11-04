"use strict";
/**
 * The five emails a candidate receives (docs/guides/recruitment.md §6.8): each renders from its
 * shipped default with the contract's variables, names nothing it cannot fill, and says what the
 * candidate needs in plain words, with dates day first in Lagos time.
 *
 * The variables are declared here as the modules declare them in their events files, with the
 * same schema objects, so declaring them twice in one process is allowed.
 */
const c = require("@mycity/contract");
const variables = require("../../src/shared/templates/variables");
const store = require("../../src/shared/templates/template-store");
const mail = require("../../src/services/mail/system-mail.service");

const DECLARED = {
  "application-received": c.candidates.ApplicationReceivedEmailVars,
  "apply-invite": c.candidates.ApplyInviteEmailVars,
  "candidate-not-progressed": c.candidates.CandidateNotProgressedEmailVars,
  "assessment-invite": c.assessments.AssessmentInviteEmailVars,
  "interview-invite": c.interviews.InterviewInviteEmailVars,
};
for (const [key, schema] of Object.entries(DECLARED)) variables.defineVariables("email", key, schema);

/** No stored edits: the shipped wording, as a fresh database renders it. */
const db = { query: async () => ({ rows: [] }) };
const org = { name: "MyCity App Ltd", email: "careers@mycity.test" };
const recipient = { first_name: "Ada", last_name: "Obi", email: "ada@example.test" };
const render = (key, data) => mail.renderEmail(db, key, data, { recipient, org });

const interview = {
  vacancy_title: "Content Producer",
  interview_type: "in_person",
  scheduled_start: "2026-11-10T09:00:00.000Z",
  scheduled_end: "2026-11-10T10:00:00.000Z",
  place: "MyCity App, Lekki Phase 1",
  meeting_url: null,
  rescheduled: false,
  cancelled: false,
};

test.each(Object.keys(DECLARED))("%s is shipped and names only its declared variables", (key) => {
  const t = store.shipped("email", key);
  expect(t).not.toBeNull();
  expect(() => variables.assertTemplate("email", key, `${t.subject || ""}\n${t.title || ""}\n${t.body}`)).not.toThrow();
});

test.each(Object.keys(DECLARED))("%s has no dash a person reads", (key) => {
  const t = store.shipped("email", key);
  expect(`${t.subject}\n${t.body}`).not.toMatch(/[–—]|--/);
});

test("application received gives the role and the reference, and nothing about a score", async () => {
  const out = await render("application-received", { vacancy_title: "Content Producer", reference: "APP-0042" });
  expect(out.subject).toBe("We have your application for Content Producer");
  expect(out.text).toContain("Hello Ada,");
  expect(out.text).toContain("APP-0042");
  expect(out.text).not.toMatch(/score/i);
});

test("an invitation to apply carries the link and when it lapses, day first in Lagos", async () => {
  const url = "https://go.mycityapp.io/apply/tok123";
  const out = await render("apply-invite", {
    vacancy_title: "Content Producer",
    apply_url: url,
    expires_at: "2026-11-11T13:30:00.000Z",
  });
  expect(out.subject).toBe("You are invited to apply for Content Producer");
  expect(out.html).toContain(`href="${url}"`);
  expect(out.text).toContain("11/11/2026 14:30");
});

test("a timed assessment says its minutes and the day to start by", async () => {
  const out = await render("assessment-invite", {
    vacancy_title: "Content Producer",
    assessment_name: "Writing Test",
    duration_minutes: 45,
    due_days: null,
    start_by: "2026-11-12",
    assess_url: "https://go.mycityapp.io/assess/tok456",
  });
  expect(out.text).toContain("45 minutes from when you press Start");
  expect(out.text).toContain("12 November 2026");
  expect(out.text).not.toContain("Days to finish");
});

test("an untimed take-home says how many days it has after Start, never minutes", async () => {
  const out = await render("assessment-invite", {
    vacancy_title: "Graphics Designer",
    assessment_name: "Design Brief",
    duration_minutes: null,
    due_days: 5,
    start_by: "2026-11-12",
    assess_url: "https://go.mycityapp.io/assess/tok789",
  });
  expect(out.text).toContain("Days to finish: 5");
  expect(out.text).toContain("take-home");
  expect(out.text).not.toContain("minutes");
});

test("an interview in person names the place and the time in Lagos", async () => {
  const out = await render("interview-invite", interview);
  expect(out.subject).toBe("Interview invitation: Content Producer");
  expect(out.text).toContain("10/11/2026 10:00");
  expect(out.text).toContain("Lekki Phase 1");
  expect(out.text).toContain("careers@mycity.test");
});

test("an interview by video carries the meeting link", async () => {
  const url = "https://meet.example.test/abc";
  const out = await render("interview-invite", { ...interview, interview_type: "video", place: null, meeting_url: url });
  expect(out.html).toContain(`href="${url}"`);
  expect(out.text).toContain("by video");
});

test("an interview by phone says we will call", async () => {
  const out = await render("interview-invite", { ...interview, interview_type: "phone", place: null });
  expect(out.text).toContain("by phone");
});

test("a moved interview says so in the subject and the opening", async () => {
  const out = await render("interview-invite", { ...interview, rescheduled: true });
  expect(out.subject).toBe("Interview moved: Content Producer");
  expect(out.text).toContain("has moved");
});

test("a cancelled interview says so and drops the joining details", async () => {
  const out = await render("interview-invite", { ...interview, cancelled: true });
  expect(out.subject).toBe("Interview cancelled: Content Producer");
  expect(out.text).toContain("is cancelled");
  expect(out.text).not.toContain("Lekki Phase 1");
});

test("not progressed is kind, final for this role, and never gives the reason", async () => {
  const out = await render("candidate-not-progressed", { vacancy_title: "Content Producer" });
  expect(out.subject).toBe("Your application for Content Producer");
  expect(out.text).toContain("Dear Ada,");
  expect(out.text).toContain("not be taking your application further");
});
