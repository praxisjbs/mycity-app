import vacancySchemas from "@mycity/contract/schemas/vacancies.js";
import candidateSchemas from "@mycity/contract/schemas/candidates.js";
import assessmentSchemas from "@mycity/contract/schemas/assessments.js";
import interviewSchemas from "@mycity/contract/schemas/interviews.js";
import poolSchemas from "@mycity/contract/schemas/talent_pool.js";
import type {
  AssessmentDetail,
  AssessmentExport,
  AssessmentQuestionInput,
  CandidateDetail,
  CandidateEmail,
  CandidatesCandidate,
  Interview,
  InterviewDetail,
  ScorecardPart,
  ScorecardWeight,
  Sitting,
  SittingDetail,
  Vacancy,
  VacancyDetail,
  VacancyQuestion,
} from "@mycity/contract/contract.gen.ts";
import type { OfferRow, OnboardingDetail } from "@/api/types/recruitment";
import type { Status } from "@/api/types/performance";
import type { RawResponse } from "../../client";
import { at, created, fail, invalid, isoDaysAgo, isoDaysAhead, notFound, ok, paged, route, sid, type Req } from "../core";
import { byId, byKey, DEPARTMENTS, grantsFor, refKey } from "../data/people";
import * as D from "../data/recruitment";
import { pickAnAddress, placeOf } from "./maps";
import { WORKSITES as SITES } from "./worksites";
import { exportFile } from "./shared";

/**
 * Recruitment on the mock (docs/guides/recruitment.md §5), in the contract's shapes: Vacancies, Careers
 * Settings, Candidates and their emails, Assessments and sittings, Interviews with the blind card, and
 * the Talent Pool. Bodies are checked by the contract's own schemas, so a form meets the API's words.
 * Fixtures live in data/recruitment.ts. M5's Offers and Onboarding stay INTERIM at the end of the file.
 */

/* ------------------------------------------------------------------ *
 * Access, checks and time
 * ------------------------------------------------------------------ */

type Act = "view" | "create" | "edit" | "delete" | "export";
const can = (req: Req, act: Act) => Boolean(req.user && (grantsFor(req.user).recruitment ?? []).includes(act));
const denied = () => fail(403, "PERMISSION_DENIED", "You do not have access to this");

/** A staff route of Recruitment: the grant first, as requirePermission does. */
function R(key: string, act: Act, handler: (req: Req) => RawResponse) {
  route(key, (req) => (can(req, act) ? handler(req) : denied()));
}

interface Issue {
  path: PropertyKey[];
  message: string;
}
interface Checker<T> {
  safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: Issue[] } };
}

/** The body through the contract's schema: the parsed value, or the 422 the API sends. */
function parse<T>(schema: unknown, body: unknown, then: (data: T) => RawResponse): RawResponse {
  const r = (schema as Checker<T>).safeParse(body);
  if (r.success) return then(r.data);
  const fields: Record<string, string[]> = {};
  for (const i of r.error.issues) {
    const k = i.path.map(String).join(".") || "body";
    fields[k] ??= [i.message];
  }
  return invalid(fields);
}
const field = (name: string, message: string) => invalid({ [name]: [message] });

const nowIso = () => new Date().toISOString();
const DAY = 86400000;
const daysSince = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / DAY)) : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;
const mean = (ns: number[]) => (ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null);
const nameOf = (key: string | null | undefined) => byKey(key)?.display_name ?? null;
const deptName = (id: string) => DEPARTMENTS.find((d) => sid(`dept:${d}`) === id) ?? null;

/* ------------------------------------------------------------------ *
 * Vacancies
 * ------------------------------------------------------------------ */

const VACANCIES = D.VACANCIES;
const vacancy = (id: string | undefined) => VACANCIES.find((v) => v.vacancy_id === id);
const vacancyOfApp = (a: D.MockApplication) => vacancy(sid(`vac:${a.vacancy_key}`))!;
const vref = (v: VacancyDetail) => ({ vacancy_id: v.vacancy_id, number: v.number, title: v.title });
const appsOf = (v: VacancyDetail) => D.APPLICATIONS.filter((a) => vacancyOfApp(a).vacancy_id === v.vacancy_id);
const traitsOf = (v: VacancyDetail) => v.questions.filter((q) => q.active && q.purpose === "interview");
const STAGES = D.M4_STAGES;
const reached = (a: D.MockApplication, stage: string) => STAGES.indexOf(a.stage) >= STAGES.indexOf(stage as (typeof STAGES)[number]);

function vacancyView(v: VacancyDetail, req: Req): VacancyDetail {
  const apps = appsOf(v);
  const live = apps.filter((a) => a.status === "active");
  const closesPast = v.closes_at !== null && Date.parse(v.closes_at) < Date.now();
  return {
    ...v,
    applicants: apps.length,
    in_progress: live.length,
    past_closing: v.status === "open" && closesPast,
    days_open: v.published_at ? daysSince(v.published_at) - (v.closed_at ? daysSince(v.closed_at) : 0) : null,
    by_stage: v.board_stages.map((stage) => ({ stage, count: live.filter((a) => a.stage === stage).length })),
    can_edit: v.status !== "closed" && can(req, "edit"),
  };
}

const VACANCY_KEYS = [
  "vacancy_id", "number", "title", "slug", "status", "close_reason", "department_id", "department", "hiring_manager", "location", "work_pattern",
  "positions", "applicants", "in_progress", "closes_at", "past_closing", "published_at", "days_open", "public_url", "created_at",
] as const;
const vacancyRow = (v: VacancyDetail, req: Req): Vacancy => {
  const full = vacancyView(v, req);
  return Object.fromEntries(VACANCY_KEYS.map((k) => [k, full[k]])) as Vacancy;
};

const slugOf = (title: string) =>
  title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function publish(v: VacancyDetail) {
  v.status = "open";
  v.published_at ??= nowIso();
  v.slug ??= slugOf(`${v.title} ${v.location ? "Lagos" : ""}`);
  v.public_url = `https://go.mycityapp.io/jobs/${v.slug}`;
}

R("GET /api/v1/recruitment/vacancies/summary", "view", () => {
  const live = D.APPLICATIONS.filter((a) => a.status === "active");
  return ok({
    open: VACANCIES.filter((v) => v.status === "open").length,
    applicants: live.length,
    in_interview: live.filter((a) => a.stage === "interview").length,
    past_closing: VACANCIES.filter((v) => v.status === "open" && v.closes_at && Date.parse(v.closes_at) < Date.now()).length,
    careers_url: "https://go.mycityapp.io/jobs",
    funnel: STAGES.map((stage) => ({ stage, count: D.APPLICATIONS.filter((a) => reached(a, stage)).length })),
  });
});

R("GET /api/v1/recruitment/vacancies/suggested", "view", (req) =>
  paged(
    D.SEATS.filter((s) => !VACANCIES.some((v) => v.org_seat_id === s.org_seat_id && v.status !== "closed")),
    req,
  ),
);

R("GET /api/v1/recruitment/vacancies/settings", "view", (req) => ok({ ...D.SETTINGS, can_edit: can(req, "edit") }));
R("PUT /api/v1/recruitment/vacancies/settings", "edit", (req) =>
  parse<{ about_company?: string; default_traits?: string[] }>(vacancySchemas.CareersSettingsSave, req.body, (b) => {
    if (b.about_company !== undefined) D.SETTINGS.about_company = b.about_company || null;
    if (b.default_traits !== undefined) D.SETTINGS.default_traits = b.default_traits;
    D.SETTINGS.updated_at = nowIso();
    return ok({ ...D.SETTINGS, can_edit: true });
  }),
);

R("GET /api/v1/recruitment/vacancies/assist", "edit", () => ok({ available: true, reason: null }));
R("POST /api/v1/recruitment/vacancies/assist", "edit", (req) =>
  parse<{ title: string; instruction: string; min_experience_years?: number }>(vacancySchemas.JdDraftRequest, req.body, (b) =>
    ok({
      available: true,
      reason: null,
      description: `The ${b.title} ${b.instruction.charAt(0).toLowerCase()}${b.instruction.slice(1).replace(/\.?$/, ".")}\n\n## Key Responsibilities\n- Own the work of the role from plan to result, week by week.\n- Report progress to your manager with clear figures.\n- Work closely with the teams around you across MyCityApp.`,
      requirements: `- ${b.min_experience_years ?? 3} years in a similar role.\n- Clear writing and speaking in English.\n- Lives in, or will move to, Lagos.`,
      nice_to_have: "Experience in a consumer app or media business.",
      ai_run_id: sid(`ai:jd:${Date.now()}`),
    }),
  ),
);

R("GET /api/v1/recruitment/vacancies", "view", (req) =>
  paged(
    VACANCIES.map((v) => vacancyRow(v, req)),
    { ...req, query: { sort: "-created_at", ...req.query } },
    {
      search: (v) => [v.title, v.number, v.department, v.location],
      filters: { status: (v, s) => v.status === s, department_id: (v, id) => v.department_id === id },
      sort: {
        closes_at: (a, b) => String(a.closes_at).localeCompare(String(b.closes_at)),
        title: (a, b) => a.title.localeCompare(b.title),
        created_at: (a, b) => a.created_at.localeCompare(b.created_at),
        published_at: (a, b) => String(a.published_at).localeCompare(String(b.published_at)),
      },
    },
  ),
);

R("GET /api/v1/recruitment/vacancies/:id", "view", (req) => {
  const v = vacancy(req.params.id);
  return v ? ok(vacancyView(v, req)) : fail(404, "NOT_FOUND", "That vacancy does not exist");
});

interface VacancyBody {
  title?: string;
  department_id?: string;
  hiring_manager_id?: string;
  org_seat_id?: string | null;
  positions?: number;
  employment_type?: VacancyDetail["employment_type"];
  work_pattern?: NonNullable<VacancyDetail["work_pattern"]>;
  work_pattern_note?: string | null;
  location?: unknown;
  probation_months?: number | null;
  reports_to?: string | null;
  min_experience_years?: number | null;
  salary_min?: string | null;
  salary_max?: string | null;
  salary_visible?: boolean;
  description?: string;
  requirements?: string;
  nice_to_have?: string | null;
  target_start_on?: string | null;
  working_days?: string | null;
  closes_on?: string;
  publish?: boolean;
}

