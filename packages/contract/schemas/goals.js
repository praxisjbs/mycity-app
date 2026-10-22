"use strict";
/**
 * Quarters, organisational goals, objectives and key results, monthly reports, quarter plans
 * and target changes (docs/guides/performance.md §4, §5, §6.1 to §6.8).
 *
 *   quarter (performance_period)   Q4 2026, with the scoring rules it carries (scoring.js)
 *   organisational goal             the CEO's year (11 goals), with what each quarter should reach
 *   objective, key result           CO-O1 and CO-KR1.2 for the company; BM-O2, BM-KR2.1 for a function
 *   month                           one report per key result per month; the latest is "now"
 *   plan                            a function's (or the company's) quarter, approved as one
 *   target change                   a binding target changed through the CEO
 *
 * Every link (a line to its key result, a function key result to a company one) is by id; codes
 * are given by the service (G1) and freeze when the plan is binding.
 */
const { z } = require("zod");
const { uuid, text, optionalText, isoDate, isoDateTime, blank, listQuery, Paged } = require("./common");
const { PersonRef } = require("./organisation");
const { ScoreValue, Quantity, Direction, KrBand, Rating, ScoringRules } = require("./scoring");
const { MonthStart, Kpi, KpiMonth, KpiResult } = require("./kpis");
const { KeyResultRef, Scorecard, Contribution, MonthKey, CommitmentState } = require("./targets");

/* ------------------------------------------------------------------ *
 * Quarters
 * ------------------------------------------------------------------ */

const PeriodStatus = z.enum(["planning", "active", "closed"]);

/** A quarter: its dates, its lock date, the first day the system ran it, and its rules. */
const PerformancePeriod = z
  .object({
    performance_period_id: uuid,
    name: z.string(),
    starts_on: isoDate,
    ends_on: isoDate,
    plan_year_starts_on: isoDate,
    targets_lock_on: isoDate.nullable(),
    live_from: isoDate.nullable(),
    status: PeriodStatus,
    rules: ScoringRules,
    months: z.array(MonthStart),
    created_at: isoDateTime,
    updated_at: isoDateTime,
  })
  .strict();

const PeriodPage = Paged(PerformancePeriod);

/** GET /performance/periods */
const PeriodListQuery = listQuery({ status: PeriodStatus.optional() }, ["starts_on"]);

/**
 * POST /performance/periods. A quarter starts on the first day of January, April, July or
 * October; its name ("Q4 2026"), end and plan year follow unless given. Its rules are copied
 * from the last quarter (the code's defaults for the first).
 */
const PeriodCreate = z
  .object({
    starts_on: isoDate.refine((v) => /-(01|04|07|10)-01$/.test(v), "must be the first day of a quarter"),
    name: optionalText(40),
    plan_year_starts_on: blank(isoDate),
    targets_lock_on: blank(isoDate),
    live_from: blank(isoDate),
  })
  .strict();

