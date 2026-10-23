"use strict";
/**
 * ⌘K for tasks: a task found by its number or title, among the tasks led by the people in
 * the reader's `workspace` scope and the tasks the reader set or shares, as the board lists them;
 * a commitment is a task, found the same way. A result opens the task on My Workspace · Tasks
 * (shared/route-map.js task).
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "task",
  module: "workspace",
  label: "Tasks",
  words: ["tasks", "to do", "todo", "commitment", "commitments"],
  from: "task t",
  key: "t.task_id",
  columns: ["t.number", "t.title"],
  select: "t.task_id AS id, t.number::text AS ref, t.title AS title, NULL::text AS sub, t.status AS status",
  where: "t.archived_at IS NULL",
  order: "t.created_at DESC",
  scope: {
    column: "t.primary_assignee_id",
    named: {
      through: `(SELECT t.set_by_employee_id AS employee_id
                  UNION ALL SELECT ta.employee_id FROM task_assignee ta WHERE ta.task_id = t.task_id) n WHERE true`,
      column: "n.employee_id",
    },
  },
});
