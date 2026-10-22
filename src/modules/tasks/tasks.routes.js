"use strict";
/**
 * /api/v1/tasks: My Workspace · Tasks (docs/guides/workspace.md §5).
 *
 *   GET   /, /summary, /:id                 `workspace` view: the board, its figures, a task
 *   GET   /counts-towards                   `workspace` view: the assignee's lines and key results
 *   POST  /                                 `workspace` create: for oneself, or someone in scope (A24)
 *   PATCH /:id                              `workspace` edit: the setter's fields, or the assignee's notes
 *   POST  /:id/move                         `workspace` edit: a drag between and within columns
 *   POST  /:id/block, /:id/unblock          `workspace` edit
 *   POST  /:id/cancel                       `workspace` edit: whoever manages the task
 *   GET   /:id/comments, POST /:id/comments `workspace` view: anyone who can see the task
 *   GET   /:id/activity                     `workspace` view: the task's history
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./tasks.controller");

const router = express.Router();
const t = c.tasks;
const one = { params: c.common.IdParams };

route(router, "get", "/",
  { query: t.TaskListQuery, response: t.TaskPage, summary: "Tasks, one column or list at a time" },
  requirePermission("workspace", "view"), controller.list);

route(router, "get", "/summary",
  { query: t.TaskSummaryQuery, response: t.TaskSummary, summary: "The figures above the board" },
  requirePermission("workspace", "view"), controller.summary);

route(router, "get", "/counts-towards",
  { query: t.CountsTowardsQuery, response: t.CountsTowardsPage, summary: "The scorecard lines and key results a task may count towards" },
  requirePermission("workspace", "view"), controller.countsTowards);

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
  { ...one, body: c.common.EmptyBody, response: t.Task, summary: "Clear a task's blocker" },
  requirePermission("workspace", "edit"), controller.unblock);

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
