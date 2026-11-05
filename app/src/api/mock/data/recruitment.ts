/**
 * The Recruitment mock in the contract's shapes (docs/guides/recruitment.md §4, §6; handoff P10): the
 * roles, applications, assessments, sittings, interview rounds and the Talent Pool the screens and
 * their pictures need. Shaped on MyCity's own documents (docs/MyCity-ERP-Documents/): the Head, Sales &
 * Revenue job description (its overview, numbered responsibilities, KPIs and working days), the
 * Interview Assessment Format (its ten traits rated 1 to 10, Candidate Details and decision) and the
 * Graphics and Motion Design assessment (a take-home brief of two deliverables and a short note).
 * Every candidate is invented, with an @example.test address; staff are the mock's own.
 */
import type {
  AssessmentDetail,
  CandidateEmail,
  CareersSettings,
  PoolEntry,
  ScorecardWeight,
  SittingAnswer,
  VacancyDetail,
  VacancyQuestion,
} from "@mycity/contract/contract.gen.ts";
import { at, isoDaysAgo, isoDaysAhead, sid } from "../core";
import { byKey, refKey } from "./people";
import { pickedPlace } from "../modules/maps";

/* ------------------------------------------------------------------ *
 * Careers Settings
 * ------------------------------------------------------------------ */

