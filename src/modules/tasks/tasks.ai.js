"use strict";
/**
 * What the assistant may read and do about tasks: the board within the asker's own
 * `workspace` scope (their own, and their reporting line's for a manager), one page of
 * 25 at a time; the board counted (tasks.summary: by status, assignee, priority, due window
 * or cadence; figures, never rows, docs/guides/praxis-ai.md §6.13); and, as cards the person
 * confirms (§6.11), setting a task, marking tasks done and commenting on one, each through the
 * same service function the screen's own button calls. Cancelling stays on the task's panel.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const routeMap = require("../../shared/route-map");
const service = require("./tasks.service");

const taskLink = (id) => (routeMap.linkFor("task", id) || {}).path || null;

module.exports = defineManifest({
  module: "workspace",
  actions: [
    {
      key: "tasks.create",
      description: "Set a task: a title, notes, priority, cadence, due day, and for a manager who it is for",
      input: c.tasks.TaskCreate,
      permission: ["workspace", "create"],
      risk: "standard",
      suggest: true,
      records: (values) => (values.primary_assignee_id ? [{ type: "employee", id: values.primary_assignee_id }] : []),
      // The same function the screen's Create Task calls, with the scope the grant gives (§6).
      run: (values, actor) => service.create(actor, actor.scope, values),
      readback: (task) => [{ type: "task", id: task.task_id, label: `${task.number} ${task.title}`, status: "created", link: taskLink(task.task_id) }],
      labels: { title: "Title", description: "Notes", priority: "Priority", cadence: "Cadence", due_on: "Due Day", primary_assignee_id: "For", member_ids: "Shared With", department_id: "Department", project_id: "Project" },
    },
    {
      key: "tasks.complete",
      label: "Mark Done",
      description: "Mark one or more of my tasks done, with the late reason the board asks for an overdue one",
      input: c.tasks.TaskComplete,
      permission: ["workspace", "edit"],
      risk: "standard",
      bulk: 25,
      // Mark Done is a button on the task's panel; its late reason is asked in a sheet. The card names the tasks and takes the reason.
      form: "none: Mark Done is a button on the task's panel, its late reason asked in a sheet; the card names the tasks",
      records: (values, _actor, db) => (db ? service.cardRecords(db, values.task_ids, _actor.scope) : (values.task_ids || []).map((id) => ({ type: "task", id }))),
      check: (client, values, actor) => service.assertCardTasks(client, values.task_ids, actor.scope),
      // Each task moved to Done through the board's own move, one after another (§6).
      run: (values, actor) => service.completeMany(actor, actor.scope, values),
      readback: (r) => r.lines.map((l) => ({ ...l, link: taskLink(l.id) })),
      labels: { task_ids: "Tasks", late_reason: "Late Reason" },
    },
    {
      key: "tasks.comment",
      label: "Add Comment",
      description: "Comment on a task I can see: the task and the words",
      input: c.tasks.TaskCommentAdd,
      permission: ["workspace", "edit"],
      risk: "standard",
      // The panel's comment box validates with TaskCommentCreate alone: the panel is the task. The card names it too.
      form: "none: a comment is typed on the task's panel, whose form never names the task; the card must",
      records: (values, _actor, db) => (values.task_id ? (db ? service.cardRecords(db, [values.task_id], _actor.scope) : [{ type: "task", id: values.task_id }]) : []),
      check: (client, values, actor) => service.assertCardTasks(client, [values.task_id], actor.scope),
      run: (values, actor) => service.comment(actor, actor.scope, values.task_id, { body: values.body }),
      readback: (comment) => [{ type: "task", id: comment.task_id, label: "Comment added", status: "commented", link: taskLink(comment.task_id) }],
      labels: { task_id: "Task", body: "Comment" },
    },
  ],
  // Every other Create schema of this module's contract, and why the assistant does not offer it (gate 23).
  not_offered: {
    TaskStepCreate: "a step belongs to a task's own panel, where the person sees the task",
    TaskCommentCreate: "the panel's own comment form, which never names its task; the card is TaskCommentAdd",
    TaskDependencyCreate: "a dependency is set on the task's panel with both tasks in view",
    LateReasonCreate: "late reasons are Settings, set by Operations & People on the Tasks screen",
  },
  summaries: [
    {
      key: "tasks.summary",
      description: "Task counts for me or my team: open, overdue, due today or this week, done, by status, assignee, priority, due window or cadence",
      params: c.tasks.TaskCountsQuery,
      permission: ["workspace", "view"],
      run: (client, params, actor) => service.aiCounts(client, params, actor.scope),
    },
  ],
  reads: [
    {
      key: "tasks.list",
      description: "List tasks: status, due date, priority, who it is for and who set it; mine or my team's, overdue, due today or this week",
      params: c.tasks.TaskListQuery,
      permission: ["workspace", "view"],
      run: (_client, params, actor) => service.list(params, actor.scope),
      cite: (row) => ({ type: "task", id: row.task_id, label: `${row.number} ${row.title}` }),
    },
  ],
  routes: [
    { intent: "create a task", screen: "workspace.tasks", params: { new: "1" }, prefill: c.tasks.TaskPrefill },
    { intent: "set my commitments", screen: "workspace.tasks", params: { new: "1", commitment: "1" } },
    { intent: "see my tasks", screen: "workspace.tasks" },
  ],
});
