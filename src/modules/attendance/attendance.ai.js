"use strict";
/**
 * What the assistant may read about attendance (docs/guides/attendance.md §9):
 *
 *   attendance.my_days      the asker's own days of a month (anyone; their own only)
 *   attendance.register     a day's register, within the asker's `people` scope
 *   attendance.exceptions   the exceptions, within the same scope
 *   attendance.my_pay_items the asker's own deductions and overtime of a month (anyone; their own only)
 *   attendance.pay_items    the deductions and overtime, within the asker's `people` scope; their
 *                           amounts are masked as the salary is, as every assistant read is masked
 *                           (shared/ai/authorise.js)
 *   attendance.temporary_sites  temporary sites with someone in the asker's `people` scope on
 *                           them (PR 4): number, purpose, name, dates, state and who is on them;
 *                           never an address, a point or a description
 *   attendance.summary      figures over a period, never rows (docs/guides/praxis-ai.md §6.13): days,
 *                           late days and minutes, absences, exceptions, by person, department or
 *                           site, or by day, week or month; the asker's `people` scope
 *
 * The Attendance policy's rules are read through policies.read and policies.mine
 * (src/modules/policies/policies.ai.js).
 *
 * Every read is a page of 25 through the same service and scope as the screen. A row
 * carries the day, the times, the status and the worksite's name: never a coordinate,
 * a device identifier or the evidence behind a punch. The assistant never clocks
 * anyone in, decides an exception, waives a deduction, confirms overtime or guesses a missing
 * location (A23); it sends the person to the screen that does. A home location is never read: its address and point are
 * personal data, so the assistant only sends people to where homes are set and approved; a work
 * location request is never read either (its address can be a home).
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./attendance.service");
const pay = require("./attendance.pay");
const sites = require("./attendance.sites");

/** A temporary site as the assistant reads it: no address, point or description (§6.11, §9). */
const siteForAi = (s) => ({
  temporary_site_id: s.temporary_site_id,
  number: s.number,
  purpose: s.purpose,
  name: s.name,
  starts_on: s.starts_on,
  ends_on: s.ends_on,
  days: s.days,
  state: s.state,
  people: s.members.filter((m) => !m.removed_at).map((m) => m.employee.display_name),
});

const EMPTY = { data: [], page: { number: 1, size: 25, total: 0, pages: 0, has_next: false } };

/**
 * The matrix's scope probes (docs/guides/praxis-ai.md §6.17): today's register lists everyone in the
 * asker's `people` scope, punched or not, so it must carry a report of theirs (else themselves) and
 * never an outsider.
 */
const registerProbe = {
  inside: (ctx) => ({ type: "employee", id: ctx.report ? ctx.report.employee_id : ctx.actor.employee_id }),
  outside: (ctx) => ({ type: "employee", id: ctx.outsider.employee_id }),
};

module.exports = defineManifest({
  module: "people",
  // Every Create schema of this module's contract, and why the assistant does not offer it (gate 23).
  not_offered: {
    CheckInCreate: "a check-in is a punch from the person's own device at the site, with its time and place; never typed",
    HomeRequestCreate: "a home location is an address and a point, personal data the assistant never reads or writes",
    OvertimePreApprovalCreate: "overtime is pre-approved on People, Attendance with the day's roster in view",
    PunchCreate: "a clock-in is made on the device at the worksite, with its location and time",
    TemporarySiteCreate: "a temporary site's addresses are picked on a map, never typed, on Work Location Requests",
  },
  summaries: [
    {
      key: "attendance.summary",
      description: "Attendance figures over a period: days present, late days and minutes late, absences and exceptions, by person, department or site, or by day, week or month",
      params: c.attendance.AttendanceSummaryQuery,
      permission: ["people", "view"],
      run: (client, params, actor) => service.aiSummary(client, params, actor.scope),
    },
  ],
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
      matrix: registerProbe,
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
    {
      key: "attendance.my_pay_items",
      description: "List my own attendance deductions and overtime for a month: the day, the minutes and whether it is pending, waived, confirmed or cut",
      params: c.attendance.MyPayItemListQuery,
      permission: ["ess", "view"],
      run: (_client, params, actor) => (actor.employee_id ? pay.mine(actor, params) : EMPTY),
      cite: (row) => ({ type: "attendance_pay_item", id: row.attendance_pay_item_id, label: row.work_date }),
    },
    {
      key: "attendance.pay_items",
      description: "List attendance deductions and overtime waiting on People or decided: late, early departure, absence and overtime by person and day",
      params: c.attendance.PayItemListQuery,
      permission: ["people", "view"],
      run: (_client, params, actor) => pay.list(actor, params, actor.scope),
      cite: (row) => ({
        type: "attendance_pay_item",
        id: row.attendance_pay_item_id,
        label: `${row.employee.display_name}, ${row.work_date}`,
      }),
    },
    {
      key: "attendance.temporary_sites",
      description: "List temporary sites people work at for some days (client visits, trainings, events): number, purpose, dates, state and who is on them",
      params: c.attendance.TemporarySiteListQuery,
      permission: ["people", "view"],
      run: async (_client, params, actor) => {
        const page = await sites.list(actor, params, actor.scope);
        return { ...page, data: page.data.map(siteForAi) };
      },
      cite: (row) => ({ type: "attendance_temporary_site", id: row.temporary_site_id, label: `${row.number} · ${row.name}` }),
    },
  ],
  routes: [
    { intent: "clock in or out", screen: "ess.my-attendance" },
    { intent: "see my attendance", screen: "ess.my-attendance" },
    { intent: "review attendance", screen: "people.attendance" },
    // These two only while the policy's Home Location is on (§1.3): the assistant (M10) asks
    // attendance.home onDate before offering them; nothing reads the routes before then.
    { intent: "set my home location", screen: "ess.my-attendance" },
    { intent: "approve home locations", screen: "people.attendance" },
    // Add Work Site is that screen's own action; a manifest carries no action of its own (A23).
    { intent: "work somewhere else for some days", screen: "ess.work-location-requests" },
    { intent: "approve a temporary site", screen: "people.worksites" },
    { intent: "see my temporary sites", screen: "ess.work-location-requests" },
    { intent: "approve work location requests", screen: "people.worksites" },
    { intent: "see my field assignments", screen: "ess.my-attendance" },
    { intent: "set someone's work schedule", screen: "people.employees" },
    { intent: "see my deductions or overtime", screen: "ess.my-attendance" },
    { intent: "waive deductions or confirm overtime", screen: "people.attendance" },
    { intent: "see my work week", screen: "ess.my-profile" },
    { intent: "read or acknowledge the attendance policy", screen: "ess.policy-updates" },
  ],
});
