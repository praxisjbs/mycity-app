"use strict";
/**
 * Goals: the cascade from the CEO's organisational goals down to a department's monthly
 * targets (A16; docs/guides/performance.md §3 to §6). Individual KPIs are in kpis.js,
 * review cycles in reviews.js.
 *
 * Levels, top down:
 *   organisation   set by the CEO alone, active when saved, with a quarterly cascade
 *   annual         under an organisational goal, set by Management
 *   monthly        under an annual goal, set by Management
 *   department     a department's target for a month, under a monthly goal (targets.js)
 *
 * Statuses:
 *   draft, returned          editable; returned carries the reason in its approval trail
 *   pending_approval         in `performance.goal`: Management, Operations & People, the CEO
 *   active                   the CEO approved it (or the CEO set it, at organisation level)
 *   completed, cancelled     closed
 *
 * Nothing below the CEO's approval counts on Home, My Performance or Analytics.
 */
const { z } = require("zod");
const { uuid, text, optionalText, isoDate, isoDateTime, blank, listQuery, Paged } = require("./common");
const { PersonRef } = require("./organisation");
const { RouteStage, ApprovalDecision } = require("./workflow");

const GoalLevel = z.enum(["organisation", "annual", "monthly", "department"]);
const GoalStatus = z.enum(["draft", "pending_approval", "active", "returned", "completed", "cancelled"]);
/** How a goal, target or KPI is doing against the share of its period gone (§6). */
const ProgressStatus = z.enum(["on_track", "at_risk", "behind", "met"]);
/** "YYYY-MM": a month as the wire carries it. Stored as its first day. */
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM");

/** A goal one line long, as Rolls Up To, Children and a trace name it. */
const GoalRef = z
  .object({
    organisational_goal_id: uuid,
    code: z.string().nullable(),
    level: GoalLevel,
    title: z.string(),
    status: GoalStatus,
  })
  .strict();

/** What an organisational or annual goal should reach in a quarter. */
const GoalQuarter = z
  .object({
    quarter: z.number().int().min(1).max(4),
    milestone: z.string(),
  })
  .strict();

/** A goal's progress: the weighted mean of its children's, 0 to 1, null before anything counts. */
const Progress = z
  .object({
    attainment: z.number().min(0).max(1).nullable(),
    progress_status: ProgressStatus.nullable(),
  })
  .strict();

/** One goal, as the lists show it. */
const Goal = z
  .object({
    organisational_goal_id: uuid,
    code: z.string().nullable(),
    level: GoalLevel,
    title: z.string(),
    strategic_theme: z.string().nullable(),
    success_measure: z.string().nullable(),
    baseline: z.string().nullable(),
    description: z.string().nullable(),
    status: GoalStatus,
    starts_on: isoDate,
    ends_on: isoDate,
    department: z.string().nullable(),
    department_id: uuid.nullable(),
    owner: PersonRef,
    rolls_up_to: GoalRef.nullable(),
    progress: Progress,
    workflow_instance_id: uuid.nullable(),
    created_at: isoDateTime,
    updated_at: isoDateTime,
  })
  .strict();

/** GET /performance/goals/:id: the goal, its cascade, trace, children and approval. */
const GoalDetail = Goal.extend({
  quarters: z.array(GoalQuarter),
  /** From the goal's parent up to its organisational goal. */
  trace: z.array(GoalRef),
  children: z.array(GoalRef),
  route: z.array(RouteStage),
  decisions: z.array(ApprovalDecision),
  can_edit: z.boolean(),
  can_submit: z.boolean(),
  can_decide: z.boolean(),
}).strict();

const GoalPage = Paged(Goal);

/** GET /performance/goals */
const GoalListQuery = listQuery(
  {
    level: GoalLevel.optional(),
    status: GoalStatus.optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    month: Month.optional(),
    parent_goal_id: uuid.optional(),
  },
  ["code", "ends_on", "title"],
);

/** One link of the cascade chain at the top of Goals. */
const CascadeStep = z
  .object({
    level: z.enum(["organisation", "annual", "monthly", "department", "individual"]),
    active: z.number().int().min(0),
    pending: z.number().int().min(0),
  })
  .strict();

/** Goal Progress: one bar per organisational goal. */
const GoalProgressRow = z
  .object({
    organisational_goal_id: uuid,
    code: z.string().nullable(),
    title: z.string(),
    attainment: z.number().min(0).max(1).nullable(),
    progress_status: ProgressStatus.nullable(),
  })
  .strict();

/** GET /performance/goals/summary */
const GoalsSummaryQuery = z
  .object({ year: z.coerce.number().int().min(2000).max(2100).optional() })
  .strict();
const GoalsSummary = z
  .object({
    year: z.number().int(),
    cascade: z.array(CascadeStep),
    on_track: z.number().int().min(0),
    progress: z.array(GoalProgressRow),
  })
  .strict();

