"use strict";
/**
 * Check-ins at each stop on a temporary site's day: the one write path, and the reads behind the
 * clock panel, My Attendance and a day's evidence (docs/guides/attendance.md §6.12).
 *
 * A check-in, in one transaction, after the person's advisory lock:
 *
 *   1. the idempotency key: a check-in this key already made is answered again, unchanged
 *   2. the person: employed; the work date at the site (attendance.sites.js zoneAt); the shift open
 *      (today's, or yesterday's still open, whose site it is then checked against)
 *   3. that day's approved site, else 422 NO_TEMPORARY_SITE; no shift open, 409 NOT_CLOCKED_IN;
 *      the 21st of a day, 422 CHECK_IN_LIMIT. Never refused for where it was made
 *   4. matched to the nearest address with the same decideGeofence call as a punch, under the
 *      site's mode (a home's for a Temporary Home); only its verdict is read. A second check-in at
 *      the same address within 5 minutes answers with the first, recording nothing
 *   5. recorded (attendance_check_in, append-only) with its distance, verdict, evidence and policy
 *      version; outside or unclear under Flag or Refuse opens an exception carrying it, on the day
 *      of the shift; attendance.checked_in (and attendance.review_required) emitted
 *
 * It never opens, closes or changes the shift or the day. Its point never leaves the server.
 */
const { pool } = require("../../config/db");
const requestContext = require("../../config/request-context");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { assertInScope } = require("../../shared/rbac/scope");
const calendar = require("./attendance.calendar");
const { decideGeofence } = require("./attendance.geofence");
const rules = require("./attendance.rules");
const repo = require("./attendance.repo");
const sitesRepo = require("./attendance.sites.repo");
const sites = require("./attendance.sites");
const { EVENTS } = require("./attendance.events");

/** The most check-ins a day, and how soon a second one at the same address answers with the first. */
const DAILY_LIMIT = 20;
const REPEAT_MS = 5 * 60 * 1000;

const SEVERITY = Object.freeze({ outside_worksite: "medium", outside_home: "medium", location_unverified: "low" });

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const iso = (t) => (t ? new Date(t).toISOString() : null);
const num = (v) => (v === null || v === undefined ? null : Number(v));

/** A row as the contract's CheckIn. */
function present(row) {
  if (!row) return row;
  return {
    attendance_check_in_id: row.attendance_check_in_id,
    work_date: row.work_date,
    occurred_at: iso(row.occurred_at),
    temporary_site_location_id: row.temporary_site_location_id,
    position: Number(row.position),
    location_name: row.location_name,
    address: row.address,
    home_address: row.home_address,
    distance_m: num(row.distance_m),
    accuracy_m: num(row.accuracy_m),
    verdict: row.verdict,
    location_reason: row.location_reason,
    flagged: Boolean(row.flagged),
  };
}

const presentPage = (page) => ({ ...page, data: page.data.map(present) });

/**
 * The flag a check-in's verdict raises under a mode, or null (§6.12): Off records only; under Flag
 * and Refuse alike, outside is the place's outside flag and unclear is location_unverified. Pure.
 * @param {"off"|"warn"|"block"} mode
 * @param {"inside"|"outside"|"unverified"} verdict
 * @param {boolean} home  a Temporary Home, judged as a home
 */
function flagOf(mode, verdict, home) {
  if (mode === "off" || verdict === "inside") return null;
  if (verdict === "outside") return home ? "outside_home" : "outside_worksite";
  return "location_unverified";
}

/** The person's line for a check-in (the contract's CheckIn). Pure. */
function messageOf(row) {
  const at = row.location_name;
  if (!row.flagged) return `Checked in at ${at}.`;
  if (row.verdict !== "outside") return `Checked in at ${at}. People will review it: your location could not be confirmed.`;
  return `Checked in ${Math.round(row.distance_m || 0)} m from ${at}. People will review it.`;
}

/** The shift a check-in belongs to: today's open one, or yesterday's while it is still open. */
const openShift = (db, employeeId, date) => require("./attendance.service").openSession(db, employeeId, date);

/**
 * POST /attendance/check-ins.
 * @param {{user_id: string, employee_id: string}} user  the session's
 * @param {object} body  CheckInCreate
 * @param {{idempotencyKey: string, now?: Date}} opts
 */
