"use strict";
/**
 * Staging demonstration data: Recruitment (M4; docs/guides/recruitment.md §3, §6, §13; F13).
 *
 * Everything goes through the modules' own services, and a candidate's part through the candidate's
 * own paths: an Apply link, the CV upload and Submit Application; an assessment link, Start, the
 * answers and Submit. The links are issued here the way the mail handlers issue them, through the
 * shared public token service, and used at once; the worker's mail run then makes the candidates'
 * own links (and stops these).
 *
 * Who is who. Operations & People (MyCity's own post, lib/staff.js) is the recruiter: it writes
 * Careers Settings, the roles, the assessments, schedules the interviews and writes the reports.
 * The hiring managers and the panelists are the Implementation Team's own accounts, never MyCity's
 * staff: Recruitment notifies the hiring manager of each application, the marker of each sitting
 * and each panelist of a card due, and staging sends real mail (TB, 27/10/2026, as Queries does).
 * Every candidate is invented, with an @example.test address; no real person is named here.
 *
 *   Careers Settings  About MyCityApp and MyCity's ten traits from its Interview Assessment
 *                     Format, only while nobody has saved them
 *   vacancies         six, one per state: Head, Sales & Revenue (open, hybrid in Lekki, shaped on
 *                     MyCity's job description, with two Apply questions); Graphics and Motion
 *                     Designer (open, its scorecard without psychometric and case study); Content
 *                     Producer (open); Customer Support Lead (paused); Backend Engineer (draft,
 *                     remote); Partnerships Associate (closed, filled)
 *   applications      eleven through Apply, moved along the board by the recruiter; one not
 *                     progressed and kept in the Talent Pool
 *   assessments       the researched Sales Scenario Case Study (60 minutes) and Work Style Profile
 *                     (psychometric), and a take-home brief shaped on MyCity's Graphics and Motion
 *                     Design assessment (a poster, a motion piece, a note); sittings sent, one
 *                     taken and waiting to be marked, one taken and marked, one not started
 *   interviews        a round closed with every card in, its report and its Interview Assessment
 *                     Form; a round open with one card in and one waiting; one coming up
 *
 * Home's own staging vacancies (60_home.js, forward rows) are removed first, in one transaction
 * (lib/home-staging-rows.js removeHomeStagingRows).
 *
 * Run only by `scripts/db/seed.js --staging` (which refuses production three ways), after
 * 50_queries.js. Idempotent: Careers Settings once, a role by this seed's own record of making it
 * (SEEDED_ROLE: renamed since, it is still found; a person's role with the same title never is), an application by its
 * email and role, an assessment by its name, a sitting by its application and assessment, a round
 * by its application, a pool entry by its candidate; a second run adds nothing. With nobody in the
 * Implementation department, or no Operations & People login, nothing is added.
 */
const path = require("node:path");
const c = require("@mycity/contract");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const { atomically } = require("../../src/shared/db/tx");
const publicToken = require("../../src/shared/tokens/public-token");
const placeToken = require("../../src/shared/places/token");
const lagos = require("../../src/shared/time/lagos");
const { realStaff } = require("./lib/staff");
const { removeHomeStagingRows } = require("./lib/home-staging-rows");
const requestContext = require("../../src/config/request-context");

const src = (p) => require(path.join(__dirname, "..", "..", "src", p));

const ALL = Object.freeze({ scope: "all", scope_ids: null });
/** The tables Home's staging seed once wrote into that are this seed's now (lib/home-staging-rows.js). */
const RECRUITMENT_TABLES = Object.freeze(["vacancy"]);
/** The department the hiring managers and panelists come from: the Implementation Team's accounts. */
const TEAM = "Implementation";

/* ------------------------------------------------------------------ *
 * Careers Settings
 * ------------------------------------------------------------------ */

const ABOUT =
  "MyCityApp helps people discover and enjoy their city: places to eat, events to attend and things to do, " +
  "with the businesses behind them. We are a growing team in Lagos building for cities across Nigeria.";