/** Apply a create or an edit to `v`; a 422 when a reference or the address is not one. */
function applyVacancy(v: VacancyDetail, b: VacancyBody): RawResponse | null {
  if (b.department_id !== undefined) {
    const name = deptName(b.department_id);
    if (!name) return field("department_id", "Pick a department");
    v.department_id = b.department_id;
    v.department = name;
  }
  if (b.hiring_manager_id !== undefined) {
    const p = byId(b.hiring_manager_id);
    if (!p) return field("hiring_manager_id", "Pick a person");
    v.hiring_manager = refKey(p.user_key);
  }
  if (b.location !== undefined) {
    const place = placeOf(b.location);
    if (!place) return pickAnAddress("location");
    v.location = place.line;
    v.location_place = place.view;
  }
  if (b.work_pattern === "remote") {
    v.location = null;
    v.location_place = null;
  }
  const plain = [
    "title", "org_seat_id", "positions", "employment_type", "work_pattern", "work_pattern_note", "probation_months", "reports_to", "min_experience_years",
    "salary_min", "salary_max", "salary_visible", "description", "requirements", "nice_to_have", "target_start_on", "working_days",
  ] as const;
  const target = v as unknown as Record<string, unknown>;
  for (const k of plain) if (b[k] !== undefined) target[k === "min_experience_years" ? k : k] = b[k] ?? null;
  if (b.closes_on) v.closes_at = `${b.closes_on}T22:59:59.000Z`;
  return null;
}

R("POST /api/v1/recruitment/vacancies", "create", (req) =>
  parse<VacancyBody>(vacancySchemas.VacancyCreate, req.body, (b) => {
    const n = VACANCIES.length + 1;
    const id = sid(`vac:new:${n}:${Date.now()}`);
    const scorecard = D.defaultScorecard();
    const v: VacancyDetail = {
      ...VACANCIES[0],
      vacancy_id: id,
      number: `VAC-${String(n).padStart(4, "0")}`,
      slug: null,
      status: "draft",
      close_reason: null,
      location: null,
      location_place: null,
      published_at: null,
      public_url: null,
      created_at: nowIso(),
      org_seat_id: null,
      work_pattern_note: null,
      probation_months: null,
      reports_to: null,
      min_experience_years: null,
      salary_min: null,
      salary_max: null,
      salary_visible: false,
      nice_to_have: null,
      target_start_on: null,
      paused_at: null,
      closed_at: null,
      working_days: null,
      screening_conditions: [],
      scorecard,
      board_stages: D.boardStages(scorecard),
      questions: D.SETTINGS.default_traits.map((prompt, i) => ({
        vacancy_question_id: sid(`vq:${id}:trait:${i}`),
        purpose: "interview",
        question_type: "rating",
        prompt,
        options: null,
        required: true,
        display_order: i,
        active: true,
      })),
    };
    const refused = applyVacancy(v, b);
    if (refused) return refused;
    if (b.publish) publish(v);
    VACANCIES.unshift(v);
    return created(vacancyView(v, req));
  }),
);

/** One vacancy that may still change, or the refusal. */
function changeable(req: Req, then: (v: VacancyDetail) => RawResponse): RawResponse {
  const v = vacancy(req.params.id);
  if (!v) return fail(404, "NOT_FOUND", "That vacancy does not exist");
  if (v.status === "closed") return fail(409, "VACANCY_CLOSED", "A closed vacancy cannot be changed");
  return then(v);
}

R("PATCH /api/v1/recruitment/vacancies/:id", "edit", (req) =>
  changeable(req, (v) =>
    parse<VacancyBody>(vacancySchemas.VacancyEdit, req.body, (b) => applyVacancy(v, b) ?? ok(vacancyView(v, req))),
  ),
);
R("POST /api/v1/recruitment/vacancies/:id/publish", "edit", (req) =>
  changeable(req, (v) => {
    if (v.status === "paused") return fail(409, "MOVE_NOT_ALLOWED", "Resume a paused vacancy instead");
    if (v.status !== "draft") return fail(409, "MOVE_NOT_ALLOWED", "This vacancy is already live");
    publish(v);
    return ok(vacancyView(v, req));
  }),
);
R("POST /api/v1/recruitment/vacancies/:id/pause", "edit", (req) =>
  changeable(req, (v) => {
    if (v.status !== "open") return fail(409, "MOVE_NOT_ALLOWED", "Only an open vacancy can be paused");
    v.status = "paused";
    v.paused_at = nowIso();
    return ok(vacancyView(v, req));
  }),
);
R("POST /api/v1/recruitment/vacancies/:id/resume", "edit", (req) =>
  changeable(req, (v) => {
    if (v.status === "draft") return fail(409, "MOVE_NOT_ALLOWED", "Publish a draft instead");
    if (v.status !== "paused") return fail(409, "MOVE_NOT_ALLOWED", "This vacancy is not paused");
    v.status = "open";
    v.paused_at = null;
    return ok(vacancyView(v, req));
  }),
);
R("POST /api/v1/recruitment/vacancies/:id/close", "edit", (req) =>
  changeable(req, (v) =>
    parse<{ close_reason: NonNullable<VacancyDetail["close_reason"]> }>(vacancySchemas.VacancyClose, req.body, (b) => {
      v.status = "closed";
      v.close_reason = b.close_reason;
      v.closed_at = nowIso();
      return ok(vacancyView(v, req));
    }),
  ),
);

interface QuestionBody {
  vacancy_question_id?: string;
  purpose: VacancyQuestion["purpose"];
  question_type: VacancyQuestion["question_type"];
  prompt: string;
  options?: string[];
  required: boolean;
}
R("PUT /api/v1/recruitment/vacancies/:id/questions", "edit", (req) =>
  changeable(req, (v) =>
    parse<{ questions: QuestionBody[] }>(vacancySchemas.VacancyQuestionsSave, req.body, (b) => {
      const order = { application: 0, interview: 0 };
      const kept = b.questions.map(
        (q): VacancyQuestion => ({
          vacancy_question_id: q.vacancy_question_id ?? sid(`vq:${v.vacancy_id}:${q.purpose}:${Date.now()}:${order[q.purpose]}`),
          purpose: q.purpose,
          question_type: q.question_type,
          prompt: q.prompt,
          options: q.options ?? null,
          required: q.required,
          display_order: order[q.purpose]++,
          active: true,
        }),
      );
      /* A trait already rated stays on file, switched off, so a card keeps what it said (guide §6.6). */
      const retired = v.questions.filter((q) => !kept.some((k) => k.vacancy_question_id === q.vacancy_question_id)).map((q) => ({ ...q, active: false }));
      v.questions = [...kept, ...retired.filter((q) => q.purpose === "interview")];
      return ok(vacancyView(v, req));
    }),
  ),
);

R("PUT /api/v1/recruitment/vacancies/:id/scorecard", "edit", (req) =>
  changeable(req, (v) =>
    parse<{ parts: Record<ScorecardWeight["code"], { active: boolean; weight: number }> }>(vacancySchemas.ScorecardSave, req.body, (b) => {
      v.scorecard = v.scorecard.map((p) => ({ ...p, ...b.parts[p.code] }));
      v.board_stages = D.boardStages(v.scorecard);
      return ok(vacancyView(v, req));
    }),
  ),
);

R("POST /api/v1/recruitment/vacancies/:id/assist/questions", "edit", (req) =>
  changeable(req, (v) =>
    ok({
      available: true,
      reason: null,
      questions: [
        { purpose: "application", question_type: "yes_no", prompt: `Have you done the work of a ${v.title} before?`, options: null },
        { purpose: "application", question_type: "text", prompt: "Tell us about one result you are proud of, with its figures", options: null },
        { purpose: "interview", question_type: "rating", prompt: "Planning and Prioritising", options: null },
        { purpose: "interview", question_type: "rating", prompt: "Working With Other Teams", options: null },
      ],
      ai_run_id: sid(`ai:questions:${v.vacancy_id}:${Date.now()}`),
    }),
  ),
);

/* ------------------------------------------------------------------ *
 * Candidates
 * ------------------------------------------------------------------ */

const APPS = D.APPLICATIONS;
const app = (id: string | undefined) => APPS.find((a) => a.application_id === id);
const appNotFound = () => fail(404, "NOT_FOUND", "That candidate does not exist");
const fullName = (a: D.MockApplication) => `${a.first_name} ${a.last_name}`;

const sittingsOf = (a: D.MockApplication) => SITTINGS.filter((s) => s.application_id === a.application_id);
const roundsOf = (a: D.MockApplication) => INTERVIEWS.filter((x) => x.application_id === a.application_id);

/** The five parts as the sheet shows them (guide §6.5). */
function scorecardOf(a: D.MockApplication): ScorecardPart[] {
  const v = vacancyOfApp(a);
  return v.scorecard.map((p) => {
    let score: number | null;
    let provisional = false;
    if (p.code === "screening") {
      score = a.screening ?? a.provisional;
      provisional = a.screening === null;
    } else if (p.code === "interview") {
      const closed = roundsOf(a).filter((x) => x.round_status === "closed" && x.status !== "cancelled");
      const s = mean(closed.map(roundScore).filter((n): n is number => n !== null));
      score = s === null ? null : round1(s);
    } else {
      // The latest scored sitting of the part; a practical brief counts as technical (candidates.repo PART_SCORES).
      const typeOf = (x: D.MockSitting) => {
        const t = assessment(x.assessment_definition_id)?.assessment_type;
        return t === "practical" ? "technical" : t;
      };
      const latest = sittingsOf(a)
        .filter((x) => x.status === "scored" && x.score !== null && typeOf(x) === p.code)
        .sort((x, y) => (x.submitted_days ?? 0) - (y.submitted_days ?? 0))[0];
      score = latest ? round1(latest.score!) : null;
    }
    return { code: p.code, name: p.name, active: p.active, weight: p.weight, score: p.active ? score : null, provisional };
  });
}

