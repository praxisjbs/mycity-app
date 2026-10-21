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
 *   POST  /me/events/:id/explanation     Give Real Time: the real leaving time of a System Clock-Out
 *   POST  /me/export                     my month as a workbook, downloaded where I asked (202)
 *   GET   /me/records/:id                the day a link to my day or exception opens
 *   GET   /me/home, POST /me/home        my home location, and a new one for People (remote)
 *   GET   /me/requests, POST /me/requests  my work location requests, and a new one (approval)
 *   GET   /me/requests/:id               one of mine
 *   POST  /me/requests/:id/cancel        withdraw or cancel one of mine
 *   GET   /me/field-assignments, /me/field-assignments/:id  the field assignments I am or was on
 *   GET   /me/schedule                   my work week (My Profile)
 *   GET   /me/pay-items                  my pending deductions and overtime for a month
 *
 * People, within the `people` grant's scope (all, team, own):
 *   GET   /register, /summary            the day's register and its figures (view)
 *   GET   /register/:employee_id         one person's day (view)
 *   GET   /events                        one person's punches on a day (view)
 *   GET   /exceptions                    the exceptions (view)
 *   POST  /exceptions/:id/decision       decide one (approve, scope all; never your own)
 *   GET   /records/:id                   the person and day a link opens (view)
 *   GET   /homes, /homes/:id             remote staff's home locations (view; the address
 *                                        and the point for scope all only)
 *   POST  /homes/:id/decision            approve or reject one (approve, scope all; never your own)
 *   GET   /requests, /requests/:id       work location requests (view); decided through the
 *                                        approval's own routes (/workflow/instances/:id/...)
 *   GET   /field-assignments, /field-assignments/:id  field assignments with someone in scope (view)
 *   POST  /field-assignments             send people out (approve, within scope; never yourself)
 *   POST  /field-assignments/:id/cancel  cancel one (approve, everyone still on it in scope)
 *   POST  /field-assignments/:id/remove  take one person off (approve, as cancel)
 *   GET   /schedules/:employee_id        a person's week, office and home state (view)
 *   POST  /schedules/:employee_id        set anyone's work schedule from a day (edit; never your own)
 *   GET   /pay-items                     pending deductions and overtime (view; amounts masked
 *                                        as the salary is)
 *   POST  /pay-items/waive               waive up to 25 deductions (approve, scope all; never your own)
 *   POST  /pay-items/:id/overtime        confirm or cut overtime (approve, within scope; never your own)
 *   POST  /overtime-approvals            approve overtime for a person's day beforehand (approve,
 *                                        within scope; never your own)
 *   POST  /export                        the register over up to 31 days as a workbook, downloaded
 *                                        where it was asked for (export; 202)
 *
 * The Attendance policy is read and changed through /policies (docs/guides/policies.md §5); the
 * clock reads its rules through policies.rulesFor (attendance.calendar.js).
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

route(router, "post", "/me/events/:id/explanation",
  { params: c.common.IdParams, body: a.RealTimeGiven, response: a.AttendanceException, self: true,
    summary: "Give the real time of one of my System Clock-Outs" },
  controller.explainAutomatic);

route(router, "post", "/me/export",
  { body: a.MyExportRequest, response: c.documents.ExportFile, self: true, summary: "Export my month" },
  controller.myExport);

route(router, "get", "/me/records/:id",
  { params: c.common.IdParams, response: a.AttendanceRecordRef, self: true,
    summary: "The day a link to my record opens" },
  controller.myRecord);

route(router, "get", "/me/home",
  { response: a.MyHome, self: true, summary: "My home location" },
  controller.myHome);

route(router, "post", "/me/home",
  { body: a.HomeRequestCreate, response: a.MyHome, self: true, summary: "Send my home location for approval" },
  controller.requestHome);

route(router, "get", "/me/requests",
  { query: a.MyLocationRequestListQuery, response: a.LocationRequestPage, self: true, summary: "My work location requests" },
  controller.myRequests);

route(router, "post", "/me/requests",
  { body: a.LocationRequestCreate, response: a.LocationRequest, self: true, summary: "Ask to work somewhere else for some days" },
  controller.requestLocation);

route(router, "get", "/me/requests/:id",
  { params: c.common.IdParams, response: a.LocationRequest, self: true, summary: "One of my work location requests" },
  controller.myRequest);

route(router, "post", "/me/requests/:id/cancel",
  { params: c.common.IdParams, body: a.LocationRequestCancel, response: a.LocationRequest, self: true,
    summary: "Withdraw or cancel one of my work location requests" },
  controller.cancelRequest);

