"use strict";
/**
 * My Workspace: the Today view and Analytics (docs/guides/workspace.md §2, §6).
 * Tasks and the calendar have their own files; these are the views built over them.
 */
const { z } = require("zod");
const { uuid, isoDate, isoDateTime, PAGE_SIZE } = require("./common");
const { PersonRef } = require("./organisation");
const { Task, TaskPriority, TaskStatus, TaskActivityKind, TaskScope } = require("./tasks");
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

const WorkspaceAnalytics = z
  .object({
    from: isoDate,
    to: isoDate,
    completion_rate: z.number().min(0).max(100).nullable(),
    overdue: z.number().int().min(0),
    avg_completion_days: z.number().min(0).nullable(),
    done: z.number().int().min(0),
    cancelled: z.number().int().min(0),
    completed_per_week: z.array(WeekCount).max(60),
    workload: z.array(PersonLoad).max(PAGE_SIZE),
    by_priority: z.array(PriorityLoad).max(4),
  })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
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
  WorkspaceAnalytics,
};
