"use strict";
/**
 * The clock watch (docs/guides/attendance.md §6.14): the reminder to clock in and the automatic
 * clock-out. Run every 5 minutes by jobs/schedulers/attendance-clock-watch.js, under the cron
 * lock; safe to run twice, and late.
 *
 *   remind     on a working day of the organisation's week (Lagos), in the first
 *              REMIND_WINDOW_MIN minutes after the start, everyone at work with a login, not on
 *              granted leave and with no clock-in that counts is reminded once; someone on a
 *              temporary site with its own hours that day at the site's start instead
 *              (attendance_clock_reminder decides "once"; the notice goes to the bell and, as the
 *              person's Attendance and Leave preference allows, their devices). Someone in front
 *              of the app is not: the app's start prompt asks them, and a later run reminds them
 *              if they leave it still not clocked in. When presence cannot be read, the reminder
 *              goes
 *   clockOut   a shift still open once its date's end has passed is clocked out when the person
 *              has been away from the app for AWAY_MIN minutes: at the later of the end and the
 *              last moment they were in front of it, never before the clock-in. While they are in
 *              front of it nothing happens (the app's closing prompt asks them), and nothing
 *              happens either when the presence store cannot answer: the day-close's missing
 *              clock-out is the backstop
 *
 * The automatic clock-out is the system's punch: under the person's lock, in one transaction
 * with the day and its events, as a person's punch is (attendance.service.js). It is recorded
 * as `source = 'system'`, accepted, with no location, device or device time, and its evidence
 * names where its time came from.
 */
const { pool } = require("../../config/db");
const requestContext = require("../../config/request-context");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const lagos = require("../../shared/time/lagos");
const workingWeek = require("../../shared/time/working-week");
const active = require("../../services/realtime/active");
const calendar = require("./attendance.calendar");
const guard = require("./attendance.clock-guard");
const reconcile = require("./attendance.reconcile");
const rules = require("./attendance.rules");
const repo = require("./attendance.repo");
const sitesRepo = require("./attendance.sites.repo");
const { EVENTS } = require("./attendance.events");

/** How long after the start a reminder may still go out. */
const REMIND_WINDOW_MIN = 60;
/** How long a person must have been away from the app before their open shift is closed. */
const AWAY_MIN = 15;

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/**
 * The instant a shift on `date` ends at the workplace; an end at or before the start is the next
 * morning's (a late shift). Null for a day that is not worked.
 * @param {string} date
 * @param {{working_day: boolean, starts_at: string|null, ends_at: string|null}} shift
 * @param {string} timeZone
 */
function shiftEnd(date, shift, timeZone) {
  if (!shift.working_day || !shift.ends_at) return null;
  const start = rules.parseHHMM(shift.starts_at);
  const end = rules.parseHHMM(shift.ends_at);
  const endDate = start !== null && end <= start ? lagos.addDays(date, 1) : date;
  return rules.zonedInstant(endDate, shift.ends_at, timeZone);
}

/**
 * Whether an open shift is clocked out now, and at what time. Pure.
 * @param {{shiftEnd: Date|null, clockInAt: Date, now: Date,
 *          activity: {known: boolean, active: boolean, last_active_at: Date|null}}} args
 * @returns {{due: false, reason: string}|{due: true, at: Date, reason: string}}
 *          not due: `no_end` (a day not worked), `shift_running`, `presence_unknown`,
 *          `in_front`, `recently_active`; due: `away_at_end` (not on the app after the end:
 *          the end's time) or `left_app` (on it after the end: the last moment they were)
 */
function decideAutomatic({ shiftEnd: end, clockInAt, now, activity }) {
  if (!end) return { due: false, reason: "no_end" };
  if (now < end) return { due: false, reason: "shift_running" };
  if (!activity.known) return { due: false, reason: "presence_unknown" };
  if (activity.active) return { due: false, reason: "in_front" };
  const last = activity.last_active_at;
  if (last && now.getTime() - last.getTime() < AWAY_MIN * 60_000) return { due: false, reason: "recently_active" };
  const after = last && last > end ? last : end;
  const at = new Date(Math.min(now.getTime(), Math.max(after.getTime(), clockInAt.getTime())));
  return { due: true, at, reason: last && last > end ? "left_app" : "away_at_end" };
}

/* ------------------------------------------------------------------ *
 * The reminder
 * ------------------------------------------------------------------ */

/** Remind one person, once a day: false when they already were. */
async function sendReminder(employeeId, date, startsAt) {
  return tx(async (client) => {
    const row = await repo.recordReminder(client, employeeId, date, "clock_in_due");
    if (!row) return false;
    await emit(client, {
      key: EVENTS.ATTENDANCE_CLOCK_IN_DUE,
      entity: { type: "attendance_clock_reminder", id: row.attendance_clock_reminder_id },
      actor: null,
      payload: { employee_id: employeeId, subject_employee_id: employeeId, work_date: date, starts_at: startsAt },
    });
    return true;
  });
}

/**
 * Remind everyone due today, in the first hour after the start, who is not in front of the app:
 * the push is for someone away from it (the 12 and 13 October meetings).
 */
async function remind({ now = new Date() } = {}) {
  const today = lagos.today(now);
  const tally = { reminded: 0, in_front: 0 };
  const cal = await workingWeek.loadCalendar(pool);
  const shift = rules.shiftFor(today, cal, rules.DEFAULT_POLICY);
  if (shift.working_day && shift.starts_at && inWindow(now, rules.zonedInstant(today, shift.starts_at, rules.DEFAULT_TZ)))
    await remindEach(await repo.dueForReminder(pool, today), today, shift.starts_at, now, tally);
  // A temporary site with its own hours reminds its people at its start, on its own clock and
  // on any day of it (§6.11); the organisation's reminder leaves them out that day.
  for (const site of await sitesRepo.siteHoursAround(pool, lagos.addDays(today, -1), lagos.addDays(today, 1))) {
    const zone = site.timezone || rules.DEFAULT_TZ;
    const date = rules.localDate(now, zone);
    if (date < site.starts_on || date > site.ends_on) continue;
    if (!inWindow(now, rules.zonedInstant(date, site.starts_at, zone))) continue;
    await remindEach(await repo.dueAtSite(pool, site.temporary_site_id, date), date, site.starts_at, now, tally);
  }
  return tally;
}