async function checkIn(user, body, { idempotencyKey, now = new Date() } = {}) {
  if (!idempotencyKey)
    throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key with every check-in.", 428);
  const employeeId = user.employee_id;

  const outcome = await tx(async (client) => {
    await repo.lockEmployee(client, employeeId);
    const prior = await sitesRepo.checkInByKey(client, employeeId, idempotencyKey);
    if (prior) return { row: prior, replayed: true };

    const person = await repo.person(client, employeeId);
    if (!person || person.status !== "active")
      throw new AppError("NOT_EMPLOYED", "Only people who work here now can check in.", 422);
    const zone = await sites.zoneAt(client, person, now, calendar.zoneOf(person));
    const date = rules.localDate(now, zone);
    const session = await openShift(client, employeeId, date);
    const workDate = session.date || date;
    const site = await sitesRepo.siteOn(client, employeeId, workDate);
    // A Temporary Home while Home Location is off is a day from home, unchecked: no stops (§6.12, H6).
    const ctx = site ? await calendar.contextFor(client, person, workDate) : null;
    if (!site || ctx.unchecked)
      throw new AppError("NO_TEMPORARY_SITE", "Check In is for a temporary site's day.", 422);
    if (!session.date) throw new AppError("NOT_CLOCKED_IN", "Clock in before you check in.", 409);
    if ((await sitesRepo.countOn(client, employeeId, workDate)) >= DAILY_LIMIT)
      throw new AppError("CHECK_IN_LIMIT", `At most ${DAILY_LIMIT} check-ins a day.`, 422);

    const point = body.latitude === null ? null : { latitude: body.latitude, longitude: body.longitude };
    const judged = decideGeofence({
      mode: ctx.policy.geofence_mode,
      point,
      accuracy_m: body.accuracy_m,
      location_error: body.location_error || null,
      expected: ctx.fence,
      approved: null,
      work_pattern: person.work_pattern,
      home_day: false,
      max_accuracy_m: ctx.policy.max_accuracy_m,
    });
    const locationId = judged.site_id || site.locations[0].temporary_site_location_id;

    // The same stop pressed again: the first answers.
    const recent = await sitesRepo.recentAt(client, employeeId, locationId, new Date(now.getTime() - REPEAT_MS));
    if (recent) return { row: recent, replayed: true };

    const home = site.purpose === "temporary_home";
    const flag = flagOf(ctx.policy.geofence_mode, judged.verdict, home);
    const location = site.locations.find((l) => l.temporary_site_location_id === locationId) || site.locations[0];
    const id = await sitesRepo.insertCheckIn(client, {
      employee_id: employeeId,
      work_date: workDate,
      occurred_at: now,
      device_at: body.device_at,
      latitude: point ? point.latitude : null,
      longitude: point ? point.longitude : null,
      accuracy_m: body.accuracy_m,
      temporary_site_location_id: locationId,
      distance_m: judged.distance_m,
      verdict: judged.verdict,
      evidence: {
        temporary_site_id: site.temporary_site_id,
        site_number: site.number,
        place: home ? "temporary_home" : "temporary_site",
        address_name: sites.nameOfAddress(site, location),
        radius_m: judged.radius_m,
        mode: ctx.policy.geofence_mode,
        accuracy: judged.accuracy,
        reason: judged.reason,
        location_error: body.location_error || null,
        skew_seconds: rules.timeCheck({ server_at: now, device_at: body.device_at }).skew_seconds,
      },
      policy_version_id: ctx.policy.policy_version_id,
      idempotency_key: idempotencyKey,
      request_id: requestContext.getRequestId(),
    });

    let opened = null;
    if (flag) {
      let day = await repo.getDay(client, employeeId, workDate);
      if (!day) day = (await require("./attendance.reconcile").recomputeDay(client, person, workDate)).day;
      opened = await repo.insertException(client, {
        attendance_day_id: day.attendance_day_id,
        attendance_check_in_id: id,
        exception_type: flag,
        severity: SEVERITY[flag],
        evidence: {
          check_in: true,
          reason: judged.reason,
          place: home ? "temporary_home" : "temporary_site",
          distance_m: judged.distance_m,
          radius_m: judged.radius_m,
          worksite_name: judged.worksite_name,
          accuracy_m: body.accuracy_m,
          occurred_at: now.toISOString(),
          timezone: ctx.timeZone,
        },
      });
    }

    const facts = {
      attendance_check_in_id: id,
      employee_id: employeeId,
      subject_employee_id: employeeId,
      work_date: workDate,
      verdict: judged.verdict,
      flagged: Boolean(opened),
      temporary_site_id: site.temporary_site_id,
      number: site.number,
    };
    await emit(client, {
      key: EVENTS.ATTENDANCE_CHECKED_IN,
      entity: { type: "attendance_check_in", id },
      actor: user,
      after: { work_date: workDate, verdict: judged.verdict, flagged: Boolean(opened), number: site.number },
      payload: facts,
    });
    if (opened)
      await emit(client, {
        key: EVENTS.ATTENDANCE_REVIEW_REQUIRED,
        entity: { type: "attendance_exception", id: opened.attendance_exception_id },
        actor: user,
        payload: { ...facts, employee_name: person.ref.display_name, types: [opened.exception_type] },
      });
    return { row: await sitesRepo.checkInRow(client, id), replayed: false };
  });

  const row = present(outcome.row);
  return {
    check_in: row,
    message: messageOf(row),
    replayed: outcome.replayed,
    today: await require("./attendance.service").today(user, { now }),
  };
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/** Today's check-ins for the clock panel, in time order (AttendanceToday). */
async function onDay(db, employeeId, date) {
  return (await sitesRepo.checkInsOn(db, employeeId, date)).map(present);
}

/** GET /attendance/me/check-ins: one of the person's days, in time order. */
async function mine(user, query) {
  return presentPage(await sitesRepo.listCheckIns(pool, user.employee_id, query.date, query, { place: true }));
}

/** GET /attendance/check-ins: one person's day, within the reader's scope; a Temporary Home's line for scope all. */
async function list(query, scope) {
  assertInScope(scope, query.employee_id);
  return presentPage(
    await sitesRepo.listCheckIns(pool, query.employee_id, query.date, query, { place: scope.scope === "all" }),
  );
}

module.exports = { DAILY_LIMIT, REPEAT_MS, present, flagOf, messageOf, checkIn, onDay, mine, list };
