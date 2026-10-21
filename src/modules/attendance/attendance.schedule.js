"use strict";
/**
 * Work schedules: the one write path for a person's own week, set by People from a date, and the
 * reads behind the employee record's Work Schedule tab, My Profile's week and Home's day strip
 * (docs/guides/attendance.md §6.13; TB's decisions of 20/10/2026, T7, T8).
 *
 *   set()      People with `people` edit, within their scope and never on their own record, set
 *              anyone's week from a first day: each weekday Working or Off, a working day's hours
 *              (or none, for the company hours) and Office or Remote. Checked against today in
 *              Lagos and the company hours in force on the first day (a blank working day on a
 *              weekday they do not work is refused); one from the same first day is replaced. The
 *              person is told; days already judged keep their judgement
 *   get()      the person's pattern, office, home state, week, the schedule in force and the one
 *              waiting to start, for anyone whose `people` view reaches them; mine() the same for
 *              the person themselves (My Profile)
 *   weekOf()   each weekday as worked today, for My Profile and the record
 *   dayOn()    a person's shift on a date, for Home's day strip and Your Week
 *   needsHome  whether the person's week, in force or waiting, has a Remote day (§6.10)
 *
 * With no schedule a person works the company hours (the Attendance policy's, else the working
 * week of Settings · Organisation) at the place their pattern gives. Events carry ids, the days and
 * the first day.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { assertInScope } = require("../../shared/rbac/scope");
const { scopeFor } = require("../../middleware/rbac");
const lagos = require("../../shared/time/lagos");
const workingWeek = require("../../shared/time/working-week");
const worksites = require("../worksites/worksites.service");
const calendar = require("./attendance.calendar");
const rules = require("./attendance.rules");
const repo = require("./attendance.repo");
const { EVENTS } = require("./attendance.events");

/** How far ahead a schedule may start, in days. */
const AHEAD_DAYS = 90;
const WEEKDAYS = Object.freeze([1, 2, 3, 4, 5, 6, 7]);

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That employee does not exist", 404);
const iso = (t) => (t ? new Date(t).toISOString() : null);

/* ------------------------------------------------------------------ *
 * The week, pure
 * ------------------------------------------------------------------ */

/**
 * Each weekday as worked (Monday first): the schedule's day (its own hours, or the company hours
 * for a blank one, Off when the company hours do not work that weekday), else the company hours
 * at the place the pattern gives. Holidays aside: a week, not a date.
 * @param {Array|null} scheduleDays  attendance_work_schedule.days, or null
 * @param {"on_site"|"hybrid"|"remote"} pattern
 * @param {object} cal  shared/time/working-week loadCalendar()
 * @param {Array|null} hours  the company hours in force (the policy's), or null for the working week
 * @returns {Array<{weekday: number, working: boolean, starts_at: string|null, ends_at: string|null,
 *                  place: "office"|"remote"|null, company_hours: boolean}>}
 */
function weekFrom(scheduleDays, pattern, cal, hours) {
  return WEEKDAYS.map((weekday) => {
    const company = rules.companyDay(weekday, cal, hours);
    const d = scheduleDays ? scheduleDays[weekday - 1] : null;
    if (d) {
      if (!d.working) return { weekday, working: false, starts_at: null, ends_at: null, place: null, company_hours: false };
      if (d.starts_at && d.ends_at)
        return { weekday, working: true, starts_at: d.starts_at, ends_at: d.ends_at, place: d.place || "office", company_hours: false };
      if (company.working)
        return { weekday, working: true, starts_at: company.starts_at, ends_at: company.ends_at, place: d.place || "office", company_hours: true };
      return { weekday, working: false, starts_at: null, ends_at: null, place: null, company_hours: false };
    }
    if (!company.working) return { weekday, working: false, starts_at: null, ends_at: null, place: null, company_hours: true };
    return {
      weekday,
      working: true,
      starts_at: company.starts_at,
      ends_at: company.ends_at,
      place: pattern === "remote" ? "remote" : "office",
      company_hours: true,
    };
  });
}

