"use strict";
/**
 * The clock watch (docs/guides/attendance.md §6.14; TB's decisions of 20/10/2026, T13): the
 * reminder to clock in, the reminders to clock out and the System Clock-Out. Run every 5 minutes by
 * jobs/schedulers/attendance-clock-watch.js, under the cron lock; safe to run twice, and late.
 * Every reminder follows the person's own shift (§6.13): a day not worked for them has none.
 *
 *   remind     in the first REMIND_WINDOW_MIN minutes after the start of their own shift (Lagos),
 *              everyone at work with a login, expected that day by their schedule, not on granted
 *              leave and with no clock-in that counts is reminded once (attendance_clock_reminder,
 *              slot 0; the notice goes to the bell and, as the person's Attendance and Leave
 *              preference allows, their devices). Someone in front of the app is not: the app's
 *              start prompt asks them, and a later run reminds them if they leave it still not
 *              clocked in. When presence cannot be read, the reminder goes
 *   clockOut   for a shift still open on a working day, from the shift's end, a reminder every
 *              `clock_out_reminder_minutes` while it stays open and the system clock-out has not
 *              come (slot 1 at the end, slot 2 one interval later ...; one row each, so none is sent
 *              twice); someone in front of the app at a reminder's time has the closing prompt
 *              instead, and a later run in the same interval sends it once they are away. At the
 *              end plus `system_clock_out_after_minutes` the system clocks the shift out at that
 *              moment, whenever the run reaches it. A clock-in at or after that moment (an evening
 *              start) gets neither: the day-close's missing clock-out is its backstop. Both figures
 *              are the policy version's that judged the day, and the shift is the one recorded on it
 *
 * The System Clock-Out is the system's punch: under the person's lock, in one transaction with the
 * day, its pay items and its rule counts, as a person's punch is (attendance.service.js). It is
 * recorded as `source = 'system'`, accepted, with no location, device or device time; its evidence
 * names the shift's end, the rule and its minutes. Its worked minutes count only to the end, it is
 * never early and never overtime (attendance.rules.projectDay). Presence decides nothing but
 * whether a reminder is a push or the closing prompt.
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
const sites = require("./attendance.sites");
const { EVENTS } = require("./attendance.events");

/** How long after the start a reminder to clock in may still go out. */
const REMIND_WINDOW_MIN = 60;
/** The rule the System Clock-Out follows, named in its evidence. */
const SYSTEM_RULE = "system_clock_out_after_minutes";

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const addMinutes = (at, minutes) => new Date(at.getTime() + minutes * 60_000);

/**
 * The instant a shift on `date` starts at the workplace. Null for a day that is not worked.
 * @param {string} date
 * @param {{working_day: boolean, starts_at: string|null}} shift
 * @param {string} timeZone
 */
