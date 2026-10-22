"use strict";
/**
 * Scorecards and commitments (docs/guides/performance.md §4, §5 Scorecards and commitments,
 * §6.5, §6.6, §6.11, §6.13).
 *
 * A scorecard is one person's quarter: three sections (Results, KPIs, Accountability, weighted
 * 60, 25 and 15 by default) whose lines carry weights that fill their section. A line is an
 * `employee_target` row: its goal or KPI (`title`), how it is measured (`measure`), where its
 * monthly figure comes from (`source`), and the key result or KPI it is linked to, by id.
 *
 * The reviewer is the person's effective line manager, resolved when the scorecard is drafted;
 * Operations & People may name another person or a role, with a reason. The dotted manager
 * gives input, never approval.
 *
 * A commitment is a task (`is_commitment`), sent for approval with the person's other
 * commitments for the month (`commitment_set`).
 */
const { z } = require("zod");
const { uuid, text, optionalText, isoDate, isoDateTime, blank, listQuery, Paged } = require("./common");
const { PersonRef } = require("./organisation");
const { Link } = require("./tasks");
const { ScoreValue, Quantity, Direction, Rating } = require("./scoring");
const { MonthStart } = require("./kpis");

const ScorecardStatus = z.enum(["draft", "binding", "agreed", "closed"]);
const Section = z.enum(["results", "kpis", "accountability"]);
const LineMeasure = z.enum(["numeric", "milestone", "standard", "binary"]);
const LineSource = z.enum([
  "own",
  "key_result",
  "team_result",
  "function_kpi",
  "commitments",
  "update_on_time",
  "team_reviews",
  "tasks",
]);

/** A line's weight inside its section: numeric(5,2) as a string ("15", "12.5"). */
const Weight = z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, "must be a weight like 15 or 12.5");

/** A key result as a line or a check names it. */
const KeyResultRef = z
  .object({
    okr_key_result_id: uuid,
    code: z.string(),
    statement: z.string(),
  })
  .strict();

/** A KPI as a line names it. */
const KpiRef = z
  .object({
    kpi_definition_id: uuid,
    code: z.string(),
    name: z.string(),
  })
  .strict();

/** One month of a line: its score, blank when there were no eligible cases. */
const LineMonth = z
  .object({
    month: MonthStart,
    score: ScoreValue.nullable(),
  })
  .strict();

/** A scorecard line, as the scorecard shows it. */
const ScorecardLine = z
  .object({
    employee_target_id: uuid,
    scorecard_id: uuid,
    section: Section,
    position: z.number().int().min(0),
    title: z.string(),
    measure: LineMeasure,
    direction: Direction,
    unit: z.string().nullable(),
    target_value: Quantity.nullable(),
    target_text: z.string().nullable(),
    milestone_due_on: isoDate.nullable(),
    due_on: isoDate.nullable(),
    frequency_text: z.string().nullable(),
    weight: Weight,
    source: LineSource,
    okr_key_result_id: uuid.nullable(),
    key_result: KeyResultRef.nullable(),
    kpi_definition_id: uuid.nullable(),
    kpi: KpiRef.nullable(),
    team_key_results: z.array(KeyResultRef),
    share_value: Quantity.nullable(),
    months: z.array(LineMonth),
    score: ScoreValue.nullable(),
  })
  .strict();

/** A scorecard in a list: whose, who reviews it, where it stands. */
const Scorecard = z
  .object({
    scorecard_id: uuid,
    performance_period_id: uuid,
    period_name: z.string(),
    employee: PersonRef,
    department_id: uuid.nullable(),
    department: z.string().nullable(),
    status: ScorecardStatus,
    reviewer: PersonRef.nullable(),
    reviewer_role_code: z.string().nullable(),
    reviewer_role: z.string().nullable(),
    dotted: PersonRef.nullable(),
    employee_agreed_at: isoDateTime.nullable(),
    reviewer_agreed_at: isoDateTime.nullable(),
    disagreed_at: isoDateTime.nullable(),
    score_to_date: ScoreValue.nullable(),
    rating: Rating.nullable(),
    line_count: z.number().int().min(0),
    created_at: isoDateTime,
    updated_at: isoDateTime,
  })
  .strict();

const ScorecardPage = Paged(Scorecard);

/** GET /performance/scorecards */
const ScorecardListQuery = listQuery(
  {
    period_id: uuid.optional(),
    department_id: uuid.optional(),
    status: ScorecardStatus.optional(),
    reviewer_id: uuid.optional(),
    rating: Rating.optional(),
  },
  ["employee", "score_to_date"],
);

/** A section whose lines do not fill its weight. */
const WeightProblem = z
  .object({
    section: Section,
    total: z.number(),
    expected: z.number(),
  })
  .strict();

/** A split key result's shares against its target: OK or Rebalance (their Contribution Map). */
const ContributionShare = z
  .object({
    employee_target_id: uuid,
    scorecard_id: uuid,
    employee: PersonRef,
    share_value: Quantity,
  })
  .strict();

const ContributionStatus = z.enum(["ok", "rebalance"]);

