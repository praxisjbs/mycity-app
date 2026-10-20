"use strict";
/**
 * What the assistant may read about attendance (docs/guides/attendance.md §9):
 *
 *   attendance.my_days      the asker's own days of a month (anyone; their own only)
 *   attendance.register     a day's register, within the asker's `people` scope
 *   attendance.exceptions   the exceptions, within the same scope
 *
 * The Attendance policy's rules are read through policies.read and policies.mine
 * (src/modules/policies/policies.ai.js).
 *
 * Every read is a page of 25 through the same service and scope as the screen. A row
 * carries the day, the times, the status and the worksite's name: never a coordinate,
 * a device identifier or the evidence behind a punch. The assistant never clocks
 * anyone in, decides an exception or guesses a missing location (A23); it sends the
 * person to the screen that does. A home location is never read: its address and point are
 * personal data, so the assistant only sends people to where homes are set and approved; a work
 * location request is never read either (its address can be a home).
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./attendance.service");

const EMPTY = { data: [], page: { number: 1, size: 25, total: 0, pages: 0, has_next: false } };

module.exports = defineManifest({
  module: "people",
  reads: [
    {
      key: "attendance.my_days",
      description: "List my own attendance days for a month: clock in, clock out, hours, lateness and status",
      params: c.attendance.MyDayListQuery,
      permission: ["ess", "view"],
      run: (_client, params, actor) => (actor.employee_id ? service.myDays(actor, params) : EMPTY),
      cite: (row) => ({ type: "attendance_record", id: row.attendance_day_id, label: row.attendance_date }),
    },
    {
      key: "attendance.register",
      description: "List who is present, late, absent, on leave or not in on a day, with their clock times",
      params: c.attendance.RegisterQuery,
      permission: ["people", "view"],
      run: (_client, params, actor) => service.register(params, actor.scope),
      cite: (row) => ({
        type: "employee",
        id: row.employee.employee_id,
        label: `${row.employee.display_name}, ${row.date}`,
      }),
    },
    {
      key: "attendance.exceptions",
      description: "List attendance exceptions waiting for review or decided: outside the worksite, unknown device, missing clock-out",
      params: c.attendance.ExceptionListQuery,
      permission: ["people", "view"],
      run: (_client, params, actor) => service.exceptions(params, actor.scope),
      cite: (row) => ({
        type: "attendance_exception",
        id: row.attendance_exception_id,
        label: `${row.employee.display_name}, ${row.work_date}`,
      }),
    },
  ],
  routes: [
    { intent: "clock in or out", screen: "ess.my-attendance" },
    { intent: "see my attendance", screen: "ess.my-attendance" },
    { intent: "review attendance", screen: "people.attendance" },
    { intent: "set my home location", screen: "ess.my-attendance" },
    { intent: "approve home locations", screen: "people.attendance" },
    { intent: "ask for a work location", screen: "ess.work-location-requests" },
    { intent: "approve work location requests", screen: "people.attendance" },
    { intent: "send people out on a field assignment", screen: "people.attendance" },
    { intent: "see my field assignments", screen: "ess.my-attendance" },
    { intent: "set a hybrid employee's office days", screen: "people.employees" },
    { intent: "see my work week", screen: "ess.my-profile" },
    { intent: "read or acknowledge the attendance policy", screen: "ess.policy-updates" },
  ],
});
