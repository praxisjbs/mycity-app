"use strict";
/**
 * ⌘K for tasks: a task found by its number or title, among the tasks of the people in
 * the reader's `workspace` scope, as the board lists them. A result opens the task on
 * My Workspace · Tasks (shared/route-map.js task).
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "task",
  module: "workspace",
  label: "Tasks",
  words: ["tasks", "to do", "todo"],
  from: "task t",
  key: "t.task_id",
  columns: ["t.number", "t.title"],
  select: "t.task_id AS id, t.number::text AS ref, t.title AS title, NULL::text AS sub, t.status AS status",
  where: "t.archived_at IS NULL",
  order: "t.created_at DESC",
  scope: { column: "t.primary_assignee_id" },
});