const Contribution = z
  .object({
    okr_key_result_id: uuid,
    code: z.string(),
    statement: z.string(),
    target_value: Quantity.nullable(),
    unit: z.string().nullable(),
    shares: z.array(ContributionShare),
    total: Quantity,
    difference: Quantity,
    status: ContributionStatus,
  })
  .strict();

const ContributionPage = Paged(Contribution);

/** GET /performance/contributions: a plan's split key results, or one key result's. */
const ContributionQuery = listQuery({ plan_id: uuid.optional(), key_result_id: uuid.optional() }, ["code"]);

/** GET /performance/scorecards/:id */
const ScorecardDetail = Scorecard.extend({
  scope_text: z.string().nullable(),
  reviewer_reason: z.string().nullable(),
  disagree_reason: z.string().nullable(),
  results_weight: z.number().int(),
  kpis_weight: z.number().int(),
  accountability_weight: z.number().int(),
  lines: z.array(ScorecardLine),
  weight_problems: z.array(WeightProblem),
  contributions: z.array(Contribution),
  can_edit: z.boolean(),
  can_agree: z.boolean(),
}).strict();

/** Where a new scorecard's lines come from: the person's last quarter, a colleague's scorecard, or none. */
const CopyFrom = z.union([z.enum(["last_quarter", "none"]), uuid]);

/** POST /performance/scorecards: a manager drafts one for a person in their scope, never their own. */
const ScorecardCreate = z
  .object({
    employee_id: uuid,
    performance_period_id: uuid,
    copy_from: CopyFrom.default("none"),
  })
  .strict();

/** One line as the scorecard form saves it; no id: a new line. */
const ScorecardLineInput = z
  .object({
    employee_target_id: blank(uuid),
    section: Section,
    title: text(300),
    measure: LineMeasure,
    direction: Direction.default("higher"),
    unit: optionalText(40),
    target_value: blank(Quantity),
    target_text: optionalText(500),
    milestone_due_on: blank(isoDate),
    due_on: blank(isoDate),
    frequency_text: optionalText(100),
    weight: Weight,
    source: LineSource.default("own"),
    okr_key_result_id: blank(uuid),
    kpi_definition_id: blank(uuid),
    team_key_result_ids: z.array(uuid).max(20).default([]),
    share_value: blank(Quantity),
  })
  .strict();

/** PUT /performance/scorecards/:id/lines: every line, in order; a line left out is removed. */
const ScorecardLinesSave = z.object({ lines: z.array(ScorecardLineInput).max(40) }).strict();

/**
 * PATCH /performance/scorecards/:id. The reviewer, as a person or a role, needs a reason and
 * `performance.manage`.
 */