/** Over the parts on that have a score, a provisional screening score included (PART_SCORES). */
function weighted(parts: ScorecardPart[]) {
  const scored = parts.filter((p) => p.active && p.score !== null);
  const weight = scored.reduce((n, p) => n + p.weight, 0);
  return {
    weighted_total: weight ? round1(scored.reduce((n, p) => n + p.score! * p.weight, 0) / weight) : null,
    parts_scored: scored.length,
    parts_active: parts.filter((p) => p.active).length,
  };
}

function candidateRow(a: D.MockApplication): CandidatesCandidate {
  const entered = at(a.at_stage_days, "10:00");
  return {
    application_id: a.application_id,
    number: a.number,
    candidate_id: a.candidate_id,
    name: fullName(a),
    email: a.email,
    vacancy: vref(vacancyOfApp(a)),
    stage: a.stage,
    status: a.status,
    source: a.source,
    applied_at: at(a.applied_days, "09:30"),
    current_stage_entered_at: entered,
    days_at_stage: daysSince(entered),
    score: a.screening ?? a.provisional,
    score_provisional: a.screening === null,
    ...weighted(scorecardOf(a)),
    cv_state: a.cv_state,
    next_stages: nextStages(a),
  };
}

/** Where a card may move now: any column ahead, or the one just behind (candidates.pipeline). */
function nextStages(a: D.MockApplication): D.MockApplication["stage"][] {
  if (a.status !== "active" || vacancyOfApp(a).status === "closed") return [];
  const board = vacancyOfApp(a).board_stages as D.MockApplication["stage"][];
  const i = board.indexOf(a.stage);
  return i < 0 ? board.filter((s) => s !== a.stage) : board.filter((_, k) => k > i || k === i - 1);
}

const SAMPLE_ANSWER: Record<string, string> = { yes_no: "yes", text: "At my last role I grew partner revenue by a third in a year, leading a team of six." };

function candidateDetail(a: D.MockApplication, req: Req): CandidateDetail {
  const v = vacancyOfApp(a);
  return {
    ...candidateRow(a),
    first_name: a.first_name,
    last_name: a.last_name,
    phone: a.phone,
    years_experience: a.years,
    cover_letter: a.cover_letter,
    cv:
      a.cv_state === "none"
        ? null
        : { document_id: sid(`cv:${a.application_id}`), file_name: `${a.first_name}-${a.last_name}-CV.pdf`.toLowerCase(), size_bytes: 184_320, mime_type: "application/pdf" },
    answers: v.questions
      .filter((q) => q.purpose === "application" && q.active)
      .map((q) => ({ vacancy_question_id: q.vacancy_question_id, prompt: q.prompt, question_type: q.question_type, answer: a.answers[q.vacancy_question_id] ?? SAMPLE_ANSWER[q.question_type] ?? null })),
    provisional_score: a.provisional,
    screening_score: a.screening,
    screening_summary: a.summary,
    screened_at: a.screening === null ? null : at(Math.max(0, a.applied_days - 1), "11:00"),
    rejection_reason: a.rejection_reason,
    scorecard: scorecardOf(a),
    assessments: sittingsOf(a).map((s) => {
      const d = assessment(s.assessment_definition_id)!;
      return { application_assessment_id: s.application_assessment_id, name: d.name, assessment_type: d.assessment_type, status: s.status, score: s.score, submitted_at: s.submitted_days === null ? null : at(s.submitted_days, "15:00") };
    }),
    interviews: roundsOf(a).map((x) => ({ interview_id: x.interview_id, scheduled_start: x.start, status: x.status, round_status: x.round_status, interview_score: roundScore(x) })),
    history: a.history.map((h, i) => {
      const when = at(h.days, "10:00");
      const next = a.history[i + 1];
      return {
        from_state: i === 0 ? null : a.history[i - 1].to,
        to_state: h.to,
        changed_at: when,
        actor_name: nameOf(h.by),
        reason: h.reason ?? null,
        days: next ? Math.max(0, h.days - next.days) : daysSince(when),
      };
    }),
    next_stages: can(req, "edit") ? nextStages(a) : [],
    can_edit: a.status === "active" && can(req, "edit"),
  };
}

R("GET /api/v1/recruitment/candidates/summary", "view", (req) => {
  const rows = APPS.filter((a) => a.status === "active" && (!req.query.vacancy_id || vacancyOfApp(a).vacancy_id === req.query.vacancy_id));
  const bands: Array<[string, number, number]> = [
    ["Below 40", 0, 40],
    ["40 to 59", 40, 60],
    ["60 to 79", 60, 80],
    ["80 and Above", 80, 101],
  ];
  return ok({
    candidates: rows.length,
    to_screen: rows.filter((a) => a.screening === null && ["application", "screening"].includes(a.stage)).length,
    in_interview: rows.filter((a) => a.stage === "interview").length,
    shortlisted: rows.filter((a) => a.stage === "shortlist").length,
    distribution: bands.map(([label, lo, hi]) => ({ label, count: rows.filter((a) => (a.screening ?? a.provisional) >= lo && (a.screening ?? a.provisional) < hi).length })),
  });
});

R("GET /api/v1/recruitment/candidates", "view", (req) =>
  paged(
    APPS.map(candidateRow),
    { ...req, query: { sort: "-applied_at", ...req.query } },
    {
      search: (c) => [c.name, c.email, c.number, c.vacancy.title],
      filters: { stage: (c, s) => c.stage === s, vacancy_id: (c, id) => c.vacancy.vacancy_id === id, status: (c, s) => c.status === s },
      sort: {
        weighted_total: (a, b) => (a.weighted_total ?? -1) - (b.weighted_total ?? -1),
        score: (a, b) => (a.score ?? -1) - (b.score ?? -1),
        applied_at: (a, b) => a.applied_at.localeCompare(b.applied_at),
        current_stage_entered_at: (a, b) => a.current_stage_entered_at.localeCompare(b.current_stage_entered_at),
      },
    },
  ),
);

/* Candidate Emails: the five, as Markdown, with a version history of one step. */
const EMAIL_DEFAULTS = new Map(D.EMAILS.map((e) => [e.key, { ...e }]));
const email = (key: string) => D.EMAILS.find((e) => e.key === key);
/** An email as the API answers it, with whether the reader may word it (every mock reader with edit reads every role). */
const emailOut = (e: (typeof D.EMAILS)[number], req: Req): CandidateEmail => ({ ...e, can_edit: can(req, "edit") });
R("GET /api/v1/recruitment/candidates/emails", "view", (req) => paged(D.EMAILS.map((e) => emailOut(e, req)), req));
R("GET /api/v1/recruitment/candidates/emails/:key", "view", (req) => {
  const e = email(req.params.key);
  return e ? ok(emailOut(e, req)) : notFound();
});
R("PUT /api/v1/recruitment/candidates/emails/:key", "edit", (req) => {
  const e = email(req.params.key);
  if (!e) return notFound();
  return parse<{ subject: string; body: string }>(candidateSchemas.CandidateEmailSave, req.body, (b) => {
    Object.assign(e, { subject: b.subject, body: b.body, version: e.version + 1, is_default: false, updated_at: nowIso() });
    return ok(emailOut(e, req));
  });
});
R("POST /api/v1/recruitment/candidates/emails/:key/restore", "edit", (req) => {
  const e = email(req.params.key);
  const d = EMAIL_DEFAULTS.get(req.params.key as CandidateEmail["key"]);
  if (!e || !d) return notFound();
  Object.assign(e, { subject: d.subject, body: d.body, version: e.version + 1, is_default: true, updated_at: nowIso() });
  return ok(emailOut(e, req));
});

/** The AI read of a CV, as the mock stands in for it: near the provisional score, with a summary. */
function screen(a: D.MockApplication, conditions: string[]) {
  a.screening = Math.max(0, Math.min(100, a.provisional + ((a.years * 7) % 11) - 5));
  a.summary = `Read the CV against the role's must haves. ${conditions.map((c) => `${c}: met.`).join(" ")}`.trim();
}

R("POST /api/v1/recruitment/candidates/score-all", "edit", (req) =>
  parse<{ vacancy_id: string; screening_conditions?: string[] }>(candidateSchemas.ScoreAll, req.body, (b) => {
    const v = vacancy(b.vacancy_id);
    if (!v) return fail(404, "NOT_FOUND", "That vacancy does not exist");
    if (v.status === "closed") return fail(409, "VACANCY_CLOSED", "This vacancy is closed");
    if (b.screening_conditions) v.screening_conditions = b.screening_conditions;
    const due = appsOf(v).filter((a) => a.status === "active" && a.screening === null && a.cv_state === "clean");
    due.forEach((a) => screen(a, v.screening_conditions));
    return ok({ queued: due.length });
  }),
);

R("POST /api/v1/recruitment/candidates/invitations", "create", (req) =>
  parse<{ first_name: string; last_name: string; email: string; vacancy_id: string }>(candidateSchemas.ApplyInvite, req.body, (b) => {
    const v = vacancy(b.vacancy_id);
    if (!v || v.status !== "open") return field("vacancy_id", "Pick an open vacancy");
    if (appsOf(v).some((a) => a.email.toLowerCase() === b.email.toLowerCase())) return field("email", "They have applied for this role");
    return ok({ email: b.email, expires_at: `${isoDaysAhead(7)}T22:59:59.000Z` });
  }),
);

R("GET /api/v1/recruitment/candidates/:id", "view", (req) => {
  const a = app(req.params.id);
  return a ? ok(candidateDetail(a, req)) : appNotFound();
});

/** A candidate this reader may act on, or the refusal. */
function actOn(req: Req, then: (a: D.MockApplication) => RawResponse): RawResponse {
  const a = app(req.params.id);
  if (!a) return appNotFound();
  if (vacancyOfApp(a).status === "closed") return fail(409, "VACANCY_CLOSED", "This vacancy is closed");
  return then(a);
}

function moveTo(a: D.MockApplication, to: D.MockApplication["stage"], by: string | null, reason?: string) {
  a.stage = to;
  a.at_stage_days = 0;
  a.history.push({ to, days: 0, by: by ?? undefined, reason });
}

