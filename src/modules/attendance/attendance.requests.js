"use strict";
/**
 * Work location requests: the one write path for asking to work somewhere else for some days,
 * and the reads behind ESS · Work Location Requests and People · Attendance's Requests
 * (docs/guides/attendance.md §6.11).
 *
 *   request()  the person asks. Checked (who may ask which type, the dates, the span, the
 *              overlap) under the person's lock, numbered WLR-0001, saved `submitted`, and the
 *              `attendance.location_request` approval opened in the same transaction: the line
 *              manager, then Operations & People
 *   cancel()   the person withdraws a request still waiting (the approval with it), or cancels an
 *              approved one until the day before its first day
 *   settle()   after commit, an approval's outcome is copied onto the request, at least once and
 *              only while it waits (attendance.events.js)
 *
 * Approved, a request decides the place a punch on its days is matched to (attendance.calendar.js):
 * a client visit is fenced at its site, a client's venue that everyone reading the request sees.
 * A temporary home's point is personal data: the person reads it, People read it with scope all
 * (masked by the controller under employee.personal). Events carry ids and statuses, never the
 * address, the point or the site.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const numbering = require("../../shared/numbering/numbering");
const { assertInScope } = require("../../shared/rbac/scope");
const { scopeFor } = require("../../middleware/rbac");
const lagos = require("../../shared/time/lagos");
const engine = require("../../shared/workflow/engine");
const calendar = require("./attendance.calendar");
const repo = require("./attendance.repo");
const { EVENTS, REQUEST_DEFINITION_KEY } = require("./attendance.events");

/** The longest each type may run, in calendar days, and how far ahead a request may start. */
const SPAN_DAYS = Object.freeze({ temporary_home: 90, remote_day: 5, client_visit: 14 });
const AHEAD_DAYS = 90;

/** Who may ask for which type, by work pattern (§6.11). */
const PATTERNS = Object.freeze({
  temporary_home: ["remote"],
  remote_day: ["on_site", "hybrid"],
  client_visit: ["on_site", "hybrid", "remote"],
});
const NOT_FOR_YOU = Object.freeze({
  temporary_home: "Only remote staff ask for a temporary home.",
  remote_day: "Remote staff already work remotely every day.",
  client_visit: "Only people who work here now can ask.",
});

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That work location request does not exist", 404);
const iso = (t) => (t ? new Date(t).toISOString() : null);

/** A row as the contract's LocationRequest. */
function present(row) {
  if (!row) return row;
  return {
    ...row,
    days: Number(row.days),
    requested_at: iso(row.requested_at),
    decided_at: iso(row.decided_at),
    cancelled_at: iso(row.cancelled_at),
  };
}

const presentPage = (page) => ({ ...page, data: page.data.map(present) });

/** The facts every request event carries: ids and the kind, never the place. */
const payloadOf = (row, employeeId) => ({
  location_request_id: row.location_request_id,
  number: row.number,
  employee_id: employeeId,
  subject_employee_id: employeeId,
  request_type: row.request_type,
});

/* ------------------------------------------------------------------ *
 * The person's own
 * ------------------------------------------------------------------ */

const OWN = (user) => ({ scope: "own", scope_ids: [user.employee_id] });

/** GET /attendance/me/requests */
async function mine(user, query) {
  return presentPage(await repo.listRequests(pool, query, OWN(user), { place: true, reader: null, mine: true }));
}

/** GET /attendance/me/requests/:id; another person's is a 404. */
async function getMine(user, id) {
  const row = await repo.requestRow(pool, id, { place: true, reader: null });
  if (!row || row.employee.employee_id !== user.employee_id) throw notFound();
  return present(row);
}

/** The dates, against today in Lagos and the type's span (§6.11). */
function checkDates(body, today) {
  if (body.starts_on < today)
    throw new AppError("REQUEST_IN_THE_PAST", "Pick a first day from today on", 422, { starts_on: ["Already past"] });
  if (lagos.daysBetween(today, body.starts_on) > AHEAD_DAYS)
    throw new AppError("REQUEST_TOO_FAR", `Pick a first day within ${AHEAD_DAYS} days`, 422, {
      starts_on: ["Too far ahead"],
    });
  const days = lagos.daysBetween(body.starts_on, body.ends_on) + 1;
  if (days > SPAN_DAYS[body.request_type])
    throw new AppError("REQUEST_TOO_LONG", `This kind of request covers at most ${SPAN_DAYS[body.request_type]} days`, 422, {
      ends_on: [`At most ${SPAN_DAYS[body.request_type]} days`],
    });
  return days;
}

/**
 * POST /attendance/me/requests.
 * @param {{user_id: string, employee_id: string}} user  the session's
 * @param {object} body  LocationRequestCreate
 */