const ScorecardEdit = z
  .object({
    scope_text: z.string().trim().max(2000).nullable(),
    reviewer_employee_id: uuid.nullable(),
    reviewer_role_code: z.string().trim().min(1).max(60).nullable(),
    reviewer_reason: text(500),
    dotted_employee_id: uuid.nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Change at least one field" })
  .refine((v) => !(v.reviewer_employee_id && v.reviewer_role_code), {
    message: "A person or a role, not both",
    path: ["reviewer_role_code"],
  })
  .refine((v) => !("reviewer_employee_id" in v || "reviewer_role_code" in v) || Boolean(v.reviewer_reason), {
    message: "Give a reason",
    path: ["reviewer_reason"],
  });

/** POST /performance/scorecards/:id/disagree */
const DisagreeBody = z.object({ disagree_reason: text(1000) }).strict();

/* ------------------------------------------------------------------ *
 * Commitments (PR 4)
 * ------------------------------------------------------------------ */

const CommitmentState = z.enum(["awaiting_approval", "due", "on_time", "late", "missed", "rescoped"]);
const CommitmentSetStatus = z.enum(["draft", "submitted", "approved", "returned"]);

/** A month as the commitments routes name it: "2026-11". */
const MonthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "must be a month as YYYY-MM");

/** One commitment: a task, with its acceptance criteria, its original date and its state. */
const Commitment = z
  .object({
    task_id: uuid,
    number: z.string(),
    title: z.string(),
    acceptance_criteria: z.string().nullable(),
    employee: PersonRef.nullable(),
    commitment_month: MonthStart,
    due_at: isoDateTime.nullable(),
    original_due_at: isoDateTime.nullable(),
    completed_at: isoDateTime.nullable(),
    rescoped_at: isoDateTime.nullable(),
    commitment_set_id: uuid.nullable(),
    set_status: CommitmentSetStatus.nullable(),
    state: CommitmentState,
    employee_target_id: uuid.nullable(),
    link: Link.nullable(),
  })
  .strict();

const CommitmentPage = Paged(Commitment);

/** GET /performance/commitments */
const CommitmentListQuery = listQuery(
  {
    month: MonthKey.optional(),
    department_id: uuid.optional(),
    employee_id: uuid.optional(),
    state: CommitmentState.optional(),
    waiting_on_me: z.enum(["true", "false"]).optional(),
  },
  ["due_at", "employee"],
);

/** One person's commitments for a month, approved as one. */
const CommitmentSet = z
  .object({
    commitment_set_id: uuid,
    employee_id: uuid,
    month: MonthStart,
    status: CommitmentSetStatus,
    workflow_instance_id: uuid.nullable(),
    submitted_at: isoDateTime.nullable(),
    approved_at: isoDateTime.nullable(),
    task_count: z.number().int().min(0),
  })
  .strict();

/** POST /performance/commitments/sets/:employee_id/:month/submit */
const CommitmentSetParams = z.object({ employee_id: uuid, month: MonthKey }).strict();

/** POST /performance/commitments/report: the month-end delivery report, as an export. */
const CommitmentReportRequest = z
  .object({
    month: MonthKey,
    department_id: blank(uuid),
  })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const LINE_VIRTUAL = {
  key_result: "the okr_key_result in employee_target.okr_key_result_id",
  kpi: "the kpi_definition in employee_target.kpi_definition_id",
  team_key_results: "the key results in employee_target_key_result",
  months: "the line's monthly scores, from the reviews' items",
  score: "the line's score so far (§6.9): its latest month, or the mean of its months",
};
const SCORECARD_VIRTUAL = {
  period_name: "performance_period.name",
  employee: "the person in scorecard.employee_id",
  department: "department.name",
  reviewer: "the person in scorecard.reviewer_employee_id",
  reviewer_role: "the name of the role in scorecard.reviewer_role_code",
  dotted: "the person in scorecard.dotted_employee_id",
  line_count: "how many lines it has, counted",
};
const TABLES = {
  KeyResultRef: { table: "okr_key_result" },
  KpiRef: { table: "kpi_definition" },
  LineMonth: { table: null, reason: "one month of a line's score, from performance_review_item" },
  ScorecardLine: { table: "employee_target", virtual: LINE_VIRTUAL },
  Scorecard: { table: "scorecard", virtual: SCORECARD_VIRTUAL },
  ScorecardPage: { table: null, reason: "a page of scorecards" },
  ScorecardListQuery: { table: null, reason: "list controls and filters for the scorecards" },
  WeightProblem: { table: null, reason: "a section whose lines do not fill its weight, worked out" },
  ContributionShare: {
    table: "employee_target",
    virtual: { employee: "the person in employee_target.employee_id" },
  },
  Contribution: {
    table: "okr_key_result",
    virtual: {
      shares: "the employee_target rows that split it",
      total: "the shares added up",
      difference: "the target less the total",
      status: "ok when the shares add up exactly to the target, else rebalance",
    },
  },
  ContributionPage: { table: null, reason: "a page of split key results" },
  ContributionQuery: { table: null, reason: "list controls: a plan or a key result" },
  ScorecardDetail: {
    table: "scorecard",
    virtual: {
      ...SCORECARD_VIRTUAL,
      lines: "the scorecard's employee_target rows",
      weight_problems: "sections whose lines do not fill their weight",
      contributions: "the split key results its lines share",
      can_edit: "the reader may change its lines now",
      can_agree: "the reader is its employee or reviewer and has not agreed",
    },
  },
  ScorecardCreate: {
    table: "scorecard",
    virtual: { copy_from: "where the first lines are copied from; not stored" },
  },
  ScorecardLineInput: {
    table: "employee_target",
    virtual: { team_key_result_ids: "written as employee_target_key_result rows" },
  },
  ScorecardLinesSave: { table: null, reason: "every line of a scorecard, in order", nested: {} },
  ScorecardEdit: { table: "scorecard" },
  DisagreeBody: { table: "scorecard" },
  Commitment: {
    table: "task",
    virtual: {
      employee: "the person in task.primary_assignee_id",
      set_status: "commitment_set.status",
      state: "worked out (§6.11) from the set, the dates and completion",
      link: "linkFor(\"task\", task_id)",
    },
  },
  CommitmentPage: { table: null, reason: "a page of commitments" },
  CommitmentListQuery: { table: null, reason: "list controls and filters for the commitments" },
  CommitmentSet: {
    table: "commitment_set",
    virtual: { task_count: "how many commitments it holds, counted" },
  },
  CommitmentSetParams: { table: null, reason: "the person and the month in the path" },
  CommitmentReportRequest: { table: null, reason: "which month and function the report covers" },
};

module.exports = {
  TABLES,
  ScorecardStatus,
  Section,
  LineMeasure,
  LineSource,
  Weight,
  KeyResultRef,
  KpiRef,
  LineMonth,
  ScorecardLine,
  Scorecard,
  ScorecardPage,
  ScorecardListQuery,
  WeightProblem,
  ContributionShare,
  ContributionStatus,
  Contribution,
  ContributionPage,
  ContributionQuery,
  ScorecardDetail,
  CopyFrom,
  ScorecardCreate,
  ScorecardLineInput,
  ScorecardLinesSave,
  ScorecardEdit,
  DisagreeBody,
  CommitmentState,
  CommitmentSetStatus,
  MonthKey,
  Commitment,
  CommitmentPage,
  CommitmentListQuery,
  CommitmentSet,
  CommitmentSetParams,
  CommitmentReportRequest,
};
