"use strict";
/**
 * Vacancies: a role written by Operations & People, published to the careers page and shared by
 * its link (docs/guides/recruitment.md §3 steps 1 to 4, §5, §6.1).
 *
 * Lifecycle (guide §6.1): draft → open ⇄ paused → closed; draft and paused may also close.
 * A vacancy is reached on the public site by its slug, made once at first publish and never
 * changed, so pausing and resuming keep the same link (MILESTONES §9, decided 04/11/2026).
 *
 * The public shapes at the end (PublicJob...) are allow-lists: they name every field a stranger
 * may read, and nothing else ever reaches /api/public/v1/jobs.
 */
const { z } = require("zod");
const { uuid, isoDate, isoDateTime, money, blank, listQuery, Paged } = require("./common");
const { PersonRef, WorkPattern } = require("./organisation");
const { PlaceInput, PlaceView } = require("./maps");

/**
 * An optional whole number a form may leave empty. `blank(z.coerce.number())` would read "" as 0;
 * here "" and null are "not given", digits are the number, anything else is refused.
 * @param {number} min @param {number} max @param {string} tooBig
 */
const optionalWhole = (min, max, tooBig) =>
  z.preprocess(
    (v) => (v === "" || v === null ? undefined : typeof v === "string" ? Number(v.trim()) : v),
    z
      .number({ invalid_type_error: "A whole number" })
      .int("A whole number")
      .min(min, `At least ${min}`)
      .max(max, tooBig)
      .optional(),
  );

/* ------------------------------------------------------------------ *
 * Code lists
 * ------------------------------------------------------------------ */

const VacancyStatus = z.enum(["draft", "open", "paused", "closed"]);
const VacancyCloseReason = z.enum(["filled", "cancelled", "on_hold"]);
const EmploymentType = z.enum(["full_time", "part_time", "contract", "internship"]);

/**
 * Where a vacancy's question is asked: on the Apply form, or rated by each panelist at interview
 * (guide §3 step 3).
 */
const QuestionPurpose = z.enum(["application", "interview"]);
/** text, yes_no and choice are Apply questions; rating is an interview question, rated 1 to 5. */
const VacancyQuestionType = z.enum(["text", "yes_no", "choice", "rating"]);

/** The five parts of the weighted scorecard (A10, guide §6.5), and their default weights. */
const ScorecardCode = z.enum(["screening", "psychometric", "technical", "case_study", "interview"]);
const SCORECARD_DEFAULTS = Object.freeze({
  screening: 15,
  psychometric: 15,
  technical: 25,
  case_study: 20,
  interview: 25,
});

/**
 * The pipeline's stages, as the reference list 4099 holds them. M4 uses the first five; offer and
 * after are M5's (decided 04/11/2026), declared here so the column's CHECK is set once.
 */
const ApplicationStage = z.enum([
  "application",
  "screening",
  "assessment",
  "interview",
  "shortlist",
  "offer",
  "documentation",
  "pre_onboarding",
  "onboarding",
  "hired",
]);
const M4_STAGES = Object.freeze(["application", "screening", "assessment", "interview", "shortlist"]);

/* ------------------------------------------------------------------ *
 * Parts
 * ------------------------------------------------------------------ */

/** A vacancy as other records name it. */
const VacancyRef = z
  .object({
    vacancy_id: uuid,
    number: z.string(),
    title: z.string(),
  })
  .strict();

/** One question on a vacancy. A retired question (`active` false) stays for the answers it has. */
const VacancyQuestion = z
  .object({
    vacancy_question_id: uuid,
    purpose: QuestionPurpose,
    question_type: VacancyQuestionType,
    prompt: z.string(),
    options: z.array(z.string()).nullable(),
    required: z.boolean(),
    display_order: z.number().int().min(0),
    active: z.boolean(),
  })
  .strict();

/** One part of the vacancy's scorecard. */
const ScorecardWeight = z
  .object({
    code: ScorecardCode,
    name: z.string(),
    weight: z.number().int().min(0).max(100),
  })
  .strict();