R("POST /api/v1/recruitment/candidates/:id/move", "edit", (req) =>
  actOn(req, (a) =>
    parse<{ stage: D.MockApplication["stage"]; reason?: string }>(candidateSchemas.CandidateMove, req.body, (b) => {
      if (a.status !== "active") return fail(409, "MOVE_NOT_ALLOWED", "Reopen this candidate before moving them");
      if (b.stage === a.stage) return fail(409, "MOVE_NOT_ALLOWED", "The candidate is already at this stage");
      if (!vacancyOfApp(a).board_stages.includes(b.stage)) return fail(409, "MOVE_NOT_ALLOWED", "This role does not use that stage");
      if (!nextStages(a).includes(b.stage)) return fail(409, "MOVE_NOT_ALLOWED", "Move one stage back at most");
      moveTo(a, b.stage, req.user, b.reason);
      return ok(candidateDetail(a, req));
    }),
  ),
);

R("POST /api/v1/recruitment/candidates/:id/not-progressed", "edit", (req) =>
  actOn(req, (a) =>
    parse<{ rejection_reason: string }>(candidateSchemas.CandidateNotProgressed, req.body, (b) => {
      if (a.status !== "active") return fail(409, "MOVE_NOT_ALLOWED", "This candidate is not in progress");
      a.status = "not_progressed";
      a.rejection_reason = b.rejection_reason;
      a.history.push({ to: "not_progressed", days: 0, by: req.user ?? undefined, reason: b.rejection_reason });
      /* What was still open for them stops with it: a sitting not finished, an interview not held. */
      sittingsOf(a).filter((s) => s.status === "sent" || s.status === "in_progress").forEach((s) => (s.status = "cancelled"));
      roundsOf(a).filter((x) => x.status === "scheduled").forEach(cancelRound);
      return ok(candidateDetail(a, req));
    }),
  ),
);

R("POST /api/v1/recruitment/candidates/:id/reopen", "edit", (req) =>
  actOn(req, (a) => {
    if (a.status !== "not_progressed") return fail(409, "MOVE_NOT_ALLOWED", "Only a candidate not progressed can be reopened");
    a.status = "active";
    a.rejection_reason = null;
    a.history.push({ to: a.stage, days: 0, by: req.user ?? undefined });
    return ok(candidateDetail(a, req));
  }),
);

R("POST /api/v1/recruitment/candidates/:id/score", "edit", (req) =>
  actOn(req, (a) => {
    if (a.cv_state === "none") return fail(404, "NOT_FOUND", "This candidate sent no CV");
    if (a.cv_state === "checking") return fail(409, "CV_CHECKING", "The CV is still being checked");
    if (a.cv_state === "infected") return fail(409, "CV_INFECTED", "The CV failed the virus check");
    screen(a, vacancyOfApp(a).screening_conditions);
    return ok(candidateDetail(a, req));
  }),
);

/* ------------------------------------------------------------------ *
 * Assessments
 * ------------------------------------------------------------------ */

const ASSESSMENTS = D.ASSESSMENTS;
const assessment = (id: string | undefined) => ASSESSMENTS.find((x) => x.assessment_definition_id === id);
const asmNotFound = () => fail(404, "NOT_FOUND", "That assessment does not exist");
const SITTINGS = D.SITTINGS;

function assessmentView(d: AssessmentDetail): AssessmentDetail {
  const sent = SITTINGS.filter((s) => s.assessment_definition_id === d.assessment_definition_id);
  const scored = sent.filter((s) => s.score !== null).map((s) => s.score!);
  const avg = mean(scored);
  return { ...d, question_count: d.questions.length, sent: sent.length, average_score: avg === null ? d.average_score : round1(avg), in_use: sent.length > 0 };
}
const assessmentRow = (d: AssessmentDetail) => {
  const { instructions, questions, in_use, ...row } = assessmentView(d);
  void [instructions, questions, in_use];
  return row;
};

const toMark = (s: D.MockSitting) => {
  if (!["submitted", "timed_out"].includes(s.status)) return 0;
  const d = assessment(s.assessment_definition_id)!;
  return d.questions.filter((q) => q.question_type !== "choice" && s.answers[q.assessment_question_id]?.awarded_score == null).length;
};

R("GET /api/v1/recruitment/assessments/summary", "view", () => {
  const scored = SITTINGS.filter((s) => s.score !== null).map((s) => s.score!);
  const avg = mean(scored);
  return ok({
    active: ASSESSMENTS.filter((d) => d.active).length,
    sent: SITTINGS.length,
    awaiting_marking: SITTINGS.filter((s) => toMark(s) > 0).length,
    average_score: avg === null ? null : round1(avg),
    by_assessment: ASSESSMENTS.map(assessmentView)
      .filter((d) => d.average_score !== null)
      .map((d) => ({ label: d.name, value: d.average_score! })),
  });
});

R("GET /api/v1/recruitment/assessments", "view", (req) =>
  paged(
    ASSESSMENTS.map(assessmentRow),
    { ...req, query: { sort: "name", ...req.query } },
    {
      search: (d) => [d.name, d.code],
      filters: { assessment_type: (d, t) => d.assessment_type === t, active: (d, v) => String(d.active) === v },
      sort: { name: (a, b) => a.name.localeCompare(b.name), created_at: (a, b) => a.created_at.localeCompare(b.created_at) },
    },
  ),
);

interface AssessmentBody {
  name?: string;
  assessment_type?: AssessmentDetail["assessment_type"];
  duration_minutes?: number | null;
  instructions?: string;
  pass_score?: number | null;
}

function newAssessment(b: AssessmentBody & { name: string; assessment_type: AssessmentDetail["assessment_type"]; instructions: string }): AssessmentDetail {
  const n = ASSESSMENTS.length + 1;
  const d: AssessmentDetail = {
    assessment_definition_id: sid(`asm:new:${n}:${Date.now()}`),
    code: `ASM-${String(n).padStart(4, "0")}`,
    name: b.name,
    assessment_type: b.assessment_type,
    duration_minutes: b.duration_minutes ?? null,
    pass_score: b.pass_score ?? null,
    scoring_method: "auto",
    active: false,
    question_count: 0,
    sent: 0,
    average_score: null,
    created_at: nowIso(),
    instructions: b.instructions,
    questions: [],
    in_use: false,
  };
  ASSESSMENTS.push(d);
  return d;
}

function setQuestions(d: AssessmentDetail, qs: AssessmentQuestionInput[]) {
  const stamp = Date.now();
  d.questions = qs.map((q, i) => {
    const qid = sid(`aq:${d.assessment_definition_id}:${stamp}:${i}`);
    return {
      assessment_question_id: qid,
      question_type: q.question_type,
      prompt: q.prompt,
      options: q.options ? q.options.map((o, k) => ({ id: `${qid}-${k}`, text: o.text, points: o.points })) : null,
      max_score: q.options ? Math.max(...q.options.map((o) => o.points)) : (q.max_score ?? 0),
      display_order: i,
    };
  });
  const choice = d.questions.filter((q) => q.question_type === "choice").length;
  d.scoring_method = choice === d.questions.length ? "auto" : choice === 0 ? "manual" : "mixed";
}

R("POST /api/v1/recruitment/assessments", "create", (req) =>
  parse<Parameters<typeof newAssessment>[0]>(assessmentSchemas.AssessmentCreate, req.body, (b) => created(assessmentView(newAssessment(b)))),
);

R("POST /api/v1/recruitment/assessments/import", "create", (req) =>
  parse<AssessmentExport>(assessmentSchemas.AssessmentExport, req.body, (b) => {
    const d = newAssessment(b);
    setQuestions(d, b.questions);
    return ok(assessmentView(d));
  }),
);