/** MyCity's ten traits, from its Interview Assessment Format (guide §3). */
const TRAITS = Object.freeze([
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
]);

/* ------------------------------------------------------------------ *
 * Vacancies
 * ------------------------------------------------------------------ */

/** Lekki Phase 1, as the address search names the area (signed here, as the search signs it). */
const LEKKI = Object.freeze({ source: "search", formatted: "Lekki Phase 1, Lagos", lat: 6.4478, lon: 3.4723, kind: "area", city: "Lagos", state: "Lagos", country_code: "NG", verified: true });
const IKEJA = Object.freeze({ source: "search", formatted: "Ikeja, Lagos", lat: 6.6018, lon: 3.3515, kind: "area", city: "Lagos", state: "Lagos", country_code: "NG", verified: true });

const SALES_DESCRIPTION = `The Head, Sales & Revenue leads MyCityApp's commercial growth: the sales and revenue strategy, the team that delivers it, and the partners and advertisers who pay for it.

## Key Responsibilities

### 1. Sales & Revenue Strategy
- Set the yearly and monthly revenue targets with the CEO, by product and by city.
- Build the pricing and packages for advertisers, venues and event partners.
- Forecast revenue each month and explain the gap to target.

### 2. Team Leadership
- Recruit, coach and manage the sales team, with clear weekly targets.
- Run the weekly pipeline review and the monthly commission sheet.

### 3. Partnerships & Key Accounts
- Win and keep the largest brand, venue and event accounts in Lagos.
- Own the renewal of every partner on a yearly plan.

## Key Performance Indicators (KPIs)
- Monthly revenue against target.
- New partners signed, and the share renewed at year end.
- Pipeline value and conversion, stage by stage.`;

/**
 * The roles. `department` is looked for by name and falls back to the hiring manager's own;
 * `state` is where the role is left; `asks` its Apply questions; `parts_off` the scorecard parts it skips.
 */
const VACANCIES = Object.freeze([
  {
    key: "sales",
    title: "Head, Sales & Revenue",
    department: "Marketing & Sales",
    state: "open",
    employment_type: "full_time",
    work_pattern: "hybrid",
    work_pattern_note: "Two days in the office",
    place: LEKKI,
    min_experience_years: 8,
    salary: ["900000.00", "1400000.00"],
    working_days: "Monday to Saturday",
    reports_to: "Chief Executive Officer",
    description: SALES_DESCRIPTION,
    requirements: "- A degree in Business Administration, Marketing or a related field.\n- Eight years in B2B sales, three of them leading a team.\n- A record of meeting revenue targets in media, events or hospitality.",
    nice_to_have: "A commercial leader, not simply a sales administrator: someone who opens doors in Lagos and keeps them open.",
    asks: [
      { question_type: "yes_no", prompt: "Have you led a sales team of five or more?", required: true },
      { question_type: "text", prompt: "The largest deal you closed, and your part in it", required: false },
    ],
  },
  {
    key: "design",
    title: "Graphics and Motion Designer",
    department: "Studio",
    state: "open",
    employment_type: "full_time",
    work_pattern: "on_site",
    place: IKEJA,
    min_experience_years: 3,
    working_days: "Monday to Friday",
    description:
      "The Graphics and Motion Designer makes the posters, short videos and campaign art that put Lagos events in front of MyCityApp's users every week.\n\n## Key Responsibilities\n- Design the weekly campaign art for the app and social media.\n- Edit and animate short videos for events and venues.\n- Keep the brand consistent across every piece.",
    requirements: "- Three years of brand and motion design.\n- A portfolio of posters and short videos.\n- Adobe After Effects and Illustrator, or the like.",
    asks: [{ question_type: "text", prompt: "A link to your portfolio", required: true }],
    parts_off: ["psychometric", "case_study"],
  },
  {
    key: "content",
    title: "Content Producer",
    department: "Content",
    state: "open",
    employment_type: "contract",
    work_pattern: "hybrid",
    place: LEKKI,
    min_experience_years: 2,
    description:
      "The Content Producer plans, shoots and writes the guides and short videos that show MyCityApp users the best of their city, every week, with the Studio and the city editors.",
    requirements: "- Two years producing content for social media.\n- A portfolio of guides or short videos.",
  },
  {
    key: "support",
    title: "Customer Support Lead",
    department: "Support",
    state: "paused",
    employment_type: "full_time",
    work_pattern: "on_site",
    place: IKEJA,
    min_experience_years: 4,
    description:
      "The Customer Support Lead runs the team that answers MyCityApp's users and partners by chat, email and phone, and turns what they hear into fixes the product team can act on.",
    requirements: "- Four years in customer support, one leading a team.\n- Calm, clear writing in English.",
  },
  {
    key: "backend",
    title: "Backend Engineer",
    department: "Engineering",
    state: "draft",
    employment_type: "full_time",
    work_pattern: "remote",
    min_experience_years: 3,
    description:
      "The Backend Engineer builds and runs the services behind MyCityApp: the listings, the bookings and the partner tools, in Node.js and PostgreSQL, with the rest of the engineering team.",
    requirements: "- Three years building APIs in Node.js.\n- PostgreSQL in production.",
  },
  {
    key: "partners",
    title: "Partnerships Associate",
    department: "Marketing & Sales",
    state: "closed",
    employment_type: "full_time",
    work_pattern: "hybrid",
    place: LEKKI,
    min_experience_years: 2,
    description:
      "The Partnerships Associate signs and looks after the venues and brands that list on MyCityApp, from the first call to the renewal a year on.",
    requirements: "- Two years in sales or partnerships.\n- Comfortable on the phone and in person.",
  },
]);