function shiftStart(date, shift, timeZone) {
  if (!shift.working_day || !shift.starts_at) return null;
  return rules.zonedInstant(date, shift.starts_at, timeZone);
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
 * What an open shift is owed now (§6.14). Pure.
 *
 *   reminder   the latest reminder whose time has come and that falls before the system clock-out
 *              ({slot, at}: slot 1 at the end, then one every `every` minutes), or null; one whose
 *              time came before the clock-in is never owed. An earlier one a late run missed is not
 *              sent after it
 *   systemAt   the moment the system clocks it out, once it has come (the end plus `after`), or null
 *   evening    a clock-in at or after that moment: neither is owed
 *
 * @param {{shiftEnd: Date|null, clockInAt: Date, now: Date, every: number, after: number}} args
 * @returns {{reminder: {slot: number, at: Date}|null, systemAt: Date|null, evening: boolean}}
 */
function clockOutPlan({ shiftEnd: end, clockInAt, now, every, after }) {
  if (!end) return { reminder: null, systemAt: null, evening: false };
  const systemAt = addMinutes(end, after);
  if (clockInAt >= systemAt) return { reminder: null, systemAt: null, evening: true };
  if (now >= systemAt) return { reminder: null, systemAt, evening: false };
  if (now < end) return { reminder: null, systemAt: null, evening: false };
  const slot = Math.floor((now - end) / (every * 60_000)) + 1;
  const at = addMinutes(end, (slot - 1) * every);
  if (at < clockInAt || at >= systemAt) return { reminder: null, systemAt: null, evening: false };
  return { reminder: { slot, at }, systemAt: null, evening: false };
}

/* ------------------------------------------------------------------ *
 * The reminder to clock in
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
 * Remind everyone due today, in the first hour after the start of their own shift, who is not in
 * front of the app: the push is for someone away from it (the 12 and 13 October meetings).
 */
async function remind({ now = new Date() } = {}) {
  const today = lagos.today(now);
  const policy = await calendar.policyFor(pool, null, today);
  const cal = await workingWeek.loadCalendar(pool);
  let reminded = 0;
  let inFront = 0;
  for (const { employee_id: employeeId, user_ids: userIds } of await repo.dueForReminder(pool, today, { hours: policy.hours })) {
    const person = await repo.person(pool, employeeId);
    if (!person) continue;
    const shift = await calendar.shiftOn(pool, person, today, { policy, calendar: cal });
    // A temporary site's start is on the site's own clock (§6.11).
    const start = shiftStart(today, shift, await sites.zoneAt(pool, person, now, calendar.zoneOf(person)));
    if (!start || now < start || now.getTime() - start.getTime() >= REMIND_WINDOW_MIN * 60_000) continue;
    const seen = await active.activity(userIds, now.getTime());
    if (seen.known && seen.active) {
      inFront += 1;
      continue;
    }
    if (await sendReminder(employeeId, today, shift.starts_at)) reminded += 1;
  }
  return { reminded, in_front: inFront };
}

/* ------------------------------------------------------------------ *
 * The reminders to clock out
 * ------------------------------------------------------------------ */

/** One reminder to clock out, once a slot: false when it was already sent. */
async function sendClockOutReminder(employeeId, date, { slot, at }, endsAt) {
  return tx(async (client) => {
    const row = await repo.recordReminder(client, employeeId, date, "clock_out_due", { slot, dueAt: at });
    if (!row) return false;
    await emit(client, {
      key: EVENTS.ATTENDANCE_CLOCK_OUT_DUE,
      entity: { type: "attendance_clock_reminder", id: row.attendance_clock_reminder_id },
      actor: null,
      payload: { employee_id: employeeId, subject_employee_id: employeeId, work_date: date, ends_at: endsAt, slot },
    });
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * The System Clock-Out
 * ------------------------------------------------------------------ */

/**
 * Clock out one open shift as the system, once, at `at`. False when it is no longer open (the
 * person clocked out, the day closed, or another run got there first).
 * @param {string} employeeId
 * @param {string} workDate
 * @param {{at: Date, end: Date, minutes: number}} when  the moment, the shift's end and the rule's minutes
 */
async function clockOutBySystem(employeeId, workDate, { at, end, minutes }) {
  return tx(async (client) => {
    await repo.lockEmployee(client, employeeId);
    const person = await repo.person(client, employeeId);
    if (!person || person.status !== "active") return false;
    const day = await repo.getDay(client, employeeId, workDate);
    if (day && day.closed_at) return false;
    const events = await repo.eventsOn(client, employeeId, workDate);
    if (!guard.isOpen(events)) return false;
    const clockIn = events.find((e) => e.event_type === "clock_in" && !e.excluded);
    if (!clockIn || at <= new Date(clockIn.occurred_at)) return false;
    const ctx = await calendar.contextFor(client, person, workDate);

    let row;
    try {
      row = await repo.insertEvent(client, {
        employee_id: employeeId,
        event_type: "clock_out",
        occurred_at: at,
        work_date: workDate,
        policy_version_id: day ? day.policy_version_id : ctx.policy.policy_version_id,
        source: "system",
        validation_state: "accepted",
        validation: {
          system: { shift_end: end.toISOString(), rule: SYSTEM_RULE, minutes },
          time: { timezone: ctx.timeZone, server_at: at.toISOString() },
          reasons: [],
        },
        request_id: requestContext.getRequestId(),
      });
    } catch (err) {
      // One system clock-out a person a work date (1360): another run got there first.
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
      after: { event_type: "clock_out", validation_state: "accepted", work_date: workDate, source: "system", rule: SYSTEM_RULE },
      payload: facts,
    });
    await emit(client, {
      key: EVENTS.ATTENDANCE_CLOCKED_OUT_AUTOMATICALLY,
      entity: { type: "attendance_record", id: dayId },
      actor: null,
      after: { clock_out_at: at.toISOString(), rule: SYSTEM_RULE, minutes },
      payload: { ...facts, clock_out_time: rules.localTime(at, ctx.timeZone) },
      dedup_key: `attendance-auto-out:${row.attendance_event_id}`,
    });
    return true;
  });
}

/**
 * Every open shift of today and yesterday: the reminder it is owed, or its System Clock-Out, by
 * the shift and the version that judged its day.
 */
async function clockOut({ now = new Date() } = {}) {
  const today = lagos.today(now);
  const tally = { clock_out_reminded: 0, clock_out_in_front: 0, clocked_out: 0, evening: 0 };
  for (const s of await repo.openShifts(pool, lagos.addDays(today, -1), today)) {
    const person = await repo.person(pool, s.employee_id);
    if (!person) continue;
    const { judged, timeZone } = await reconcile.judgedOn(pool, person, s.work_date);
    const end = shiftEnd(s.work_date, judged.shift, timeZone);
    const plan = clockOutPlan({
      shiftEnd: end,
      clockInAt: new Date(s.clock_in_at),
      now,
      every: judged.rules.clock_out_reminder_minutes,
      after: judged.rules.system_clock_out_after_minutes,
    });
    if (plan.evening) tally.evening += 1;
    if (plan.systemAt) {
      const done = await clockOutBySystem(s.employee_id, s.work_date, {
        at: plan.systemAt,
        end,
        minutes: judged.rules.system_clock_out_after_minutes,
      });
      if (done) tally.clocked_out += 1;
      continue;
    }
    if (!plan.reminder) continue;
    const sent = await repo.remindersOn(pool, s.employee_id, s.work_date, "clock_out_due");
    if (sent.some((x) => x.slot === plan.reminder.slot)) continue;
    // Someone with no login is never in front of the app: the bell is all they could have.
    const seen = s.user_ids.length > 0 ? await active.activity(s.user_ids, now.getTime()) : { known: true, active: false };
    if (seen.known && seen.active) {
      tally.clock_out_in_front += 1;
      continue;
    }
    if (await sendClockOutReminder(s.employee_id, s.work_date, plan.reminder, judged.shift.ends_at)) tally.clock_out_reminded += 1;
  }
  return tally;
}

/** One tick of the watch: the reminders to clock in, then the open shifts. */
async function watch({ now = new Date() } = {}) {
  const reminders = await remind({ now });
  const shifts = await clockOut({ now });
  return { ...reminders, ...shifts };
}

module.exports = {
  REMIND_WINDOW_MIN,
  SYSTEM_RULE,
  shiftStart,
  shiftEnd,
  clockOutPlan,
  remind,
  clockOut,
  clockOutBySystem,
  watch,
};
