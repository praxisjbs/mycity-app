"use strict";
/**
 * What a day comes to, and the loop that settles it (docs/guides/attendance.md §6.4,
 * §6.8, §6.16, §6.17, §7): the day recalculated from its punches, People's decision on an
 * exception, the person's explanation, and the day-close.
 *
 * The source punch is never edited (attendance_event is append-only). A decision is
 * written on the exception; a rejected punch stops counting because its exception says
 * so; a missing clock-out People supply is a new `admin` event, and so is the time they
 * give in place of a system clock-out, which then stops counting (its exception is
 * corrected). Every change recalculates the day in the same transaction and is audited
 * with before and after.
 *
 * A day is judged once (§6.4): on its first clock-in, by the policy version that clock-in was
 * judged by and the work schedule in force on the date; for a day with none, by the version and
 * schedule in force on its date when the day-close closes it. Both, and the shift, are recorded
 * on the day, and every later recalculation reads them back (policies.rulesOfVersion), never a
 * newer version or schedule. A recalculation then settles what follows from the day, in the same
 * transaction (settle): its pending deductions and overtime (attendance.pay.js) and the
 * consequence rules it counts toward (attendance.rules-engine.js).
 *
 * A system clock-out (attendance.clock-watch.js) opens nothing by itself: the person gives the
 * real time of one they think wrong (explainAutomatic), and only then do People decide it.
 *
 * The day-close (jobs/schedulers/attendance-day-close.js, 01:30 Lagos) closes every day
 * before today within 14 days that is still open: an open shift becomes one
 * missing_clock_out exception, an expected working day of the person's own schedule with no
 * clock-in becomes absent, granted leave becomes leave. It never invents a clock-out time. Run
 * twice, or stopped half way and run again, it closes nothing twice and opens no exception
 * twice: a closed day is skipped, and each exception has a unique key.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { assertInScope } = require("../../shared/rbac/scope");
const lagos = require("../../shared/time/lagos");
const workingWeek = require("../../shared/time/working-week");
const policies = require("../policies/policies.service");
const calendar = require("./attendance.calendar");
const guard = require("./attendance.clock-guard");
const lateness = require("./attendance.lateness");
const pay = require("./attendance.pay");
const rulesEngine = require("./attendance.rules-engine");
const rules = require("./attendance.rules");
const repo = require("./attendance.repo");
const { EVENTS } = require("./attendance.events");

/** How far back the day-close looks for days still open. */
const CLOSE_LOOKBACK_DAYS = 14;

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That exception does not exist", 404);

/** The punches that count for the day: active, and not excluded by a decision. */
const counted = (events) => events.filter((e) => !e.excluded);

/**
 * What judges a day (§6.4): the version and shift recorded on it once judged; else, on its first
 * clock-in or when the day-close closes it, the version that clock-in was judged by (or the one in
 * force on the date) and the schedule in force on the date, to be recorded now (`record`); else,
 * not yet judged, what is in force on the date.
 * @returns {Promise<{rules: object, policy_version_id: string|null, shift: object, record: object|null}>}
 */
async function judgementOf(client, person, date, { existing, events, close, ctx }) {
  if (existing && existing.judged_at) {
    const v = await policies.rulesOfVersion(client, "attendance", existing.policy_version_id);
    return { rules: v.rules, policy_version_id: existing.policy_version_id, shift: rules.recordedShift(existing, v.rules), record: null };
  }
  const clockIn = counted(events).find((e) => e.event_type === "clock_in") || null;
  if (!clockIn && !close) return { rules: ctx.policy, policy_version_id: ctx.policy.policy_version_id, shift: ctx.shift, record: null };
  const v = clockIn
    ? await policies.rulesOfVersion(client, "attendance", clockIn.policy_version_id)
    : await policies.rulesFor(client, "attendance", date);
  const schedule = await repo.workScheduleOn(client, person.employee_id, date);
  const shift = rules.shiftFor(date, await workingWeek.loadCalendar(client), v.rules, { schedule, pattern: person.work_pattern });
  return {
    rules: v.rules,
    policy_version_id: v.policy_version_id,
    shift,
    record: {
      policy_version_id: v.policy_version_id,
      attendance_work_schedule_id: shift.attendance_work_schedule_id,
      shift_working: shift.working_day,
      shift_starts_at: shift.starts_at,
      shift_ends_at: shift.ends_at,
    },
  };
}