/** PATCH /performance/periods/:id: the name, the lock date, the first live day, the rules, the status. */
const PeriodEdit = z
  .object({
    name: text(40),
    targets_lock_on: isoDate.nullable(),
    live_from: isoDate.nullable(),
    rules: ScoringRules,
    status: PeriodStatus,
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Change at least one field" });

/* ------------------------------------------------------------------ *
 * Organisational goals
 * ------------------------------------------------------------------ */

const OrganisationalGoalStatus = z.enum(["active", "closed"]);

const OrganisationalGoal = z
  .object({
    organisational_goal_id: uuid,
    code: z.string().nullable(),
    title: z.string(),
    strategic_theme: z.string().nullable(),
    detail: z.string().nullable(),
    success_measure: z.string().nullable(),
    reference_target: z.string().nullable(),
    baseline: z.string().nullable(),
    key_decisions: z.string().nullable(),
    function_cascade: z.string().nullable(),
    plan_year_starts_on: isoDate.nullable(),
    starts_on: isoDate,
    ends_on: isoDate,
    status: OrganisationalGoalStatus,
    owner: PersonRef.nullable(),
    created_at: isoDateTime,
    updated_at: isoDateTime,
  })
  .strict();

const OrganisationalGoalPage = Paged(OrganisationalGoal);

/** GET /performance/goals */
const GoalListQuery = listQuery(
  {
    plan_year: z.coerce.number().int().min(2020).max(2100).optional(),
    status: OrganisationalGoalStatus.optional(),
  },
  ["code", "title", "ends_on"],
);

/** What one quarter of the plan year should reach towards a goal. */
const OrganisationalGoalTarget = z
  .object({
    organisational_goal_target_id: uuid,
    performance_period_id: uuid,
    period_name: z.string(),
    target_text: z.string().nullable(),
    target_value: Quantity.nullable(),
  })
  .strict();

const OrganisationalGoalTargetInput = z
  .object({
    performance_period_id: uuid,
    target_text: optionalText(1000),
    target_value: blank(Quantity),
  })
  .strict();

/** An objective as another record names it. */
const ObjectiveRef = z
  .object({
    okr_objective_id: uuid,
    code: z.string(),
    title: z.string(),
  })
  .strict();

/** GET /performance/goals/:id: its quarterly targets, the company objectives under it, progress. */
const OrganisationalGoalDetail = OrganisationalGoal.extend({
  targets: z.array(OrganisationalGoalTarget),
  objectives: z.array(ObjectiveRef),
  progress: ScoreValue.nullable(),
}).strict();

const GOAL_FIELDS = {
  code: optionalText(20),
  strategic_theme: optionalText(200),
  detail: optionalText(4000),
  success_measure: optionalText(1000),
  reference_target: optionalText(1000),
  baseline: optionalText(1000),
  key_decisions: optionalText(2000),
  function_cascade: optionalText(2000),
};

/** POST /performance/goals: active at once (A16). The plan year runs a calendar year. */
const OrganisationalGoalCreate = z
  .object({
    title: text(300),
    ...GOAL_FIELDS,
    plan_year_starts_on: isoDate.refine((v) => v.endsWith("-01-01"), "must be 1 January"),
    targets: z.array(OrganisationalGoalTargetInput).max(4).default([]),
  })
  .strict();

/** PATCH /performance/goals/:id. `targets` replaces the quarterly targets given. */
const OrganisationalGoalEdit = z
  .object({
    title: text(300),
    code: z.string().trim().max(20).nullable(),
    strategic_theme: z.string().trim().max(200).nullable(),
    detail: z.string().trim().max(4000).nullable(),
    success_measure: z.string().trim().max(1000).nullable(),
    reference_target: z.string().trim().max(1000).nullable(),
    baseline: z.string().trim().max(1000).nullable(),
    key_decisions: z.string().trim().max(2000).nullable(),
    function_cascade: z.string().trim().max(2000).nullable(),
    status: OrganisationalGoalStatus,
    targets: z.array(OrganisationalGoalTargetInput).max(4),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Change at least one field" });

/* ------------------------------------------------------------------ *
 * Objectives and key results
 * ------------------------------------------------------------------ */

const KrType = z.enum([
  "diagnostic_gate",
  "visibility_gate",
  "enabling",
  "compliance_retiring",
  "compliance_floor",
  "outcome",
  "output",
]);
const KrMeasure = z.enum(["numeric", "dated", "yes_no", "multi_part"]);
const KrMonthStatus = z.enum(["not_started", "on_track", "at_risk", "off_track", "done", "missed"]);
const PlanStatus = z.enum(["draft", "submitted", "binding", "returned"]);

/** One part of a multi-part key result, scored on its own; the key result is their mean. */
const KeyResultPart = z
  .object({
    label: text(300),
    measure: z.enum(["numeric", "dated", "yes_no"]),
    target_value: Quantity.nullable().optional(),
    target_text: z.string().trim().max(500).nullable().optional(),
    due_on: isoDate.nullable().optional(),
    actual_value: Quantity.nullable().optional(),
    done_on: isoDate.nullable().optional(),
    partly: z.boolean().optional(),
  })
  .strict();

/** A key result's report for one month. `score` is the confirmed score, else the proposed one. */
const KeyResultMonth = z
  .object({
    okr_key_result_month_id: uuid,
    okr_key_result_id: uuid,
    month: MonthStart,
    status: KrMonthStatus,
    actual_value: Quantity.nullable(),
    actual_text: z.string().nullable(),
    actual_source: z.string().nullable(),
    update_text: z.string().nullable(),
    recovery_employee_id: uuid.nullable(),
    recovery_due_on: isoDate.nullable(),
    proposed_score: ScoreValue.nullable(),
    confirmed_score: ScoreValue.nullable(),
    confirmed_at: isoDateTime.nullable(),
    score: ScoreValue.nullable(),
    band: KrBand.nullable(),
    confirmed: z.boolean(),
  })
  .strict();

/** A key result, with its latest month. */
const KeyResult = z
  .object({
    okr_key_result_id: uuid,
    okr_objective_id: uuid,
    code: z.string(),
    statement: z.string(),
    kr_type: KrType.nullable(),
    measure: KrMeasure,
    direction: Direction,
    unit: z.string().nullable(),
    baseline_text: z.string().nullable(),
    target_value: Quantity.nullable(),
    target_text: z.string().nullable(),
    target_provisional: z.boolean(),
    target_locked_at: isoDateTime.nullable(),
    parts: z.array(KeyResultPart).nullable(),
    starts_on: isoDate.nullable(),
    finishes_on: isoDate.nullable(),
    accountable: PersonRef.nullable(),
    co_accountable: PersonRef.nullable(),
    accountable_note: z.string().nullable(),
    scored_from_key_result_id: uuid.nullable(),
    linked_company_key_results: z.array(KeyResultRef),
    position: z.number().int().min(0),
    latest: KeyResultMonth.nullable(),
  })
  .strict();

/** An objective with its key results, as the OKR tree lists it. */
const Objective = z
  .object({
    okr_objective_id: uuid,
    performance_period_id: uuid,
    performance_plan_id: uuid,
    department_id: uuid.nullable(),
    department: z.string().nullable(),
    code: z.string(),
    title: z.string(),
    organisational_goal_id: uuid.nullable(),
    position: z.number().int().min(0),
    plan_status: PlanStatus,
    score: ScoreValue.nullable(),
    key_results: z.array(KeyResult),
  })
  .strict();

const ObjectivePage = Paged(Objective);

/** GET /performance/okrs. `department_id` "company" lists the company's objectives. */
const OkrListQuery = listQuery(
  {
    period_id: uuid.optional(),
    department_id: z.union([uuid, z.literal("company")]).optional(),
    status: PlanStatus.optional(),
  },
  ["position", "code"],
);

/** GET /performance/okrs/summary: the Goals figures, over the quarter or one function. */
const OkrSummaryQuery = z
  .object({
    period_id: uuid,
    department_id: z.union([uuid, z.literal("company")]).optional(),
  })
  .strict();

const OkrSummary = z
  .object({
    company_score: ScoreValue.nullable(),
    key_results: z.number().int().min(0),
    on_track: z.number().int().min(0),
    in_recovery: z.number().int().min(0),
    awaiting_report: z.number().int().min(0),
  })
  .strict();

/** POST /performance/objectives. No department: a company objective. The code is given (G1). */
const ObjectiveCreate = z
  .object({
    performance_period_id: uuid,
    department_id: blank(uuid),
    title: text(500),
    organisational_goal_id: blank(uuid),
    position: z.number().int().min(0).optional(),
  })
  .strict();

/** PATCH /performance/objectives/:id: a draft or returned plan only. */
const ObjectiveEdit = z
  .object({
    title: text(500),
    organisational_goal_id: uuid.nullable(),
    position: z.number().int().min(0),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Change at least one field" });

const KEY_RESULT_FIELDS = {
  statement: text(1000),
  kr_type: blank(KrType),
  measure: KrMeasure.default("numeric"),
  direction: Direction.default("higher"),
  unit: optionalText(40),
  baseline_text: optionalText(1000),
  target_value: blank(Quantity),
  target_text: optionalText(1000),
  target_provisional: z.boolean().default(false),
  parts: z.array(KeyResultPart).max(10).optional(),
  starts_on: blank(isoDate),
  finishes_on: blank(isoDate),
  accountable_employee_id: blank(uuid),
  co_accountable_employee_id: blank(uuid),
  accountable_note: optionalText(300),
  scored_from_key_result_id: blank(uuid),
  linked_company_key_result_ids: z.array(uuid).max(10).default([]),
  position: z.number().int().min(0).optional(),
};

/** POST /performance/key-results. The code is given (G1). */
const KeyResultCreate = z
  .object({ okr_objective_id: uuid, ...KEY_RESULT_FIELDS })
  .strict()
  .refine((v) => !v.starts_on || !v.finishes_on || v.finishes_on >= v.starts_on, {
    message: "Finishes before it starts",
    path: ["finishes_on"],
  });

/** PATCH /performance/key-results/:id: every field while the plan is a draft; none once binding. */
const KeyResultEdit = z
  .object({
    statement: text(1000),
    kr_type: KrType.nullable(),
    measure: KrMeasure,
    direction: Direction,
    unit: z.string().trim().max(40).nullable(),
    baseline_text: z.string().trim().max(1000).nullable(),
    target_value: Quantity.nullable(),
    target_text: z.string().trim().max(1000).nullable(),
    target_provisional: z.boolean(),
    parts: z.array(KeyResultPart).max(10).nullable(),
    starts_on: isoDate.nullable(),
    finishes_on: isoDate.nullable(),
    accountable_employee_id: uuid.nullable(),
    co_accountable_employee_id: uuid.nullable(),
    accountable_note: z.string().trim().max(300).nullable(),
    scored_from_key_result_id: uuid.nullable(),
    linked_company_key_result_ids: z.array(uuid).max(10),
    position: z.number().int().min(0),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Change at least one field" });

/** A task that carries out a key result (an initiative). */
const Initiative = z
  .object({
    task_id: uuid,
    number: z.string(),
    title: z.string(),
    status: z.string(),
    assignee: PersonRef.nullable(),
    due_at: isoDateTime.nullable(),
    completed_at: isoDateTime.nullable(),
  })
  .strict();

/** One step of what a key result rolls up to. */
const TraceStep = z
  .object({
    kind: z.enum(["key_result", "company_key_result", "objective", "organisational_goal"]),
    id: uuid,
    code: z.string().nullable(),
    title: z.string(),
  })
  .strict();

/** GET /performance/key-results/:id/trace: key result → company key result → objective → goal. */
const Trace = z.object({ steps: z.array(TraceStep) }).strict();

/** The assistant's read of a trace (goals.trace): which key result. */
const TraceQuery = z.object({ okr_key_result_id: uuid }).strict();

/** A target change, as the history beside a target lists it. */
const TargetChangeStatus = z.enum(["pending", "approved", "rejected"]);

const TargetChange = z
  .object({
    target_change_id: uuid,
    okr_key_result_id: uuid.nullable(),
    employee_target_id: uuid.nullable(),
    from_value: Quantity.nullable(),
    from_text: z.string().nullable(),
    to_value: Quantity.nullable(),
    to_text: z.string().nullable(),
    from_month: MonthStart,
    reason: z.string(),
    status: TargetChangeStatus,
    workflow_instance_id: uuid.nullable(),
    requested_by: PersonRef.nullable(),
    decided_at: isoDateTime.nullable(),
    created_at: isoDateTime,
  })
  .strict();

/** GET /performance/key-results/:id */
const KeyResultDetail = KeyResult.extend({
  objective: ObjectiveRef,
  department_id: uuid.nullable(),
  department: z.string().nullable(),
  plan_status: PlanStatus,
  contributing: z.array(KeyResultRef),
  initiatives: z.array(Initiative),
  months: z.array(KeyResultMonth),
  target_history: z.array(TargetChange),
  trace: Trace,
  can_change_target: z.boolean(),
}).strict();

/* ------------------------------------------------------------------ *
 * Report Month and Confirm Score (§6.8)
 * ------------------------------------------------------------------ */

/** One key result's figures in a month's report. */
const KeyResultReport = z
  .object({
    okr_key_result_id: uuid,
    status: KrMonthStatus,
    actual_value: blank(Quantity),
    actual_text: optionalText(1000),
    actual_source: optionalText(500),
    update_text: optionalText(2000),
    recovery_employee_id: blank(uuid),
    recovery_due_on: blank(isoDate),
    proposed_score: blank(ScoreValue),
    parts: z.array(KeyResultPart).max(10).optional(),
  })
  .strict();

/** One KPI's figure in a month's report. */
const KpiReport = z
  .object({
    kpi_definition_id: uuid,
    result: KpiResult,
    actual_value: blank(Quantity),
    actual_text: optionalText(500),
    comment: optionalText(2000),
  })
  .strict();

/** POST /performance/reports: a function's (or the company's) month, in one save. */
const MonthReport = z
  .object({
    month: MonthStart,
    department_id: uuid.nullable(),
    key_results: z.array(KeyResultReport).max(60),
    kpis: z.array(KpiReport).max(60).default([]),
  })
  .strict();

const MonthReportResult = z
  .object({
    month: MonthStart,
    key_results: z.array(KeyResultMonth),
    kpis: z.array(KpiMonth),
  })
  .strict();

/** POST /performance/key-results/:id/confirm */
const ConfirmScore = z
  .object({
    month: MonthStart,
    score: ScoreValue,
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Plans
 * ------------------------------------------------------------------ */

const Plan = z
  .object({
    performance_plan_id: uuid,
    performance_period_id: uuid,
    period_name: z.string(),
    department_id: uuid.nullable(),
    department: z.string().nullable(),
    status: PlanStatus,
    workflow_instance_id: uuid.nullable(),
    submitted_at: isoDateTime.nullable(),
    returned_reason: z.string().nullable(),
    binding_at: isoDateTime.nullable(),
    objective_count: z.number().int().min(0),
    scorecard_count: z.number().int().min(0),
    created_at: isoDateTime,
    updated_at: isoDateTime,
  })
  .strict();

const PlanPage = Paged(Plan);

/** GET /performance/plans */
const PlanListQuery = listQuery(
  {
    period_id: uuid.optional(),
    status: PlanStatus.optional(),
    department_id: z.union([uuid, z.literal("company")]).optional(),
  },
  ["department", "status"],
);

/** Why a plan cannot be sent yet (§6.4). */
const PlanProblem = z
  .object({
    code: z.enum(["PLAN_EMPTY", "WEIGHTS_NOT_100", "CONTRIBUTION_REBALANCE", "LINK_OTHER_QUARTER", "OBJECTIVE_ONE_RESULT"]),
    message: z.string(),
    blocking: z.boolean(),
  })
  .strict();

/** GET /performance/plans/:id: everything the plan binds, and what stops it being sent. */
const PlanDetail = Plan.extend({
  objectives: z.array(Objective),
  kpis: z.array(Kpi),
  scorecards: z.array(Scorecard),
  contributions: z.array(Contribution),
  problems: z.array(PlanProblem),
  can_submit: z.boolean(),
}).strict();

/* ------------------------------------------------------------------ *
 * Target changes (§6.7)
 * ------------------------------------------------------------------ */

/** POST /performance/target-changes: a binding key result's or line's target, from a month. */
const TargetChangeCreate = z
  .object({
    okr_key_result_id: blank(uuid),
    employee_target_id: blank(uuid),
    to_value: blank(Quantity),
    to_text: optionalText(1000),
    from_month: MonthStart,
    reason: text(1000),
  })
  .strict()
  .refine((v) => Boolean(v.okr_key_result_id) !== Boolean(v.employee_target_id), {
    message: "Pick a key result or a line",
    path: ["okr_key_result_id"],
  })
  .refine((v) => v.to_value !== undefined || v.to_text !== undefined, {
    message: "Enter the new target",
    path: ["to_value"],
  });

const TargetChangePage = Paged(TargetChange);

/** GET /performance/target-changes */
const TargetChangeListQuery = listQuery(
  {
    status: TargetChangeStatus.optional(),
    okr_key_result_id: uuid.optional(),
    employee_target_id: uuid.optional(),
  },
  ["created_at"],
);

/* ------------------------------------------------------------------ *
 * Import (§6.19)
 * ------------------------------------------------------------------ */

/** A month's score as a workbook holds it: a number from 0 to 1. */
const WorkbookScore = z.number().min(0).max(1);

/**
 * One key result of MyCity's OKR workbook as the okr_workbook importer reads it: the sheet's
 * function (or Company), its objective, the key result's cells as written, its former IDs from
 * the change map.
 */
const OkrWorkbookRow = z
  .object({
    function: text(120),
    objective_code: text(20),
    objective: text(500),
    code: text(20),
    statement: text(1000),
    kr_type: optionalText(200),
    accountable: optionalText(300),
    linked: optionalText(500),
    baseline: optionalText(1000),
    starts_on: isoDate.optional(),
    finishes_on: isoDate.optional(),
    initiatives: optionalText(6000),
    scored_from: optionalText(20),
    status: optionalText(60),
    actual: optionalText(1000),
    update: optionalText(4000),
    october: WorkbookScore.optional(),
    november: WorkbookScore.optional(),
    december: WorkbookScore.optional(),
    former_codes: optionalText(300),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Analytics (§6.21, PR 5)
 * ------------------------------------------------------------------ */

/** GET /performance/analytics */
const PerformanceAnalyticsQuery = z
  .object({
    period_id: uuid.optional(),
    department_id: uuid.optional(),
    month: MonthKey.optional(),
  })
  .strict();

const FunctionScore = z
  .object({
    department_id: uuid.nullable(),
    department: z.string(),
    score: ScoreValue.nullable(),
    key_results_good: z.number().int().min(0),
    key_results_watch: z.number().int().min(0),
    key_results_recovery: z.number().int().min(0),
    key_results_unscored: z.number().int().min(0),
  })
  .strict();

const RatingCount = z.object({ rating: Rating, count: z.number().int().min(0) }).strict();
const CommitmentCount = z.object({ state: CommitmentState, count: z.number().int().min(0) }).strict();

const PerformanceAnalytics = z
  .object({
    period: z.object({ performance_period_id: uuid, name: z.string() }).strict().nullable(),
    month: MonthStart.nullable(),
    company_score: ScoreValue.nullable(),
    functions: z.array(FunctionScore),
    ratings: z.array(RatingCount),
    reviews_due: z.number().int().min(0),
    reviews_on_time: z.number().int().min(0),
    reviews_closed: z.number().int().min(0),
    commitments: z.array(CommitmentCount),
  })
  .strict();

/** One person in the analytics people table. */
const AnalyticsPerson = z
  .object({
    employee: PersonRef,
    scorecard_id: uuid,
    department: z.string().nullable(),
    score_to_date: ScoreValue.nullable(),
    rating: Rating.nullable(),
    month_score: ScoreValue.nullable(),
    reviews_closed: z.number().int().min(0),
  })
  .strict();

const AnalyticsPersonPage = Paged(AnalyticsPerson);

/** GET /performance/analytics/people */
const AnalyticsPeopleQuery = listQuery(
  {
    period_id: uuid.optional(),
    department_id: uuid.optional(),
    rating: Rating.optional(),
  },
  ["employee", "score_to_date"],
);

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const KR_VIRTUAL = {
  accountable: "the person in okr_key_result.accountable_employee_id",
  co_accountable: "the person in okr_key_result.co_accountable_employee_id",
  linked_company_key_results: "the company key results in okr_key_result_link",
  latest: "the key result's latest okr_key_result_month",
};
const GOAL_VIRTUAL = { owner: "the person in organisational_goal.owner_employee_id" };
const PLAN_VIRTUAL = {
  period_name: "performance_period.name",
  department: "department.name; null for the company plan",
  objective_count: "how many objectives it holds, counted",
  scorecard_count: "how many scorecards of the department's people, counted",
};
const TABLES = {
  OkrWorkbookRow: { table: null, reason: "a key result of the OKR workbook as the importer reads it" },
  PerformancePeriod: {
    table: "performance_period",
    virtual: { months: "the quarter's three months, worked out from starts_on" },
  },
  PeriodPage: { table: null, reason: "a page of quarters" },
  PeriodListQuery: { table: null, reason: "list controls and the status filter" },
  PeriodCreate: { table: "performance_period" },
  PeriodEdit: { table: "performance_period" },
  OrganisationalGoal: { table: "organisational_goal", virtual: GOAL_VIRTUAL },
  OrganisationalGoalPage: { table: null, reason: "a page of organisational goals" },
  GoalListQuery: { table: null, reason: "list controls and filters for the goals" },
  OrganisationalGoalTarget: {
    table: "organisational_goal_target",
    virtual: { period_name: "performance_period.name" },
  },
  OrganisationalGoalTargetInput: { table: "organisational_goal_target" },
  ObjectiveRef: { table: "okr_objective" },
  OrganisationalGoalDetail: {
    table: "organisational_goal",
    virtual: {
      ...GOAL_VIRTUAL,
      targets: "its organisational_goal_target rows",
      objectives: "the company objectives that name it",
      progress: "the mean of those objectives' latest scores",
    },
  },
  OrganisationalGoalCreate: {
    table: "organisational_goal",
    virtual: { targets: "written as organisational_goal_target rows" },
  },
  OrganisationalGoalEdit: {
    table: "organisational_goal",
    virtual: { targets: "replaces the organisational_goal_target rows given" },
  },
  KeyResultPart: { table: null, reason: "one part of okr_key_result.parts (jsonb)" },
  KeyResultMonth: {
    table: "okr_key_result_month",
    virtual: {
      score: "confirmed_score, else proposed_score",
      band: "the band the score sits in (§6.8)",
      confirmed: "confirmed_score is set",
    },
  },
  KeyResult: { table: "okr_key_result", virtual: KR_VIRTUAL },
  Objective: {
    table: "okr_objective",
    virtual: {
      department: "department.name; null for a company objective",
      plan_status: "performance_plan.status",
      score: "the mean of its key results' latest scores (§6.8)",
      key_results: "its okr_key_result rows",
    },
  },
  ObjectivePage: { table: null, reason: "a page of objectives with their key results" },
  OkrListQuery: { table: null, reason: "list controls and filters for the OKR tree" },
  OkrSummaryQuery: { table: null, reason: "which quarter and function the Goals figures count" },
  OkrSummary: { table: null, reason: "the Goals figures, counted over the quarter's key results" },
  ObjectiveCreate: { table: "okr_objective" },
  ObjectiveEdit: { table: "okr_objective" },
  KeyResultCreate: {
    table: "okr_key_result",
    virtual: { linked_company_key_result_ids: "written as okr_key_result_link rows" },
  },
  KeyResultEdit: {
    table: "okr_key_result",
    virtual: { linked_company_key_result_ids: "replaces the okr_key_result_link rows" },
  },
  Initiative: {
    table: "task",
    virtual: { assignee: "the person in task.primary_assignee_id" },
  },
  TraceStep: { table: null, reason: "one record a key result rolls up to" },
  Trace: { table: null, reason: "what a key result rolls up to, in order" },
  TraceQuery: { table: null, reason: "the key result whose trace the assistant reads" },
  TargetChange: {
    table: "target_change",
    virtual: { requested_by: "the employee of target_change.requested_by" },
  },
  KeyResultDetail: {
    table: "okr_key_result",
    virtual: {
      ...KR_VIRTUAL,
      objective: "its okr_objective",
      department_id: "okr_objective.department_id",
      department: "department.name; null for a company key result",
      plan_status: "performance_plan.status",
      contributing: "the function key results that link to it",
      initiatives: "tasks pointing at it",
      months: "its okr_key_result_month rows",
      target_history: "its target_change rows",
      trace: "what it rolls up to",
      can_change_target: "the reader may ask to change its target now (goals.authority)",
    },
  },
  KeyResultReport: {
    table: "okr_key_result_month",
    virtual: { parts: "a multi-part key result's parts, written to okr_key_result.parts" },
  },
  KpiReport: { table: "kpi_month" },
  MonthReport: {
    table: null,
    reason: "a function's month: its key results' and KPIs' figures in one save",
  },
  MonthReportResult: { table: null, reason: "the months a report wrote" },
  ConfirmScore: {
    table: "okr_key_result_month",
    virtual: { score: "written to okr_key_result_month.confirmed_score" },
  },
  Plan: { table: "performance_plan", virtual: PLAN_VIRTUAL },
  PlanPage: { table: null, reason: "a page of quarter plans" },
  PlanListQuery: { table: null, reason: "list controls and filters for the plans" },
  PlanProblem: { table: null, reason: "a reason the plan cannot be sent, worked out" },
  PlanDetail: {
    table: "performance_plan",
    virtual: {
      ...PLAN_VIRTUAL,
      objectives: "its okr_objective rows with their key results",
      kpis: "the department's KPIs that start this quarter",
      scorecards: "the department's people's scorecards this quarter",
      contributions: "its split key results",
      problems: "what stops it being sent",
      can_submit: "the reader may send it now",
    },
  },
  TargetChangeCreate: { table: "target_change" },
  TargetChangePage: { table: null, reason: "a page of target changes" },
  TargetChangeListQuery: { table: null, reason: "list controls and filters for target changes" },
  PerformanceAnalyticsQuery: { table: null, reason: "which quarter, function and month to count" },
  FunctionScore: { table: null, reason: "a function's score and key results by band, worked out" },
  RatingCount: { table: null, reason: "how many scorecards carry a rating, counted" },
  CommitmentCount: { table: null, reason: "how many commitments are in a state, counted" },
  PerformanceAnalytics: { table: null, reason: "aggregates within the reader's scope (§6.21)" },
  AnalyticsPerson: { table: null, reason: "one person's quarter, from scorecard and its reviews" },
  AnalyticsPersonPage: { table: null, reason: "a page of the analytics people table" },
  AnalyticsPeopleQuery: { table: null, reason: "list controls and filters for the people table" },
};

module.exports = {
  TABLES,
  OkrWorkbookRow,
  PeriodStatus,
  PerformancePeriod,
  PeriodPage,
  PeriodListQuery,
  PeriodCreate,
  PeriodEdit,
  OrganisationalGoalStatus,
  OrganisationalGoal,
  OrganisationalGoalPage,
  GoalListQuery,
  OrganisationalGoalTarget,
  OrganisationalGoalTargetInput,
  ObjectiveRef,
  OrganisationalGoalDetail,
  OrganisationalGoalCreate,
  OrganisationalGoalEdit,
  KrType,
  KrMeasure,
  KrMonthStatus,
  PlanStatus,
  KeyResultPart,
  KeyResultMonth,
  KeyResult,
  Objective,
  ObjectivePage,
  OkrListQuery,
  OkrSummaryQuery,
  OkrSummary,
  ObjectiveCreate,
  ObjectiveEdit,
  KeyResultCreate,
  KeyResultEdit,
  Initiative,
  TraceStep,
  Trace,
  TraceQuery,
  TargetChangeStatus,
  TargetChange,
  KeyResultDetail,
  KeyResultReport,
  KpiReport,
  MonthReport,
  MonthReportResult,
  ConfirmScore,
  Plan,
  PlanPage,
  PlanListQuery,
  PlanProblem,
  PlanDetail,
  TargetChangeCreate,
  TargetChangePage,
  TargetChangeListQuery,
  PerformanceAnalyticsQuery,
  FunctionScore,
  RatingCount,
  CommitmentCount,
  PerformanceAnalytics,
  AnalyticsPerson,
  AnalyticsPersonPage,
  AnalyticsPeopleQuery,
};
