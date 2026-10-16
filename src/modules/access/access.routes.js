"use strict";
/**
 * /api/v1/access: roles. Editing what a role grants is Settings · Roles &
 * Permissions (M9); this milestone lists them for the Users screen.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./access.controller");

const router = express.Router();

route(router, "get", "/roles",
  { query: c.access.RoleListQuery, response: c.access.RolePage, summary: "Roles, most senior first" },
  requirePermission("settings", "view"), controller.roles);

module.exports = { basePath: "/access", surface: "staff", router };
