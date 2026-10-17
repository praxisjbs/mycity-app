"use strict";
/**
 * /api/v1/attendance (docs/guides/attendance.md §5).
 *
 * The person's own, `self`: answered for the session's employee, and nothing names
 * another (the `ess`-shaped own scope):
 *   GET   /me/today                      where I stand now
 *   POST  /punches                       clock in or out (Idempotency-Key required)
 *   GET   /me, /me/summary               my days and the month's figures
 *   GET   /me/events                     one of my days' punches
 *   GET   /me/exceptions                 my exceptions
 *   POST  /me/exceptions/:id/explanation say why
 *   POST  /me/export                     my month, emailed as a workbook
 *   GET   /me/records/:id                the day a link to my day or exception opens
 *
 * People, within the `people` grant's scope (all, team, own):
 *   GET   /register, /summary            the day's register and its figures (view)
 *   GET   /register/:employee_id         one person's day (view)
 *   GET   /events                        one person's punches on a day (view)
 *   GET   /exceptions                    the exceptions (view)
 *   POST  /exceptions/:id/decision       decide one (approve, scope all; never your own)
 *   GET   /records/:id                   the person and day a link opens (view)
 *   POST  /export                        the register over up to 31 days, emailed (export)
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./attendance.controller");

const router = express.Router();
const a = c.attendance;

route(router, "get", "/me/today",
  { response: a.AttendanceToday, self: true, summary: "Where I stand on the clock" },
  controller.today);

route(router, "post", "/punches",
  { body: a.PunchCreate, response: a.PunchResult, self: true, summary: "Clock in or out" },
  controller.punch);

route(router, "get", "/me",
  { query: a.MyDayListQuery, response: a.AttendanceDayPage, self: true, summary: "My attendance days" },
  controller.myDays);

route(router, "get", "/me/summary",
  { query: a.MySummaryQuery, response: a.MyAttendanceSummary, self: true, summary: "My month's figures" },
  controller.mySummary);

route(router, "get", "/me/events",
  { query: a.MyEventListQuery, response: a.AttendanceEventPage, self: true, summary: "My punches on a day" },
  controller.myEvents);

route(router, "get", "/me/exceptions",
  { query: a.MyExceptionListQuery, response: a.AttendanceExceptionPage, self: true,
    summary: "My attendance exceptions" },
  controller.myExceptions);

route(router, "post", "/me/exceptions/:id/explanation",
  { params: c.common.IdParams, body: a.ExceptionExplanation, response: a.AttendanceException, self: true,
    summary: "Explain one of my exceptions" },
  controller.explain);

route(router, "post", "/me/export",
  { body: a.MyExportRequest, response: a.AttendanceExportQueued, self: true, summary: "Email me my month" },
  controller.myExport);

route(router, "get", "/me/records/:id",
  { params: c.common.IdParams, response: a.AttendanceRecordRef, self: true,
    summary: "The day a link to my record opens" },
  controller.myRecord);

route(router, "get", "/register",
  { query: a.RegisterQuery, response: a.RegisterPage, summary: "The attendance register for a day" },
  requirePermission("people", "view"), controller.register);

route(router, "get", "/summary",
  { query: a.RegisterSummaryQuery, response: a.RegisterSummary, summary: "The register's figures" },
  requirePermission("people", "view"), controller.summary);

route(router, "get", "/register/:employee_id",
  { params: a.DayDetailParams, query: a.DayDetailQuery, response: a.DayDetail, summary: "One person's day" },
  requirePermission("people", "view"), controller.day);

route(router, "get", "/events",
  { query: a.EventListQuery, response: a.AttendanceEventPage, summary: "One person's punches on a day" },
  requirePermission("people", "view"), controller.events);

route(router, "get", "/exceptions",
  { query: a.ExceptionListQuery, response: a.AttendanceExceptionPage, summary: "Attendance exceptions" },
  requirePermission("people", "view"), controller.exceptions);

route(router, "post", "/exceptions/:id/decision",
  { params: c.common.IdParams, body: a.ExceptionDecision, response: a.AttendanceException,
    summary: "Decide an attendance exception" },
  requirePermission("people", "approve"), controller.decide);

route(router, "get", "/records/:id",
  { params: c.common.IdParams, response: a.AttendanceRecordRef, summary: "The day a link to a record opens" },
  requirePermission("people", "view"), controller.record);

route(router, "post", "/export",
  { body: a.RegisterExportRequest, response: a.AttendanceExportQueued, summary: "Email the register" },
  requirePermission("people", "export"), controller.export);

module.exports = { basePath: "/attendance", surface: "staff", router };
