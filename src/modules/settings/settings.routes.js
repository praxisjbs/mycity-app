"use strict";
/**
 * /api/v1/settings: Organisation, Roles & Permissions, Documents & Numbering and
 * Security. Reading needs `settings` view; a change needs create, edit or delete as
 * it says. Users (/users) and Approvals (workflow) are served by their own modules.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./settings.controller");

const router = express.Router();
const view = requirePermission("settings", "view");
const create = requirePermission("settings", "create");
const edit = requirePermission("settings", "edit");
const remove = requirePermission("settings", "delete");

/* Organisation */

route(router, "get", "/organisation",
  { response: c.settings.Organisation, summary: "The organisation profile" },
  view, controller.organisation);

route(router, "patch", "/organisation",
  { body: c.settings.OrganisationPatch, response: c.settings.Organisation, summary: "Change the organisation profile" },
  edit, controller.updateOrganisation);

route(router, "get", "/working-week",
  { response: c.settings.WorkingWeek, summary: "The working week, Monday to Sunday" },
  view, controller.week);

route(router, "put", "/working-week",
  { body: c.settings.WorkingWeekSave, response: c.settings.WorkingWeek, summary: "Set the working week" },
  edit, controller.saveWeek);

route(router, "get", "/holidays",
  { query: c.settings.HolidayListQuery, response: c.settings.HolidayPage, summary: "Public holidays" },
  view, controller.holidays);

route(router, "post", "/holidays",
  { body: c.settings.HolidaySave, response: c.settings.Holiday, summary: "Add a public holiday" },
  create, controller.addHoliday);

route(router, "patch", "/holidays/:id",
  { body: c.settings.HolidaySave, response: c.settings.Holiday, summary: "Change a public holiday" },
  edit, controller.updateHoliday);

route(router, "delete", "/holidays/:id",
  { no_content: true, summary: "Remove a public holiday" },
  remove, controller.removeHoliday);

/* Roles & Permissions */

route(router, "get", "/roles",
  { query: c.access.RoleRowListQuery, response: c.access.RoleRowPage, summary: "Roles with what each grants" },
  view, controller.roles);

route(router, "get", "/roles/catalogue",
  { response: c.access.AccessCatalogue, summary: "What a role can be given" },
  view, controller.catalogue);

route(router, "get", "/roles/matrix",
  { response: c.access.RoleMatrix, summary: "Every role against every module" },
  view, controller.matrix);

route(router, "get", "/roles/:id",
  { response: c.access.RoleDetail, summary: "One role: grants, fields and capabilities" },
  view, controller.role);

route(router, "post", "/roles",
  { body: c.access.RoleSave, response: c.access.RoleDetail, summary: "Create a role" },
  create, controller.createRole);

route(router, "put", "/roles/:id",
  { body: c.access.RoleSave, response: c.access.RoleDetail, summary: "Save a role" },
  edit, controller.updateRole);

route(router, "delete", "/roles/:id",
  { no_content: true, summary: "Delete a role nobody holds" },
  remove, controller.deleteRole);

/* Documents & Numbering */

route(router, "get", "/numbering",
  { query: c.settings.NumberingListQuery, response: c.settings.NumberingPage, summary: "Numbering schemes" },
  view, controller.schemes);

route(router, "get", "/numbering/summary",
  { response: c.settings.NumberingSummary, summary: "Counts above the numbering list" },
  view, controller.numberingSummary);

route(router, "put", "/numbering/:doc_type",
  {
    params: c.settings.NumberingParams,
    body: c.settings.NumberingSchemeSave,
    response: c.settings.NumberingScheme,
    summary: "Change a numbering scheme",
  },
  edit, controller.saveScheme);

/* Security */

route(router, "get", "/security",
  { response: c.settings.SecurityPolicy, summary: "Security rules and figures" },
  view, controller.security);

route(router, "patch", "/security",
  { body: c.settings.SecurityPolicyPatch, response: c.settings.SecurityPolicy, summary: "Tighten the security rules" },
  edit, controller.updateSecurity);

route(router, "get", "/security/failed-logins",
  { query: c.settings.FailedSignInListQuery, response: c.settings.FailedSignInPage, summary: "Failed sign-ins" },
  view, controller.failedSignIns);

route(router, "get", "/security/sessions",
  { query: c.settings.LiveSessionListQuery, response: c.settings.LiveSessionPage, summary: "Everyone's live sessions" },
  view, controller.sessions);

route(router, "post", "/security/sessions/:id/end",
  { body: c.common.EmptyBody, no_content: true, summary: "End someone's session" },
  edit, controller.endSession);

module.exports = { basePath: "/settings", surface: "staff", router };
