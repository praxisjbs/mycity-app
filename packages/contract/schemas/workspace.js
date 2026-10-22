"use strict";
/**
 * My Workspace: the Today view, Analytics and the week (docs/guides/workspace.md §2, §6;
 * docs/guides/performance.md §6.18). Tasks and the calendar have their own files; these are
 * the views built over them.
 */
const { z } = require("zod");
const { uuid, isoDate, isoDateTime, PAGE_SIZE, listQuery, Paged } = require("./common");
const { PersonRef } = require("./organisation");
const { Task, TaskRef, TaskPriority, TaskStatus, TaskActivityKind, TaskScope, LateReason } = require("./tasks");
const { CalendarItem } = require("./calendar");

/** The first page of a list on Today, with how many there are in all. */
const firstPage = (item) =>
  z
    .object({
      data: z.array(item).max(PAGE_SIZE),
      total: z.number().int().min(0),
    })
    .strict();

/** One line of Since You Were Away: something someone did to one of the reader's tasks. */
const TodayActivity = z
  .object({
    task_id: uuid,
    task_title: z.string(),
    actor: PersonRef.nullable(),
    kind: TaskActivityKind,
    to_status: TaskStatus.nullable(),
    created_at: isoDateTime,
  })
  .strict();

/** GET /workspace/today */
const TodayView = z
  .object({
    date: isoDate,
    due_today: z.number().int().min(0),
    overdue: z.number().int().min(0),
    in_review: z.number().int().min(0),
    done_this_week: z.number().int().min(0),
    my_day: firstPage(Task),
    set_by_manager: firstPage(Task),
    diary: firstPage(CalendarItem),
    since: firstPage(TodayActivity),
  })
  .strict();

const AnalyticsPeriod = z.enum(["30d", "90d", "year"]);

/** GET /workspace/analytics */
const AnalyticsQuery = z
  .object({
    scope: TaskScope.default("mine"),
    period: AnalyticsPeriod.default("30d"),
  })
  .strict();

const WeekCount = z.object({ week_start: isoDate, count: z.number().int().min(0) }).strict();
const PersonLoad = z.object({ employee: PersonRef, open: z.number().int().min(0) }).strict();
const PriorityLoad = z.object({ priority: TaskPriority, open: z.number().int().min(0) }).strict();

/** How long open tasks have been overdue, in days: 1 to 3, 4 to 7, 8 to 14, 15 and more. */
const AgingBand = z.enum(["1_3", "4_7", "8_14", "15_plus"]);
const AgingCount = z.object({ band: AgingBand, count: z.number().int().min(0) }).strict();
/** Open overdue tasks by the reason given; null: no reason recorded. */
const ReasonCount = z.object({ reason: LateReason.nullable(), count: z.number().int().min(0) }).strict();
/** A task held by a blockage now, oldest hold first. */
const BlockedWork = z
  .object({
    task: TaskRef,
    note: z.string(),
    raised_at: isoDateTime,
    blocked_days: z.number().min(0),
  })
  .strict();

const WorkspaceAnalytics = z
  .object({
    from: isoDate,
    to: isoDate,
    completion_rate: z.number().min(0).max(100).nullable(),
    overdue: z.number().int().min(0),
    avg_completion_days: z.number().min(0).nullable(),
    done: z.number().int().min(0),
    cancelled: z.number().int().min(0),
    open: z.number().int().min(0),
    cycle_days: z.number().min(0).nullable(),
    completed_per_week: z.array(WeekCount).max(60),
    workload: z.array(PersonLoad).max(PAGE_SIZE),
    by_priority: z.array(PriorityLoad).max(4),
    overdue_aging: z.array(AgingCount).max(4),
    overdue_by_reason: z.array(ReasonCount).max(5),
    blocked: firstPage(BlockedWork),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * The week (docs/guides/performance.md §6.18, PR 4)
 * ------------------------------------------------------------------ */

/** A Monday: the first day of a working week. */
const WeekStart = isoDate.refine((v) => new Date(`${v}T00:00:00Z`).getUTCDay() === 1, "must be a Monday");

/** GET /workspace/week: the reader's week, or someone's in their scope. */
const WeekQuery = z
  .object({
    week_starts_on: WeekStart.optional(),
    employee_id: uuid.optional(),
  })
  .strict();

/** Done this week, planned next week and blocked; Support Needed and an accepted summary. */
const WeekView = z
  .object({
    employee: PersonRef,
    week_starts_on: WeekStart,
    done: firstPage(Task),
    planned: firstPage(Task),
    blocked: firstPage(Task),
    support_needed: z.string().nullable(),
    summary_text: z.string().nullable(),
    updated_at: isoDateTime.nullable(),
  })
  .strict();

/** PUT /workspace/week: Support Needed, and a tidied summary the person accepted. */
const WeekSave = z
  .object({
    week_starts_on: WeekStart,
    support_needed: z.string().trim().max(1000).nullable().optional(),
    summary_text: z.string().trim().max(4000).nullable().optional(),
    ai_run_id: uuid.nullable().optional(),
  })
  .strict();

/** One person's week on Team This Week. */
const TeamWeek = z
  .object({
    employee: PersonRef,
    done: z.number().int().min(0),
    planned: z.number().int().min(0),
    blocked: z.number().int().min(0),
    support_needed: z.string().nullable(),
  })
  .strict();

const TeamWeekPage = Paged(TeamWeek);

/** GET /workspace/team-weeks */
const TeamWeekQuery = listQuery({ week_starts_on: WeekStart.optional() }, ["employee"]);

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  WeekQuery: { table: null, reason: "whose week, and which" },
  WeekView: {
    table: "weekly_summary",
    virtual: {
      employee: "the person in weekly_summary.employee_id",
      done: "their tasks completed that week",
      planned: "their open tasks due the next week",
      blocked: "their blocked tasks",
    },
  },
  WeekSave: { table: "weekly_summary" },
  TeamWeek: {
    table: "weekly_summary",
    virtual: {
      employee: "the person in weekly_summary.employee_id",
      done: "their tasks completed that week, counted",
      planned: "their open tasks due the next week, counted",
      blocked: "their blocked tasks, counted",
    },
  },
  TeamWeekPage: { table: null, reason: "a page of the team's weeks" },
  TeamWeekQuery: { table: null, reason: "list controls and the week" },
  TodayActivity: {
    table: "task_activity",
    virtual: {
      task_title: "task.title",
      actor: "the employee of task_activity.actor_user_id",
    },
  },
  TodayView: { table: null, reason: "the reader's day, built from task, calendar_event and task_activity" },
  AnalyticsQuery: { table: null, reason: "whose analytics, over which period" },
  WeekCount: { table: null, reason: "tasks done in one week" },
  PersonLoad: { table: null, reason: "open tasks of one person" },
  PriorityLoad: { table: null, reason: "open tasks of one priority" },
  AgingCount: { table: null, reason: "open overdue tasks in one band of days" },
  ReasonCount: { table: null, reason: "open overdue tasks with one late reason" },
  BlockedWork: { table: null, reason: "a task and its open task_blockage" },
  WorkspaceAnalytics: { table: null, reason: "aggregates over task" },
};

module.exports = {
  TABLES,
  TodayActivity,
  TodayView,
  AnalyticsPeriod,
  AnalyticsQuery,
  WeekCount,
  PersonLoad,
  PriorityLoad,
  AgingBand,
  AgingCount,
  ReasonCount,
  BlockedWork,
  WorkspaceAnalytics,
  WeekStart,
  WeekQuery,
  WeekView,
  WeekSave,
  TeamWeek,
  TeamWeekPage,
  TeamWeekQuery,
};
