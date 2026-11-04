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
const { uuid, isoDate, isoDateTime, money, blank, listQuery, Paged, recordId, changesBeside, nothingOn } = require("./common");
const { PersonRef, WorkPattern } = require("./organisation");
const { PlaceInput, PlaceView, PlaceToken } = require("./maps");

/**
 * An optional whole number a form may leave empty. `blank(z.coerce.number())` would read "" as 0;
 * here "" and null are "not given", digits are the number, anything else is refused.
 * @param {number} min @param {number} max @param {string} tooBig
 */
const optionalWhole = (min, max, tooBig) =>
  z.preprocess(
    (v) => {
      if (v === null) return undefined;
      if (typeof v !== "string") return v;
      const t = v.trim();
      return t === "" ? undefined : Number(t);
    },
    z
      .number({ invalid_type_error: "A whole number" })
      .int("A whole number")
      .min(min, `At least ${min}`)
      .max(max, tooBig)
      .optional(),
  );

/**
 * An optional field an edit may empty: "" (or only spaces) and null clear it and arrive as null,
 * left out leaves it as it is, anything else is the field's own schema.
 * @template {z.ZodTypeAny} T @param {T} schema
 */
const clearable = (schema) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), schema.nullable().optional());

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
/** text, yes_no and choice are Apply questions; rating is an interview question, rated 1 to 10. */
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

