"use strict";
/**
 * Work location requests made before attendance's PR 4, which retired asking for new ones in favour
 * of temporary sites (attendance.sites.js): the reads behind ESS · Work Location Requests and People ·
 * Worksites' Requests, and what still applies to one waiting or in force until its last day
 * (docs/guides/attendance.md §6.11).
 *
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
const { assertInScope } = require("../../shared/rbac/scope");
const { scopeFor } = require("../../middleware/rbac");
const lagos = require("../../shared/time/lagos");
const engine = require("../../shared/workflow/engine");
const repo = require("./attendance.repo");
const { EVENTS } = require("./attendance.events");

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

module.exports = { mine, getMine, cancel, list, get, settle, present };