/** The week as My Profile's `EssWorkDay` reads it: Office, Remote or Off, with the hours. */
const placeOf = (day) => (day.working ? day.place : "off");

/**
 * A schedule's days against the company hours in force on its first day (§6.13, gap l): a working
 * day with no times on a weekday they do not work is refused on that day's start. Pure.
 * @returns {Record<string, string[]>} the fields refused, empty when it is fine
 */
function checkDays(days, cal, hours) {
  const fields = {};
  days.forEach((d, i) => {
    if (d.working && !d.starts_at && !rules.companyDay(d.weekday, cal, hours).working)
      fields[`days.${i}.starts_at`] = ["Give the hours"];
  });
  return fields;
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/** A schedule row as the contract's ScheduleVersion. */
const versionOf = (row) =>
  row && {
    attendance_work_schedule_id: row.attendance_work_schedule_id,
    days: row.days,
    effective_from: String(row.effective_from).slice(0, 10),
    reason: row.reason,
    set_by_name: row.set_by_name || null,
    set_at: iso(row.set_at),
  };

/** The schedule in force today and the one waiting to start. One after the other: `db` may be a client. */
async function versionsOf(db, person, today) {
  const current = await repo.workScheduleOn(db, person.employee_id, today);
  const next = await repo.workScheduleAfter(db, person.employee_id, today);
  return { current, next };
}

/** A person's week as worked on a date: by the schedule in force then, else the company hours. */
async function weekOn(db, person, date, schedule) {
  const cal = await workingWeek.loadCalendar(db);
  const hours = await calendar.companyHoursOn(db, date);
  return weekFrom(schedule ? schedule.days : null, person.work_pattern, cal, hours);
}

/**
 * Whether the person works from home on some days, and so needs an approved home (§6.10): their
 * week in force today, or the schedule waiting to start, has a Remote working day. A remote employee
 * with no schedule works every day from home.
 */
async function needsHome(db, person, today = lagos.today()) {
  const { current, next } = await versionsOf(db, person, today);
  const now = await weekOn(db, person, today, current);
  if (now.some((d) => d.working && d.place === "remote")) return true;
  if (!next) return false;
  const later = await weekOn(db, person, String(next.effective_from).slice(0, 10), next);
  return later.some((d) => d.working && d.place === "remote");
}

/** Each weekday as worked for a person today, as My Profile and the record show it. */
async function weekOf(db, employeeId, today = lagos.today()) {
  const person = await repo.person(db, employeeId);
  if (!person) throw notFound();
  const current = await repo.workScheduleOn(db, employeeId, today);
  return weekOn(db, person, today, current);
}

/**
 * A person's shift on a date (§6.13): their schedule, else the company hours; Off on a public
 * holiday. Home's day strip and Your Week read it (home.md §6); `calendar` is the working-week
 * calendar to read it with, when the caller holds one.
 * @returns {Promise<ReturnType<typeof rules.shiftFor>>}
 */
async function dayOn(db, employeeId, date, { calendar: cal = null } = {}) {
  const person = await repo.person(db, employeeId);
  if (!person) throw notFound();
  return calendar.shiftOn(db, person, date, { calendar: cal });
}

/** Whether the reader may set this person's schedule: `people` edit over them, never themselves. */
async function canEdit(user, person) {
  if (!user || person.employee_id === user.employee_id) return false;
  const edit = await scopeFor(user, "people", "edit");
  if (!edit) return false;
  return edit.scope === "all" || (edit.scope_ids || []).includes(person.employee_id);
}

/** A person's WorkSchedule, for whoever may read it. */
async function scheduleOf(user, person, { editable = true } = {}) {
  const today = lagos.today();
  const { current, next } = await versionsOf(pool, person, today);
  const site = await worksites.fenceFor(pool, person.worksite_id);
  let homeState = null;
  if (await needsHome(pool, person, today)) {
    const homes = await repo.homesOf(pool, person.employee_id);
    homeState = homes.approved ? "approved" : homes.pending ? "pending" : "none";
  }
  return {
    employee: person.ref,
    work_pattern: person.work_pattern,
    worksite: site ? { worksite_id: site.worksite_id, name: site.name, radius_m: Number(site.radius_m) } : null,
    home_state: homeState,
    week: await weekOn(pool, person, today, current),
    current: versionOf(current),
    next: versionOf(next),
    can_edit: editable ? await canEdit(user, person) : false,
  };
}

/**
 * GET /attendance/schedules/:employee_id, within the reader's `people` scope.
 * @param {object} user  the reader
 * @param {string} employeeId
 * @param {{scope: string, scope_ids: string[]|null}} scope  the reader's `people` view scope
 */
async function get(user, employeeId, scope) {
  const person = await repo.person(pool, employeeId);
  if (!person) throw notFound();
  assertInScope(scope, employeeId);
  return scheduleOf(user, person);
}

/** GET /attendance/me/schedule: the person's own week (My Profile). */
async function mine(user) {
  const person = await repo.person(pool, user.employee_id);
  if (!person) throw notFound();
  return scheduleOf(user, person, { editable: false });
}

/* ------------------------------------------------------------------ *
 * The write
 * ------------------------------------------------------------------ */

/** The first day, against today in Lagos (§6.13). */
function checkFrom(from, today) {
  if (from < today)
    throw new AppError("SCHEDULE_IN_THE_PAST", "Pick a first day from today on", 422, { effective_from: ["Already past"] });
  if (lagos.daysBetween(today, from) > AHEAD_DAYS)
    throw new AppError("SCHEDULE_TOO_FAR", `Pick a first day within ${AHEAD_DAYS} days`, 422, {
      effective_from: ["Too far ahead"],
    });
}

/**
 * POST /attendance/schedules/:employee_id.
 * @param {{user_id: string, employee_id: string}} actor
 * @param {string} employeeId
 * @param {{days: Array, effective_from: string, reason: string}} body  WorkScheduleSet
 * @param {{scope: string, scope_ids: string[]|null}} scope  the reader's `people` edit scope
 */
async function set(actor, employeeId, body, scope) {
  const today = lagos.today();
  await tx(async (client) => {
    await repo.lockEmployee(client, employeeId);
    const person = await repo.person(client, employeeId);
    if (!person) throw notFound();
    assertInScope(scope, employeeId);
    if (employeeId === actor.employee_id)
      throw new AppError("OWN_RECORD", "Someone else sets your work schedule", 403);
    if (person.status !== "active")
      throw new AppError("NOT_EMPLOYED", "Only people who work here now have a schedule.", 422);
    checkFrom(body.effective_from, today);
    const cal = await workingWeek.loadCalendar(client);
    const hours = await calendar.companyHoursOn(client, body.effective_from);
    const refused = checkDays(body.days, cal, hours);
    if (Object.keys(refused).length)
      throw new AppError("SCHEDULE_HOURS_NEEDED", "Give the hours of a day the company does not work", 422, refused);

    const before = await repo.workScheduleOn(client, employeeId, body.effective_from);
    const replaced = before && String(before.effective_from).slice(0, 10) === body.effective_from ? before : null;
    const row = await repo.upsertWorkSchedule(client, {
      employee_id: employeeId,
      days: body.days,
      effective_from: body.effective_from,
      reason: body.reason,
      set_by: actor.user_id,
    });
    await emit(client, {
      key: EVENTS.ATTENDANCE_SCHEDULE_SET,
      entity: { type: "employee", id: employeeId },
      actor,
      before: replaced ? { days: replaced.days, effective_from: body.effective_from } : null,
      after: { days: body.days, effective_from: body.effective_from, reason: body.reason },
      payload: {
        attendance_work_schedule_id: row.attendance_work_schedule_id,
        employee_id: employeeId,
        subject_employee_id: employeeId,
        days: body.days,
        effective_from: body.effective_from,
      },
    });
  });
  const readScope = (await scopeFor(actor, "people", "view")) || scope;
  return get(actor, employeeId, readScope);
}

module.exports = { AHEAD_DAYS, weekFrom, placeOf, checkDays, needsHome, weekOf, dayOn, get, mine, set };