/**
 * Recalculate a person's day from its punches, in the caller's transaction (after the
 * person's lock), and settle what follows from it (settle) unless `settle` is false: the caller
 * then settles once it has opened the day's exceptions, which the rules count. A day with
 * nothing to say (no counted punch, not closed, no leave) gets no row; one that has a row
 * keeps it.
 * @returns {Promise<{day: object|null, events: object[], ctx: object, leave: object|null, judged: object}>}
 */
async function recomputeDay(client, person, date, { close = false, settle: settleNow = true } = {}) {
  const ctx = await calendar.contextFor(client, person, date);
  const leave = await repo.grantedLeave(client, person.employee_id, date);
  const existing = await repo.getDay(client, person.employee_id, date);
  const events = await repo.eventsOn(client, person.employee_id, date);
  const judged = await judgementOf(client, person, date, { existing, events, close, ctx });
  const projection = rules.projectDay({
    events: counted(events),
    shift: judged.shift,
    date,
    timeZone: ctx.timeZone,
    onLeave: Boolean(leave),
    closed: close || Boolean(existing && existing.closed_at),
    expected: person.has_login !== false,
    overtimeAfter: judged.rules.overtime.after_minutes,
    late: lateness.minutesLate,
    early: lateness.minutesEarly,
    overtime: lateness.minutesOvertime,
  });
  if (!existing && projection.status === null) return { day: null, events, ctx, leave, judged };
  const day = await repo.upsertDay(client, person.employee_id, date, projection, { closed: close, judged: judged.record });
  const r = { day, events, ctx, leave, judged };
  if (settleNow) await settle(client, person, r);
  return r;
}

/**
 * What judges a person's day as it stands, without writing it: the clock watch reads the shift and
 * the reminder figures of an open shift's day from it (§6.14).
 * @returns {Promise<{judged: object, timeZone: string, ctx: object}>}
 */
async function judgedOn(db, person, date) {
  const ctx = await calendar.contextFor(db, person, date);
  const existing = await repo.getDay(db, person.employee_id, date);
  const events = await repo.eventsOn(db, person.employee_id, date);
  const judged = await judgementOf(db, person, date, { existing, events, close: false, ctx });
  return { judged, timeZone: ctx.timeZone, ctx };
}

/**
 * What follows from a recalculated day, in its transaction: its pay items follow it under the
 * version that judged it (§6.17), and the rules in force on the date count it (§6.16).
 * @param {import("pg").PoolClient} client
 * @param {object} person  repo.person()
 * @param {{day: object|null, judged: object}} r  recomputeDay()'s answer
 */
async function settle(client, person, r) {
  if (!r.day) return;
  await pay.settleDay(client, person, r.day, {
    rules: r.judged.rules,
    shift: r.judged.shift,
    policy_version_id: r.judged.policy_version_id,
  });
  await rulesEngine.countDay(client, person, String(r.day.attendance_date).slice(0, 10));
}

/* ------------------------------------------------------------------ *
 * Exceptions
 * ------------------------------------------------------------------ */

const LOCATION_REASON = Object.freeze({
  denied: "location was not shared",
  unavailable: "no location reading",
  timeout: "the location reading timed out",
  unsupported: "the device cannot share its location",
  no_location: "no location reading",
  poor_accuracy: "the reading was not accurate enough",
});

/** One line saying what an exception is about, from its evidence; a check-in's says so (§6.12). */
function detailOf(type, evidence = {}) {
  const ev = evidence || {};
  if (ev.check_in) return `Check-in: ${detailOf(type, { ...ev, check_in: false })}`;
  switch (type) {
    case "outside_worksite":
      return `${ev.distance_m} m from ${ev.place === "client_visit" ? "the client's site" : ev.worksite_name}, radius ${ev.radius_m} m`;
    case "outside_home":
      return `${ev.distance_m} m from the ${ev.place === "temporary_home" ? "temporary" : "approved"} home, radius ${ev.radius_m} m`;
    case "location_unverified":
      if (ev.reason === "no_home") return "No approved home";
      if (ev.reason === "no_worksite") return "No office assigned";
      return ev.reason === "poor_accuracy" && ev.accuracy_m
        ? `Reading accurate to ${Math.round(ev.accuracy_m)} m`
        : `No location: ${LOCATION_REASON[ev.reason] || "no location reading"}`;
    case "unknown_device":
      return ev.device_label ? `Unregistered device: ${ev.device_label}` : "No registered device";
    case "suspicious_timestamp":
      return `Device clock ${Math.max(1, Math.round(Math.abs(ev.skew_seconds || 0) / 60))} min ahead`;
    case "missing_clock_out":
      return ev.clock_in_at
        ? `Clocked in ${rules.localTime(ev.clock_in_at, ev.timezone || rules.DEFAULT_TZ)}, no clock-out`
        : "No clock-out";
    case "automatic_clock_out": {
      const at = ev.clock_out_at ? `System Clock-Out at ${rules.localTime(ev.clock_out_at, ev.timezone || rules.DEFAULT_TZ)}` : "System Clock-Out";
      return ev.real_time ? `${at}; real time ${ev.real_time}` : at;
    }
    default:
      return type;
  }
}