/** One part of the vacancy's scorecard: switched on or off for this role (guide §6.1), and its weight. */
const ScorecardWeight = z
  .object({
    code: ScorecardCode,
    name: z.string(),
    active: z.boolean(),
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
  working_days: z.string().nullable(),
  /** The must-meet conditions Screen With AI last asked for (guide §6.4). */
  screening_conditions: z.array(z.string()).max(3),
  /** The board's columns for this role: the M4 stages, less those whose scorecard parts are off. */
  board_stages: z.array(ApplicationStage).max(5),
  /** The questions in use, in order; a retired one stays only on the answers it was given. */
  questions: z.array(VacancyQuestion).max(30),
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
  /** "Monday to Saturday", as MyCity's job descriptions say it. */
  working_days: blank(z.string().trim().max(60, "At most 60 characters")),
  /** The last day it takes applications; it closes at 23:59 Lagos time that day. */
  closes_on: isoDate,
};

/** Two amounts compared exactly, as whole kobo: money is a two-place decimal string, never a float. */
const kobo = (amount) => BigInt(amount.replace(".", ""));
const salaryInOrder = (v) => !v.salary_min || !v.salary_max || kobo(v.salary_max) >= kobo(v.salary_min);
const placedUnlessRemote = (v) => v.work_pattern === undefined || v.work_pattern === "remote" || Boolean(v.location);

/** POST /recruitment/vacancies. `publish` puts it live in the same save. */
const VacancyCreate = z
  .object({ ...vacancyFields, publish: z.boolean().default(false) })
  .strict()
  .refine(salaryInOrder, { message: "Below the minimum", path: ["salary_max"] })
  .refine(placedUnlessRemote, { message: PICK_PLACE, path: ["location"] });

/** The fields New Vacancy may leave empty, which an edit may also empty again. */
const CLEARABLE = [
  "org_seat_id",
  "work_pattern_note",
  "probation_months",
  "reports_to",
  "min_experience_years",
  "salary_min",
  "salary_max",
  "nice_to_have",
  "target_start_on",
  "working_days",
];

/**
 * PATCH /recruitment/vacancies/:id: any of New Vacancy's fields; a picked place replaces the old, and
 * an optional field sent empty is cleared (null). Whether the result still has a place unless remote,
 * and its pay in order, is checked by the service against the stored vacancy.
 */
const VacancyEdit = z
  .object(
    Object.fromEntries(
      Object.entries(vacancyFields).map(([k, s]) => [k, CLEARABLE.includes(k) ? clearable(s) : s.optional()]),
    ),
  )
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to change", path: ["title"] })
  .refine(salaryInOrder, { message: "Below the minimum", path: ["salary_max"] });

/**
 * New Vacancy as a Praxis AI card (guide §9; TB, 04/11/2026): the form's own fields, the place as its
 * token (decision 37; the form sends { token }), the department and hiring manager named by the
 * person and matched. Pay and the seat it fills stay on the screen's form.
 */
const VacancyAdd = z
  .object({
    title: vacancyFields.title,
    department_id: recordId("department"),
    hiring_manager_id: recordId("employee"),
    positions: vacancyFields.positions.default(1),
    employment_type: EmploymentType,
    work_pattern: WorkPattern,
    work_pattern_note: vacancyFields.work_pattern_note,
    location: PlaceToken.optional(),
    working_days: vacancyFields.working_days,
    min_experience_years: vacancyFields.min_experience_years,
    description: vacancyFields.description,
    requirements: vacancyFields.requirements,
    nice_to_have: vacancyFields.nice_to_have,
    closes_on: vacancyFields.closes_on,
    publish: z.boolean().default(false),
  })
  .strict()
  .refine(placedUnlessRemote, { message: PICK_PLACE, path: ["location"] });

/** Save Vacancy as a card: the vacancy (its id, or its number or title) beside the card's fields, only what changes. */
const VacancyChange = z
  .object({
    vacancy_id: recordId("vacancy"),
    title: vacancyFields.title.optional(),
    department_id: recordId("department").optional(),
    hiring_manager_id: recordId("employee").optional(),
    positions: vacancyFields.positions.optional(),
    employment_type: EmploymentType.optional(),
    work_pattern: WorkPattern.optional(),
    work_pattern_note: clearable(vacancyFields.work_pattern_note),
    location: PlaceToken.optional(),
    working_days: clearable(vacancyFields.working_days),
    min_experience_years: clearable(vacancyFields.min_experience_years),
    description: vacancyFields.description.optional(),
    requirements: vacancyFields.requirements.optional(),
    nice_to_have: clearable(vacancyFields.nice_to_have),
    closes_on: vacancyFields.closes_on.optional(),
  })
  .strict()
  .refine(changesBeside(["vacancy_id"]), nothingOn("vacancy_id"));

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
      .refine((qs) => qs.filter((q) => q.purpose === "application").length <= 10, "At most 10 Apply questions")
      .refine((qs) => qs.filter((q) => q.purpose === "interview").length <= 20, "At most 20 interview traits"),
  })
  .strict();

/** One part as the Scorecard form sends it. */
const ScorecardPartInput = z
  .object({
    active: z.boolean(),
    weight: z.number({ invalid_type_error: "A whole number" }).int("A whole number").min(0, "0 or more").max(100, "At most 100"),
  })
  .strict();

/**
 * PUT /recruitment/vacancies/:id/scorecard: each part on or off for this role, and a whole-number
 * weight; a part off weighs 0, the parts on add up to 100, and screening or interview is on.
 */
const ScorecardSave = z
  .object({
    parts: z.object(Object.fromEntries(ScorecardCode.options.map((c) => [c, ScorecardPartInput]))).strict(),
  })
  .strict()
  .refine((v) => Object.values(v.parts).every((p) => p.active || p.weight === 0), {
    message: "A part switched off weighs 0",
    path: ["parts"],
  })
  .refine((v) => Object.values(v.parts).reduce((a, p) => a + (p.active ? p.weight : 0), 0) === 100, {
    message: "The parts must add up to 100",
    path: ["parts"],
  })
  .refine((v) => v.parts.screening.active || v.parts.interview.active, {
    message: "Keep screening or interview",
    path: ["parts"],
  });

/* ------------------------------------------------------------------ *
 * Careers Settings (guide §3 step 3, §6.1): setting rows, entered on each environment (A26)
 * ------------------------------------------------------------------ */

