"use strict";
/**
 * Attendance: the one write path for a punch, and the reads behind the clock, My
 * Attendance and People · Attendance (docs/guides/attendance.md §3, §5, §6).
 *
 * A punch, in one transaction, after the person's advisory lock:
 *
 *   1. the idempotency key: a punch this key already made is answered again, unchanged
 *   2. the person: employed, and not on granted leave that day
 *   3. the work date at the workplace (the server's time, the worksite's zone); a
 *      clock-out closes today's shift, or yesterday's while yesterday is still open
 *   4. the clock guard on that date's active events (attendance.clock-guard.js); a
 *      refusal writes nothing and is a 409
 *   5. the device: the session's known device, recorded by the devices service the first
 *      time it punches, judged by the device mode (devices.guard.js)
 *   6. the geofence: the reading against the expected worksite (for remote staff, the
 *      approved home; on a day an approved work location request covers, what it names; on a
 *      field assignment's day, the nearer of its sites),
 *      judged by the geofence mode (attendance.geofence.js); the time: the device's clock
 *      against the server's
 *   7. the strictest result is recorded with its evidence (attendance_event, append-only),
 *      the day recalculated (judged on its first clock-in, attendance.reconcile.js), an
 *      exception opened for each check that wants review, then the day's pay items and rule
 *      counts settled, and attendance.punched (and attendance.review_required) emitted, all
 *      committed together
 *
 * The unique index on active events is the backstop for anything the lock missed: its
 * violation is the same 409. A rejected punch is recorded as an attempt, counts for
 * nothing and opens no exception. A clock-in that counts reads the day's reminder to clock
 * in, and a clock-out the day's reminders to clock out, if the clock watch sent them
 * (attendance.clock-watch.js, which also makes the System Clock-Out).
 */
const crypto = require("node:crypto");
const { pool } = require("../../config/db");
const { config } = require("../../config/env");
const requestContext = require("../../config/request-context");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const exportFiles = require("../../shared/documents/exports");
const { exportFilename } = require("../../shared/spreadsheet/cells");
const { assertInScope } = require("../../shared/rbac/scope");
const lagos = require("../../shared/time/lagos");
const { formatDate } = require("../../shared/time/day-first");
const identity = require("../identity/identity.service");
const notifications = require("../notifications/notifications.service");
const devices = require("../devices/devices.service");
const deviceGuard = require("../devices/devices.guard");
const calendar = require("./attendance.calendar");
const clockWatch = require("./attendance.clock-watch");
const guard = require("./attendance.clock-guard");
const { decideGeofence } = require("./attendance.geofence");
const reconcile = require("./attendance.reconcile");
const attendanceExport = require("./attendance.export");
const rules = require("./attendance.rules");
const repo = require("./attendance.repo");
const sites = require("./attendance.sites");
const checkIns = require("./attendance.check-ins");
const { EVENTS } = require("./attendance.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const SEVERITY = Object.freeze({
  outside_worksite: "medium",
  outside_home: "medium",
  location_unverified: "low",
  unknown_device: "high",
  suspicious_timestamp: "medium",
  missing_clock_out: "medium",
  automatic_clock_out: "low",
});

/** What a person reads about each reason, inside a sentence. */
function reasonText(code, ev) {
  switch (code) {
    case "outside_worksite":
      return ev.geofence.place === "client_visit"
        ? `you were ${ev.geofence.distance_m} m from the client's site`
        : `you were ${ev.geofence.distance_m} m from ${ev.geofence.worksite_name}`;
    case "outside_home":
      return ev.geofence.place === "temporary_home"
        ? `you were ${ev.geofence.distance_m} m from your temporary home`
        : `you were ${ev.geofence.distance_m} m from your approved home`;
    case "location_unverified":
      if (ev.geofence.reason === "no_home") return "you have no approved home location yet";
      if (ev.geofence.reason === "no_worksite") return "you have no office assigned yet";
      return ev.geofence.reason === "poor_accuracy"
        ? "your location reading was not accurate enough"
        : "your location could not be checked";
    case "unknown_device":
      return "this device is not registered";
    case "suspicious_timestamp":
      return "this device's clock is ahead";
    default:
      return code;
  }
}