/** A repo row as the contract's AttendanceException: the real time a person gave is kept in its evidence. */
function present(row) {
  if (!row) return row;
  const { evidence, employee_id: _e, ...out } = row;
  return { ...out, detail: detailOf(row.exception_type, evidence), real_time: (evidence && evidence.real_time) || null };
}

const presentPage = (page) => ({ ...page, data: page.data.map(present) });

const OUTCOME = Object.freeze({ accept: "accepted", reject: "rejected", add_clock_out: "corrected" });
const OUTCOME_TEXT = Object.freeze({
  accepted: "the record stands",
  rejected: "the punch does not count",
  corrected: "a clock-out was added",
});
/** The exception types a clock-out time decides: the missing one, or the real one in place of the system's. */
const TAKES_TIME = new Set(["missing_clock_out", "automatic_clock_out"]);
/** What a decision on a check-in's flag means to the person: it clears, or it stands. */
const CHECK_IN_TEXT = Object.freeze({ accepted: "the check-in's flag is cleared", rejected: "the check-in's flag stands" });
const outcomeText = (type, outcome) =>
  type === "automatic_clock_out" && outcome === "corrected" ? "the clock-out time was corrected" : OUTCOME_TEXT[outcome];

/**
 * People decide an open exception: accept it, reject the punch, or add the missing
 * clock-out. Only `people` approve with scope all, and never on their own record.
 */
async function decide(actor, scope, id, body) {
  if (scope.scope !== "all")
    throw new AppError("FORBIDDEN", "Only People with access to everyone decide attendance exceptions", 403);
  const x = await repo.getException(pool, id);
  if (!x) throw notFound();
  if (x.employee_id === actor.employee_id)
    throw new AppError("OWN_RECORD", "Someone else decides your own attendance", 403);
  if (x.status !== "open") throw new AppError("EXCEPTION_DECIDED", "This exception was already decided", 409);
  if (body.decision === "add_clock_out" && !TAKES_TIME.has(x.exception_type))
    throw new AppError("DECISION_INVALID", "Only a missing or automatic clock-out takes a time", 422, {
      decision: ["Not for this"],
    });
  // A check-in's flag is rejected as a punch's is: it stays counted toward Location Flags (§6.8, PR 4).
  if (body.decision === "reject" && !x.attendance_event_id && !x.attendance_check_in_id)
    throw new AppError("DECISION_INVALID", "There is no punch to reject", 422, { decision: ["Not for this"] });
  // Rejecting a system clock-out would leave the shift open: keep its time or correct it.
  if (body.decision === "reject" && x.exception_type === "automatic_clock_out")
    throw new AppError("DECISION_INVALID", "Keep or correct a System Clock-Out", 422, { decision: ["Not for this"] });

  const outcome = OUTCOME[body.decision];
  await tx(async (client) => {
    await repo.lockEmployee(client, x.employee_id);
    const person = await repo.person(client, x.employee_id);
    if (body.decision === "add_clock_out") {
      const ctx = await calendar.contextFor(client, person, x.work_date);
      const events = counted(await repo.eventsOn(client, x.employee_id, x.work_date));
      const clockIn = events.find((e) => e.event_type === "clock_in");
      const at = rules.zonedInstant(x.work_date, body.clock_out_time, ctx.timeZone);
      if (!clockIn || at <= new Date(clockIn.occurred_at) || at > new Date())
        throw new AppError("CLOCK_OUT_TIME", "Give a time after the clock-in", 422, {
          clock_out_time: ["After the clock-in"],
        });
      try {
        await repo.insertEvent(client, {
          employee_id: x.employee_id,
          event_type: "clock_out",
          occurred_at: at,
          work_date: x.work_date,
          worksite_id: ctx.fence ? ctx.fence.worksite_id : null,
          policy_version_id: ctx.policy.policy_version_id,
          source: "admin",
          validation_state: "accepted",
          validation: { correction: { attendance_exception_id: id }, reasons: [] },
          recorded_by: actor.user_id,
          reason: body.resolution,
        });
      } catch (err) {
        if (err && err.code === "23505")
          throw new AppError("ALREADY_CLOCKED_OUT", "This day already has a clock-out", 409);
        throw err;
      }
    }
    const done = await repo.resolveException(client, id, { outcome, resolution: body.resolution, by: actor.user_id });
    if (!done) throw new AppError("EXCEPTION_DECIDED", "This exception was already decided", 409);
    // A check-in is never the shift: deciding its flag leaves the day as it is.
    if (!x.attendance_check_in_id) await recomputeDay(client, person, x.work_date);
    await emit(client, {
      key: EVENTS.ATTENDANCE_EXCEPTION_DECIDED,
      entity: { type: "attendance_exception", id },
      actor,
      before: { status: "open", outcome: null },
      after: { status: "resolved", outcome, resolution: body.resolution, clock_out_time: body.clock_out_time || null },
      payload: {
        attendance_exception_id: id,
        employee_id: x.employee_id,
        subject_employee_id: x.employee_id,
        work_date: x.work_date,
        exception_type: x.exception_type,
        outcome,
        outcome_text: x.attendance_check_in_id ? CHECK_IN_TEXT[outcome] : outcomeText(x.exception_type, outcome),
      },
    });
  });
  return present(await repo.getException(pool, id));
}

