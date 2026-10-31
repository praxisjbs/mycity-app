"use strict";
/**
 * /api/v1/users: Settings · Users. Reading needs `settings` view; inviting needs
 * create; everything that changes a login (roles, suspension, links, sessions, two-step)
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

/* Every invited login nobody has sent an invitation to yet: the roster makes them with no email. */
route(router, "post", "/invite-pending",
  { body: c.common.EmptyBody, response: c.users.InvitesSent, summary: "Send every invitation not sent yet" },
  edit, limits.adminLinkLimiter, controller.invitePending);

route(router, "get", "/:id",
  { response: c.users.UserRow, summary: "One login" },
  view, controller.get);

route(router, "post", "/:id/invite",
  { body: c.common.EmptyBody, response: c.users.LinkSent, summary: "Send the invitation again" },
  edit, limits.adminLinkLimiter, controller.resendInvite);

/* A login in use moves to its employee's corrected work email only on purpose, after a fresh sign-in. */
route(router, "post", "/:id/use-work-email",
  { body: c.common.EmptyBody, response: c.users.UserRow, summary: "Sign in with the employee's work email" },
  edit, controller.useWorkEmail);

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
  edit, limits.adminLinkLimiter, controller.sendResetLink);

route(router, "post", "/:id/end-sessions",
  { body: c.common.EmptyBody, response: c.users.UserSessionsEnded, summary: "Sign a login out everywhere" },
  edit, controller.endSessions);

route(router, "post", "/:id/reset-two-step",
  { body: c.common.EmptyBody, response: c.users.UserRow, summary: "Reset a login's two-step sign-in" },
  edit, controller.resetTwoStep);

module.exports = { basePath: "/users", surface: "staff", router };
