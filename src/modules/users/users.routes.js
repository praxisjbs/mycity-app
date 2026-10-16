"use strict";
/**
 * /api/v1/users: Settings · Users. Reading needs `settings` view; inviting needs
 * create; everything that changes a login (roles, suspension, links, sessions)
 * needs edit. Nobody acts on their own login here: My Security is for that.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const limits = require("../../middleware/rate-limit");
const controller = require("./users.controller");

const router = express.Router();
const view = requirePermission("settings", "view");
const create = requirePermission("settings", "create");
const edit = requirePermission("settings", "edit");

route(router, "get", "/",
  { query: c.users.UserListQuery, response: c.users.UserPage, summary: "Logins" },
  view, controller.list);

route(router, "get", "/summary",
  { response: c.users.UsersSummary, summary: "Counts above the Users list" },
  view, controller.summary);

route(router, "get", "/candidates",
  { query: c.users.CandidateListQuery, response: c.users.CandidatePage, summary: "Employees with no login yet" },
  create, controller.candidates);

route(router, "post", "/",
  { body: c.users.UserInvite, response: c.users.UserRow, summary: "Invite an employee to sign in" },
  create, controller.invite);

route(router, "get", "/:id",
  { response: c.users.UserRow, summary: "One login" },
  view, controller.get);

route(router, "post", "/:id/invite",
  { body: c.common.EmptyBody, response: c.users.LinkSent, summary: "Send the invitation again" },
  edit, limits.forgotLimiter, controller.resendInvite);

route(router, "post", "/:id/roles",
  { body: c.users.UserRolesSet, response: c.users.UserRow, summary: "Set a login's roles" },
  edit, controller.setRoles);

route(router, "post", "/:id/suspend",
  { body: c.users.UserSuspend, response: c.users.UserRow, summary: "Suspend a login" },
  edit, controller.suspend);

route(router, "post", "/:id/reactivate",
  { body: c.common.EmptyBody, response: c.users.UserRow, summary: "Reactivate a login" },
  edit, controller.reactivate);

route(router, "post", "/:id/reset-link",
  { body: c.common.EmptyBody, response: c.users.LinkSent, summary: "Email a reset link" },
  edit, limits.forgotLimiter, controller.sendResetLink);

route(router, "post", "/:id/end-sessions",
  { body: c.common.EmptyBody, response: c.users.UserSessionsEnded, summary: "Sign a login out everywhere" },
  edit, controller.endSessions);

module.exports = { basePath: "/users", surface: "staff", router };
