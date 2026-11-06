"use strict";
/**
 * The five emails a candidate receives (docs/guides/recruitment.md §6.8): each renders from its
 * shipped default with the contract's variables, names nothing it cannot fill, and says what the
 * candidate needs in plain words, with dates day first in Lagos time. The defaults ship as
 * Markdown, so an edit or Restore Default renders exactly what was shipped.
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
/** A database whose current version is `t` (an edit, or Restore Default saving the shipped words). */
const dbWith = (t) => ({ query: async () => ({ rows: [t] }) });
const org = { name: "MyCity App Ltd", email: "careers@mycity.test" };
const recipient = { first_name: "Ada", last_name: "Obi", email: "ada@example.test" };
const render = (key, data, ctx = {}) => mail.renderEmail(ctx.db || db, key, data, { recipient, org, ...ctx });

const interview = {
  vacancy_title: "Content Producer",
  in_person: true,
  by_video: false,
  by_phone: false,
  scheduled_start: "2026-11-10T09:00:00.000Z",
  scheduled_end: "2026-11-10T10:00:00.000Z",
  place: "MyCity App Office",
  place_address: "12 Admiralty Way, Lekki Phase 1, Lagos",
  meeting_url: null,
  rescheduled: false,
  cancelled: false,
};
const timed = {
  vacancy_title: "Content Producer",
  assessment_name: "Writing Test",
  duration_minutes: 45,
  due_days: null,
  start_by: "2026-11-12",
  assess_url: "https://go.mycityapp.io/assess/tok456",
};
const SAMPLE = {
  "application-received": { vacancy_title: "Content Producer", reference: "APP-0042" },
  "apply-invite": { vacancy_title: "Content Producer", apply_url: "https://go.mycityapp.io/apply/tok123", expires_at: "2026-11-11T13:30:00.000Z" },
  "candidate-not-progressed": { vacancy_title: "Content Producer", careers_url: "https://go.mycityapp.io/jobs" },
  "assessment-invite": timed,
  "interview-invite": interview,
};