const DRAFTS: Record<AssessmentDetail["assessment_type"], AssessmentQuestionInput[]> = {
  psychometric: [
    { question_type: "choice", prompt: "I plan my week before it starts.", options: ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"].map((text, points) => ({ text, points })) },
    { question_type: "choice", prompt: "I stay calm when a plan changes at short notice.", options: ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"].map((text, points) => ({ text, points })) },
  ],
  technical: [
    { question_type: "choice", prompt: "Which of these is the safest way to store a password?", options: [{ text: "A salted slow hash", points: 2 }, { text: "Plain text", points: 0 }, { text: "Base64", points: 0 }] },
    { question_type: "text", prompt: "Explain how you would find the slowest query in a busy database.", max_score: 10 },
  ],
  case_study: [
    { question_type: "text", prompt: "A partner's sales fell by a third this month. What would you look at first, and why?", max_score: 10 },
    { question_type: "text", prompt: "Write the email you would send them after your first call.", max_score: 10 },
  ],
  practical: [
    { question_type: "file", prompt: "Upload your finished piece.", max_score: 40 },
    { question_type: "text", prompt: "Tell us the choices you made and why.", max_score: 10 },
  ],
};

R("POST /api/v1/recruitment/assessments/assist", "edit", (req) =>
  parse<{ assessment_type: AssessmentDetail["assessment_type"]; count: number }>(assessmentSchemas.AssessmentDraftRequest, req.body, (b) =>
    ok({
      available: true,
      reason: null,
      questions: DRAFTS[b.assessment_type].slice(0, b.count).map((q) => ({ question_type: q.question_type, prompt: q.prompt, options: q.options ?? null, max_score: q.max_score ?? null })),
      ai_run_id: sid(`ai:asm:${Date.now()}`),
    }),
  ),
);

/* Sittings: a candidate's go at an assessment (guide §6.7). */
const sitting = (id: string | undefined) => SITTINGS.find((s) => s.application_assessment_id === id);
const sitNotFound = () => fail(404, "NOT_FOUND", "That sitting does not exist");

function sittingRow(s: D.MockSitting): Sitting {
  const a = app(s.application_id)!;
  const d = assessment(s.assessment_definition_id)!;
  const started = s.started_days === null ? null : at(s.started_days, "10:00");
  const due = started && d.duration_minutes ? new Date(Date.parse(started) + d.duration_minutes * 60000).toISOString() : started && s.due_days ? new Date(Date.parse(started) + s.due_days * DAY).toISOString() : null;
  return {
    due_days: s.due_days,
    application_assessment_id: s.application_assessment_id,
    application_id: s.application_id,
    candidate_name: fullName(a),
    vacancy_title: vacancyOfApp(a).title,
    assessment_definition_id: d.assessment_definition_id,
    assessment_name: d.name,
    assessment_type: d.assessment_type,
    status: s.status,
    start_by: isoDaysAhead(s.start_by_days),
    started_at: started,
    due_at: due,
    submitted_at: s.submitted_days === null ? null : at(s.submitted_days, "15:00"),
    score: s.score,
    to_mark: toMark(s),
  };
}

function sittingDetail(s: D.MockSitting, req: Req): SittingDetail {
  const d = assessment(s.assessment_definition_id)!;
  const finished = ["submitted", "timed_out", "scored"].includes(s.status);
  return {
    ...sittingRow(s),
    answers: finished
      ? d.questions.map((q) => {
          const got = s.answers[q.assessment_question_id];
          return {
            assessment_question_id: q.assessment_question_id,
            question_type: q.question_type,
            prompt: q.prompt,
            options: q.options,
            max_score: q.max_score,
            response: got?.response ?? null,
            document: got?.file ? { document_id: sid(`ans:${s.application_assessment_id}:${q.assessment_question_id}`), file_name: got.file, size_bytes: 2_411_520, mime_type: "application/pdf" } : null,
            awarded_score: got?.awarded_score ?? null,
            reviewer_comment: got?.reviewer_comment ?? null,
            marked_at: got?.marked_at ?? null,
          };
        })
      : [],
    can_mark: finished && can(req, "edit"),
    can_cancel: (s.status === "sent" || s.status === "in_progress") && can(req, "edit"),
  };
}

R("GET /api/v1/recruitment/assessments/sittings", "view", (req) =>
  paged(
    SITTINGS.map(sittingRow),
    { ...req, query: { sort: "-created_at", ...req.query } },
    {
      search: (s) => [s.candidate_name, s.vacancy_title, s.assessment_name],
      filters: { status: (s, v) => s.status === v, application_id: (s, id) => s.application_id === id, marking: (s) => s.to_mark > 0 },
      sort: {
        submitted_at: (a, b) => String(a.submitted_at).localeCompare(String(b.submitted_at)),
        start_by: (a, b) => a.start_by.localeCompare(b.start_by),
        created_at: (a, b) => a.start_by.localeCompare(b.start_by),
      },
    },
  ),
);

function send(a: D.MockApplication, d: AssessmentDetail, startWithin: number, dueDays: number | undefined): D.MockSitting | null {
  if (SITTINGS.some((s) => s.application_id === a.application_id && s.assessment_definition_id === d.assessment_definition_id && s.status !== "cancelled")) return null;
  const s: D.MockSitting = {
    application_assessment_id: sid(`sit:${a.application_id}:${d.assessment_definition_id}:${Date.now()}`),
    application_id: a.application_id,
    assessment_definition_id: d.assessment_definition_id,
    status: "sent",
    sent_days: 0,
    start_by_days: startWithin,
    started_days: null,
    submitted_days: null,
    due_days: d.duration_minutes ? null : (dueDays ?? null),
    score: null,
    answers: {},
  };
  SITTINGS.unshift(s);
  return s;
}

R("POST /api/v1/recruitment/assessments/sittings", "edit", (req) =>
  parse<{ application_id: string; assessment_definition_id: string; start_within_days: number; due_days?: number }>(assessmentSchemas.SittingSend, req.body, (b) => {
    const a = app(b.application_id);
    if (!a || a.status !== "active") return field("application_id", "Pick a candidate");
    if (vacancyOfApp(a).status === "closed") return fail(409, "VACANCY_CLOSED", "This vacancy is closed");
    const d = assessment(b.assessment_definition_id);
    if (!d || !d.active) return field("assessment_definition_id", "Pick an assessment in use");
    const s = send(a, d, b.start_within_days, b.due_days);
    if (!s) return fail(409, "ALREADY_SENT", "This candidate already has this assessment");
    return ok(sittingDetail(s, req));
  }),
);

R("POST /api/v1/recruitment/assessments/sittings/bulk", "edit", (req) =>
  parse<{ vacancy_id: string; assessment_definition_id: string; stage: D.MockApplication["stage"]; start_within_days: number; due_days?: number }>(assessmentSchemas.SittingSendBulk, req.body, (b) => {
    const v = vacancy(b.vacancy_id);
    if (!v) return fail(404, "NOT_FOUND", "That vacancy does not exist");
    const d = assessment(b.assessment_definition_id);
    if (!d || !d.active) return field("assessment_definition_id", "Pick an assessment in use");
    let sent = 0;
    let skipped = 0;
    for (const a of appsOf(v).filter((x) => x.status === "active" && x.stage === b.stage)) {
      if (send(a, d, b.start_within_days, b.due_days)) sent += 1;
      else skipped += 1;
    }
    return ok({ sent, skipped });
  }),
);

R("GET /api/v1/recruitment/assessments/sittings/:id", "view", (req) => {
  const s = sitting(req.params.id);
  return s ? ok(sittingDetail(s, req)) : sitNotFound();
});

R("PUT /api/v1/recruitment/assessments/sittings/:id/marks", "edit", (req) => {
  const s = sitting(req.params.id);
  if (!s) return sitNotFound();
  if (!["submitted", "timed_out", "scored"].includes(s.status)) return fail(409, "NOT_FINISHED", "Mark the answers once the candidate has finished");
  return parse<{ marks: Array<{ assessment_question_id: string; awarded_score: number; reviewer_comment?: string }> }>(assessmentSchemas.SittingMarks, req.body, (b) => {
    const d = assessment(s.assessment_definition_id)!;
    const fields: Record<string, string[]> = {};
    b.marks.forEach((m, i) => {
      const q = d.questions.find((x) => x.assessment_question_id === m.assessment_question_id);
      if (!q || q.question_type === "choice") fields[`marks.${i}.assessment_question_id`] = ["Not a question to mark"];
      else if (m.awarded_score > q.max_score) fields[`marks.${i}.awarded_score`] = [`At most ${q.max_score}`];
    });
    if (Object.keys(fields).length) return fail(422, "VALIDATION_FAILED", "Check the marks", fields);
    for (const m of b.marks) {
      const was = s.answers[m.assessment_question_id] ?? { response: null, awarded_score: null, reviewer_comment: null, marked_at: null };
      s.answers[m.assessment_question_id] = { ...was, awarded_score: m.awarded_score, reviewer_comment: m.reviewer_comment || null, marked_at: nowIso() };
    }
    if (toMark({ ...s, status: "submitted" }) === 0) {
      const max = d.questions.reduce((n, q) => n + q.max_score, 0);
      const got = d.questions.reduce((n, q) => n + (s.answers[q.assessment_question_id]?.awarded_score ?? 0), 0);
      s.score = max ? round1((got * 100) / max) : null;
      s.status = "scored";
    }
    return ok(sittingDetail(s, req));
  });
});

R("POST /api/v1/recruitment/assessments/sittings/:id/cancel", "edit", (req) => {
  const s = sitting(req.params.id);
  if (!s) return sitNotFound();
  if (s.status !== "sent" && s.status !== "in_progress") return fail(409, "MOVE_NOT_ALLOWED", "Only a sitting not yet finished can be cancelled");
  s.status = "cancelled";
  return ok(sittingDetail(s, req));
});

R("GET /api/v1/recruitment/assessments/:id", "view", (req) => {
  const d = assessment(req.params.id);
  return d ? ok(assessmentView(d)) : asmNotFound();
});

R("PATCH /api/v1/recruitment/assessments/:id", "edit", (req) => {
  const d = assessment(req.params.id);
  if (!d) return asmNotFound();
  return parse<AssessmentBody>(assessmentSchemas.AssessmentEdit, req.body, (b) => {
    if (b.duration_minutes !== undefined && assessmentView(d).in_use && b.duration_minutes !== d.duration_minutes)
      return fail(409, "ASSESSMENT_IN_USE", "It has been sent, so its time is fixed. Switch it off and make another");
    for (const [k, v] of Object.entries(b)) if (v !== undefined) (d as unknown as Record<string, unknown>)[k] = v;
    return ok(assessmentView(d));
  });
});

R("PUT /api/v1/recruitment/assessments/:id/questions", "edit", (req) => {
  const d = assessment(req.params.id);
  if (!d) return asmNotFound();
  if (assessmentView(d).in_use) return fail(409, "ASSESSMENT_IN_USE", "It has been sent, so its questions are fixed. Switch it off and make another");
  return parse<{ questions: AssessmentQuestionInput[] }>(assessmentSchemas.AssessmentQuestionsSave, req.body, (b) => {
    setQuestions(d, b.questions);
    return ok(assessmentView(d));
  });
});

R("POST /api/v1/recruitment/assessments/:id/activate", "edit", (req) => {
  const d = assessment(req.params.id);
  if (!d) return asmNotFound();
  if (!d.questions.length) return fail(422, "VALIDATION_FAILED", "Add a question first", { questions: ["Add a question first"] });
  d.active = true;
  return ok(assessmentView(d));
});
R("POST /api/v1/recruitment/assessments/:id/deactivate", "edit", (req) => {
  const d = assessment(req.params.id);
  if (!d) return asmNotFound();
  d.active = false;
  return ok(assessmentView(d));
});

R("GET /api/v1/recruitment/assessments/:id/export", "view", (req) => {
  const d = assessment(req.params.id);
  if (!d) return asmNotFound();
  if (!d.questions.length) return fail(422, "VALIDATION_FAILED", "Add a question first", { questions: ["Add a question first"] });
  return ok({
    format: "mycity-assessment-1",
    name: d.name,
    assessment_type: d.assessment_type,
    duration_minutes: d.duration_minutes,
    instructions: d.instructions ?? "",
    pass_score: d.pass_score,
    questions: d.questions.map((q) =>
      q.question_type === "choice"
        ? { question_type: q.question_type, prompt: q.prompt, options: (q.options ?? []).map((o) => ({ text: o.text, points: o.points })) }
        : { question_type: q.question_type, prompt: q.prompt, max_score: q.max_score },
    ),
  });
});

/* ------------------------------------------------------------------ *
 * Interviews and the blind card (guide §6.6)
 * ------------------------------------------------------------------ */

const INTERVIEWS = D.INTERVIEWS;

/** A card with its ratings keyed by trait id, as the API keeps them. */
interface Card extends Omit<D.MockCard, "ratings"> {
  interview_panelist_id: string;
  ratings: Record<string, number>;
}
const CARDS = new Map<string, Card[]>(
  INTERVIEWS.map((x) => {
    const traits = traitsOf(vacancyOfApp(app(x.application_id)!));
    return [
      x.interview_id,
      x.cards.map((c) => ({
        ...c,
        interview_panelist_id: sid(`seat:${x.interview_id}:${c.employee_key}`),
        ratings: Object.fromEntries(Object.entries(c.ratings).map(([i, n]) => [traits[Number(i)].vacancy_question_id, n])),
      })),
    ];
  }),
);
const cardsOf = (x: D.MockInterview) => CARDS.get(x.interview_id) ?? [];
const interview = (id: string | undefined) => INTERVIEWS.find((x) => x.interview_id === id);
const intNotFound = () => fail(404, "NOT_FOUND", "That interview does not exist");

/** A card's score: the mean of its ratings in use, or its overall rating (1 to 10). */
function cardScore(c: Card, inUse: Set<string>) {
  const values = Object.entries(c.ratings)
    .filter(([id]) => inUse.has(id))
    .map(([, n]) => n);
  return values.length ? mean(values)! : c.overall_rating;
}
const inUseOf = (x: D.MockInterview) => new Set(traitsOf(vacancyOfApp(app(x.application_id)!)).map((t) => t.vacancy_question_id));

/** The round's score as kept when it closed (consolidate.closeIn); null while open or when cancelled. */
const SCORES = new Map<string, number | null>();
function roundScore(x: D.MockInterview): number | null {
  if (x.round_status !== "closed") return null;
  if (!SCORES.has(x.interview_id)) SCORES.set(x.interview_id, scoreNow(x));
  return SCORES.get(x.interview_id)!;
}

/** The mean of the submitted cards × 10, one decimal; each card unrounded (interviews.repo cardScores). */
function scoreNow(x: D.MockInterview): number | null {
  const inUse = inUseOf(x);
  const s = mean(
    cardsOf(x)
      .filter((c) => c.submitted_days !== null)
      .map((c) => cardScore(c, inUse))
      .filter((n): n is number => n !== null),
  );
  return s === null ? null : round1(s * 10);
}

function interviewRow(x: D.MockInterview, req: Req): Interview {
  const a = app(x.application_id)!;
  const mine = cardsOf(x).find((c) => c.employee_key === req.user);
  return {
    interview_id: x.interview_id,
    interview_round_id: x.interview_round_id,
    application_id: x.application_id,
    candidate_name: fullName(a),
    vacancy: vref(vacancyOfApp(a)),
    interview_type: x.interview_type,
    scheduled_start: x.start,
    scheduled_end: x.end,
    status: x.status,
    round_status: x.round_status,
    panel_size: cardsOf(x).length,
    submitted_count: cardsOf(x).filter((c) => c.submitted_days !== null).length,
    on_panel: Boolean(mine),
    my_submitted: Boolean(mine && mine.submitted_days !== null),
  };
}

function interviewDetail(x: D.MockInterview, req: Req): InterviewDetail {
  const a = app(x.application_id)!;
  const v = vacancyOfApp(a);
  const traits = traitsOf(v);
  const inUse = inUseOf(x);
  const closed = x.round_status === "closed";
  const live = x.status === "scheduled" && !closed;
  const edit = can(req, "edit");
  const cards = cardsOf(x);
  const mine = cards.find((c) => c.employee_key === req.user);
  const submitted = cards.filter((c) => c.submitted_days !== null);
  return {
    ...interviewRow(x, req),
    worksite: x.worksite,
    meeting_url: x.meeting_url,
    round: {
      interview_round_id: x.interview_round_id,
      round_number: x.round_number,
      title: x.title,
      status: x.round_status,
      closed_at: x.closed_days === null ? null : at(x.closed_days, "17:00"),
      interview_score: roundScore(x),
      report: x.report?.text ?? null,
      decision: x.report?.decision ?? null,
      reported_by_name: x.report ? nameOf(x.report.by) : null,
      reported_at: x.report ? at(x.report.days, "12:00") : null,
      current_employer: x.details.current_employer,
      academics: x.details.academics,
      total_experience_months: x.details.total,
      relevant_experience_months: x.details.relevant,
      form_document_id: x.form_document_id,
    },
    panel: cards.map((c) => {
      /* BLIND: the reader's own card, or a submitted card once the round is closed. */
      const shown = c.employee_key === req.user || (c.submitted_days !== null && closed);
      return {
        interview_panelist_id: c.interview_panelist_id,
        panelist: refKey(c.employee_key),
        submitted_at: c.submitted_days === null ? null : at(c.submitted_days, "16:30"),
        score: shown ? cardScore(c, inUse) : null,
        overall_rating: shown ? c.overall_rating : null,
        decision: shown ? c.decision : null,
        comments: shown ? c.comments : null,
        ratings: shown ? Object.entries(c.ratings).filter(([id]) => inUse.has(id)).map(([vacancy_question_id, rating]) => ({ vacancy_question_id, rating })) : null,
      };
    }),
    questions: traits.map((t) => ({ vacancy_question_id: t.vacancy_question_id, prompt: t.prompt })),
    trait_averages: closed
      ? traits.map((t) => {
          const got = submitted.map((c) => c.ratings[t.vacancy_question_id]).filter((n): n is number => n !== undefined);
          const avg = mean(got);
          return { vacancy_question_id: t.vacancy_question_id, prompt: t.prompt, average: avg === null ? null : round1(avg) };
        })
      : [],
    cv_document_id: a.cv_state === "none" ? null : sid(`cv:${a.application_id}`),
    my_feedback: mine
      ? {
          overall_rating: mine.overall_rating,
          decision: mine.decision,
          comments: mine.comments,
          private_notes: mine.private_notes,
          ratings: Object.entries(mine.ratings).map(([vacancy_question_id, rating]) => ({ vacancy_question_id, rating })),
          submitted_at: mine.submitted_days === null ? null : at(mine.submitted_days, "16:30"),
        }
      : null,
    can_edit: edit && live,
    can_close: edit && live && Date.parse(x.start) <= Date.now(),
    can_report: closed && x.status !== "cancelled" && (edit || v.hiring_manager?.employee_id === byKey(req.user)?.employee_id),
  };
}

R("GET /api/v1/recruitment/interviews", "view", (req) => {
  const now = Date.now();
  return paged(
    INTERVIEWS.map((x) => interviewRow(x, req)),
    req,
    {
      search: (x) => [x.candidate_name, x.vacancy.title, x.vacancy.number],
      filters: {
        when: (x, w) => (w === "upcoming" ? Date.parse(x.scheduled_end) >= now : Date.parse(x.scheduled_end) < now),
        mine: (x) => x.on_panel,
        application_id: (x, id) => x.application_id === id,
        status: (x, s) => x.status === s,
      },
      sort: { scheduled_start: (a, b) => a.scheduled_start.localeCompare(b.scheduled_start) },
    },
  );
});

R("GET /api/v1/recruitment/interviews/:id", "view", (req) => {
  const x = interview(req.params.id);
  return x ? ok(interviewDetail(x, req)) : intNotFound();
});

interface ScheduleBody {
  application_id?: string;
  title?: string;
  interview_type?: D.MockInterview["interview_type"];
  scheduled_start?: string;
  scheduled_end?: string;
  worksite_id?: string;
  meeting_url?: string;
  panel_employee_ids?: string[];
}

/** Apply a schedule or a reschedule; a 422 on a worksite or a person that is not one. */
function applySchedule(x: D.MockInterview, b: ScheduleBody): RawResponse | null {
  if (b.worksite_id !== undefined) {
    const w = SITES.find((s) => s.worksite_id === b.worksite_id);
    if (!w) return field("worksite_id", "Pick the worksite");
    x.worksite = { worksite_id: w.worksite_id, name: w.name, address: w.address };
  }
  if (b.panel_employee_ids) {
    const people = b.panel_employee_ids.map((id) => byId(id));
    if (people.some((p) => !p)) return field("panel_employee_ids", "Pick people on the staff list");
    const before = cardsOf(x);
    /* A seat taken off the panel loses its draft; a submitted card stays (interviews.repo setPanel). */
    const kept = before.filter((c) => c.submitted_days !== null && !people.some((p) => p!.user_key === c.employee_key));
    if (people.length + kept.length > 8) return field("panel_employee_ids", "At most 8 panelists");
    CARDS.set(
      x.interview_id,
      [...kept, ...people.map(
        (p) =>
          before.find((c) => c.employee_key === p!.user_key) ?? {
            employee_key: p!.user_key,
            interview_panelist_id: sid(`seat:${x.interview_id}:${p!.user_key}`),
            ratings: {},
            overall_rating: null,
            decision: null,
            comments: null,
            private_notes: null,
            submitted_days: null,
          },
      )],
    );
  }
  if (b.title) x.title = b.title;
  if (b.interview_type) x.interview_type = b.interview_type;
  if (b.scheduled_start) x.start = b.scheduled_start;
  if (b.scheduled_end) x.end = b.scheduled_end;
  if (b.meeting_url !== undefined) x.meeting_url = b.meeting_url;
  if (x.interview_type !== "in_person") x.worksite = null;
  if (x.interview_type !== "video") x.meeting_url = null;
  return null;
}

R("POST /api/v1/recruitment/interviews", "edit", (req) =>
  parse<ScheduleBody & { application_id: string }>(interviewSchemas.InterviewSchedule, req.body, (b) => {
    const a = app(b.application_id);
    if (!a) return field("application_id", "Pick a candidate");
    if (a.status !== "active") return field("application_id", "This candidate is not in progress");
    const n = roundsOf(a).length + 1;
    const id = sid(`int:new:${a.application_id}:${n}:${Date.now()}`);
    const x: D.MockInterview = {
      interview_id: id,
      interview_round_id: sid(`round:${id}`),
      application_id: a.application_id,
      round_number: n,
      title: `Interview ${n}`,
      interview_type: "video",
      start: "",
      end: "",
      status: "scheduled",
      round_status: "open",
      closed_days: null,
      meeting_url: null,
      worksite: null,
      details: { current_employer: null, academics: null, total: null, relevant: null },
      report: null,
      form_document_id: null,
      cards: [],
    };
    CARDS.set(id, []);
    const refused = applySchedule(x, b);
    if (refused) return refused;
    INTERVIEWS.unshift(x);
    if (STAGES.indexOf(a.stage) < STAGES.indexOf("interview") && vacancyOfApp(a).board_stages.includes("interview")) moveTo(a, "interview", req.user);
    return created(interviewDetail(x, req));
  }),
);

R("POST /api/v1/recruitment/interviews/assist", "view", (req) =>
  parse<{ text: string }>(interviewSchemas.NotesTidyRequest, req.body, (b) => {
    const text = b.text
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => `- ${s.charAt(0).toUpperCase()}${s.slice(1).replace(/[.!?]?$/, ".")}`)
      .join("\n");
    return ok({ available: true, reason: null, text, ai_run_id: sid(`ai:notes:${Date.now()}`) });
  }),
);

/** A live round this reader may change, or the refusal. */
function liveRound(req: Req, then: (x: D.MockInterview) => RawResponse): RawResponse {
  const x = interview(req.params.id);
  if (!x) return intNotFound();
  if (x.status === "cancelled" || x.round_status === "closed") return fail(409, "INTERVIEW_OVER", "This interview is cancelled or its round is closed");
  return then(x);
}

R("PATCH /api/v1/recruitment/interviews/:id", "edit", (req) =>
  liveRound(req, (x) => parse<ScheduleBody>(interviewSchemas.InterviewReschedule, req.body, (b) => applySchedule(x, b) ?? ok(interviewDetail(x, req)))),
);

R("POST /api/v1/recruitment/interviews/:id/cancel", "edit", (req) =>
  liveRound(req, (x) =>
    parse<{ reason: string }>(interviewSchemas.InterviewCancel, req.body, () => {
      cancelRound(x);
      return ok(interviewDetail(x, req));
    }),
  ),
);

/** The reader's own card on a live round, not yet submitted (interviews.panel mySeat). */
function mySeat(req: Req, then: (x: D.MockInterview, c: Card) => RawResponse): RawResponse {
  const x = interview(req.params.id);
  const c = x && cardsOf(x).find((k) => k.employee_key === req.user);
  if (!x || !c) return intNotFound();
  if (x.status === "cancelled" || x.round_status !== "open") return fail(409, "ROUND_CLOSED", "This round is closed, so its cards are final");
  if (c.submitted_days !== null) return fail(409, "CARD_SUBMITTED", "Your card is submitted and cannot change");
  return then(x, c);
}

/** Cancel an interview: its round closes with no score (schedule.cancelIn). */
function cancelRound(x: D.MockInterview) {
  x.status = "cancelled";
  x.round_status = "closed";
  x.closed_days = 0;
  SCORES.set(x.interview_id, null);
}

/** Close the round and keep its score; the form is made with the report, not here (consolidate.closeIn). */
function closeRound(x: D.MockInterview) {
  x.round_status = "closed";
  x.closed_days = 0;
  x.status = "done";
  SCORES.set(x.interview_id, scoreNow(x));
}

R("PUT /api/v1/recruitment/interviews/:id/feedback", "view", (req) =>
  mySeat(req, (x, c) =>
    parse<{ overall_rating?: number | null; decision?: Card["decision"]; comments?: string; private_notes?: string; ratings?: Array<{ vacancy_question_id: string; rating: number | null }> }>(
      interviewSchemas.FeedbackSave,
      req.body,
      (b) => {
        const inUse = inUseOf(x);
        if (b.ratings) {
          const fields: Record<string, string[]> = {};
          b.ratings.forEach((r, i) => {
            if (!inUse.has(r.vacancy_question_id)) fields[`ratings.${i}.vacancy_question_id`] = ["Not a trait of this role"];
          });
          if (Object.keys(fields).length) return fail(422, "VALIDATION_FAILED", "Check the ratings", fields);
        }
        if (b.overall_rating !== undefined && b.overall_rating !== null && inUse.size) return field("overall_rating", "Rate each trait instead");
        if (b.overall_rating !== undefined) c.overall_rating = b.overall_rating;
        if (b.decision !== undefined) c.decision = b.decision;
        if (b.comments !== undefined) c.comments = b.comments;
        if (b.private_notes !== undefined) c.private_notes = b.private_notes;
        for (const r of b.ratings ?? []) {
          if (r.rating === null) delete c.ratings[r.vacancy_question_id];
          else c.ratings[r.vacancy_question_id] = r.rating;
        }
        return ok(interviewDetail(x, req));
      },
    ),
  ),
);

R("POST /api/v1/recruitment/interviews/:id/feedback/submit", "view", (req) =>
  mySeat(req, (x, c) => {
    const inUse = inUseOf(x);
    const fields: Record<string, string[]> = {};
    if (!c.decision) fields.decision = ["Give your decision"];
    if (inUse.size) {
      const missing = [...inUse].filter((id) => c.ratings[id] === undefined).length;
      if (missing) fields.ratings = [`Rate ${missing === 1 ? "the last trait" : `${missing} more traits`}`];
    } else if (!c.overall_rating) fields.overall_rating = ["Give a rating"];
    if (Object.keys(fields).length) return fail(422, "VALIDATION_FAILED", "Finish your card first", fields);
    c.submitted_days = 0;
    /* The last card closes the round. */
    if (cardsOf(x).every((k) => k.submitted_days !== null)) closeRound(x);
    return ok(interviewDetail(x, req));
  }),
);

R("POST /api/v1/recruitment/interviews/:id/close", "edit", (req) => {
  const x = interview(req.params.id);
  if (!x) return intNotFound();
  if (x.round_status !== "open" || x.status === "cancelled") return fail(409, "ROUND_CLOSED", "This round is already closed");
  if (Date.parse(x.start) > Date.now()) return fail(409, "NOT_STARTED", "Close the round once the interview has started, or cancel it");
  closeRound(x);
  return ok(interviewDetail(x, req));
});

R("PUT /api/v1/recruitment/interviews/:id/details", "edit", (req) => {
  const x = interview(req.params.id);
  if (!x) return intNotFound();
  if (x.status === "cancelled") return fail(409, "INTERVIEW_OVER", "This interview is cancelled");
  return parse<{ current_employer?: string | null; academics?: D.MockInterview["details"]["academics"]; total_experience_months?: number | null; relevant_experience_months?: number | null }>(
    interviewSchemas.RoundDetailsSave,
    req.body,
    (b) => {
      const total = b.total_experience_months !== undefined ? b.total_experience_months : x.details.total;
      const relevant = b.relevant_experience_months !== undefined ? b.relevant_experience_months : x.details.relevant;
      if (total !== null && relevant !== null && relevant > total) return field("relevant_experience_months", "More than the total");
      if (b.current_employer !== undefined) x.details.current_employer = b.current_employer ?? null;
      if (b.academics !== undefined) x.details.academics = b.academics ?? null;
      x.details.total = total;
      x.details.relevant = relevant;
      /* A round with its report has its form made again with the new details. */
      if (x.report) x.form_document_id = sid(`doc:form:${x.interview_id}:${Date.now()}`);
      return ok(interviewDetail(x, req));
    },
  );
});

R("PUT /api/v1/recruitment/interviews/:id/report", "view", (req) => {
  const x = interview(req.params.id);
  if (!x) return intNotFound();
  const manager = vacancyOfApp(app(x.application_id)!).hiring_manager?.employee_id;
  if (!can(req, "edit") && manager !== byKey(req.user)?.employee_id) return fail(403, "PERMISSION_DENIED", "Only the hiring manager or a recruiter can write the report");
  if (x.status === "cancelled") return fail(409, "INTERVIEW_OVER", "This interview is cancelled");
  if (x.round_status !== "closed") return fail(409, "ROUND_OPEN", "Write the report once the round is closed");
  return parse<{ report: string; decision: "select" | "on_hold" | "reject" }>(interviewSchemas.RoundReport, req.body, (b) => {
    x.report = { text: b.report, decision: b.decision, by: req.user!, days: 0 };
    x.form_document_id = sid(`doc:form:${x.interview_id}:${Date.now()}`);
    return ok(interviewDetail(x, req));
  });
});

/* ------------------------------------------------------------------ *
 * The Talent Pool (guide §6.8)
 * ------------------------------------------------------------------ */

const POOL = D.POOL;
const entry = (id: string | undefined) => POOL.find((p) => p.talent_pool_entry_id === id && !p.removed_at);
const poolNotFound = () => fail(404, "NOT_FOUND", "That person is not in the pool");
const livePool = () => POOL.filter((p) => !p.removed_at && Date.parse(p.expires_at) > Date.now());

R("GET /api/v1/recruitment/pool/summary", "view", () => {
  const live = livePool();
  const scores = live.filter((p) => p.score !== null).map((p) => p.score!);
  const avg = mean(scores);
  return ok({
    in_pool: live.length,
    invited_back: live.filter((p) => p.invited_at).length,
    hired_from_pool: POOL.filter((p) => p.hired_from_pool).length,
    average_score: avg === null ? null : Math.round(avg),
  });
});

R("GET /api/v1/recruitment/pool/:id", "view", (req) => {
  const p = entry(req.params.id);
  return p ? ok(p) : poolNotFound();
});

R("GET /api/v1/recruitment/pool", "view", (req) =>
  paged(
    livePool(),
    { ...req, query: { sort: "-created_at", ...req.query } },
    {
      search: (p) => [p.name, p.email, p.reason, p.applied_for?.title],
      filters: { invited: (p, v) => Boolean(p.invited_at) === (v === "true") },
      sort: {
        created_at: (a, b) => a.created_at.localeCompare(b.created_at),
        score: (a, b) => (a.score ?? -1) - (b.score ?? -1),
        expires_at: (a, b) => a.expires_at.localeCompare(b.expires_at),
      },
    },
  ),
);

R("POST /api/v1/recruitment/pool", "edit", (req) =>
  parse<{ application_id: string; reason: string }>(poolSchemas.PoolAdd, req.body, (b) => {
    const a = app(b.application_id);
    if (!a) return field("application_id", "Pick a candidate");
    if (livePool().some((p) => p.candidate_id === a.candidate_id)) return field("application_id", "Already in the pool");
    const p = {
      talent_pool_entry_id: sid(`pool:${a.candidate_id}:${Date.now()}`),
      candidate_id: a.candidate_id,
      name: fullName(a),
      email: a.email,
      application_id: a.application_id,
      applied_for: vref(vacancyOfApp(a)),
      score: candidateRow(a).weighted_total ?? a.screening ?? a.provisional,
      score_provisional: a.screening === null,
      reason: b.reason,
      added_by_name: nameOf(req.user),
      created_at: nowIso(),
      expires_at: `${isoDaysAhead(730)}T12:00:00.000Z`,
      invited_at: null,
      invited_vacancy: null,
      hired_from_pool: false,
      removed_at: null,
    };
    POOL.unshift(p);
    return created(p);
  }),
);

R("POST /api/v1/recruitment/pool/exports", "export", (req) =>
  parse<{ invited?: string; q?: string }>(poolSchemas.PoolExportRequest, req.body, () => exportFile(req.user!, "talent-pool")),
);

R("POST /api/v1/recruitment/pool/:id/invite", "edit", (req) => {
  const p = entry(req.params.id);
  if (!p) return poolNotFound();
  return parse<{ vacancy_id: string }>(poolSchemas.PoolInvite, req.body, (b) => {
    const v = vacancy(b.vacancy_id);
    if (!v || v.status !== "open") return field("vacancy_id", "Pick an open vacancy");
    if (appsOf(v).some((a) => a.candidate_id === p.candidate_id)) return field("vacancy_id", "They have applied for this role");
    p.invited_at = nowIso();
    p.invited_vacancy = vref(v);
    return ok(p);
  });
});

R("POST /api/v1/recruitment/pool/:id/remove", "edit", (req) => {
  const p = entry(req.params.id);
  if (!p) return poolNotFound();
  return parse<{ removed_reason?: string }>(poolSchemas.PoolRemove, req.body, () => {
    p.removed_at = nowIso();
    return ok(p);
  });
});

/* ------------------------------------------------------------------ *
 * M5 (INTERIM, owner AJ): Offers and Onboarding, until M5 puts them on the contract
 * ------------------------------------------------------------------ */

const S = (tone: Status["tone"], text: string): Status => ({ tone, text });

const OFFERS: OfferRow[] = [
  ["OFF-0018", "Kunle Afolabi", "Head, Sales & Revenue", "1200000.00", 2, -5, S("warn", "Awaiting signature")],
  ["OFF-0017", "Dayo Martins", "Content Producer", "460000.00", 30, 15, S("ok", "Signed")],
  ["OFF-0016", "Kemi Bello", "Partnerships Associate", "440000.00", 38, 23, S("err", "Declined")],
].map((o, i) => ({ offer_id: sid(`off:${i}`), number: o[0] as string, candidate: o[1] as string, role: o[2] as string, salary: o[3] as string, issued_on: o[4] == null ? null : isoDaysAgo(o[4] as number), expires_on: o[5] == null ? null : isoDaysAgo(o[5] as number), status: o[6] as Status }));
route("GET /api/v1/recruitment/offers/summary", () => ok({ awaiting_signature: OFFERS.filter((o) => o.status.text === "Awaiting signature").length, signed_this_year: 11, declined: OFFERS.filter((o) => o.status.tone === "err").length, average_days_to_sign: "2.4 days" }));
route("GET /api/v1/recruitment/offers", (req) => paged(OFFERS, req, { search: (o) => [o.candidate, o.role, o.number] }));
route("GET /api/v1/recruitment/offers/:id/letter", (req) => {
  const o = OFFERS.find((x) => x.offer_id === req.params.id);
  if (!o) return notFound();
  const d = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "on sending");
  const first = o.candidate.split(" ")[0];
  const money = `₦${Number(o.salary).toLocaleString("en-NG")}`;
  return ok({
    reference: o.number,
    title: "Offer of Employment",
    date_line: `${o.candidate} · ${o.role} · Issued ${d(o.issued_on)} · Expires ${d(o.expires_on)}`,
    paragraphs: [
      [{ text: "Dear " }, { text: first, filled: true }, { text: "," }],
      [{ text: "We are pleased to offer you the position of " }, { text: o.role, filled: true }, { text: " at MyCity App Ltd, with a start date to be agreed with you." }],
      [{ text: "Your gross monthly salary will be " }, { text: money, filled: true }, { text: ", subject to a probationary period of six months. Working days are Monday to Saturday." }],
      [{ text: "This offer is conditional upon satisfactory documentation, and expires on " }, { text: d(o.expires_on), filled: true }, { text: "." }],
      [{ text: "Yours sincerely," }],
    ],
    signer: "C. Osakunih",
    signer_role: "For MyCity App Ltd",
    fields_note: o.status.text === "Signed" ? "Signed. Payload and stored bytes verified" : `Awaiting signature · go.mycityapp.io/sign/${o.number}`,
  });
});
route("POST /api/v1/recruitment/offers", (req) => {
  const b = req.body as { candidate_id?: string; salary?: string; start_date?: string; expires_on?: string };
  const a = APPS.find((x) => x.candidate_id === b.candidate_id || x.application_id === b.candidate_id);
  const f: Record<string, string[]> = {};
  if (!a) f.candidate_id = ["Pick the candidate"];
  if (!(Number(b.salary) > 0)) f.salary = ["Enter the gross monthly salary"];
  if (!b.start_date) f.start_date = ["Pick the start date"];
  if (!b.expires_on) f.expires_on = ["Pick when the offer expires"];
  if (Object.keys(f).length) return invalid(f);
  const n = Math.max(...OFFERS.map((o) => Number(o.number.slice(4)))) + 1;
  const o: OfferRow = { offer_id: sid(`off:new:${n}`), number: `OFF-${String(n).padStart(4, "0")}`, candidate: fullName(a!), role: vacancyOfApp(a!).title, salary: b.salary!, issued_on: null, expires_on: b.expires_on!, status: S("neutral", "Draft") };
  OFFERS.unshift(o);
  return created(o);
});
route("POST /api/v1/recruitment/offers/:id/send", (req) => {
  const o = OFFERS.find((x) => x.offer_id === req.params.id);
  if (!o) return notFound();
  if (o.status.text !== "Draft") return fail(409, "NOT_DRAFT", "Only a draft offer can be sent.");
  o.issued_on = isoDaysAgo(0);
  o.status = S("warn", "Awaiting signature");
  return ok(o);
});