route(router, "get", "/me/field-assignments",
  { query: a.MyFieldAssignmentListQuery, response: a.FieldAssignmentPage, self: true,
    summary: "The field assignments I am or was on" },
  controller.myAssignments);

route(router, "get", "/me/field-assignments/:id",
  { params: c.common.IdParams, response: a.FieldAssignment, self: true, summary: "One of my field assignments" },
  controller.myAssignment);

route(router, "get", "/me/schedule",
  { response: a.WorkSchedule, self: true, summary: "My work week" },
  controller.mySchedule);

route(router, "get", "/me/pay-items",
  { query: a.MyPayItemListQuery, response: a.PayItemPage, self: true, summary: "My deductions and overtime" },
  controller.myPayItems);

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

route(router, "get", "/homes",
  { query: a.HomeListQuery, response: a.HomeRequestPage, summary: "Remote staff's home locations" },
  requirePermission("people", "view"), controller.homes);

route(router, "get", "/homes/:id",
  { params: c.common.IdParams, response: a.HomeRequest, summary: "One home location" },
  requirePermission("people", "view"), controller.home);

route(router, "post", "/homes/:id/decision",
  { params: c.common.IdParams, body: a.HomeDecision, response: a.HomeRequest,
    summary: "Approve or reject a home location" },
  requirePermission("people", "approve"), controller.decideHome);

route(router, "get", "/requests",
  { query: a.LocationRequestListQuery, response: a.LocationRequestPage, summary: "Work location requests" },
  requirePermission("people", "view"), controller.requests);

route(router, "get", "/requests/:id",
  { params: c.common.IdParams, response: a.LocationRequest, summary: "One work location request" },
  requirePermission("people", "view"), controller.request);

route(router, "get", "/field-assignments",
  { query: a.FieldAssignmentListQuery, response: a.FieldAssignmentPage, summary: "Field assignments" },
  requirePermission("people", "view"), controller.assignments);

route(router, "get", "/field-assignments/:id",
  { params: c.common.IdParams, response: a.FieldAssignment, summary: "One field assignment" },
  requirePermission("people", "view"), controller.assignment);

route(router, "post", "/field-assignments",
  { body: a.FieldAssignmentCreate, response: a.FieldAssignment, summary: "Send people out on a field assignment" },
  requirePermission("people", "approve"), controller.assign);

route(router, "post", "/field-assignments/:id/cancel",
  { params: c.common.IdParams, body: a.FieldAssignmentCancel, response: a.FieldAssignment,
    summary: "Cancel a field assignment" },
  requirePermission("people", "approve"), controller.cancelAssignment);

route(router, "post", "/field-assignments/:id/remove",
  { params: c.common.IdParams, body: a.FieldMemberRemove, response: a.FieldAssignment,
    summary: "Take someone off a field assignment" },
  requirePermission("people", "approve"), controller.removeFromAssignment);

route(router, "get", "/schedules/:employee_id",
  { params: a.ScheduleParams, response: a.WorkSchedule, summary: "A person's work week" },
  requirePermission("people", "view"), controller.schedule);

route(router, "post", "/schedules/:employee_id",
  { params: a.ScheduleParams, body: a.WorkScheduleSet, response: a.WorkSchedule,
    summary: "Set someone's work schedule from a day" },
  requirePermission("people", "edit"), controller.setSchedule);

route(router, "get", "/pay-items",
  { query: a.PayItemListQuery, response: a.PayItemPage, summary: "Pending deductions and overtime" },
  requirePermission("people", "view"), controller.payItems);

route(router, "post", "/pay-items/waive",
  { body: a.PayItemWaive, response: a.PayItemBatchResult, summary: "Waive deductions" },
  requirePermission("people", "approve"), controller.waive);

route(router, "post", "/pay-items/:id/overtime",
  { params: c.common.IdParams, body: a.OvertimeDecision, response: a.PayItem, summary: "Confirm or cut overtime" },
  requirePermission("people", "approve"), controller.decideOvertime);

route(router, "post", "/overtime-approvals",
  { body: a.OvertimePreApprovalCreate, response: a.OvertimePreApproval, summary: "Approve overtime beforehand" },
  requirePermission("people", "approve"), controller.approveOvertime);

route(router, "post", "/export",
  { body: a.RegisterExportRequest, response: c.documents.ExportFile, summary: "Export the register" },
  requirePermission("people", "export"), controller.export);

module.exports = { basePath: "/attendance", surface: "staff", router };
