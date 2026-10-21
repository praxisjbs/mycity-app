"use strict";
/**
 * /api/v1/calendar: My Workspace · Calendar (docs/guides/workspace.md §5).
 *
 *   GET   /?month=YYYY-MM        `workspace` view: the caller's month
 *   GET   /:id                   `workspace` view: an event they own, are invited to, or that is open to all
 *   POST  /                      `workspace` create: a new event, with attendees
 *   PATCH /:id, POST /:id/cancel `workspace` edit: the owner only
 *   POST  /:id/respond           `workspace` view: an attendee answers
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./calendar.controller");

const router = express.Router();
const k = c.calendar;
const one = { params: c.common.IdParams };

route(router, "get", "/",
  { query: k.CalendarListQuery, response: k.CalendarItemPage, summary: "The caller's month" },
  requirePermission("workspace", "view"), controller.month);

route(router, "get", "/:id",
  { ...one, response: k.CalendarEvent, summary: "One event" },
  requirePermission("workspace", "view"), controller.get);

route(router, "post", "/",
  { body: k.CalendarEventCreate, response: k.CalendarEvent, summary: "Add an event" },
  requirePermission("workspace", "create"), controller.create);

route(router, "patch", "/:id",
  { ...one, body: k.CalendarEventEdit, response: k.CalendarEvent, summary: "Change an event" },
  requirePermission("workspace", "edit"), controller.edit);

route(router, "post", "/:id/cancel",
  { ...one, body: c.common.EmptyBody, response: k.CalendarEvent, summary: "Call off an event" },
  requirePermission("workspace", "edit"), controller.cancel);

route(router, "post", "/:id/respond",
  { ...one, body: k.CalendarRespond, response: k.CalendarEvent, summary: "Answer an invitation" },
  requirePermission("workspace", "view"), controller.respond);

module.exports = { basePath: "/calendar", surface: "staff", router };