const DOCS = ["Signed offer letter", "Employment contract", "Valid ID", "Passport photograph", "Bank verification number", "Academic certificates", "Data privacy acknowledgement"];
const ONB: OnboardingDetail[] = [
  ["Kunle Afolabi", "Head, Sales & Revenue", isoDaysAhead(12), 4, S("warn", "Documentation")],
  ["Dayo Martins", "Content Producer", isoDaysAgo(14), 7, S("ok", "Onboarding")],
  ["Samuel Akpan", "Support Officer", isoDaysAgo(185), 7, S("ok", "Confirmed")],
].map((o, i) => {
  const done = o[3] as number;
  return {
    onboarding_id: sid(`onb:${i}`),
    name: o[0] as string,
    role: o[1] as string,
    start_date: o[2] as string,
    documents_done: done,
    documents_total: DOCS.length,
    stage: o[4] as Status,
    checklist: DOCS.map((d, j) => ({ name: d, status: j < done ? S("ok", "Received") : j < 6 ? S("warn", "Requested") : S("err", "Outstanding") })),
    plan: [
      ["Day 0, pre-onboarding", "Account created, device issued, channels joined"],
      ["Day 1", "Welcome, handbook, NDPA acknowledgement, clock in set up"],
      ["Week 1", "Platform walkthrough, meet the six departments"],
      ["Week 2", "First KPIs assigned by the department manager"],
      ["Month 3", "Probation decision: confirm or extend"],
    ].map(([title, text], k) => ({ title, text, done: done === DOCS.length && k < (i === 2 ? 5 : 3) })),
  };
});
route("GET /api/v1/recruitment/onboarding/summary", () =>
  ok({
    in_progress: ONB.filter((o) => o.stage.text !== "Confirmed").length,
    blocked: ONB.filter((o) => o.documents_done < o.documents_total).length,
    starting_this_month: 2,
    confirmed_90d: 3,
    chain: [{ label: "Offer Accepted", state: "done" }, { label: "Documentation", state: "now" }, { label: "Pre-Onboarding", state: null }, { label: "Onboarding", state: null }, { label: "Confirmed", state: null }],
    focus_id: ONB[0].onboarding_id,
  }),
);
route("GET /api/v1/recruitment/onboarding", (req) => paged(ONB.map(({ checklist, plan, ...r }) => (void checklist, void plan, r)), req, { search: (o) => [o.name, o.role] }));
route("GET /api/v1/recruitment/onboarding/:id", (req) => {
  const o = ONB.find((x) => x.onboarding_id === req.params.id);
  return o ? ok(o) : notFound();
});
route("POST /api/v1/recruitment/onboarding/:id/remind", (req) => {
  const o = ONB.find((x) => x.onboarding_id === req.params.id);
  return o ? ok(o) : notFound();
});