/* ------------------------------------------------------------------ *
 * Applications (every person invented)
 * ------------------------------------------------------------------ */

/**
 * `role` is the vacancy's key; `stage` where the recruiter leaves the card; `years` the experience
 * the candidate gives; `lead` answers the sales role's team question.
 */
const APPLICANTS = Object.freeze([
  { first: "Kunle", last: "Afolabi", role: "sales", stage: "shortlist", years: 12, lead: "yes" },
  { first: "Tobi", last: "Adeyemi", role: "sales", stage: "interview", years: 9, lead: "yes" },
  { first: "Halima", last: "Yusuf", role: "sales", stage: "interview", years: 11, lead: "yes" },
  { first: "Emeka", last: "Obi", role: "sales", stage: "assessment", years: 8, lead: "yes" },
  { first: "Funke", last: "Bakare", role: "sales", stage: "screening", years: 6, lead: "no" },
  { first: "Chinedu", last: "Okafor", role: "sales", stage: "application", years: 10, lead: "yes" },
  { first: "Femi", last: "Lawal", role: "sales", stage: "screening", years: 4, lead: "no", notProgressed: "Four years in sales, none of them leading a team", pool: "Good individual seller; not yet ready to lead a team" },
  { first: "Ngozi", last: "Eze", role: "design", stage: "assessment", years: 4 },
  { first: "Segun", last: "Ajayi", role: "design", stage: "assessment", years: 3 },
  { first: "Zainab", last: "Ibrahim", role: "design", stage: "application", years: 5 },
  { first: "Uche", last: "Nwosu", role: "content", stage: "interview", years: 4 },
]);

const emailOf = (a) => `${a.first}.${a.last}`.toLowerCase().replace(/[^a-z.]/g, "") + "@example.test";
const phoneOf = (n) => `0803${String(1000000 + n * 4231).slice(0, 7)}`;

/** A one-page PDF, as a candidate's CV would arrive (the scan and the AI read take it from there). */
const cvOf = (a) =>
  Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
      `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj\n4 0 obj<</Length 60>>stream\nBT /F1 12 Tf 72 720 Td (${a.first} ${a.last}, curriculum vitae) Tj ET\nendstream endobj\n` +
      "trailer<</Root 1 0 R>>\n%%EOF\n",
    "latin1",
  );

/* ------------------------------------------------------------------ *
 * Assessments
 * ------------------------------------------------------------------ */

