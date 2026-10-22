"use strict";
/**
 * Tasks: the board, a task's panel, its comments and its history
 * (docs/guides/workspace.md §3 to §6).
 *
 * A task belongs to its primary assignee. Whoever saved it is its setter
 * (`set_by`): the assignee themselves, or a manager setting work for their
 * reporting line (A24). Both kinds sit on one board.
 *
 * Statuses a person reads:
 *   todo, in_progress, in_review, done   the four columns, moved by drag
 *   cancelled                           reached only through Cancel Task, with a reason
 *
 * A task points at a record (a partner, a vacancy, a goal, a key result, a scorecard,
 * a review or a PIP) by `entity_type` and `entity_id`, and at the scorecard line it counts
 * towards by `employee_target_id`. The link to either is worked out on every read from the
 * route map and never stored.
 *
 * A commitment is a task with `is_commitment`, its acceptance criteria and its month
 * (docs/guides/performance.md §6.11). `original_due_at` is fixed when the month's set is
 * approved; a later due date moves `due_at` only.
 */
const { z } = require("zod");
const {
  uuid,
  text,
  optionalText,
  isoDate,
  isoDateTime,
  blank,
  listQuery,
  Paged,
} = require("./common");
const { PersonRef } = require("./organisation");
const { MonthStart } = require("./kpis");

const TaskStatus = z.enum(["todo", "in_progress", "in_review", "done", "cancelled"]);
/** The four columns a card can be dragged between. */
const BoardStatus = z.enum(["todo", "in_progress", "in_review", "done"]);
const TaskPriority = z.enum(["low", "normal", "high", "urgent"]);
/** A24: the horizon a manager sets work on. Null for a task with no horizon. */
const TaskCadence = z.enum(["daily", "weekly"]);
/**
 * Records a task may point at in M2; each is a key of shared/route-map ENTITY_ROUTES. `task`: a
 * Recovery task points at the missed commitment it recovers (migration 2400).
 */
const TaskEntityType = z.enum(["partner", "vacancy", "goal", "key_result", "scorecard", "performance_review", "improvement_plan", "task"]);
/** `mine`: tasks the caller is assigned, set or shares. `team`: everyone in their workspace scope. */
const TaskScope = z.enum(["mine", "team"]);

/**
 * How a task repeats. Anything else is refused with a 422 naming `recurrence`,
 * never half applied. Days of the week are 1 (Monday) to 6 (Saturday); Sunday is
 * not a working day (A22).
 */
const Recurrence = z.discriminatedUnion("freq", [
  z.object({ freq: z.literal("daily") }).strict(),
  z
    .object({
      freq: z.literal("weekly"),
      days: z.array(z.number().int().min(1).max(6)).min(1).max(6),
    })
    .strict(),
  z
    .object({
      freq: z.literal("monthly"),
      day_of_month: z.number().int().min(1).max(28),
    })
    .strict(),
]);

