"use strict";
/**
 * What the assistant may read and do about tasks: the board within the asker's own
 * `workspace` scope (their own, and their reporting line's for a manager), one page of
 * 25 at a time; the board counted (tasks.summary: by status, assignee, priority, due window
 * or cadence; figures, never rows, docs/guides/praxis-ai.md §6.13); and, as a card the person
 * confirms (§6.11), setting a task through the same service function New Task's Create Task
 * calls. Moving, commenting and cancelling are PR4's; until then they are routes to the screen.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const routeMap = require("../../shared/route-map");
const service = require("./tasks.service");

module.exports = defineManifest({
  module: "workspace",
  actions: [
    {
      key: "tasks.create",
      description: "Set a task: a title, notes, priority, cadence, due day, and for a manager who it is for",
      input: c.tasks.TaskCreate,
      permission: ["workspace", "create"],
      risk: "standard",
      records: (values) => (values.primary_assignee_id ? [{ type: "employee", id: values.primary_assignee_id }] : []),
      // The same function the screen's Create Task calls, with the scope the grant gives (§6).
      run: (values, actor) => service.create(actor, actor.scope, values),
      readback: (task) => [{ type: "task", id: task.task_id, label: `${task.number} ${task.title}`, status: "created", link: (routeMap.linkFor("task", task.task_id) || {}).path || null }],
      labels: { title: "Title", description: "Notes", priority: "Priority", cadence: "Cadence", due_on: "Due Day", primary_assignee_id: "For", member_ids: "Shared With", department_id: "Department", project_id: "Project" },
    },
  ],
  // Every other Create schema of this module's contract, and why the assistant does not offer it (gate 23).
  not_offered: {
    TaskStepCreate: "a step belongs to a task's own panel, where the person sees the task",
    TaskCommentCreate: "a comment is written on the task's panel (PR4 offers tasks.comment)",
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