/** One line for the person: what happened to the punch. */
function messageOf(row) {
  const v = row.validation || {};
  const reasons = v.reasons || [];
  const at = rules.localTime(row.occurred_at, (v.time && v.time.timezone) || rules.DEFAULT_TZ);
  const action = row.event_type === "clock_in" ? "Clocked in" : "Clocked out";
  if (row.validation_state === "accepted") return `${action} at ${at}.`;
  const why = reasons.map((r) => reasonText(r, v)).join(" and ");
  if (row.validation_state === "review") return `${action} at ${at}. People will review it: ${why}.`;
  return `Not counted: ${why}.`;
}

/* ------------------------------------------------------------------ *
 * The person's state
 * ------------------------------------------------------------------ */

const notEmployed = () =>
  new AppError("NOT_EMPLOYED", "Only people who work here now can clock in.", 422);

/** The shift the person is in, if any: today's, or yesterday's while it is still open. */
async function openSession(db, employeeId, date) {
  const todayEvents = await repo.eventsOn(db, employeeId, date);
  if (guard.isOpen(todayEvents)) return { date, events: todayEvents };
  const yesterday = lagos.addDays(date, -1);
  const day = await repo.getDay(db, employeeId, yesterday);
  if (day && !day.closed_at) {
    const before = await repo.eventsOn(db, employeeId, yesterday);
    if (guard.isOpen(before)) return { date: yesterday, events: before };
  }
  return { date: null, events: todayEvents };
}

/** A shift as the clock and the register show it: its day, hours, grace and why it is off. */
const shiftOut = (shift, offReason = shift.off_reason) => ({
  working_day: shift.working_day,
  starts_at: shift.starts_at,
  ends_at: shift.ends_at,
  grace_minutes: shift.grace_minutes,
  off_reason: shift.working_day ? null : offReason || rules.OFF_DAY,
});

/**
 * GET /attendance/me/today: the server's word on where the person stands. The shift is the
 * person's own (§6.13), as their day was judged once it was (§6.4).
 * @param {{user_id: string, employee_id: string, session_id: string}} user
 */
async function today(user, { now = new Date() } = {}) {
  const person = await repo.person(pool, user.employee_id);
  if (!person) throw notEmployed();
  const zone = await sites.zoneAt(pool, person, now, calendar.zoneOf(person));
  const date = rules.localDate(now, zone);
  const session = await openSession(pool, user.employee_id, date);
  const sessionDate = session.date || date;
  const { judged, ctx } = await reconcile.judgedOn(pool, person, sessionDate);
  const leave = await repo.grantedLeave(pool, user.employee_id, date);
  const day = await repo.getDay(pool, user.employee_id, sessionDate);
  const active = session.events.filter((e) => !e.excluded);
  const clockIn = active.find((e) => e.event_type === "clock_in") || null;
  const clockOut = active.find((e) => e.event_type === "clock_out") || null;
  const device = await devices.statusForSession(pool, user);
  // Working from home: a Remote day of the person's week, or remote staff with no schedule (§6.13).
  const remote = ctx.home_day;
  let homeState = null;
  if (person.work_pattern === "remote" || remote) {
    const homes = await repo.homesOf(pool, user.employee_id);
    homeState = homes.approved ? "approved" : homes.pending ? "pending" : "none";
  }

  let state = "not_clocked_in";
  if (person.status !== "active") state = "unavailable";
  else if (session.date) state = "clocked_in";
  else if (leave) state = "unavailable";
  else if (clockIn && clockOut) state = "clocked_out";
  // The sign-in prompt (§6.14): the first session of a working day, not yet clocked in.
  const signInPrompt =
    state === "not_clocked_in" && ctx.shift.working_day === true && (await repo.firstSessionOn(pool, user, lagos.today(now)));

  return {
    date: sessionDate,
    timezone: ctx.timeZone,
    server_time: now.toISOString(),
    state,
    unavailable_reason: person.status !== "active" ? "not_employed" : leave && !session.date ? "leave" : null,
    leave: leave ? { starts_on: leave.starts_on, ends_on: leave.ends_on, leave_type_name: leave.leave_type_name } : null,
    clock_in_at: clockIn ? new Date(clockIn.occurred_at).toISOString() : null,
    clock_out_at: clockOut ? new Date(clockOut.occurred_at).toISOString() : null,
    clock_out_automatic: Boolean(clockOut && clockOut.source === "system"),
    sign_in_prompt: signInPrompt,
    review: (await repo.openExceptionCount(pool, day ? day.attendance_day_id : null)) > 0,
    shift: shiftOut(judged.shift, ctx.shift.off_reason),
    work_pattern: person.work_pattern,
    location: ctx.approved
      ? { kind: "approved_day", name: ctx.approved.name, radius_m: null, home_state: homeState }
      : ctx.fence
        ? { kind: ctx.fence.kind, name: ctx.fence.name, radius_m: ctx.fence.radius_m, home_state: homeState }
        : { kind: remote ? "remote" : "none", name: null, radius_m: null, home_state: homeState },
    policy: {
      geofence_mode: ctx.policy.geofence_mode,
      device_mode: ctx.policy.device_mode,
      max_accuracy_m: ctx.policy.max_accuracy_m,
    },
    device,
    temporary_site: sites.todayOf(ctx.site || null),
    check_ins: ctx.site ? await checkIns.onDay(pool, user.employee_id, sessionDate) : [],
  };
}