async function request(user, body) {
  const employeeId = user.employee_id;
  const today = lagos.today();
  const days = checkDates(body, today);
  const id = await tx(async (client) => {
    await repo.lockEmployee(client, employeeId);
    const person = await repo.person(client, employeeId);
    if (!person || person.status !== "active")
      throw new AppError("NOT_EMPLOYED", "Only people who work here now can ask.", 422);
    if (!PATTERNS[body.request_type].includes(person.work_pattern))
      throw new AppError("REQUEST_TYPE_NOT_ALLOWED", NOT_FOR_YOU[body.request_type], 422, {
        request_type: ["Not for your work pattern"],
      });
    if (body.request_type === "temporary_home") {
      const policy = await calendar.policyFor(client, employeeId, today);
      if (Number(body.accuracy_m) > Number(policy.max_accuracy_m))
        throw new AppError("HOME_READING_WEAK", "The location reading was not accurate enough.", 422, {
          accuracy_m: ["Reading too weak"],
        });
    }
    const clash = await repo.overlappingRequest(client, employeeId, body.starts_on, body.ends_on);
    if (clash)
      throw new AppError("REQUEST_OVERLAPS", `${clash.number} already covers one of these days`, 409, {
        starts_on: ["Overlaps another"],
      });

    const { number } = await numbering.allocate(client, "location_request");
    const home = body.request_type === "temporary_home";
    const visit = body.request_type === "client_visit";
    const row = await repo.insertRequest(client, {
      number,
      employee_id: employeeId,
      request_type: body.request_type,
      starts_on: body.starts_on,
      ends_on: body.ends_on,
      address: body.address || null,
      latitude: home ? body.home_latitude : null,
      longitude: home ? body.home_longitude : null,
      accuracy_m: home ? body.accuracy_m : null,
      site_latitude: visit ? body.site_latitude : null,
      site_longitude: visit ? body.site_longitude : null,
      site_radius_m: visit ? body.site_radius_m : null,
      reason: body.reason,
      requested_by: user.user_id,
    });
    const facts = payloadOf({ ...row, number, request_type: body.request_type }, employeeId);
    await emit(client, {
      key: EVENTS.LOCATION_REQUEST_SUBMITTED,
      entity: { type: "attendance_location_request", id: row.location_request_id },
      actor: user,
      after: {
        number,
        request_type: body.request_type,
        starts_on: body.starts_on,
        ends_on: body.ends_on,
        status: "submitted",
      },
      payload: { ...facts, employee_name: person.ref.display_name },
    });
    const instance = await engine.openInstance(client, {
      definition_key: REQUEST_DEFINITION_KEY,
      entity: { type: "attendance_location_request", id: row.location_request_id },
      subject_employee_id: employeeId,
      context: { days },
      actor: user,
    });
    await repo.setRequestWorkflow(client, row.location_request_id, instance.workflow_instance_id);
    return row.location_request_id;
  });
  return getMine(user, id);
}

/**
 * POST /attendance/me/requests/:id/cancel: a request still waiting is withdrawn with its
 * approval; an approved one is cancelled until the day before its first day.
 */
async function cancel(user, id, body) {
  const row = await repo.getRequest(pool, id);
  if (!row || row.employee_id !== user.employee_id) throw notFound();
  const waiting = row.status === "submitted";
  const notStarted = row.status === "approved" && row.starts_on > lagos.today();
  if (!waiting && !notStarted)
    throw new AppError("REQUEST_NOT_CANCELLABLE", "This request can no longer be cancelled", 409);
  await tx(async (client) => {
    await repo.lockEmployee(client, user.employee_id);
    if (waiting && row.workflow_instance_id)
      await engine.cancel(client, { instance_id: row.workflow_instance_id, actor: user, reason: body.reason || null });
    const done = await repo.cancelRequest(client, id, body.reason);
    if (!done) throw new AppError("REQUEST_NOT_CANCELLABLE", "This request can no longer be cancelled", 409);
    await emit(client, {
      key: EVENTS.LOCATION_REQUEST_CANCELLED,
      entity: { type: "attendance_location_request", id },
      actor: user,
      before: { status: row.status },
      after: { status: "cancelled", cancel_reason: body.reason || null },
      payload: payloadOf(row, row.employee_id),
    });
  });
  return getMine(user, id);
}

/* ------------------------------------------------------------------ *
 * People's reads
 * ------------------------------------------------------------------ */

/** Whether the reader may decide `people` approvals at all; the engine names who decides each stage. */
async function readerOf(user) {
  return { user, approves: Boolean(await scopeFor(user, "people", "approve")) };
}

/** GET /attendance/requests: within the reader's scope, waiting first. */
async function list(user, query, scope) {
  const page = await repo.listRequests(pool, query, scope, {
    place: scope.scope === "all",
    reader: await readerOf(user),
  });
  return presentPage(page);
}

/** GET /attendance/requests/:id, within the reader's scope. */
async function get(user, id, scope) {
  const row = await repo.getRequest(pool, id);
  if (!row) throw notFound();
  assertInScope(scope, row.employee_id);
  return present(await repo.requestRow(pool, id, { place: scope.scope === "all", reader: await readerOf(user) }));
}

/* ------------------------------------------------------------------ *
 * After an approval ends
 * ------------------------------------------------------------------ */

const SETTLED_EVENT = {
  approved: EVENTS.LOCATION_REQUEST_APPROVED,
  rejected: EVENTS.LOCATION_REQUEST_REJECTED,
  cancelled: EVENTS.LOCATION_REQUEST_CANCELLED,
};

/**
 * Copy an approval's outcome onto its request. Runs after commit, at least once; a request
 * already settled (or one that does not exist) is left alone.
 * @param {string} id  the location_request_id the approval is about
 * @param {string|null} status  approved, rejected or cancelled
 */
async function settle(id, status) {
  if (!SETTLED_EVENT[status]) return;
  await tx(async (client) => {
    const row = await repo.settleRequest(client, id, status);
    if (!row) return;
    await emit(client, {
      key: SETTLED_EVENT[status],
      entity: { type: "attendance_location_request", id },
      actor: null,
      before: { status: "submitted" },
      after: { status },
      payload: { location_request_id: id, number: row.number, employee_id: row.employee_id, subject_employee_id: row.employee_id },
    });
  });
}

module.exports = { SPAN_DAYS, PATTERNS, mine, getMine, request, cancel, list, get, settle, present };