/**
 * POST /performance/goals: an organisational, annual or monthly goal. A departmental target
 * is POST /performance/targets. Organisational goals take the year, the quarters and no parent;
 * annual goals the year and their organisational goal; monthly goals the month and their annual
 * goal. The period is worked out from the year or the month.
 */
const GoalCreate = z
  .object({
    level: z.enum(["organisation", "annual", "monthly"]),
    title: text(200),
    strategic_theme: optionalText(200),
    success_measure: optionalText(500),
    baseline: optionalText(500),
    description: optionalText(2000),
    year: z.number().int().min(2000).max(2100).optional(),
    month: blank(Month),
    parent_goal_id: blank(uuid),
    quarters: z.array(GoalQuarter).max(4).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const need = (path, message) => ctx.addIssue({ code: "custom", path: [path], message });
    if (v.level === "monthly" && !v.month) need("month", "Pick the month");
    if (v.level !== "monthly" && !v.year) need("year", "Pick the year");
    if (v.level === "organisation" && v.parent_goal_id) need("parent_goal_id", "Has no parent");
    if (v.level !== "organisation" && !v.parent_goal_id) need("parent_goal_id", "Pick the parent goal");
    if (v.level !== "organisation" && v.quarters && v.quarters.length) need("quarters", "Organisational goals only");
    if (v.quarters && new Set(v.quarters.map((x) => x.quarter)).size !== v.quarters.length)
      need("quarters", "One per quarter");
  });

/** PATCH /performance/goals/:id: draft or returned only. `null` clears an optional field. */
const GoalEdit = z
  .object({
    title: text(200).optional(),
    strategic_theme: z.string().trim().max(200).nullable().optional(),
    success_measure: z.string().trim().max(500).nullable().optional(),
    baseline: z.string().trim().max(500).nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    parent_goal_id: uuid.optional(),
    quarters: z.array(GoalQuarter).max(4).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Change at least one field");

/**
 * POST …/decide on a goal, a department's month or a review: the stage's approver approves,
 * or returns it to draft with the reason.
 */
const DecideBody = z
  .object({
    decision: z.enum(["approve", "return"]),
    reason: optionalText(1000),
  })
  .strict()
  .refine((v) => v.decision !== "return" || !!v.reason, { message: "Say why", path: ["reason"] });

/** Gate 6 (check/contract-columns.js): which table each schema's keys are the columns of. */
const GOAL_VIRTUAL = {
  department: "department.name of organisational_goal.department_id",
  owner: "the person in organisational_goal.owner_employee_id",
  rolls_up_to: "the goal in organisational_goal.parent_goal_id",
  progress: "worked out from the goal's children (§6 Roll-up), never stored",
};
const TABLES = {
  GoalRef: { table: "organisational_goal" },
  GoalQuarter: { table: "organisational_goal_quarter" },
  Progress: { table: null, reason: "attainment worked out from children, never stored" },
  Goal: { table: "organisational_goal", virtual: GOAL_VIRTUAL },
  GoalDetail: {
    table: "organisational_goal",
    virtual: {
      ...GOAL_VIRTUAL,
      quarters: "organisational_goal_quarter rows of the goal",
      trace: "the goal's ancestors through parent_goal_id",
      children: "goals whose parent_goal_id is this goal",
      route: "the stages of the goal's workflow_instance",
      decisions: "workflow_decision rows of the goal's workflow_instance",
      can_edit: "draft or returned, and the caller holds the level's capability",
      can_submit: "as can_edit, at the annual or monthly level",
      can_decide: "the goal waits at a stage the caller may decide",
    },
  },
  GoalPage: { table: null, reason: "a page of goals" },
  GoalListQuery: { table: null, reason: "list controls and filters for goals" },
  CascadeStep: { table: null, reason: "counts of goals and KPIs by level" },
  GoalProgressRow: {
    table: "organisational_goal",
    virtual: {
      attainment: "worked out from the goal's children (§6 Roll-up)",
      progress_status: "worked out from attainment and the share of the year gone",
    },
  },
  GoalsSummaryQuery: { table: null, reason: "which year" },
  GoalsSummary: { table: null, reason: "counts and progress over organisational_goal" },
  GoalCreate: {
    table: "organisational_goal",
    virtual: {
      year: "decides organisational_goal.starts_on and ends_on",
      month: "decides organisational_goal.starts_on and ends_on",
      quarters: "written to organisational_goal_quarter",
    },
  },
  GoalEdit: {
    table: "organisational_goal",
    virtual: { quarters: "written to organisational_goal_quarter" },
  },
  DecideBody: { table: null, reason: "a decision on a stage, written to workflow_decision" },
};

module.exports = {
  TABLES,
  GoalLevel,
  GoalStatus,
  ProgressStatus,
  Month,
  GoalRef,
  GoalQuarter,
  Progress,
  Goal,
  GoalDetail,
  GoalPage,
  GoalListQuery,
  CascadeStep,
  GoalProgressRow,
  GoalsSummaryQuery,
  GoalsSummary,
  GoalCreate,
  GoalEdit,
  DecideBody,
};