/* ------------------------------------------------------------------ *
 * The punch
 * ------------------------------------------------------------------ */

/** A recorded punch as the contract's PunchResult, with the state after it. */
async function resultOf(user, row, { replayed, now }) {
  const v = row.validation || {};
  return {
    attendance_event_id: row.attendance_event_id,
    event_type: row.event_type,
    validation_state: row.validation_state,
    occurred_at: new Date(row.occurred_at).toISOString(),
    device_at: row.device_at ? new Date(row.device_at).toISOString() : null,
    work_date: row.work_date,
    reasons: v.reasons || [],
    distance_m: row.distance_m === null || row.distance_m === undefined ? null : Number(row.distance_m),
    worksite_name: row.worksite_name || null,
    message: messageOf(row),
    replayed,
    today: await today(user, { now }),
  };
}

const conflict = (reason, message) => new AppError(reason, message, 409);

/**
 * POST /attendance/punches.
 * @param {{user_id: string, employee_id: string, session_id: string, ip?: string}} user  the session's
 * @param {object} body  PunchCreate
 * @param {{idempotencyKey: string, now?: Date}} opts
 */
async function punch(user, body, { idempotencyKey, now = new Date() } = {}) {
  if (!idempotencyKey)
    throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key with every punch.", 428);
  const employeeId = user.employee_id;

  const outcome = await tx(async (client) => {
    await repo.lockEmployee(client, employeeId);
    const prior = await repo.eventByKey(client, employeeId, idempotencyKey);
    if (prior) return { row: prior, replayed: true };

    const person = await repo.person(client, employeeId);
    if (!person || person.status !== "active") throw notEmployed();
    const zone = await sites.zoneAt(client, person, now, calendar.zoneOf(person));
    const date = rules.localDate(now, zone);
    const leave = await repo.grantedLeave(client, employeeId, date);
    if (leave)
      throw new AppError(
        "ON_LEAVE",
        `You are on ${leave.leave_type_name} leave from ${formatDate(leave.starts_on)} to ${formatDate(leave.ends_on)}.`,
        422,
      );

    let workDate = date;
    let dayEvents = await repo.eventsOn(client, employeeId, date);
    if (body.event_type === "clock_out" && !guard.isOpen(dayEvents)) {
      const session = await openSession(client, employeeId, date);
      if (session.date) {
        workDate = session.date;
        dayEvents = session.events;
      }
    }
    const transition = guard.evaluateClockTransition({ events: dayEvents, eventType: body.event_type });
    if (!transition.allowed) throw conflict(transition.reason, transition.message);

    const ctx = await calendar.contextFor(client, person, workDate);
    const knownDeviceId = await identity.sessionDevice(client, user);
    const device = await devices.observeForPunch(client, { employeeId, knownDeviceId });
    const deviceDecision = deviceGuard.evaluateDevice({
      mode: ctx.policy.device_mode,
      status: device ? device.status : null,
      first_seen: device ? device.first_seen : false,
      has_session_device: Boolean(device),
    });
    const point = body.latitude === null ? null : { latitude: body.latitude, longitude: body.longitude };
    const geofence = decideGeofence({
      mode: ctx.policy.geofence_mode,
      point,
      accuracy_m: body.accuracy_m,
      location_error: body.location_error || null,
      expected: ctx.fence,
      approved: ctx.approved || null,
      work_pattern: person.work_pattern,
      home_day: ctx.home_day,
      max_accuracy_m: ctx.policy.max_accuracy_m,
    });
    const time = rules.timeCheck({ server_at: now, device_at: body.device_at });
    const timeResult = time.future ? "review" : "accepted";
    const result = rules.strictest(geofence.result, deviceDecision.result, timeResult);

    const checks = [
      geofence.result !== "accepted" ? geofence.exception || geofence.outside : null,
      deviceDecision.result !== "accepted" ? "unknown_device" : null,
      time.future ? "suspicious_timestamp" : null,
    ].filter(Boolean);
    const reasons = result === "rejected"
      ? checks.filter((c) => (c === "unknown_device" ? deviceDecision.result : geofence.result) === "rejected")
      : checks;

    const validation = {
      policy: {
        policy_version_id: ctx.policy.policy_version_id,
        geofence_mode: ctx.policy.geofence_mode,
        device_mode: ctx.policy.device_mode,
        max_accuracy_m: ctx.policy.max_accuracy_m,
      },
      geofence: {
        verdict: geofence.verdict,
        reason: geofence.reason,
        distance_m: geofence.distance_m,
        radius_m: geofence.radius_m,
        accuracy: geofence.accuracy,
        place: geofence.place,
        worksite_id: geofence.worksite_id,
        worksite_name: geofence.worksite_name,
        home_id: geofence.home_id,
        request_id: geofence.request_id,
        assignment_id: geofence.assignment_id,
        site_id: geofence.site_id,
        temporary_site_id: (ctx.fence && ctx.fence.temporary_site_id) || null,
        result: geofence.result,
      },
      device: {
        state: deviceDecision.state,
        reason: deviceDecision.reason,
        attendance_device_id: device ? device.attendance_device_id : null,
        label: device ? device.label : null,
        first_seen: device ? device.first_seen : false,
        result: deviceDecision.result,
      },
      time: { ...time, timezone: ctx.timeZone, server_at: now.toISOString(), device_at: body.device_at },
      reasons,
    };

    let row;
    try {
      row = await repo.insertEvent(client, {
        employee_id: employeeId,
        event_type: body.event_type,
        occurred_at: now,
        work_date: workDate,
        device_at: body.device_at,
        worksite_id: geofence.worksite_id,
        known_device_id: knownDeviceId,
        attendance_device_id: device ? device.attendance_device_id : null,
        policy_version_id: ctx.policy.policy_version_id,
        latitude: point ? point.latitude : null,
        longitude: point ? point.longitude : null,
        accuracy_m: body.accuracy_m,
        distance_m: geofence.distance_m,
        source: "pwa",
        validation_state: result,
        validation,
        request_id: requestContext.getRequestId(),
        idempotency_key: idempotencyKey,
        note: body.note,
      });
    } catch (err) {
      if (err && err.code === "23505" && /one_active/.test(String(err.constraint || err.message)))
        throw conflict(
          body.event_type === "clock_in" ? "ALREADY_CLOCKED_IN" : "ALREADY_CLOCKED_OUT",
          body.event_type === "clock_in" ? guard.MESSAGES.ALREADY_CLOCKED_IN : guard.MESSAGES.ALREADY_CLOCKED_OUT,
        );
      throw err;
    }
    if (device) await devices.notePunch(client, device.attendance_device_id, now);

    const opened = [];
    let dayId = null;
    if (result !== "rejected") {
      // Settled once the day's exceptions are open: Location Flags counts them (§6.16).
      const r = await reconcile.recomputeDay(client, person, workDate, { settle: false });
      dayId = r.day ? r.day.attendance_day_id : null;
      for (const type of reasons) {
        const x = await repo.insertException(client, {
          attendance_day_id: dayId,
          attendance_event_id: row.attendance_event_id,
          exception_type: type,
          severity: SEVERITY[type],
          evidence:
            type === "unknown_device"
              ? { device_label: validation.device.label, reason: deviceDecision.reason, event_type: body.event_type }
              : type === "suspicious_timestamp"
                ? { skew_seconds: time.skew_seconds, event_type: body.event_type }
                : {
                    reason: geofence.reason,
                    place: geofence.place,
                    distance_m: geofence.distance_m,
                    radius_m: geofence.radius_m,
                    worksite_name: geofence.worksite_name,
                    accuracy_m: body.accuracy_m,
                    event_type: body.event_type,
                  },
        });
        if (x) opened.push(x);
      }
      await reconcile.settle(client, person, r);
    }

    // The day's reminders have done their work: a push still held is not sent.
    if (result !== "rejected") {
      const kind = body.event_type === "clock_in" ? "clock_in_due" : "clock_out_due";
      for (const reminder of await repo.remindersOn(client, employeeId, workDate, kind))
        await notifications.markReadForRecord(client, user, "attendance_clock_reminder", reminder.attendance_clock_reminder_id);
    }

    const facts = {
      attendance_event_id: row.attendance_event_id,
      attendance_day_id: dayId,
      employee_id: employeeId,
      subject_employee_id: employeeId,
      event_type: body.event_type,
      result,
      work_date: workDate,
      reasons,
    };
    await emit(client, {
      key: EVENTS.ATTENDANCE_PUNCHED,
      entity: { type: "attendance_event", id: row.attendance_event_id },
      actor: user,
      after: {
        event_type: body.event_type,
        validation_state: result,
        work_date: workDate,
        reasons,
        device: device ? { attendance_device_id: device.attendance_device_id, first_seen: device.first_seen } : null,
      },
      payload: facts,
    });
    if (opened.length > 0)
      await emit(client, {
        key: EVENTS.ATTENDANCE_REVIEW_REQUIRED,
        entity: { type: "attendance_exception", id: opened[0].attendance_exception_id },
        actor: user,
        payload: { ...facts, employee_name: person.ref.display_name, types: opened.map((x) => x.exception_type) },
      });
    return { row, replayed: false };
  });

  return resultOf(user, outcome.row, { replayed: outcome.replayed, now });
}

