"use strict";
/**
 * What the assistant may read about tasks: the board within the asker's own
 * `workspace` scope (their own, and their reporting line's for a manager), one page of
 * 25 at a time. It never sets, moves or cancels a task (A23); it
 * sends the person to New Task with the title filled in.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./tasks.service");

module.exports = defineManifest({
  module: "workspace",
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