const LIKERT = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"];
const likert = (prompt, reverse = false) => ({ question_type: "choice", prompt, options: LIKERT.map((text, i) => ({ text, points: reverse ? 4 - i : i })) });

const ASSESSMENTS = Object.freeze([
  {
    key: "brief",
    name: "Graphics and Motion Design Brief",
    assessment_type: "practical",
    pass_score: 60,
    instructions:
      "Design two pieces for a Lagos food festival that MyCityApp is promoting: a poster and a 15 second motion piece for social media. Add a short note on your choices. You have five days from when you press Start.",
    questions: [
      { question_type: "file", prompt: "Upload the festival poster, as a PDF or an image.", max_score: 40 },
      { question_type: "file", prompt: "Upload the 15 second motion piece, or give a link to it.", max_score: 40 },
      { question_type: "text", prompt: "In a few sentences, tell us the choices you made and why.", max_score: 20 },
    ],
  },
  {
    key: "case",
    name: "Sales Scenario Case Study",
    assessment_type: "case_study",
    duration_minutes: 60,
    pass_score: 55,
    instructions: "Read the scenario in each question and answer in your own words. You have 60 minutes once you press Start.",
    questions: [
      {
        question_type: "text",
        prompt:
          "A chain of five Lagos restaurants spends ₦2 million a month on billboards and wants more weekday diners. Write the plan you would pitch them for a three month MyCityApp campaign.",
        max_score: 20,
      },
      { question_type: "text", prompt: "The same chain says the price is too high after one month of weak results. How do you keep the account?", max_score: 10 },
    ],
  },
  {
    key: "style",
    name: "Work Style Profile",
    assessment_type: "psychometric",
    duration_minutes: 20,
    instructions: "Say how far you agree with each statement. There are no right or wrong answers.",
    questions: [
      likert("I finish what I start, even when it gets dull."),
      likert("I prefer to wait for clear instructions before I begin.", true),
      likert("I enjoy meeting people I do not know."),
    ],
  },
]);

/**
 * The sittings: who gets which, and how far it goes (sent, taken and waiting to be marked, taken
 * and marked). `answers` are given in question order; `marks` likewise for the questions marked by hand.
 */
const SITTINGS = Object.freeze([
  {
    who: "Ngozi",
    what: "brief",
    walk: "taken",
    answers: [
      "https://drive.example.test/festival-poster",
      "https://drive.example.test/festival-motion",
      "I kept the poster to two colours so it reads on a phone, and cut the motion piece to the beat of the festival's own track.",
    ],
  },
  {
    who: "Emeka",
    what: "case",
    walk: "marked",
    answers: [
      "Start with weekday lunch offers in three of the five outlets, promoted to people within two kilometres, and measure covers against the billboard weeks.",
      "Agree a smaller test in the two weakest outlets, report covers weekly, and tie the second month's price to the result.",
    ],
    marks: [15, 7],
  },
  { who: "Emeka", what: "style", walk: "taken", answers: ["3", "1", "4"] },
  { who: "Segun", what: "brief", walk: "sent" },
]);

/* ------------------------------------------------------------------ *
 * Interviews
 * ------------------------------------------------------------------ */

/** `days` from today (negative: past); `cards` each panelist's ratings (one per trait) and decision; `walk` how far. */
const ROUNDS = Object.freeze([
  {
    who: "Kunle",
    days: -5,
    walk: "closed",
    cards: [
      { ratings: [8, 9, 9, 8, 8, 9, 9, 7, 9, 8], decision: "select", comments: "Clear on how he would grow partner revenue in the first six months." },
      { ratings: [8, 8, 8, 7, 8, 8, 9, 8, 8, 7], decision: "select", comments: "Strong references from two past employers." },
    ],
    details: { current_employer: "A Lagos events company", academics: "very_good", total_experience_months: 144, relevant_experience_months: 120 },
    report: {
      report: "A proven sales leader with a strong Lagos network and clear thinking on pricing. Needs support on hospitality contracts in the first quarter.",
      decision: "select",
    },
  },
  {
    who: "Tobi",
    days: -1,
    walk: "open",
    cards: [{ ratings: [7, 8, 8, 7, 8, 8, 9, 7, 8, 8], decision: "on_hold", comments: "Good on agency sales; less on running a team." }, null],
  },
  { who: "Halima", days: 2, walk: "upcoming" },
]);

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

