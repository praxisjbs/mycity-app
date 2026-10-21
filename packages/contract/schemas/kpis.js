"use strict";
/**
 * KPIs: each person's individual monthly KPIs, their weights and progress
 * (A16; docs/guides/performance.md §3 steps 4 to 7, §6).
 *
 * A KPI rolls up to one departmental target of the person's department for the month. A
 * person's weights for a month total exactly 100.00 when the month is submitted; a draft may
 * not. Progress comes from Tasks (done tasks linked to the KPI) or is entered by hand.
 *
 * Attainment is actual ÷ target capped at 1 (`higher`), or target ÷ actual capped at 1
 * (`lower`, 0 actual = 1). KPI Score = Σ(attainment × weight) ÷ 100.
 *
 * Quantities and weights are decimal strings, like money (gate 20), so 40.00 stays 40.00.
 */
const { z } = require("zod");
const { uuid, text, optionalText, isoDate, isoDateTime, listQuery, Paged } = require("./common");
const { PersonRef } = require("./organisation");
const { GoalRef, ProgressStatus, Month } = require("./goals");

const KpiStatus = z.enum(["draft", "pending_approval", "active", "returned", "completed", "cancelled", "met"]);
const KpiDirection = z.enum(["higher", "lower"]);
const ProgressSource = z.enum(["manual", "tasks"]);

/** A quantity a KPI counts: up to 4 decimal places. */
const Quantity = z.string().regex(/^\d{1,13}(\.\d{1,4})?$/, "Enter a number");
/** A weight in percent, 1.00 to 100.00. */
const Weight = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter a percentage")
  .refine((v) => Number(v) >= 1 && Number(v) <= 100, "Between 1 and 100");

/** One KPI. */
const Kpi = z
  .object({
    employee_target_id: uuid,
    employee: PersonRef,
    title: z.string(),
    month: Month,
    target_value: Quantity.nullable(),
    actual_value: Quantity.nullable(),
    unit: z.string().nullable(),
    direction: KpiDirection,
    progress_source: ProgressSource,
    weight: Weight,
    status: KpiStatus,
    attainment: z.number().min(0).max(1).nullable(),
    progress_status: ProgressStatus.nullable(),
    due_on: isoDate.nullable(),
    set_by: PersonRef.nullable(),
    target: GoalRef.nullable(),
    performance_plan_id: uuid.nullable(),
    can_record_actual: z.boolean(),
    updated_at: isoDateTime,
  })
  .strict();

const KpiPage = Paged(Kpi);

/** GET /performance/kpis. `month` defaults to this month. */
const KpiListQuery = listQuery(
  {
    month: Month.optional(),
    department_id: uuid.optional(),
    employee_id: uuid.optional(),
    status: KpiStatus.optional(),
    progress_status: ProgressStatus.optional(),
  },
  ["employee", "title", "weight"],
);

/** GET /performance/kpis/summary */
const KpiSummaryQuery = z
  .object({ month: Month.optional(), department_id: uuid.optional() })
  .strict();
const KpisSummary = z
  .object({
    month: Month,
    staff: z.number().int().min(0),
    with_kpis: z.number().int().min(0),
    /** People whose weights for the month do not total 100. */
    weights_off: z.number().int().min(0),
    on_track: z.number().int().min(0),
    behind_or_at_risk: z.number().int().min(0),
    sources: z
      .array(
        z
          .object({
            progress_source: ProgressSource,
            count: z.number().int().min(0),
          })
          .strict(),
      )
      .length(2),
  })
  .strict();

/** GET /performance/kpis/employees/:id: one person's KPIs for a month. */
const KpiMonthQuery = z.object({ month: Month.optional() }).strict();
const EmployeeKpis = z
  .object({
    employee: PersonRef,
    month: Month,
    items: z.array(Kpi),
    total_weight: z.string(),
    /** Σ(attainment × weight) ÷ 100, 0 to 1; null before any KPI is active. */
    kpi_score: z.number().min(0).max(1).nullable(),
    /** Departmental targets of the person's department for the month a KPI may roll up to. */
    targets: z.array(GoalRef),
    can_assign: z.boolean(),
  })
  .strict();

/** One KPI in Assign KPIs. `employee_target_id` keeps an existing draft KPI. */
const KpiAssignItem = z
  .object({
    employee_target_id: uuid.optional(),
    organisational_goal_id: uuid,
    title: text(200),
    target_value: Quantity,
    unit: optionalText(40),
    direction: KpiDirection.default("higher"),
    progress_source: ProgressSource.default("manual"),
    weight: Weight,
  })
  .strict();

/**
 * PUT /performance/kpis/employees/:id: replaces the person's draft or returned KPIs for the
 * month. Weights may total anything here; the month is refused at submit unless each person
 * totals 100.00.
 */
const KpiAssign = z
  .object({
    month: Month,
    items: z.array(KpiAssignItem).min(1).max(20),
  })
  .strict();

/** POST /performance/kpis/:id/actual: a manual KPI's figure so far. */
const KpiActual = z.object({ actual_value: Quantity, note: optionalText(500) }).strict();

/** GET /performance/kpis/:id/trace: Rolls Up To, from the KPI to its organisational goal. */
const KpiTrace = z
  .object({
    employee_target_id: uuid,
    title: z.string(),
    /** departmental target, monthly goal, annual goal, organisational goal, in that order. */
    chain: z.array(GoalRef),
  })
  .strict();

const KPI_VIRTUAL = {
  employee: "the person in employee_target.employee_id",
  month: "employee_target.month as YYYY-MM",
  attainment: "worked out from target_value, actual_value and direction (§6)",
  progress_status: "worked out from attainment and the share of the month gone (§6)",
  set_by: "the person in employee_target.set_by_employee_id",
  target: "the departmental target in employee_target.organisational_goal_id",
  can_record_actual: "manual, active, and the caller is the person or their setter",
};
const TABLES = {
  Kpi: { table: "employee_target", virtual: KPI_VIRTUAL },
  KpiPage: { table: null, reason: "a page of KPIs" },
  KpiListQuery: { table: null, reason: "list controls and filters for KPIs" },
  KpiSummaryQuery: { table: null, reason: "which month and department" },
  KpisSummary: { table: null, reason: "counts over employee_target" },
  KpiMonthQuery: { table: null, reason: "which month" },
  EmployeeKpis: { table: null, reason: "one person's KPIs for a month, with their total and score" },
  KpiAssignItem: {
    table: "employee_target",
    virtual: { employee_target_id: "an existing draft KPI to keep; absent for a new one" },
  },
  KpiAssign: { table: null, reason: "a person's KPIs for a month, replaced together" },
  KpiActual: {
    table: "employee_target",
    virtual: { note: "kept in the audit row, not a column" },
  },
  KpiTrace: { table: null, reason: "a KPI's ancestors through organisational_goal.parent_goal_id" },
};

module.exports = {
  TABLES,
  KpiStatus,
  KpiDirection,
  ProgressSource,
  Quantity,
  Weight,
  Kpi,
  KpiPage,
  KpiListQuery,
  KpiSummaryQuery,
  KpisSummary,
  KpiMonthQuery,
  EmployeeKpis,
  KpiAssignItem,
  KpiAssign,
  KpiActual,
  KpiTrace,
};
