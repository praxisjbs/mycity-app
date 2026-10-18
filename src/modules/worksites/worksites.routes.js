"use strict";
/**
 * /api/v1/worksites: People · Worksites (docs/guides/attendance.md §5, §6.5).
 *
 *   GET   /                 `people` view: the worksites, 25 a page
 *   GET   /:id              `people` view
 *   POST  /                 `people` create: add one
 *   PATCH /:id              `people` edit: change, retire (active false) or restore it
 *   GET   /:id/employees    `people` view: who is assigned, within the grant's scope
 *   POST  /:id/employees    `people` edit: assign someone (it moves them from another)
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./worksites.controller");

const router = express.Router();
const w = c.worksites;

route(router, "get", "/",
  { query: w.WorksiteListQuery, response: w.WorksitePage, summary: "Worksites" },
  requirePermission("people", "view"), controller.list);

route(router, "get", "/:id",
  { params: c.common.IdParams, response: w.Worksite, summary: "One worksite" },
  requirePermission("people", "view"), controller.get);

route(router, "post", "/",
  { body: w.WorksiteCreate, response: w.Worksite, summary: "Add a worksite" },
  requirePermission("people", "create"), controller.create);

route(router, "patch", "/:id",
  { params: c.common.IdParams, body: w.WorksiteUpdate, response: w.Worksite,
    summary: "Change, retire or restore a worksite" },
  requirePermission("people", "edit"), controller.update);

route(router, "get", "/:id/employees",
  { params: c.common.IdParams, query: c.common.PageQuery, response: w.WorksiteEmployeePage,
    summary: "Who works at a worksite" },
  requirePermission("people", "view"), controller.employees);

route(router, "post", "/:id/employees",
  { params: c.common.IdParams, body: w.WorksiteAssign, response: w.WorksiteEmployee,
    summary: "Assign someone to a worksite" },
  requirePermission("people", "edit"), controller.assign);

module.exports = { basePath: "/worksites", surface: "staff", router };