/** Where a link takes the reader: shared/route-map linkFor(). */
const Link = z
  .object({
    module: z.string(),
    tab: z.string(),
    id: z.string(),
    path: z.string(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Commitments (docs/guides/performance.md §6.11)
 * ------------------------------------------------------------------ */

/**
 * A commitment's state, worked out on every read: approved or not, done by its original date or
 * after, missed at its month's end, or rescoped.
 */
const CommitmentState = z.enum(["awaiting_approval", "due", "on_time", "late", "missed", "rescoped"]);
/** Where a person's month of commitments stands. */
const CommitmentSetStatus = z.enum(["draft", "submitted", "approved", "returned"]);

/** The Recovery task set for a missed commitment: its owner and date. */
const CommitmentRecoveryRef = z
  .object({
    task_id: uuid,
    number: z.string(),
    assignee: PersonRef.nullable(),
    due_at: isoDateTime.nullable(),
  })
  .strict();

/** A rescope waiting for approval (its reason is the task's `rescope_reason`), and whether the reader decides it. */
const PendingRescope = z
  .object({
    workflow_instance_id: uuid,
    can_decide: z.boolean(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Counts Towards (docs/guides/performance.md §6.18)
 * ------------------------------------------------------------------ */

const CountsTowardsKind = z.enum(["line", "key_result"]);

/** The scorecard line or key result a task counts towards, as the card and panel name it. */
const CountsTowards = z
  .object({
    kind: CountsTowardsKind,
    employee_target_id: uuid.nullable(),
    okr_key_result_id: uuid.nullable(),
    title: z.string(),
    link: Link.nullable(),
  })
  .strict();

/** One choice on the task form's Counts Towards: a line of the assignee's scorecard, or a key result they own. */
const CountsTowardsOption = z
  .object({
    kind: CountsTowardsKind,
    employee_target_id: uuid.nullable(),
    okr_key_result_id: uuid.nullable(),
    title: z.string(),
    sub: z.string().nullable(),
  })
  .strict();
const CountsTowardsPage = Paged(CountsTowardsOption);

/** GET /tasks/counts-towards: the assignee's own (the caller unless given), for the quarter holding `month`. */
const CountsTowardsQuery = listQuery(
  {
    assignee_id: uuid.optional(),
    month: MonthStart.optional(),
  },
);

/** One task, as the board, Today and the panel show it. */
const Task = z
  .object({
    task_id: uuid,
    number: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    status: TaskStatus,
    priority: TaskPriority,
    cadence: TaskCadence.nullable(),
    assignee: PersonRef.nullable(),
    set_by: PersonRef.nullable(),
    due_at: isoDateTime.nullable(),
    overdue: z.boolean(),
    started_at: isoDateTime.nullable(),
    completed_at: isoDateTime.nullable(),
    cancelled_at: isoDateTime.nullable(),
    cancel_reason: z.string().nullable(),
    blocked_reason: z.string().nullable(),
    blocked_at: isoDateTime.nullable(),
    counts_towards: CountsTowards.nullable(),
    entity_type: TaskEntityType.nullable(),
    entity_id: uuid.nullable(),
    link: Link.nullable(),
    recurrence: Recurrence.nullable(),
    comment_count: z.number().int().min(0),
    is_commitment: z.boolean(),
    acceptance_criteria: z.string().nullable(),
    commitment_month: isoDate.nullable(),
    original_due_at: isoDateTime.nullable(),
    rescoped_at: isoDateTime.nullable(),
    rescope_reason: z.string().nullable(),
    commitment_set_id: uuid.nullable(),
    commitment_state: CommitmentState.nullable(),
    created_at: isoDateTime,
    updated_at: isoDateTime,
  })
  .strict();

/**
 * GET /tasks/:id: the task and what the caller may do to it. A commitment also says where its
 * month's set stands, a rescope waiting on approval, its Recovery task, and whether the caller may
 * ask a rescope or set its recovery.
 */
const TaskDetail = Task.extend({
  can_edit: z.boolean(),
  can_reassign: z.boolean(),
  can_cancel: z.boolean(),
  set_status: CommitmentSetStatus.nullable(),
  rescope: PendingRescope.nullable(),
  recovery: CommitmentRecoveryRef.nullable(),
  can_rescope: z.boolean(),
  can_set_recovery: z.boolean(),
}).strict();

const TaskPage = Paged(Task);

/** GET /tasks */
const TaskListQuery = listQuery(
  {
    status: TaskStatus.optional(),
    scope: TaskScope.default("mine"),
    assignee_id: uuid.optional(),
    cadence: TaskCadence.optional(),
    priority: TaskPriority.optional(),
    due: z.enum(["overdue", "today", "week"]).optional(),
    employee_target_id: uuid.optional(),
    is_commitment: z.enum(["true", "false"]).optional(),
    commitment_month: MonthStart.optional(),
  },
  ["sort_order", "due_at", "priority", "created_at"],
);

/** GET /tasks/summary: the four figures above the board. */
const TaskSummaryQuery = z.object({ scope: TaskScope.default("mine") }).strict();
const TaskSummary = z
  .object({
    open: z.number().int().min(0),
    due_this_week: z.number().int().min(0),
    overdue: z.number().int().min(0),
    done_this_week: z.number().int().min(0),
  })
  .strict();

/** The record a task points at: both given, or neither. */
const pointerPair = (v) =>
  (v.entity_type === undefined || v.entity_type === null) ===
  (v.entity_id === undefined || v.entity_id === null);
const POINTER = { message: "Pick the record", path: ["entity_id"] };

/**
 * A commitment needs its criteria, its month and a due date in that month (performance.md §6.11).
 * Applied where the body says it is one.
 */
function commitmentProblems(v, ctx) {
  if (v.is_commitment !== true) return;
  const say = (path, message) => ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [path] });
  if (!v.acceptance_criteria) say("acceptance_criteria", "Give the criteria");
  if (!v.commitment_month) say("commitment_month", "Pick the month");
  if (!v.due_on) say("due_on", "Pick a due date");
  else if (v.commitment_month && String(v.due_on).slice(0, 7) !== String(v.commitment_month).slice(0, 7))
    say("due_on", "Not in that month");
}

/** POST /tasks. No assignee: the caller's own task. */
const TaskCreate = z
  .object({
    title: text(200),
    description: optionalText(5000),
    priority: TaskPriority.default("normal"),
    cadence: blank(TaskCadence),
    due_on: blank(isoDate),
    primary_assignee_id: blank(uuid),
    employee_target_id: blank(uuid),
    entity_type: blank(TaskEntityType),
    entity_id: blank(uuid),
    recurrence: Recurrence.optional(),
    is_commitment: z.boolean().default(false),
    acceptance_criteria: optionalText(1000),
    commitment_month: blank(MonthStart),
  })
  .strict()
  .refine(pointerPair, POINTER)
  .superRefine(commitmentProblems);

/**
 * PATCH /tasks/:id. The assignee may change the notes and priority of their own task;
 * the title, due day, cadence, assignee, KPI and record belong to the setter (§6).
 * `null` clears an optional link.
 */
const TaskEdit = z
  .object({
    title: text(200).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    priority: TaskPriority.optional(),
    cadence: TaskCadence.nullable().optional(),
    due_on: isoDate.nullable().optional(),
    primary_assignee_id: uuid.optional(),
    employee_target_id: uuid.nullable().optional(),
    entity_type: TaskEntityType.nullable().optional(),
    entity_id: uuid.nullable().optional(),
    recurrence: Recurrence.nullable().optional(),
    is_commitment: z.boolean().optional(),
    acceptance_criteria: z.string().trim().max(1000).nullable().optional(),
    commitment_month: MonthStart.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Change at least one field")
  .refine((v) => !("entity_type" in v || "entity_id" in v) || pointerPair(v), POINTER)
  .superRefine((v, ctx) => {
    // The service checks the rest against the task as it stands: a body that marks it says it all.
    if (v.is_commitment === true && "due_on" in v && "commitment_month" in v) commitmentProblems(v, ctx);
  });

/** POST /tasks/:id/move: drag to a column, before a card (null: the foot of the column). */
const TaskMove = z
  .object({
    status: BoardStatus,
    before_task_id: uuid.nullable().default(null),
  })
  .strict();

/** POST /tasks/:id/block */
const TaskBlock = z.object({ blocked_reason: text(500) }).strict();

/** POST /tasks/:id/cancel */
const TaskCancel = z.object({ cancel_reason: text(500) }).strict();

/* ------------------------------------------------------------------ *
 * Comments and history
 * ------------------------------------------------------------------ */

const TaskComment = z
  .object({
    task_comment_id: uuid,
    task_id: uuid,
    author: PersonRef.nullable(),
    body: z.string(),
    created_at: isoDateTime,
  })
  .strict();
const TaskCommentPage = Paged(TaskComment);
const TaskCommentListQuery = listQuery({}, ["created_at"]);
const TaskCommentCreate = z.object({ body: text(2000) }).strict();

const TaskActivityKind = z.enum([
  "created",
  "status_changed",
  "assigned",
  "edited",
  "blocked",
  "unblocked",
  "cancelled",
  "commented",
]);

const TaskActivity = z
  .object({
    task_activity_id: uuid,
    task_id: uuid,
    task_title: z.string(),
    actor: PersonRef.nullable(),
    kind: TaskActivityKind,
    from_status: TaskStatus.nullable(),
    to_status: TaskStatus.nullable(),
    detail: z.string().nullable(),
    created_at: isoDateTime,
  })
  .strict();
const TaskActivityPage = Paged(TaskActivity);
const TaskActivityListQuery = listQuery({}, ["created_at"]);

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  Task: {
    table: "task",
    virtual: {
      assignee: "the person in task.primary_assignee_id",
      set_by: "the person in task.set_by_employee_id",
      overdue: "worked out: open and task.due_at before now",
      counts_towards: "task.employee_target_id, or a key_result pointer, with its title and link",
      link: "linkFor(task.entity_type, task.entity_id), never stored",
      comment_count: "count of task_comment not deleted",
      commitment_state: "worked out from the commitment's dates, completion and month (performance.md §6.11)",
    },
  },
  TaskDetail: {
    table: "task",
    virtual: {
      assignee: "the person in task.primary_assignee_id",
      set_by: "the person in task.set_by_employee_id",
      overdue: "worked out: open and task.due_at before now",
      counts_towards: "task.employee_target_id, or a key_result pointer, with its title and link",
      link: "linkFor(task.entity_type, task.entity_id), never stored",
      comment_count: "count of task_comment not deleted",
      commitment_state: "worked out from the commitment's dates, completion and month (performance.md §6.11)",
      can_edit: "the caller is the setter, or has the setter's scope over the assignee",
      can_reassign: "as can_edit",
      can_cancel: "as can_edit",
      set_status: "commitment_set.status of the commitment's set",
      rescope: "the pending performance.commitments instance over the task",
      recovery: "the task whose entity_type is task and entity_id this commitment",
      can_rescope: "an approved commitment not done, not rescoped, the caller its person or in scope",
      can_set_recovery: "a missed commitment with no recovery, the caller its person or in scope",
    },
  },
  TaskPage: { table: null, reason: "a page of tasks" },
  TaskListQuery: { table: null, reason: "list controls and filters for the board" },
  TaskSummaryQuery: { table: null, reason: "whose figures: mine or my team" },
  TaskSummary: { table: null, reason: "counts over task" },
  TaskCreate: {
    table: "task",
    virtual: { due_on: "written to task.due_at: the end of that working day, Africa/Lagos" },
  },
  TaskEdit: {
    table: "task",
    virtual: { due_on: "written to task.due_at: the end of that working day, Africa/Lagos" },
  },
  TaskMove: {
    table: "task",
    virtual: { before_task_id: "the card it now sits above; decides task.sort_order" },
  },
  TaskBlock: { table: "task" },
  TaskCancel: { table: "task" },
  TaskComment: {
    table: "task_comment",
    virtual: { author: "the employee of task_comment.author_user_id" },
  },
  TaskCommentPage: { table: null, reason: "a page of comments" },
  TaskCommentListQuery: { table: null, reason: "list controls for a task's comments" },
  TaskCommentCreate: { table: "task_comment" },
  TaskActivity: {
    table: "task_activity",
    virtual: {
      task_title: "task.title",
      actor: "the employee of task_activity.actor_user_id",
    },
  },
  TaskActivityPage: { table: null, reason: "a page of a task's history" },
  TaskActivityListQuery: { table: null, reason: "list controls for a task's history" },
  Link: { table: null, reason: "a screen path from shared/route-map" },
  CountsTowards: { table: null, reason: "the line or key result a task counts towards, from employee_target or okr_key_result" },
  CountsTowardsOption: { table: null, reason: "a line or a key result the assignee may pick" },
  CountsTowardsPage: { table: null, reason: "a page of Counts Towards choices" },
  CountsTowardsQuery: { table: null, reason: "whose lines and key results, for which month" },
  CommitmentRecoveryRef: { table: null, reason: "the Recovery task of a missed commitment" },
  PendingRescope: { table: null, reason: "a rescope's waiting workflow_instance" },
};

module.exports = {
  TABLES,
  TaskStatus,
  BoardStatus,
  TaskPriority,
  TaskCadence,
  TaskEntityType,
  TaskScope,
  Recurrence,
  Link,
  CommitmentState,
  CommitmentSetStatus,
  CommitmentRecoveryRef,
  PendingRescope,
  CountsTowardsKind,
  CountsTowards,
  CountsTowardsOption,
  CountsTowardsPage,
  CountsTowardsQuery,
  Task,
  TaskDetail,
  TaskPage,
  TaskListQuery,
  TaskSummaryQuery,
  TaskSummary,
  TaskCreate,
  TaskEdit,
  TaskMove,
  TaskBlock,
  TaskCancel,
  TaskComment,
  TaskCommentPage,
  TaskCommentListQuery,
  TaskCommentCreate,
  TaskActivityKind,
  TaskActivity,
  TaskActivityPage,
  TaskActivityListQuery,
};