/** How many active applications sit at each M4 stage. */
const StageCount = z
  .object({
    stage: ApplicationStage,
    count: z.number().int().min(0),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Staff: list, detail, summary
 * ------------------------------------------------------------------ */

/** One row of Recruitment · Vacancies. */
const Vacancy = z
  .object({
    vacancy_id: uuid,
    number: z.string(),
    title: z.string(),
    slug: z.string().nullable(),
    status: VacancyStatus,
    close_reason: VacancyCloseReason.nullable(),
    department_id: uuid.nullable(),
    department: z.string().nullable(),
    hiring_manager: PersonRef.nullable(),
    location: z.string().nullable(),
    work_pattern: WorkPattern.nullable(),
    positions: z.number().int().min(1),
    applicants: z.number().int().min(0),
    in_progress: z.number().int().min(0),
    closes_at: isoDateTime.nullable(),
    past_closing: z.boolean(),
    published_at: isoDateTime.nullable(),
    days_open: z.number().int().min(0).nullable(),
    public_url: z.string().nullable(),
    created_at: isoDateTime,
  })
  .strict();

const VacancyPage = Paged(Vacancy);

/** One vacancy, as its sheet and the edit form read it. */
const VacancyDetail = Vacancy.extend({
  org_seat_id: uuid.nullable(),
  employment_type: EmploymentType.nullable(),
  work_pattern_note: z.string().nullable(),
  location_place: PlaceView.nullable(),
  probation_months: z.number().int().min(0).nullable(),
  reports_to: z.string().nullable(),
  min_experience_years: z.number().int().min(0).nullable(),
  salary_min: money.nullable(),
  salary_max: money.nullable(),
  salary_visible: z.boolean(),
  description: z.string(),
  requirements: z.string().nullable(),
  nice_to_have: z.string().nullable(),
  target_start_on: isoDate.nullable(),
  paused_at: isoDateTime.nullable(),
  closed_at: isoDateTime.nullable(),
  questions: z.array(VacancyQuestion).max(40),
  scorecard: z.array(ScorecardWeight).length(5),
  by_stage: z.array(StageCount).max(10),
  can_edit: z.boolean(),
}).strict();

/** GET /recruitment/vacancies. */
const VacancyListQuery = listQuery(
  {
    status: VacancyStatus.optional(),
    department_id: uuid.optional(),
  },
  ["closes_at", "title", "created_at", "published_at"],
);

/** GET /recruitment/vacancies/summary: the four figures and the funnel, within the reader's scope. */
const VacanciesSummary = z
  .object({
    open: z.number().int().min(0),
    applicants: z.number().int().min(0),
    in_interview: z.number().int().min(0),
    past_closing: z.number().int().min(0),
    funnel: z.array(StageCount).max(10),
  })
  .strict();

/** GET /recruitment/vacancies/suggested: a vacant seat on the organogram with no live vacancy. */
const SeatSuggestion = z
  .object({
    org_seat_id: uuid,
    title: z.string(),
    department_id: uuid,
    department: z.string(),
    reports_to: z.string().nullable(),
  })
  .strict();

const SeatSuggestionPage = Paged(SeatSuggestion);
const SeatSuggestionListQuery = listQuery({});

/* ------------------------------------------------------------------ *
 * Staff: writes
 * ------------------------------------------------------------------ */

const PICK_PLACE = "Pick the location";

/** The fields New Vacancy and Edit share (guide §3 step 2, §6.1). */
const vacancyFields = {
  title: z.string().trim().min(3, "Name the role").max(120, "At most 120 characters"),
  department_id: uuid,
  hiring_manager_id: uuid,
  org_seat_id: uuid.optional(),
  positions: z.coerce.number().int().min(1, "At least one").max(50, "At most 50"),
  employment_type: EmploymentType,
  work_pattern: WorkPattern,
  work_pattern_note: blank(z.string().trim().max(80, "At most 80 characters")),
  /** Picked at level area, never typed (F27); required unless the role is remote. */
  location: PlaceInput.optional(),
  probation_months: optionalWhole(0, 24, "At most 24 months"),
  reports_to: blank(z.string().trim().max(120, "At most 120 characters")),
  min_experience_years: optionalWhole(0, 40, "At most 40 years"),
  salary_min: blank(money),
  salary_max: blank(money),
  salary_visible: z.boolean().default(false),
  description: z.string().trim().min(80, "At least 80 characters").max(8000, "At most 8000 characters"),
  requirements: z.string().trim().min(20, "Say what is needed").max(4000, "At most 4000 characters"),
  nice_to_have: blank(z.string().trim().max(4000, "At most 4000 characters")),
  target_start_on: blank(isoDate),
  /** The last day it takes applications; it closes at 23:59 Lagos time that day. */
  closes_on: isoDate,
};

const salaryInOrder = (v) => !v.salary_min || !v.salary_max || Number(v.salary_max) >= Number(v.salary_min);
const placedUnlessRemote = (v) => v.work_pattern === undefined || v.work_pattern === "remote" || Boolean(v.location);

/** POST /recruitment/vacancies. `publish` puts it live in the same save. */
const VacancyCreate = z
  .object({ ...vacancyFields, publish: z.boolean().default(false) })
  .strict()
  .refine(salaryInOrder, { message: "Below the minimum", path: ["salary_max"] })
  .refine(placedUnlessRemote, { message: PICK_PLACE, path: ["location"] });

/** PATCH /recruitment/vacancies/:id: any of New Vacancy's fields; a picked place replaces the old. */
const VacancyEdit = z
  .object(Object.fromEntries(Object.entries(vacancyFields).map(([k, s]) => [k, s.optional()])))
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to change", path: ["title"] })
  .refine(salaryInOrder, { message: "Below the minimum", path: ["salary_max"] });

/** POST /recruitment/vacancies/:id/close. */
const VacancyClose = z.object({ close_reason: VacancyCloseReason }).strict();

/** One question as the Questions form sends it; an id keeps an existing question. */
const VacancyQuestionInput = z
  .object({
    vacancy_question_id: uuid.optional(),
    purpose: QuestionPurpose,
    question_type: VacancyQuestionType,
    prompt: z.string().trim().min(5, "Write the question").max(500, "At most 500 characters"),
    options: z.array(z.string().trim().min(1).max(120)).min(2, "At least two options").max(8).optional(),
    required: z.boolean().default(true),
  })
  .strict()
  .refine((q) => (q.purpose === "interview") === (q.question_type === "rating"), {
    message: "Interview questions are rated",
    path: ["question_type"],
  })
  .refine((q) => (q.question_type === "choice") === Boolean(q.options), {
    message: "Only a choice has options",
    path: ["options"],
  });

/**
 * PUT /recruitment/vacancies/:id/questions: the whole set, in order. A question left out that has
 * answers or ratings is retired, not deleted (guide §5).
 */
const VacancyQuestionsSave = z
  .object({
    questions: z
      .array(VacancyQuestionInput)
      .max(30, "At most 30 questions")
      .refine((qs) => qs.filter((q) => q.purpose === "application").length <= 10, "At most 10 Apply questions"),
  })
  .strict();

/** PUT /recruitment/vacancies/:id/scorecard: a whole number for each part, adding up to 100. */
const ScorecardSave = z
  .object({
    weights: z
      .object(Object.fromEntries(ScorecardCode.options.map((c) => [c, z.coerce.number().int().min(0).max(100)])))
      .strict(),
  })
  .strict()
  .refine((v) => Object.values(v.weights).reduce((a, b) => a + b, 0) === 100, {
    message: "The parts must add up to 100",
    path: ["weights"],
  });

/* ------------------------------------------------------------------ *
 * Write With AI (guide §9): nothing here is kept
 * ------------------------------------------------------------------ */

/** POST /recruitment/vacancies/assist: what New Vacancy holds, and the person's notes on the role. */
const JdDraftRequest = z
  .object({
    title: z.string().trim().min(3, "Name the role").max(120),
    department_id: uuid.optional(),
    employment_type: EmploymentType.optional(),
    work_pattern: WorkPattern.optional(),
    min_experience_years: optionalWhole(0, 40, "At most 40 years"),
    instruction: z.string().trim().min(10, "Say what the role does").max(2000, "At most 2000 characters"),
    description: z.string().trim().max(8000).default(""),
    requirements: z.string().trim().max(4000).default(""),
    nice_to_have: z.string().trim().max(4000).default(""),
  })
  .strict();

/** A drafted description, must have and nice to have, or why there is none. */
const JdDraft = z
  .object({
    available: z.boolean(),
    reason: z.enum(["off", "limit"]).nullable(),
    description: z.string().nullable(),
    requirements: z.string().nullable(),
    nice_to_have: z.string().nullable(),
    ai_run_id: uuid.nullable(),
  })
  .strict();

/** The model's answer for `jd-draft`, held to the form's own limits. */
const JdDraftOutput = z
  .object({
    description: z.string().trim().min(80).max(8000),
    requirements: z.string().trim().min(20).max(4000),
    nice_to_have: z.string().trim().max(4000),
  })
  .strict();

/** A question as `screening-questions` suggests it. */
const SuggestedQuestion = z
  .object({
    purpose: QuestionPurpose,
    question_type: VacancyQuestionType,
    prompt: z.string().trim().min(5).max(500),
    options: z.array(z.string().trim().min(1).max(120)).max(8).nullable(),
  })
  .strict();

/** POST /recruitment/vacancies/:id/assist/questions: suggested questions, or why there are none. */
const QuestionsDraft = z
  .object({
    available: z.boolean(),
    reason: z.enum(["off", "limit"]).nullable(),
    questions: z.array(SuggestedQuestion).max(15),
    ai_run_id: uuid.nullable(),
  })
  .strict();

/** The model's answer for `screening-questions`. */
const QuestionsDraftOutput = z
  .object({
    application: z.array(z.object({ prompt: z.string().trim().min(5).max(500) }).strict()).max(5),
    interview: z.array(z.object({ prompt: z.string().trim().min(5).max(500) }).strict()).max(8),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Public: go.mycityapp.io/jobs (allow-lists, guide §6.1)
 * ------------------------------------------------------------------ */

/** GET /api/public/v1/jobs: search by `q`, newest first. */
const PublicJobListQuery = listQuery({});

/** One open role on Careers. */
const PublicJobCard = z
  .object({
    slug: z.string(),
    title: z.string(),
    department: z.string().nullable(),
    location: z.string().nullable(),
    work_pattern: WorkPattern.nullable(),
  })
  .strict();

const PublicJobPage = Paged(PublicJobCard);

/**
 * GET /api/public/v1/jobs/:slug. A hidden salary band is left out, not sent as null.
 * `state`: open takes applications; paused and closed say so; filled is closed as filled.
 * `how_we_hire` names the steps this role uses, from its scorecard.
 */
const PublicJob = PublicJobCard.extend({
  employment_type: EmploymentType.nullable(),
  work_pattern_note: z.string().nullable(),
  probation_months: z.number().int().min(0).nullable(),
  reports_to: z.string().nullable(),
  min_experience_years: z.number().int().min(0).nullable(),
  salary_min: money.optional(),
  salary_max: money.optional(),
  description: z.string(),
  requirements: z.string().nullable(),
  nice_to_have: z.string().nullable(),
  how_we_hire: z.array(z.enum(["apply", "screening", "assessment", "interview"])).max(4),
  applicants: z.number().int().min(0),
  closes_at: isoDateTime.nullable(),
  state: z.enum(["open", "paused", "closed", "filled"]),
}).strict();

/** POST /api/public/v1/jobs/:slug/apply: the Apply link's token, shown once. */
const ApplyStarted = z.object({ token: z.string() }).strict();

/** Path of /jobs/:slug. */
const SlugParams = z
  .object({ slug: z.string().trim().min(1).max(160).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Not a role's address") })
  .strict();

/* ------------------------------------------------------------------ *
 * Gate 6
 * ------------------------------------------------------------------ */

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  VacancyRef: { table: "vacancy" },
  VacancyQuestion: { table: "vacancy_question" },
  ScorecardWeight: {
    table: "recruitment_scorecard_criterion",
    virtual: { weight: "the column's numeric(5,2), as a whole number" },
  },
  StageCount: { table: null, reason: "a count of active applications at one stage" },
  Vacancy: {
    table: "vacancy",
    virtual: {
      department: "department.name",
      hiring_manager: "the hiring manager, from employee and department",
      applicants: "count of the vacancy's applications",
      in_progress: "count of its active applications",
      past_closing: "open and closes_at is past",
      days_open: "whole Lagos days since published_at, to closed_at or today",
      public_url: "the careers page origin and /jobs/<slug>, once published",
    },
  },
  VacancyPage: { table: null, reason: "a page of vacancies" },
  VacancyDetail: {
    table: "vacancy",
    virtual: {
      department: "department.name",
      hiring_manager: "the hiring manager, from employee and department",
      applicants: "count of the vacancy's applications",
      in_progress: "count of its active applications",
      past_closing: "open and closes_at is past",
      days_open: "whole Lagos days since published_at, to closed_at or today",
      public_url: "the careers page origin and /jobs/<slug>, once published",
      location_place: "the location as a place, from place (owner vacancy.location)",
      questions: "the vacancy_question rows",
      scorecard: "the recruitment_scorecard_criterion rows",
      by_stage: "active applications counted by stage",
      can_edit: "the reader may edit it: in scope with recruitment edit, and not closed",
    },
  },
  VacancyListQuery: { table: null, reason: "list controls and filters for Vacancies" },
  VacanciesSummary: { table: null, reason: "counts over vacancy and application within the reader's scope" },
  SeatSuggestion: {
    table: "org_seat",
    virtual: {
      department: "department.name",
      reports_to: "the line manager's name, or the seat above's title",
    },
  },
  SeatSuggestionPage: { table: null, reason: "a page of vacant seats" },
  SeatSuggestionListQuery: { table: null, reason: "list controls for Suggested From Organogram" },
  VacancyCreate: {
    table: "vacancy",
    virtual: {
      closes_on: "the day picked; stored as closes_at, 23:59:59 Lagos that day",
      publish: "publish in the same save",
    },
  },
  VacancyEdit: {
    table: "vacancy",
    virtual: { closes_on: "the day picked; stored as closes_at, 23:59:59 Lagos that day" },
  },
  VacancyClose: { table: "vacancy" },
  VacancyQuestionInput: { table: "vacancy_question" },
  VacancyQuestionsSave: { table: null, reason: "the whole set of a vacancy's questions" },
  ScorecardSave: { table: null, reason: "the five weights, one recruitment_scorecard_criterion row each" },
  JdDraftRequest: { table: null, reason: "what New Vacancy holds; nothing is kept" },
  JdDraft: { table: null, reason: "a draft shown before anything changes; nothing is kept" },
  JdDraftOutput: { table: null, reason: "the model's answer, checked before anyone sees it" },
  SuggestedQuestion: { table: null, reason: "a question the model suggests; nothing is kept" },
  QuestionsDraft: { table: null, reason: "suggested questions shown before anything changes" },
  QuestionsDraftOutput: { table: null, reason: "the model's answer, checked before anyone sees it" },
  PublicJobListQuery: { table: null, reason: "list controls for the public careers page" },
  PublicJobCard: { table: null, reason: "the allow-list of a vacancy a stranger may read" },
  PublicJobPage: { table: null, reason: "a page of open roles" },
  PublicJob: { table: null, reason: "the allow-list of a vacancy a stranger may read" },
  ApplyStarted: { table: null, reason: "the Apply link's token, shown once; only its hash is kept" },
  SlugParams: { table: null, reason: "the :slug path parameter" },
};

module.exports = {
  TABLES,
  optionalWhole,
  VacancyStatus,
  VacancyCloseReason,
  EmploymentType,
  QuestionPurpose,
  VacancyQuestionType,
  ScorecardCode,
  SCORECARD_DEFAULTS,
  ApplicationStage,
  M4_STAGES,
  VacancyRef,
  VacancyQuestion,
  ScorecardWeight,
  StageCount,
  Vacancy,
  VacancyPage,
  VacancyDetail,
  VacancyListQuery,
  VacanciesSummary,
  SeatSuggestion,
  SeatSuggestionPage,
  SeatSuggestionListQuery,
  VacancyCreate,
  VacancyEdit,
  VacancyClose,
  VacancyQuestionInput,
  VacancyQuestionsSave,
  ScorecardSave,
  JdDraftRequest,
  JdDraft,
  JdDraftOutput,
  SuggestedQuestion,
  QuestionsDraft,
  QuestionsDraftOutput,
  PublicJobListQuery,
  PublicJobCard,
  PublicJobPage,
  PublicJob,
  ApplyStarted,
  SlugParams,
};