/** MyCity's ten traits, from its Interview Assessment Format. */
export const TRAITS = [
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

export const SETTINGS: CareersSettings = {
  about_company:
    "MyCityApp helps people discover and enjoy their city: places to eat, events to attend and things to do, with the businesses behind them. We are a growing team in Lagos building for cities across Nigeria.",
  default_traits: TRAITS,
  updated_at: at(20, "10:00"),
};

/* ------------------------------------------------------------------ *
 * Vacancies
 * ------------------------------------------------------------------ */

const DEPT: Record<string, string> = {
  "Marketing & Sales": sid("dept:Marketing & Sales"),
  Studio: sid("dept:Studio"),
  Content: sid("dept:Content"),
  Support: sid("dept:Support"),
  Engineering: sid("dept:Engineering"),
};
export const deptId = (name: string) => DEPT[name] ?? sid(`dept:${name}`);

/** The scorecard at the default weights, every part on (guide §6.5). */
export const defaultScorecard = (): ScorecardWeight[] => [
  { code: "screening", name: "Screening", active: true, weight: 15 },
  { code: "psychometric", name: "Psychometric", active: true, weight: 15 },
  { code: "technical", name: "Technical", active: true, weight: 25 },
  { code: "case_study", name: "Case Study", active: true, weight: 20 },
  { code: "interview", name: "Interview", active: true, weight: 25 },
];

const ASSESSED = ["psychometric", "technical", "case_study"];
/** The board's columns from the parts switched on (the API's vacancies.lifecycle boardStages). */
export const boardStages = (scorecard: ScorecardWeight[]): VacancyDetail["board_stages"] => {
  const on = new Set(scorecard.filter((p) => p.active).map((p) => p.code));
  return M4_STAGES.filter((stage) => (stage === "assessment" ? ASSESSED.some((c) => on.has(c as ScorecardWeight["code"])) : stage === "interview" ? on.has("interview") : true));
};
export const M4_STAGES = ["application", "screening", "assessment", "interview", "shortlist"] as const;

const traitQuestions = (vacancyId: string, traits = TRAITS): VacancyQuestion[] =>
  traits.map((prompt, i) => ({
    vacancy_question_id: sid(`vq:${vacancyId}:trait:${i}`),
    purpose: "interview",
    question_type: "rating",
    prompt,
    options: null,
    required: true,
    display_order: i,
    active: true,
  }));

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

## How You Will Be Measured
- Monthly revenue against target.
- New partners signed, and the share renewed at year end.
- Pipeline value and conversion, stage by stage.`;

interface VacancySeed {
  key: string;
  number: string;
  title: string;
  department: string;
  manager: string;
  status: VacancyDetail["status"];
  close_reason?: VacancyDetail["close_reason"];
  work_pattern: VacancyDetail["work_pattern"];
  place?: string;
  employment_type: NonNullable<VacancyDetail["employment_type"]>;
  positions: number;
  published?: number;
  closes_in: number;
  min_years: number | null;
  salary?: [string, string, boolean];
  description: string;
  requirements: string;
  nice_to_have?: string;
  working_days?: string;
  reports_to?: string;
  conditions?: string[];
  parts_off?: ScorecardWeight["code"][];
  traits?: string[];
}

const SEEDS: VacancySeed[] = [
  {
    key: "sales",
    number: "VAC-0001",
    title: "Head, Sales & Revenue",
    department: "Marketing & Sales",
    manager: "ifeoma",
    status: "open",
    work_pattern: "hybrid",
    place: "Lekki Phase 1, Lagos",
    employment_type: "full_time",
    positions: 1,
    published: 12,
    closes_in: 18,
    min_years: 8,
    salary: ["900000.00", "1400000.00", false],
    description: SALES_DESCRIPTION,
    requirements:
      "- A degree in Business Administration, Marketing or a related field.\n- Eight years in B2B sales, three of them leading a team.\n- A record of meeting revenue targets in media, events or hospitality.",
    nice_to_have: "A commercial leader, not simply a sales administrator: someone who opens doors in Lagos and keeps them open.",
    working_days: "Monday to Saturday",
    reports_to: "Chief Executive Officer",
    conditions: ["Eight years in B2B sales", "Lives in Lagos"],
  },
  {
    key: "design",
    number: "VAC-0002",
    title: "Graphics and Motion Designer",
    department: "Studio",
    manager: "cynthia",
    status: "open",
    work_pattern: "on_site",
    place: "Ikeja, Lagos",
    employment_type: "full_time",
    positions: 1,
    published: 9,
    closes_in: 21,
    min_years: 3,
    description:
      "The Graphics and Motion Designer makes the posters, short videos and campaign art that put Lagos events in front of MyCityApp's users every week.\n\n## Key Responsibilities\n- Design the weekly campaign art for the app and social media.\n- Edit and animate short videos for events and venues.\n- Keep the brand consistent across every piece.",
    requirements: "- Three years of brand and motion design.\n- A portfolio of posters and short videos.\n- Adobe After Effects and Illustrator, or the like.",
    working_days: "Monday to Friday",
    parts_off: ["psychometric", "case_study"],
  },
  {
    key: "content",
    number: "VAC-0003",
    title: "Content Producer",
    department: "Content",
    manager: "cynthia",
    status: "open",
    work_pattern: "hybrid",
    place: "Lekki Phase 1, Lagos",
    employment_type: "contract",
    positions: 2,
    published: 30,
    closes_in: -2,
    min_years: 2,
    description:
      "The Content Producer plans, shoots and writes the guides and short videos that show MyCityApp users the best of their city, every week, with the Studio and the city editors.",
    requirements: "- Two years producing content for social media.\n- A portfolio of guides or short videos.",
  },
  {
    key: "support",
    number: "VAC-0004",
    title: "Customer Support Lead",
    department: "Support",
    manager: "cynthia",
    status: "paused",
    work_pattern: "on_site",
    place: "Ikeja, Lagos",
    employment_type: "full_time",
    positions: 1,
    published: 20,
    closes_in: 25,
    min_years: 4,
    description:
      "The Customer Support Lead runs the team that answers MyCityApp's users and partners by chat, email and phone, and turns what they hear into fixes the product team can act on.",
    requirements: "- Four years in customer support, one leading a team.\n- Calm, clear writing in English.",
  },
  {
    key: "backend",
    number: "VAC-0005",
    title: "Backend Engineer",
    department: "Engineering",
    manager: "cynthia",
    status: "draft",
    work_pattern: "remote",
    employment_type: "full_time",
    positions: 2,
    closes_in: 35,
    min_years: 3,
    description:
      "The Backend Engineer builds and runs the services behind MyCityApp: the listings, the bookings and the partner tools, in Node.js and PostgreSQL, with the rest of the engineering team.",
    requirements: "- Three years building APIs in Node.js.\n- PostgreSQL in production.",
  },
  {
    key: "partners",
    number: "VAC-0006",
    title: "Partnerships Associate",
    department: "Marketing & Sales",
    manager: "ifeoma",
    status: "closed",
    close_reason: "filled",
    work_pattern: "hybrid",
    place: "Lekki Phase 1, Lagos",
    employment_type: "full_time",
    positions: 1,
    published: 60,
    closes_in: -30,
    min_years: 2,
    description:
      "The Partnerships Associate signs and looks after the venues and brands that list on MyCityApp, from the first call to the renewal a year on.",
    requirements: "- Two years in sales or partnerships.\n- Comfortable on the phone and in person.",
  },
];

const slugOf = (title: string, city: string | null) =>
  [title, city]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export const VACANCIES: VacancyDetail[] = SEEDS.map((s) => {
  const id = sid(`vac:${s.key}`);
  const place = s.place ? pickedPlace(s.place) : null;
  const published = s.published === undefined ? null : at(s.published, "09:00");
  const scorecard = defaultScorecard().map((p) => (s.parts_off?.includes(p.code) ? { ...p, active: false, weight: 0 } : p));
  if (s.parts_off?.length) {
    const on = scorecard.filter((p) => p.active);
    const total = on.reduce((n, p) => n + p.weight, 0);
    let left = 100;
    on.forEach((p, i) => {
      p.weight = i === on.length - 1 ? left : Math.round((p.weight * 100) / total);
      left -= i === on.length - 1 ? 0 : p.weight;
    });
  }
  const slug = published ? slugOf(s.title, s.place ? "Lagos" : null) : null;
  const manager = refKey(s.manager);
  return {
    vacancy_id: id,
    number: s.number,
    title: s.title,
    slug,
    status: s.status,
    close_reason: s.close_reason ?? null,
    department_id: deptId(s.department),
    department: s.department,
    hiring_manager: manager,
    location: place ? place.line : null,
    work_pattern: s.work_pattern,
    positions: s.positions,
    applicants: 0,
    in_progress: 0,
    closes_at: `${isoDaysAhead(s.closes_in)}T22:59:59.000Z`,
    past_closing: s.status === "open" && s.closes_in < 0,
    published_at: published,
    days_open: s.published === undefined ? null : Math.min(s.published, s.status === "closed" ? 30 : s.published),
    public_url: slug && s.status !== "draft" ? `https://go.mycityapp.io/jobs/${slug}` : null,
    created_at: at((s.published ?? 2) + 3, "16:00"),
    org_seat_id: null,
    employment_type: s.employment_type,
    work_pattern_note: s.work_pattern === "hybrid" ? "Two days in the office, three from home" : null,
    location_place: place ? place.view : null,
    probation_months: 6,
    reports_to: s.reports_to ?? null,
    min_experience_years: s.min_years,
    salary_min: s.salary ? s.salary[0] : null,
    salary_max: s.salary ? s.salary[1] : null,
    salary_visible: s.salary ? s.salary[2] : false,
    description: s.description,
    requirements: s.requirements,
    nice_to_have: s.nice_to_have ?? null,
    target_start_on: null,
    paused_at: s.status === "paused" ? at(3, "11:00") : null,
    closed_at: s.status === "closed" ? at(30, "17:00") : null,
    working_days: s.working_days ?? null,
    screening_conditions: s.conditions ?? [],
    board_stages: boardStages(scorecard),
    questions: [
      ...(s.key === "sales"
        ? [
            {
              vacancy_question_id: sid(`vq:${id}:app:0`),
              purpose: "application" as const,
              question_type: "yes_no" as const,
              prompt: "Have you led a sales team of five or more?",
              options: null,
              required: true,
              display_order: 0,
              active: true,
            },
            {
              vacancy_question_id: sid(`vq:${id}:app:1`),
              purpose: "application" as const,
              question_type: "text" as const,
              prompt: "The largest deal you closed, and your part in it",
              options: null,
              required: false,
              display_order: 1,
              active: true,
            },
          ]
        : []),
      ...(s.key === "design"
        ? [
            {
              vacancy_question_id: sid(`vq:${id}:app:0`),
              purpose: "application" as const,
              question_type: "text" as const,
              prompt: "A link to your portfolio",
              options: null,
              required: true,
              display_order: 0,
              active: true,
            },
          ]
        : []),
      ...traitQuestions(id, s.traits ?? (s.key === "design" ? TRAITS.filter((t) => t !== "Experience in Sales and Marketing") : TRAITS)),
    ],
    scorecard,
    by_stage: [],
    can_edit: s.status !== "closed",
  };
});

