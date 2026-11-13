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
 * a device identifier or the evidence behind a punch. As cards the person confirms
 * (docs/guides/praxis-ai.md §6.11, decision 33), two of its forms: Approve Overtime beforehand for
 * someone in the reader's reach (risk approval: it decides pay), and Add Work Site for the person
 * and colleagues, for approval, its one address picked as every address is (F27: our search signs
 * the one place the words find, else the person picks it). The assistant never clocks anyone in,
 * decides an exception, waives a deduction, confirms overtime worked or guesses a missing location
 * (A23); it sends the person to the screen that does. A home location is never read or written: its
 * address and point are personal data, so a card never makes a Temporary Home and the assistant only
 * sends people to where homes are set and approved; a work location request is never read either
 * (its address can be a home).
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const { parseBody } = require("../../shared/http/validate");
const routeMap = require("../../shared/route-map");
const maps = require("../maps/maps.service");
const people = require("../organisation/organisation.cards");
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

/** A day as a person reads it, day first. */
const dayFirst = (iso) => String(iso).split("-").reverse().join("/");

/**
 * The matrix's probes for Approve Overtime (praxis-ai.md §6.17): a report of the asker's is in
 * their reach and the outsider never is; a card naming the outsider is refused by its own check.
 */
const overtimeFor = (ctx, who) => ({ type: "employee", id: who.employee_id, values: { employee_id: who.employee_id, work_date: ctx.freshDay(), minutes: 60, reason: "An evening stock count for the matrix" } });
const overtimeProbe = {
  inside: (ctx) => (ctx.report ? overtimeFor(ctx, ctx.report) : null),
  outside: (ctx) => overtimeFor(ctx, ctx.outsider),
};

/** Add Work Site's request from the card: its one address as the only location (TemporarySiteCreate). */
function siteBody(values) {
  const { address, location_name: label, radius_m: radius, ...rest } = values;
  return { ...rest, locations: [{ address: { token: address }, ...(label ? { name: label } : {}), radius_m: radius }] };
}

module.exports = defineManifest({
  module: "people",
  actions: [
    {
      key: "overtime.approve",
      label: "Approve Overtime",
      matrix: overtimeProbe,
      description: "Approve overtime beforehand for someone I manage, on a day from today to 90 days ahead: the minutes and why. Paid only while the Attendance policy pays pre-approved overtime",
      input: c.attendance.OvertimePreApprovalCreate,
      permission: ["people", "approve"],
      // It decides pay: Confirm It's You first (JBS Praxis, 03/11/2026).
      risk: "approval",
      form: "none: Approve Overtime's sheet sits on a person's day and never names them; the card names the person and the day",
      fields: ["employee_id", "work_date", "minutes", "reason"],
      picks: { employee_id: "employee" },
      asks: [
        // Whose overtime, from People's register in the reader's reach (praxis-ai.md decision 34).
        { field: "employee_id", question: "Whose overtime is it?", read: "employees.list", params: { status: "active" } },
        { field: "work_date", question: "Which day?" },
        { field: "minutes", question: "How many minutes?", choices: ["60", "90", "120"] },
        { field: "reason", question: "Why is the overtime needed?" },
      ],
      // The person, named only when they are in the reader's reach: anyone else reads Pick one (decision 32).
      names: (values, actor, db) => pay.cardPerson(db, values.employee_id, actor.scope),
      records: (values, actor, db) => pay.cardPerson(db, values.employee_id, actor.scope),
      check: (client, values, actor) => pay.assertCardOvertime(client, values, actor),
      // The same function Approve Overtime's sheet calls: today to 90 days ahead, never one's own (§6.17).
      run: (values, actor) => pay.approveOvertime(actor, actor.scope, values),
      readback: (r) => [{ type: "employee", id: r.employee.employee_id, label: `${r.employee.display_name}, ${dayFirst(r.work_date)}`, status: "approved", link: routeMap.screenPath("people", "attendance") }],
      labels: { employee_id: "Person", work_date: "Day", minutes: "Minutes", reason: "Reason" },
    },
    {
      key: "temporary_sites.add",
      label: "Add Work Site",
      description: "Add a work site for me and colleagues for some days, for approval: the purpose, a name, what the work is, the first and last day, the hours, the address in words and who goes",
      input: c.attendance.TemporarySiteAdd,
      permission: ["ess", "create"],
      risk: "standard",
      form: "none: Add Work Site's sheet takes up to eight addresses, each picked on its map; the card takes one, picked the same way (TemporarySiteAdd)",
      fields: ["purpose", "name", "description", "starts_on", "ends_on", "hours", "starts_at", "ends_at", "address", "location_name", "radius_m", "employee_ids"],
      picks: { address: "place", employee_ids: "site_member" },
      // An address in words is the one place our search finds, signed; anything else is picked (F27).
      resolve: { address: (value) => maps.onePlace(value) },
      names: async (values, _actor, db) => [...maps.cardPlace(values.address), ...(await people.peopleNamed(db, values.employee_ids))],
      asks: [
        { field: "purpose", question: "What is the site for?", choices: ["Client Visit", "Training (Attending)", "Event", "Conference", "Field Survey", "Other"] },
        { field: "name", question: "What should the site be called?" },
        { field: "address", question: "Where is it?" },
        { field: "starts_on", question: "What is the first day?" },
        { field: "ends_on", question: "What is the last day?" },
        { field: "employee_ids", question: "Who goes?" },
        { field: "description", question: "What is the work there?" },
      ],
      // The same function Add Work Site's Submit for Approval calls, with the sheet's own request.
      run: (values, actor) => sites.submit(actor, parseBody(c.attendance.TemporarySiteCreate, siteBody(values))),
      readback: (site) => [{ type: "attendance_temporary_site", id: site.temporary_site_id, label: `${site.number} ${site.name}`, status: "sent for approval", link: (routeMap.linkFor("attendance_temporary_site", site.temporary_site_id, { self: true }) || {}).path || null }],
      labels: { purpose: "Purpose", name: "Name", description: "Description", starts_on: "First Day", ends_on: "Last Day", hours: "Hours", starts_at: "Starts", ends_at: "Ends", address: "Address", location_name: "Label", radius_m: "Radius", employee_ids: "People" },
    },
  ],
  // Every Create schema of this module's contract, and why the assistant does not offer it (gate 23).
  not_offered: {
    CheckInCreate: "device: a check-in is a punch from the person's own device at the site, with its time and place; never typed",
    HomeRequestCreate: "personal: a home location is an address and a point, personal data the assistant never reads or writes",
    PunchCreate: "device: a clock-in is made on the device at the worksite, with its location and time",
    TemporarySiteCreate: "via temporary_sites.add: Add Work Site's own request, up to eight addresses picked on its map; the card takes one, picked the same way, and never a home (TemporarySiteAdd)",
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
      summary: "attendance.summary",
      description:
        "List who is present, late, absent, on leave, off or not in on a day, with clock times. Not in: expected, not clocked in yet, the day still open; absent: the day closed with no clock-in",
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
    // Add Work Site is also a card (temporary_sites.add); the screen holds up to eight addresses.
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
