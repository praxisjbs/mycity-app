"use strict";
/**
 * Attendance for the real staff on staging: today and the working days before it, so the
 * figures that read the attendance register (Clocked In Today, the attendance chart, the On
 * Time donut, Team, My Attendance, the late arrival and missing clock-out alerts) have days to
 * count (docs/guides/home.md §11).
 *
 * Written the way the attendance module writes a day, through its own functions: each punch is
 * an attendance_event recorded under the person's lock, the day recalculated from its punches
 * (attendance.reconcile.js recomputeDay), and each day before today closed by the day-close
 * itself (closeDay), which makes a working day with no clock-in absent and opens the missing
 * clock-out exception. Nothing here decides a status: the register does.
 *
 * Who did what on a day is drawn from a hash of their work email and the date, so it is the
 * same on every run: most people in on time and out after the day ends, some late, a few with
 * no clock-out, a few absent. A punch is written only once its time has come, so today holds
 * the clock-ins made by now and nobody is clocked in from the future.
 *
 * A seeded punch is source `import`, with an idempotency key starting `staging-home:`, so a
 * second run finds it and adds nothing. A person's day that already holds a punch of their own
 * is theirs and is left alone, and so is a day the day-close already closed. attendance_event
 * is append-only, so seeded punches stay; they are told apart by that key.
 */
const crypto = require("node:crypto");
const { atomically } = require("../../../src/shared/db/tx");
const requestContext = require("../../../src/config/request-context");
const lagos = require("../../../src/shared/time/lagos");
const workingWeek = require("../../../src/shared/time/working-week");
const calendar = require("../../../src/modules/attendance/attendance.calendar");
const reconcile = require("../../../src/modules/attendance/attendance.reconcile");
const repo = require("../../../src/modules/attendance/attendance.repo");
const rules = require("../../../src/modules/attendance/attendance.rules");

/** The start of every idempotency key a seeded punch carries. */
const KEY_PREFIX = "staging-home:";

/** Working days before today the seed fills. */
const HISTORY_DAYS = 14;

/** "HH:MM" from minutes into the day. */
const clock = (mins) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

/** A number from 0 to 99 that one person's day always comes to. */
function draw(person, date) {
  return crypto.createHash("sha1").update(`${person.work_email || person.employee_id}|${date}`).digest().readUInt32BE(0) % 100;
}

/**
 * The punches a person makes on a working day, from their draw: absent (no punch), late (in
 * after the start), no clock-out (in on time, never out), or in on time and out after the end.
 * @param {{work_email?: string, employee_id: string}} person
 * @param {string} date
 * @param {{working_day: boolean, starts_at: string|null, ends_at: string|null}} shift  calendar.contextFor
 * @param {string} timeZone
 * @returns {Array<{event_type: "clock_in"|"clock_out", at: Date}>}
 */
function planDay(person, date, shift, timeZone) {
  if (!shift.working_day) return [];
  const n = draw(person, date);
  if (n < 6) return [];
  const start = rules.parseHHMM(shift.starts_at);
  const end = rules.parseHHMM(shift.ends_at);
  const at = (mins) => rules.zonedInstant(date, clock(mins), timeZone);
  const late = n < 20;
  const clockIn = { event_type: "clock_in", at: at(late ? start + 5 + ((n * 7) % 50) : start - 5 - (n % 20)) };
  if (n < 25 && !late) return [clockIn];
  return [clockIn, { event_type: "clock_out", at: at(end + (n % 30)) }];
}

/** The punches of a person's day that count, with their keys. */
async function activePunches(client, employeeId, date) {
  const { rows } = await client.query(
    `SELECT event_type, idempotency_key FROM attendance_event
      WHERE employee_id = $1 AND work_date = $2::date AND validation_state IN ('accepted', 'review')`,
    [employeeId, date],
  );
  return rows;
}

/**
 * Record one person's planned punches for a day that have happened by `now`, and recalculate
 * the day, in one transaction under the person's lock.
 * @returns {Promise<number>} punches written
 */
async function writeDay(db, person, date, { now }) {
  const client = await db.connect();
  try {
    return await atomically(client, async () => {
      await repo.lockEmployee(client, person.employee_id);
      const who = await repo.person(client, person.employee_id);
      if (!who || who.status !== "active") return 0;
      const day = await repo.getDay(client, person.employee_id, date);
      if (day && day.closed_at) return 0;
      if (await repo.grantedLeave(client, person.employee_id, date)) return 0;
      const punches = await activePunches(client, person.employee_id, date);
      if (punches.some((p) => !String(p.idempotency_key || "").startsWith(KEY_PREFIX))) return 0;
      const made = new Set(punches.map((p) => p.event_type));

      const ctx = await calendar.contextFor(client, who, date);
      let written = 0;
      for (const punch of planDay(person, date, ctx.shift, ctx.timeZone)) {
        if (punch.at > now || made.has(punch.event_type)) continue;
        await repo.insertEvent(client, {
          employee_id: person.employee_id,
          event_type: punch.event_type,
          occurred_at: punch.at,
          work_date: date,
          worksite_id: ctx.fence ? ctx.fence.worksite_id : null,
          policy_version_id: ctx.policy.policy_version_id,
          source: "import",
          validation_state: "accepted",
          validation: { reasons: [] },
          request_id: requestContext.getRequestId(),
          idempotency_key: `${KEY_PREFIX}${date}:${punch.event_type}`,
        });
        written += 1;
      }
      if (written) await reconcile.recomputeDay(client, who, date);
      return written;
    });
  } finally {
    client.release();
  }
}

/** Whether a person was on the register on a date. */
const employedOn = (person, date) =>
  (!person.start_date || person.start_date <= date) && (!person.left_on || person.left_on > date);

/**
 * Today (Lagos) and the HISTORY_DAYS working days before it, oldest first.
 * @param {string} today
 * @param {import("../../../src/shared/time/working-week").Calendar} cal
 */
function daysOf(today, cal) {
  const days = [today];
  let d = today;
  for (let i = 0; i < HISTORY_DAYS; i += 1) {
    d = workingWeek.addWorkingDays(d, -1, cal);
    days.unshift(d);
  }
  return days;
}

/**
 * Fill the register for every person: their punches on each day, then every day before today
 * closed by the day-close.
 * @param {{db: import("pg").Pool, people: object[], now: Date, log?: Function}} opts
 *   people  staff.everyone (lib/staff.js)
 * @returns {Promise<{from: string, to: string, punches: number, closed: number}>}
 */
async function seedAttendance({ db, people, now, log = () => {} }) {
  const today = lagos.today(now);
  const days = daysOf(today, await workingWeek.loadCalendar(db));
  let punches = 0;
  let closed = 0;
  for (const date of days)
    for (const person of people) if (employedOn(person, date)) punches += await writeDay(db, person, date, { now });
  for (const date of days.filter((d) => d < today))
    for (const person of people)
      if (employedOn(person, date) && (await reconcile.closeDay(person.employee_id, date))) closed += 1;
  log(`attendance: ${punches} punches written, ${closed} days closed, ${days[0]} to ${today}`);
  return { from: days[0], to: today, punches, closed };
}

module.exports = { KEY_PREFIX, HISTORY_DAYS, draw, planDay, daysOf, seedAttendance };
