"use strict";
/**
 * Targets: a department's targets for a month, and the department's month approved as one
 * (A16; docs/guides/performance.md §3 steps 3 and 5).
 *
 * A departmental target is a goal at the `department` level (goals.js) under an active monthly
 * goal of the same month. A plan is one department's month: its targets and its people's KPIs
 * (kpis.js) go through `performance.goal` together, and the CEO's approval makes every one of
 * them active and binding.
 *
 * Plan statuses: draft, pending_approval, active (approved), returned.
 */
const { z } = require("zod");
const { uuid, text, optionalText, isoDateTime, listQuery, Paged } = require("./common");
const { PersonRef } = require("./organisation");
const { RouteStage, ApprovalDecision } = require("./workflow");
const { GoalStatus, GoalRef, Progress, Month } = require("./goals");

const PlanStatus = z.enum(["draft", "pending_approval", "active", "returned"]);

/** One department's month. */
const Plan = z
  .object({
    performance_plan_id: uuid,
    department_id: uuid,
    department: z.string(),
    month: Month,
    status: PlanStatus,
    submitted_by: PersonRef.nullable(),
    submitted_at: isoDateTime.nullable(),
    approved_at: isoDateTime.nullable(),
    workflow_instance_id: uuid.nullable(),
    /** The stage it waits at, while pending. */
    waiting_on: z.string().nullable(),
    targets: z.number().int().min(0),
    kpis: z.number().int().min(0),
    route: z.array(RouteStage),
    can_submit: z.boolean(),
    can_decide: z.boolean(),
  })
  .strict();

/** One departmental target. */
const Target = z
  .object({
    organisational_goal_id: uuid,
    code: z.string().nullable(),
    title: z.string(),
    success_measure: z.string().nullable(),
    status: GoalStatus,
    month: Month,
    department_id: uuid,
    department: z.string(),
    rolls_up_to: GoalRef,
    owner: PersonRef,
    performance_plan_id: uuid.nullable(),
    progress: Progress,
    can_decide: z.boolean(),
    created_at: isoDateTime,
  })
  .strict();

const TargetPage = Paged(Target);

/** GET /performance/targets. `month` defaults to this month. */
const TargetListQuery = listQuery(
  {
    month: Month.optional(),
    department_id: uuid.optional(),
    status: GoalStatus.optional(),
  },
  ["department", "title", "code"],
);

/** Last Month's Results: one bar per department. */
const DepartmentResult = z
  .object({
    department_id: uuid,
    department: z.string(),
    attainment: z.number().min(0).max(1).nullable(),
  })
  .strict();

/** One move on the month's plans, newest first: the Approval Trail. */
const TrailEntry = ApprovalDecision.extend({
  performance_plan_id: uuid,
  department: z.string(),
}).strict();

/** GET /performance/targets/summary */
const TargetSummaryQuery = z.object({ month: Month.optional() }).strict();
const TargetsSummary = z
  .object({
    month: Month,
    departments: z.number().int().min(0),
    approved: z.number().int().min(0),
    awaiting: z.number().int().min(0),
    /** The stages of `performance.goal`, each with how many of the month's plans wait there. */
    chain: z.array(
      z
        .object({
          key: z.string(),
          name: z.string(),
          waiting: z.number().int().min(0),
        })
        .strict(),
    ),
    /** The caller's own department's plan, when they head one. */
    my_plan: Plan.nullable(),
    plans: z.array(Plan),
    last_month: z.array(DepartmentResult),
    trail: z.array(TrailEntry),
  })
  .strict();

/** POST /performance/targets: a target for the caller's department (another, for the CEO). */
const TargetCreate = z
  .object({
    title: text(200),
    success_measure: optionalText(500),
    description: optionalText(2000),
    month: Month,
    parent_goal_id: uuid,
    department_id: uuid.optional(),
  })
  .strict();

/** POST /performance/plans/:department_id/:month/submit */
const PlanParams = z.object({ department_id: uuid, month: Month }).strict();

const TABLES = {
  Plan: {
    table: "performance_plan",
    virtual: {
      department: "department.name",
      submitted_by: "the employee of performance_plan.submitted_by",
      waiting_on: "the current stage's name, from workflow_instance",
      targets: "count of the plan's departmental targets",
      kpis: "count of the plan's employee_target rows",
      route: "the stages of the plan's workflow_instance",
      can_submit: "draft or returned, and the caller heads the department",
      can_decide: "the plan waits at a stage the caller may decide",
      month: "performance_plan.month as YYYY-MM",
    },
  },
  Target: {
    table: "organisational_goal",
    virtual: {
      month: "organisational_goal.starts_on as YYYY-MM",
      department: "department.name",
      rolls_up_to: "the monthly goal in organisational_goal.parent_goal_id",
      owner: "the person in organisational_goal.owner_employee_id",
      progress: "the weighted mean of its KPIs' attainment (§6)",
      can_decide: "its plan waits at a stage the caller may decide",
    },
  },
  TargetPage: { table: null, reason: "a page of departmental targets" },
  TargetListQuery: { table: null, reason: "list controls and filters for targets" },
  DepartmentResult: { table: null, reason: "a department's attainment for a month, worked out" },
  TrailEntry: { table: null, reason: "a workflow_decision on a plan, with its department" },
  TargetSummaryQuery: { table: null, reason: "which month" },
  TargetsSummary: { table: null, reason: "counts and plans for a month" },
  TargetCreate: {
    table: "organisational_goal",
    virtual: { month: "decides organisational_goal.starts_on and ends_on" },
  },
  PlanParams: { table: null, reason: "the department and month in the path" },
};

module.exports = {
  TABLES,
  PlanStatus,
  Plan,
  Target,
  TargetPage,
  TargetListQuery,
  DepartmentResult,
  TrailEntry,
  TargetSummaryQuery,
  TargetsSummary,
  TargetCreate,
  PlanParams,
};