/** The person explains an open exception of their own. */
async function explain(user, id, body) {
  const x = await repo.getException(pool, id);
  if (!x || x.employee_id !== user.employee_id) throw notFound();
  if (x.status !== "open") throw new AppError("EXCEPTION_DECIDED", "This exception was already decided", 409);
  await tx(async (client) => {
    if (!(await repo.explainException(client, id, body.employee_note)))
      throw new AppError("EXCEPTION_DECIDED", "This exception was already decided", 409);
    await emit(client, {
      key: EVENTS.ATTENDANCE_EXCEPTION_EXPLAINED,
      entity: { type: "attendance_exception", id },
      actor: user,
      before: { employee_note: x.employee_note },
      after: { employee_note: body.employee_note },
      payload: {
        attendance_exception_id: id,
        employee_id: x.employee_id,
        subject_employee_id: x.employee_id,
        employee_name: x.employee.display_name,
        work_date: x.work_date,
      },
    });
  });
  return present(await repo.getException(pool, id));
}

/**
 * Give Real Time: the person gives the real leaving time of a System Clock-Out of their own, with a
 * note. Its exception opens with both, for People to keep the system's time or correct it from the
 * one given (§6.8, §6.14). Once per punch; the time is after the clock-in and not in the future.
 * @param {object} user
 * @param {string} eventId  the system clock-out
 * @param {{employee_note: string, real_time: string}} body  RealTimeGiven
 */
async function explainAutomatic(user, eventId, body, { now = new Date() } = {}) {
  const ev = await repo.eventFor(pool, eventId);
  if (!ev || ev.employee_id !== user.employee_id || !ev.attendance_day_id)
    throw new AppError("NOT_FOUND", "Not found", 404);
  if (ev.source !== "system" || ev.event_type !== "clock_out")
    throw new AppError("NOT_AUTOMATIC", "Only a System Clock-Out takes a real time", 422);
  const already = () => new AppError("ALREADY_EXPLAINED", "You have already given the real time", 409);
  const id = await tx(async (client) => {
    await repo.lockEmployee(client, ev.employee_id);
    if (await repo.hasException(client, eventId, "automatic_clock_out")) throw already();
    const person = await repo.person(client, ev.employee_id);
    const zone = ev.timezone || rules.DEFAULT_TZ;
    const clockIn = counted(await repo.eventsOn(client, ev.employee_id, ev.work_date)).find((e) => e.event_type === "clock_in");
    const realAt = rules.zonedInstant(ev.work_date, body.real_time, zone);
    if (!clockIn || realAt <= new Date(clockIn.occurred_at) || realAt > now)
      throw new AppError("REAL_TIME_INVALID", "Give a time after your clock-in", 422, { real_time: ["After your clock-in"] });
    const x = await repo.insertException(client, {
      attendance_day_id: ev.attendance_day_id,
      attendance_event_id: eventId,
      exception_type: "automatic_clock_out",
      severity: "low",
      evidence: {
        clock_out_at: ev.occurred_at,
        timezone: zone,
        event_type: "clock_out",
        real_time: body.real_time,
        real_at: realAt.toISOString(),
      },
    });
    if (!x) throw already();
    await repo.explainException(client, x.attendance_exception_id, body.employee_note);
    await emit(client, {
      key: EVENTS.ATTENDANCE_EXCEPTION_EXPLAINED,
      entity: { type: "attendance_exception", id: x.attendance_exception_id },
      actor: user,
      after: { exception_type: "automatic_clock_out", employee_note: body.employee_note, real_time: body.real_time },
      payload: {
        attendance_exception_id: x.attendance_exception_id,
        employee_id: ev.employee_id,
        subject_employee_id: ev.employee_id,
        employee_name: person.ref.display_name,
        work_date: ev.work_date,
      },
    });
    return x.attendance_exception_id;
  });
  return present(await repo.getException(pool, id));
}