describe.each(Object.keys(DECLARED))("%s", (key) => {
  const t = store.shipped("email", key);

  test("is shipped as Markdown and names only its declared variables", () => {
    expect(t).not.toBeNull();
    expect(t.format).toBe("markdown");
    for (const part of [t.subject || "", t.title || "", t.body]) expect(() => variables.assertTemplate("email", key, part)).not.toThrow();
  });

  test("has no dash a person reads, and no HTML of its own", () => {
    expect(`${t.subject}\n${t.body}`).not.toMatch(/[–—]|--/);
    expect(t.body).not.toMatch(/<[a-z]/i);
  });

  test("Restore Default renders exactly what was shipped", async () => {
    const shipped = await render(key, SAMPLE[key]);
    const restored = await render(key, SAMPLE[key], { db: dbWith({ ...t, version: 3 }) });
    expect(restored.subject).toBe(shipped.subject);
    expect(restored.html).toBe(shipped.html);
  });

  test("greets without a first name and keeps a title's & and ' as typed", async () => {
    const data = { ...SAMPLE[key], vacancy_title: "Head, Sales & Revenue's Team" };
    const out = await render(key, data, { recipient: { email: "x@example.test" } });
    expect(out.subject).toContain("Head, Sales & Revenue's Team");
    expect(out.subject).not.toContain("&amp;");
    expect(out.text).toMatch(/^Hello,|^Dear|\nHello,/m);
    expect(out.text).toContain("Head, Sales & Revenue's Team");
    expect(out.html).not.toMatch(/&amp;amp;|&amp;#39;/);
  });
});

test("a name a stranger typed never becomes a link or bold in the email", async () => {
  const out = await render("application-received", SAMPLE["application-received"], {
    recipient: { first_name: "O'Brien [Click Here](https://evil.example.test) **Now**" },
  });
  expect(out.html).not.toContain("evil.example.test\"");
  expect(out.html).not.toContain("<strong>Now</strong>");
  expect(out.text).toContain("Hello O'Brien [Click Here](https://evil.example.test) **Now**,");
});

test("application received gives the role and the reference, and nothing about a score", async () => {
  const out = await render("application-received", SAMPLE["application-received"]);
  expect(out.subject).toBe("We have your application for Content Producer");
  expect(out.text).toContain("Hello Ada,");
  expect(out.html).toContain("<strong>APP-0042</strong>");
  expect(out.text).toContain("write to us at careers@mycity.test");
  expect(out.text).not.toMatch(/score/i);
});

test("with no address for the company, it does not ask the candidate to write in", async () => {
  const out = await render("application-received", SAMPLE["application-received"], { org: { name: "MyCity App Ltd" } });
  expect(out.text).not.toContain("write to us");
});

test("the plain text has no indentation from the layout", async () => {
  const out = await render("application-received", SAMPLE["application-received"]);
  for (const line of out.text.split("\n")) expect(line).not.toMatch(/^[ \t]/);
});

test("an invitation to apply carries the link and when it lapses, day first in Lagos", async () => {
  const url = "https://go.mycityapp.io/apply/tok_1-a?x=1&y=2";
  const out = await render("apply-invite", { ...SAMPLE["apply-invite"], apply_url: url });
  expect(out.subject).toBe("You are invited to apply for Content Producer");
  expect(out.html).toContain('href="https://go.mycityapp.io/apply/tok_1-a?x=1&amp;y=2"');
  expect(out.text).toContain("11/11/2026 14:30, Lagos time");
});

test("a timed assessment says its minutes, the day to start by in Lagos, and that it resumes", async () => {
  const out = await render("assessment-invite", timed);
  expect(out.text).toContain("45 minutes from when you press Start");
  expect(out.text).toContain("the end of 12 November 2026, Lagos time");
  expect(out.text).toContain("takes you back to where you stopped");
  expect(out.text).not.toContain("Days to finish");
  expect(out.html).toContain('href="https://go.mycityapp.io/assess/tok456"');
});

test("an untimed take-home says how many days it has after Start, never minutes", async () => {
  const out = await render("assessment-invite", { ...timed, vacancy_title: "Graphics Designer", duration_minutes: null, due_days: 5 });
  expect(out.text).toContain("Days to finish: 5, counted from when you press Start");
  expect(out.text).toContain("take-home");
  expect(out.text).not.toContain("minutes");
});

test("an assessment with neither minutes nor days prints no empty line about time", async () => {
  const out = await render("assessment-invite", { ...timed, duration_minutes: null, due_days: null });
  expect(out.text).not.toMatch(/Days to finish:\s*,/);
  expect(out.text).not.toContain("Time allowed");
});

test("the minutes are held to an assessment's own bounds", () => {
  const parse = (m) => DECLARED["assessment-invite"].safeParse({ ...timed, duration_minutes: m }).success;
  expect(parse(5)).toBe(true);
  expect(parse(240)).toBe(true);
  expect(parse(1)).toBe(false);
  expect(parse(241)).toBe(false);
});

test("an interview in person names the place, its address and the time in Lagos", async () => {
  const out = await render("interview-invite", interview);
  expect(out.subject).toBe("Interview invitation: Content Producer");
  expect(out.text).toContain("Starts: 10/11/2026 10:00, Lagos time");
  expect(out.text).toContain("Where: MyCity App Office, 12 Admiralty Way, Lekki Phase 1, Lagos");
  expect(out.text).toContain("careers@mycity.test");
  expect(out.text).not.toContain("by video");
  expect(out.text).not.toContain("by phone");
});

test("an interview in person with a meeting link left over still says the place, not video", async () => {
  const out = await render("interview-invite", { ...interview, meeting_url: "https://meet.example.test/old" });
  expect(out.text).toContain("Where: MyCity App Office");
  expect(out.html).not.toContain("meet.example.test");
});

test("an interview by video carries the meeting link and no place", async () => {
  const url = "https://meet.example.test/abc-defg_hij";
  const out = await render("interview-invite", { ...interview, in_person: false, by_video: true, meeting_url: url });
  expect(out.html).toContain(`href="${url}"`);
  expect(out.text).toContain("Where: by video");
  expect(out.text).not.toContain("Admiralty");
});

test("an interview by phone says we will call, even with a place set", async () => {
  const out = await render("interview-invite", { ...interview, in_person: false, by_phone: true });
  expect(out.text).toContain("Where: by phone");
  expect(out.text).not.toContain("Admiralty");
});

test("a changed interview says so in the subject and the opening", async () => {
  const out = await render("interview-invite", { ...interview, rescheduled: true });
  expect(out.subject).toBe("Interview changed: Content Producer");
  expect(out.text).toContain("have changed");
});

test("a cancelled interview says so, in Lagos time, and drops the joining details", async () => {
  const out = await render("interview-invite", { ...interview, by_video: true, in_person: false, meeting_url: "https://meet.example.test/x", cancelled: true });
  expect(out.subject).toBe("Interview cancelled: Content Producer");
  expect(out.text).toContain("10/11/2026 10:00, Lagos time, is cancelled");
  expect(out.html).not.toContain("meet.example.test");
  expect(out.text).not.toContain("Starts:");
});

test("not progressed is kind, final for this role, links the careers page, and carries no reason", async () => {
  const out = await render("candidate-not-progressed", SAMPLE["candidate-not-progressed"]);
  expect(out.subject).toBe("Your application for Content Producer");
  expect(out.text).toContain("Dear Ada,");
  expect(out.text).toContain("not be taking your application further");
  expect(out.html).toContain('href="https://go.mycityapp.io/jobs"');
  expect(out.text).not.toMatch(/links .* no longer work/);
  const withReason = DECLARED["candidate-not-progressed"].safeParse({ ...SAMPLE["candidate-not-progressed"], reason: "Weak CV" });
  expect(withReason.success).toBe(false);
});
