"use strict";
/**
 * KPIs: a function's standing operational measures and their monthly actuals
 * (docs/guides/performance.md §4, §5 KPIs, §6.5).
 *
 * A KPI belongs to a function (TBO-K01), carries its formula, unit, direction, target,
 * frequency and data source, and records one actual per month: Met, Not Met or N/A. N/A
 * is "no eligible cases" and scores blank, never 100%. A KPI stands across quarters; it is
 * set by the function's head (`goals.function`).
 */
const { z } = require("zod");
const { uuid, text, optionalText, isoDate, isoDateTime, blank, listQuery, Paged } = require("./common");
const { PersonRef } = require("./organisation");
const { Quantity, Direction } = require("./scoring");

const KpiResult = z.enum(["met", "not_met", "na"]);
const KpiFrequency = z.enum(["weekly", "monthly", "quarterly"]);

/** The first day of a month, the key of every monthly figure ("2026-10-01"). */
const MonthStart = isoDate.refine((v) => v.endsWith("-01"), "must be the first day of a month");

/** One KPI's actual for one month. */
const KpiMonth = z
  .object({
    kpi_month_id: uuid,
    kpi_definition_id: uuid,
    month: MonthStart,
    result: KpiResult,
    actual_value: Quantity.nullable(),
    actual_text: z.string().nullable(),
    comment: z.string().nullable(),
    recorded_by: PersonRef.nullable(),
    recorded_at: isoDateTime,
  })
  .strict();

/** A KPI, as the KPIs list shows it, with its latest month. */
const Kpi = z
  .object({
    kpi_definition_id: uuid,
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    department_id: uuid.nullable(),
    department: z.string().nullable(),
    formula: z.string().nullable(),
    unit: z.string().nullable(),
    direction: Direction,
    target_text: z.string().nullable(),
    target_value: Quantity.nullable(),
    frequency: KpiFrequency.nullable(),
    data_source: z.string().nullable(),
    starts_period_id: uuid.nullable(),
    active: z.boolean(),
    latest: KpiMonth.nullable(),
    created_at: isoDateTime,
    updated_at: isoDateTime,
  })
  .strict();

const KpiPage = Paged(Kpi);

/** GET /performance/kpis */
const KpiListQuery = listQuery(
  {
    department_id: uuid.optional(),
    period_id: uuid.optional(),
    active: z.enum(["true", "false"]).optional(),
  },
  ["code", "name"],
);

/** GET /performance/kpis/summary: the KPIs figures for a month, over every active KPI or one function's. */
const KpiSummaryQuery = z
  .object({
    department_id: uuid.optional(),
    month: MonthStart,
  })
  .strict();

const KpiSummary = z
  .object({
    kpis: z.number().int().min(0),
    met: z.number().int().min(0),
    not_met: z.number().int().min(0),
    awaiting: z.number().int().min(0),
  })
  .strict();

/** A scorecard line that is scored from this KPI. */
const KpiLineRef = z
  .object({
    employee_target_id: uuid,
    scorecard_id: uuid,
    employee: PersonRef,
    title: z.string(),
    weight: z.string(),
  })
  .strict();

/** GET /performance/kpis/:id: the KPI, its months and the lines that use it. */
const KpiDetail = Kpi.extend({
  months: z.array(KpiMonth),
  lines: z.array(KpiLineRef),
  can_edit: z.boolean(),
}).strict();

/** POST /performance/kpis. The code is the function's next free one (TBO-K04). */
const KpiCreate = z
  .object({
    department_id: uuid,
    name: text(200),
    description: optionalText(2000),
    formula: optionalText(1000),
    unit: optionalText(40),
    direction: Direction.default("higher"),
    target_text: optionalText(500),
    target_value: blank(Quantity),
    frequency: KpiFrequency.default("monthly"),
    data_source: optionalText(500),
    starts_period_id: blank(uuid),
  })
  .strict();

/** PATCH /performance/kpis/:id */
const KpiEdit = z
  .object({
    name: text(200),
    description: z.string().trim().max(2000).nullable(),
    formula: z.string().trim().max(1000).nullable(),
    unit: z.string().trim().max(40).nullable(),
    direction: Direction,
    target_text: z.string().trim().max(500).nullable(),
    target_value: Quantity.nullable(),
    frequency: KpiFrequency,
    data_source: z.string().trim().max(500).nullable(),
    active: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Change at least one field" });

/** POST /performance/kpis/:id/actuals: one month's figure. */
const KpiActual = z
  .object({
    month: MonthStart,
    result: KpiResult,
    actual_value: blank(Quantity),
    actual_text: optionalText(500),
    comment: optionalText(2000),
  })
  .strict();

/** One row of a function sheet's Operational KPIs table, as the okr_kpis importer reads it. */
const KpiImportRow = z
  .object({
    function: text(120),
    code: text(20),
    name: text(200),
    formula: optionalText(1000),
    unit: optionalText(40),
    direction: optionalText(40),
    target: optionalText(500),
    frequency: optionalText(100),
    data_source: optionalText(500),
    result: optionalText(40),
    actual: optionalText(500),
    comment: optionalText(2000),
    former_codes: optionalText(300),
  })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  KpiMonth: {
    table: "kpi_month",
    virtual: { recorded_by: "the employee of kpi_month.recorded_by" },
  },
  Kpi: {
    table: "kpi_definition",
    virtual: {
      department: "department.name",
      latest: "the KPI's latest kpi_month",
    },
  },
  KpiPage: { table: null, reason: "a page of KPIs" },
  KpiListQuery: { table: null, reason: "list controls and filters for the KPIs" },
  KpiSummaryQuery: { table: null, reason: "which function and month the KPIs figures count" },
  KpiSummary: { table: null, reason: "the KPIs figures, counted over the active KPIs" },
  KpiLineRef: {
    table: "employee_target",
    virtual: { employee: "the person in employee_target.employee_id" },
  },
  KpiDetail: {
    table: "kpi_definition",
    virtual: {
      department: "department.name",
      latest: "the KPI's latest kpi_month",
      months: "the KPI's kpi_month rows",
      lines: "the employee_target rows with this kpi_definition_id",
      can_edit: "the reader may change it and record its months (goals.authority)",
    },
  },
  KpiCreate: { table: "kpi_definition" },
  KpiEdit: { table: "kpi_definition" },
  KpiActual: { table: "kpi_month" },
  KpiImportRow: { table: null, reason: "a KPI of the OKR workbook as the importer reads it" },
};

module.exports = {
  TABLES,
  KpiResult,
  KpiFrequency,
  MonthStart,
  KpiMonth,
  Kpi,
  KpiPage,
  KpiListQuery,
  KpiSummaryQuery,
  KpiSummary,
  KpiLineRef,
  KpiDetail,
  KpiCreate,
  KpiEdit,
  KpiActual,
  KpiImportRow,
};