/** One exception, within a scope. */
async function getFor(id, scope) {
  const x = await repo.getException(pool, id);
  if (!x) throw notFound();
  assertInScope(scope, x.employee_id);
  return present(x);
}

/* ------------------------------------------------------------------ *
 * The day-close
 * ------------------------------------------------------------------ */

/**
 * Close one person's day, once. In its own transaction, after the person's lock, so a
 * late clock-out arriving at the same moment is either in the day or refused. The day is judged
 * now if no clock-in judged it, and settled once its missing clock-out is open: it counts toward
 * Forgotten Clock-Outs (§6.16).
 * @returns {Promise<null|{status: string|null, missing_clock_out: boolean}>}
 */
async function closeDay(employeeId, date) {
  return tx(async (client) => {
    await repo.lockEmployee(client, employeeId);
    const existing = await repo.getDay(client, employeeId, date);
    if (existing && existing.closed_at) return null;
    const person = await repo.person(client, employeeId);
    if (!person) return null;
    const r = await recomputeDay(client, person, date, { close: true, settle: false });
    if (!r.day) return null;

    const active = counted(r.events);
    let missing = false;
    if (guard.isOpen(active)) {
      const clockIn = active.find((e) => e.event_type === "clock_in");
      const x = await repo.insertException(client, {
        attendance_day_id: r.day.attendance_day_id,
        attendance_event_id: null,
        exception_type: "missing_clock_out",
        severity: "medium",
        evidence: { clock_in_at: clockIn ? clockIn.occurred_at : null, timezone: r.ctx.timeZone },
      });
      if (x) {
        missing = true;
        await emit(client, {
          key: EVENTS.ATTENDANCE_REVIEW_REQUIRED,
          entity: { type: "attendance_exception", id: x.attendance_exception_id },
          actor: null,
          payload: {
            attendance_day_id: r.day.attendance_day_id,
            employee_id: employeeId,
            subject_employee_id: employeeId,
            employee_name: person.ref.display_name,
            work_date: date,
            types: ["missing_clock_out"],
          },
          dedup_key: `attendance-missing-out:${r.day.attendance_day_id}`,
        });
      }
    }
    await settle(client, person, r);
    await emit(client, {
      key: EVENTS.ATTENDANCE_DAY_CLOSED,
      entity: { type: "attendance_record", id: r.day.attendance_day_id },
      actor: null,
      after: { status: r.day.status, closed: true },
      payload: { attendance_day_id: r.day.attendance_day_id, employee_id: employeeId, work_date: date, status: r.day.status },
      dedup_key: `attendance-day-closed:${r.day.attendance_day_id}`,
    });
    return { status: r.day.status, missing_clock_out: missing };
  });
}

/**
 * Close every open day before today (Lagos) within the lookback, and the days people did not come
 * in on that were worked for them (their schedule, else the company hours in force that day; §6.13),
 * from the first day anyone punched. Idempotent.
 * @param {{now?: Date}} [opts]
 */
async function closeDays({ now = new Date() } = {}) {
  const today = lagos.today(now);
  const since = lagos.addDays(today, -CLOSE_LOOKBACK_DAYS);
  const tally = { closed: 0, absent: 0, leave: 0, missing_clock_out: 0 };
  const count = (r) => {
    if (!r) return;
    tally.closed += 1;
    if (r.status === "absent") tally.absent += 1;
    if (r.status === "leave") tally.leave += 1;
    if (r.missing_clock_out) tally.missing_clock_out += 1;
  };

  for (const d of await repo.unclosedDays(pool, since, today)) count(await closeDay(d.employee_id, d.attendance_date));

  const start = await repo.attendanceStart(pool);
  if (start) {
    for (let d = start > since ? start : since; d < today; d = lagos.addDays(d, 1)) {
      const hours = await calendar.companyHoursOn(pool, d);
      for (const e of await repo.withoutDay(pool, d, { hours })) count(await closeDay(e.employee_id, d));
    }
  }
  return { today, ...tally };
}

module.exports = {
  CLOSE_LOOKBACK_DAYS,
  judgementOf,
  judgedOn,
  recomputeDay,
  settle,
  detailOf,
  present,
  presentPage,
  decide,
  explain,
  explainAutomatic,
  getFor,
  closeDay,
  closeDays,
};