/* ------------------------------------------------------------------ *
 * The person's own reads
 * ------------------------------------------------------------------ */

/** The first and last day of a month (this month at the person's workplace when absent). */
function monthOf(person, month, now = new Date()) {
  const m = month || rules.localDate(now, calendar.zoneOf(person)).slice(0, 7);
  return { month: m, ...lagos.monthBounds(`${m}-01`) };
}

async function personOf(user) {
  const person = await repo.person(pool, user.employee_id);
  if (!person) throw notEmployed();
  return person;
}

async function myDays(user, query) {
  const person = await personOf(user);
  const { first, last } = monthOf(person, query.month);
  return repo.listDays(pool, user.employee_id, first, last, query);
}

async function mySummary(user, query) {
  const person = await personOf(user);
  const { month, first, last } = monthOf(person, query.month);
  const s = await repo.daysSummary(pool, user.employee_id, first, last);
  return { month, ...s };
}

const myEvents = (user, query) =>
  repo.listEvents(pool, user.employee_id, query.date, query, { coordinates: false });

async function myExceptions(user, query) {
  const page = await repo.listExceptions(pool, { ...query, employee_id: user.employee_id }, {
    scope: "own",
    scope_ids: [user.employee_id],
  });
  return reconcile.presentPage(page);
}