/** GET /recruitment/vacancies/settings: About MyCityApp, and the traits New Vacancy starts from. */
const CareersSettings = z
  .object({
    about_company: z.string().nullable(),
    default_traits: z.array(z.string()).max(20),
    updated_at: isoDateTime.nullable(),
  })
  .strict();

/** PUT /recruitment/vacancies/settings. */
const CareersSettingsSave = z
  .object({
    about_company: z.string().trim().max(2000, "At most 2000 characters").optional(),
    default_traits: z
      .array(z.string().trim().min(3, "Name the trait").max(120, "At most 120 characters"))
      .max(20, "At most 20 traits")
      .refine((t) => new Set(t.map((x) => x.toLowerCase())).size === t.length, "A trait is listed twice")
      .optional(),
  })
  .strict()
  .refine((v) => v.about_company !== undefined || v.default_traits !== undefined, {
    message: "Nothing to change",
    path: ["about_company"],
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
  working_days: z.string().nullable(),
  /** About MyCityApp, from Careers Settings: the same paragraph on every role. */
  about_company: z.string().nullable(),
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

/**
 * Path of /jobs/:slug. Any short string: a malformed address answers the same 404 as one that never
 * existed (the careers file checks the shape), so the link says nothing about why it failed.
 */
const SlugParams = z.object({ slug: z.string().min(1).max(200) }).strict();

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
  ScorecardPartInput: { table: "recruitment_scorecard_criterion" },
  CareersSettings: {
    table: null,
    reason: "setting rows recruitment.about_company and recruitment.default_traits (jsonb values)",
  },
  CareersSettingsSave: { table: null, reason: "the two setting rows of Careers Settings" },
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
      board_stages: "the M4 stages less those whose scorecard parts are off (guide §6.3)",
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
  VacancyAdd: {
    table: "vacancy",
    virtual: {
      closes_on: "the day picked; stored as closes_at, 23:59:59 Lagos that day",
      publish: "publish in the same save",
    },
  },
  VacancyChange: {
    table: "vacancy",
    virtual: { closes_on: "the day picked; stored as closes_at, 23:59:59 Lagos that day" },
  },
  VacancyQuestionInput: { table: "vacancy_question" },
  VacancyQuestionsSave: { table: null, reason: "the whole set of a vacancy's questions" },
  ScorecardSave: { table: null, reason: "the five parts, one recruitment_scorecard_criterion row each" },
  JdDraftRequest: { table: null, reason: "what New Vacancy holds; nothing is kept" },
  JdDraft: { table: null, reason: "a draft shown before anything changes; nothing is kept" },
  JdDraftOutput: { table: null, reason: "the model's answer, checked before anyone sees it" },
  SuggestedQuestion: { table: null, reason: "a question the model suggests; nothing is kept" },
  QuestionsDraft: { table: null, reason: "suggested questions shown before anything changes" },
  QuestionsDraftOutput: { table: null, reason: "the model's answer, checked before anyone sees it" },
  PublicJobListQuery: { table: null, reason: "list controls for the public careers page" },
  PublicJobCard: { table: null, reason: "the allow-list of a vacancy a stranger may read" },
  PublicJobPage: { table: null, reason: "a page of open roles" },
  PublicJob: { table: null, reason: "the allow-list of a vacancy a stranger may read, with About MyCityApp" },
  ApplyStarted: { table: null, reason: "the Apply link's token, shown once; only its hash is kept" },
  SlugParams: { table: null, reason: "the :slug path parameter" },
};

module.exports = {
  TABLES,
  optionalWhole,
  clearable,
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
  VacancyAdd,
  VacancyChange,
  VacancyClose,
  VacancyQuestionInput,
  VacancyQuestionsSave,
  ScorecardSave,
  ScorecardPartInput,
  CareersSettings,
  CareersSettingsSave,
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
