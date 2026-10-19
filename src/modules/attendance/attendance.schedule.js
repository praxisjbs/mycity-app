"use strict";
/**
 * Hybrid staff's weekly schedule: the one write path for the office days People set, and the reads
 * behind the employee record's Attendance tab and My Profile's week (docs/guides/attendance.md
 * §6.13).
 *
 *   set()      People with `people` edit, within their scope and never on their own record, set a
 *              hybrid employee's office days from a first day. Checked against the organisation's
 *              week (each office day worked, one working day left for home) and today in Lagos;
 *              one from the same first day is replaced. The person is told.
 *   get()      the person's pattern, office, home state, week, the schedule in force and the one
 *              waiting to start, for anyone whose `people` view reaches them
 *   weekOf()   each weekday's place (office, remote, off), for My Profile
 *
 * On the clock (attendance.calendar.js) a hybrid employee's date is a home day when the schedule in
 * force then leaves its weekday out: fenced on the approved home, as a remote employee's is. With no
 * schedule every day is an office day. Events carry ids, the office days and the first day.
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
const repo = require("./attendance.repo");
const { EVENTS } = require("./attendance.events");

/** How far ahead a schedule may start, in days. */
const AHEAD_DAYS = 90;
const WEEKDAYS = Object.freeze([1, 2, 3, 4, 5, 6, 7]);
/** A weekday as the person's notice names it, by ISO number. */
const SHORT = Object.freeze({ 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun" });

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

/** The working weekdays a schedule leaves for home. */
const homeDaysOf = (officeDays, cal) => WEEKDAYS.filter((d) => cal.days.has(d) && !officeDays.includes(d));

/**
 * Where a person works each day of the week (Monday first): off when the organisation's week does
 * not work it, else office or remote by the pattern; a hybrid employee by `officeDays`, the schedule
 * in force (office every day without one).
 * @param {"on_site"|"hybrid"|"remote"} pattern
 * @param {number[]|null} officeDays
 * @param {import("../../shared/time/working-week").Calendar} cal
 * @returns {Array<{weekday: number, place: "office"|"remote"|"off"}>}
 */
function placesOf(pattern, officeDays, cal) {
  return WEEKDAYS.map((weekday) => {
    if (!cal.days.has(weekday)) return { weekday, place: "off" };
    if (pattern === "remote") return { weekday, place: "remote" };
    if (pattern === "hybrid" && officeDays && !officeDays.includes(weekday)) return { weekday, place: "remote" };
    return { weekday, place: "office" };
  });
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/** A schedule row as the contract's ScheduleVersion. */
const versionOf = (row) =>
  row && {
    attendance_schedule_id: row.attendance_schedule_id,
    office_days: row.office_days.map(Number),
    effective_from: row.effective_from,
    reason: row.reason,
    set_by_name: row.set_by_name || null,
    set_at: iso(row.set_at),
  };

/** The schedule in force today and the one waiting to start, for a hybrid employee only. */
async function versionsOf(db, person, today) {
  if (person.work_pattern !== "hybrid") return { current: null, next: null };
  // One after the other: `db` may be a transaction's client.
  const current = await repo.scheduleOn(db, person.employee_id, today);
  const next = await repo.scheduleAfter(db, person.employee_id, today);
  return { current, next };
}

/**
 * Whether the person works from home on some days, and so needs an approved home (§6.10): remote
 * staff, and a hybrid employee whose schedule in force, or the one waiting to start, leaves a
 * working day for home.
 */
async function needsHome(db, person, today = lagos.today()) {
  if (person.work_pattern === "remote") return true;
  if (person.work_pattern !== "hybrid") return false;
  const { current, next } = await versionsOf(db, person, today);
  if (!current && !next) return false;
  const cal = await workingWeek.loadCalendar(db);
  return [current, next].some((v) => v && homeDaysOf(v.office_days.map(Number), cal).length > 0);
}

/** Each weekday's place for a person today, as My Profile shows it. */
async function weekOf(db, employeeId, today = lagos.today()) {
  const person = await repo.person(db, employeeId);
  if (!person) throw notFound();
  const cal = await workingWeek.loadCalendar(db);
  const { current } = await versionsOf(db, person, today);
  return placesOf(person.work_pattern, current ? current.office_days.map(Number) : null, cal);
}

/** Whether the reader may set this person's schedule: `people` edit over them, hybrid, not themselves. */
async function canEdit(user, person) {
  if (!user || person.work_pattern !== "hybrid" || person.employee_id === user.employee_id) return false;
  const edit = await scopeFor(user, "people", "edit");
  if (!edit) return false;
  return edit.scope === "all" || (edit.scope_ids || []).includes(person.employee_id);
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
  const today = lagos.today();
  const cal = await workingWeek.loadCalendar(pool);
  const { current, next } = await versionsOf(pool, person, today);
  const site = await worksites.fenceFor(pool, person.worksite_id);
  let homeState = null;
  if (await needsHome(pool, person, today)) {
    const homes = await repo.homesOf(pool, employeeId);
    homeState = homes.approved ? "approved" : homes.pending ? "pending" : "none";
  }
  return {
    employee: person.ref,
    work_pattern: person.work_pattern,
    worksite: site ? { worksite_id: site.worksite_id, name: site.name, radius_m: Number(site.radius_m) } : null,
    home_state: homeState,
    week: placesOf(person.work_pattern, current ? current.office_days.map(Number) : null, cal),
    current: versionOf(current),
    next: versionOf(next),
    can_edit: await canEdit(user, person),
  };
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

/** The office days, against the organisation's week (§6.13). */
function checkDays(officeDays, cal) {
  if (officeDays.some((d) => !cal.days.has(d)))
    throw new AppError("SCHEDULE_DAY_NOT_WORKED", "Pick office days the organisation works", 422, {
      office_days: ["Not a working day"],
    });
  if (homeDaysOf(officeDays, cal).length === 0)
    throw new AppError("SCHEDULE_NO_HOME_DAY", "Every working day at the office is on site: change the work pattern", 422, {
      office_days: ["Leave a home day"],
    });
}

const shortDays = (days) => [...days].sort((a, b) => a - b).map((d) => SHORT[d]).join(", ");

/**
 * POST /attendance/schedules/:employee_id.
 * @param {{user_id: string, employee_id: string}} actor
 * @param {string} employeeId
 * @param {{office_days: number[], effective_from: string, reason: string}} body  WorkScheduleSet
 * @param {{scope: string, scope_ids: string[]|null}} scope  the reader's `people` edit scope
 */
async function set(actor, employeeId, body, scope) {
  const today = lagos.today();
  const officeDays = [...body.office_days].sort((a, b) => a - b);
  await tx(async (client) => {
    await repo.lockEmployee(client, employeeId);
    const person = await repo.person(client, employeeId);
    if (!person) throw notFound();
    assertInScope(scope, employeeId);
    if (employeeId === actor.employee_id)
      throw new AppError("OWN_RECORD", "Someone else sets your work schedule", 403);
    if (person.status !== "active")
      throw new AppError("NOT_EMPLOYED", "Only people who work here now have a schedule.", 422);
    if (person.work_pattern !== "hybrid")
      throw new AppError("SCHEDULE_NOT_NEEDED", "Only hybrid staff have a weekly schedule.", 422, {
        office_days: ["Not hybrid"],
      });
    checkFrom(body.effective_from, today);
    const cal = await workingWeek.loadCalendar(client);
    checkDays(officeDays, cal);

    const before = await repo.scheduleOn(client, employeeId, body.effective_from);
    const row = await repo.upsertSchedule(client, {
      employee_id: employeeId,
      office_days: officeDays,
      effective_from: body.effective_from,
      reason: body.reason,
      set_by: actor.user_id,
    });
    await emit(client, {
      key: EVENTS.ATTENDANCE_SCHEDULE_SET,
      entity: { type: "employee", id: employeeId },
      actor,
      before: before ? { office_days: before.office_days.map(Number), effective_from: before.effective_from } : null,
      after: { office_days: officeDays, effective_from: body.effective_from, reason: body.reason },
      payload: {
        attendance_schedule_id: row.attendance_schedule_id,
        employee_id: employeeId,
        subject_employee_id: employeeId,
        office_days: officeDays,
        office_days_text: shortDays(officeDays),
        effective_from: body.effective_from,
      },
    });
  });
  const readScope = (await scopeFor(actor, "people", "view")) || scope;
  return get(actor, employeeId, readScope);
}

module.exports = { AHEAD_DAYS, homeDaysOf, placesOf, needsHome, weekOf, get, set };