/** In the first REMIND_WINDOW_MIN minutes after a start. Pure. */
const inWindow = (now, start) => now >= start && now.getTime() - start.getTime() < REMIND_WINDOW_MIN * 60_000;

/** Remind each person due who is not in front of the app, counting both in the tally. */
async function remindEach(due, date, startsAt, now, tally) {
  for (const { employee_id: employeeId, user_ids: userIds } of due) {
    const seen = await active.activity(userIds, now.getTime());
    if (seen.known && seen.active) {
      tally.in_front += 1;
      continue;
    }
    if (await sendReminder(employeeId, date, startsAt)) tally.reminded += 1;
  }
}

/* ------------------------------------------------------------------ *
 * The automatic clock-out
 * ------------------------------------------------------------------ */

/**
 * Clock out one open shift as the system, once. False when it is no longer open (the person
 * clocked out, the day closed, or another run got there first).
 */
async function clockOutAutomatically(employeeId, workDate, { at, reason, end, lastActiveAt }) {
  return tx(async (client) => {
    await repo.lockEmployee(client, employeeId);
    const person = await repo.person(client, employeeId);
    if (!person || person.status !== "active") return false;
    const day = await repo.getDay(client, employeeId, workDate);
    if (day && day.closed_at) return false;
    if (!guard.isOpen(await repo.eventsOn(client, employeeId, workDate))) return false;
    const ctx = await calendar.contextFor(client, person, workDate);

    let row;
    try {
      row = await repo.insertEvent(client, {
        employee_id: employeeId,
        event_type: "clock_out",
        occurred_at: at,
        work_date: workDate,
        policy_version_id: ctx.policy.policy_version_id,
        source: "system",
        validation_state: "accepted",
        validation: {
          automatic: {
            reason,
            shift_end: end.toISOString(),
            last_active_at: lastActiveAt ? lastActiveAt.toISOString() : null,
          },
          time: { timezone: ctx.timeZone, server_at: at.toISOString() },
          reasons: [],
        },
        request_id: requestContext.getRequestId(),
      });
    } catch (err) {
      // One automatic clock-out a person a work date (1360): another run got there first.
      if (err && err.code === "23505") return false;
      throw err;
    }

    const r = await reconcile.recomputeDay(client, person, workDate);
    const dayId = r.day.attendance_day_id;
    const facts = {
      attendance_event_id: row.attendance_event_id,
      attendance_day_id: dayId,
      employee_id: employeeId,
      subject_employee_id: employeeId,
      event_type: "clock_out",
      result: "accepted",
      work_date: workDate,
      reasons: [],
      source: "system",
    };
    await emit(client, {
      key: EVENTS.ATTENDANCE_PUNCHED,
      entity: { type: "attendance_event", id: row.attendance_event_id },
      actor: null,
      after: { event_type: "clock_out", validation_state: "accepted", work_date: workDate, source: "system", reason },
      payload: facts,
    });
    await emit(client, {
      key: EVENTS.ATTENDANCE_CLOCKED_OUT_AUTOMATICALLY,
      entity: { type: "attendance_record", id: dayId },
      actor: null,
      after: { clock_out_at: at.toISOString(), reason },
      payload: { ...facts, clock_out_time: rules.localTime(at, ctx.timeZone) },
      dedup_key: `attendance-auto-out:${row.attendance_event_id}`,
    });
    return true;
  });
}

/** Clock out every open shift of today and yesterday whose end has passed and whose person is away. */
async function clockOut({ now = new Date() } = {}) {
  const today = lagos.today(now);
  const tally = { clocked_out: 0, waiting: 0, unknown: 0 };
  for (const s of await repo.openShifts(pool, lagos.addDays(today, -1), today)) {
    const person = await repo.person(pool, s.employee_id);
    if (!person) continue;
    const ctx = await calendar.contextFor(pool, person, s.work_date);
    const end = shiftEnd(s.work_date, ctx.shift, ctx.timeZone);
    if (!end || now < end) continue;
    // Someone with no login is never in front of the app: nothing to ask.
    const seen =
      s.user_ids.length > 0
        ? await active.activity(s.user_ids, now.getTime())
        : { known: true, active: false, last_active_at: null };
    const d = decideAutomatic({ shiftEnd: end, clockInAt: new Date(s.clock_in_at), now, activity: seen });
    if (!d.due) {
      if (d.reason === "presence_unknown") tally.unknown += 1;
      else tally.waiting += 1;
      continue;
    }
    const done = await clockOutAutomatically(s.employee_id, s.work_date, {
      at: d.at,
      reason: d.reason,
      end,
      lastActiveAt: seen.last_active_at,
    });
    if (done) tally.clocked_out += 1;
  }
  return tally;
}

/** One tick of the watch: the reminders, then the automatic clock-outs. */
async function watch({ now = new Date() } = {}) {
  const reminders = await remind({ now });
  const shifts = await clockOut({ now });
  return { ...reminders, ...shifts };
}

module.exports = {
  REMIND_WINDOW_MIN,
  AWAY_MIN,
  shiftEnd,
  decideAutomatic,
  remind,
  clockOut,
  clockOutAutomatically,
  watch,
};