/**
 * Ask for a workbook of the request's scope, for the person asking: its file is reserved now,
 * made after commit (attendance.export.js) and downloaded on the device that asked.
 * @returns {Promise<object>} the ExportFile, pending
 */
function requestExport(actor, payload) {
  const kind = attendanceExport.KINDS[payload.kind];
  return tx(async (client) => {
    const doc = await exportFiles.reserve(client, {
      doc_type: attendanceExport.DOC_TYPE,
      entity: { type: attendanceExport.DOC_TYPE, id: crypto.randomUUID() },
      file_name: exportFilename({ base: kind.base, env: config.APP_ENV, extension: "xlsx" }),
      title: `${kind.title} export`,
      actor,
    });
    await emit(client, {
      key: EVENTS.ATTENDANCE_EXPORT_REQUESTED,
      entity: { type: doc.entity_type, id: doc.entity_id },
      actor,
      payload: { ...payload, requested_by: actor.user_id, document_id: doc.document_id },
    });
    return exportFiles.present(doc);
  });
}

const requestMyExport = (user, body) => requestExport(user, { kind: "month", month: body.month });

/* ------------------------------------------------------------------ *
 * People's reads
 * ------------------------------------------------------------------ */

/** The date a register read is for: the one asked, or today in Lagos. */
const dateOf = (query, now = new Date()) => query.date || lagos.today(now);