export const vacancyByKey = (key: string) => VACANCIES.find((v) => v.vacancy_id === sid(`vac:${key}`))!;

/** Vacant seats with no live vacancy (Suggested From Organogram). */
export const SEATS = [
  { org_seat_id: sid("seat:finance-officer"), title: "Finance Officer", department_id: deptId("Finance"), department: "Finance", reports_to: "Head of Finance" },
  { org_seat_id: sid("seat:city-editor"), title: "City Editor, Abuja", department_id: deptId("Content"), department: "Content", reports_to: "Head of Content" },
];

/* ------------------------------------------------------------------ *
 * Applications
 * ------------------------------------------------------------------ */

export interface MockApplication {
  application_id: string;
  number: string;
  candidate_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  vacancy_key: string;
  stage: "application" | "screening" | "assessment" | "interview" | "shortlist";
  status: "active" | "not_progressed" | "withdrawn" | "hired";
  source: "careers" | "invited" | "pool";
  applied_days: number;
  at_stage_days: number;
  years: number;
  cover_letter: string;
  provisional: number;
  screening: number | null;
  summary: string | null;
  rejection_reason: string | null;
  cv_state: "none" | "checking" | "clean" | "infected";
  answers: Record<string, string>;
  history: Array<{ to: string; days: number; reason?: string; by?: string }>;
}

