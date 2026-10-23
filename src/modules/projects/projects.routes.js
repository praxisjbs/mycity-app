"use strict";
/**
 * /api/v1/projects: My Workspace · Projects (docs/guides/workspace.md §5).
 *
 *   GET   /, /:id    `workspace` view: every project, with the tasks in it the reader can see
 *   POST  /          `workspace` create: the caller owns it
 *   PATCH /:id       `workspace` edit: its owner, or a grant that reaches everyone (the service decides)
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./projects.controller");

const router = express.Router();
const p = c.projects;
const one = { params: c.common.IdParams };

route(router, "get", "/",
  { query: p.ProjectListQuery, response: p.ProjectPage, summary: "Every project" },
  requirePermission("workspace", "view"), controller.list);

route(router, "get", "/:id",
  { ...one, response: p.Project, summary: "One project" },
  requirePermission("workspace", "view"), controller.get);

route(router, "post", "/",
  { body: p.ProjectCreate, response: p.Project, summary: "Start a project" },
  requirePermission("workspace", "create"), controller.create);

route(router, "patch", "/:id",
  { ...one, body: p.ProjectEdit, response: p.Project, summary: "Change, complete or reopen a project" },
  requirePermission("workspace", "edit"), controller.edit);

module.exports = { basePath: "/projects", surface: "staff", router };
