"use strict";
/**
 * Who may see, set and change a task (A24; docs/guides/workspace.md §6).
 *
 * The workspace grant's scope is the whole rule, so nothing here reads a role:
 *  - a person may set a task for themselves, or for anyone in their scope (a line
 *    manager's reporting line, a head's department, everyone for `all`);
 *  - a person sees a task when its assignee is in their scope, or when they are its
 *    assignee, its setter or a co-assignee;
 *  - the setter manages a task (title, due day, cadence, assignee, who shares it,
 *    KPI, record, cancel), and so does anyone whose scope covers an assignee other
 *    than themselves; the assignee of a task someone else set (even with an `all`
 *    grant), and the people sharing a task, move it, change its priority and notes,
 *    block it and comment;
 *  - a shared task's people are anyone the caller may set a task for, and the
 *    caller's own department when they lead it (tasks.service shareWith).
 */
const { AppError } = require("../../shared/errors");

const inScope = (scope, employeeId) =>
  scope.scope === "all" || (Array.isArray(scope.scope_ids) && scope.scope_ids.includes(employeeId));

/** May the caller set a task for this employee? */
function maySetFor(scope, employeeId) {
  return employeeId === scope.employee_id || inScope(scope, employeeId);
}

/** 422 on the assignee when the caller may not set them work. */
function assertMaySetFor(scope, employeeId) {
  if (!maySetFor(scope, employeeId)) {
    throw new AppError(
      "VALIDATION_FAILED",
      "You can set tasks for yourself and the people who report to you",
      422,
      { primary_assignee_id: ["Not in your team"] },
    );
  }
}

/** May the caller see this task? `shared`: they are a co-assignee. */
function maySee(scope, task, shared) {
  const me = scope.employee_id;
  return (
    inScope(scope, task.primary_assignee_id) ||
    (me && (task.primary_assignee_id === me || task.set_by_employee_id === me)) ||
    Boolean(shared)
  );
}

/** May the caller manage it: change what the setter decided, or cancel it? */
function mayManage(scope, task) {
  const me = scope.employee_id;
  if (me && task.set_by_employee_id === me) return true;
  if (!task.set_by_employee_id && task.primary_assignee_id === me) return true;
  return task.primary_assignee_id !== me && inScope(scope, task.primary_assignee_id);
}

/** The fields only a manager of the task may change. */
const SETTER_FIELDS = Object.freeze([
  "title",
  "cadence",
  "due_on",
  "primary_assignee_id",
  "member_ids",
  "department_id",
  "employee_target_id",
  "entity_type",
  "entity_id",
  "recurrence",
]);

module.exports = { inScope, maySetFor, assertMaySetFor, maySee, mayManage, SETTER_FIELDS };
