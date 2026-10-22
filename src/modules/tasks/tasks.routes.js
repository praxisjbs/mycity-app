"use strict";
/**
 * /api/v1/tasks: My Workspace · Tasks (docs/guides/workspace.md §5).
 *
 *   GET   /, /summary, /:id                 `workspace` view: the board, its figures, a task
 *   POST  /                                 `workspace` create: for oneself, or someone in scope (A24)
 *   PATCH /:id                              `workspace` edit: the setter's fields, or the assignee's notes
 *   POST  /:id/move                         `workspace` edit: a drag between and within columns
 *   POST  /:id/block, /:id/unblock          `workspace` edit
 *   POST  /:id/cancel                       `workspace` edit: whoever manages the task
 *   GET   /:id/comments, POST /:id/comments `workspace` view: anyone who can see the task
 *   GET   /:id/activity                     `workspace` view: the task's history
 *   GET   /:id/blockages                    `workspace` view: the task's holds
 *   POST  /:id/steps, PATCH|DELETE /:id/steps/:child_id   `workspace` edit: steps (ticking is open
 *                                           to anyone who can see the task; the service decides)
 *   POST  /:id/waiting-on, DELETE /:id/waiting-on/:child_id, POST …/override   `workspace` edit
 *   POST  /:id/watchers, DELETE /:id/watchers/:child_id   `workspace` view: watch, stop watching
 *   POST  /:id/ping                         `workspace` view: nudge the assignee or the watchers
 *   PUT   /:id/reminders                    `workspace` edit: up to three reminders
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./tasks.controller");

const router = express.Router();
const t = c.tasks;
const one = { params: c.common.IdParams };
const two = { params: t.TaskChildParams };

route(router, "get", "/",
  { query: t.TaskListQuery, response: t.TaskPage, summary: "Tasks, one column or list at a time" },
  requirePermission("workspace", "view"), controller.list);

route(router, "get", "/summary",
  { query: t.TaskSummaryQuery, response: t.TaskSummary, summary: "The figures above the board" },
  requirePermission("workspace", "view"), controller.summary);

route(router, "get", "/:id",
  { ...one, response: t.TaskDetail, summary: "One task, and what the caller may do to it" },
  requirePermission("workspace", "view"), controller.get);

route(router, "post", "/",
  { body: t.TaskCreate, response: t.Task, summary: "Set a task" },
  requirePermission("workspace", "create"), controller.create);

route(router, "patch", "/:id",
  { ...one, body: t.TaskEdit, response: t.Task, summary: "Change a task" },
  requirePermission("workspace", "edit"), controller.edit);

route(router, "post", "/:id/move",
  { ...one, body: t.TaskMove, response: t.Task, summary: "Move a task on the board" },
  requirePermission("workspace", "edit"), controller.move);

route(router, "post", "/:id/block",
  { ...one, body: t.TaskBlock, response: t.Task, summary: "Mark a task blocked" },
  requirePermission("workspace", "edit"), controller.block);

route(router, "post", "/:id/unblock",
  { ...one, body: t.TaskUnblock, response: t.Task, summary: "Clear a task's blocker" },
  requirePermission("workspace", "edit"), controller.unblock);

route(router, "get", "/:id/blockages",
  { ...one, query: t.TaskBlockageListQuery, response: t.TaskBlockagePage, summary: "A task's holds" },
  requirePermission("workspace", "view"), controller.blockages);

route(router, "post", "/:id/steps",
  { ...one, body: t.TaskStepCreate, response: t.TaskStep, summary: "Add a step" },
  requirePermission("workspace", "edit"), controller.addStep);

route(router, "patch", "/:id/steps/:child_id",
  { ...two, body: t.TaskStepEdit, response: t.TaskStep, summary: "Change, tick or untick a step" },
  requirePermission("workspace", "edit"), controller.editStep);

route(router, "delete", "/:id/steps/:child_id",
  { ...two, response: t.TaskDetail, summary: "Remove a step" },
  requirePermission("workspace", "edit"), controller.removeStep);

route(router, "post", "/:id/waiting-on",
  { ...one, body: t.TaskDependencyCreate, response: t.TaskDetail, summary: "Wait on another task" },
  requirePermission("workspace", "edit"), controller.addWaiting);

route(router, "delete", "/:id/waiting-on/:child_id",
  { ...two, response: t.TaskDetail, summary: "Stop waiting on a task" },
  requirePermission("workspace", "edit"), controller.removeWaiting);

route(router, "post", "/:id/waiting-on/:child_id/override",
  { ...two, body: t.TaskDependencyOverride, response: t.TaskDetail, summary: "Go ahead without a task" },
  requirePermission("workspace", "edit"), controller.overrideWaiting);

route(router, "post", "/:id/watchers",
  { ...one, body: t.TaskWatcherAdd, response: t.TaskDetail, summary: "Watch a task" },
  requirePermission("workspace", "view"), controller.watch);

route(router, "delete", "/:id/watchers/:child_id",
  { ...two, response: t.TaskDetail, summary: "Stop watching a task" },
  requirePermission("workspace", "view"), controller.unwatch);

route(router, "post", "/:id/ping",
  { ...one, body: t.TaskPing, response: t.Task, summary: "Nudge the people on a task" },
  requirePermission("workspace", "view"), controller.ping);

route(router, "put", "/:id/reminders",
  { ...one, body: t.TaskReminderSet, response: t.TaskDetail, summary: "Set a task's reminders" },
  requirePermission("workspace", "edit"), controller.setReminders);

route(router, "post", "/:id/cancel",
  { ...one, body: t.TaskCancel, response: t.Task, summary: "Cancel a task" },
  requirePermission("workspace", "edit"), controller.cancel);

route(router, "get", "/:id/comments",
  { ...one, query: t.TaskCommentListQuery, response: t.TaskCommentPage, summary: "A task's comments" },
  requirePermission("workspace", "view"), controller.comments);

route(router, "post", "/:id/comments",
  { ...one, body: t.TaskCommentCreate, response: t.TaskComment, summary: "Comment on a task" },
  requirePermission("workspace", "view"), controller.comment);

route(router, "get", "/:id/activity",
  { ...one, query: t.TaskActivityListQuery, response: t.TaskActivityPage, summary: "A task's history" },
  requirePermission("workspace", "view"), controller.activity);

module.exports = { basePath: "/tasks", surface: "staff", router };