/** A person as a service's caller (req.user), or null when they have no login. */
async function callerOf(db, person) {
  if (!person || !person.user_id) return null;
  const user = await grantsCache.getAuthUser(db, person.user_id);
  return user ? { ...user, ip: null } : null;
}

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

/** The request id the seed runner gives every staging seed (scripts/db/seed.js). */
const SEED_REQUEST = "seed-staging";

/**
 * A role this seed made, found by its own record of making it, never by the title the role has
 * now: the vacancy whose `vacancy.created` a seed run emitted (event_log is append-only, and its
 * request id is the runner's) with the spec's title as it was made. A role renamed on staging is
 * still the same role; one a person made with the same title is never taken for it. Still there:
 * a role deleted since is made again.
 */
const SEEDED_ROLE = `
  SELECT v.vacancy_id
    FROM event_log e
    JOIN vacancy v ON v.vacancy_id::text = e.entity_id
   WHERE e.event_key = 'vacancy.created' AND e.entity_type = 'vacancy'
     AND e.request_id = $1 AND e.payload->>'title' = $2
   ORDER BY e.occurred_at, e.event_id
   LIMIT 1 -- pagination:batch the one role this seed made from a spec`;

/** Run `fn` in a transaction of its own. */
async function inTx(pool, fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** A Lagos day `days` from today at `hm`, as the instant the API keeps. */
const instant = (days, hm) => new Date(`${lagos.addDays(lagos.today(), days)}T${hm}:00+01:00`).toISOString();

module.exports = async function seed({ pool, log = () => {} }) {
  const vacancies = src("modules/vacancies/vacancies.service");
  const candidates = src("modules/candidates/candidates.service");
  const apply = src("modules/candidates/candidates.apply");
  const authoring = src("modules/assessments/assessments.authoring");
  const sittings = src("modules/assessments/assessments.service");
  const delivery = src("modules/assessments/assessments.delivery");
  const interviews = src("modules/interviews/interviews.service");
  const panel = src("modules/interviews/interviews.panel");
  const consolidate = src("modules/interviews/interviews.consolidate");
  const pool_ = src("modules/talent_pool/talent_pool.service");
  const assessmentEvents = src("modules/assessments/assessments.events");

  // Home's own staging vacancies go first, whichever seed ran before.
  await inTx(pool, (client) => removeHomeStagingRows(client, RECRUITMENT_TABLES));

  const staff = await realStaff(pool);
  const recruiter = await callerOf(pool, staff.operations);
  const team = staff.everyone.filter((p) => p.department === TEAM && p.user_id);
  if (!recruiter || !team.length) {
    log(`recruitment: ${recruiter ? `nobody in ${TEAM}` : "no Operations & People login"}, nothing added`);
    return;
  }
  const managers = team; // hiring managers, in turn
  const panelists = (await Promise.all(team.slice(0, 2).map((p) => callerOf(pool, p)))).filter(Boolean);
  const stopped = (what, err) => log(`recruitment: ${what} stopped: ${err.message}`);

  /* Careers Settings, only while nobody has saved them. */
  const settings = await vacancies.settings(recruiter);
  if (!settings.updated_at) {
    await vacancies.saveSettings(recruiter, ALL, c.vacancies.CareersSettingsSave.parse({ about_company: ABOUT, default_traits: TRAITS }));
    log("recruitment: Careers Settings saved with MyCity's ten traits");
  }

  /* The roles. */
  const roles = {};
  let made = 0;
  for (const [n, spec] of VACANCIES.entries()) {
    const found = await one(pool, SEEDED_ROLE, [requestContext.getRequestId() || SEED_REQUEST, spec.title]);
    if (found) {
      roles[spec.key] = found.vacancy_id;
      continue;
    }
    const manager = managers[n % managers.length];
    const dept = (await one(pool, "SELECT department_id FROM department WHERE name = $1 AND active", [spec.department])) || { department_id: manager.department_id };
    try {
      const v = await vacancies.create(
        recruiter,
        ALL,
        c.vacancies.VacancyCreate.parse({
          title: spec.title,
          department_id: dept.department_id,
          hiring_manager_id: manager.employee_id,
          positions: 1,
          employment_type: spec.employment_type,
          work_pattern: spec.work_pattern,
          ...(spec.work_pattern_note ? { work_pattern_note: spec.work_pattern_note } : {}),
          ...(spec.place ? { location: { token: placeToken.sign(spec.place) } } : {}),
          probation_months: 6,
          ...(spec.reports_to ? { reports_to: spec.reports_to } : {}),
          min_experience_years: spec.min_experience_years,
          ...(spec.salary ? { salary_min: spec.salary[0], salary_max: spec.salary[1] } : {}),
          description: spec.description,
          requirements: spec.requirements,
          ...(spec.nice_to_have ? { nice_to_have: spec.nice_to_have } : {}),
          ...(spec.working_days ? { working_days: spec.working_days } : {}),
          closes_on: lagos.addDays(lagos.today(), 30),
          publish: spec.state !== "draft",
        }),
      );
      roles[spec.key] = v.vacancy_id;
      made += 1;
      if (spec.asks || spec.parts_off) {
        const traits = v.questions.filter((q) => q.purpose === "interview" && q.active);
        if (spec.asks)
          await vacancies.saveQuestions(
            recruiter,
            ALL,
            v.vacancy_id,
            c.vacancies.VacancyQuestionsSave.parse({
              questions: [
                ...spec.asks.map((q) => ({ purpose: "application", ...q })),
                ...traits.map((t) => ({ vacancy_question_id: t.vacancy_question_id, purpose: "interview", question_type: "rating", prompt: t.prompt, required: true })),
              ],
            }),
          );
        if (spec.parts_off) {
          const on = v.scorecard.filter((p) => !spec.parts_off.includes(p.code));
          const total = on.reduce((s, p) => s + p.weight, 0);
          let left = 100;
          const parts = Object.fromEntries(
            v.scorecard.map((p) => {
              if (spec.parts_off.includes(p.code)) return [p.code, { active: false, weight: 0 }];
              const last = p.code === on[on.length - 1].code;
              const weight = last ? left : Math.round((p.weight * 100) / total);
              left -= last ? 0 : weight;
              return [p.code, { active: true, weight }];
            }),
          );
          await vacancies.saveScorecard(recruiter, ALL, v.vacancy_id, c.vacancies.ScorecardSave.parse({ parts }));
        }
      }
    } catch (err) {
      stopped(spec.title, err);
    }
  }
  if (made) log(`recruitment: ${made} roles made`);

  /* The applications, each through an Apply link, as a candidate sends one. */
  const apps = {};
  let applied = 0;
  for (const [n, a] of APPLICANTS.entries()) {
    const vacancyId = roles[a.role];
    if (!vacancyId) continue;
    const email = emailOf(a);
    const had = await one(pool, "SELECT a.application_id FROM application a JOIN candidate k ON k.candidate_id = a.candidate_id WHERE k.email = $1 AND a.vacancy_id = $2", [email, vacancyId]);
    if (had) {
      apps[a.first] = had.application_id;
      continue;
    }
    try {
      const link = await inTx(pool, (client) =>
        publicToken.issue(client, { scope: apply.SCOPE, subject_type: "vacancy", subject_id: vacancyId, ttl_hours: 24, single_use: true, created_by: recruiter.user_id }),
      );
      const live = await inTx(pool, (client) => publicToken.resolve(client, link.token, { scope: apply.SCOPE }));
      const cv = await apply.uploadCv(live, { buffer: cvOf(a), originalname: `${a.first}-${a.last}-CV.pdf` });
      const questions = (await apply.link(live)).questions;
      const answers = Object.fromEntries(
        questions.map((q) => [q.vacancy_question_id, q.question_type === "yes_no" ? a.lead || "no" : a.role === "design" ? `https://portfolio.example.test/${a.first.toLowerCase()}` : "A yearly plan with a Lagos venue group, from the first call to the renewal."]),
      );
      const receipt = await apply.submit(
        link.token,
        c.candidates.ApplicationSubmit.parse({
          full_name: `${a.first} ${a.last}`,
          email,
          phone: phoneOf(n),
          years_experience: a.years,
          cv_document_id: cv.document_id,
          cover_letter: `I have spent ${a.years} years in this kind of work in Lagos, and I want to bring it to MyCityApp, where I already find most of my weekends.`,
          answers,
          consent: true,
        }),
      );
      const row = await one(pool, "SELECT application_id FROM application WHERE number::text = $1", [receipt.reference]);
      apps[a.first] = row.application_id;
      applied += 1;
      // Along the board, a stage at a time, as the recruiter moves the card.
      const board = ["application", "screening", "assessment", "interview", "shortlist"];
      const role = await vacancies.get(vacancyId, recruiter, ALL);
      for (const stage of board.slice(1, board.indexOf(a.stage) + 1)) {
        if (!role.board_stages.includes(stage)) continue;
        await candidates.move(recruiter, ALL, row.application_id, c.candidates.CandidateMove.parse({ stage }));
      }
      if (a.notProgressed) await candidates.notProgressed(recruiter, ALL, row.application_id, c.candidates.CandidateNotProgressed.parse({ rejection_reason: a.notProgressed }));
    } catch (err) {
      stopped(`${a.first} ${a.last}'s application`, err);
    }
  }
  if (applied) log(`recruitment: ${applied} applications sent through Apply`);

  /* The assessments, each made, given its questions and switched on. */
  const library = {};
  for (const spec of ASSESSMENTS) {
    const had = await one(pool, "SELECT assessment_definition_id FROM assessment_definition WHERE name = $1", [spec.name]);
    if (had) {
      library[spec.key] = had.assessment_definition_id;
      continue;
    }
    try {
      const { key, questions, ...fields } = spec;
      const made_ = await authoring.create(recruiter, c.assessments.AssessmentCreate.parse(fields));
      await authoring.saveQuestions(recruiter, made_.assessment_definition_id, c.assessments.AssessmentQuestionsSave.parse({ questions }));
      await authoring.activate(recruiter, made_.assessment_definition_id);
      library[key] = made_.assessment_definition_id;
    } catch (err) {
      stopped(spec.name, err);
    }
  }

  /* The sittings: sent, and as far as each goes, taken through its link as the candidate would. */
  for (const s of SITTINGS) {
    const appId = apps[s.who];
    const defId = library[s.what];
    if (!appId || !defId) continue;
    const had = await one(pool, "SELECT application_assessment_id FROM application_assessment WHERE application_id = $1 AND assessment_definition_id = $2", [appId, defId]);
    if (had) continue;
    try {
      const sent = await sittings.send(recruiter, ALL, c.assessments.SittingSend.parse({ application_id: appId, assessment_definition_id: defId, start_within_days: 3, ...(s.what === "brief" ? { due_days: 5 } : {}) }));
      if (s.walk === "sent") continue;
      const id = sent.application_assessment_id;
      const link = await inTx(pool, (client) =>
        publicToken.issue(client, { scope: assessmentEvents.SCOPE, subject_type: assessmentEvents.SUBJECT, subject_id: id, ttl_hours: 72, created_by: recruiter.user_id }),
      );
      await delivery.start(link.token);
      const detail = await sittings.sitting(id, recruiter, ALL);
      for (const [i, q] of detail.answers.entries()) {
        const text = s.answers[i];
        if (text === undefined) continue;
        const answer = q.question_type === "choice" ? q.options[Number(text)].id : text;
        await delivery.answer(link.token, q.assessment_question_id, c.assessments.AnswerSave.parse({ answer, current_question: i }));
      }
      await delivery.submit(link.token);
      if (s.walk === "marked") {
        const byHand = detail.answers.filter((q) => q.question_type !== "choice");
        await sittings.mark(recruiter, ALL, id, c.assessments.SittingMarks.parse({ marks: byHand.map((q, i) => ({ assessment_question_id: q.assessment_question_id, awarded_score: s.marks[i] })) }));
      }
    } catch (err) {
      stopped(`${s.who}'s ${s.what}`, err);
    }
  }

  /* The interviews: one closed with every card in and its report, one open, one coming up. */
  for (const r of ROUNDS) {
    const appId = apps[r.who];
    if (!appId || !panelists.length) continue;
    const had = await one(pool, "SELECT interview_round_id FROM interview_round WHERE application_id = $1", [appId]);
    if (had) continue;
    try {
      const x = await interviews.schedule(
        recruiter,
        ALL,
        c.interviews.InterviewSchedule.parse({
          application_id: appId,
          interview_type: "video",
          meeting_url: `https://meet.example.test/mycity-${r.who.toLowerCase()}`,
          scheduled_start: instant(r.days, "10:00"),
          scheduled_end: instant(r.days, "11:00"),
          panel_employee_ids: panelists.map((p) => p.employee_id),
        }),
      );
      if (r.walk === "upcoming") continue;
      const traits = x.questions;
      for (const [i, card] of (r.cards || []).entries()) {
        const who = panelists[i];
        if (!card || !who) continue;
        await panel.save(who, x.interview_id, c.interviews.FeedbackSave.parse({
          ratings: traits.map((t, k) => ({ vacancy_question_id: t.vacancy_question_id, rating: card.ratings[k] ?? 7 })),
          decision: card.decision,
          comments: card.comments,
        }));
        await panel.submit(who, x.interview_id);
      }
      if (r.walk !== "closed") continue;
      const after = await interviews.get(x.interview_id, recruiter, ALL);
      if (after.round.status !== "closed") await consolidate.close(recruiter, ALL, x.interview_id);
      if (r.details) await consolidate.details(recruiter, ALL, x.interview_id, c.interviews.RoundDetailsSave.parse(r.details));
      await consolidate.report(recruiter, ALL, x.interview_id, c.interviews.RoundReport.parse(r.report));
    } catch (err) {
      stopped(`${r.who}'s interview`, err);
    }
  }

  /* The Talent Pool: who was not progressed and is worth keeping. */
  for (const a of APPLICANTS.filter((x) => x.pool)) {
    const appId = apps[a.first];
    if (!appId) continue;
    const had = await one(pool, "SELECT 1 FROM talent_pool_entry e JOIN application a ON a.candidate_id = e.candidate_id WHERE a.application_id = $1 AND e.removed_at IS NULL", [appId]);
    if (had) continue;
    try {
      await pool_.add(recruiter, ALL, c.talent_pool.PoolAdd.parse({ application_id: appId, reason: a.pool }));
    } catch (err) {
      stopped(`${a.first} ${a.last} in the pool`, err);
    }
  }

  /* Where each role is left: one paused, one closed as filled. */
  for (const spec of VACANCIES.filter((v) => v.state === "paused" || v.state === "closed")) {
    const id = roles[spec.key];
    if (!id) continue;
    const now = await one(pool, "SELECT status FROM vacancy WHERE vacancy_id = $1", [id]);
    try {
      if (spec.state === "paused" && now.status === "open") await vacancies.pause(recruiter, ALL, id);
      if (spec.state === "closed" && now.status !== "closed") await vacancies.close(recruiter, ALL, id, c.vacancies.VacancyClose.parse({ close_reason: "filled" }));
    } catch (err) {
      stopped(`${spec.title}'s state`, err);
    }
  }
  log("recruitment: done");
};

module.exports.VACANCIES = VACANCIES;
module.exports.TRAITS = TRAITS;
module.exports.RECRUITMENT_TABLES = RECRUITMENT_TABLES;