/**
 * The register for a day: each person by their own day (their schedule, else the company hours in
 * force on the date, which the SQL takes as a parameter; §6.9, §6.13).
 */
async function register(query, scope) {
  const date = dateOf(query);
  return repo.register(pool, date, query, scope, { hours: await calendar.companyHoursOn(pool, date) });
}

async function summary(query, scope) {
  const date = dateOf(query);
  return { date, ...(await repo.registerSummary(pool, date, scope, { hours: await calendar.companyHoursOn(pool, date) })) };
}

/** One person's day on the register, within the caller's scope: its shift as the day was judged. */
async function dayDetail(employeeId, query, scope) {
  assertInScope(scope, employeeId);
  const date = dateOf(query);
  const row = await repo.registerRow(pool, date, employeeId, { hours: await calendar.companyHoursOn(pool, date) });
  if (!row) throw new AppError("NOT_FOUND", "Not found", 404);
  const person = await repo.person(pool, employeeId);
  const { judged, ctx } = await reconcile.judgedOn(pool, person, date);
  const approval = await repo.overtimeApprovalOn(pool, employeeId, date);
  return {
    employee: row.employee,
    date,
    work_pattern: row.work_pattern,
    status: row.status,
    attendance_day_id: row.attendance_day_id,
    shift: {
      working_day: judged.shift.working_day,
      starts_at: judged.shift.starts_at,
      ends_at: judged.shift.ends_at,
      grace_minutes: judged.shift.grace_minutes,
    },
    clock_in_at: row.clock_in_at,
    clock_out_at: row.clock_out_at,
    worked_minutes: row.worked_minutes,
    late_minutes: row.late_minutes,
    early_minutes: row.early_minutes,
    overtime_minutes: row.overtime_minutes,
    closed: Boolean(row.closed_at),
    expected_location: ctx.fence
      ? { name: ctx.fence.name, radius_m: ctx.fence.radius_m }
      : ctx.approved
        ? { name: ctx.approved.name, radius_m: null }
        : null,
    policy: { geofence_mode: ctx.policy.geofence_mode, device_mode: ctx.policy.device_mode },
    open_exceptions: row.open_exceptions,
    overtime_approval: approval
      ? { minutes: Number(approval.minutes), approved_by_name: approval.approved_by_name || null, reason: approval.reason }
      : null,
  };
}

/** One person's punches on a date: coordinates only for a reader with scope all. */
function events(query, scope) {
  assertInScope(scope, query.employee_id);
  return repo.listEvents(pool, query.employee_id, query.date, query, { coordinates: scope.scope === "all" });
}

async function exceptions(query, scope) {
  return reconcile.presentPage(await repo.listExceptions(pool, query, scope));
}

/** What a link to a day or an exception opens, within the caller's scope. */
async function recordFor(id, scope) {
  const ref = await repo.recordRef(pool, id);
  if (!ref) throw new AppError("NOT_FOUND", "Not found", 404);
  assertInScope(scope, ref.employee_id);
  return ref;
}

/** The same, for one of the person's own. */
async function myRecord(user, id) {
  const ref = await repo.recordRef(pool, id);
  if (!ref || ref.employee_id !== user.employee_id) throw new AppError("NOT_FOUND", "Not found", 404);
  return ref;
}

/** The register over some days, as a workbook, within the caller's export scope. */
function requestRegisterExport(actor, body) {
  const { from, to, ...filters } = body;
  return requestExport(actor, { kind: "register", filters: { from, to, ...filters } });
}

module.exports = {
  openSession,
  today,
  punch,
  messageOf,
  myDays,
  mySummary,
  myEvents,
  myExceptions,
  explain: reconcile.explain,
  explainAutomatic: reconcile.explainAutomatic,
  requestMyExport,
  register,
  summary,
  dayDetail,
  events,
  exceptions,
  decide: reconcile.decide,
  recordFor,
  myRecord,
  requestRegisterExport,
  closeDays: reconcile.closeDays,
  watchClock: clockWatch.watch,
};