const app = (
  i: number,
  first: string,
  last: string,
  vacancy: string,
  stage: MockApplication["stage"],
  days: number,
  years: number,
  provisional: number,
  screening: number | null,
  more: Partial<MockApplication> = {},
): MockApplication => {
  const order = ["application", "screening", "assessment", "interview", "shortlist"];
  const upto = order.indexOf(stage);
  const step = Math.max(1, Math.floor(days / (upto + 1)));
  return {
    application_id: sid(`app:${i}`),
    number: `APP-${String(i + 1).padStart(4, "0")}`,
    candidate_id: sid(`cand:${i}`),
    first_name: first,
    last_name: last,
    email: `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, "") + "@example.test",
    phone: `+23480${String(31000000 + i * 4231).slice(0, 8)}`,
    vacancy_key: vacancy,
    stage,
    status: "active",
    source: "careers",
    applied_days: days,
    at_stage_days: Math.max(0, days - step * upto),
    years,
    cover_letter: `I have spent ${years} years in this kind of work in Lagos, and I want to bring it to MyCityApp, where I already find most of my weekends.`,
    provisional,
    screening,
    summary: screening === null ? null : "Shows the must haves with evidence: named employers, figures and a portfolio. Lives in Lagos: met. Could not verify the team size from the CV.",
    rejection_reason: null,
    cv_state: "clean",
    answers: {},
    history: order.slice(0, upto + 1).map((to, k) => ({ to, days: days - step * k, by: k === 0 ? undefined : "cynthia" })),
    ...more,
  };
};

export const APPLICATIONS: MockApplication[] = [
  app(0, "Tobi", "Adeyemi", "sales", "interview", 11, 9, 88, 84, { source: "invited" }),
  app(1, "Halima", "Yusuf", "sales", "interview", 10, 11, 92, 79),
  app(2, "Emeka", "Obi", "sales", "assessment", 9, 8, 81, 72),
  app(3, "Funke", "Bakare", "sales", "screening", 8, 6, 64, null),
  app(4, "Chinedu", "Okafor", "sales", "application", 3, 10, 86, null),
  app(5, "Amina", "Garba", "sales", "application", 2, 5, 58, null, { cv_state: "checking" }),
  app(6, "Kunle", "Afolabi", "sales", "shortlist", 12, 12, 90, 88),
  app(7, "Ngozi", "Eze", "design", "assessment", 8, 4, 77, 81),
  app(8, "Segun", "Ajayi", "design", "screening", 6, 3, 66, 70),
  app(9, "Zainab", "Ibrahim", "design", "application", 2, 5, 72, null),
  app(10, "Bola", "Ogunleye", "content", "application", 25, 2, 61, null),
  app(11, "Uche", "Nwosu", "content", "interview", 28, 4, 75, 68),
  app(12, "Femi", "Lawal", "sales", "screening", 7, 4, 45, 38, { status: "not_progressed", rejection_reason: "Four years in sales, none leading a team" }),
  app(13, "Kemi", "Bello", "partners", "shortlist", 50, 3, 70, 74, { status: "not_progressed", rejection_reason: "The role went to another candidate" }),
];

export const applicationById = (id: string) => APPLICATIONS.find((a) => a.application_id === id);

/* ------------------------------------------------------------------ *
 * Assessments
 * ------------------------------------------------------------------ */

const LIKERT = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"];
const likert = (key: string, prompt: string, reverse = false): AssessmentDetail["questions"][number] => ({
  assessment_question_id: sid(`aq:${key}`),
  question_type: "choice",
  prompt,
  options: LIKERT.map((text, i) => ({ id: `${key}-${i}`, text, points: reverse ? 4 - i : i })),
  max_score: 4,
  display_order: 0,
});

export const ASSESSMENTS: AssessmentDetail[] = [
  {
    assessment_definition_id: sid("asm:brief"),
    code: "ASM-0001",
    name: "Graphics and Motion Design Brief",
    assessment_type: "practical",
    duration_minutes: null,
    pass_score: 60,
    scoring_method: "manual",
    active: true,
    question_count: 3,
    sent: 2,
    average_score: 81,
    created_at: at(15, "10:00"),
    instructions:
      "Design two pieces for a Lagos food festival that MyCityApp is promoting: a poster and a 15 second motion piece for social media. Add a short note on your choices. You have five days from when you press Start.",
    questions: [
      { assessment_question_id: sid("aq:brief:poster"), question_type: "file", prompt: "Upload the festival poster, as a PDF or an image.", options: null, max_score: 40, display_order: 0 },
      { assessment_question_id: sid("aq:brief:motion"), question_type: "file", prompt: "Upload the 15 second motion piece, or give a link to it.", options: null, max_score: 40, display_order: 1 },
      { assessment_question_id: sid("aq:brief:note"), question_type: "text", prompt: "In a few sentences, tell us the choices you made and why.", options: null, max_score: 20, display_order: 2 },
    ],
    in_use: true,
  },
  {
    assessment_definition_id: sid("asm:case"),
    code: "ASM-0002",
    name: "Sales Scenario Case Study",
    assessment_type: "case_study",
    duration_minutes: 60,
    pass_score: 55,
    scoring_method: "manual",
    active: true,
    question_count: 2,
    sent: 3,
    average_score: 72,
    created_at: at(14, "10:00"),
    instructions: "Read the scenario in each question and answer in your own words. You have 60 minutes once you press Start.",
    questions: [
      {
        assessment_question_id: sid("aq:case:plan"),
        question_type: "text",
        prompt:
          "A chain of five Lagos restaurants spends ₦2 million a month on billboards and wants more weekday diners. Write the plan you would pitch them for a three month MyCityApp campaign.",
        options: null,
        max_score: 20,
        display_order: 0,
      },
      {
        assessment_question_id: sid("aq:case:objection"),
        question_type: "text",
        prompt: "The same chain says the price is too high after one month of weak results. How do you keep the account?",
        options: null,
        max_score: 10,
        display_order: 1,
      },
    ],
    in_use: true,
  },
  {
    assessment_definition_id: sid("asm:style"),
    code: "ASM-0003",
    name: "Work Style Profile",
    assessment_type: "psychometric",
    duration_minutes: 20,
    pass_score: null,
    scoring_method: "auto",
    active: true,
    question_count: 3,
    sent: 4,
    average_score: 69,
    created_at: at(13, "10:00"),
    instructions: "Say how far you agree with each statement. There are no right or wrong answers.",
    questions: [
      likert("style:1", "I finish what I start, even when it gets dull."),
      { ...likert("style:2", "I prefer to wait for clear instructions before I begin.", true), display_order: 1 },
      { ...likert("style:3", "I enjoy meeting people I do not know."), display_order: 2 },
    ],
    in_use: true,
  },
  {
    assessment_definition_id: sid("asm:numeracy"),
    code: "ASM-0004",
    name: "Sales Numeracy",
    assessment_type: "technical",
    duration_minutes: 30,
    pass_score: 50,
    scoring_method: "auto",
    active: false,
    question_count: 1,
    sent: 0,
    average_score: null,
    created_at: at(2, "10:00"),
    instructions: "Work out each answer. You may use a calculator.",
    questions: [
      {
        assessment_question_id: sid("aq:num:1"),
        question_type: "choice",
        prompt: "A partner pays ₦150,000 a month and renews for a year at 10% off. What do they pay for the year?",
        options: [
          { id: "num-1-a", text: "₦1,620,000", points: 2 },
          { id: "num-1-b", text: "₦1,800,000", points: 0 },
          { id: "num-1-c", text: "₦1,650,000", points: 0 },
        ],
        max_score: 2,
        display_order: 0,
      },
    ],
    in_use: false,
  },
];

export interface MockSitting {
  application_assessment_id: string;
  application_id: string;
  assessment_definition_id: string;
  status: "sent" | "in_progress" | "submitted" | "timed_out" | "scored" | "expired" | "cancelled";
  sent_days: number;
  start_by_days: number;
  started_days: number | null;
  submitted_days: number | null;
  due_days: number | null;
  score: number | null;
  answers: Record<string, Pick<SittingAnswer, "response" | "awarded_score" | "reviewer_comment" | "marked_at"> & { file?: string }>;
}

const A = (key: string) => sid(`asm:${key}`);
export const SITTINGS: MockSitting[] = [
  {
    application_assessment_id: sid("sit:design:ngozi"),
    application_id: sid("app:7"),
    assessment_definition_id: A("brief"),
    status: "submitted",
    sent_days: 7,
    start_by_days: -4,
    started_days: 6,
    submitted_days: 2,
    due_days: 5,
    score: null,
    answers: {
      [sid("aq:brief:poster")]: { response: null, awarded_score: null, reviewer_comment: null, marked_at: null, file: "festival-poster.pdf" },
      [sid("aq:brief:motion")]: { response: "https://drive.example.test/festival-motion", awarded_score: null, reviewer_comment: null, marked_at: null },
      [sid("aq:brief:note")]: {
        response: "I kept the poster to two colours so it reads on a phone, and cut the motion piece to the beat of the festival's own track.",
        awarded_score: null,
        reviewer_comment: null,
        marked_at: null,
      },
    },
  },
  {
    application_assessment_id: sid("sit:sales:emeka:case"),
    application_id: sid("app:2"),
    assessment_definition_id: A("case"),
    status: "scored",
    sent_days: 6,
    start_by_days: -3,
    started_days: 5,
    submitted_days: 5,
    due_days: null,
    score: 72,
    answers: {
      [sid("aq:case:plan")]: { response: "Start with weekday lunch offers in three of the five outlets…", awarded_score: 15, reviewer_comment: "Clear plan, light on figures", marked_at: at(4, "12:00") },
      [sid("aq:case:objection")]: { response: "Agree a smaller test in the two weakest outlets…", awarded_score: 7, reviewer_comment: null, marked_at: at(4, "12:00") },
    },
  },
  {
    application_assessment_id: sid("sit:sales:emeka:style"),
    application_id: sid("app:2"),
    assessment_definition_id: A("style"),
    status: "scored",
    sent_days: 6,
    start_by_days: -3,
    started_days: 5,
    submitted_days: 5,
    due_days: null,
    score: 75,
    answers: {},
  },
  {
    application_assessment_id: sid("sit:sales:tobi:case"),
    application_id: sid("app:0"),
    assessment_definition_id: A("case"),
    status: "scored",
    sent_days: 8,
    start_by_days: -5,
    started_days: 7,
    submitted_days: 7,
    due_days: null,
    score: 80,
    answers: {},
  },
  {
    application_assessment_id: sid("sit:design:segun"),
    application_id: sid("app:8"),
    assessment_definition_id: A("brief"),
    status: "sent",
    sent_days: 1,
    start_by_days: 2,
    started_days: null,
    submitted_days: null,
    due_days: 5,
    score: null,
    answers: {},
  },
];

/* ------------------------------------------------------------------ *
 * Interviews: a closed round with its report, an open one with one card in, an upcoming one
 * ------------------------------------------------------------------ */

export interface MockCard {
  employee_key: string;
  ratings: Record<number, number>;
  overall_rating: number | null;
  decision: "select" | "on_hold" | "reject" | null;
  comments: string | null;
  private_notes: string | null;
  submitted_days: number | null;
}

export interface MockInterview {
  interview_id: string;
  interview_round_id: string;
  application_id: string;
  round_number: number;
  title: string;
  interview_type: "in_person" | "video" | "phone";
  start: string;
  end: string;
  status: "scheduled" | "done" | "cancelled";
  round_status: "open" | "closed";
  closed_days: number | null;
  meeting_url: string | null;
  worksite: { worksite_id: string; name: string; address: string | null } | null;
  details: { current_employer: string | null; academics: "outstanding" | "very_good" | "good" | "average" | "poor" | null; total: number | null; relevant: number | null };
  report: { text: string; decision: "select" | "on_hold" | "reject"; by: string; days: number } | null;
  form_document_id: string | null;
  cards: MockCard[];
}

/** People's Lekki office (mock/modules/worksites.ts), where in-person rounds sit. */
const HUB = { worksite_id: sid("worksite:LEKKI"), name: "MyCity Office, Lekki", address: "7 Admiralty Way, Lekki Phase 1, Lagos" };

export const INTERVIEWS: MockInterview[] = [
  {
    interview_id: sid("int:kunle"),
    interview_round_id: sid("round:kunle"),
    application_id: sid("app:6"),
    round_number: 1,
    title: "Interview 1",
    interview_type: "in_person",
    start: at(5, "11:00"),
    end: at(5, "12:00"),
    status: "done",
    round_status: "closed",
    closed_days: 4,
    meeting_url: null,
    worksite: HUB,
    details: { current_employer: "A Lagos events company", academics: "very_good", total: 144, relevant: 120 },
    report: {
      text: "A proven sales leader with a strong Lagos network and clear thinking on pricing. Needs support on hospitality contracts in the first quarter.",
      decision: "select",
      by: "ifeoma",
      days: 3,
    },
    form_document_id: sid("doc:form:kunle"),
    cards: [
      {
        employee_key: "ifeoma",
        ratings: { 0: 8, 1: 9, 2: 9, 3: 8, 4: 8, 5: 9, 6: 9, 7: 7, 8: 9, 9: 8 },
        overall_rating: null,
        decision: "select",
        comments: "Clear on how he would grow partner revenue in the first six months.",
        private_notes: "Ask about the notice period at his current employer.",
        submitted_days: 5,
      },
      {
        employee_key: "cynthia",
        ratings: { 0: 8, 1: 8, 2: 8, 3: 7, 4: 8, 5: 8, 6: 9, 7: 8, 8: 8, 9: 7 },
        overall_rating: null,
        decision: "select",
        comments: "Strong references from two past employers.",
        private_notes: null,
        submitted_days: 4,
      },
    ],
  },
  {
    interview_id: sid("int:tobi"),
    interview_round_id: sid("round:tobi"),
    application_id: sid("app:0"),
    round_number: 1,
    title: "Interview 1",
    interview_type: "video",
    start: at(1, "10:00"),
    end: at(1, "11:00"),
    status: "scheduled",
    round_status: "open",
    closed_days: null,
    meeting_url: "https://meet.example.test/mycity-sales-1",
    worksite: null,
    details: { current_employer: "A Lagos media agency", academics: "good", total: 108, relevant: 96 },
    report: null,
    form_document_id: null,
    cards: [
      {
        employee_key: "ifeoma",
        ratings: { 0: 7, 1: 8, 2: 8, 3: 7, 4: 8, 5: 8, 6: 9, 7: 7, 8: 8, 9: 8 },
        overall_rating: null,
        decision: "on_hold",
        comments: "Good on agency sales; less on running a team.",
        private_notes: null,
        submitted_days: 1,
      },
      { employee_key: "cynthia", ratings: { 0: 8, 1: 7 }, overall_rating: null, decision: null, comments: null, private_notes: null, submitted_days: null },
    ],
  },
  {
    interview_id: sid("int:halima"),
    interview_round_id: sid("round:halima"),
    application_id: sid("app:1"),
    round_number: 1,
    title: "Interview 1",
    interview_type: "in_person",
    start: `${isoDaysAhead(2)}T10:00:00.000Z`,
    end: `${isoDaysAhead(2)}T11:00:00.000Z`,
    status: "scheduled",
    round_status: "open",
    closed_days: null,
    meeting_url: null,
    worksite: HUB,
    details: { current_employer: null, academics: null, total: null, relevant: null },
    report: null,
    form_document_id: null,
    cards: [
      { employee_key: "cynthia", ratings: {}, overall_rating: null, decision: null, comments: null, private_notes: null, submitted_days: null },
      { employee_key: "ifeoma", ratings: {}, overall_rating: null, decision: null, comments: null, private_notes: null, submitted_days: null },
    ],
  },
  {
    interview_id: sid("int:uche"),
    interview_round_id: sid("round:uche"),
    application_id: sid("app:11"),
    round_number: 1,
    title: "Interview 1",
    interview_type: "phone",
    start: `${isoDaysAhead(1)}T14:00:00.000Z`,
    end: `${isoDaysAhead(1)}T14:30:00.000Z`,
    status: "scheduled",
    round_status: "open",
    closed_days: null,
    meeting_url: null,
    worksite: null,
    details: { current_employer: null, academics: null, total: null, relevant: null },
    report: null,
    form_document_id: null,
    cards: [{ employee_key: "cynthia", ratings: {}, overall_rating: null, decision: null, comments: null, private_notes: null, submitted_days: null }],
  },
];

export const WORKSITES = [HUB];

/* ------------------------------------------------------------------ *
 * The Talent Pool
 * ------------------------------------------------------------------ */

export const POOL: PoolEntry[] = [
  {
    talent_pool_entry_id: sid("pool:kemi"),
    candidate_id: sid("cand:13"),
    name: "Kemi Bello",
    email: "kemi.bello@example.test",
    application_id: sid("app:13"),
    applied_for: null,
    score: 74,
    score_provisional: false,
    reason: "Strong second choice for partnerships; the role went to another candidate",
    added_by_name: byKey("cynthia")?.display_name ?? null,
    created_at: at(45, "15:00"),
    expires_at: `${isoDaysAhead(685)}T15:00:00.000Z`,
    invited_at: at(2, "10:00"),
    invited_vacancy: null,
    hired_from_pool: false,
    removed_at: null,
  },
  {
    talent_pool_entry_id: sid("pool:femi"),
    candidate_id: sid("cand:12"),
    name: "Femi Lawal",
    email: "femi.lawal@example.test",
    application_id: sid("app:12"),
    applied_for: null,
    score: 38,
    score_provisional: false,
    reason: "Good individual seller; not yet ready to lead a team",
    added_by_name: byKey("cynthia")?.display_name ?? null,
    created_at: at(6, "16:00"),
    expires_at: `${isoDaysAhead(724)}T16:00:00.000Z`,
    invited_at: null,
    invited_vacancy: null,
    hired_from_pool: false,
    removed_at: null,
  },
  {
    talent_pool_entry_id: sid("pool:dayo"),
    candidate_id: sid("cand:pool:dayo"),
    name: "Dayo Martins",
    email: "dayo.martins@example.test",
    application_id: null,
    applied_for: null,
    score: 66,
    score_provisional: true,
    reason: "Kept from last year's content hiring; strong on video",
    added_by_name: null,
    created_at: at(200, "12:00"),
    expires_at: `${isoDaysAhead(530)}T12:00:00.000Z`,
    invited_at: null,
    invited_vacancy: null,
    hired_from_pool: false,
    removed_at: null,
  },
];

/* ------------------------------------------------------------------ *
 * Candidate Emails (as the shipped Markdown defaults read)
 * ------------------------------------------------------------------ */

export const EMAILS: CandidateEmail[] = [
  ["application-received", "Application Received", "We have your application for {{ vacancy_title }}", "Hello {{ recipient.first_name }},\n\nThank you for applying for {{ vacancy_title }} at MyCity App. Your reference is {{ reference }}.\n\nWe read every application and will be in touch.", ["vacancy_title", "reference"]],
  ["apply-invite", "Invitation to Apply", "Apply for {{ vacancy_title }} at MyCity App", "Hello {{ recipient.first_name }},\n\nWe would like you to apply for {{ vacancy_title }}.\n\n[Apply Now]({{ apply_url }})\n\nThe link works once, until {{ expires_at }}.", ["vacancy_title", "apply_url", "expires_at"]],
  ["assessment-invite", "Assessment Invitation", "Your assessment for {{ vacancy_title }}", "Hello {{ recipient.first_name }},\n\nThe next step for {{ vacancy_title }} is {{ assessment_name }}. Start it by {{ start_by }}.\n\n[Open the Assessment]({{ assess_url }})", ["vacancy_title", "assessment_name", "duration_minutes", "due_days", "start_by", "assess_url"]],
  ["interview-invite", "Interview Invitation", "Your interview for {{ vacancy_title }}", "Hello {{ recipient.first_name }},\n\nWe would like to meet you for {{ vacancy_title }} on {{ scheduled_start }}. The calendar invitation is attached.", ["vacancy_title", "in_person", "by_video", "by_phone", "scheduled_start", "scheduled_end", "place", "place_address", "meeting_url", "rescheduled", "cancelled"]],
  ["candidate-not-progressed", "Not Progressing", "Your application for {{ vacancy_title }}", "Hello {{ recipient.first_name }},\n\nThank you for your time with us. We will not take your application for {{ vacancy_title }} further.\n\nOur other roles are on [our careers page]({{ careers_url }}).", ["vacancy_title", "careers_url"]],
].map(([key, name, subject, body, vars]) => ({
  key: key as CandidateEmail["key"],
  name: name as string,
  subject: subject as string,
  body: body as string,
  version: 0,
  is_default: true,
  variables: [...(vars as string[]), "recipient", "org"],
  updated_at: null,
}));

export { isoDaysAgo };
